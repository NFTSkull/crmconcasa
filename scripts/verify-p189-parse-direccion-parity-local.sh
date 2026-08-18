#!/usr/bin/env bash
# P189 LOCAL: aplica mig 190 (parser dirección SQL↔TS) + suite SQL.
# NO Cloud / NO Storage / NO deploy / NO regeneration.
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

echo "==> Apply mig 190 (idempotent REPLACE parser + payload vivienda lote/manzana)"
psql_local -f supabase/migrations/190_p189_parse_direccion_parity.sql

echo "==> Register local schema_migrations 190 if missing"
psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('190', 'p189_parse_direccion_parity') ON CONFLICT (version) DO NOTHING;"

echo "==> Suite rpc_p189_parse_direccion_parity.sql"
psql_local -f supabase/tests/rpc_p189_parse_direccion_parity.sql

echo "==> TS parser + SQL↔TS parity"
npx tsx --test \
  supabase/functions/_shared/infonavit-pdf/parse-direccion-mx.test.ts \
  supabase/functions/_shared/infonavit-pdf/parse-direccion-mx.parity.test.ts

echo "P189 parse dirección parity LOCAL: PASSED"
