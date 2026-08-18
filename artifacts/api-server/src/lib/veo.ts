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

async function apiPost<T>(creds: VeoCredentials, path: string, body: unknown): Promise<T> {
  const token = await login(creds);
  const res = await fetch(`${APP_BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    tokenCache.delete(creds.email);
    const fresh = await login(creds);
    const retry = await fetch(`${APP_BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fresh}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!retry.ok) throw new Error(`Veo POST ${path} → ${retry.status}`);
    return (await retry.json()) as T;
  }
  if (!res.ok) throw new Error(`Veo POST ${path} → ${res.status}`);
  return (await res.json()) as T;
}

// Fetch an absolute URL against the MES (physical metrics) service.
// Uses the same bearer token. Returns raw Response.
async function mesFetch(creds: VeoCredentials, url: string): Promise<Response> {
  const token = await login(creds);
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (res.status === 401) {
    tokenCache.delete(creds.email);
    const fresh = await login(creds);
    return fetch(url, {
      headers: { authorization: `Bearer ${fresh}`, accept: "application/json" },
    });
  }
  return res;
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

// Fetch an absolute URL (e.g. the RAS analytics service on cloudfront) with the
// same bearer token. Returns the raw Response so callers can inspect status.
export async function veoFetchAbsolute(creds: VeoCredentials, url: string): Promise<Response> {
  const token = await login(creds);
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (res.status === 401) {
    tokenCache.delete(creds.email);
    const fresh = await login(creds);
    return fetch(url, {
      headers: { authorization: `Bearer ${fresh}`, accept: "application/json" },
    });
  }
  return res;
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

// ── RAS (recording analytics service) — passes & possession ─────────────────
// The web UI's "Pass strings" / "Possession location" / "Pass location" panels
// load from a separate CDN-fronted service, NOT /api/app. Host comes from the
// app.veo.co page bootstrap (window.VEO_SERVICE_URLS.RAS_URL); same Bearer
// token works. See .agents/memory/veo-integration.md ("RAS service").
const RAS_BASE = "https://dt3kfuz4eo879.cloudfront.net";

export interface VeoPassDetailPeriod {
  start: number; // video-time seconds (period timeframe start)
  end: number;
  // L/R are PITCH SIDES; map to us/them via the period's own_side (own = "L"
  // when own_side === "left"), exactly like Veo's own client code.
  stats?: {
    PossessionSeconds?: Record<string, number>;
    PassesCompleted?: Record<string, number>;
    PossessionWon?: Record<string, number>;
  };
  passStrings?: Record<string, [number, number][]>; // [stringLength, count]
  passLocations?: Record<string, { x: number; y: number }[]>;
  possessionLocations?: Record<string, { defensive?: number; middle?: number; attacking?: number }>;
  possessionLocationsGrid?: Record<string, { type?: string; values?: number[] }>;
}

// Fine-grained possession-grid slice for the time-scrubbing heat map: each
// period timeframe chopped into 5-minute video-time windows, each carrying the
// 18-zone possession grid keyed by pitch side (L/R, same convention as the
// per-period items — map to us/them via the period's own_side).
export interface VeoHeatWindow {
  start: number; // video-time seconds
  end: number;
  grid?: Record<string, { type?: string; values?: number[] }>;
}

export type VeoPassDetails =
  | { available: true; checkedAt: string; items: VeoPassDetailPeriod[]; heatWindows?: VeoHeatWindow[] }
  // `pending: true` = transient (pipeline still running / temporary error) — the
  // sync backfill re-checks these on every manual sync. `pending: false` is a
  // terminal "this recording will never have match-details" marker.
  | { available: false; pending: boolean; checkedAt: string; status?: Record<string, unknown> };

// RAS pipeline states that will never turn into "completed" on their own.
const RAS_TERMINAL_STATES = new Set(["failed", "unsupported", "disabled", "not-applicable"]);

// Fetch pass/possession analytics for a match. Returns an "unavailable" marker
// (rather than throwing) when the RAS pipeline hasn't produced match-details
// for this recording, so callers can persist the result either way.
export async function getPassDetails(creds: VeoCredentials, matchId: string): Promise<VeoPassDetails> {
  const checkedAt = new Date().toISOString();
  const statusRes = await veoFetchAbsolute(creds, `${RAS_BASE}/recordings/${matchId}/analytics`);
  if (!statusRes.ok) {
    // 404 = RAS has never heard of this recording (no analytics on it); other
    // HTTP failures are transient and must be retried.
    return { available: false, pending: statusRes.status !== 404, checkedAt, status: { httpStatus: statusRes.status } };
  }
  const status = (await statusRes.json()) as Record<string, unknown>;
  const mdState = String(status["match-details"] ?? "");
  if (mdState !== "completed") {
    return { available: false, pending: !RAS_TERMINAL_STATES.has(mdState), checkedAt, status };
  }

  const periods = await apiGet<Array<{ timeframe?: [number, number] }>>(creds, `/matches/${matchId}/periods/`);
  const filters = periods
    .filter((p) => Array.isArray(p.timeframe) && p.timeframe.length === 2)
    .map((p) => `filters=${p.timeframe![0]},${p.timeframe![1]}`)
    .join("&");
  // Periods can appear after processing — keep retrying.
  if (!filters) return { available: false, pending: true, checkedAt, status: { ...status, reason: "no-periods" } };

  const res = await veoFetchAbsolute(creds, `${RAS_BASE}/recordings/${matchId}/match-details?${filters}`);
  if (!res.ok) return { available: false, pending: true, checkedAt, status: { ...status, httpStatus: res.status } };
  const items = (await res.json()) as VeoPassDetailPeriod[];

  // Second pass: 5-minute slices for the time-scrubbing possession heat map.
  // RAS accepts arbitrary filters, so one extra request fetches every slice.
  // Failure here is soft — the coarse per-period data above is still returned,
  // and the sync backfill re-fetches rows missing heatWindows.
  let heatWindows: VeoHeatWindow[] | undefined;
  try {
    const SLICE = 300; // seconds
    const slices: [number, number][] = [];
    for (const p of periods) {
      if (!Array.isArray(p.timeframe) || p.timeframe.length !== 2) continue;
      const [ps, pe] = p.timeframe;
      for (let t = ps; t < pe; t += SLICE) {
        // Merge a short tail (<60s) into the previous slice.
        if (pe - t < 60 && slices.length > 0 && slices[slices.length - 1][1] === t) {
          slices[slices.length - 1][1] = pe;
        } else {
          slices.push([t, Math.min(t + SLICE, pe)]);
        }
      }
    }
    if (slices.length > 0) {
      const sliceQuery = slices.map(([a, b]) => `filters=${a},${b}`).join("&");
      const sliceRes = await veoFetchAbsolute(creds, `${RAS_BASE}/recordings/${matchId}/match-details?${sliceQuery}`);
      if (sliceRes.ok) {
        const sliceItems = (await sliceRes.json()) as VeoPassDetailPeriod[];
        heatWindows = sliceItems.map((it) => ({
          start: it.start,
          end: it.end,
          grid: it.possessionLocationsGrid,
        }));
      }
    }
  } catch {
    heatWindows = undefined;
  }
  return { available: true, checkedAt, items, ...(heatWindows ? { heatWindows } : {}) };
}

// Pull the opponent CLUB out of a Veo recording title. Handles both classic
// "Something vs Club" titles and the coach's naming convention
// "YYYYMMDD-<round>-<squad>-Club" (e.g. 20260222-FR-1sts-Flame → Flame).
// Anything unrecognised falls back to the raw title so nothing goes blank.
// Old recording titles use club abbreviations — map them to the club names the
// rest of the Hub uses so the season legend groups games under one club.
const CLUB_ALIASES: Record<string, string> = {
  TUFC: "Tuggeranong",
  CCFC: "Croatia",
};
export function normalizeVeoClub(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  // Replace standalone alias tokens ("TUFC", "TUFC Res" → "Tuggeranong Res").
  return n.replace(/\b[A-Z]{3,5}\b/g, (tok) => CLUB_ALIASES[tok] ?? tok)
    // "Tuggeranong Res" reads better as just the club.
    .replace(/\s+(Res(erves)?|1sts?|2nds?)$/i, "")
    .trim();
}

export function opponentFromVeoTitle(title: string | null | undefined): string | null {
  const t = (title ?? "").trim();
  if (!t) return null;
  const vs = t.match(/\bvs?\.?\s+(.+)$/i);
  if (vs) return normalizeVeoClub(vs[1]) ?? null;
  if (/^\d{8}-/.test(t)) {
    const segs = t.split("-").map((s) => s.trim()).filter(Boolean);
    // Club = everything after the squad token (1sts/2nds/Reserves…); if no
    // squad token, assume date-round-squad-club and take from segment 4 on.
    const squadIdx = segs.findIndex((s) => /^(1sts?|2nds?|firsts?|seconds?|res(erves)?|u\d+)$/i.test(s));
    const rest = squadIdx >= 0 ? segs.slice(squadIdx + 1) : segs.slice(3);
    if (rest.length > 0) return normalizeVeoClub(rest.join("-"));
    return normalizeVeoClub(segs[segs.length - 1] ?? null);
  }
  return normalizeVeoClub(t);
}

// Raw GET against the Veo app API (for exploratory scripts / future endpoints).
export function veoApiGet<T = unknown>(creds: VeoCredentials, path: string): Promise<T> {
  return apiGet<T>(creds, path);
}

// ── Analytics 2 (camera-derived player data) ─────────────────────────────────
// MES base: physical metrics + player tracking + expanded events.
// IMPORTANT: Analytics 2 is camera-derived — must NEVER touch GPS tables/routes.
const MES_BASE = "https://app.veo.co/api/mes/v2";

// Current bundle version — bump when the set of sources changes so stale rows
// are detected and re-fetched by the backfill pass.
export const ANALYTICS2_SOURCE_VERSION = "1";

// ── Exact response shapes from live Veo API probes (Aug 2026) ─────────────────

// POST /analysis/stats/ → { items: CrossMatchPlayerRow[] }
// Each row is one player/jersey; stats[] items are beta-shaped {type,value,unit}.
export interface CrossMatchStatEntry {
  type: string;
  value: number | null;
  unit: string | null;
}
export interface CrossMatchPlayerRow {
  // Roster identity — live API fields confirmed Aug 2026. No player_name field.
  // known_name is the display name (may be absent for unlinked jerseys).
  player_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  known_name?: string | null;
  jersey_number?: number | null;
  // Stats array — each entry is one metric.
  stats?: CrossMatchStatEntry[];
  // Extra beta fields may appear; preserve them.
  [key: string]: unknown;
}
export interface CrossMatchPlayerResponse {
  items?: CrossMatchPlayerRow[];
  [key: string]: unknown;
}

// GET /mes/v2/{matchId}/physical-metrics → PhysicalMetricRow[]
// (array at top level, not wrapped)
export interface PhysicalMetricRow {
  id?: string | null;
  matchId?: string | null;
  teamId?: string | null;
  // Numeric jersey number in physical metrics (differs from MES events which use string).
  jerseyNumber?: number | null;
  // drill identifies the period/segment (e.g. "1st half", "2nd half", "full match").
  drill?: string | null;
  distance?: number | null;       // metres
  secondsPlayed?: number | null;
  maxSpeed?: number | null;       // km/h
  averageSpeed?: number | null;   // km/h
  maxAccel?: number | null;
  maxDecel?: number | null;
  sprints?: number | null;
  hsr?: number | null;            // high-speed runs
  [key: string]: unknown;
}

// GET /mes/v2/{matchId}/match-events → { events: MesEventRow[] }
// team field can be "Own", "Opponent", "Opp", or any future value — always
// handle defensively. isOwnTeam() normalises all of these.
export interface MesEventRow {
  id?: string | null;
  matchId?: string | null;
  team?: string | null;          // "Own" | "Opponent" | "Opp" | unknown
  eventType?: string | null;
  videoTimeMs?: number | null;
  periodId?: number | null;
  periodTimeMs?: number | null;
  outcome?: string | null;
  x?: number | null;
  z?: number | null;
  attributes?: unknown;
  modifiedAt?: string | null;
  createdAt?: string | null;
  playerJersey?: string | null;  // string in MES events (may be "7", "07", etc.)
  [key: string]: unknown;
}
export interface MesMatchEventsResponse {
  events?: MesEventRow[];
  [key: string]: unknown;
}

// Normalise MES/app team strings to a boolean own-team flag.
// Veo uses "Own" in /matches/{id}/events/ and variations in MES endpoints;
// handle all known variants defensively so future renames don't silently flip.
export function isOwnTeam(team: string | null | undefined): boolean {
  if (!team) return false;
  const t = team.trim().toLowerCase();
  // "Own" is the canonical app-API value; "Opponent"/"Opp" mean opposition.
  // Anything else (empty, unknown future values) is treated as NOT own-team.
  return t === "own";
}

// The bundle stored in veo_analytics2.raw: one key per source.
export interface Analytics2Bundle {
  crossMatchPlayer?: CrossMatchPlayerResponse;
  physicalMetrics?: PhysicalMetricRow[];
  matchEvents?: MesMatchEventsResponse;
  jerseyNumbers?: unknown;
}

// Per-source error details returned from getAnalytics2Bundle.
export interface Analytics2SourceError {
  source: keyof Analytics2Bundle;
  error: string;
  terminal: boolean;
}

// Result of a bundle fetch attempt — always returns what succeeded.
export interface Analytics2FetchResult {
  bundle: Analytics2Bundle;
  sourceErrors: Analytics2SourceError[];
  // partial: at least one source succeeded and at least one failed
  status: "complete" | "partial" | "unavailable" | "error";
}

// Fetch the Analytics 2 bundle for a single match. All sources are tried
// independently; partial results are returned rather than throwing.
// teamId must be the Veo team UUID (not slug), resolved once per sync via
// listTeams. jerseyNumbers requires period timeframes from the match's periods
// endpoint. Never fetches frame-level player-tracking.
export async function getAnalytics2Bundle(
  creds: VeoCredentials,
  matchId: string,
  teamId: string,
): Promise<Analytics2FetchResult> {
  const bundle: Analytics2Bundle = {};
  const sourceErrors: Analytics2SourceError[] = [];

  // 1. Cross-match player summary: POST /analysis/stats/
  //    Returns { items: CrossMatchPlayerRow[] } — one row per detected player/jersey.
  try {
    const crossResult = await apiPost<CrossMatchPlayerResponse>(creds, "/analysis/stats/", {
      type: "cross_match",
      team_id: teamId,
      match_ids: [matchId],
      group_by: "player",
    });
    bundle.crossMatchPlayer = crossResult;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    sourceErrors.push({ source: "crossMatchPlayer", error, terminal: /\b404\b/.test(error) });
    logger.warn({ err: e, matchId }, "veo analytics2: crossMatchPlayer fetch failed");
  }

  // 2. Physical metrics: GET /mes/v2/{matchId}/physical-metrics
  //    Returns a top-level array (not wrapped): PhysicalMetricRow[].
  //    Keys: id,matchId,teamId,jerseyNumber(number),drill,distance,secondsPlayed,
  //          maxSpeed,averageSpeed,maxAccel,maxDecel,sprints,hsr.
  try {
    const physRes = await mesFetch(creds, `${MES_BASE}/${matchId}/physical-metrics`);
    if (physRes.ok) {
      const raw = await physRes.json();
      // Normalise: accept both top-level array and a wrapped shape for resilience.
      bundle.physicalMetrics = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];
    } else if (physRes.status === 404) {
      // 404 is terminal for this match — not retryable
      sourceErrors.push({ source: "physicalMetrics", error: `HTTP 404`, terminal: true });
    } else {
      throw new Error(`HTTP ${physRes.status}`);
    }
  } catch (e) {
    sourceErrors.push({ source: "physicalMetrics", error: e instanceof Error ? e.message : String(e), terminal: false });
    logger.warn({ err: e, matchId }, "veo analytics2: physicalMetrics fetch failed");
  }

  // 3. Expanded match events: GET /mes/v2/{matchId}/match-events
  //    Returns { events: MesEventRow[] }.
  //    Keys: id,matchId,team,eventType,videoTimeMs,periodId,periodTimeMs,
  //          outcome,x,z,attributes,modifiedAt,createdAt,playerJersey(string).
  //    team = "Own" | "Opponent" — use isOwnTeam() to normalise.
  try {
    const evtRes = await mesFetch(creds, `${MES_BASE}/${matchId}/match-events`);
    if (evtRes.ok) {
      bundle.matchEvents = (await evtRes.json()) as MesMatchEventsResponse;
    } else if (evtRes.status === 404) {
      sourceErrors.push({ source: "matchEvents", error: `HTTP 404`, terminal: true });
    } else {
      throw new Error(`HTTP ${evtRes.status}`);
    }
  } catch (e) {
    sourceErrors.push({ source: "matchEvents", error: e instanceof Error ? e.message : String(e), terminal: false });
    logger.warn({ err: e, matchId }, "veo analytics2: matchEvents fetch failed");
  }

  // 4. Jersey numbers by period: GET /mes/v2/{matchId}/player-tracking/jersey-numbers
  //    Requires period timeframe pairs (start,end seconds) from /matches/{matchId}/periods/.
  //    Never fetches frame-level tracking (/player-tracking?start=...).
  //
  //    If the periods endpoint returns no valid timeframes yet (recording not fully
  //    processed), this counts as a pending error so the row stays in a retryable
  //    state — we never mark the bundle complete without at least attempting jersey
  //    numbers when periods are expected to exist.
  try {
    const periods = await apiGet<Array<{ timeframe?: [number, number] }>>(creds, `/matches/${matchId}/periods/`);
    const validPeriods = periods.filter((p) => Array.isArray(p.timeframe) && p.timeframe.length === 2);
    if (validPeriods.length > 0) {
      // Each period becomes a repeated `periods=start,end` param.
      const periodsParam = validPeriods.map((p) => `periods=${p.timeframe![0]},${p.timeframe![1]}`).join("&");
      const jnRes = await mesFetch(
        creds,
        `${MES_BASE}/${matchId}/player-tracking/jersey-numbers?${periodsParam}`,
      );
      if (jnRes.ok) {
        bundle.jerseyNumbers = await jnRes.json();
      } else if (jnRes.status === 404) {
        // 404 from jersey-numbers is terminal for this source (camera tracking
        // not available for this match), but other sources may have succeeded.
        sourceErrors.push({ source: "jerseyNumbers", error: `HTTP 404`, terminal: true });
      } else {
        throw new Error(`HTTP ${jnRes.status}`);
      }
    } else if (Array.isArray(periods) && periods.length > 0) {
      // Periods exist but none have valid timeframes yet → recording still
      // processing. Record a transient error so this row stays partial/error
      // and is retried next sync rather than silently becoming "complete".
      sourceErrors.push({ source: "jerseyNumbers", error: "periods exist but no valid timeframes yet", terminal: false });
      logger.debug({ matchId }, "veo analytics2: periods missing timeframes; will retry");
    } else {
      // No periods means this recording has no usable timeframe for shirt
      // tracking. Other player sources can still make the bundle useful.
      sourceErrors.push({ source: "jerseyNumbers", error: "no periods available", terminal: true });
    }
  } catch (e) {
    sourceErrors.push({ source: "jerseyNumbers", error: e instanceof Error ? e.message : String(e), terminal: false });
    logger.warn({ err: e, matchId }, "veo analytics2: jerseyNumbers fetch failed");
  }

  const successCount = [bundle.crossMatchPlayer, bundle.physicalMetrics, bundle.matchEvents, bundle.jerseyNumbers]
    .filter((v) => v !== undefined).length;
  const errorCount = sourceErrors.length;

  let status: Analytics2FetchResult["status"];
  if (successCount === 0) {
    // All sources failed: terminal only if every failure was a 404 (content
    // genuinely absent), otherwise transient error (should retry).
    status = errorCount > 0 && sourceErrors.every((e) => e.terminal)
      ? "unavailable"
      : "error";
  } else if (errorCount > 0) {
    // At least one source succeeded and at least one failed → partial.
    // The 404s here are source-level (e.g. jersey tracking unavailable) but
    // other sources have data, so this is NOT terminal.
    status = "partial";
  } else {
    status = "complete";
  }

  return { bundle, sourceErrors, status };
}

// Default credentials from environment secrets.
export function defaultVeoCreds(): VeoCredentials | null {
  const email = process.env.VEO_EMAIL;
  const password = process.env.VEO_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}
