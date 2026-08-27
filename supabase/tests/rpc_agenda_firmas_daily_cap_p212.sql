-- P212: Firmas daily cap 15/sede + hourly 5/5/5 + canonical + reagendar rollback.
\set ON_ERROR_STOP on

-- Ensure P212 bodies present even if P208 \ir clobbered helpers.
\ir ../migrations/212_agenda_firmas_daily_cap.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.__p212_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P212 FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p212_seed_firmas_inventory(
  p_org UUID,
  p_date DATE,
  p_time TIME,
  p_location TEXT,
  p_count INTEGER,
  p_row_base INTEGER
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_i INTEGER;
BEGIN
  FOR v_i IN 1..p_count LOOP
    INSERT INTO public.agenda_sheet_slot_inventory (
      organization_id, spreadsheet_id, sheet_id, sheet_title,
      booking_date, sheet_row, kind, location_id, slot_time, slot_key,
      status, occupancy_source, observed_at
    ) VALUES (
      p_org, 'test-sheet', 1, 'P212 Tab',
      p_date, p_row_base + v_i, 'firmas', p_location, p_time,
      format('firmas|%s|%s|%s|row=%s', p_date, p_time, p_location, p_row_base + v_i),
      'available', 'reconciliation', NOW()
    );
  END LOOP;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8212-000000000001';
  v_date DATE := DATE '2026-09-15';
BEGIN
  -- Activación explícita (simula publish controlado). Sin esto el contrato queda OFF.
  -- Rules Firmas no vienen en INSTALL (mig 212); se crean en activation / fixture ON.
  INSERT INTO public.agenda_daily_capacity_rules (kind, location_id, capacity)
  VALUES
    ('firmas', 'monterrey', 15),
    ('firmas', 'apodaca', 15)
  ON CONFLICT (kind, location_id) DO UPDATE
  SET capacity = EXCLUDED.capacity, updated_at = NOW();

  UPDATE public.agenda_firmas_daily_cap_contract
  SET enabled = TRUE,
      effective_from = DATE '2026-09-01',
      enabled_at = NOW(),
      note = 'P212 test enable',
      updated_at = NOW()
  WHERE singleton;

  PERFORM public.__p212_assert(
    public.agenda_firmas_canonical_location_id('mty-centro') = 'monterrey',
    'mty-centro → monterrey'
  );
  PERFORM public.__p212_assert(
    public.agenda_firmas_canonical_location_id('san-nicolas') = 'apodaca',
    'san-nicolas → apodaca'
  );
  PERFORM public.__p212_assert(
    public.agenda_firmas_daily_cap_contract_enabled(DATE '2026-08-31') IS FALSE,
    'pre-effective_from false'
  );
  PERFORM public.__p212_assert(
    public.agenda_firmas_daily_cap_contract_enabled(v_date),
    'contrato activo 2026-09-15 tras enable explícito'
  );
  PERFORM public.__p212_assert(
    public.agenda_daily_capacity(v_org, 'firmas', v_date, 'monterrey') = 15,
    'daily rule monterrey=15'
  );
  PERFORM public.__p212_assert(
    public.agenda_daily_capacity(v_org, 'firmas', v_date, 'apodaca') = 15,
    'daily rule apodaca=15'
  );
  PERFORM public.__p212_assert(
    public.agenda_firmas_target_hourly_capacity('monterrey', '09:00') = 5,
    'hourly 09=5'
  );
  PERFORM public.__p212_assert(
    public.agenda_firmas_target_hourly_capacity('monterrey', '08:30') IS NULL,
    'legacy 08:30 sin hourly target'
  );
  PERFORM public.__p212_assert(
    public.agenda_firmas_daily_remaining(v_org, v_date, 'monterrey') = 15,
    'remaining vacío monterrey=15'
  );
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8212-000000000002';
  v_asesor UUID := '00000000-0000-4000-8212-000000000010';
  v_date DATE := DATE '2026-09-16';
  v_time TIME := TIME '08:00';
  v_exp UUID;
  v_i INTEGER;
  v_meta JSONB;
  v_ts TIMESTAMPTZ;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p212-org-2', 'P212 Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO public.profiles (id, organization_id, email, app_role, active, full_name)
  VALUES (v_asesor, v_org, 'p212.asesor@local.test', 'asesor', true, 'P212 Asesor')
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, active = true;

  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (v_org, 'firmas', jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Monterrey',
    'min_lead_hours', 0,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object('enabled', true, 'capacity_by_time', jsonb_build_object('08:00', 5, '09:00', 5, '10:00', 5)),
      'apodaca', jsonb_build_object('enabled', true, 'capacity_by_time', jsonb_build_object('08:00', 5, '09:00', 5, '10:00', 5)),
      'mty-centro', jsonb_build_object('enabled', true, 'capacity_by_time', jsonb_build_object('08:00', 5))
    ),
    'slots', jsonb_build_array('08:00','09:00','10:00','08:30')
  ))
  ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW();

  PERFORM public.__p212_seed_firmas_inventory(v_org, v_date, TIME '08:00', 'monterrey', 6, 100);
  PERFORM public.__p212_seed_firmas_inventory(v_org, v_date, TIME '09:00', 'monterrey', 5, 200);
  PERFORM public.__p212_seed_firmas_inventory(v_org, v_date, TIME '10:00', 'monterrey', 5, 300);
  PERFORM public.__p212_seed_firmas_inventory(v_org, v_date, TIME '08:00', 'apodaca', 5, 400);
  -- Extra inventory for daily fill beyond first hourly block.
  PERFORM public.__p212_seed_firmas_inventory(v_org, v_date, TIME '08:00', 'monterrey', 10, 700);
  PERFORM public.__p212_seed_firmas_inventory(v_org, v_date, TIME '09:00', 'monterrey', 5, 800);
  PERFORM public.__p212_seed_firmas_inventory(v_org, v_date, TIME '10:00', 'monterrey', 5, 900);

  v_ts := (v_date + v_time) AT TIME ZONE 'America/Monterrey';

  FOR v_i IN 1..5 LOOP
    v_exp := gen_random_uuid();
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
      etapa_actual, subestado, ciclo_estado
    ) VALUES (
      v_exp, v_org, v_asesor, 'mejoravit',
      ('812000000' || lpad(v_i::text, 2, '0'))::char(11),
      'P212 Cap', '5550000000', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
    );
    v_meta := public.agenda_firmas_assert_slot_available(v_org, v_ts, 'monterrey');
    PERFORM public.__p212_assert((v_meta->>'booked_count_before')::INT = v_i - 1, 'hourly count before');
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
    ) VALUES (
      v_org, 'firmas', v_exp, v_date, v_time, 'monterrey', 'booked', v_asesor
    );
  END LOOP;

  BEGIN
    PERFORM public.agenda_firmas_assert_slot_available(v_org, v_ts, 'monterrey');
    RAISE EXCEPTION 'P212 FAIL: hourly #6 debió bloquear';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%cupo firmas agotado%' AND SQLERRM NOT LIKE '%SIN_CUPO%' THEN
      RAISE;
    END IF;
  END;

  PERFORM public.__p212_assert(
    public.agenda_firmas_daily_active_occupancy(v_org, v_date, 'monterrey') = 5,
    'daily occ monterrey=5 tras hourly'
  );

  FOR v_i IN 1..10 LOOP
    v_exp := gen_random_uuid();
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
      etapa_actual, subestado, ciclo_estado
    ) VALUES (
      v_exp, v_org, v_asesor, 'mejoravit',
      ('812100000' || lpad(v_i::text, 2, '0'))::char(11),
      'P212 Daily', '5550000001', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
    );
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
    ) VALUES (
      v_org, 'firmas', v_exp, v_date,
      CASE WHEN v_i <= 3 THEN TIME '09:00' WHEN v_i <= 6 THEN TIME '10:00' ELSE TIME '08:00' END,
      CASE WHEN v_i = 10 THEN 'mty-centro' ELSE 'monterrey' END,
      'booked', v_asesor
    );
  END LOOP;

  PERFORM public.__p212_assert(
    public.agenda_firmas_daily_active_occupancy(v_org, v_date, 'monterrey') = 15,
    'daily occ 15 con mty-centro'
  );
  PERFORM public.__p212_assert(
    public.agenda_firmas_daily_remaining(v_org, v_date, 'monterrey') = 0,
    'daily remaining 0'
  );

  v_ts := (v_date + TIME '09:00') AT TIME ZONE 'America/Monterrey';
  BEGIN
    PERFORM public.agenda_firmas_assert_slot_available(v_org, v_ts, 'monterrey');
    RAISE EXCEPTION 'P212 FAIL: daily #16 debió bloquear';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%SIN_CUPO_DIA%' AND SQLERRM NOT LIKE '%cupo%' THEN
      RAISE;
    END IF;
  END;

  PERFORM public.__p212_assert(
    public.agenda_firmas_daily_remaining(v_org, v_date, 'apodaca') = 15,
    'apodaca independiente con monterrey lleno'
  );

  BEGIN
    PERFORM public.agenda_firmas_assert_slot_available(
      v_org,
      (v_date + TIME '08:30') AT TIME ZONE 'America/Monterrey',
      'monterrey'
    );
    RAISE EXCEPTION 'P212 FAIL: 08:30 debió bloquear bajo contrato';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%horario%no permitido%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'P212 booking cap fixtures OK';
