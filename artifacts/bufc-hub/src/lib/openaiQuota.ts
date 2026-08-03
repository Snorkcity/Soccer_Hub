/**
 * The journal AI endpoints run on the coach's own OpenAI account. When that
 * account is out of credits the API returns 402 with a specific message —
 * surface it instead of a generic "check your connection" toast.
 */
export function openAiQuotaMessage(err: unknown): string | null {
  const e = err as { status?: number; data?: { error?: unknown } } | null;
  if (e && typeof e === "object" && e.status === 402 && typeof e.data?.error === "string") {
    return e.data.error;
  }
  return null;
}
