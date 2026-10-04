import type { GpsDevelopmentProfile, GpsDevelopmentMetricSummary, GpsDevelopmentMetric } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const fmtVal = (v: number | null | undefined, m: GpsDevelopmentMetric) =>
  v == null ? "Insufficient data" : `${v.toFixed(m.decimals)} ${m.unit}${m.id === "speed" ? ` (${(v / 3.6).toFixed(1)} m/s)` : ""}`;
export const fmtDate = (s: string | null) => {
  if (!s) return "Date not recorded";
  const p = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const d = p ? new Date(Number(p[3]), Number(p[2]) - 1, Number(p[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? "Date not recorded" : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
};
const find = (l: GpsDevelopmentMetricSummary[] | undefined, id: string) => l?.find(m => m.id === id);
const MISSING = <span className="text-muted-foreground italic">Insufficient data</span>;

function delta(cur: number | null | undefined, ref: number | null | undefined, m: GpsDevelopmentMetric) {
  if (cur == null || ref == null) return null;
  const d = cur - ref;
  return `${d >= 0 ? "+" : ""}${d.toFixed(m.decimals)} ${m.unit}`;
}

export function orderedMetrics(p: GpsDevelopmentProfile) {
  return [...p.metrics].sort((a, b) => Number(b.primary) - Number(a.primary));
}

export function SeasonComparison({ profile }: { profile: GpsDevelopmentProfile }) {
  const [peerSquad, setPeerSquad] = useState(profile.squad);
  const metrics = orderedMetrics(profile);
  const season = profile.seasons.find(s => s.year === profile.year);
  const prior = profile.seasons.filter(s => s.year < profile.year).sort((a, b) => b.year.localeCompare(a.year))[0];
  const peer = profile.peers.find(p => p.squad === peerSquad && p.role === profile.role);
  return (
    <Card data-testid="card-season-comparison">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Season comparison</CardTitle>
        <p className="text-xs text-muted-foreground">
          Recorded output, not a fitness or selection grade. {season?.appearances ?? 0} appearance(s), {season?.qualifying ?? 0} qualifying in {profile.year}.
          {prior ? ` Prior season: ${prior.year}.` : " No prior season on record."}
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {profile.peers.length > 0 && <div className="mb-3 max-w-xs">
          <label className="text-xs text-muted-foreground block mb-1">Same-role comparison squad</label>
          <Select value={peerSquad} onValueChange={setPeerSquad}>
            <SelectTrigger data-testid="select-dev-peer-squad"><SelectValue placeholder="Choose comparison squad" /></SelectTrigger>
            <SelectContent>{profile.peers.map(p => <SelectItem key={p.squad} value={p.squad}>{p.squad} — {p.role} ({p.players} players)</SelectItem>)}</SelectContent>
          </Select>
        </div>}
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="py-2 pr-3 font-medium">Metric</th>
              <th className="py-2 pr-3 font-medium">{profile.year} qualifying avg</th>
              <th className="py-2 pr-3 font-medium">Best valid comparable</th>
              <th className="py-2 pr-3 font-medium">{prior ? `${prior.year} avg` : "Prior"}</th>
              <th className="py-2 pr-3 font-medium">Change vs prior</th>
              <th className="py-2 pr-3 font-medium">History qualifying avg</th>
              <th className="py-2 pr-3 font-medium">History recorded high</th>
              <th className="py-2 font-medium">Observed same-role peers</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => {
              const c = find(season?.metrics, m.id);
              const pr = find(prior?.metrics, m.id);
              const d = delta(c?.average, pr?.average, m);
              return (
                <tr key={m.id} className="border-b last:border-0 align-top" data-testid={`row-metric-${m.id}`}>
                  <td className="py-2 pr-3 font-medium">{m.title}{m.primary && <Badge variant="secondary" className="ml-2 text-[10px]">Primary</Badge>}</td>
                  <td className="py-2 pr-3 tabular-nums">{c?.average == null ? MISSING : <>{fmtVal(c.average, m)} <span className="text-xs text-muted-foreground">n={c.sample}</span></>}</td>
                  <td className="py-2 pr-3 tabular-nums">{c?.best == null ? MISSING : fmtVal(c.best, m)}</td>
                  <td className="py-2 pr-3 tabular-nums">{pr?.average == null ? MISSING : fmtVal(pr.average, m)}</td>
                  <td className="py-2 pr-3 tabular-nums">{d ?? <span className="text-muted-foreground">n/a</span>}</td>
                  <td className="py-2 pr-3 tabular-nums">{fmtVal(find(profile.history, m.id)?.average, m) === "Insufficient data" ? MISSING : fmtVal(find(profile.history, m.id)?.average, m)}</td>
                  <td className="py-2 pr-3 tabular-nums">{fmtVal(find(profile.history, m.id)?.best, m)}</td>
                  <td className="py-2 tabular-nums">{find(peer?.metrics, m.id)?.average == null ? MISSING : fmtVal(find(peer?.metrics, m.id)?.average, m)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground mt-3">
          Observed cohort averages are not approved First Grade standards.{" "}
          {peer
            ? `Peers: ${profile.role} in ${peer.squad}, ${peer.players} player(s), ${peer.playerGames} player-games, ${peer.inferredRoles} inferred role(s).`
            : "No same-role peer group available for this player's squad."}
        </p>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">All retained seasons</summary>
          <table className="w-full min-w-[650px] text-xs mt-2">
            <thead><tr><th className="text-left py-2">Season / qualifying apps</th>{metrics.filter(m => m.primary).map(m => <th key={m.id} className="text-left px-2">{m.title}</th>)}</tr></thead>
            <tbody>{profile.seasons.map(s => <tr key={s.year} className="border-t"><td className="py-2">{s.year}: {s.qualifying}/{s.appearances}</td>{metrics.filter(m => m.primary).map(m => <td key={m.id} className="px-2">{fmtVal(find(s.metrics, m.id)?.average, m)}</td>)}</tr>)}</tbody>
          </table>
        </details>
      </CardContent>
    </Card>
  );
}

export function GrefPanel({ profile }: { profile: GpsDevelopmentProfile }) {
  const [scope, setScope] = useState("season");
  const metrics = orderedMetrics(profile);
  const season = profile.seasons.find(s => s.year === profile.year);
  return (
    <Card data-testid="card-gref">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Gref reference and contributing matches</CardTitle>
        <p className="text-xs text-muted-foreground">Built only from qualifying matches. Readiness labels stay inactive until the club approves its reference.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="max-w-xs" data-testid="select-gref-scope"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="season">{profile.year} Gref</SelectItem><SelectItem value="history">Comparable retained-history Gref</SelectItem></SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Under 3 valid qualifying values: insufficient. 3–4: mean of the best 3 (provisional). 5 or more: mean of the best 5 (established). Each metric selects its own matches; 100% is not a ceiling or a grade.</p>
        {metrics.map(m => {
          const g = find(scope === "history" ? profile.history : season?.metrics, m.id)?.gref;
          return (
            <details key={m.id} className="rounded-md border px-3 py-2" data-testid={`gref-${m.id}`}>
              <summary className="cursor-pointer flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{m.title}</span>
                <Badge variant="outline" className="text-[10px]">{g?.status ?? "insufficient"}</Badge>
                <span className="tabular-nums text-muted-foreground">{g?.value == null ? "Insufficient data" : fmtVal(g.value, m)}</span>
                <span className="text-xs text-muted-foreground">sample {g?.sample ?? 0}</span>
              </summary>
              <ul className="mt-2 text-xs space-y-1">
                {g?.matches.length ? g.matches.map(x => (
                  <li key={x.key} className="flex justify-between gap-3"><span>{x.round} ({x.year}) {fmtDate(x.date)}</span><span className="tabular-nums">{x.value.toFixed(m.decimals)} {m.unit}</span></li>
                )) : <li className="text-muted-foreground">No contributing matches.</li>}
              </ul>
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function LatestMatch({ profile }: { profile: GpsDevelopmentProfile }) {
  const games = profile.games.filter(g => g.year === profile.year);
  const latest = games[games.length - 1];
  const metrics = orderedMetrics(profile);
  const gref = profile.seasons.find(s => s.year === profile.year);
  if (!latest) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground" data-testid="text-no-latest">No match recorded for {profile.year}.</CardContent></Card>;
  }
  return (
    <Card data-testid="card-latest-match">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Latest match: {latest.round}{latest.opponent ? ` v ${latest.opponent}` : ""}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {fmtDate(latest.date)} | {latest.mins == null ? "minutes not recorded" : `${latest.mins} min`} | role {latest.role ?? "unknown"} ({latest.roleSource}) | {latest.matchType} | {latest.qualifies ? "qualifies for Gref" : "does not qualify for Gref"}
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map(m => {
          const v = latest.values[m.id];
          const g = find(gref?.metrics, m.id)?.gref;
          const pct = latest.qualifies && v != null && g?.value ? `${((v / g.value) * 100).toFixed(0)}% of Gref` : latest.qualifies ? "Gref insufficient" : "Not a qualifying match";
          return (
            <div key={m.id} className="rounded-md bg-muted/50 p-3 min-w-0">
              <div className="text-xs text-muted-foreground truncate">{m.title}</div>
              <div className="font-semibold tabular-nums">{v == null ? "Not recorded" : fmtVal(v, m)}</div>
              <div className="text-[11px] text-muted-foreground">{pct}</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function ExternalPanel({ profile }: { profile: GpsDevelopmentProfile }) {
  return (
    <Card data-testid="card-external">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">External references</CardTitle>
        <p className="text-xs text-muted-foreground">Adult male context only. Not targets, and not grades for this player.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {profile.external.length === 0 ? <p className="text-sm text-muted-foreground">No external references apply to this player.</p> :
          profile.external.map(e => (
            <div key={e.id} className="rounded-md border p-3 text-xs space-y-0.5">
              <div className="font-medium text-sm">{e.metric}: {e.value} <span className="text-muted-foreground font-normal">({e.threshold})</span></div>
              <div>{e.population} | {e.role} | {e.device}</div>
              <div className="text-muted-foreground">{e.comparability}. {e.sampleNote} {e.confidenceNote}</div>
              <a className="underline break-all" href={e.url} target="_blank" rel="noreferrer">{e.source} ({e.publicationYear})</a>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
