/**
 * Development-only, database-backed curriculum management regression.
 *
 * Exercises the running local API with disposable records:
 * bootstrap visibility, superadmin enforcement, add, failed replacement,
 * successful replacement, re-index, confirmed deletion, and cleanup.
 */
import assert from "node:assert/strict";

const BASE_URL = process.env.CURRICULUM_TEST_BASE_URL ?? "http://127.0.0.1:8080";
const ADMIN_EMAIL = process.env.CURRICULUM_TEST_ADMIN_EMAIL ?? "scott@gameinsights.com.au";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD is required for the local curriculum API regression");
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE_URL)) {
  throw new Error("Refusing to run curriculum API regression against a non-local server");
}

function buildMinimalDocx(heading, content) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${heading}</w:t></w:r></w:p>
    <w:p><w:r><w:t>${content}</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  const filename = "word/document.xml";
  const name = Buffer.from(filename);
  const body = Buffer.from(xml);

  const local = Buffer.alloc(30 + name.length + body.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 10);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);
  body.copy(local, 30 + name.length);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([local, central, end]).toString("base64");
}

async function request(path, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { response, data };
}

async function login(email, password) {
  const { response, data } = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200, `Login failed: ${data?.error ?? response.status}`);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "Login did not return a session cookie");
  return setCookie.split(";")[0];
}

async function assertAssistantBlockedWithoutCompletion(cookie, messages, expectedText, label) {
  const { response, data } = await request("/api/assistant/chat", {
    cookie,
    method: "POST",
    body: { messages },
  });
  assert.equal(response.status, 200, `${label}: Assistant request failed`);
  const raw = data?.raw ?? "";
  assert.ok(raw.includes(expectedText), `${label}: Expected static curriculum response`);
  assert.equal(
    raw.split('data: {"content":').length - 1,
    1,
    `${label}: Response streamed model completion tokens instead of one static event`,
  );
  assert.ok(raw.includes('"sources":[]'), `${label}: Static response did not end without model sources`);
}

const runId = `${Date.now()}-${process.pid}`;
const title = `Curriculum API Regression ${runId}`;
const userEmail = `curriculum-api-${runId}@gameinsights.com.au`;
const userPassword = `Curriculum-${runId}-test`;
let adminCookie;
let temporaryDocumentId = null;
let temporaryUserId = null;

