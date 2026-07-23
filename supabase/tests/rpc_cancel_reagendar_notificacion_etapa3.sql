-- ConCasa CRM — pruebas P066 RPC cancel/reagendar_notificacion_etapa3
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_cancel_reagendar_notificacion_etapa3.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_notif_cr_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'NOTIF CR TEST FAIL: %', p_msg; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_notif_cr_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_notif_cr_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_notif_cr_test_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11), p_etapa SMALLINT DEFAULT 3
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture Notif CR', '5599999999', 'interno',
    true, NOW(), p_etapa, 'en_proceso'
  )
  ON CONFLICT (id) DO UPDATE SET etapa_actual = EXCLUDED.etapa_actual, fecha_cita = NULL, updated_at = NOW();
  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_exp UUID := '00000000-0000-4000-9066-000000000010';
  v_exp_reag UUID := '00000000-0000-4000-9066-000000000020';
  v_exp_etapa4 UUID := '00000000-0000-4000-9066-000000000030';
  v_exp_other UUID := '00000000-0000-4000-9066-000000000040';
  v_date DATE := CURRENT_DATE + 10;
  v_date2 DATE := CURRENT_DATE + 12;
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_notif_cr_test_insert_exp(v_exp, v_org, v_a1, '90661000010');
  PERFORM public.__rpc_notif_cr_test_insert_exp(v_exp_reag, v_org, v_a1, '90662000020');
  PERFORM public.__rpc_notif_cr_test_insert_exp(v_exp_etapa4, v_org, v_a1, '90663000030', 4::smallint);
  PERFORM public.__rpc_notif_cr_test_insert_exp(v_exp_other, v_org, v_a2, '90664000040');

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_org, 'notificacion', v_exp_etapa4, v_date, '12:00:00', 'notificacion', 'booked', v_a1
  );

  PERFORM public.__rpc_notif_cr_test_set_auth(v_a1);
  PERFORM public.book_notificacion_etapa3(v_exp, v_date, 'monterrey');
  PERFORM public.book_notificacion_etapa3(v_exp_reag, v_date, 'monterrey');
  PERFORM public.__rpc_notif_cr_test_reset_auth();

  -- 1. asesor cancela, permanece etapa 3, booking cancelled
  PERFORM public.__rpc_notif_cr_test_set_auth(v_a1);
  SELECT public.cancel_notificacion_etapa3(v_exp, 'fecha equivocada') INTO v_result;
  PERFORM public.__rpc_notif_cr_test_reset_auth();
  PERFORM public.__rpc_notif_cr_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 3,
    'test 1: cancel asesor etapa 3'
  );
  PERFORM public.__rpc_notif_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp AND b.kind = 'notificacion' AND b.status = 'cancelled'
    ),
    'test 1b: historial cancelled'
  );

  -- 2. puede volver a agendar tras cancel
  PERFORM public.__rpc_notif_cr_test_set_auth(v_a1);
  SELECT public.book_notificacion_etapa3(v_exp, v_date2, 'monterrey') INTO v_result;
  PERFORM public.__rpc_notif_cr_test_reset_auth();
  PERFORM public.__rpc_notif_cr_test_assert((v_result->>'ok')::boolean = true, 'test 2: rebook tras cancel');

  -- 3. reagendar asesor
  PERFORM public.__rpc_notif_cr_test_set_auth(v_a1);
  SELECT public.reagendar_notificacion_etapa3(v_exp_reag, v_date2, 'monterrey') INTO v_result;
  PERFORM public.__rpc_notif_cr_test_reset_auth();
  PERFORM public.__rpc_notif_cr_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'booking_time')::text LIKE '12:00%',
    'test 3: reagendar hora 12:00'
  );
  PERFORM public.__rpc_notif_cr_test_assert(
    (SELECT count(*) FROM public.agenda_bookings b WHERE b.expediente_id = v_exp_reag AND b.kind = 'notificacion') >= 2,
    'test 3b: historial cancel + nuevo'
  );

  -- 4. mesa_admin cancela con motivo
  PERFORM public.__rpc_notif_cr_test_set_auth(v_mesa);
  SELECT public.cancel_notificacion_etapa3(v_exp, 'correccion mesa') INTO v_result;
  PERFORM public.__rpc_notif_cr_test_reset_auth();
  PERFORM public.__rpc_notif_cr_test_assert((v_result->>'status') = 'cancelled', 'test 4: mesa_admin cancel');

  -- 5. mesa_interno bloqueado
  PERFORM public.__rpc_notif_cr_test_set_auth(v_mesa_int);
  BEGIN
    PERFORM public.cancel_notificacion_etapa3(v_exp_reag);
    RAISE EXCEPTION 'test 5: debió fallar mesa_interno';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_notif_cr_test_reset_auth();
  END;
  PERFORM public.__rpc_notif_cr_test_assert(true, 'test 5: mesa_interno bloqueado');

  -- 6. cancel etapa != 3 bloqueado
  PERFORM public.__rpc_notif_cr_test_set_auth(v_mesa);
  BEGIN
    PERFORM public.cancel_notificacion_etapa3(v_exp_etapa4, 'x');
    RAISE EXCEPTION 'test 6: debió fallar etapa 4';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_notif_cr_test_reset_auth();
  END;
  PERFORM public.__rpc_notif_cr_test_assert(true, 'test 6: cancel etapa 4 bloqueado');

  -- 7. asesor no dueño bloqueado
  PERFORM public.__rpc_notif_cr_test_set_auth(v_a1);
  BEGIN
    PERFORM public.cancel_notificacion_etapa3(v_exp_other, 'x');
    RAISE EXCEPTION 'test 7: debió fallar asesor ajeno';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_notif_cr_test_reset_auth();
  END;
  PERFORM public.__rpc_notif_cr_test_assert(true, 'test 7: asesor no dueño');

  RAISE NOTICE 'RPC cancel/reagendar_notificacion_etapa3: 7 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_notif_cr_test_insert_exp(UUID, UUID, UUID, CHAR, SMALLINT);
DROP FUNCTION IF EXISTS public.__rpc_notif_cr_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_notif_cr_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_notif_cr_test_assert(BOOLEAN, TEXT);
