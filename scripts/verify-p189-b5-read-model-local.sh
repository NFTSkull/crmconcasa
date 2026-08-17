#!/usr/bin/env bash
# P189 B5 LOCAL: mig 187 + SQL read model + unit UI.
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

echo "==> SHA 183-186 (B5 no debe mutarlas)"
shasum -a 256 \
  supabase/migrations/183_cliente_datos_telefonos_unicos.sql \
  supabase/migrations/184_infonavit_submission_snapshot_outbox.sql \
  supabase/migrations/185_infonavit_pdf_worker_contract.sql \
  supabase/migrations/186_infonavit_pdf_worker_schedule.sql

echo "==> Apply mig 187 LOCAL"
psql_local -f supabase/migrations/187_infonavit_pdf_read_model.sql
psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('187', 'infonavit_pdf_read_model') ON CONFLICT (version) DO NOTHING;"

echo "==> Suite SQL B5 (incluye apply 187 via \\i)"
psql_local -f supabase/tests/rpc_infonavit_pdf_estado_p189_b5.sql

echo "==> npm unit B5"
npm run test:p189-b5

echo "==> P189 B5 LOCAL PASS (read model + UI unit). Preview/download usan storage.download RLS, no signed URL pública."
