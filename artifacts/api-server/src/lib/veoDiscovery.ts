import { createHmac, timingSafeEqual } from "node:crypto";

export interface RecordingConfirmation {
  userId: number;
  leagueId: number;
  seasonId: number;
  expiresAt: number;
  recordingId: string;
  title: string;
  startsAt: string | null;
  clubSlug: string;
  teamSlug: string;
  teamId: string;
}

export function signRecording(value: RecordingConfirmation, secret: string): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verifyRecording(token: string, secret: string, scope: {
  userId: number; leagueId: number; seasonId: number;
}, now = Date.now()): RecordingConfirmation | null {
  try {
    const [body, sig, extra] = token.split(".");
    if (!body || !sig || extra) return null;
    const expected = createHmac("sha256", secret).update(body).digest();
    const received = Buffer.from(sig, "base64url");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    const value = JSON.parse(Buffer.from(body, "base64url").toString()) as RecordingConfirmation;
    if (value.userId !== scope.userId || value.leagueId !== scope.leagueId
      || value.seasonId !== scope.seasonId || !Number.isFinite(value.expiresAt)
      || value.expiresAt <= now || !value.recordingId || !value.teamId
      || !value.teamSlug || !value.clubSlug) return null;
    return value;
  } catch { return null; }
}
