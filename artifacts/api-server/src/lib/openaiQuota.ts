/** The coach's OpenAI account has run out of credits (429 insufficient_quota). */
export class OpenAiQuotaError extends Error {
  constructor() {
    super("Your OpenAI account has no credits left — top up at platform.openai.com.");
    this.name = "OpenAiQuotaError";
  }
}

/** Throw the specific quota error when OpenAI says the account is out of credits. */
export function throwIfQuota(status: number, bodyText: string): void {
  if (status === 429 && bodyText.includes("insufficient_quota")) {
    throw new OpenAiQuotaError();
  }
}
