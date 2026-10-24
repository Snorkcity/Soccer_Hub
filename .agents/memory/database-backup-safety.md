---
name: Database backup safety
description: Precautions for production exports when Railway PostgreSQL is newer than the workspace tools.
---

Before promising an export, check the production server major version against the backup client. The workspace's installed clients and Nix package catalog can lag Railway; an older pg_dump refuses to export a newer server.

**Why:** creating a production backup required a matching temporary client because the installed clients were older and the matching Nix package was unavailable. No database downgrade or live-app change was needed.

**How to apply:** use a compatible client with SSL and read-only connections. Keep exports outside Git and deployment inputs, restrict file permissions, and verify both the archive index and full SQL decoding. These checks are not a restore test. A workspace copy alone is not an independent off-site backup.
