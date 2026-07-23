-- ConCasa CRM — P118: mesa_gestionar_cita (cancelar / cancel_continue / cancelar normal)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_mesa_gestionar_cita.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p118_gest_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P118 GEST TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p118_gest_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p118_gest_reset_auth()
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
  v_exp UUID := '00000000-0000-4000-9118-000000000020';
  v_booking UUID;
  v_result JSONB;
  v_status TEXT;
  v_decisions INTEGER;
BEGIN
  PERFORM public.__p118_gest_assert(
    to_regprocedure('public.mesa_gestionar_cita(uuid,text,text,timestamptz,text,date)') IS NOT NULL,
    'RPC mesa_gestionar_cita debe existir (migración 104/105)'
  );

  DELETE FROM public.agenda_booking_decisiones WHERE expediente_id = v_exp;
  DELETE FROM public.agenda_bookings WHERE expediente_id = v_exp;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '11800000020',
    'Fixture P118 Gest', '5511800020', 'interno', true, NOW(),
    4, 'en_proceso', 'activo',
    ((CURRENT_DATE + 10)::TEXT || ' 09:00:00 America/Monterrey')::TIMESTAMPTZ
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    etapa_actual = 4,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    submitted_to_mesa = true,
    deleted_at = NULL,
    fecha_cita = EXCLUDED.fecha_cita;

  INSERT INTO public.agenda_bookings (
    organization_id, expediente_id, kind, status,
    booking_date, booking_time, location_id, created_by, note
  ) VALUES (
    v_org, v_exp, 'biometricos', 'booked',
    CURRENT_DATE + 10, '09:00', 'monterrey', v_asesor, NULL
  )
  RETURNING id INTO v_booking;

  -- cancelar_continuar → delega a mesa_cancelar_cita_y_continuar (P118b)
  PERFORM public.__p118_gest_set_auth(v_mesa);
  SELECT public.mesa_gestionar_cita(
    v_booking, 'cancelar_continuar', 'Continuar sin biometría', NULL, NULL, NULL
  ) INTO v_result;
  PERFORM public.__p118_gest_reset_auth();
  PERFORM public.__p118_gest_assert(COALESCE((v_result->>'ok')::BOOLEAN, false), 'cancelar_continuar ok');
  PERFORM public.__p118_gest_assert(
    COALESCE(v_result->>'action', '') = 'cancel_continue',
    'action=cancel_continue'
  );

  SELECT status INTO v_status FROM public.agenda_bookings WHERE id = v_booking;
  PERFORM public.__p118_gest_assert(v_status = 'cancelled', 'booking cancelled tras continue');
  PERFORM public.__p118_gest_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp AND e.etapa_actual = 5 AND e.fecha_cita IS NULL
    ),
    'expediente avanzó a 5 y fecha_cita limpia'
  );

  -- cancelar ok (nuevo booking en etapa 4)
  UPDATE public.expedientes
  SET etapa_actual = 4, fecha_cita = ((CURRENT_DATE + 11)::TEXT || ' 09:00:00 America/Monterrey')::TIMESTAMPTZ
  WHERE id = v_exp;

  INSERT INTO public.agenda_bookings (
    organization_id, expediente_id, kind, status,
    booking_date, booking_time, location_id, created_by, note
  ) VALUES (
    v_org, v_exp, 'biometricos', 'booked',
    CURRENT_DATE + 11, '10:00', 'monterrey', v_asesor, NULL
  )
  RETURNING id INTO v_booking;

  PERFORM public.__p118_gest_set_auth(v_mesa);
  SELECT public.mesa_gestionar_cita(
    v_booking, 'cancelar', 'Cliente no asistió — reagendar', NULL, NULL, NULL
  ) INTO v_result;
  PERFORM public.__p118_gest_reset_auth();
  PERFORM public.__p118_gest_assert(COALESCE((v_result->>'ok')::BOOLEAN, false), 'cancelar ok');
  PERFORM public.__p118_gest_assert(
    COALESCE(v_result->>'action', '') = 'cancelar',
    'action=cancelar'
  );

  SELECT status INTO v_status FROM public.agenda_bookings WHERE id = v_booking;
  PERFORM public.__p118_gest_assert(v_status = 'cancelled', 'booking cancelled');

  SELECT COUNT(*)::INTEGER INTO v_decisions
  FROM public.agenda_booking_decisiones
  WHERE expediente_id = v_exp AND decision = 'cancelar';
  PERFORM public.__p118_gest_assert(v_decisions >= 1, 'decisión cancelar persistida');

  -- cancelar normal no avanzó etapa
  PERFORM public.__p118_gest_assert(
    EXISTS (SELECT 1 FROM public.expedientes e WHERE e.id = v_exp AND e.etapa_actual = 4),
    'cancelar normal no avanza etapa'
  );

  DELETE FROM public.agenda_booking_decisiones WHERE expediente_id = v_exp;
  DELETE FROM public.agenda_bookings WHERE expediente_id = v_exp;

  RAISE NOTICE 'P118 rpc_mesa_gestionar_cita: OK';
END;
$$;
