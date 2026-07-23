-- ConCasa CRM — P126: capacity_by_time = 0 (cierre por sede)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--   -f supabase/tests/rpc_agenda_allow_zero_recurring_capacity_p126.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p126_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P126 ZERO CAP FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p126_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p126_reset_auth()
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
  v_exp UUID := '00000000-0000-4000-9126-000000000001';
  v_exp2 UUID := '00000000-0000-4000-9126-000000000002';
  v_slot_date DATE := (CURRENT_DATE + 21);
  v_slot_time TIME := '08:30';
  v_cfg_backup JSONB;
  v_cfg JSONB;
  v_upsert JSONB;
  v_cap INTEGER;
  v_fail BOOLEAN;
  v_err TEXT;
  v_rows INTEGER;
  v_snap RECORD;
  v_scheduled TIMESTAMPTZ;
BEGIN
  PERFORM public.__p126_assert(
    public.agenda_location_explicit_capacity(
      '{"capacity_by_time":{"08:30":0}}'::JSONB, '08:30'
    ) = 0,
    'explicit capacity 0 debe devolver 0 (no NULL)'
  );
  PERFORM public.__p126_assert(
    public.agenda_location_explicit_capacity(
      '{"capacity_by_time":{"08:30":5}}'::JSONB, '09:00'
    ) IS NULL,
    'sin clave → NULL'
  );

  SELECT ac.config INTO v_cfg_backup
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_org AND ac.kind = 'biometricos';

  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp, v_exp2);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '12600000001',
    'Fixture P126', '5512600001', 'interno', true, NOW(),
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

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '12600000002',
    'Fixture P126b', '5512600002', 'interno', true, NOW(),
    4, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    etapa_actual = 4,
    ciclo_estado = 'activo',
    submitted_to_mesa = true,
    deleted_at = NULL,
    fecha_cita = NULL;

  -- 1) Monterrey 5 / Apodaca 0 guarda
  v_cfg := '{
    "enabled": true,
    "timezone": "America/Monterrey",
    "min_lead_hours": 0,
    "allowed_weekdays": [1,2,3,4,5],
    "slots": ["08:30"],
    "locations": {
      "monterrey": {"enabled": true, "capacity_per_slot": 5, "capacity_by_time": {"08:30": 5}},
      "apodaca": {"enabled": true, "capacity_per_slot": 5, "capacity_by_time": {"08:30": 0}}
    }
  }'::JSONB;

  PERFORM public.__p126_set_auth(v_mesa);
  SELECT public.upsert_agenda_config_biometricos(v_cfg, NULL) INTO v_upsert;
  PERFORM public.__p126_reset_auth();
  PERFORM public.__p126_assert(COALESCE((v_upsert->>'ok')::BOOLEAN, false), 'upsert mty5/apo0');
  PERFORM public.__p126_assert(
    (v_upsert->'config'->'locations'->'apodaca'->'capacity_by_time'->>'08:30')::INTEGER = 0,
    'persiste 0 en apodaca'
  );

  -- 2) Recargar: 0 intacto
  SELECT (ac.config->'locations'->'apodaca'->'capacity_by_time'->>'08:30')::INTEGER
  INTO v_cap
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_org AND ac.kind = 'biometricos';
  PERFORM public.__p126_assert(v_cap = 0, format('reload 0 got %s', v_cap));

  -- Booking existente en apodaca 08:30
  INSERT INTO public.agenda_bookings (
    organization_id, expediente_id, kind, status,
    booking_date, booking_time, location_id, created_by
  ) VALUES (
    v_org, v_exp, 'biometricos', 'booked',
    v_slot_date, v_slot_time, 'apodaca', v_asesor
  );

  SELECT id, booking_date, booking_time, location_id, status
  INTO v_snap
  FROM public.agenda_bookings
  WHERE expediente_id = v_exp AND kind = 'biometricos' AND status = 'booked'
  LIMIT 1;

  -- Re-guardar con 0: bookings intactos + warning
  PERFORM public.__p126_set_auth(v_mesa);
  SELECT public.upsert_agenda_config_biometricos(v_cfg, NULL) INTO v_upsert;
  PERFORM public.__p126_reset_auth();
  PERFORM public.__p126_assert(COALESCE((v_upsert->>'ok')::BOOLEAN, false), 're-upsert con booking');
  PERFORM public.__p126_assert(
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(v_upsert->'warnings', '[]'::JSONB)) w
      WHERE w LIKE 'Este horario dejará de aceptar nuevas citas.%'
    ),
    format('warning cierre 0 got %s', v_upsert->'warnings')
  );

  SELECT COUNT(*) INTO v_rows
  FROM public.agenda_bookings b
  WHERE b.id = v_snap.id
    AND b.booking_date = v_snap.booking_date
    AND b.booking_time = v_snap.booking_time
    AND b.location_id = v_snap.location_id
    AND b.status = v_snap.status;
  PERFORM public.__p126_assert(v_rows = 1, 'booking no mutado al guardar 0');

  -- 8) Nueva reserva en sede con 0 bloqueada
  v_scheduled := (
    (v_slot_date::TEXT || ' 08:30:00')::TIMESTAMP
    AT TIME ZONE 'America/Monterrey'
  );
  v_fail := false;
  v_err := NULL;
  BEGIN
    PERFORM public.agenda_biometricos_assert_slot_available(v_org, v_scheduled, 'apodaca');
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_err := SQLERRM;
  END;
  PERFORM public.__p126_assert(v_fail, 'assert apodaca 0 debe bloquear');
  PERFORM public.__p126_assert(v_err ~* 'cupo agotado|no configurado', format('err=%s', v_err));

  -- Monterrey 5 sigue disponible
  PERFORM public.agenda_biometricos_assert_slot_available(v_org, v_scheduled, 'monterrey');

  -- 9) Capacidad positiva menor a ocupados sigue bloqueada
  -- 5 bookings ficticios en monterrey → bajar a 4
  DELETE FROM public.agenda_bookings WHERE expediente_id = v_exp2;
  INSERT INTO public.agenda_bookings (
    organization_id, expediente_id, kind, status,
    booking_date, booking_time, location_id, created_by
  ) VALUES (
    v_org, v_exp2, 'biometricos', 'booked',
    v_slot_date, v_slot_time, 'monterrey', v_asesor
  );
  -- need more occupied: use max occupied path with capacity 0 allowed vs positive
  -- Set monterrey to 0 with occupied: allowed
  v_cfg := jsonb_set(
    v_cfg,
    '{locations,monterrey,capacity_by_time}',
    '{"08:30": 0}'::JSONB,
    true
  );
  PERFORM public.__p126_set_auth(v_mesa);
  SELECT public.upsert_agenda_config_biometricos(v_cfg, NULL) INTO v_upsert;
  PERFORM public.__p126_reset_auth();
  PERFORM public.__p126_assert(COALESCE((v_upsert->>'ok')::BOOLEAN, false), 'cerrar monterrey a 0 con booking OK');

  -- Restaurar positive 5 then try 0 occupied path for positive block:
  -- Create 2 booked on apodaca, set capacity 1 → block
  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp, v_exp2);
  INSERT INTO public.agenda_bookings (
    organization_id, expediente_id, kind, status,
    booking_date, booking_time, location_id, created_by
  ) VALUES
    (v_org, v_exp, 'biometricos', 'booked', v_slot_date, v_slot_time, 'apodaca', v_asesor),
    (v_org, v_exp2, 'biometricos', 'booked', v_slot_date, v_slot_time, 'apodaca', v_asesor);

  v_cfg := '{
    "enabled": true,
    "timezone": "America/Monterrey",
    "min_lead_hours": 0,
    "allowed_weekdays": [1,2,3,4,5],
    "slots": ["08:30"],
    "locations": {
      "monterrey": {"enabled": true, "capacity_per_slot": 5, "capacity_by_time": {"08:30": 5}},
      "apodaca": {"enabled": true, "capacity_per_slot": 5, "capacity_by_time": {"08:30": 1}}
    }
  }'::JSONB;
  v_fail := false;
  PERFORM public.__p126_set_auth(v_mesa);
  BEGIN
    PERFORM public.upsert_agenda_config_biometricos(v_cfg, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_err := SQLERRM;
  END;
  PERFORM public.__p126_reset_auth();
  PERFORM public.__p126_assert(v_fail, 'capacidad 1 con 2 ocupados debe bloquear');
  PERFORM public.__p126_assert(
    v_err ~* 'No puedes establecer un cupo menor a las 2 citas ya reservadas',
    format('mensaje P125 got %s', v_err)
  );

  -- Cleanup
  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp, v_exp2);
  IF v_cfg_backup IS NOT NULL THEN
    UPDATE public.agenda_config
    SET config = v_cfg_backup, updated_at = NOW()
    WHERE organization_id = v_org AND kind = 'biometricos';
  END IF;

  RAISE NOTICE 'P126 rpc_agenda_allow_zero_recurring_capacity: OK';
END;
$$;
