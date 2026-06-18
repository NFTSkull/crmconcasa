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
run_sql_test "supabase/tests/rpc_upsert_editor_decision.sql"
run_sql_test "supabase/tests/rpc_save_cliente_datos.sql"
run_sql_test "supabase/tests/agenda_config_biometricos_rules.sql"
run_sql_test "supabase/tests/rpc_avanzar_etapa_2_3_4.sql"
run_sql_test "supabase/tests/rpc_avanzar_etapa_5_6.sql"
run_sql_test "supabase/tests/rpc_avanzar_etapa_6_7.sql"
run_sql_test "supabase/tests/rpc_avanzar_etapa_7_8.sql"
run_sql_test "supabase/tests/rpc_enviar_retencion_mesa.sql"
run_sql_test "supabase/tests/rpc_avanzar_etapa_8_9.sql"
run_sql_test "supabase/tests/rpc_book_firmas.sql"
run_sql_test "supabase/tests/rpc_firmas_cancel_reagendar.sql"
run_sql_test "supabase/tests/rpc_avanzar_etapa_9_10.sql"
run_sql_test "supabase/tests/backfill_agenda_config_firmas.sql"
run_sql_test "supabase/tests/rpc_create_expediente.sql"

echo "SQL tests: ALL PASSED"
