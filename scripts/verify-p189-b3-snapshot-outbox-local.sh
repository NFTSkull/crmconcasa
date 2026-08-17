#!/usr/bin/env bash
# P189 B3 LOCAL: aplica mig 183+184 (idempotente) + suite SQL snapshot/outbox.
# NO Cloud / NO --linked / NO Storage / NO Edge / NO deploy / NO smoke.
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

echo "==> Apply mig 183 (idempotent; B2.1 intacto)"
psql_local -f supabase/migrations/183_cliente_datos_telefonos_unicos.sql

echo "==> Apply mig 184 (idempotent REPLACE)"
psql_local -f supabase/migrations/184_infonavit_submission_snapshot_outbox.sql

echo "==> Register local schema_migrations 183/184 if missing"
psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('183', 'cliente_datos_telefonos_unicos') ON CONFLICT (version) DO NOTHING;"
psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('184', 'infonavit_submission_snapshot_outbox') ON CONFLICT (version) DO NOTHING;"

echo "==> Suite rpc_infonavit_submission_snapshot_p189.sql"
psql_local -f supabase/tests/rpc_infonavit_submission_snapshot_p189.sql

echo "P189 B3 SQL: PASSED"
