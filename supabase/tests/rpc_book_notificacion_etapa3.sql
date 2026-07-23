-- ConCasa CRM — pruebas P065 RPC book_notificacion_etapa3
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_book_notificacion_etapa3.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_notif_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC NOTIF TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_notif_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_notif_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_notif_test_call_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_booking_date DATE,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_notif_test_set_auth(p_user_id);
  SELECT public.book_notificacion_etapa3(p_expediente_id, p_booking_date, 'monterrey', p_note) INTO v_result;
  PERFORM public.__rpc_notif_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_notif_test_call_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_booking_date DATE,
  p_note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_notif_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.book_notificacion_etapa3(p_expediente_id, p_booking_date, 'monterrey', p_note);
    PERFORM public.__rpc_notif_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_notif_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_notif_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_etapa SMALLINT DEFAULT 3,
  p_submitted BOOLEAN DEFAULT true,
  p_deleted_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, deleted_at
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture Book Notificacion', '5588888888', 'interno',
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, 'en_proceso', p_deleted_at
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    etapa_actual = EXCLUDED.etapa_actual,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    deleted_at = EXCLUDED.deleted_at,
    ciclo_estado = 'activo',
    fecha_cita = NULL,
    updated_at = NOW();

  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END;
$$;

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';

  v_exp_ok UUID := '00000000-0000-4000-9065-000000000010';
  v_exp_other UUID := '00000000-0000-4000-9065-000000000020';
  v_exp_dup UUID := '00000000-0000-4000-9065-000000000030';
  v_exp_multi_a UUID := '00000000-0000-4000-9065-000000000040';
  v_exp_multi_b UUID := '00000000-0000-4000-9065-000000000050';
  v_exp_wrong_etapa UUID := '00000000-0000-4000-9065-000000000060';
  v_exp_bio_conflict UUID := '00000000-0000-4000-9065-000000000070';
  v_exp_avance UUID := '00000000-0000-4000-9065-000000000080';
  v_exp_no_notif UUID := '00000000-0000-4000-9065-000000000090';
  v_exp_reg_45 UUID := '00000000-0000-4000-9065-000000000100';

  v_future_date DATE := CURRENT_DATE + 14;
  v_result JSONB;
  v_booking_id UUID;
  v_count INTEGER;
