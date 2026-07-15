#!/usr/bin/env bash
# Runner aislado para preflight P071/P072.
# - Crea una base descartable en el Postgres local de Supabase.
# - Carga esquemas base (auth/storage/extensions) sin datos públicos.
# - Aplica migraciones productivas omitiendo expresamente 061.
# - Aplica 071 y 072, carga seed, corre suites y destruye la base.
# No modifica la migración 061 ni reutiliza la base contaminada "postgres".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
ADMIN_DB="${SUPABASE_ADMIN_DB:-postgres}"
ISOLATED_DB="${ISOLATED_DB_NAME:-crm_preflight_reingreso_$$}"
SKIP_MIGRATION_PREFIX="061_"
TMP_DIR="$(mktemp -d /tmp/crm-preflight-XXXXXX)"
BASE_SCHEMA_DUMP="$TMP_DIR/base_schemas.sql"
LOG_FILE="$TMP_DIR/runner.log"
FAILED=0

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
  echo ""
  echo "==> Cleanup: drop database ${ISOLATED_DB}"
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

echo "==> Isolated preflight DB: ${ISOLATED_DB}"
echo "    host=${DB_HOST} port=${DB_PORT}"
echo "    skip migration prefix: ${SKIP_MIGRATION_PREFIX}"
echo "    log: ${LOG_FILE}"

# Drop leftover same name if any
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${ISOLATED_DB}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql_admin -c "DROP DATABASE IF EXISTS ${ISOLATED_DB};" >/dev/null
psql_admin -c "CREATE DATABASE ${ISOLATED_DB};"

echo "==> Dumping base schemas (auth/storage/extensions/vault) schema-only from local Supabase"
# pg_dump del host suele ser más viejo que el Postgres 17 del contenedor.
DB_CONTAINER="$(docker ps --format '{{.Names}}' | rg -m1 'supabase_db_' || true)"
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "ERROR: no se encontró contenedor supabase_db_*"
  exit 1
fi
echo "    using container pg_dump: ${DB_CONTAINER}"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" pg_dump \
  -U "$DB_USER" -d "$ADMIN_DB" \
  --schema-only --no-owner --no-privileges \
  --schema=auth \
  --schema=storage \
  --schema=extensions \
  --schema=vault \
  > "$BASE_SCHEMA_DUMP"

echo "==> Restoring base schemas into isolated DB"
psql_iso -v ON_ERROR_STOP=0 -f "$BASE_SCHEMA_DUMP" >>"$LOG_FILE" 2>&1 || true

# Ensure auth.uid() exists even if dump missed ownership details
psql_iso <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'authenticated'
  );
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
  ) THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'anon'
  ) THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'service_role'
  ) THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

-- El dump --no-privileges omite ACLs de Storage; los tests/fixtures
-- insertan objects como authenticated/postgres.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.objects TO postgres, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON TABLE storage.objects TO anon';
  END IF;
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.buckets TO postgres, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON TABLE storage.buckets TO anon';
  END IF;
END$$;
SQL

