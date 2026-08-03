---
name: gitPush verification
description: gitPush can silently fail; how to verify a deploy actually landed on prod
---

- The `gitPush({})` callback returns null on both success and silent failure. A push once no-op'd (origin/main stayed 2 commits behind) while Railway showed the *previous* deploy as "successful", making prod look stale for no visible reason.
  **Why:** cost an entire confused debugging round with the coach ("prod isn't the same as dev").
  **How to apply:** after every push meant for prod, run `git fetch -q && git log --oneline -1 origin/main` and confirm it matches local HEAD. If behind, push again.
- gitPush can also commit only SOME modified files (once committed just the memory docs and left code edits uncommitted-but-modified). Also check `git status -s` is clean after pushing. Manual `git push` fails (no auth token in shell) — only the gitPush callback can push.
- To confirm prod is serving new frontend code: `curl -s https://app.gameinsights.com.au/` → get `assets/index-*.js` hash. Feature code may live in a lazy chunk (e.g. `assets/playerGpsReport-*.js`, other *Pptx chunks) — grep the chunk, not index.js, for a distinctive new string.
- Railway "REMOVED" deployment history entries are normal (old deploys retired when a new one activates), not failures.

## Parallel task-agent merges can scramble a shared file
Two task agents merging into the same route file has produced silent corruption: one route's Zod schema/prompt text substituted into unrelated routes, and a route header deleted leaving orphan statements. After any task merge, check the workflow logs build cleanly; if a shared file looks scrambled, restore it from the last known-good commit and re-apply each merged feature by hand from its commit diff (git show <sha> --stat to scope it), then re-run codegen and typecheck.
