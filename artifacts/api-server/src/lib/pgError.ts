/**
 * Extracts the Postgres error code (e.g. "23505" unique violation,
 * "23503" foreign-key violation) from a Drizzle-wrapped error, if any.
 */
export function pgErrorCode(e: unknown): string | undefined {
  let current: unknown = e;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = current.cause;
  }
  return undefined;
}
