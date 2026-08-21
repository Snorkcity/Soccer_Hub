#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"
confirmation="${2:-}"

case "$target" in
  development)
    : "${DEV_DATABASE_URL:?DEV_DATABASE_URL is not set}"
    database_url="$DEV_DATABASE_URL"
    ;;
  production)
    : "${PROD_DATABASE_URL:?PROD_DATABASE_URL is not set}"
    if [[ "$confirmation" != "--confirm-production" ]]; then
      echo "Production setup requires: bash scripts/setup-nplb-2026.sh production --confirm-production" >&2
      exit 2
    fi
    database_url="$PROD_DATABASE_URL"
    ;;
  *)
    echo "Usage: bash scripts/setup-nplb-2026.sh development|production [--confirm-production]" >&2
    exit 2
    ;;
esac

bundle="/tmp/bufc-setup-nplb-2026.cjs"
pnpm --filter @workspace/api-server exec esbuild src/setupNplb2026.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --external:pg-native \
  --outfile="$bundle"

NODE_ENV=production \
DATABASE_URL="$database_url" \
NPLB_SETUP_TARGET="$target" \
node "$bundle"