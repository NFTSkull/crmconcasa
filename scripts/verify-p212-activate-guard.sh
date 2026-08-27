#!/usr/bin/env bash
# Verifica scripts/p212-activate-firmas.sql:
#  A) as_of=2026-08-27 → FAIL + 0 writes
#  B) as_of=2026-09-01 → PASS en TX + ROLLBACK
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
export PGPASSWORD="$DB_PASSWORD"
PSQL=(psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q)

SCRIPT="$ROOT/scripts/p212-activate-firmas.sql"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
sed -e '/^BEGIN;/d' -e '/^COMMIT;/d' "$SCRIPT" > "$BODY"

prep_legacy() {
  "${PSQL[@]}" <<'SQL'
UPDATE public.agenda_firmas_daily_cap_contract
SET enabled=false, effective_from=NULL, enabled_at=NULL, updated_at=now()
WHERE singleton;

INSERT INTO public.agenda_daily_capacity_rules (kind, location_id, capacity)
VALUES ('biometricos','monterrey',15),('firmas','monterrey',15),('firmas','apodaca',15)
ON CONFLICT (kind, location_id) DO UPDATE SET capacity = EXCLUDED.capacity, updated_at=now();

UPDATE public.agenda_config
SET config = jsonb_set(
  jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{slots}',
    '["08:30","09:00","09:30","10:00","10:30"]'::jsonb,
    true
  ),
  '{locations}',
  COALESCE(config->'locations', '{}'::jsonb) || jsonb_build_object(
    'monterrey', COALESCE(config->'locations'->'monterrey', '{}'::jsonb) || jsonb_build_object(
      'enabled', true,
      'capacity_by_time', jsonb_build_object('08:30',5,'09:00',5,'09:30',6,'10:00',6)
    ),
    'apodaca', COALESCE(config->'locations'->'apodaca', '{}'::jsonb) || jsonb_build_object(
      'enabled', true,
      'capacity_by_time', jsonb_build_object('08:30',0,'09:00',0,'10:00',5,'10:30',3)
    )
  ),
  true
),
updated_at = now()
WHERE kind = 'firmas';
SQL
}

echo "==> A) pre-Sep must block"
prep_legacy
SNAP="$("${PSQL[@]}" -Atc "
SELECT enabled::text||'|'||coalesce(effective_from::text,'NULL')||'|'||
  (SELECT md5(string_agg(organization_id::text||'|'||config::text, ',' ORDER BY organization_id))
   FROM agenda_config WHERE kind='firmas')
FROM agenda_firmas_daily_cap_contract WHERE singleton;
")"

set +e
OUT="$("${PSQL[@]}" -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL app.p212_activate_as_of = '2026-08-27';
$(cat "$BODY")
COMMIT;
SQL
)"
EC=$?
set -e
echo "$OUT" | tail -20
echo "$OUT" | grep -q 'P212 activation blocked before 2026-09-01' || {
  echo "FAIL: expected block message"; exit 1;
}
test "$EC" -ne 0 || { echo "FAIL: expected non-zero exit"; exit 1; }

SNAP2="$("${PSQL[@]}" -Atc "
SELECT enabled::text||'|'||coalesce(effective_from::text,'NULL')||'|'||
  (SELECT md5(string_agg(organization_id::text||'|'||config::text, ',' ORDER BY organization_id))
   FROM agenda_config WHERE kind='firmas')
FROM agenda_firmas_daily_cap_contract WHERE singleton;
")"
test "$SNAP" = "$SNAP2" || { echo "FAIL: state changed after pre-Sep ($SNAP vs $SNAP2)"; exit 1; }
echo "pre-Sep OK"

echo "==> B) Sep-01 activates inside TX then ROLLBACK"
prep_legacy
"${PSQL[@]}" <<SQL
BEGIN;
SET LOCAL app.p212_activate_as_of = '2026-09-01';
$(cat "$BODY")
DO \$\$
BEGIN
  IF NOT (SELECT enabled FROM agenda_firmas_daily_cap_contract WHERE singleton) THEN
    RAISE EXCEPTION 'Sep-01: contract not enabled';
  END IF;
  IF (SELECT effective_from FROM agenda_firmas_daily_cap_contract WHERE singleton)
       IS DISTINCT FROM DATE '2026-09-01' THEN
    RAISE EXCEPTION 'Sep-01: effective_from != 2026-09-01';
  END IF;
  IF EXISTS (
    SELECT 1 FROM agenda_config
    WHERE kind='firmas'
      AND config->'slots' IS DISTINCT FROM '["08:00","09:00","10:00"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Sep-01: slots not target';
  END IF;
  IF EXISTS (
    SELECT 1 FROM agenda_config
    WHERE kind='firmas'
      AND (
        config#>'{locations,monterrey,capacity_by_time}'
          IS DISTINCT FROM '{"08:00":5,"09:00":5,"10:00":5}'::jsonb
        OR config#>'{locations,apodaca,capacity_by_time}'
          IS DISTINCT FROM '{"08:00":5,"09:00":5,"10:00":5}'::jsonb
      )
  ) THEN
    RAISE EXCEPTION 'Sep-01: capacity_by_time not 5/5/5 per sede';
  END IF;
END;
\$\$;
ROLLBACK;
SQL

"${PSQL[@]}" -c "
UPDATE public.agenda_firmas_daily_cap_contract
SET enabled=false, effective_from=NULL, enabled_at=NULL,
    note='P212: OFF after verify-p212-activate-guard', updated_at=now()
WHERE singleton;
SELECT 'durable_contract_enabled='||enabled::text FROM agenda_firmas_daily_cap_contract WHERE singleton;
"

# Restore legacy slots if Sep path somehow leaked (should not — rolled back)
SNAP3="$("${PSQL[@]}" -Atc "SELECT CASE WHEN enabled THEN 't' ELSE 'f' END FROM agenda_firmas_daily_cap_contract WHERE singleton")"
test "$SNAP3" = "f" || { echo "FAIL: contract not OFF after verify (got $SNAP3)"; exit 1; }

echo "P212 activate guard: ALL PASSED"
