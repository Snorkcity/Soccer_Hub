---
name: Running one-off api-server scripts
description: How to run ad-hoc TS scripts that import api-server code (no tsx runner)
---
Bundle with `pnpm exec esbuild <entry>.ts --bundle --platform=node --format=cjs --external:pg-native` and run with node.

**Gotchas:**
- Entry file must import api-server modules by absolute path if it lives outside the package dir.
- Bundle route-level tests that pull in Express as CommonJS (`format=cjs`); ESM bundles fail when Express dependencies dynamically require Node built-ins such as `tty`.
- Run with `NODE_ENV=production` — otherwise the logger tries the `pino-pretty` transport, which esbuild can't resolve in a bundle ("unable to determine transport target").
- Pass `DATABASE_URL="$DEV_DATABASE_URL"` explicitly.
