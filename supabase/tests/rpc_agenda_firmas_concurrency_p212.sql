-- P212 concurrency: DOS conexiones reales (dblink/advisory) — hourly + daily race.
-- Requiere: dblink extension O ejecución via psql -c en dos sessions.
-- Este archivo valida helpers; el race real se ejecuta con scripts/p212-concurrency-race.sh
\set ON_ERROR_STOP on

\ir ../migrations/212_agenda_firmas_daily_cap.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.__p212c_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P212 CONCURRENCY FAIL: %', p_msg; END IF;
END; $$;

DO $$
BEGIN
  -- Publish controlado (dato): enabled + effective_from. Sin fecha hardcode en SQL de producto.
  UPDATE public.agenda_firmas_daily_cap_contract
  SET enabled = TRUE,
      effective_from = DATE '2026-09-01',
      enabled_at = NOW(),
      updated_at = NOW()
  WHERE singleton;

  PERFORM public.__p212c_assert(
    public.agenda_firmas_canonical_location_id('mty-centro') = 'monterrey',
    'mty-centro'
  );
  PERFORM public.__p212c_assert(
    public.agenda_firmas_canonical_location_id('mty_centro') = 'monterrey',
    'mty_centro'
  );
  PERFORM public.__p212c_assert(
    public.agenda_firmas_canonical_location_id('sede-centro') = 'monterrey',
    'sede-centro'
  );
  PERFORM public.__p212c_assert(
    public.agenda_firmas_canonical_location_id('san-nicolas') = 'apodaca',
    'san-nicolas'
  );
  PERFORM public.__p212c_assert(
    public.agenda_firmas_canonical_location_id('san_nicolas') = 'apodaca',
    'san_nicolas'
  );
  PERFORM public.__p212c_assert(
    public.agenda_firmas_daily_cap_contract_enabled(DATE '2026-08-31') IS FALSE,
    'pre-effective_from false'
  );
  PERFORM public.__p212c_assert(
    public.agenda_firmas_daily_cap_contract_enabled(DATE '2026-09-01') IS TRUE,
    'effective_from true tras enable explícito'
  );
END;
$$;

-- Legacy aliases consume Monterrey daily (anti double-count with linked inventory)
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8212-00000000c001';
  v_date DATE := DATE '2026-09-20';
  v_asesor UUID := '00000000-0000-4000-8212-00000000c010';
  v_bid UUID;
  v_occ INTEGER;
  v_exp UUID;
  v_exp2 UUID;
  v_exp3 UUID;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p212c-org', 'P212C', true)
  ON CONFLICT (id) DO UPDATE SET active = true;
  INSERT INTO public.profiles (id, organization_id, email, app_role, active, full_name)
  VALUES (v_asesor, v_org, 'p212c@local.test', 'asesor', true, 'P212C')
  ON CONFLICT (id) DO UPDATE SET active = true;

  v_exp := gen_random_uuid();
  v_exp2 := gen_random_uuid();
  v_exp3 := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '82200000001', 'P212C1', '5551000001', 'interno', true, NOW(), 9, 'en_proceso', 'activo'),
    (v_exp2, v_org, v_asesor, 'mejoravit', '82200000002', 'P212C2', '5551000002', 'interno', true, NOW(), 9, 'en_proceso', 'activo'),
    (v_exp3, v_org, v_asesor, 'mejoravit', '82200000003', 'P212C3', '5551000003', 'interno', true, NOW(), 9, 'en_proceso', 'activo');

  v_bid := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_bid, v_org, 'firmas', v_exp, v_date, TIME '08:30', 'mty-centro', 'booked', v_asesor
  );

  INSERT INTO public.agenda_sheet_slot_inventory (
    organization_id, spreadsheet_id, sheet_id, sheet_title,
    booking_date, sheet_row, kind, location_id, slot_time, slot_key,
    status, booking_id, occupancy_source, observed_at
  ) VALUES (
    v_org, 'test', 1, 'P212C',
    v_date, 42, 'firmas', 'monterrey', TIME '08:30',
    'firmas|legacy|mty', 'linked', v_bid, 'crm', NOW()
  );

  v_occ := public.agenda_firmas_daily_active_occupancy(v_org, v_date, 'monterrey');
  PERFORM public.__p212c_assert(v_occ = 1, format('legacy+linked must count 1 got %s', v_occ));

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES
    (v_org, 'firmas', v_exp2, v_date, TIME '09:30', 'mty_centro', 'booked', v_asesor),
    (v_org, 'firmas', v_exp3, v_date, TIME '10:30', 'sede-centro', 'booked', v_asesor);

  v_occ := public.agenda_firmas_daily_active_occupancy(v_org, v_date, 'monterrey');
  PERFORM public.__p212c_assert(v_occ = 3, format('3 legacy aliases = 3 got %s', v_occ));
END;
$$;

ROLLBACK;
