// ── Veo client ────────────────────────────────────────────────────────────────
// Talks to Veo's INTERNAL app API (app.veo.co) — there is no official export for
// club accounts. Auth is OIDC authorization-code + PKCE against auth.veo.co.
// Credentials come from a per-login pair (default the coach's VEO_EMAIL /
// VEO_PASSWORD secrets) so future clubs can supply their own. If Veo changes
// their site this needs revisiting. Full API map: .agents/memory/veo-integration.md.
import { createHash, randomBytes } from "node:crypto";
import { logger } from "./logger";

const AUTH_BASE = "https://auth.veo.co";
const APP_BASE = "https://app.veo.co/api/app";
const CLIENT_ID = "IzRQtXQ07V7n8uBtpTHzi";
const REDIRECT_URI = "https://app.veo.co/signin-redirect/";
const SCOPE = "openid email phone address profile";

export interface VeoCredentials {
  email: string;
  password: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A tiny cookie jar: Veo's OIDC interaction relies on httpOnly cookies that must
// persist across the auth → login → resume hops.
class CookieJar {
  private jar = new Map<string, string>();
  store(setCookies: string[]) {
    for (const c of setCookies) {
      const first = c.split(";")[0];
      const eq = first.indexOf("=");
      if (eq > 0) this.jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

// undici exposes multiple Set-Cookie headers via getSetCookie().
function setCookies(res: Response): string[] {
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// Cache tokens per email so repeated syncs in the same process reuse them.
const tokenCache = new Map<string, CachedToken>();

async function login(creds: VeoCredentials): Promise<string> {
  const cached = tokenCache.get(creds.email);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken;

  const jar = new CookieJar();
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));

  // 1. Kick off the authorization request; follow redirects to the login page,
  //    collecting interaction cookies + the interaction uid along the way.
  const authUrl = new URL(`${AUTH_BASE}/oidc/auth`);
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);

  let uid = "";
  let url: string | null = authUrl.toString();
  for (let hop = 0; hop < 6 && url; hop++) {
    const res: Response = await fetch(url, {
      redirect: "manual",
      headers: { cookie: jar.header() },
    });
    jar.store(setCookies(res));
    const m = /login\.html\?uid=([A-Za-z0-9_-]+)/.exec(url) || /uid=([A-Za-z0-9_-]+)/.exec(res.headers.get("location") ?? "");
    if (m) uid = m[1];
    const loc = res.headers.get("location");
    if (!loc) break;
    url = loc.startsWith("http") ? loc : `${AUTH_BASE}${loc}`;
    if (/login\.html/.test(url)) break;
  }
  if (!uid) throw new Error("Veo login: could not obtain interaction uid");

  // 2. POST the credentials to the interaction. Do NOT follow the redirect here.
  const loginRes = await fetch(`${AUTH_BASE}/interaction/${uid}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ username: creds.email, password: creds.password }).toString(),
  });
  jar.store(setCookies(loginRes));
  const resume = loginRes.headers.get("location");
  if (!resume) throw new Error("Veo login: no resume redirect after credentials (bad email/password?)");

  // 3. Resume the interaction → yields the authorization code in a redirect.
  let resumeUrl: string | null = resume.startsWith("http") ? resume : `${AUTH_BASE}${resume}`;
  let code = "";
  for (let hop = 0; hop < 6 && resumeUrl; hop++) {
    const res: Response = await fetch(resumeUrl, {
      redirect: "manual",
      headers: { cookie: jar.header() },
    });
    jar.store(setCookies(res));
    const loc = res.headers.get("location");
    const codeM = /[?&]code=([A-Za-z0-9._-]+)/.exec(loc ?? "");
    if (codeM) { code = codeM[1]; break; }
    if (!loc) break;
    resumeUrl = loc.startsWith("http") ? loc : `${AUTH_BASE}${loc}`;
  }
  if (!code) throw new Error("Veo login: no authorization code returned");

  // 4. Exchange the code for an access token.
  const tokenRes = await fetch(`${AUTH_BASE}/oidc/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Veo token exchange failed: ${tokenRes.status}`);
  const tok = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!tok.access_token) throw new Error("Veo token exchange returned no access_token");

  tokenCache.set(creds.email, {
    accessToken: tok.access_token,
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
  });
  logger.info({ email: creds.email }, "veo: authenticated");
  return tok.access_token;
}

async function apiGet<T>(creds: VeoCredentials, path: string): Promise<T> {
  const token = await login(creds);
  const res = await fetch(`${APP_BASE}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (res.status === 401) {
    // Token may have gone stale mid-run; drop it and retry once.
    tokenCache.delete(creds.email);
    const fresh = await login(creds);
    const retry = await fetch(`${APP_BASE}${path}`, {
      headers: { authorization: `Bearer ${fresh}`, accept: "application/json" },
    });
    if (!retry.ok) throw new Error(`Veo GET ${path} → ${retry.status}`);
    return (await retry.json()) as T;
  }
  if (!res.ok) throw new Error(`Veo GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

// ── Shapes (only the fields we use) ─────────────────────────────────────────
export interface VeoRecording {
  identifier: string;
  title?: string;
  start?: string;
  team?: string;
  team__name?: string;
  processing_status?: string;
  thumbnail?: string;
}
export interface VeoMatchDetail {
  id: string;
  identifier: string;
  title?: string;
  opponent_team_name?: string;
  has_analytics_enabled?: boolean;
  has_events_enabled?: boolean;
  has_tracking_data?: boolean;
  has_momentum_data?: boolean;
}
export interface VeoEvent {
  id: string;
  event_type: string;
  team: "Own" | "Opp" | string;
  video_time_ms: number;
  period_id: number;
  period_time_ms: number;
  player_jersey: number | null;
  player_id: string | null;
  outcome: string | null;
  x: number | null;
  z: number | null;
  attributes: unknown;
}

export interface VeoTeam {
  id: string;
  slug: string;
  name: string;
  match_count?: number;
}

// All teams under a club (used to map a Hub league → Veo team slug).
export async function listTeams(creds: VeoCredentials, clubSlug: string): Promise<VeoTeam[]> {
  const data = await apiGet<VeoTeam[] | { results?: VeoTeam[] }>(
    creds,
    `/clubs/${clubSlug}/teams/?fields=id&fields=slug&fields=name&fields=match_count`,
  );
  return Array.isArray(data) ? data : data.results ?? [];
}

// List a team's own recordings (matches). team = the Veo team SLUG.
export async function listRecordings(
  creds: VeoCredentials,
  clubSlug: string,
  teamSlug: string,
): Promise<VeoRecording[]> {
  const fields = [
    "identifier", "title", "start", "team", "team__name",
    "processing_status", "thumbnail", "duration", "url",
  ].map((f) => `fields=${f}`).join("&");
  const data = await apiGet<VeoRecording[] | { results?: VeoRecording[] }>(
    creds,
    `/clubs/${clubSlug}/recordings/?filter=own&team=${encodeURIComponent(teamSlug)}&page_size=500&${fields}`,
  );
  return Array.isArray(data) ? data : data.results ?? [];
}

export function getMatchDetail(creds: VeoCredentials, matchId: string) {
  return apiGet<VeoMatchDetail>(creds, `/matches/${matchId}/`);
}
export async function getEvents(creds: VeoCredentials, matchId: string): Promise<VeoEvent[]> {
  const data = await apiGet<{ events?: VeoEvent[] }>(creds, `/matches/${matchId}/events/`);
  return data.events ?? [];
}
export function getStats(creds: VeoCredentials, matchId: string) {
  return apiGet<Record<string, unknown>>(creds, `/matches/${matchId}/stats/`);
}
export function getPeriods(creds: VeoCredentials, matchId: string) {
  return apiGet<unknown[]>(creds, `/matches/${matchId}/periods/`);
}
export function getRoster(creds: VeoCredentials, matchId: string) {
  return apiGet<Record<string, unknown>>(creds, `/matches/${matchId}/roster/`);
}

// Default credentials from environment secrets.
export function defaultVeoCreds(): VeoCredentials | null {
  const email = process.env.VEO_EMAIL;
  const password = process.env.VEO_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}
