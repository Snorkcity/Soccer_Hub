---
name: AI club setup & Wikipedia logo lookup
description: Durable lessons from the Data Entry "set up clubs" AI flow (logo sourcing, SSRF, body limits)
---

- LLMs almost never volunteer real logo URLs when told "never invent" — source crests yourself. Wikipedia pageimages works, but club crests are non-free images so `pilicense=any` is required or the API returns nothing; prefer the `thumbnail` source (PNG-rendered, so SVGs display everywhere).
- **Why sequential:** Wikipedia 429s parallel bursts — logo lookups must run one at a time with a small delay and a 429 retry.
- **SSRF rule:** any server-side fetch of a model-suggested URL must be HTTPS-only against a host allowlist with redirects re-validated per hop. Coach-pasted URLs are only ever loaded by the browser, never fetched by the server.
- **How to apply:** any new endpoint accepting base64 screenshots needs its own large-body `express.json` limit in app.ts — the global parser is 1mb and real screenshots exceed it.
- **Ambiguous short names:** saved clubs keep only short names ("Croatia", "Wanderers"), which match the wrong Wikipedia pages (national teams, Wolves). Append the league's region to the search query — that landed "Croatia ACT" on the real Canberra FC crest. Still review-before-save.