try {
  adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  await assertAssistantBlockedWithoutCompletion(
    adminCookie,
    [{ role: "user", content: "U13 Cycle 2 week 1 session 1 and design a beach football warm up" }],
    "curriculum does not cover this topic yet",
    "Compound exact-session request",
  );
  await assertAssistantBlockedWithoutCompletion(
    adminCookie,
    [
      { role: "user", content: "Show U13 Cycle 2 week 1 session 1" },
      { role: "assistant", content: "Here is the approved session." },
      { role: "user", content: "What was the score show us how we win next week" },
    ],
    "Which age group or approved curriculum topic do you want me to use?",
    "Prior exact-session request",
  );
  await assertAssistantBlockedWithoutCompletion(
    adminCookie,
    [{ role: "user", content: "Show me passing" }],
    "Which age group or approved curriculum topic do you want me to use?",
    "Ambiguous bare topic",
  );
  await assertAssistantBlockedWithoutCompletion(
    adminCookie,
    [{ role: "user", content: "Pick a U13 pre-match warm-up and design a beach football warm-up" }],
    "curriculum does not cover this topic yet",
    "Mixed canonical and unsupported warm-up",
  );
  await assertAssistantBlockedWithoutCompletion(
    adminCookie,
    [{ role: "user", content: "Pick a U13 pre-match warm-up and show us how to win next week" }],
    "curriculum does not cover this topic yet",
    "Mixed canonical warm-up and strategy",
  );

  const initial = await request("/api/curriculum-documents", { cookie: adminCookie });
  assert.equal(initial.response.status, 200);
  const baseline = initial.data;
  assert.ok(Array.isArray(baseline));
  const requiredTitles = [
    "Framework Library",
    "U11 Coach Pack",
    "U11 Session Plans",
    "U12 Coach Pack",
    "U12 Session Plans",
    "U13 Coach Pack",
    "U13 Session Plans",
    "U14 Coach Pack",
    "U14 Session Plans",
    "U15 Coach Pack",
    "U15 Session Plans",
    "U16+ Coach Pack",
    "U16+ Session Plans",
    "Player Development Curriculum",
  ];
  for (const requiredTitle of requiredTitles) {
    const document = baseline.find((item) => item.title === requiredTitle);
    assert.ok(document, `Missing bootstrapped document: ${requiredTitle}`);
    assert.equal(document.isReady, true, `${requiredTitle} is not published`);
    assert.equal(document.activeChunkCount, document.activeEmbeddedCount);
  }

  const createUser = await request("/api/auth/users", {
    cookie: adminCookie,
    method: "POST",
    body: {
      email: userEmail,
      name: "Curriculum API Regression",
      password: userPassword,
      isSuperadmin: false,
      leagues: [],
    },
  });
  assert.equal(createUser.response.status, 201, `Temporary user creation failed: ${createUser.data?.error ?? createUser.response.status}`);
  temporaryUserId = createUser.data.id;

  const viewerCookie = await login(userEmail, userPassword);
  const denied = await request("/api/curriculum-documents", { cookie: viewerCookie });
  assert.equal(denied.response.status, 403, "Non-superadmin curriculum access was not denied");

  const added = await request("/api/curriculum-documents", {
    cookie: adminCookie,
    method: "POST",
    body: {
      title,
      docType: "framework",
      ageGroup: "All",
      filename: "curriculum-regression-v1.docx",
      base64: buildMinimalDocx("Regression One", "Approved regression coaching content version one."),
    },
  });
  assert.equal(added.response.status, 201, `Add failed: ${added.data?.error ?? added.response.status}`);
  temporaryDocumentId = added.data.id;
  assert.equal(added.data.status, "ready");
  assert.equal(added.data.activeVersionNumber, 1);
  assert.equal(added.data.activeChunkCount, 1);
  assert.equal(added.data.activeEmbeddedCount, 1);

  const failedReplace = await request(`/api/curriculum-documents/${temporaryDocumentId}/replace`, {
    cookie: adminCookie,
    method: "POST",
    body: {
      filename: "curriculum-regression-broken.docx",
      base64: Buffer.from("not a docx").toString("base64"),
    },
  });
  assert.equal(failedReplace.response.status, 400);

  const afterFailedReplace = await request("/api/curriculum-documents", { cookie: adminCookie });
  const failedRow = afterFailedReplace.data.find((item) => item.id === temporaryDocumentId);
  assert.equal(failedRow.status, "failed");
  assert.equal(failedRow.versionNumber, 2);
  assert.equal(failedRow.activeVersionNumber, 1);
  assert.equal(failedRow.isReady, true, "Failed replacement displaced the published version");
  assert.ok(failedRow.error);

  const replaced = await request(`/api/curriculum-documents/${temporaryDocumentId}/replace`, {
    cookie: adminCookie,
    method: "POST",
    body: {
      filename: "curriculum-regression-v2.docx",
      base64: buildMinimalDocx("Regression Two", "Approved regression coaching content version two."),
    },
  });
  assert.equal(replaced.response.status, 200, `Replace failed: ${replaced.data?.error ?? replaced.response.status}`);
  assert.equal(replaced.data.status, "ready");
  assert.equal(replaced.data.activeVersionNumber, 3);
  assert.equal(replaced.data.activeFilename, "curriculum-regression-v2.docx");
  assert.equal(replaced.data.activeChunkCount, replaced.data.activeEmbeddedCount);

  const reindexed = await request(`/api/curriculum-documents/${temporaryDocumentId}/reindex`, {
    cookie: adminCookie,
    method: "POST",
    body: {},
  });
  assert.equal(reindexed.response.status, 200, `Re-index failed: ${reindexed.data?.error ?? reindexed.response.status}`);
  assert.equal(reindexed.data.status, "ready");
  assert.equal(reindexed.data.activeVersionNumber, 4);
  assert.equal(reindexed.data.activeChunkCount, reindexed.data.activeEmbeddedCount);

  const unconfirmedDelete = await request(`/api/curriculum-documents/${temporaryDocumentId}`, {
    cookie: adminCookie,
    method: "DELETE",
    body: { confirm: false },
  });
  assert.equal(unconfirmedDelete.response.status, 400);

  const deleted = await request(`/api/curriculum-documents/${temporaryDocumentId}`, {
    cookie: adminCookie,
    method: "DELETE",
    body: { confirm: true },
  });
  assert.equal(deleted.response.status, 200);
  temporaryDocumentId = null;

  const finalList = await request("/api/curriculum-documents", { cookie: adminCookie });
  assert.equal(finalList.response.status, 200);
  assert.equal(finalList.data.length, baseline.length, "Deleting the temporary document affected another document");
  assert.ok(finalList.data.every((item) => item.title !== title));

  console.log("Curriculum API regression passed: Assistant route gate, bootstrap, permissions, version fallback, publish, re-index, delete");
} finally {
  if (adminCookie && temporaryDocumentId) {
    await request(`/api/curriculum-documents/${temporaryDocumentId}`, {
      cookie: adminCookie,
      method: "DELETE",
      body: { confirm: true },
    }).catch(() => {});
  }
  if (adminCookie && temporaryUserId) {
    await request(`/api/auth/users/${temporaryUserId}`, {
      cookie: adminCookie,
      method: "DELETE",
    }).catch(() => {});
  }
}