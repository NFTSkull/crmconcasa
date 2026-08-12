#!/usr/bin/env bash
# Runner local P172 B1: aplica mig 171 (idempotente) + suite SQL aislada.
# NO Cloud / NO Edge / NO Sheet write / NO smoke / NO commit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"

psql_local() {
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

echo "==> Apply mig 171 (idempotent)"
psql_local -f supabase/migrations/171_agenda_contingencia_extraordinaria.sql

# En ramas posteriores a P173, re-aplicar 172 para no dejar overload P171
# pisando el wrapper compat / COLOR_VETO (171 CREATE OR REPLACE del apply 17-args).
if [[ -f supabase/migrations/172_agenda_sheet_red_color_veto.sql ]]; then
  echo "==> Re-apply mig 172 (P173 color veto; restores post-171 apply)"
  psql_local -f supabase/migrations/172_agenda_sheet_red_color_veto.sql
fi

echo "==> Suite rpc_agenda_contingencia_p172.sql"
psql_local -f supabase/tests/rpc_agenda_contingencia_p172.sql

echo "P172 SQL: PASSED"