echo "==> Applying productive migrations (skip ${SKIP_MIGRATION_PREFIX}*)"
APPLIED=()
SKIPPED=()
shopt -s nullglob
for mig in supabase/migrations/*.sql; do
  base="$(basename "$mig")"
  if [[ "$base" == ${SKIP_MIGRATION_PREFIX}* ]]; then
    SKIPPED+=("$base")
    echo "    SKIP  $base"
    continue
  fi
  echo "    APPLY $base"
  if ! psql_iso -f "$mig" >>"$LOG_FILE" 2>&1; then
    echo "ERROR applying $base — see $LOG_FILE"
    tail -40 "$LOG_FILE"
    exit 1
  fi
  APPLIED+=("$base")
done

echo "==> Applied ${#APPLIED[@]} migrations; skipped ${#SKIPPED[@]}"
printf '    APPLIED: %s\n' "${APPLIED[@]}"
printf '    SKIPPED: %s\n' "${SKIPPED[@]}"

echo "==> Loading seed.sql"
psql_iso -f supabase/seed.sql >>"$LOG_FILE" 2>&1

echo "==> Sanity counts after seed"
psql_iso -c "SELECT
  (SELECT count(*) FROM public.expedientes) AS expedientes,
  (SELECT count(*) FROM public.profiles) AS profiles,
  (SELECT count(*) FROM public.organizations) AS orgs;"

run_suite() {
  local file="$1"
  echo "==> Running ${file}"
  if psql_iso -f "$file" >>"$LOG_FILE" 2>&1; then
    echo "    PASS ${file}"
  else
    echo "    FAIL ${file}"
    FAILED=1
    echo "----- last log lines -----"
    tail -60 "$LOG_FILE"
  fi
}

echo "==> SQL suites (clean isolated DB)"
# Captura detallada de RLS antes de continuar.
echo "==> Running supabase/tests/rls_policies.sql (capturing full output)"
if psql_iso -f "supabase/tests/rls_policies.sql" | tee "$TMP_DIR/rls_policies.out"; then
  echo "    PASS supabase/tests/rls_policies.sql"
  cp "$TMP_DIR/rls_policies.out" /tmp/preflight-rls-policies.out
else
  echo "    FAIL supabase/tests/rls_policies.sql"
  FAILED=1
  cp "$TMP_DIR/rls_policies.out" /tmp/preflight-rls-policies.out 2>/dev/null || true
fi

run_suite "supabase/tests/rpc_rechazar_etapa_operativa.sql"
run_suite "supabase/tests/rpc_reingreso_post_biometricos.sql"
run_suite "supabase/tests/rpc_register_expediente_documento.sql"
run_suite "supabase/tests/rpc_register_expediente_documento_retencion.sql"
run_suite "supabase/tests/rpc_convert_biometricos_to_notificacion.sql"
run_suite "supabase/tests/rpc_upsert_editor_decision.sql"
run_suite "supabase/tests/rpc_avanzar_etapa_5_6.sql"
run_suite "supabase/tests/rpc_avanzar_etapa_6_7.sql"
run_suite "supabase/tests/rpc_avanzar_etapa_operativa.sql"

echo "==> Privilege probe after suites"
psql_iso <<'SQL' | tee /tmp/preflight-pre-reingreso-privileges.out
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE '%pre_reingreso%'
ORDER BY 1;

-- Internas de reingreso (P073): ningún rol de aplicación debe tener EXECUTE.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.proacl,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
       has_function_privilege('postgres', p.oid, 'EXECUTE') AS postgres_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'es_reingreso_post_biometricos_valido',
    'reingreso_documentos_reutilizables',
    'reingreso_post_biometricos_elegibilidad_interna'
  )
ORDER BY p.proname;

SELECT 'avanzar_pre' AS fn,
  has_function_privilege('anon','public.avanzar_etapa_operativa_pre_reingreso(uuid,text)','EXECUTE') AS anon_x,
  has_function_privilege('authenticated','public.avanzar_etapa_operativa_pre_reingreso(uuid,text)','EXECUTE') AS auth_x,
  has_function_privilege('service_role','public.avanzar_etapa_operativa_pre_reingreso(uuid,text)','EXECUTE') AS service_x
UNION ALL SELECT 'editor_pre',
  has_function_privilege('anon','public.upsert_editor_decision_pre_reingreso(uuid,editor_decision,numeric,text)','EXECUTE'),
  has_function_privilege('authenticated','public.upsert_editor_decision_pre_reingreso(uuid,editor_decision,numeric,text)','EXECUTE'),
  has_function_privilege('service_role','public.upsert_editor_decision_pre_reingreso(uuid,editor_decision,numeric,text)','EXECUTE')
UNION ALL SELECT 'register_pre',
  has_function_privilege('anon','public.register_expediente_documento_pre_reingreso(uuid,text,text,text,text,bigint)','EXECUTE'),
  has_function_privilege('authenticated','public.register_expediente_documento_pre_reingreso(uuid,text,text,text,text,bigint)','EXECUTE'),
  has_function_privilege('service_role','public.register_expediente_documento_pre_reingreso(uuid,text,text,text,text,bigint)','EXECUTE');
SQL

echo ""
echo "==> Isolated runner summary"
echo "    DB: ${ISOLATED_DB}"
echo "    migrations_applied: ${#APPLIED[@]}"
echo "    migrations_skipped: ${#SKIPPED[@]} (${SKIPPED[*]})"
if [[ "$FAILED" -eq 0 ]]; then
  echo "    ALL SUITES PASSED"
  exit 0
fi
echo "    SOME SUITES FAILED (exit 1)"
exit 1
