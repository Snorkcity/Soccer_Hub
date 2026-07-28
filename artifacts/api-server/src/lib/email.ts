import { logger } from "./logger";

// Transactional email via Resend's REST API (no SDK needed).
// RESEND_API_KEY must be set in both dev (Replit secret) and prod (Railway).
const FROM = "BUFC Performance Hub <noreply@gameinsights.com.au>";

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set — cannot send email");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [opts.to], subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error({ status: res.status, body }, "Resend email send failed");
    throw new Error(`Email send failed (${res.status})`);
  }
}

export function passwordResetEmailHtml(name: string, resetUrl: string): string {
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
    <h2 style="margin-bottom: 4px;">Reset your password</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Someone (hopefully you) asked to reset the password for your BUFC Performance Hub account.</p>
    <p style="margin: 24px 0;">
      <a href="${resetUrl}" style="background: #16a34a; color: #ffffff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: bold;">Set a new password</a>
    </p>
    <p style="font-size: 13px; color: #555;">This link works once and expires in 1 hour. If you didn't ask for this, you can safely ignore this email — your password hasn't changed.</p>
    <p style="font-size: 13px; color: #555;">If the button doesn't work, copy this link into your browser:<br>${resetUrl}</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
