-- ConCasa CRM — pruebas P2C-8 RPC cancel_biometricos y reagendar_biometricos
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_biometricos_cancel_reagendar.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC BIO CR TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_call_cancel_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_bio_cr_test_set_auth(p_user_id);
  SELECT public.cancel_biometricos(p_expediente_id, p_motivo) INTO v_result;
  PERFORM public.__rpc_bio_cr_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_call_reagendar_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_bio_cr_test_set_auth(p_user_id);
  SELECT public.reagendar_biometricos(
    p_expediente_id, p_scheduled_at, p_location_id, p_note
  ) INTO v_result;
  PERFORM public.__rpc_bio_cr_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_call_book_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT 'sede-centro'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_bio_cr_test_set_auth(p_user_id);
  SELECT public.book_biometricos(p_expediente_id, p_scheduled_at, p_location_id) INTO v_result;
  PERFORM public.__rpc_bio_cr_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_call_avanzar_as(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_bio_cr_test_set_auth(p_user_id);
  SELECT public.avanzar_etapa_operativa(p_expediente_id) INTO v_result;
  PERFORM public.__rpc_bio_cr_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_expect_fail_cancel(
  p_user_id UUID,
  p_expediente_id UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_bio_cr_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.cancel_biometricos(p_expediente_id, p_motivo);
    PERFORM public.__rpc_bio_cr_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_bio_cr_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_expect_fail_reagendar(
  p_user_id UUID,
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_bio_cr_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.reagendar_biometricos(
      p_expediente_id, p_scheduled_at, p_location_id, p_note
    );
    PERFORM public.__rpc_bio_cr_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_bio_cr_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_etapa SMALLINT DEFAULT 4,
  p_fecha_cita TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, fecha_cita
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture Bio Cancel Reagendar', '5510101010', 'interno',
    true, NOW(), p_etapa, 'en_proceso', p_fecha_cita
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    etapa_actual = EXCLUDED.etapa_actual,
    fecha_cita = EXCLUDED.fecha_cita,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    submitted_to_mesa = true,
    updated_at = NOW();

  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_bio_cr_test_insert_booking(
  p_expediente_id UUID,
  p_org_id UUID,
  p_created_by UUID,
  p_status public.booking_status DEFAULT 'booked',
  p_booking_date DATE DEFAULT (CURRENT_DATE + 7),
  p_booking_time TIME DEFAULT '10:00:00',
  p_location_id TEXT DEFAULT 'sede-original'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, cancelled_at
  ) VALUES (
    p_org_id, 'biometricos', p_expediente_id, p_booking_date, p_booking_time,
    p_location_id, p_status, p_created_by,
    CASE WHEN p_status = 'cancelled' THEN NOW() ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';

  v_fecha_cita TIMESTAMPTZ := NOW() + INTERVAL '7 days';
  v_fecha_nueva TIMESTAMPTZ := NOW() + INTERVAL '10 days';
  v_fecha_pasada TIMESTAMPTZ := NOW() - INTERVAL '1 day';

  v_exp_cancel_ok UUID := '00000000-0000-4000-9010-000000000010';
  v_exp_other UUID := '00000000-0000-4000-9010-000000000020';
  v_exp_roles UUID := '00000000-0000-4000-9010-000000000030';
  v_exp_no_booking UUID := '00000000-0000-4000-9010-000000000040';
  v_exp_already_cancelled UUID := '00000000-0000-4000-9010-000000000050';
  v_exp_cancel_checks UUID := '00000000-0000-4000-9010-000000000060';
  v_exp_rebook_after UUID := '00000000-0000-4000-9010-000000000070';
  v_exp_reagendar_ok UUID := '00000000-0000-4000-9010-000000000080';
  v_exp_reagendar_etapa UUID := '00000000-0000-4000-9010-000000000090';
  v_exp_reagendar_past UUID := '00000000-0000-4000-9010-000000000100';
  v_exp_reagendar_loc UUID := '00000000-0000-4000-9010-000000000110';
  v_exp_reagendar_no_act UUID := '00000000-0000-4000-9010-000000000120';
  v_exp_avanzar_after UUID := '00000000-0000-4000-9010-000000000130';

  v_result JSONB;
  v_booking_id UUID;
  v_booking_anterior UUID;
  v_booking_nuevo UUID;
  v_cancelled_at TIMESTAMPTZ;
BEGIN
  -- Fixtures cancelación
  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_cancel_ok, v_org_id, v_asesor_a1, '91001000001', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(v_exp_cancel_ok, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_other, v_org_id, v_asesor_a2, '91002000002', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(v_exp_other, v_org_id, v_asesor_a2);

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_roles, v_org_id, v_asesor_a1, '91003000003', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(v_exp_roles, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_no_booking, v_org_id, v_asesor_a1, '91004000004', 4::smallint, v_fecha_cita
  );

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_already_cancelled, v_org_id, v_asesor_a1, '91005000005', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(
    v_exp_already_cancelled, v_org_id, v_asesor_a1, 'cancelled'
  );

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_cancel_checks, v_org_id, v_asesor_a1, '91006000006', 4::smallint, v_fecha_cita
  );
  v_booking_id := public.__rpc_bio_cr_test_insert_booking(v_exp_cancel_checks, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_rebook_after, v_org_id, v_asesor_a1, '91007000007', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(v_exp_rebook_after, v_org_id, v_asesor_a1);

  -- Fixtures reagenda
  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_reagendar_ok, v_org_id, v_asesor_a1, '91008000008', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(v_exp_reagendar_ok, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_reagendar_etapa, v_org_id, v_asesor_a1, '91009000009', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(v_exp_reagendar_etapa, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_reagendar_past, v_org_id, v_asesor_a1, '91010000010', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(v_exp_reagendar_past, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_reagendar_loc, v_org_id, v_asesor_a1, '91011000011', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(v_exp_reagendar_loc, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_reagendar_no_act, v_org_id, v_asesor_a1, '91012000012', 4::smallint, NULL
  );

  PERFORM public.__rpc_bio_cr_test_insert_expediente(
    v_exp_avanzar_after, v_org_id, v_asesor_a1, '91013000013', 4::smallint, v_fecha_cita
  );
  PERFORM public.__rpc_bio_cr_test_insert_booking(v_exp_avanzar_after, v_org_id, v_asesor_a1);

  -- Test 1: asesor dueño cancela
  v_result := public.__rpc_bio_cr_test_call_cancel_as(v_asesor_a1, v_exp_cancel_ok, 'cliente pidió cambio');
  PERFORM public.__rpc_bio_cr_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 1: asesor dueño cancela ok'
  );
  PERFORM public.__rpc_bio_cr_test_assert(
    v_result->>'status' = 'cancelled',
    'test 1: status cancelled'
  );

  -- Test 2: asesor ajeno bloqueado
  PERFORM public.__rpc_bio_cr_test_assert(
    public.__rpc_bio_cr_test_expect_fail_cancel(v_asesor_a1, v_exp_other),
    'test 2: asesor ajeno bloqueado'
  );

  -- Test 3: editor bloqueado
  PERFORM public.__rpc_bio_cr_test_assert(
    public.__rpc_bio_cr_test_expect_fail_cancel(v_editor, v_exp_roles),
    'test 3: editor bloqueado'
  );

  -- Test 4: mesa bloqueada
  PERFORM public.__rpc_bio_cr_test_assert(
    public.__rpc_bio_cr_test_expect_fail_cancel(v_mesa_admin, v_exp_roles),
    'test 4: mesa bloqueada'
  );

  -- Test 5: super_admin bloqueado
  PERFORM public.__rpc_bio_cr_test_assert(
    public.__rpc_bio_cr_test_expect_fail_cancel(v_super, v_exp_roles),
    'test 5: super_admin bloqueado'
  );

  -- Test 6: sin booking activo falla
  PERFORM public.__rpc_bio_cr_test_assert(
    public.__rpc_bio_cr_test_expect_fail_cancel(v_asesor_a1, v_exp_no_booking),
    'test 6: sin booking activo falla'
  );

  -- Test 7: booking ya cancelado falla al cancelar de nuevo
  PERFORM public.__rpc_bio_cr_test_assert(
    public.__rpc_bio_cr_test_expect_fail_cancel(v_asesor_a1, v_exp_already_cancelled),
    'test 7: ya cancelado falla'
  );

  -- Test 8-12: cancelación en v_exp_cancel_checks
  v_result := public.__rpc_bio_cr_test_call_cancel_as(v_asesor_a1, v_exp_cancel_checks, 'motivo prueba');
  PERFORM public.__rpc_bio_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.id = v_booking_id AND b.status = 'cancelled'
    ),
    'test 8: booking cancelled'
  );

  SELECT b.cancelled_at INTO v_cancelled_at
  FROM public.agenda_bookings b WHERE b.id = v_booking_id;
  PERFORM public.__rpc_bio_cr_test_assert(
    v_cancelled_at IS NOT NULL,
    'test 9: cancelled_at lleno'
  );

  PERFORM public.__rpc_bio_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_cancel_checks AND e.fecha_cita IS NULL
    ),
    'test 10: fecha_cita limpiada'
  );

  PERFORM public.__rpc_bio_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_cancel_checks AND e.etapa_actual = 4
    ),
    'test 11: etapa sigue 4'
  );

  PERFORM public.__rpc_bio_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_booking_id
        AND al.action = 'agenda.biometricos.cancel'
    ),
    'test 12: action_log cancel'
  );

  -- Test 13: tras cancelar se puede book de nuevo
  v_result := public.__rpc_bio_cr_test_call_cancel_as(v_asesor_a1, v_exp_rebook_after);
  PERFORM public.__rpc_bio_cr_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 13: cancel previo ok'
  );
  v_result := public.__rpc_bio_cr_test_call_book_as(
    v_asesor_a1, v_exp_rebook_after, v_fecha_nueva, 'sede-nueva'
  );
  PERFORM public.__rpc_bio_cr_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 13: nuevo book tras cancel ok'
  );

  -- Test 14: asesor reagenda
  v_result := public.__rpc_bio_cr_test_call_reagendar_as(
    v_asesor_a1, v_exp_reagendar_ok, v_fecha_nueva, 'sede-reagenda', 'nota reagenda'
  );
  PERFORM public.__rpc_bio_cr_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 14: reagenda ok'
  );
  v_booking_anterior := (v_result->>'booking_anterior_id')::uuid;
  v_booking_nuevo := (v_result->>'booking_nuevo_id')::uuid;

  -- Test 15: booking anterior cancelled
  PERFORM public.__rpc_bio_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.id = v_booking_anterior AND b.status = 'cancelled'
    ),
    'test 15: anterior cancelled'
  );

  -- Test 16: nuevo booking booked
  PERFORM public.__rpc_bio_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.id = v_booking_nuevo
        AND b.status = 'booked'
        AND b.kind = 'biometricos'
        AND b.location_id = 'sede-reagenda'
    ),
    'test 16: nuevo booked'
  );

  -- Test 17: fecha_cita actualizada
  PERFORM public.__rpc_bio_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_reagendar_ok AND e.fecha_cita = v_fecha_nueva
    ),
    'test 17: fecha_cita actualizada'
  );

  -- Test 18: etapa no cambia
  PERFORM public.__rpc_bio_cr_test_assert(
    (v_result->>'etapa_actual')::int = 4,
    'test 18: etapa_actual 4 en respuesta'
  );
  PERFORM public.__rpc_bio_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_reagendar_ok AND e.etapa_actual = 4
    ),
    'test 18: expediente sigue etapa 4'
  );

  -- Test 19: action_log reagendar
  PERFORM public.__rpc_bio_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_booking_nuevo
        AND al.action = 'agenda.biometricos.reagendar'
        AND (al.payload->>'booking_anterior_id')::uuid = v_booking_anterior
    ),
    'test 19: action_log reagendar'
  );

  -- Test 20: fecha pasada falla
  PERFORM public.__rpc_bio_cr_test_assert(
    public.__rpc_bio_cr_test_expect_fail_reagendar(
      v_asesor_a1, v_exp_reagendar_past, v_fecha_pasada, 'sede-x'
    ),
    'test 20: fecha pasada falla'
  );

  -- Test 21: location_id vacío falla
  PERFORM public.__rpc_bio_cr_test_assert(
    public.__rpc_bio_cr_test_expect_fail_reagendar(
      v_asesor_a1, v_exp_reagendar_loc, v_fecha_nueva, '   '
    ),
    'test 21: location vacío falla'
  );

  -- Test 22: sin booking activo falla reagenda
  PERFORM public.__rpc_bio_cr_test_assert(
    public.__rpc_bio_cr_test_expect_fail_reagendar(
      v_asesor_a1, v_exp_reagendar_no_act, v_fecha_nueva, 'sede-x'
    ),
    'test 22: reagenda sin activo falla'
  );

  -- Test 23: tras reagendar permite avance 4→5
  v_result := public.__rpc_bio_cr_test_call_reagendar_as(
    v_asesor_a1, v_exp_avanzar_after, v_fecha_nueva, 'sede-avanzar'
  );
  PERFORM public.__rpc_bio_cr_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 23: reagenda previo avance ok'
  );
  v_result := public.__rpc_bio_cr_test_call_avanzar_as(v_mesa_admin, v_exp_avanzar_after);
  PERFORM public.__rpc_bio_cr_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 5,
    'test 23: avance 4→5 tras reagenda ok'
  );

  -- Test 24: revisor no existe en app_role
  PERFORM public.__rpc_bio_cr_test_assert(
    NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor'
    ),
    'test 24: revisor no existe'
  );

  RAISE NOTICE 'RPC biometricos cancel/reagendar: 24 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_insert_booking(UUID, UUID, UUID, public.booking_status, DATE, TIME, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_insert_expediente(UUID, UUID, UUID, CHAR, SMALLINT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_expect_fail_reagendar(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_expect_fail_cancel(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_call_avanzar_as(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_call_book_as(UUID, UUID, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_call_reagendar_as(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_call_cancel_as(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_bio_cr_test_assert(BOOLEAN, TEXT);
