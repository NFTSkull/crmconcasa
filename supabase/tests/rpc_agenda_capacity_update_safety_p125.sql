-- ConCasa CRM — P125: actualización segura de cupos (sin mover citas)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--   -f supabase/tests/rpc_agenda_capacity_update_safety_p125.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p125_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P125 CAP SAFETY FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p125_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p125_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_exp UUID[] := ARRAY[
    '00000000-0000-4000-9125-000000000001'::UUID,
    '00000000-0000-4000-9125-000000000002'::UUID,
    '00000000-0000-4000-9125-000000000003'::UUID,
    '00000000-0000-4000-9125-000000000004'::UUID,
    '00000000-0000-4000-9125-000000000005'::UUID,
    '00000000-0000-4000-9125-000000000006'::UUID
  ];
  v_slot_date DATE := (CURRENT_DATE + 21);
  v_slot_date_b DATE := (CURRENT_DATE + 28);
  v_slot_time TIME := '10:00';
  v_loc TEXT := 'monterrey';
  v_upsert JSONB;
  v_occ INTEGER;
  v_cap INTEGER;
  v_avail INTEGER;
  v_fail BOOLEAN;
  v_err TEXT;
  v_booking_snap RECORD;
  v_cfg_backup JSONB;
  v_cfg JSONB;
  v_i INTEGER;
  v_rows INTEGER;
  v_id1 UUID;
  v_id2 UUID;
