import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, matchReportsTable, gpsCoachEmailsTable } from "@workspace/db";
import { CreateMatchReportBody, SaveMatchReportCoachEmailsBody, SendMatchReportEmailBody } from "@workspace/api-zod";
import { getSessionUser, effectiveRole, mayTouchLeagueRow } from "../middlewares/entryAuth";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type Row = typeof matchReportsTable.$inferSelect;

function reportJson(r: Row) {
  return {
    id: r.id,
    leagueId: r.leagueId,
    title: r.title,
    round: r.round,
    opponent: r.opponent,
    matchDate: r.matchDate,
    data: r.data ?? {},
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// League-private: reports belong to ONE league; the list requires a leagueId
// (the central middleware verifies the caller's access to it).
router.get("/match-reports", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isInteger(leagueId) || leagueId <= 0)
    return res.status(400).json({ error: "leagueId is required" });
  const rows = await db
    .select()
    .from(matchReportsTable)
    .where(eq(matchReportsTable.leagueId, leagueId))
    .orderBy(desc(matchReportsTable.updatedAt), desc(matchReportsTable.id));
  return res.json(rows.map(reportJson));
});

/** Football report writes ride on the Data Entry module (same module that owns
 * football results/goals writes) — module-scoped like the GPS report routes. */
async function mayWriteLeague(req: Request, leagueId: number): Promise<boolean> {
  return mayTouchLeagueRow(req, leagueId, "data-entry");
}

router.post("/match-reports", async (req, res) => {
  const parsed = CreateMatchReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { leagueId, title, round, opponent, matchDate, data } = parsed.data;
  if (!(await mayWriteLeague(req, leagueId)))
    return res.status(403).json({ error: "No access to this league's match reports" });
  const [row] = await db
    .insert(matchReportsTable)
    .values({ leagueId, title, round: round ?? null, opponent: opponent ?? null, matchDate: matchDate ?? null, data })
    .returning();
  return res.json(reportJson(row));
});

/** Loads a report and checks the caller may touch its league; null → response already sent. */
async function loadGuarded(req: Request, res: Response, id: number): Promise<Row | null> {
  const [row] = await db.select().from(matchReportsTable).where(eq(matchReportsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Report not found" });
    return null;
  }
  if (!(await mayWriteLeague(req, row.leagueId))) {
    res.status(403).json({ error: "No access to this league's match reports" });
    return null;
  }
  return row;
}

router.delete("/match-reports/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  if (!(await loadGuarded(req, res, id))) return;
  const deleted = await db
    .delete(matchReportsTable)
    .where(eq(matchReportsTable.id, id))
    .returning({ id: matchReportsTable.id });
  return res.json({ deleted: deleted.length > 0 });
});

// ── Football coach email list + send ─────────────────────────────────────────
// Shares the gps_coach_emails table (squad bucket "Football") but lives under
// its own prefixes, gated on Data Entry — a club without the GPS module can
// still email its football match report.

const FOOTBALL_SQUAD = "Football";

async function requireAdmin(req: Request): Promise<boolean> {
  const user = await getSessionUser(req);
  return !!user && effectiveRole(user) === "admin";
}

router.get("/match-report-coach-emails", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isInteger(leagueId) || leagueId <= 0)
    return res.status(400).json({ error: "leagueId is required" });
  const rows = await db
    .select()
    .from(gpsCoachEmailsTable)
    .where(and(eq(gpsCoachEmailsTable.leagueId, leagueId), eq(gpsCoachEmailsTable.squad, FOOTBALL_SQUAD)))
    .orderBy(gpsCoachEmailsTable.id);
  return res.json(rows);
});

/** Replace the football coach list for one league. Admin-only: this list
 * decides who receives future report emails, and the send endpoint itself is
 * admin-gated — the two must match. */
router.put("/match-report-coach-emails", async (req, res) => {
  if (!(await requireAdmin(req))) return res.status(403).json({ error: "Admins only" });
  const parsed = SaveMatchReportCoachEmailsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { leagueId, coaches } = parsed.data;
  if (!(await mayWriteLeague(req, leagueId)))
    return res.status(403).json({ error: "No access to this league's coach list" });
  const cleaned = coaches
    .map(c => ({ name: c.name?.trim() || null, email: c.email.trim() }))
    .filter(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email));
  await db.transaction(async tx => {
    await tx
      .delete(gpsCoachEmailsTable)
      .where(and(eq(gpsCoachEmailsTable.leagueId, leagueId), eq(gpsCoachEmailsTable.squad, FOOTBALL_SQUAD)));
    if (cleaned.length) {
      await tx.insert(gpsCoachEmailsTable).values(cleaned.map(c => ({ leagueId, squad: FOOTBALL_SQUAD, name: c.name, email: c.email })));
    }
  });
  return res.json({ saved: cleaned.length });
});

// Any address on the verified domain may send; anything else is rejected.
const FROM_DOMAIN = "gameinsights.com.au";

function fromAddressOk(from: string): boolean {
  const m = /<([^<>]+)>$/.exec(from.trim());
  const addr = (m ? m[1] : from).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(addr) && addr.endsWith(`@${FROM_DOMAIN}`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Email one coach the football match report deck. The client builds the PPTX
 * (same generator as the download button) and posts it as base64; we attach
 * and send. Bulk sends are a client-side loop so progress is per coach.
 */
router.post("/match-report-email", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req))) { res.status(403).json({ error: "Admins only" }); return; }
  const parsed = SendMatchReportEmailBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { to, subject, body, from, fileName, pptxBase64, leagueId } = parsed.data;
  if (!(await mayWriteLeague(req, leagueId))) {
    res.status(403).json({ error: "No access to this league's match reports" });
    return;
  }

  if (!fromAddressOk(from)) {
    res.status(400).json({ error: `The from address must be on @${FROM_DOMAIN}` });
    return;
  }
  // ~25MB is Resend's total-message cap; keep a sane per-report limit well under it.
  if (pptxBase64.length > 15 * 1024 * 1024) {
    res.status(400).json({ error: "Report attachment is too large to email" });
    return;
  }

  const paragraphs = body
    .split(/\n{2,}/)
    .map((p: string) => `<p style="margin: 0 0 12px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
    ${paragraphs}
    <p style="font-size: 12px; color: #777; margin-top: 24px;">The match report is attached as a PowerPoint file.</p>
  </div>`;

  try {
    await sendEmail({ to, subject, html, from, attachments: [{ filename: fileName, content: pptxBase64 }] });
  } catch (e) {
    logger.error({ err: e, to }, "Match report email failed");
    res.status(502).json({ error: "The email service rejected the send — try again shortly" });
    return;
  }
  res.json({ sent: true });
});

export default router;