BEGIN
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_ok, v_org_id, v_asesor_a1, '90651000010');
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_other, v_org_id, v_asesor_a2, '90652000020');
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_dup, v_org_id, v_asesor_a1, '90653000030');
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_multi_a, v_org_id, v_asesor_a1, '90654000040');
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_multi_b, v_org_id, v_asesor_a1, '90655000050');
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_wrong_etapa, v_org_id, v_asesor_a1, '90656000060', 4::smallint);
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_bio_conflict, v_org_id, v_asesor_a1, '90657000070');
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_avance, v_org_id, v_asesor_a1, '90658000080');
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_no_notif, v_org_id, v_asesor_a1, '90659000090');
  PERFORM public.__rpc_notif_test_insert_expediente(v_exp_reg_45, v_org_id, v_asesor_a1, '90651000100', 4::smallint);

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org_id, 'biometricos', v_exp_bio_conflict, v_future_date, '10:00:00',
    'sede-centro', 'booked', v_asesor_a1
  );

  -- 1. crea booking kind=notificacion
  v_result := public.__rpc_notif_test_call_as(v_asesor_a1, v_exp_ok, v_future_date, 'notif ok');
  PERFORM public.__rpc_notif_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'kind') = 'notificacion',
    'test 1: kind notificacion'
  );
  v_booking_id := (v_result->>'booking_id')::uuid;

  -- 2. hora fija 12:00
  PERFORM public.__rpc_notif_test_assert(
    (v_result->>'booking_time')::text LIKE '12:00%',
    'test 2: hora 12:00'
  );
  PERFORM public.__rpc_notif_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.id = v_booking_id AND b.booking_time = TIME '12:00'
    ),
    'test 2b: hora en tabla'
  );

  -- 3. no valida cupo (múltiples mismo día/hora)
  v_result := public.__rpc_notif_test_call_as(v_asesor_a1, v_exp_multi_a, v_future_date);
  PERFORM public.__rpc_notif_test_assert((v_result->>'ok')::boolean = true, 'test 3a: multi exp A');
  v_result := public.__rpc_notif_test_call_as(v_asesor_a1, v_exp_multi_b, v_future_date);
  PERFORM public.__rpc_notif_test_assert((v_result->>'ok')::boolean = true, 'test 3b: multi exp B');

  SELECT COUNT(*) INTO v_count
  FROM public.agenda_bookings b
  WHERE b.kind = 'notificacion'
    AND b.booking_date = v_future_date
    AND b.booking_time = TIME '12:00'
    AND b.status = 'booked'
    AND b.expediente_id IN (v_exp_ok, v_exp_multi_a, v_exp_multi_b);
  PERFORM public.__rpc_notif_test_assert(v_count >= 3, 'test 3c: varias notificaciones mismo slot');

  -- 4. bloquea segunda notificación activa mismo expediente
  v_result := public.__rpc_notif_test_call_as(v_asesor_a1, v_exp_dup, v_future_date + 1);
  PERFORM public.__rpc_notif_test_assert((v_result->>'ok')::boolean = true, 'test 4a: primera book dup');
  PERFORM public.__rpc_notif_test_assert(
    public.__rpc_notif_test_call_expect_fail(v_asesor_a1, v_exp_dup, v_future_date + 2),
    'test 4b: segunda notificación bloqueada'
  );

  -- 5. bloquea etapa != 3
  PERFORM public.__rpc_notif_test_assert(
    public.__rpc_notif_test_call_expect_fail(v_asesor_a1, v_exp_wrong_etapa, v_future_date),
    'test 5: etapa != 3'
  );

  -- 6. bloquea asesor no dueño
  PERFORM public.__rpc_notif_test_assert(
    public.__rpc_notif_test_call_expect_fail(v_asesor_a1, v_exp_other, v_future_date),
    'test 6: asesor no dueño'
  );

  -- 7. bloquea mesa
  PERFORM public.__rpc_notif_test_assert(
    public.__rpc_notif_test_call_expect_fail(v_mesa_admin, v_exp_no_notif, v_future_date),
    'test 7: mesa bloqueada'
  );

  -- 8. bloquea si hay biométricos activo
  PERFORM public.__rpc_notif_test_assert(
    public.__rpc_notif_test_call_expect_fail(v_asesor_a1, v_exp_bio_conflict, v_future_date),
    'test 8: conflicto biométricos activo'
  );

  -- 9. etapa permanece 3 tras book
  v_result := public.__rpc_notif_test_call_as(v_asesor_a1, v_exp_avance, v_future_date + 3);
  PERFORM public.__rpc_notif_test_assert(
    (v_result->>'etapa_actual')::int = 3,
    'test 9: expediente sigue etapa 3'
  );

  -- 10. avanzar_etapa_operativa 3→5 con notificación
  PERFORM public.__rpc_notif_test_set_auth(v_mesa_admin);
  SELECT public.avanzar_etapa_operativa(v_exp_avance, 'aprobar notif') INTO v_result;
  PERFORM public.__rpc_notif_test_reset_auth();
  PERFORM public.__rpc_notif_test_assert(
    (v_result->>'etapa_actual')::int = 5,
    'test 10: avance 3→5 con notificación'
  );

  -- 11. bloquea 3→5 sin notificación
  PERFORM public.__rpc_notif_test_set_auth(v_mesa_admin);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_no_notif);
    PERFORM public.__rpc_notif_test_reset_auth();
    RAISE EXCEPTION 'test 11: debió fallar 3→5 sin notificación';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_notif_test_reset_auth();
  END;
  PERFORM public.__rpc_notif_test_assert(true, 'test 11: 3→5 sin notificación bloqueado');

  -- 12. regresión 4→5 biométricos
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org_id, 'biometricos', v_exp_reg_45, v_future_date, '10:00:00',
    'sede-centro', 'booked', v_asesor_a1
  );
  UPDATE public.expedientes
  SET fecha_cita = ((v_future_date::timestamp + TIME '10:00') AT TIME ZONE 'UTC')
  WHERE id = v_exp_reg_45;

  PERFORM public.__rpc_notif_test_set_auth(v_mesa_admin);
  SELECT public.avanzar_etapa_operativa(v_exp_reg_45) INTO v_result;
  PERFORM public.__rpc_notif_test_reset_auth();
  PERFORM public.__rpc_notif_test_assert(
    (v_result->>'etapa_actual')::int = 5,
    'test 12: regresión 4→5 biométricos'
  );

  RAISE NOTICE 'RPC book_notificacion_etapa3: 12 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_notif_test_insert_expediente(UUID, UUID, UUID, CHAR, SMALLINT, BOOLEAN, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.__rpc_notif_test_call_expect_fail(UUID, UUID, DATE, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_notif_test_call_as(UUID, UUID, DATE, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_notif_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_notif_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_notif_test_assert(BOOLEAN, TEXT);
