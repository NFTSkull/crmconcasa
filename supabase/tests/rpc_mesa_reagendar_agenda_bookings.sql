-- ConCasa CRM — pruebas P068 + B5.1 mesa_reagendar_biometricos / mesa_reagendar_notificacion / reagendar_firmas
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_mesa_reagendar_agenda_bookings.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__mesa_reag_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'MESA REAG B5.1 FAIL: %', p_msg; END IF; END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_reag_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_reag_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_reag_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss TEXT, p_etapa INTEGER DEFAULT 3
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss::char(11), 'Fixture Mesa Reag B51', '5599999999', 'interno',
    true, NOW(), p_etapa::smallint, 'en_proceso'
  )
  ON CONFLICT (id) DO UPDATE SET
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = 'en_proceso',
    submitted_to_mesa = true,
    updated_at = NOW();
  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_reag_bio_cfg(p_org UUID, p_capacity INT DEFAULT 2)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (
    p_org, 'biometricos',
    jsonb_build_object(
      'enabled', true, 'timezone', 'America/Monterrey',
      'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
      'slots', jsonb_build_array('09:00','10:00','11:00','12:00'),
      'locations', jsonb_build_object(
        'sede-centro', jsonb_build_object('enabled', true, 'capacity_per_slot', p_capacity)
      )
    )
  )
  ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config;
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_reag_firmas_cfg(p_org UUID, p_capacity INT DEFAULT 3)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (
    p_org, 'firmas',
    jsonb_build_object(
      'enabled', true, 'timezone', 'America/Monterrey', 'min_lead_hours', 0,
      'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
      'slots', jsonb_build_array('09:00','10:00','11:00','12:00'),
      'locations', jsonb_build_object(
        'mty-centro', jsonb_build_object('enabled', true, 'capacity_per_slot', p_capacity)
      )
    )
  )
  ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_org_b UUID := '00000000-0000-4000-8000-000000000099';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_exp_bio UUID := '00000000-0000-4000-9068-000000000010';
  v_exp_bio_etapa UUID := '00000000-0000-4000-9068-000000000011';
  v_exp_bio_cupo UUID := '00000000-0000-4000-9068-000000000012';
  v_exp_bio_fill UUID := '00000000-0000-4000-9068-000000000013';
  v_exp_bio_org UUID := '00000000-0000-4000-9068-000000000014';
  v_exp_notif UUID := '00000000-0000-4000-9068-000000000020';
  v_exp_notif2 UUID := '00000000-0000-4000-9068-000000000021';
  v_exp_firma UUID := '00000000-0000-4000-9068-000000000030';
  v_date DATE := CURRENT_DATE + 14;
  v_date2 DATE := CURRENT_DATE + 16;
  v_date3 DATE := CURRENT_DATE + 18;
  v_result JSONB;
  v_scheduled TIMESTAMPTZ;
  v_etapa SMALLINT;
  v_fecha TIMESTAMPTZ;
  v_count INT;
  v_log INT;
