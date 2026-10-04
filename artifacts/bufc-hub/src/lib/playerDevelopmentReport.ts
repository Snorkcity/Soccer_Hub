import type { GpsDevelopmentProfile, GpsDevelopmentMetricSummary, GpsDevelopmentMetric } from "@workspace/api-client-react";

export interface DevReportFeedback {
  note: string;
  focus: string;
  reviewDate: string | null;
  createdAt: string;
  year: string;
}

const NAVY = "0F2C43", SKY = "87CEEB", INK = "E8F2FA", GREY = "A1B8CA", TINT = "203A51";
const W = 13.33, H = 7.5;

const num = (v: number | null | undefined, d: number) => (v == null ? "Insufficient data" : v.toFixed(d));
const dt = (s: string | null) => {
  if (!s) return "not recorded";
  const p = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const d = p ? new Date(Number(p[3]), Number(p[2]) - 1, Number(p[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? "not recorded" : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
};

function metricsOrdered(p: GpsDevelopmentProfile): GpsDevelopmentMetric[] {
  return [...p.metrics].sort((a, b) => Number(b.primary) - Number(a.primary));
}
const find = (list: GpsDevelopmentMetricSummary[] | undefined, id: string) => list?.find(m => m.id === id);

export async function generatePlayerDevelopmentReport(
  profile: GpsDevelopmentProfile,
  feedback: DevReportFeedback | null,
  output: "download" | "base64" = "download",
): Promise<{ fileName: string; base64?: string }> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  pptx.title = `${profile.playerName} - Player development`;

  const metrics = metricsOrdered(profile);
  const season = profile.seasons.find(s => s.year === profile.year);
  const prior = profile.seasons.filter(s => s.year < profile.year).sort((a, b) => b.year.localeCompare(a.year))[0];
  const peer = profile.peers.find(p => p.squad === profile.squad && p.role === profile.role);

  const title = (s: ReturnType<typeof pptx.addSlide>, t: string) => {
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: W, h: 0.9, fill: { color: NAVY } });
    s.addText(t, { x: 0.5, y: 0.1, w: 12, h: 0.7, fontSize: 22, bold: true, color: "FFFFFF" });
  };
  const foot = (s: ReturnType<typeof pptx.addSlide>) =>
    s.addText("Recorded GPS output for development conversations. Not a fitness, selection or physical readiness grade.", {
      x: 0.5, y: 7.05, w: 12.3, h: 0.3, fontSize: 9, italic: true, color: GREY,
    });

  // Cover
  {
    const s = pptx.addSlide();
    s.background = { color: NAVY };
    s.addShape("rect", { x: 0, y: 0, w: 0.22, h: H, fill: { color: SKY } });
    s.addText("PLAYER DEVELOPMENT", { x: 0.9, y: 1.7, w: 11, h: 0.5, fontSize: 18, bold: true, color: SKY, charSpacing: 6 });
    s.addText(profile.playerName, { x: 0.9, y: 2.3, w: 11.5, h: 1.2, fontSize: 48, bold: true, color: "FFFFFF" });
    s.addText([profile.role ?? "Role not recorded", profile.squad, profile.year].join("  |  "), { x: 0.9, y: 3.6, w: 11, h: 0.5, fontSize: 18, color: "C9E4F2" });
    s.addText(`Generated ${dt(new Date().toISOString())}  |  Methodology ${profile.methodologyVersion}`, { x: 0.9, y: 4.2, w: 11, h: 0.4, fontSize: 12, color: "8FB3C7" });
  }

  // Feedback
  if (feedback) {
    const s = pptx.addSlide();
    title(s, "Coach feedback");
    s.addText(`Written ${dt(feedback.createdAt)}  |  Season ${feedback.year}  |  Review ${feedback.reviewDate ? dt(feedback.reviewDate) : "not set"}`, { x: 0.5, y: 1.1, w: 12.3, h: 0.35, fontSize: 12, color: GREY });
    s.addText("Development focus", { x: 0.5, y: 1.6, w: 12.3, h: 0.35, fontSize: 13, bold: true, color: SKY });
    s.addText(feedback.focus || "None recorded", { x: 0.5, y: 1.95, w: 12.3, h: 1.2, fontSize: 15, color: INK, valign: "top", fit: "shrink" });
    s.addText("Note", { x: 0.5, y: 3.3, w: 12.3, h: 0.35, fontSize: 13, bold: true, color: SKY });
    s.addText(feedback.note || "None recorded", { x: 0.5, y: 3.65, w: 12.3, h: 3.2, fontSize: 14, color: INK, valign: "top", fit: "shrink" });
    foot(s);
  }

  // Season evidence
  {
    const s = pptx.addSlide();
    title(s, `${profile.year} evidence`);
    const head = ["Metric", "Qualifying average", "Best (valid, comparable)", "Prior season", "History", "Role peers"].map(t => ({
      text: t, options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 11 },
    }));
    const rows = metrics.map(m => {
      const c = find(season?.metrics, m.id);
      const f = (x?: GpsDevelopmentMetricSummary) => (x?.average == null ? "Insufficient data" : `${x.average.toFixed(m.decimals)} ${m.unit}`);
      return [
        { text: m.title + (m.primary ? " *" : ""), options: { bold: true } },
        { text: f(c) + (c ? ` (n=${c.sample})` : "") },
        { text: c?.best == null ? "Insufficient data" : `${c.best.toFixed(m.decimals)} ${m.unit}` },
        { text: f(find(prior?.metrics, m.id)) },
        { text: f(find(profile.history, m.id)) },
        { text: f(find(peer?.metrics, m.id)) },
      ].map(c2 => ({ ...c2, options: { fontSize: 10, color: INK, fill: { color: TINT }, ...(c2 as { options?: object }).options } }));
    });
    s.addTable([head, ...rows], { x: 0.4, y: 1.1, w: 12.5, colW: [2.6, 2.3, 2.3, 1.9, 1.7, 1.7], border: { type: "solid", color: "D5E3EC", pt: 0.5 }, rowH: 0.34 });
    s.addText(`${season?.appearances ?? 0} appearance(s), ${season?.qualifying ?? 0} qualifying. * primary metric for role. Peers: ${peer ? `${peer.players} player(s), ${peer.playerGames} player-games, ${peer.inferredRoles} inferred role(s)` : "no same-role peer data"}.`, { x: 0.5, y: 6.6, w: 12.3, h: 0.4, fontSize: 10, color: GREY });
    foot(s);
  }

  // Gref contributing matches
  {
    const s = pptx.addSlide();
    title(s, "Gref stage and contributing matches");
    const head = ["Metric", "Stage", "Gref", "Sample", "Contributing matches"].map(t => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 11 } }));
    const rows = metrics.map(m => {
      const c = find(season?.metrics, m.id);
      const g = c?.gref;
      return [
        m.title,
        g?.status ?? "insufficient",
        g?.value == null ? "Insufficient data" : `${g.value.toFixed(m.decimals)} ${m.unit}`,
        String(g?.sample ?? 0),
        g?.matches.length ? g.matches.map(x => `${x.round} ${x.year} (${x.value.toFixed(m.decimals)})`).join(", ") : "None",
      ].map(t => ({ text: t, options: { fontSize: 9, color: INK, fill: { color: TINT } } }));
    });
    s.addTable([head, ...rows], { x: 0.4, y: 1.1, w: 12.5, colW: [2.2, 1.3, 1.8, 0.9, 6.3], border: { type: "solid", color: "D5E3EC", pt: 0.5 } });
    foot(s);
  }

  // Retained history remains distinct from this year's reference.
  {
    const s = pptx.addSlide();
    title(s, "Retained-history references");
    const head = ["Metric", "Qualifying average", "Recorded high", "History Gref", "Stage / valid sample"].map(text => ({ text, options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 10 } }));
    const rows = metrics.map(m => {
      const r = find(profile.history, m.id);
      const f = (v: number | null | undefined) => v == null ? "Insufficient data" : `${v.toFixed(m.decimals)} ${m.unit}`;
      return [m.title, f(r?.average), f(r?.best), f(r?.gref.value), `${r?.gref.status ?? "insufficient"} / ${r?.sample ?? 0}`]
        .map(text => ({ text, options: { fontSize: 10, color: INK, fill: { color: TINT } } }));
    });
    s.addTable([head, ...rows], { x: 0.4, y: 1.1, w: 12.5, border: { type: "solid", color: "D5E3EC", pt: 0.5 } });
    s.addText(profile.seasons.map(s => `${s.year}: ${s.qualifying}/${s.appearances} qualifying appearances`).join("  |  "), { x: 0.5, y: 6.5, w: 12, h: 0.45, fontSize: 10, color: GREY });
    foot(s);
  }

  const latest = profile.games.filter(g => g.year === profile.year).at(-1);
  if (latest) {
    const s = pptx.addSlide();
    title(s, `Latest match — ${latest.round}${latest.opponent ? ` v ${latest.opponent}` : ""}`);
    s.addText(`${dt(latest.date)} | ${latest.mins ?? "unknown"} minutes | ${latest.role ?? "unknown"} (${latest.roleSource}) | ${latest.qualifies ? "qualifying appearance" : "not qualifying"}`, { x: 0.5, y: 1.05, w: 12, h: 0.5, fontSize: 12, color: GREY });
    const rows = metrics.map(m => {
      const value = latest.values[m.id];
      const ref = find(season?.metrics, m.id)?.gref;
      const text = value == null ? "Not recorded" : `${value.toFixed(m.decimals)} ${m.unit}${m.id === "speed" ? ` (${(value / 3.6).toFixed(1)} m/s)` : ""}`;
      const pct = latest.qualifies && value != null && ref?.value ? `${(value / ref.value * 100).toFixed(0)}%` : "Not available";
      return [m.title, text, pct].map(text => ({ text, options: { fontSize: 11, color: INK, fill: { color: TINT } } }));
    });
    s.addTable([[{ text: "Metric" }, { text: "Recorded output" }, { text: "% of season Gref (not a grade)" }], ...rows],
      { x: 0.5, y: 1.7, w: 12.2, color: INK, fill: { color: TINT }, border: { type: "solid", color: "34506B", pt: 0.5 } });
    foot(s);
  }

  // Games
  {
    const s = pptx.addSlide();
    title(s, "Match history and qualification");
    const head = ["Year", "Round", "Date", "Mins", "Role", "Type", "Comparable", "Qualifies"].map(t => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 10 } }));
    const rows = profile.games.slice(-14).reverse().map(g => [
      g.year, g.round, dt(g.date), g.mins == null ? "n/a" : String(g.mins), g.role ?? "unknown", g.matchType, g.comparable ? "yes" : "no", g.qualifies ? "yes" : "no",
    ].map(t => ({ text: t, options: { fontSize: 9, color: INK, fill: { color: TINT } } })));
    s.addTable([head, ...rows], { x: 0.4, y: 1.1, w: 12.5, border: { type: "solid", color: "D5E3EC", pt: 0.5 } });
    s.addText(`Showing latest ${Math.min(14, profile.games.length)} of ${profile.games.length} game(s).`, { x: 0.5, y: 6.7, w: 12, h: 0.3, fontSize: 10, color: GREY });
    foot(s);
  }

  // Summary & external
  {
    const s = pptx.addSlide();
    title(s, "Summary, warnings and context");
    const lines = [
      ...profile.summary.map(t => ({ text: t, options: { bullet: true, fontSize: 12, color: INK, breakLine: true } })),
      ...profile.warnings.map(t => ({ text: `Warning: ${t}`, options: { bullet: true, fontSize: 12, color: "F6BD74", breakLine: true } })),
    ];
    s.addText(lines.length ? lines : [{ text: "No summary or warnings recorded.", options: { fontSize: 12, color: GREY } }], { x: 0.5, y: 1.1, w: 12.3, h: 3.2, valign: "top", fit: "shrink" });
    s.addShape("rect", { x: 0.5, y: 4.4, w: 12.3, h: 2.5, fill: { color: TINT } });
    const ext = profile.external.length
      ? profile.external.slice(0, 6).map(e => ({ text: `${e.source} (${e.publicationYear}): ${e.metric} ${e.value} - ${e.population}, ${e.role}. ${e.comparability}`, options: { fontSize: 9, color: INK, breakLine: true } }))
      : [{ text: "No external references for this player.", options: { fontSize: 10, color: GREY } }];
    s.addText([{ text: "External references (adult male context only; not targets or grades)", options: { bold: true, fontSize: 11, color: SKY, breakLine: true } }, ...ext], { x: 0.7, y: 4.5, w: 11.9, h: 2.3, valign: "top", fit: "shrink" });
    foot(s);
  }

  const safe = profile.playerName.replace(/[^a-z0-9]+/gi, "_");
  const fileName = `${safe}_Development_${feedback ? `feedback_${feedback.createdAt.slice(0, 10)}` : profile.year}.pptx`;
  if (output === "base64") {
    const base64 = (await pptx.write({ outputType: "base64" })) as string;
    return { fileName, base64 };
  }
  await pptx.writeFile({ fileName });
  return { fileName };
}

export { num as _fmtNum };
