#!/usr/bin/env bash
# Reset local Supabase fresco para suites SQL (P078 + seed canónico + P212 contract OFF).
# NO modifica migraciones productivas (078/212). NO Cloud.
#
# Particularidades locales:
# - P078 exige Auth UID Cloud ausente en Auth fresco → prereq + apply manual.
# - P173 ADD VALUE enum + uso en el mismo archivo falla bajo tx del CLI (55P04)
#   → reset hasta 172, luego 173…212 vía psql (autocommit por statement).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"

M078_REL="supabase/migrations/078_profile_asesor_mejoravit.sql"
M078="$ROOT/$M078_REL"
PREREQ="$ROOT/scripts/fixtures/p078-local-prereq.sql"
HOLD=""

psql_local() {
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

migration_version() {
  local base="$1"
  echo "${base%%_*}"
}

migration_name() {
  local base="$1"
  local without_ext="${base%.sql}"
  echo "${without_ext#*_}"
}

register_migration() {
  local file="$1"
  local base
  base="$(basename "$file")"
  local ver name
  ver="$(migration_version "$base")"
  name="$(migration_name "$base")"
  psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('${ver}', '${name}')
    ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;"
}

restore_m078() {
  if [[ -n "${HOLD}" && -f "${HOLD}" ]]; then
    if [[ ! -f "$M078" ]]; then
      mv "$HOLD" "$M078"
      echo "==> Restored ${M078_REL}"
    else
      rm -f "$HOLD"
    fi
  fi
}
trap restore_m078 EXIT

if [[ ! -f "$M078" ]]; then
  echo "ERROR: missing ${M078_REL}" >&2
  exit 1
fi
if [[ ! -f "$PREREQ" ]]; then
  echo "ERROR: missing scripts/fixtures/p078-local-prereq.sql" >&2
  exit 1
fi

echo "==> Ensure local Supabase is running"
npx supabase start >/tmp/crm-reset-supabase-start.log 2>&1 || true

echo "==> Defer P078 during db reset (Auth UID Cloud ausente en Auth fresco)"
HOLD="$(mktemp /tmp/crm-m078-XXXXXX.sql)"
mv "$M078" "$HOLD"

echo "==> supabase db reset --version 172 --no-seed (evita 173 enum-in-tx 55P04)"
npx supabase db reset --yes --local --no-seed --version 172

echo "==> Restore P078 file"
mv "$HOLD" "$M078"
HOLD=""

echo "==> Insert P078 prereq (auth.users + org Cloud id)"
psql_local -f "$PREREQ"

echo "==> Apply P078 + register schema_migrations"
psql_local -f "$M078"
register_migration "$M078"

echo "==> Apply migrations 173→212 via psql (autocommit; 173 enum safe)"
shopt -s nullglob
for file in "$ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$file")"
  ver="$(migration_version "$base")"
  # numeric compare: only 173..212
  if [[ "$ver" =~ ^[0-9]+$ ]] && ((10#$ver >= 173 && 10#$ver <= 212)); then
    echo "    -> ${base}"
    psql_local -f "$file" >/tmp/crm-mig-"$ver".log
    register_migration "$file"
  fi
done

echo "==> Seed (remount org Cloud → id canónico de tests)"
psql_local -f "$ROOT/supabase/seed.sql"

echo "==> Re-apply P124 capacity_by_time (seed pisa JSON sin claves por horario)"
psql_local -f "$ROOT/scripts/fixtures/reapply-p124-capacity-by-time.sql"

echo "==> Seed agenda sheet inventory disponible (evita SIN_CUPO_REAL_EN_SHEET)"
psql_local -f "$ROOT/scripts/fixtures/seed-agenda-sheet-inventory-available.sql"

echo "==> Force P212 contract OFF (INSTALL / Fase 3A)"
psql_local <<'SQL'
UPDATE public.agenda_firmas_daily_cap_contract
SET enabled = FALSE,
    effective_from = NULL,
    enabled_at = NULL,
    note = 'local reset: INSTALL contract OFF',
    updated_at = NOW()
WHERE singleton;
SQL

echo "==> Verify fresh local DB"
psql_local <<'SQL'
DO $$
DECLARE
  v_org uuid;
  v_slug text;
  v_uid uuid;
  v_enabled boolean;
  v_max text;
  v_078 boolean;
BEGIN
  SELECT o.id, o.slug INTO v_org, v_slug
  FROM public.organizations o
  WHERE o.slug = 'concasa';

  IF v_org IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'seed org id mismatch: % (expected canonical seed id)', v_org;
  END IF;

  SELECT u.id INTO v_uid
  FROM auth.users u
  WHERE u.id = '6e48ff6b-5bb2-4418-8ffc-8a67df5cc57a'::uuid;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'P078 auth user missing after reset';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '078'
  ) INTO v_078;
  IF NOT v_078 THEN
    RAISE EXCEPTION 'migration 078 not registered';
  END IF;

  SELECT version INTO v_max
  FROM supabase_migrations.schema_migrations
  ORDER BY version DESC
  LIMIT 1;
  IF v_max IS DISTINCT FROM '212' THEN
    RAISE EXCEPTION 'expected max migration 212, got %', v_max;
  END IF;

  SELECT c.enabled INTO v_enabled
  FROM public.agenda_firmas_daily_cap_contract c
  WHERE c.singleton;
  IF v_enabled IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'P212 contract must be OFF after reset (got %)', v_enabled;
  END IF;

  RAISE NOTICE 'reset-local-db-fresh OK org=% slug=% contract_off=% max_mig=%',
    v_org, v_slug, v_enabled, v_max;
END;
$$;
SQL

echo "==> Fresh local DB ready (P078 applied, seed canónico, contract OFF)"
