#!/usr/bin/env bash
# P189 B7 LOCAL: re-apply 183–187 (184 modificada) + SQL flag/eligibility + units.
# NO Cloud / NO --linked / NO deploy / NO Storage Cloud / NO smoke / NO commit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
  echo "LOCAL_ENV_FAILURE: Postgres no responde en ${DB_HOST}:${DB_PORT}"
  exit 2
fi

psql_local() {
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

echo "==> SHA 183–187 (183/185/186/187 no deben cambiar vs B5; 184 B7 deliberado)"
shasum -a 256 \
  supabase/migrations/183_cliente_datos_telefonos_unicos.sql \
  supabase/migrations/184_infonavit_submission_snapshot_outbox.sql \
  supabase/migrations/185_infonavit_pdf_worker_contract.sql \
  supabase/migrations/186_infonavit_pdf_worker_schedule.sql \
  supabase/migrations/187_infonavit_pdf_read_model.sql

echo "==> Apply order LOCAL 183 → 184 → 185 → 186 → 187"
psql_local -f supabase/migrations/183_cliente_datos_telefonos_unicos.sql
psql_local -f supabase/migrations/184_infonavit_submission_snapshot_outbox.sql
psql_local -f supabase/migrations/185_infonavit_pdf_worker_contract.sql
psql_local -f supabase/migrations/186_infonavit_pdf_worker_schedule.sql
psql_local -f supabase/migrations/187_infonavit_pdf_read_model.sql

psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('183', 'cliente_datos_telefonos_unicos'),
  ('184', 'infonavit_submission_snapshot_outbox'),
  ('185', 'infonavit_pdf_worker_contract'),
  ('186', 'infonavit_pdf_worker_schedule'),
  ('187', 'infonavit_pdf_read_model')
  ON CONFLICT (version) DO NOTHING;"

echo "==> Suite SQL B7"
psql_local -f supabase/tests/rpc_infonavit_feature_flag_p189_b7.sql

echo "==> Recert B3 (flag ON explícito en la suite)"
psql_local -f supabase/tests/rpc_infonavit_submission_snapshot_p189.sql

echo "==> npm unit B7"
npm run test:p189-b7

echo "P189 B7 LOCAL PASS"
