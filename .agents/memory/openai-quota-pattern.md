---
name: OpenAI quota error pattern
description: How out-of-credits (429 insufficient_quota) from the coach's own OpenAI key is surfaced everywhere
---

The rule: every server code path that calls api.openai.com directly on the coach's key must detect 429 + `insufficient_quota` via the shared `OpenAiQuotaError`/`throwIfQuota` helpers in the api-server lib, and surface "Your OpenAI account has no credits left — top up at platform.openai.com." to the client — 402 JSON when headers aren't sent, or an SSE `error` frame mid-stream (assistant chat streams).

**Why:** the coach's personal key regularly runs dry; a generic "try again" error sends him debugging the app instead of topping up.

**How to apply:** new AI endpoints (embeddings, TTS, transcription, chat) call `throwIfQuota(status, bodyText)` before throwing generic errors; routers either have the journal router's 402 error-handler or catch `OpenAiQuotaError` explicitly. Client sides just display the server's `error` string (helper `openAiQuotaMessage` exists for toast paths).

Also learned (Aug 2026): a prior merge left journalInterview.ts syntactically corrupted by a botched find/replace (all Zod body schemas renamed to one, a route header deleted). When a route file fails tsc with "'try' expected", diff against the last good commit and rebuild rather than patching in place.
