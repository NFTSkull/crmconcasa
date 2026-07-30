#!/usr/bin/env bash
# Runner aislado: mig 129 + suite Sheets + regresiones agenda (bio/capacity).
# Skip 061/078 (Auth UID Cloud ausente en local). Tras seed re-aplica conversión
# P124 (capacity_by_time) porque seed pisa el JSON sin claves por horario.
# NO ejecuta contra Cloud. NO escribe Google Sheets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
ADMIN_DB="${SUPABASE_ADMIN_DB:-postgres}"
ISOLATED_DB="${ISOLATED_DB_NAME:-crm_sheet_iso_$$}"
TMP_DIR="$(mktemp -d /tmp/crm-sheet-iso-XXXXXX)"
RUN_FIRMAS_MESSAGE_TESTS="${RUN_FIRMAS_MESSAGE_TESTS:-0}"

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

echo "==> Isolated agenda-sheet DB: ${ISOLATED_DB}"
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${ISOLATED_DB}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql_admin -c "DROP DATABASE IF EXISTS ${ISOLATED_DB};"
psql_admin -c "CREATE DATABASE ${ISOLATED_DB};"

DB_CONTAINER="$(docker ps --filter "publish=${DB_PORT}" --format '{{.Names}}' | head -1 || true)"
if [[ -z "${DB_CONTAINER}" ]]; then
  # Fallback: nombre explícito del proyecto CRM local
  DB_CONTAINER="$(docker ps --format '{{.Names}}' | rg -m1 'supabase_db_Copia_de_concasa_crm' || true)"
fi
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "ERROR: no se encontró contenedor supabase_db_* en puerto ${DB_PORT}"
  exit 1
fi
echo "==> DB container: ${DB_CONTAINER}"

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
SQL

