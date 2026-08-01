import { Router, type IRouter } from "express";
import { db, gpsPlayerEmailsTable } from "@workspace/db";
import { SaveGpsPlayerEmailsBody, SendGpsReportEmailBody } from "@workspace/api-zod";
import { eq, sql } from "drizzle-orm";
import { getSessionUser, effectiveRole } from "../middlewares/entryAuth";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// These are mostly minors' addresses — every route here (reads included) is
// admin-only, on top of the global requireSession gate.
async function requireAdmin(req: Parameters<typeof getSessionUser>[0]): Promise<boolean> {
  const user = await getSessionUser(req);
  return !!user && effectiveRole(user) === "admin";
}

router.get("/gps-player-emails", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req))) { res.status(403).json({ error: "Admins only" }); return; }
  const rows = await db
    .select()
    .from(gpsPlayerEmailsTable)
    .orderBy(gpsPlayerEmailsTable.playerName);
  res.json(rows);
});

/** Upsert emails; entries with a null/empty email are removed. */
router.put("/gps-player-emails", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req))) { res.status(403).json({ error: "Admins only" }); return; }
  const parsed = SaveGpsPlayerEmailsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let saved = 0;
  let removed = 0;
  await db.transaction(async tx => {
    for (const entry of parsed.data) {
      const name = entry.playerName.trim();
      if (!name) continue;
      const email = entry.email?.trim();
      if (!email) {
        const del = await tx
          .delete(gpsPlayerEmailsTable)
          .where(eq(gpsPlayerEmailsTable.playerName, name))
          .returning();
        removed += del.length;
      } else {
        await tx
          .insert(gpsPlayerEmailsTable)
          .values({ playerName: name, email })
          .onConflictDoUpdate({
            target: gpsPlayerEmailsTable.playerName,
            set: { email: sql`excluded.email` },
          });
        saved += 1;
      }
    }
  });
  res.json({ saved, removed });
});

// Any address on the verified domain may send; anything else is rejected.
const FROM_DOMAIN = "gameinsights.com.au";

function fromAddressOk(from: string): boolean {
  // Accept "Name <user@domain>" or bare "user@domain".
  const m = /<([^<>]+)>$/.exec(from.trim());
  const addr = (m ? m[1] : from).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(addr) && addr.endsWith(`@${FROM_DOMAIN}`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Email one player their personalised GPS report. The client builds the PPTX
 * (same generator as the download button) and posts it as base64; we attach
 * and send. Bulk sends are a client-side loop so progress is per player.
 */
router.post("/gps-report-email", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req))) { res.status(403).json({ error: "Admins only" }); return; }
  const parsed = SendGpsReportEmailBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { to, subject, body, from, fileName, pptxBase64 } = parsed.data;

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
    <p style="font-size: 12px; color: #777; margin-top: 24px;">Your GPS report is attached as a PowerPoint file.</p>
  </div>`;

  try {
    await sendEmail({ to, subject, html, from, attachments: [{ filename: fileName, content: pptxBase64 }] });
  } catch (e) {
    logger.error({ err: e, to }, "GPS report email failed");
    res.status(502).json({ error: "The email service rejected the send — try again shortly" });
    return;
  }
  res.json({ sent: true });
});

export default router;
