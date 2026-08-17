#!/usr/bin/env bash
# P189 B8 LOCAL: DB aislada p189_b8_test con schema 001–188 + 3 suites SQL.
# NO Cloud / NO --linked writes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_NAME="${P189_B8_DB_NAME:-p189_b8_test}"

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
  echo "LOCAL_ENV_FAILURE: Postgres no responde en ${DB_HOST}:${DB_PORT}"
  exit 2
fi

psql_admin() {
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres "$@"
}

psql_local() {
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

migration_version() {
  basename "$1" | sed -E 's/^0*([0-9]+)_.*/\1/'
}

echo "==> Recreate isolated DB: ${DB_NAME}"
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" 2>/dev/null || true
psql_admin -c "DROP DATABASE IF EXISTS ${DB_NAME};"
psql_admin -c "CREATE DATABASE ${DB_NAME};"

echo "==> Clone Supabase base schemas (auth/vault/extensions/supabase_migrations) from postgres"
docker exec supabase_db_Copia_de_concasa_crm pg_dump -U postgres -d postgres \
  -n auth -n vault -n extensions -n supabase_migrations \
  --schema-only --no-owner --no-privileges \
  | sed '/^\\restrict/d;/^\\unrestrict/d' \
  | PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null

echo "==> Apply migrations 001–077"
while IFS= read -r f; do
  ver="$(migration_version "$f")"
  if [ "$ver" -gt 77 ]; then
    break
  fi
  echo "   mig ${ver}: $(basename "$f")"
  psql_local -f "$f"
  psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('${ver}', '$(basename "$f" .sql | sed "s/^[0-9]*_//")')
    ON CONFLICT (version) DO NOTHING;" 2>/dev/null || true
done < <(ls -1 supabase/migrations/*.sql | sort -t_ -k1 -n)

echo "==> Bootstrap 078 (prod UID/org)"
psql_local -f supabase/tests/_p189_b8_schema_bootstrap.sql

echo "==> Apply migrations 078–188"
while IFS= read -r f; do
  ver="$(migration_version "$f")"
  if [ "$ver" -lt 78 ]; then
    continue
  fi
  echo "   mig ${ver}: $(basename "$f")"
  psql_local -f "$f"
  psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('${ver}', '$(basename "$f" .sql | sed "s/^[0-9]*_//")')
    ON CONFLICT (version) DO NOTHING;" 2>/dev/null || true
done < <(ls -1 supabase/migrations/*.sql | sort -t_ -k1 -n)

max_mig="$(psql_local -tAc "SELECT max(version::int) FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]+$';")"
echo "==> schema_migrations max = ${max_mig}"
if [ "${max_mig}" != "188" ]; then
  echo "B8 FAIL: expected max migration 188, got ${max_mig}"
  exit 1
fi

run_suite() {
  local file="$1"
  echo ""
  echo "==> SQL suite: ${file}"
  psql_local -f "$file"
  echo "PASS: ${file}"
}

run_suite "supabase/tests/rpc_infonavit_feature_flag_p189_b7.sql"
run_suite "supabase/tests/rpc_infonavit_submission_snapshot_p189.sql"
run_suite "supabase/tests/rpc_infonavit_pdf_estado_p189_b5.sql"

echo ""
echo "P189 B8 SQL LOCAL: 3/3 PASS"