echo "==> Applying migrations (skip 061, 078)"
shopt -s nullglob
for mig in supabase/migrations/*.sql; do
  base="$(basename "$mig")"
  [[ "$base" == 061_* ]] && continue
  [[ "$base" == 078_profile_asesor_mejoravit.sql ]] && continue
  psql_iso -f "$mig" >/dev/null
done

echo "==> Seed"
psql_iso -f supabase/seed.sql >/dev/null

echo "==> Re-apply P124 capacity_by_time after seed overwrite"
psql_iso <<'SQL'
DO $$
DECLARE
  v_row RECORD;
  v_config JSONB;
  v_slots JSONB;
  v_locations JSONB;
  v_slot TEXT;
  v_loc_id TEXT;
  v_loc JSONB;
  v_cbt JSONB;
  v_general INTEGER;
  v_changed BOOLEAN;
BEGIN
  FOR v_row IN
    SELECT id, config FROM public.agenda_config WHERE kind IN ('biometricos', 'firmas')
  LOOP
    v_config := v_row.config;
    v_slots := COALESCE(v_config->'slots', '[]'::jsonb);
    v_locations := COALESCE(v_config->'locations', '{}'::jsonb);
    v_changed := false;
    FOR v_loc_id IN SELECT jsonb_object_keys(v_locations)
    LOOP
      v_loc := v_locations->v_loc_id;
      IF COALESCE((v_loc->>'enabled')::boolean, false) IS NOT TRUE THEN
        CONTINUE;
      END IF;
      v_cbt := COALESCE(v_loc->'capacity_by_time', '{}'::jsonb);
      IF jsonb_typeof(v_cbt) <> 'object' THEN
        v_cbt := '{}'::jsonb;
      END IF;
      BEGIN
        v_general := GREATEST(1, COALESCE((v_loc->>'capacity_per_slot')::integer, 1));
      EXCEPTION WHEN OTHERS THEN
        v_general := 1;
      END;
      FOR v_slot IN SELECT jsonb_array_elements_text(v_slots)
      LOOP
        IF NOT (v_cbt ? v_slot) THEN
          v_cbt := v_cbt || jsonb_build_object(v_slot, v_general);
          v_changed := true;
        END IF;
      END LOOP;
      v_locations := jsonb_set(v_locations, ARRAY[v_loc_id, 'capacity_by_time'], v_cbt, true);
    END LOOP;
    IF v_changed THEN
      UPDATE public.agenda_config
      SET config = jsonb_set(v_config, '{locations}', v_locations, true),
          updated_at = NOW()
      WHERE id = v_row.id;
    END IF;
  END LOOP;
END $$;
SQL

# Inventario fresco ANTES de suites que reservan (>= 2026-07-30).
# Sin esto book/assert fallan con SIN_CUPO_REAL_EN_SHEET (fail-closed).
seed_inventory_available() {
  echo "==> Seed inventory disponible ($1)"
  psql_iso <<'SQL'
DO $$
DECLARE
  v_org UUID;
  v_d DATE;
  v_t TIME;
  v_row INTEGER := 1;
  v_times TIME[] := ARRAY[
    '08:00'::TIME, '08:30'::TIME, '09:00'::TIME, '09:30'::TIME, '10:00'::TIME,
    '11:00'::TIME, '12:00'::TIME, '13:00'::TIME, '14:00'::TIME,
    '15:00'::TIME, '16:00'::TIME, '17:00'::TIME
  ];
  v_kind TEXT;
  v_loc TEXT;
  v_i INTEGER;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at NULLS LAST, id LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'inventory seed: sin org, skip';
    RETURN;
  END IF;

  FOR v_d IN SELECT generate_series(CURRENT_DATE, CURRENT_DATE + 60, '1 day')::DATE LOOP
    IF NOT public.agenda_sheet_inventory_enforced(v_d) THEN
      CONTINUE;
    END IF;
    FOREACH v_kind IN ARRAY ARRAY['biometricos', 'firmas'] LOOP
      FOREACH v_loc IN ARRAY ARRAY['monterrey', 'apodaca'] LOOP
        FOR v_i IN 1..array_length(v_times, 1) LOOP
          v_t := v_times[v_i];
          -- 8 filas físicas disponibles por horario (cubre capacity típica de tests)
          FOR v_row IN 1..8 LOOP
            INSERT INTO public.agenda_sheet_slot_inventory (
              organization_id, spreadsheet_id, sheet_id, sheet_title,
              booking_date, sheet_row, kind, location_id, slot_time, slot_key,
              status, occupancy_source, observed_at, booking_id, expediente_id,
              claimed_at, linked_at, last_error
            ) VALUES (
              v_org,
              'iso-inventory-seed',
              (EXTRACT(EPOCH FROM v_d)::BIGINT * 100
                + CASE v_kind WHEN 'biometricos' THEN 10 ELSE 20 END
                + CASE v_loc WHEN 'monterrey' THEN 1 ELSE 2 END),
              'ISO ' || v_d::TEXT,
              v_d,
              (EXTRACT(EPOCH FROM v_d)::INTEGER % 100000) * 100
                + (CASE v_kind WHEN 'biometricos' THEN 0 ELSE 40 END)
                + (CASE v_loc WHEN 'monterrey' THEN 0 ELSE 20 END)
                + v_i * 10 + v_row,
              v_kind,
              v_loc,
              v_t,
              v_kind || '|' || v_loc || '|' || v_d::TEXT || '|' || to_char(v_t, 'HH24:MI') || '|' || v_row,
              'available',
              'reconciliation',
              NOW(),
              NULL,
              NULL,
              NULL,
              NULL,
              NULL
            )
            ON CONFLICT (spreadsheet_id, sheet_id, sheet_row) DO UPDATE
            SET
              status = 'available',
              booking_id = NULL,
              expediente_id = NULL,
              claimed_at = NULL,
              linked_at = NULL,
              last_error = NULL,
              occupancy_source = 'reconciliation',
              observed_at = NOW(),
              updated_at = NOW();
          END LOOP;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
SQL
}

seed_inventory_available "pre-suites"

echo "==> Sheet inventory structural (mig. 131)"
psql_iso -f supabase/tests/rpc_agenda_sheet_slot_inventory.sql

echo "==> Sheet sync suite"
psql_iso -f supabase/tests/rpc_agenda_sheet_sync.sql

seed_inventory_available "post-sheet-sync (refresco claimed)"

echo "==> Agenda regressions (bio + capacity)"
psql_iso -f supabase/tests/rpc_book_biometricos.sql >/dev/null
psql_iso -f supabase/tests/rpc_biometricos_cancel_reagendar.sql >/dev/null
psql_iso -f supabase/tests/rpc_agenda_capacity_by_time_p123.sql >/dev/null
psql_iso -f supabase/tests/rpc_agenda_slot_capacities.sql >/dev/null

echo "==> Firmas funcional (sin asserts de mensaje desfasados)"
psql_iso -f supabase/tests/rpc_agenda_sheet_firmas_functional.sql

if [[ "$RUN_FIRMAS_MESSAGE_TESTS" == "1" ]]; then
  echo "==> rpc_book_firmas (incluye asserts de mensaje; puede fallar preexistente)"
  psql_iso -f supabase/tests/rpc_book_firmas.sql >/dev/null
  psql_iso -f supabase/tests/rpc_firmas_cancel_reagendar.sql >/dev/null
fi

echo "AGENDA_SHEET_ISOLATED_SQL_PASS"
