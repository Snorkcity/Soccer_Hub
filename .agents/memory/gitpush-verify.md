---
name: gitPush verification
description: gitPush can silently fail; how to verify a deploy actually landed on prod
---

- The `gitPush({})` callback returns null on both success and silent failure. A push once no-op'd (origin/main stayed 2 commits behind) while Railway showed the *previous* deploy as "successful", making prod look stale for no visible reason.
  **Why:** cost an entire confused debugging round with the coach ("prod isn't the same as dev").
  **How to apply:** after every push meant for prod, run `git fetch -q && git log --oneline -1 origin/main` and confirm it matches local HEAD. If behind, push again.
- gitPush can also commit only SOME modified files (once committed just the memory docs and left code edits uncommitted-but-modified). Also check `git status -s` is clean after pushing. Manual `git push` fails (no auth token in shell) — only the gitPush callback can push.
- In sessions where the gitPush callback is unavailable, use the added GitHub connector's Git Database API as the fallback: require remote HEAD to equal the local parent, build blobs/tree, and refuse to update the ref unless the generated tree matches the local tree. GitHub may normalize commit metadata and return a different commit SHA despite an identical tree; fetch and align local HEAD only after proving the trees match.
  - Disable rename detection when deriving changed paths so both the old-path deletion and new-path addition enter the tree.
    **Why:** a rename-aware name-only diff emits only the new path, leaving the old blob in the GitHub tree and causing an otherwise unexplained tree-SHA mismatch.
    **How to apply:** build connector tree entries from a no-renames diff, including explicit `sha: null` deletions, before comparing the generated tree SHA with the tested local tree.
- To confirm prod is serving new frontend code: `curl -s https://app.gameinsights.com.au/` → get `assets/index-*.js` hash. Feature code may live in a lazy chunk (e.g. `assets/playerGpsReport-*.js`, other *Pptx chunks) — grep the chunk, not index.js, for a distinctive new string.
- Railway can produce a different Vite asset hash from a local build even when the checked-in build command is reproduced exactly.
  **Why:** Node/toolchain/environment differences changed the hash while the deployed minified feature code matched the validated release tree byte-for-byte around distinctive markers.
  **How to apply:** require a healthy endpoint and a live hash change, then compare distinctive minified snippets/marker counts against the validated release bundle; do not require local/live filenames to match.
- Railway "REMOVED" deployment history entries are normal (old deploys retired when a new one activates), not failures.

## Parallel task-agent merges can scramble a shared file
Two task agents merging into the same route file has produced silent corruption: one route's Zod schema/prompt text substituted into unrelated routes, and a route header deleted leaving orphan statements. After any task merge, check the workflow logs build cleanly; if a shared file looks scrambled, restore it from the last known-good commit and re-apply each merged feature by hand from its commit diff (git show <sha> --stat to scope it), then re-run codegen and typecheck.
