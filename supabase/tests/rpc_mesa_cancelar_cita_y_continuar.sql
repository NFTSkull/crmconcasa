-- ConCasa CRM — P118b: mesa_cancelar_cita_y_continuar
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p118b_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P118B TEST FAIL: %', p_msg; END IF; END; $$;

CREATE OR REPLACE FUNCTION public.__p118b_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p118b_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_exp_bio UUID := '00000000-0000-4000-8118-000000000201';
  v_exp_fir UUID := '00000000-0000-4000-8118-000000000202';
  v_exp_fir9 UUID := '00000000-0000-4000-8118-000000000203';
  v_exp_notif UUID := '00000000-0000-4000-8118-000000000204';
  v_booking_bio UUID;
  v_booking_fir UUID;
  v_booking_fir9 UUID;
  v_booking_notif UUID;
  v_result JSONB;
  v_etapa SMALLINT;
  v_fecha TIMESTAMPTZ;
  v_status TEXT;
  v_dec TEXT;
BEGIN
  -- fixtures
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, fecha_cita, ciclo_estado
  ) VALUES
    (v_exp_bio, v_org, v_asesor, 'mejoravit', '81182000001', 'P118b Bio',
     '5533333301', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '3 days', 'activo'),
    (v_exp_fir, v_org, v_asesor, 'mejoravit', '81182000002', 'P118b Fir',
     '5533333302', 'interno', true, NOW(), 10, 'en_proceso', NOW() + INTERVAL '4 days', 'activo'),
    (v_exp_fir9, v_org, v_asesor, 'mejoravit', '81182000003', 'P118b Fir9',
     '5533333303', 'interno', true, NOW(), 9, 'en_proceso', NOW() + INTERVAL '5 days', 'activo'),
    (v_exp_notif, v_org, v_asesor, 'mejoravit', '81182000004', 'P118b Notif',
     '5533333304', 'interno', true, NOW(), 3, 'en_proceso', NULL, 'activo')
  ON CONFLICT (id) DO UPDATE SET
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    fecha_cita = EXCLUDED.fecha_cita,
    submitted_to_mesa = true,
    deleted_at = NULL,
    updated_at = NOW();

  DELETE FROM public.agenda_booking_decisiones
  WHERE expediente_id IN (v_exp_bio, v_exp_fir, v_exp_fir9, v_exp_notif);
  DELETE FROM public.agenda_bookings
  WHERE expediente_id IN (v_exp_bio, v_exp_fir, v_exp_fir9, v_exp_notif);

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES
    (v_org, 'biometricos', v_exp_bio, (NOW() + INTERVAL '3 days')::date, '10:00', 'monterrey', 'booked', v_asesor)
  RETURNING id INTO v_booking_bio;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES
    (v_org, 'firmas', v_exp_fir, (NOW() + INTERVAL '4 days')::date, '09:30', 'apodaca', 'booked', v_asesor)
  RETURNING id INTO v_booking_fir;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES
    (v_org, 'firmas', v_exp_fir9, (NOW() + INTERVAL '5 days')::date, '09:30', 'apodaca', 'booked', v_asesor)
  RETURNING id INTO v_booking_fir9;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES
    (v_org, 'notificacion', v_exp_notif, (NOW() + INTERVAL '2 days')::date, '12:00', 'notificacion', 'booked', v_asesor)
  RETURNING id INTO v_booking_notif;

  -- 1) biométricos 4→5
  PERFORM public.__p118b_set_auth(v_mesa);
  SELECT public.mesa_cancelar_cita_y_continuar(v_booking_bio, 'Continuar sin biometría') INTO v_result;
  PERFORM public.__p118b_reset_auth();
  PERFORM public.__p118b_assert((v_result->>'ok')::boolean, '1: ok');
  PERFORM public.__p118b_assert((v_result->>'etapa_nueva')::int = 5, '1: etapa 5');
  SELECT etapa_actual, fecha_cita INTO v_etapa, v_fecha FROM public.expedientes WHERE id = v_exp_bio;
  PERFORM public.__p118b_assert(v_etapa = 5, '1: exp etapa 5');
  PERFORM public.__p118b_assert(v_fecha IS NULL, '1: fecha_cita null');
  SELECT status INTO v_status FROM public.agenda_bookings WHERE id = v_booking_bio;
  PERFORM public.__p118b_assert(v_status = 'cancelled', '1: booking cancelled');
  SELECT decision INTO v_dec FROM public.agenda_booking_decisiones
  WHERE booking_id = v_booking_bio ORDER BY decided_at DESC LIMIT 1;
  PERFORM public.__p118b_assert(v_dec = 'cancel_continue', '1: decision');

  -- 2) idempotente
  PERFORM public.__p118b_set_auth(v_mesa);
  SELECT public.mesa_cancelar_cita_y_continuar(v_booking_bio, 'retry') INTO v_result;
  PERFORM public.__p118b_reset_auth();
  PERFORM public.__p118b_assert(COALESCE((v_result->>'idempotent')::boolean, false), '2: idempotent');

  -- 3) firmas 10→11
  PERFORM public.__p118b_set_auth(v_mesa);
  SELECT public.mesa_cancelar_cita_y_continuar(v_booking_fir, 'Continuar sin firma') INTO v_result;
  PERFORM public.__p118b_reset_auth();
  PERFORM public.__p118b_assert((v_result->>'etapa_nueva')::int = 11, '3: etapa 11');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp_fir;
  PERFORM public.__p118b_assert(v_etapa = 11, '3: exp 11');

  -- 4) firmas etapa 9 bloqueada
  PERFORM public.__p118b_set_auth(v_mesa);
  BEGIN
    PERFORM public.mesa_cancelar_cita_y_continuar(v_booking_fir9, 'no');
    RAISE EXCEPTION 'P118B TEST FAIL: 4 debía fallar etapa 9';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p118b_assert(SQLERRM ILIKE '%etapa 10%', '4: error etapa');
  END;
  PERFORM public.__p118b_reset_auth();
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp_fir9;
  PERFORM public.__p118b_assert(v_etapa = 9, '4: sin mutar');

  -- 5) notificación bloqueada
  PERFORM public.__p118b_set_auth(v_mesa);
  BEGIN
    PERFORM public.mesa_cancelar_cita_y_continuar(v_booking_notif, 'no');
    RAISE EXCEPTION 'P118B TEST FAIL: 5 notif debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p118b_assert(SQLERRM ILIKE '%notific%', '5: error notif');
  END;
  PERFORM public.__p118b_reset_auth();

  -- 6) mesa_interno bloqueado
  -- restaurar bio booking/etapa para rol test
  UPDATE public.expedientes SET etapa_actual = 4, fecha_cita = NOW() + INTERVAL '3 days' WHERE id = v_exp_bio;
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES
    (v_org, 'biometricos', v_exp_bio, (NOW() + INTERVAL '6 days')::date, '11:00', 'monterrey', 'booked', v_asesor)
  RETURNING id INTO v_booking_bio;

  PERFORM public.__p118b_set_auth(v_mesa_int);
  BEGIN
    PERFORM public.mesa_cancelar_cita_y_continuar(v_booking_bio, 'interno no');
    RAISE EXCEPTION 'P118B TEST FAIL: 6 interno debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p118b_assert(SQLERRM ILIKE '%no autorizado%' OR SQLSTATE = '42501', '6: rol');
  END;
  PERFORM public.__p118b_reset_auth();

  -- 7) asesor bloqueado
  PERFORM public.__p118b_set_auth(v_asesor);
  BEGIN
    PERFORM public.mesa_cancelar_cita_y_continuar(v_booking_bio, 'asesor no');
    RAISE EXCEPTION 'P118B TEST FAIL: 7 asesor debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p118b_assert(SQLERRM ILIKE '%no autorizado%' OR SQLSTATE = '42501', '7: asesor');
  END;
  PERFORM public.__p118b_reset_auth();

  -- 8) motivo obligatorio
  PERFORM public.__p118b_set_auth(v_mesa);
  BEGIN
    PERFORM public.mesa_cancelar_cita_y_continuar(v_booking_bio, '   ');
    RAISE EXCEPTION 'P118B TEST FAIL: 8 motivo vacío debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p118b_assert(SQLERRM ILIKE '%motivo%', '8: motivo');
  END;
  PERFORM public.__p118b_reset_auth();

  RAISE NOTICE 'P118b mesa_cancelar_cita_y_continuar: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p118b_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p118b_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p118b_reset_auth();
