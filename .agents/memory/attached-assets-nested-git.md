---
name: attached_assets nested git repos
description: Imported reference apps under attached_assets/ arrive as embedded git repos with read-only dirs; how to flatten them for the outer repo.
---

# Flattening nested git repos under attached_assets/

Imported/reference apps dropped into `attached_assets/` (e.g. the standalone GPS / Season Stats / Testing / Goal Map apps) can arrive as **embedded git repositories** — each has its own `.git`, so the outer repo stages them as gitlinks (mode `160000`). If pushed, they appear on GitHub as broken empty links; their real files never upload.

**Symptom:** `git add` prints `warning: adding embedded git repository: <path>`, and `git ls-files --stage | grep ^160000` shows entries.

**Fix (to include their contents as normal files in the outer repo):**
1. The app directories are owned by `runner` but often have the **write bit off (mode 555)** — plain `rm -rf <app>/.git` fails with Permission denied, and `mv` of `.git` fails too. First `chmod -R u+w <app>` (you own them, so chmod works), then `rm -rf <app>/.git`.
2. Removing `.git` alone is not enough — the index still holds the gitlink. Run `git rm -r --cached <app>` to drop the gitlink entry, then `git add -A` to re-add the files as normal blobs.
3. Verify: `git ls-files --stage | grep ^160000` returns nothing.

**Why:** the outer repo must contain the actual source of these apps (user wants them lumped into the main Soccer Hub repo), not submodule pointers to repos that don't exist on the remote.
