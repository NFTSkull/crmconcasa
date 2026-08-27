#!/usr/bin/env bash
# P212 real concurrency race: two psql sessions against local Supabase.
# Usage: bash scripts/p212-concurrency-race.sh
set -euo pipefail

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
PSQL=(env PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -qAt)

run() { "${PSQL[@]}" -c "$1"; }

echo "==> P212 concurrency race against ${DB_HOST}:${DB_PORT}"

# Ensure migration helpers exist
run "SELECT public.agenda_firmas_canonical_location_id('mty-centro');" >/dev/null

# Activación EXPLÍCITA del contrato (simula publish controlado; default mig=OFF).
run "UPDATE public.agenda_firmas_daily_cap_contract
      SET enabled = TRUE,
          effective_from = DATE '2026-09-01',
          enabled_at = NOW(),
          note = 'P212 race enable',
          updated_at = NOW()
      WHERE singleton;"

ORG='00000000-0000-4000-8212-00000000aace'
ASESOR='00000000-0000-4000-8212-00000000aa51'
DATE_H='2026-09-22'
DATE_D='2026-09-23'

setup_org() {
  run "INSERT INTO public.organizations (id, slug, name, active) VALUES ('$ORG', 'p212-race', 'P212 Race', true) ON CONFLICT (id) DO UPDATE SET active=true;"
  run "INSERT INTO public.profiles (id, organization_id, email, app_role, active, full_name)
       VALUES ('$ASESOR', '$ORG', 'p212.race@local.test', 'asesor', true, 'Race') ON CONFLICT (id) DO UPDATE SET active=true;"
  run "INSERT INTO public.agenda_config (organization_id, kind, config) VALUES ('$ORG', 'firmas',
    jsonb_build_object(
      'enabled', true, 'timezone', 'America/Monterrey', 'min_lead_hours', 0,
      'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
      'locations', jsonb_build_object(
        'monterrey', jsonb_build_object('enabled', true, 'capacity_by_time', jsonb_build_object('08:00',5,'09:00',5,'10:00',5)),
        'apodaca', jsonb_build_object('enabled', true, 'capacity_by_time', jsonb_build_object('08:00',5,'09:00',5,'10:00',5))
      ),
      'slots', jsonb_build_array('08:00','09:00','10:00')
    )) ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config;"
}

seed_inventory() {
  local date="$1" loc="$2" time="$3" base="$4" n="$5"
  local i
  for i in $(seq 1 "$n"); do
    run "INSERT INTO public.agenda_sheet_slot_inventory (
      organization_id, spreadsheet_id, sheet_id, sheet_title,
      booking_date, sheet_row, kind, location_id, slot_time, slot_key,
      status, occupancy_source, observed_at
    ) VALUES (
      '$ORG', 'race', 1, 'Race Tab',
      '$date', $((base+i)), 'firmas', '$loc', '$time'::time,
      format('race|%s|%s|%s|%s', '$date', '$loc', '$time', $((base+i))),
      'available', 'reconciliation', NOW()
    ) ON CONFLICT DO NOTHING;" 2>/dev/null || true
  done
}

clear_day() {
  local date="$1"
  run "DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id IN (
        SELECT id FROM public.expedientes WHERE organization_id='$ORG');"
  run "DELETE FROM public.agenda_sheet_slot_inventory WHERE organization_id='$ORG' AND booking_date='$date';"
  run "DELETE FROM public.agenda_bookings WHERE organization_id='$ORG' AND booking_date='$date';"
  run "DELETE FROM public.expedientes WHERE organization_id='$ORG'
        AND id NOT IN (SELECT expediente_id FROM public.agenda_bookings WHERE organization_id='$ORG');"
}

seed_bookings() {
  local date="$1" loc="$2" time="$3" n="$4"
  local i exp nss prefix
  prefix=$(echo -n "${date}${loc}${time}" | cksum | awk '{print $1}')
  for i in $(seq 1 "$n"); do
    exp=$(run "SELECT gen_random_uuid();")
    nss=$(printf '%011d' $(( (prefix + i) % 100000000000 )))
    run "INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
      etapa_actual, subestado, ciclo_estado
    ) VALUES (
      '$exp', '$ORG', '$ASESOR', 'mejoravit', '$nss', 'Race',
      '5557000001', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
    ) ON CONFLICT (id) DO NOTHING;"
    run "INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
    ) VALUES (
      '$ORG', 'firmas', '$exp', '$date', '$time'::time, '$loc', 'booked', '$ASESOR'
    );"
  done
}

