#!/usr/bin/env bash
# Runner aislado mínimo para P094 B1: aplica migraciones y corre
# cancelar + regresiones rechazo/reingreso (+ complementarios P092).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
ADMIN_DB="${SUPABASE_ADMIN_DB:-postgres}"
ISOLATED_DB="${ISOLATED_DB_NAME:-crm_p094_b1_$$}"
TMP_DIR="$(mktemp -d /tmp/crm-p094-XXXXXX)"

psql_admin() {
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$ADMIN_DB" "$@"
}

psql_iso() {
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$ISOLATED_DB" "$@"
}

cleanup() {
  local ec=$?
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$ADMIN_DB" \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${ISOLATED_DB}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$ADMIN_DB" \
    -c "DROP DATABASE IF EXISTS ${ISOLATED_DB};" \
    >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
  exit "$ec"
}
trap cleanup EXIT

echo "==> Isolated P094 B1 DB: ${ISOLATED_DB}"
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${ISOLATED_DB}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql_admin -c "DROP DATABASE IF EXISTS ${ISOLATED_DB};"
psql_admin -c "CREATE DATABASE ${ISOLATED_DB};"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | rg -m1 'supabase_db_' || true)"
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "ERROR: no se encontró contenedor supabase_db_*"
  exit 1
fi

docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" pg_dump \
  -U "$DB_USER" -d "$ADMIN_DB" \
  --schema-only --no-owner --no-privileges \
  --schema=auth --schema=storage --schema=extensions --schema=vault \
  > "$TMP_DIR/base.sql"

psql_iso -v ON_ERROR_STOP=0 -f "$TMP_DIR/base.sql" >/dev/null 2>&1 || true

psql_iso <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'authenticated'
  );
$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END$$;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.objects TO postgres, authenticated, service_role';
  END IF;
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.buckets TO postgres, authenticated, service_role';
  END IF;
END$$;
SQL

shopt -s nullglob
for mig in supabase/migrations/*.sql; do
  base="$(basename "$mig")"
  [[ "$base" == 061_* ]] && continue
  [[ "$base" == 078_profile_asesor_mejoravit.sql ]] && continue
  echo "    APPLY $base"
  psql_iso -f "$mig" >/dev/null
done

psql_iso -f supabase/seed.sql >/dev/null

run_suite() {
  local file="$1"
  echo "==> Running ${file}"
  psql_iso -f "$file"
  echo "    PASS ${file}"
}

run_suite "supabase/tests/mesa_complementarios_opcionales.sql"
run_suite "supabase/tests/rpc_cancelar_expediente_operativo.sql"
run_suite "supabase/tests/rpc_rechazar_etapa_operativa.sql"
run_suite "supabase/tests/rpc_reingreso_post_biometricos.sql"

echo "P094 B1 focused SQL: ALL PASSED"
