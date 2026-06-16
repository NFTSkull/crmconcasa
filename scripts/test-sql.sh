#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"

run_sql_test() {
  local file="$1"
  echo "==> Running ${file}"
  PGPASSWORD="$DB_PASSWORD" psql \
    -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -f "$file"
}

run_sql_test "supabase/tests/rls_policies.sql"
run_sql_test "supabase/tests/audit_document_history.sql"
run_sql_test "supabase/tests/rpc_documento_revision.sql"
run_sql_test "supabase/tests/rpc_enviar_a_mesa.sql"
run_sql_test "supabase/tests/rpc_avanzar_etapa_operativa.sql"
run_sql_test "supabase/tests/rpc_book_biometricos.sql"
run_sql_test "supabase/tests/rpc_avanzar_etapa_4_5.sql"
run_sql_test "supabase/tests/rpc_biometricos_cancel_reagendar.sql"

echo "SQL tests: ALL PASSED"