race_assert() {
  local label="$1" date="$2" loc="$3" time="$4" expect_count="$5"
  local ts
  ts=$(run "SELECT (('${date}'::date + '${time}'::time) AT TIME ZONE 'America/Monterrey')::text;")

  local out1 out2
  # Two concurrent sessions: both try assert+insert
  (
    run "DO \$\$
    DECLARE
      v_exp UUID := gen_random_uuid();
    BEGIN
      INSERT INTO public.expedientes (
        id, organization_id, asesor_id, programa, nss, cliente_nombre,
        telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
        etapa_actual, subestado, ciclo_estado
      ) VALUES (
        v_exp, '$ORG', '$ASESOR', 'mejoravit',
        lpad((floor(random()*1000000000))::bigint::text, 11, '7'),
        'RaceA', '5557000002', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
      );
      PERFORM public.agenda_firmas_assert_slot_available('$ORG'::uuid, '${ts}'::timestamptz, '${loc}');
      INSERT INTO public.agenda_bookings (
        organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
      ) VALUES (
        '$ORG', 'firmas', v_exp, '${date}', '${time}'::time, '${loc}', 'booked', '$ASESOR'
      );
    END \$\$;" && echo OK || echo FAIL
  ) > /tmp/p212-race-a.out 2>&1 &
  local pid_a=$!
  (
    run "DO \$\$
    DECLARE
      v_exp UUID := gen_random_uuid();
    BEGIN
      INSERT INTO public.expedientes (
        id, organization_id, asesor_id, programa, nss, cliente_nombre,
        telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
        etapa_actual, subestado, ciclo_estado
      ) VALUES (
        v_exp, '$ORG', '$ASESOR', 'mejoravit',
        lpad((floor(random()*1000000000))::bigint::text, 11, '8'),
        'RaceB', '5557000003', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
      );
      PERFORM public.agenda_firmas_assert_slot_available('$ORG'::uuid, '${ts}'::timestamptz, '${loc}');
      INSERT INTO public.agenda_bookings (
        organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
      ) VALUES (
        '$ORG', 'firmas', v_exp, '${date}', '${time}'::time, '${loc}', 'booked', '$ASESOR'
      );
    END \$\$;" && echo OK || echo FAIL
  ) > /tmp/p212-race-b.out 2>&1 &
  local pid_b=$!
  wait $pid_a || true
  wait $pid_b || true
  out1=$(tail -1 /tmp/p212-race-a.out)
  out2=$(tail -1 /tmp/p212-race-b.out)
  local ok_count=0
  [[ "$out1" == "OK" ]] && ok_count=$((ok_count+1))
  [[ "$out2" == "OK" ]] && ok_count=$((ok_count+1))
  local final
  final=$(run "SELECT COUNT(*) FROM public.agenda_bookings
    WHERE organization_id='$ORG' AND booking_date='$date' AND location_id='$loc'
      AND booking_time='${time}'::time AND status='booked';")
  echo "RACE $label: winners=$ok_count final_count=$final (expect winners=1 count=$expect_count)"
  if [[ "$ok_count" -ne 1 ]] || [[ "$final" -ne "$expect_count" ]]; then
    echo "FAIL detail A:"; cat /tmp/p212-race-a.out
    echo "FAIL detail B:"; cat /tmp/p212-race-b.out
    exit 1
  fi
}

setup_org

# --- Caso A hourly Monterrey 08:00: 4 booked → race for #5 ---
clear_day "$DATE_H"
seed_inventory "$DATE_H" monterrey 08:00 100 6
seed_inventory "$DATE_H" apodaca 08:00 200 6
seed_bookings "$DATE_H" monterrey 08:00 4
race_assert "MTY-08:00-hourly" "$DATE_H" monterrey 08:00 5

# --- Caso A hourly Apodaca 08:00 ---
clear_day "$DATE_H"
seed_inventory "$DATE_H" apodaca 08:00 300 6
seed_bookings "$DATE_H" apodaca 08:00 4
race_assert "APO-08:00-hourly" "$DATE_H" apodaca 08:00 5

# --- Caso B daily Monterrey: 14 → race for #15 ---
clear_day "$DATE_D"
seed_inventory "$DATE_D" monterrey 08:00 400 5
seed_inventory "$DATE_D" monterrey 09:00 410 5
seed_inventory "$DATE_D" monterrey 10:00 420 5
# 14 bookings: mix target + legacy times (legacy still counts daily)
seed_bookings "$DATE_D" monterrey 08:00 4
seed_bookings "$DATE_D" monterrey 09:00 4
seed_bookings "$DATE_D" monterrey 10:00 3
# 3 legacy via mty-centro (count daily; need real expedientes + monterrey inventory)
seed_inventory "$DATE_D" monterrey 08:30 430 3
for i in 1 2 3; do
  run "DO \$\$
  DECLARE v_exp UUID := gen_random_uuid();
  BEGIN
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
      etapa_actual, subestado, ciclo_estado
    ) VALUES (
      v_exp, '$ORG', '$ASESOR', 'mejoravit',
      lpad((90000000000 + $i)::text, 11, '9'),
      'Legacy', '5557000004', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
    );
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
    ) VALUES (
      '$ORG', 'firmas', v_exp, '$DATE_D', '08:30'::time, 'mty-centro', 'booked', '$ASESOR'
    );
  END \$\$;"