END;
$$;

-- Reagendar rollback: destino lleno → origen sigue booked (atomic TX)
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8212-000000000003';
  v_asesor UUID := '00000000-0000-4000-8212-000000000011';
  v_date DATE := DATE '2026-09-17';
  v_exp UUID := '00000000-0000-4000-8212-000000000099';
  v_origen_id UUID;
  v_origen_date DATE;
  v_origen_time TIME;
  v_i INTEGER;
  v_exp_fill UUID;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p212-reag', 'P212 Reag', true)
  ON CONFLICT (id) DO UPDATE SET active = true;
  INSERT INTO public.profiles (id, organization_id, email, app_role, active, full_name)
  VALUES (v_asesor, v_org, 'p212.reag@local.test', 'asesor', true, 'P212 Reag')
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (v_org, 'firmas', jsonb_build_object(
    'enabled', true, 'timezone', 'America/Monterrey', 'min_lead_hours', 0,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object('enabled', true, 'capacity_by_time', jsonb_build_object('08:00', 5, '09:00', 5))
    ),
    'slots', jsonb_build_array('08:00','09:00')
  ))
  ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW();

  PERFORM public.__p212_seed_firmas_inventory(v_org, v_date, TIME '08:00', 'monterrey', 5, 500);
  PERFORM public.__p212_seed_firmas_inventory(v_org, v_date, TIME '09:00', 'monterrey', 5, 600);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '93333333333', 'P212 Reag',
    '5550000099', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET etapa_actual = 9, deleted_at = NULL, ciclo_estado = 'activo';

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_org, 'firmas', v_exp, v_date, TIME '08:00', 'monterrey', 'booked', v_asesor
  ) RETURNING id INTO v_origen_id;

  UPDATE public.expedientes SET fecha_cita = (v_date + TIME '08:00') AT TIME ZONE 'America/Monterrey' WHERE id = v_exp;

  FOR v_i IN 1..5 LOOP
    v_exp_fill := gen_random_uuid();
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
      etapa_actual, subestado, ciclo_estado
    ) VALUES (
      v_exp_fill, v_org, v_asesor, 'mejoravit',
      ('933300000' || lpad(v_i::text, 2, '0'))::char(11),
      'P212 Fill', '5550000088', 'interno', true, NOW(), 9, 'en_proceso', 'activo'
    );
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
    ) VALUES (
      v_org, 'firmas', v_exp_fill, v_date, TIME '09:00', 'monterrey', 'booked', v_asesor
    );
  END LOOP;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  BEGIN
    PERFORM public.reagendar_firmas(
      v_exp,
      (v_date + TIME '09:00') AT TIME ZONE 'America/Monterrey',
      'monterrey'
    );
    RAISE EXCEPTION 'P212 FAIL: reagendar debió fallar con destino lleno';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT booking_date, booking_time INTO v_origen_date, v_origen_time
  FROM public.agenda_bookings
  WHERE id = v_origen_id;

  PERFORM public.__p212_assert(
    EXISTS (SELECT 1 FROM public.agenda_bookings WHERE id = v_origen_id AND status = 'booked'),
    'reagendar rollback: origen sigue booked'
  );
  PERFORM public.__p212_assert(v_origen_date = v_date AND v_origen_time = TIME '08:00', 'fecha/hora origen intacta');

  RAISE NOTICE 'P212 reagendar rollback OK';
END;
$$;

ROLLBACK;

-- Cleanup durable: DDL en el test puede haber committed el enable.
UPDATE public.agenda_firmas_daily_cap_contract
SET enabled = FALSE,
    effective_from = NULL,
    enabled_at = NULL,
    note = 'P212: default OFF after local ON-mode test',
    updated_at = NOW()
WHERE singleton;
