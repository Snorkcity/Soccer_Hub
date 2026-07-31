import { db, usersTable, userActivityTable } from "@workspace/db";
import { eq, and, gte, or, isNull, lt, sql } from "drizzle-orm";
import { sendEmail } from "./email";
import { logger } from "./logger";

// ── Shared-login detection ────────────────────────────────────────────────────
// "Possibly shared" = two activity rows from DIFFERENT devices (device = hash
// of user-agent + IP) seen within the same 6-hour window. One person can't
// easily be on two networks / two machines at once; browser updates change the
// UA slowly, so a single device is stable hour-to-hour.
export const SHARED_WINDOW_MS = 6 * 60 * 60 * 1000;

// Email superadmins at most once per account per cooldown period, persisted on
// the users row so restarts/redeploys don't re-send.
const ALERT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ActivityRow { deviceHash: string; userAgent: string; ip: string; seenAt: Date }

/** rows must be sorted newest-first; true when two different devices appear within the 6h window. */
export function looksShared(rows: ActivityRow[]): boolean {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const dt = rows[i].seenAt.getTime() - rows[j].seenAt.getTime();
      if (dt > SHARED_WINDOW_MS) break; // sorted → later rows only get further away
      if (rows[i].deviceHash !== rows[j].deviceHash) return true;
    }
  }
  return false;
}

export function sharedLoginAlertEmailHtml(
  account: { name: string; email: string },
  recent: ActivityRow[],
): string {
  const rows = recent.slice(0, 10).map((a) => `
    <tr>
      <td style="padding: 4px 10px 4px 0; white-space: nowrap;">${escapeHtml(a.seenAt.toISOString().replace("T", " ").slice(0, 16))} UTC</td>
      <td style="padding: 4px 10px 4px 0; white-space: nowrap;">${escapeHtml(a.ip)}</td>
      <td style="padding: 4px 0;">${escapeHtml(a.userAgent.slice(0, 80))}</td>
    </tr>`).join("");
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
    <h2 style="margin-bottom: 4px;">Possible shared login</h2>
    <p>The account <strong>${escapeHtml(account.name)}</strong> (${escapeHtml(account.email)}) was used from
    two different devices or networks within a 6-hour window — this can mean the login is being shared.</p>
    <p style="font-size: 13px; color: #555;">Recent activity:</p>
    <table style="font-size: 12px; color: #333; border-collapse: collapse;">${rows}</table>
    <p style="font-size: 13px; color: #555; margin-top: 16px;">See the full picture on the Users page of the
    <a href="https://app.gameinsights.com.au">BUFC Performance Hub</a>. You won't get another email about this
    account for 7 days.</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Called after a new activity row is written for a user. When the account's
 * recent activity (last 6 hours) shows two different devices AND no alert has
 * gone out within the cooldown, email every superadmin once.
 * The cooldown stamp is claimed atomically (UPDATE ... WHERE stale RETURNING),
 * so concurrent requests can't double-send.
 */
export async function maybeSendSharedLoginAlert(userId: number): Promise<void> {
  const since = new Date(Date.now() - SHARED_WINDOW_MS);
  const recent = await db.select().from(userActivityTable)
    .where(and(eq(userActivityTable.userId, userId), gte(userActivityTable.seenAt, since)))
    .orderBy(sql`${userActivityTable.seenAt} DESC`);
  if (!looksShared(recent)) return;

  // Claim the cooldown atomically; zero rows back → someone else sent recently.
  const cutoff = new Date(Date.now() - ALERT_COOLDOWN_MS);
  const claimed = await db.update(usersTable)
    .set({ sharedAlertAt: new Date() })
    .where(and(
      eq(usersTable.id, userId),
      or(isNull(usersTable.sharedAlertAt), lt(usersTable.sharedAlertAt, cutoff)),
    ))
    .returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email });
  if (claimed.length === 0) return;

  const superadmins = await db.select({ email: usersTable.email })
    .from(usersTable).where(eq(usersTable.isSuperadmin, true));
  if (superadmins.length === 0) return;

  const html = sharedLoginAlertEmailHtml(claimed[0], recent);
  const subject = `Possible shared login: ${claimed[0].name}`;
  for (const s of superadmins) {
    try {
      await sendEmail({ to: s.email, subject, html });
    } catch (err) {
      logger.error({ err, to: s.email, userId }, "Shared-login alert email failed");
    }
  }
  logger.info({ userId, recipients: superadmins.length }, "Shared-login alert emailed to superadmins");
}