BEGIN
  PERFORM public.__p125_assert(
    to_regprocedure('public.agenda_assert_capacity_by_time_safe(uuid,public.booking_kind,jsonb)') IS NOT NULL,
    'helper agenda_assert_capacity_by_time_safe (migración 111)'
  );
  PERFORM public.__p125_assert(
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_mesa AND p.app_role = 'mesa_admin'),
    'fixture mesa_admin requerido'
  );

  SELECT ac.config INTO v_cfg_backup
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_org AND ac.kind = 'biometricos';

  DELETE FROM public.agenda_bookings WHERE expediente_id = ANY (v_exp);
  DELETE FROM public.agenda_slot_capacities
  WHERE organization_id = v_org
    AND kind = 'biometricos'
    AND location_id = v_loc
    AND slot_date IN (v_slot_date, v_slot_date_b)
    AND slot_time = v_slot_time;

  FOR v_i IN 1..6 LOOP
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
      etapa_actual, subestado, ciclo_estado
    ) VALUES (
      v_exp[v_i], v_org, v_asesor, 'mejoravit',
      lpad((12500000000 + v_i)::TEXT, 11, '0'),
      format('Fixture P125 %s', v_i), format('551250000%s', v_i),
      'interno', true, NOW(),
      4, 'en_proceso', 'activo'
    )
    ON CONFLICT (id) DO UPDATE SET
      asesor_id = EXCLUDED.asesor_id,
      etapa_actual = 4,
      subestado = 'en_proceso',
      ciclo_estado = 'activo',
      submitted_to_mesa = true,
      deleted_at = NULL,
      fecha_cita = NULL;
  END LOOP;

  -- Cupo inicial 10
  PERFORM public.__p125_set_auth(v_mesa);
  SELECT public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot_date, v_slot_time, 10, true
  ) INTO v_upsert;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(COALESCE((v_upsert->>'ok')::BOOLEAN, false), 'upsert inicial ok');

  -- 5 ocupados
  FOR v_i IN 1..5 LOOP
    INSERT INTO public.agenda_bookings (
      organization_id, expediente_id, kind, status,
      booking_date, booking_time, location_id, created_by
    ) VALUES (
      v_org, v_exp[v_i], 'biometricos', 'booked',
      v_slot_date, v_slot_time, v_loc, v_asesor
    );
  END LOOP;

  -- Snapshot bookings (fecha/hora/sede/status) para comparar
  CREATE TEMP TABLE __p125_booking_snap ON COMMIT DROP AS
  SELECT id, expediente_id, booking_date, booking_time, location_id, status
  FROM public.agenda_bookings
  WHERE expediente_id = ANY (v_exp[1:5]);

  -- 1) 10→7 con 5 ocupados: ok, disponibles 2
  PERFORM public.__p125_set_auth(v_mesa);
  SELECT public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot_date, v_slot_time, 7, true
  ) INTO v_upsert;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(
    (v_upsert->>'occupied')::INTEGER = 5
    AND (v_upsert->>'available')::INTEGER = 2,
    format('10→7: occ=5 avail=2 got %s', v_upsert)
  );

  -- 2) 7→5: ok, disponibles 0
  PERFORM public.__p125_set_auth(v_mesa);
  SELECT public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot_date, v_slot_time, 5, true
  ) INTO v_upsert;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(
    (v_upsert->>'available')::INTEGER = 0
    AND (v_upsert->>'occupied')::INTEGER = 5,
    format('→5: avail=0 got %s', v_upsert)
  );

  -- 3) 5→4: bloqueado con mensaje canónico
  v_fail := false;
  v_err := NULL;
  PERFORM public.__p125_set_auth(v_mesa);
  BEGIN
    PERFORM public.upsert_agenda_slot_capacity(
      'biometricos', v_loc, v_slot_date, v_slot_time, 4, true
    );
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_err := SQLERRM;
  END;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(v_fail, 'debe bloquear cupo 4 con 5 ocupados');
  PERFORM public.__p125_assert(
    v_err ~* 'No puedes establecer un cupo menor a las 5 citas ya reservadas',
    format('mensaje canónico got: %s', v_err)
  );

  -- 4) Aumentar a 12: agrega lugares (avail=7)
  PERFORM public.__p125_set_auth(v_mesa);
  SELECT public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot_date, v_slot_time, 12, true
  ) INTO v_upsert;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(
    (v_upsert->>'available')::INTEGER = 7
    AND (v_upsert->>'occupied')::INTEGER = 5,
    format('→12: avail=7 got %s', v_upsert)
  );

  -- 5) Ningún booking cambió fecha/hora/sede/status
  SELECT COUNT(*) INTO v_rows
  FROM public.agenda_bookings b
  JOIN __p125_booking_snap s ON s.id = b.id
  WHERE b.booking_date IS DISTINCT FROM s.booking_date
     OR b.booking_time IS DISTINCT FROM s.booking_time
     OR b.location_id IS DISTINCT FROM s.location_id
     OR b.status IS DISTINCT FROM s.status;
  PERFORM public.__p125_assert(v_rows = 0, format('bookings mutados: %s', v_rows));

  -- 9) Guardado repetido no duplica filas
  PERFORM public.__p125_set_auth(v_mesa);
  SELECT public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot_date, v_slot_time, 12, true
  ) INTO v_upsert;
  v_id1 := (v_upsert->>'id')::UUID;
  SELECT public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot_date, v_slot_time, 12, true
  ) INTO v_upsert;
  v_id2 := (v_upsert->>'id')::UUID;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(v_id1 = v_id2, 'upsert idempotente mismo id');
  SELECT COUNT(*) INTO v_rows
  FROM public.agenda_slot_capacities
  WHERE organization_id = v_org
    AND kind = 'biometricos'
    AND location_id = v_loc
    AND slot_date = v_slot_date
    AND slot_time = v_slot_time;
  PERFORM public.__p125_assert(v_rows = 1, format('una sola fila cupo got %s', v_rows));

  -- 7) Excepción por fecha no afecta otra fecha (ocupados solo en date A)
  PERFORM public.__p125_set_auth(v_mesa);
  SELECT public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot_date_b, v_slot_time, 3, true
  ) INTO v_upsert;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(
    COALESCE((v_upsert->>'ok')::BOOLEAN, false)
    AND (v_upsert->>'occupied')::INTEGER = 0,
    format('otra fecha cupo=3 ok got %s', v_upsert)
  );

  -- 8) capacity_by_time recurrente no puede quedar bajo max ocupados futuros
  -- Config explícita con monterrey/apodaca (fixtures locales pueden usar otras sedes).
  v_cfg := '{
    "enabled": true,
    "timezone": "America/Monterrey",
    "min_lead_hours": 0,
    "allowed_weekdays": [1,2,3,4,5],
    "slots": ["10:00"],
    "locations": {
      "monterrey": {"enabled": true, "capacity_per_slot": 10, "capacity_by_time": {"10:00": 10}},
      "apodaca": {"enabled": true, "capacity_per_slot": 5, "capacity_by_time": {"10:00": 5}}
    }
  }'::JSONB;

  PERFORM public.__p125_set_auth(v_mesa);
  PERFORM public.upsert_agenda_config_biometricos(v_cfg, NULL);
  -- bajar a 4 con 5 ocupados futuros → bloqueo
  v_cfg := jsonb_set(
    v_cfg,
    '{locations,monterrey,capacity_by_time}',
    '{"10:00": 4}'::JSONB,
    true
  );
  v_fail := false;
  v_err := NULL;
  BEGIN
    PERFORM public.upsert_agenda_config_biometricos(v_cfg, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_err := SQLERRM;
  END;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(v_fail, 'recurrente 4 debe bloquearse con 5 ocupados');
  PERFORM public.__p125_assert(
    v_err ~* 'No puedes establecer un cupo menor a las 5 citas ya reservadas',
    format('mensaje recurrente got: %s', v_err)
  );

  -- bajar a 5 = permitido
  v_cfg := jsonb_set(
    v_cfg,
    '{locations,monterrey,capacity_by_time}',
    '{"10:00": 5}'::JSONB,
    true
  );
  PERFORM public.__p125_set_auth(v_mesa);
  SELECT public.upsert_agenda_config_biometricos(v_cfg, NULL) INTO v_upsert;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(COALESCE((v_upsert->>'ok')::BOOLEAN, false), 'recurrente=5 permitido');

  -- 6) Quitar horario (quitar 10:00 de slots) conserva bookings
  v_cfg := jsonb_set(v_cfg, '{slots}', '["09:00"]'::JSONB, true);
  v_cfg := jsonb_set(
    v_cfg,
    '{locations,monterrey,capacity_by_time}',
    '{"09:00": 5}'::JSONB,
    true
  );
  PERFORM public.__p125_set_auth(v_mesa);
  SELECT public.upsert_agenda_config_biometricos(v_cfg, NULL) INTO v_upsert;
  PERFORM public.__p125_reset_auth();
  PERFORM public.__p125_assert(COALESCE((v_upsert->>'ok')::BOOLEAN, false), 'quitar horario ok');
  SELECT COUNT(*) INTO v_rows
  FROM public.agenda_bookings
  WHERE expediente_id = ANY (v_exp[1:5])
    AND status = 'booked'
    AND booking_time = v_slot_time;
  PERFORM public.__p125_assert(v_rows = 5, format('bookings conservados tras quitar horario got %s', v_rows));

  -- Cleanup
  DELETE FROM public.agenda_bookings WHERE expediente_id = ANY (v_exp);
  DELETE FROM public.agenda_slot_capacities
  WHERE organization_id = v_org
    AND kind = 'biometricos'
    AND location_id = v_loc
    AND slot_date IN (v_slot_date, v_slot_date_b)
    AND slot_time = v_slot_time;
  IF v_cfg_backup IS NOT NULL THEN
    UPDATE public.agenda_config
    SET config = v_cfg_backup, updated_at = NOW()
    WHERE organization_id = v_org AND kind = 'biometricos';
  END IF;

  RAISE NOTICE 'P125 rpc_agenda_capacity_update_safety: OK';
END;
$$;