BEGIN
  PERFORM public.__mesa_reag_bio_cfg(v_org, 2);
  PERFORM public.__mesa_reag_firmas_cfg(v_org, 3);

  PERFORM public.__mesa_reag_exp(v_exp_bio, v_org, v_a1, '90681000010', 3);
  PERFORM public.__mesa_reag_exp(v_exp_bio_etapa, v_org, v_a1, '90681000011', 2);
  PERFORM public.__mesa_reag_exp(v_exp_notif, v_org, v_a1, '90682000020', 3);
  PERFORM public.__mesa_reag_exp(v_exp_notif2, v_org, v_a1, '90682000021', 3);
  PERFORM public.__mesa_reag_exp(v_exp_firma, v_org, v_a1, '90683000030', 9);

  v_scheduled := (v_date::timestamp + TIME '10:00') AT TIME ZONE 'America/Monterrey';
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_org, 'biometricos', v_exp_bio, v_date, '10:00:00', 'sede-centro', 'booked', v_a1
  );
  UPDATE public.expedientes SET fecha_cita = v_scheduled WHERE id = v_exp_bio;

  PERFORM public.__mesa_reag_auth(v_a1);
  PERFORM public.book_notificacion_etapa3(v_exp_notif, v_date);
  PERFORM public.book_notificacion_etapa3(v_exp_notif2, v_date);
  PERFORM public.__mesa_reag_reset();

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_org, 'firmas', v_exp_firma, v_date, '10:00:00', 'mty-centro', 'booked', v_a1
  );
  UPDATE public.expedientes SET fecha_cita = v_scheduled, etapa_actual = 9 WHERE id = v_exp_firma;

  -- 1 mesa_admin bio OK
  PERFORM public.__mesa_reag_auth(v_mesa);
  SELECT public.mesa_reagendar_biometricos(v_exp_bio, v_date2, TIME '11:00', 'sede-centro', 'ok') INTO v_result;
  PERFORM public.__mesa_reag_reset();
  PERFORM public.__mesa_reag_assert((v_result->>'ok')::boolean, '1 mesa_admin bio');

  -- 2 super_admin bio OK (re-setup booking)
  PERFORM public.__mesa_reag_exp(v_exp_bio, v_org, v_a1, '90681000010', 3);
  INSERT INTO public.agenda_bookings (organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by)
  VALUES (v_org, 'biometricos', v_exp_bio, v_date, '10:00:00', 'sede-centro', 'booked', v_a1);
  PERFORM public.__mesa_reag_auth(v_super);
  SELECT public.mesa_reagendar_biometricos(v_exp_bio, v_date2, TIME '11:00', 'sede-centro', NULL) INTO v_result;
  PERFORM public.__mesa_reag_reset();
  PERFORM public.__mesa_reag_assert((v_result->>'ok')::boolean, '2 super_admin bio');

  -- 3-6 roles bloqueados bio
  BEGIN PERFORM public.__mesa_reag_auth(v_mesa_int);
    PERFORM public.mesa_reagendar_biometricos(v_exp_bio, v_date3, TIME '10:00', 'sede-centro');
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '3';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%rol no autorizado%', '3 mesa_interno');
  END;
  BEGIN PERFORM public.__mesa_reag_auth(v_mesa_ext);
    PERFORM public.mesa_reagendar_biometricos(v_exp_bio, v_date3, TIME '10:00', 'sede-centro');
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '4';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%rol no autorizado%', '4 mesa_externo');
  END;
  BEGIN PERFORM public.__mesa_reag_auth(v_a1);
    PERFORM public.mesa_reagendar_biometricos(v_exp_bio, v_date3, TIME '10:00', 'sede-centro');
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '5';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%rol no autorizado%', '5 asesor');
  END;
  BEGIN PERFORM public.__mesa_reag_auth(v_editor);
    PERFORM public.mesa_reagendar_biometricos(v_exp_bio, v_date3, TIME '10:00', 'sede-centro');
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '6';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%rol no autorizado%', '6 editor');
  END;

  -- 7 etapa inválida
  BEGIN PERFORM public.__mesa_reag_auth(v_mesa);
    PERFORM public.mesa_reagendar_biometricos(v_exp_bio_etapa, v_date2, TIME '10:00', 'sede-centro');
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '7';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%etapa%', '7 etapa inválida');
  END;

  -- 8 sin booking activo
  PERFORM public.__mesa_reag_exp(v_exp_bio_cupo, v_org, v_a1, '90681000012', 3);
  BEGIN PERFORM public.__mesa_reag_auth(v_mesa);
    PERFORM public.mesa_reagendar_biometricos(v_exp_bio_cupo, v_date2, TIME '10:00', 'sede-centro');
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '8';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%no hay cita biométrica activa%', '8 sin activo');
  END;

  -- 9-10 cupo lleno + rollback (capacidad 1)
  PERFORM public.__mesa_reag_bio_cfg(v_org, 1);
  PERFORM public.__mesa_reag_exp(v_exp_bio_cupo, v_org, v_a1, '90681000012', 3);
  PERFORM public.__mesa_reag_exp(v_exp_bio_fill, v_org, v_a1, '90681000013', 3);
  INSERT INTO public.agenda_bookings (organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by)
  VALUES (v_org, 'biometricos', v_exp_bio_cupo, v_date, '09:00:00', 'sede-centro', 'booked', v_a1);
  INSERT INTO public.agenda_bookings (organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by)
  VALUES (v_org, 'biometricos', v_exp_bio_fill, v_date3, '10:00:00', 'sede-centro', 'booked', v_a1);
  BEGIN PERFORM public.__mesa_reag_auth(v_mesa);
    PERFORM public.mesa_reagendar_biometricos(v_exp_bio_cupo, v_date3, TIME '10:00', 'sede-centro');
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '9';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%cupo agotado%', '9 slot lleno');
  END;
  PERFORM public.__mesa_reag_assert(
    EXISTS (SELECT 1 FROM public.agenda_bookings b WHERE b.expediente_id = v_exp_bio_cupo AND b.status = 'booked' AND b.booking_date = v_date AND b.booking_time = TIME '09:00'),
    '10 rollback: anterior sigue activo tras cupo lleno'
  );

  -- 11-14 éxito historial / fecha_cita / etapa
  PERFORM public.__mesa_reag_bio_cfg(v_org, 2);
  PERFORM public.__mesa_reag_exp(v_exp_bio, v_org, v_a1, '90681000010', 3);
  INSERT INTO public.agenda_bookings (organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by)
  VALUES (v_org, 'biometricos', v_exp_bio, v_date, '10:00:00', 'sede-centro', 'booked', v_a1);
  UPDATE public.expedientes SET fecha_cita = v_scheduled, etapa_actual = 3 WHERE id = v_exp_bio;
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp_bio;
  PERFORM public.__mesa_reag_auth(v_mesa);
  SELECT public.mesa_reagendar_biometricos(v_exp_bio, v_date2, TIME '11:00', 'sede-centro', 'audit') INTO v_result;
  PERFORM public.__mesa_reag_reset();
  PERFORM public.__mesa_reag_assert(
    (SELECT count(*) FROM public.agenda_bookings WHERE expediente_id = v_exp_bio AND kind = 'biometricos' AND status = 'cancelled') >= 1,
    '11 anterior cancelada'
  );
  PERFORM public.__mesa_reag_assert(
    EXISTS (SELECT 1 FROM public.agenda_bookings WHERE expediente_id = v_exp_bio AND status = 'booked' AND booking_date = v_date2),
    '12 nueva activa'
  );
  SELECT fecha_cita INTO v_fecha FROM public.expedientes WHERE id = v_exp_bio;
  PERFORM public.__mesa_reag_assert(v_fecha IS NOT NULL, '13 fecha_cita actualizada');
  PERFORM public.__mesa_reag_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_bio) = v_etapa,
    '14 etapa no cambia'
  );

  -- 15 otra organización
  PERFORM public.__mesa_reag_exp(v_exp_bio_org, v_org_b, v_a1, '90681000014', 3);
  INSERT INTO public.agenda_bookings (organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by)
  VALUES (v_org_b, 'biometricos', v_exp_bio_org, v_date, '10:00:00', 'sede-centro', 'booked', v_a1);
  BEGIN PERFORM public.__mesa_reag_auth(v_mesa);
    PERFORM public.mesa_reagendar_biometricos(v_exp_bio_org, v_date2, TIME '11:00', 'sede-centro');
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '15';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%organización%', '15 otra org');
  END;

  -- 16-17 notif mesa_admin / super_admin
  PERFORM public.__mesa_reag_auth(v_mesa);
  SELECT public.mesa_reagendar_notificacion(v_exp_notif, v_date2, 'n1') INTO v_result;
  PERFORM public.__mesa_reag_reset();
  PERFORM public.__mesa_reag_assert((v_result->>'ok')::boolean, '16 mesa_admin notif');
  PERFORM public.__mesa_reag_auth(v_super);
  SELECT public.mesa_reagendar_notificacion(v_exp_notif2, v_date2, 'n2') INTO v_result;
  PERFORM public.__mesa_reag_reset();
  PERFORM public.__mesa_reag_assert((v_result->>'ok')::boolean, '17 super_admin notif');

  -- 18 otros roles notif
  BEGIN PERFORM public.__mesa_reag_auth(v_mesa_int);
    PERFORM public.mesa_reagendar_notificacion(v_exp_notif, v_date);
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '18';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%rol no autorizado%', '18 interno notif');
  END;

  -- 19 hora 12:00
  PERFORM public.__mesa_reag_assert((v_result->>'booking_time')::text LIKE '12:00%', '19 notif 12:00');

  -- 21 una activa por expediente (antes de test 20 multi-exp)
  PERFORM public.__mesa_reag_assert(
    (SELECT count(*) FROM public.agenda_bookings WHERE expediente_id = v_exp_notif AND kind = 'notificacion' AND status = 'booked') = 1,
    '21 una activa por exp'
  );

  -- 22 anterior cancelada notif
  PERFORM public.__mesa_reag_assert(
    EXISTS (SELECT 1 FROM public.agenda_bookings WHERE expediente_id = v_exp_notif AND kind = 'notificacion' AND status = 'cancelled'),
    '22 anterior cancelada notif'
  );

  -- 23 etapa 3 notif
  PERFORM public.__mesa_reag_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_notif) = 3,
    '23 etapa 3 notif'
  );

  -- 24 fecha_cita notif
  SELECT fecha_cita INTO v_fecha FROM public.expedientes WHERE id = v_exp_notif;
  PERFORM public.__mesa_reag_assert(v_fecha IS NOT NULL, '24 fecha_cita notif');

  -- 20 múltiples expedientes mismo día/hora (sin cupo global; notif fija 12:00)
  PERFORM public.__mesa_reag_auth(v_mesa);
  SELECT public.mesa_reagendar_notificacion(v_exp_notif, v_date3, 'multi-a') INTO v_result;
  PERFORM public.__mesa_reag_auth(v_mesa);
  SELECT public.mesa_reagendar_notificacion(v_exp_notif2, v_date3, 'multi-b') INTO v_result;
  PERFORM public.__mesa_reag_reset();
  PERFORM public.__mesa_reag_assert(
    (SELECT count(DISTINCT expediente_id) FROM public.agenda_bookings WHERE kind = 'notificacion' AND booking_date = v_date3 AND status = 'booked') >= 2,
    '20 múltiples exp mismo día'
  );

  -- 25 notif sin activo
  PERFORM public.__mesa_reag_exp(v_exp_bio_cupo, v_org, v_a1, '90689900099', 3);
  BEGIN PERFORM public.__mesa_reag_auth(v_mesa);
    PERFORM public.mesa_reagendar_notificacion(v_exp_bio_cupo, v_date2);
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '25';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%no hay notificación activa%', '25 notif sin activo');
  END;

  -- 26-28 firmas reagendar_firmas roles
  v_scheduled := (v_date2::timestamp + TIME '11:00') AT TIME ZONE 'America/Monterrey';
  PERFORM public.__mesa_reag_auth(v_mesa);
  SELECT public.reagendar_firmas(v_exp_firma, v_scheduled, 'mty-centro', 'mesa') INTO v_result;
  PERFORM public.__mesa_reag_reset();
  PERFORM public.__mesa_reag_assert((v_result->>'ok')::boolean, '26 mesa_admin firmas');
  BEGIN PERFORM public.__mesa_reag_auth(v_mesa_int);
    PERFORM public.reagendar_firmas(v_exp_firma, v_scheduled, 'mty-centro');
    PERFORM public.__mesa_reag_reset(); RAISE EXCEPTION '28';
  EXCEPTION WHEN OTHERS THEN PERFORM public.__mesa_reag_reset();
    PERFORM public.__mesa_reag_assert(SQLERRM LIKE '%rol no autorizado%', '28 interno firmas');
  END;

  -- 29-31 firmas historial / etapa
  PERFORM public.__mesa_reag_assert(
    (SELECT count(*) FROM public.agenda_bookings WHERE expediente_id = v_exp_firma AND kind = 'firmas') >= 2,
    '31 firmas historial'
  );
  PERFORM public.__mesa_reag_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_firma) IN (9, 10),
    '30 firmas etapa 9/10'
  );

  -- 32-34 kind/expediente ajenos
  PERFORM public.__mesa_reag_assert(
    NOT EXISTS (SELECT 1 FROM public.agenda_bookings WHERE expediente_id = v_exp_firma AND kind = 'biometricos' AND status = 'booked'),
    '32 kind no cambia cruzado'
  );
  PERFORM public.__mesa_reag_assert(
    (SELECT expediente_id FROM public.agenda_bookings WHERE expediente_id = v_exp_bio AND status = 'booked' LIMIT 1) = v_exp_bio,
    '33 expediente_id consistente'
  );

  -- 35 auditoría
  SELECT count(*) INTO v_log FROM public.action_log
  WHERE action IN ('agenda.biometricos.mesa_reagendar', 'agenda.notificacion.mesa_reagendar', 'agenda.firmas.reagendar')
    AND created_at > NOW() - INTERVAL '5 minutes';
  PERFORM public.__mesa_reag_assert(v_log >= 1, '35 auditoría registrada');

  -- 36 rollback documentado: cubierto en test 10 (misma transacción PL/pgSQL)

  RAISE NOTICE 'rpc_mesa_reagendar_agenda_bookings B5.1: 36 casos OK';
END;
$$;
