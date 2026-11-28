import { test } from "node:test";
import assert from "node:assert/strict";
import { signRecording, verifyRecording, type RecordingConfirmation } from "./veoDiscovery";

const secret = "synthetic-unit-test-only";
const scope = { userId: 7, leagueId: 8, seasonId: 9 };
const recording: RecordingConfirmation = {
  ...scope, expiresAt: 2000, recordingId: "synthetic-video",
  title: "Synthetic friendly", startsAt: "2026-11-28T03:00:00Z",
  clubSlug: "synthetic-club", teamSlug: "synthetic-team", teamId: "synthetic-team-uuid",
};

test("confirmation preserves real source and campaign identity", () => {
  assert.deepEqual(verifyRecording(signRecording(recording, secret), secret, scope, 1000), recording);
});
test("another team, campaign, or user cannot reuse a confirmation", () => {
  const token = signRecording(recording, secret);
  for (const key of ["userId", "leagueId", "seasonId"] as const) {
    assert.equal(verifyRecording(token, secret, { ...scope, [key]: scope[key] + 1 }, 1000), null);
  }
});
test("changed metadata, expired previews and invalid signatures are rejected", () => {
  const token = signRecording(recording, secret);
  const tampered = `${Buffer.from(JSON.stringify({ ...recording, teamId: "wrong-team" })).toString("base64url")}.${token.split(".")[1]}`;
  assert.equal(verifyRecording(tampered, secret, scope, 1000), null);
  assert.equal(verifyRecording(token, "different-secret", scope, 1000), null);
  assert.equal(verifyRecording(token, secret, scope, 2000), null);
  for (const bad of ["", "not-a-token", `${token}.extra`, "a.b"]) {
    assert.equal(verifyRecording(bad, secret, scope, 1000), null);
  }
});