done
# occupancy should be 14
occ=$(run "SELECT public.agenda_firmas_daily_active_occupancy('$ORG'::uuid, '$DATE_D'::date, 'monterrey');")
echo "pre-daily-race occupancy=$occ (expect 14)"
[[ "$occ" == "14" ]] || { echo "prestate occupancy != 14"; exit 1; }

# race for daily #15 at 10:00 (still has hourly room)
(
  run "DO \$\$
  DECLARE v_exp UUID := gen_random_uuid();
  BEGIN
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
      etapa_actual, subestado, ciclo_estado
    ) VALUES (
      v_exp, '$ORG', '$ASESOR', 'mejoravit',
      lpad((floor(random()*1000000000))::bigint::text, 11, '6'),
      'DailyA', '5557000005', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
    );
    PERFORM public.agenda_firmas_assert_slot_available(
      '$ORG'::uuid,
      (('${DATE_D}'::date + '10:00'::time) AT TIME ZONE 'America/Monterrey'),
      'monterrey'
    );
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
    ) VALUES (
      '$ORG', 'firmas', v_exp, '${DATE_D}', '10:00'::time, 'monterrey', 'booked', '$ASESOR'
    );
  END \$\$;" && echo OK || echo FAIL
) > /tmp/p212-race-a.out 2>&1 &
pid_a=$!
(
  run "DO \$\$
  DECLARE v_exp UUID := gen_random_uuid();
  BEGIN
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
      etapa_actual, subestado, ciclo_estado
    ) VALUES (
      v_exp, '$ORG', '$ASESOR', 'mejoravit',
      lpad((floor(random()*1000000000))::bigint::text, 11, '5'),
      'DailyB', '5557000006', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
    );
    PERFORM public.agenda_firmas_assert_slot_available(
      '$ORG'::uuid,
      (('${DATE_D}'::date + '10:00'::time) AT TIME ZONE 'America/Monterrey'),
      'monterrey'
    );
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
    ) VALUES (
      '$ORG', 'firmas', v_exp, '${DATE_D}', '10:00'::time, 'monterrey', 'booked', '$ASESOR'
    );
  END \$\$;" && echo OK || echo FAIL
) > /tmp/p212-race-b.out 2>&1 &
pid_b=$!
wait $pid_a || true
wait $pid_b || true
ok_count=0
[[ "$(tail -1 /tmp/p212-race-a.out)" == "OK" ]] && ok_count=$((ok_count+1))
[[ "$(tail -1 /tmp/p212-race-b.out)" == "OK" ]] && ok_count=$((ok_count+1))
final_occ=$(run "SELECT public.agenda_firmas_daily_active_occupancy('$ORG'::uuid, '$DATE_D'::date, 'monterrey');")
echo "RACE daily-MTY: winners=$ok_count final_occ=$final_occ (expect 1 / 15)"
if [[ "$ok_count" -ne 1 ]] || [[ "$final_occ" -ne 15 ]]; then
  cat /tmp/p212-race-a.out /tmp/p212-race-b.out
  exit 1
fi

# --- Caso C independence ---
# Monterrey full, Apodaca can book
clear_day "$DATE_D"
seed_inventory "$DATE_D" monterrey 08:00 500 5
seed_inventory "$DATE_D" monterrey 09:00 520 5
seed_inventory "$DATE_D" monterrey 10:00 540 5
seed_inventory "$DATE_D" apodaca 08:00 510 5
seed_bookings "$DATE_D" monterrey 08:00 5
seed_bookings "$DATE_D" monterrey 09:00 5
seed_bookings "$DATE_D" monterrey 10:00 5
run "SELECT public.agenda_firmas_assert_slot_available(
  '$ORG'::uuid,
  (('${DATE_D}'::date + '08:00'::time) AT TIME ZONE 'America/Monterrey'),
  'apodaca'
);" >/dev/null
echo "INDEPENDENCE: Apodaca OK while Monterrey full"

# cleanup race org
run "DELETE FROM public.agenda_sheet_slot_inventory WHERE organization_id='$ORG';"
run "DELETE FROM public.agenda_bookings WHERE organization_id='$ORG';"

# Restore INSTALL semantics (contract OFF) — race enables for ON-mode only.
run "UPDATE public.agenda_firmas_daily_cap_contract
      SET enabled = FALSE,
          effective_from = NULL,
          enabled_at = NULL,
          note = 'P212: restored OFF after concurrency race',
          updated_at = NOW()
      WHERE singleton;"

echo "P212 concurrency race: ALL PASSED"
