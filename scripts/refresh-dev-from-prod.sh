#!/usr/bin/env bash
# Refresh the dev database's DATA tables from the live (prod) database.
#
# - Reads from prod ONLY (plain SELECT/COPY TO STDOUT — prod is never written).
# - Truncates + reloads the listed data tables in dev, then resets sequences.
# - EXCLUDES account tables so dev logins/test accounts stay untouched:
#     users, password_reset_tokens, user_league_access
#   (There is no login-session table; auth uses signed cookies. The `sessions`
#   table is coaching session plans — real data — so it IS copied.)
#
# Usage:  bash scripts/refresh-dev-from-prod.sh
# Requires: PROD_DATABASE_URL and DEV_DATABASE_URL in the environment.
#
# NOTE: team/season/league IDs in dev will change to prod's IDs. The frontend
# auto-selects (never hardcode IDs), so this is expected and safe.

set -euo pipefail

: "${PROD_DATABASE_URL:?PROD_DATABASE_URL is not set}"
: "${DEV_DATABASE_URL:?DEV_DATABASE_URL is not set}"

# FK-safe load order (parents before children):
#   clubs/seasons -> leagues; practice_variations -> practices;
#   session_practices -> sessions + practices; journal_entries -> journal_cycles
TABLES=(
  leagues
  clubs
  seasons
  teams
  matches
  goals
  players
  player_stats
  league_matches
  league_goals
  league_player_stats
  gps_sessions
  gps_player_aliases
  gps_player_positions
  player_identity_links
  athletic_tests
  practices
  practice_variations
  sessions
  session_practices
  journal_cycles
  journal_entries
  match_prep_reports
  curriculum_chunks
  seed_markers
)

echo "=== Refresh dev DB from prod — $(date) ==="

# Sanity check: never proceed if the two URLs point at the same database.
prod_id=$(psql "$PROD_DATABASE_URL" -Atc "select system_identifier from pg_control_system()")
dev_id=$(psql "$DEV_DATABASE_URL" -Atc "select system_identifier from pg_control_system()")
if [[ "$prod_id" == "$dev_id" ]]; then
  echo "ABORT: PROD_DATABASE_URL and DEV_DATABASE_URL point at the same server." >&2
  exit 1
fi

# Verify each table's columns match between prod and dev (order-insensitive).
for t in "${TABLES[@]}"; do
  q="select string_agg(column_name||':'||data_type, ',' order by column_name)
     from information_schema.columns
     where table_schema='public' and table_name='$t'"
  pcols=$(psql "$PROD_DATABASE_URL" -Atc "$q")
  dcols=$(psql "$DEV_DATABASE_URL" -Atc "$q")
  if [[ -z "$pcols" ]]; then
    echo "ABORT: table '$t' missing in prod." >&2; exit 1
  fi
  if [[ "$pcols" != "$dcols" ]]; then
    echo "ABORT: column mismatch on '$t' between prod and dev — run dev migrations first." >&2
    echo "  prod: $pcols" >&2
    echo "  dev:  $dcols" >&2
    exit 1
  fi
done
echo "Schema check OK for ${#TABLES[@]} tables."

# Truncate all target tables in dev in one transaction (CASCADE covers FK order).
# CASCADE also hits user_league_access (it references leagues), so snapshot the
# dev users' league grants first and restore them afterwards.
truncate_list=$(IFS=,; echo "${TABLES[*]}")
grants_backup=$(mktemp)
psql "$DEV_DATABASE_URL" -Atc "\\copy (SELECT user_id, league_id, role, modules FROM user_league_access) TO STDOUT" > "$grants_backup"
psql "$DEV_DATABASE_URL" -q -c "TRUNCATE TABLE $truncate_list RESTART IDENTITY CASCADE;"
echo "Truncated dev data tables."

# Copy each table prod -> dev with an explicit column list.
for t in "${TABLES[@]}"; do
  cols=$(psql "$PROD_DATABASE_URL" -Atc "select string_agg(quote_ident(column_name), ',' order by ordinal_position)
    from information_schema.columns where table_schema='public' and table_name='$t'")
  psql "$PROD_DATABASE_URL" -Atc "\\copy (SELECT $cols FROM public.\"$t\") TO STDOUT" \
    | psql "$DEV_DATABASE_URL" -q -c "\\copy public.\"$t\" ($cols) FROM STDIN"
  n=$(psql "$DEV_DATABASE_URL" -Atc "select count(*) from public.\"$t\"")
  echo "  copied $t: $n rows"
done

# Restore dev users' league grants (only for leagues that still exist).
psql "$DEV_DATABASE_URL" -q <<SQL
CREATE TEMP TABLE _grants (user_id int, league_id int, role text, modules jsonb);
\\copy _grants FROM '$grants_backup'
INSERT INTO user_league_access (user_id, league_id, role, modules)
SELECT g.user_id, g.league_id, g.role, g.modules FROM _grants g
WHERE EXISTS (SELECT 1 FROM leagues l WHERE l.id = g.league_id)
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id)
ON CONFLICT DO NOTHING;
SQL
n=$(psql "$DEV_DATABASE_URL" -Atc "select count(*) from user_league_access")
rm -f "$grants_backup"
echo "Restored dev league-access grants: $n rows."

# Reset sequences owned by copied tables to max(id), where an id column exists.
for t in "${TABLES[@]}"; do
  has_id=$(psql "$DEV_DATABASE_URL" -Atc "select 1 from information_schema.columns where table_schema='public' and table_name='$t' and column_name='id'")
  [[ -z "$has_id" ]] && continue
  seq=$(psql "$DEV_DATABASE_URL" -Atc "select pg_get_serial_sequence('public.\"$t\"','id')")
  if [[ -n "$seq" ]]; then
    psql "$DEV_DATABASE_URL" -Atq -c "select setval('$seq', greatest(coalesce(max(id),0),1), max(id) is not null) from public.\"$t\"" >/dev/null
  fi
done
echo "Sequences reset."
echo "=== Done. Dev data now mirrors prod (accounts untouched). ==="
