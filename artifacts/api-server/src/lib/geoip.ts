import { db, ipGeoTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";

// Resolve IPs to a rough "city" label via ipwho.is (free, HTTPS), cached
// per-IP in the ip_geo table so a page view never triggers repeat lookups.
// Failures degrade to null (the UI falls back to showing the IP).
// Set GEOIP_DISABLED=1 to skip external lookups entirely.

const RETRY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000; // re-try unknown IPs daily
const LOOKUP_TIMEOUT_MS = 4000;
const MAX_LOOKUPS_PER_REQUEST = 25; // cap external calls per page view; the rest resolve next time

function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  const v4 = ip.replace(/^::ffff:/, "");
  return (
    v4 === "127.0.0.1" || ip === "::1" ||
    /^10\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
    /^169\.254\./.test(v4) ||
    /^f[cd]/i.test(ip) || // IPv6 unique-local
    ip === "unknown"
  );
}

interface IpWhoIsRow {
  success: boolean;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
}

function labelFor(r: IpWhoIsRow): string | null {
  if (!r.success) return null;
  const place = r.city || r.region || r.country || null;
  if (!place) return null;
  // Home audience is Australian — a bare city reads best; add the country
  // code for anything overseas so "Wellington, NZ" isn't mistaken for NSW.
  if (r.country_code && r.country_code !== "AU" && place !== r.country) {
    return `${place}, ${r.country_code}`;
  }
  return place;
}

async function fetchLabel(ip: string): Promise<string | null> {
  const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,region,country,country_code`, {
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ipwho.is responded ${res.status}`);
  return labelFor((await res.json()) as IpWhoIsRow);
}

/** Map of ip → label ("Canberra") or null when unknown. Cached per IP. */
export async function lookupIpLocations(ips: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const unique = [...new Set(ips.filter(Boolean))];
  const publicIps: string[] = [];
  for (const ip of unique) {
    if (isPrivateIp(ip)) result.set(ip, null);
    else publicIps.push(ip);
  }
  if (publicIps.length === 0) return result;

  const cached = await db.select().from(ipGeoTable).where(inArray(ipGeoTable.ip, publicIps));
  const cachedByIp = new Map(cached.map((c) => [c.ip, c]));
  let toFetch: string[] = [];
  for (const ip of publicIps) {
    const c = cachedByIp.get(ip);
    if (c && (c.label !== null || Date.now() - c.lookedUpAt.getTime() < RETRY_FAILED_AFTER_MS)) {
      result.set(ip, c.label);
    } else {
      toFetch.push(ip);
    }
  }
  if (process.env.GEOIP_DISABLED === "1") {
    for (const ip of toFetch) result.set(ip, null);
    return result;
  }
  toFetch = toFetch.slice(0, MAX_LOOKUPS_PER_REQUEST);

  let failures = 0;
  for (const ip of toFetch) {
    if (failures >= 3) { result.set(ip, null); continue; } // provider looks down — stop hammering it
    try {
      const label = await fetchLabel(ip);
      result.set(ip, label);
      await db.insert(ipGeoTable)
        .values({ ip, label, lookedUpAt: new Date() })
        .onConflictDoUpdate({ target: ipGeoTable.ip, set: { label, lookedUpAt: new Date() } });
    } catch (err) {
      // Network hiccup / rate limit: don't cache, just fall back to the IP.
      failures++;
      logger.warn({ err, ip }, "GeoIP lookup failed — showing raw IP");
      result.set(ip, null);
    }
  }
  return result;
}
