#!/usr/bin/env bash
# Runner local P170: aplica mig 170 (idempotente) + suite SQL aislada.
# NO Cloud / NO Edge / NO production / NO smoke.
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

echo "==> Apply mig 170 (idempotent)"
psql_local -f supabase/migrations/170_agenda_sheet_apply_operational_result.sql

# Ramas post-P172/P173: 170 recrea apply 17-args; reponer capas posteriores.
if [[ -f supabase/migrations/171_agenda_contingencia_extraordinaria.sql ]]; then
  echo "==> Re-apply mig 171 (P172 contingency guards)"
  psql_local -f supabase/migrations/171_agenda_contingencia_extraordinaria.sql
fi
if [[ -f supabase/migrations/172_agenda_sheet_red_color_veto.sql ]]; then
  echo "==> Re-apply mig 172 (P173 color veto; single apply signature)"
  psql_local -f supabase/migrations/172_agenda_sheet_red_color_veto.sql
fi

echo "==> Suite rpc_agenda_sheet_apply_operational_p170.sql"
psql_local -f supabase/tests/rpc_agenda_sheet_apply_operational_p170.sql

echo "P170 SQL: PASSED"
