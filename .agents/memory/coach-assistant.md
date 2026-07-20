---
name: Coach Assistant
description: RAG chat over the 14-doc Belconnen development curriculum (U11–16+)
---

- Knowledge base = 14 club docx (framework library, coach packs, session plans U11–U16+, dev curriculum), parsed by `scripts/parse_curriculum.py` → `lib/db/src/data/curriculum.json` (593 heading-based chunks, hash ids). Re-run the parser after doc updates; boot sync picks up changes.
- Boot sync in api-server upserts by content-hash id, deletes stale rows, embeds only missing embeddings (text-embedding-3-small, **direct OpenAI via OPENAI_API_KEY** — the AI-integrations proxy has no embeddings endpoint). Runs non-blocking after listen; endpoint returns "still preparing" until ready. Prod self-provisions the same way.
- Retrieval: in-memory cosine over jsonb vectors (no pgvector), plus exact regex matching of "cycle N week N session N" + age-group detection which pins the official session chunks first. Chat = SSE stream, gpt-5.6-terra via integrations proxy.
- **Why**: coach's public custom GPT was being overused; instructions (content preservation, scope enforcement) are baked into the system prompt in `routes/assistant.ts` — do not soften them.
- Session output = 3–4 parts (Warm-Up → 1st Part → 2nd Part → 3rd Part), NOT the old Croatian 3-phase and NOT all 5 source practices — session-plan docs are a content bank; assistant must SELECT (e.g. skip optional ball mastery), never trim detail within a chosen practice. 1st part = activation for seniors, technical/skill for younger phases; 3rd = no-intervention transfer game.
- Auth: whole /api is session-gated; POST /assistant/chat explicitly allowed for ANY signed-in role (not admin-only) in entryAuth — coach wants every hub viewer to have it.
- Frontend chat is stateless (client sends last 16 messages); manual fetch SSE, not Orval (endpoint deliberately not in openapi.yaml).
