-- ConCasa CRM — pruebas P2C-13 / P132 RPC avanzar_etapa_operativa (transición canónica 5→8)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_avanzar_etapa_5_6.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_56_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC AVANZAR 56 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_56_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_56_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_56_test_call_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_comentario TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_avanzar_56_test_set_auth(p_user_id);
  SELECT public.avanzar_etapa_operativa(p_expediente_id, p_comentario) INTO v_result;
  PERFORM public.__rpc_avanzar_56_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_56_test_call_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_comentario TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_avanzar_56_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(p_expediente_id, p_comentario);
    PERFORM public.__rpc_avanzar_56_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_avanzar_56_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_56_test_call_expect_fail_message(
  p_user_id UUID,
  p_expediente_id UUID,
  p_expected_fragment TEXT,
  p_comentario TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_err TEXT;
BEGIN
  PERFORM public.__rpc_avanzar_56_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(p_expediente_id, p_comentario);
    PERFORM public.__rpc_avanzar_56_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      PERFORM public.__rpc_avanzar_56_test_reset_auth();
      RETURN v_err LIKE '%' || p_expected_fragment || '%';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_56_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_origen public.origen_mesa DEFAULT 'interno',
  p_submitted BOOLEAN DEFAULT true,
  p_etapa SMALLINT DEFAULT 5,
  p_fecha_cita TIMESTAMPTZ DEFAULT NULL,
  p_deleted_at TIMESTAMPTZ DEFAULT NULL,
  p_ciclo public.expediente_ciclo_estado DEFAULT 'activo'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, fecha_cita, deleted_at, ciclo_estado
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture Avanzar 5-6', '5555555555', p_origen,
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, 'en_proceso', p_fecha_cita, p_deleted_at, p_ciclo
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    origen_mesa = EXCLUDED.origen_mesa,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    fecha_cita = EXCLUDED.fecha_cita,
    deleted_at = EXCLUDED.deleted_at,
    ciclo_estado = EXCLUDED.ciclo_estado,
    updated_at = NOW();

  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_56_test_insert_booking(
  p_expediente_id UUID,
  p_org_id UUID,
  p_created_by UUID,
  p_kind public.booking_kind DEFAULT 'biometricos',
  p_status public.booking_status DEFAULT 'booked',
  p_booking_date DATE DEFAULT (CURRENT_DATE + 7),
  p_booking_time TIME DEFAULT '10:00:00'
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
    p_org_id, p_kind, p_expediente_id, p_booking_date, p_booking_time,
    'sede-fixture', p_status, p_created_by,
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
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';

  v_fecha_cita_pasada TIMESTAMPTZ := NOW() - INTERVAL '1 day';
  v_fecha_cita_futura TIMESTAMPTZ := NOW() + INTERVAL '7 days';

  v_exp_admin UUID := '00000000-0000-4000-9015-000000000010';
  v_exp_int UUID := '00000000-0000-4000-9015-000000000011';
  v_exp_int_block UUID := '00000000-0000-4000-9015-000000000012';
  v_exp_ext UUID := '00000000-0000-4000-9015-000000000013';
  v_exp_roles UUID := '00000000-0000-4000-9015-000000000014';
  v_exp_not_sent UUID := '00000000-0000-4000-9015-000000000015';
  v_exp_deleted UUID := '00000000-0000-4000-9015-000000000016';
  v_exp_ciclo UUID := '00000000-0000-4000-9015-000000000017';
  v_exp_no_fecha UUID := '00000000-0000-4000-9015-000000000018';
  v_exp_no_booking UUID := '00000000-0000-4000-9015-000000000019';
  v_exp_cancelled UUID := '00000000-0000-4000-9015-000000000020';
  v_exp_firmas UUID := '00000000-0000-4000-9015-000000000021';
  v_exp_ok UUID := '00000000-0000-4000-9015-000000000022';
  v_exp_fecha UUID := '00000000-0000-4000-9015-000000000023';
  v_exp_booking UUID := '00000000-0000-4000-9015-000000000024';
  v_exp_log UUID := '00000000-0000-4000-9015-000000000025';
  v_exp_skip UUID := '00000000-0000-4000-9015-000000000026';
  v_exp_etapa6 UUID := '00000000-0000-4000-9015-000000000027';
  v_exp_sanity UUID := '00000000-0000-4000-9015-000000000028';
  v_exp_futura UUID := '00000000-0000-4000-9015-000000000029';
  v_exp_chain UUID := '00000000-0000-4000-9015-000000000030';
  v_exp_pasada_explicit UUID := '00000000-0000-4000-9015-000000000031';

  v_result JSONB;
  v_booking_id UUID;
  v_fecha_before TIMESTAMPTZ;
  v_roles_revisor INTEGER;
BEGIN
  -- Fixtures etapa 5 con cita pasada + booking biométrico (happy path 5→8)
  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_admin, v_org_id, v_asesor_a1, '91501000001', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_admin, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_int, v_org_id, v_asesor_a1, '91501100011', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_int, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_int_block, v_org_id, v_asesor_a1, '91501200012', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_int_block, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_ext, v_org_id, v_asesor_a2, '91501300013', 'externo', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_ext, v_org_id, v_asesor_a2);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_roles, v_org_id, v_asesor_a1, '91501400014', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_roles, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_not_sent, v_org_id, v_asesor_a1, '91501500015', 'interno', false, 5::smallint, v_fecha_cita_futura
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_not_sent, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_deleted, v_org_id, v_asesor_a1, '91501600016', 'interno', true, 5::smallint, v_fecha_cita_futura, NOW()
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_deleted, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_ciclo, v_org_id, v_asesor_a1, '91501700017', 'interno', true, 5::smallint, v_fecha_cita_futura,
    NULL, 'cerrado'
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_ciclo, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_no_fecha, v_org_id, v_asesor_a1, '91501800018', 'interno', true, 5::smallint, NULL
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_no_fecha, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_no_booking, v_org_id, v_asesor_a1, '91501900019', 'interno', true, 5::smallint, v_fecha_cita_futura
  );

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_cancelled, v_org_id, v_asesor_a1, '91502000020', 'interno', true, 5::smallint, v_fecha_cita_futura
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(
    v_exp_cancelled, v_org_id, v_asesor_a1, 'biometricos', 'cancelled'
  );

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_firmas, v_org_id, v_asesor_a1, '91502100021', 'interno', true, 5::smallint, v_fecha_cita_futura
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(
    v_exp_firmas, v_org_id, v_asesor_a1, 'firmas', 'booked'
  );

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_ok, v_org_id, v_asesor_a1, '91502200022', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_ok, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_fecha, v_org_id, v_asesor_a1, '91502300023', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_fecha, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_booking, v_org_id, v_asesor_a1, '91502400024', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  v_booking_id := public.__rpc_avanzar_56_test_insert_booking(v_exp_booking, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_log, v_org_id, v_asesor_a1, '91502500025', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_log, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_skip, v_org_id, v_asesor_a1, '91502600026', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_skip, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_etapa6, v_org_id, v_asesor_a1, '91502700027', 'interno', true, 8::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_etapa6, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_sanity, v_org_id, v_asesor_a1, '91502800028', 'interno', true, 4::smallint, NULL
  );

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_futura, v_org_id, v_asesor_a1, '91502900029', 'interno', true, 5::smallint, v_fecha_cita_futura
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_futura, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_chain, v_org_id, v_asesor_a1, '91503000030', 'interno', true, 4::smallint, v_fecha_cita_futura
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_chain, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_56_test_insert_expediente(
    v_exp_pasada_explicit, v_org_id, v_asesor_a1, '91503100031', 'interno', true, 5::smallint, v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_56_test_insert_booking(v_exp_pasada_explicit, v_org_id, v_asesor_a1);

  -- 1. mesa_admin
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_admin, v_exp_admin, 'post-biométricos');
  PERFORM public.__rpc_avanzar_56_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 8,
    'test 1: mesa_admin 5→8'
  );

  -- 2. mesa_interno interno
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_int, v_exp_int);
  PERFORM public.__rpc_avanzar_56_test_assert((v_result->>'ok')::boolean = true, 'test 2');

  -- 3. mesa_externo bloqueado interno
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_ext, v_exp_int_block),
    'test 3'
  );

  -- 4. mesa_externo externo
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_ext, v_exp_ext);
  PERFORM public.__rpc_avanzar_56_test_assert((v_result->>'ok')::boolean = true, 'test 4');

  -- 5. asesor
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_asesor_a1, v_exp_roles),
    'test 5'
  );

  -- 6. editor
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_editor, v_exp_roles),
    'test 6'
  );

  -- 7. no enviado
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_not_sent),
    'test 7'
  );

  -- 8. soft-deleted
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_deleted),
    'test 8'
  );

  -- 9. ciclo no activo
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_ciclo),
    'test 9'
  );

  -- 10. sin fecha_cita
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_no_fecha),
    'test 10'
  );

  -- 22. fecha_cita futura falla
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_futura),
    'test 22: fecha_cita futura falla'
  );

  -- 23. error controlado cita futura
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail_message(
      v_mesa_admin,
      v_exp_futura,
      'avanzar_etapa_operativa: cita biométrica aún no ha ocurrido'
    ),
    'test 23: mensaje cita futura'
  );

  -- 24. cita pasada + booking activo avanza 5→8 (explícito)
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_admin, v_exp_pasada_explicit);
  PERFORM public.__rpc_avanzar_56_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 8,
    'test 24: cita pasada avanza 5→8'
  );

  -- 25. tras 4→5 con cita futura, segundo avance no llega a 8
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_admin, v_exp_chain);
  PERFORM public.__rpc_avanzar_56_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 5,
    'test 25: primer avance 4→5 ok'
  );
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail_message(
      v_mesa_admin,
      v_exp_chain,
      'avanzar_etapa_operativa: cita biométrica aún no ha ocurrido'
    ),
    'test 25: segundo avance bloqueado por cita futura'
  );
  PERFORM public.__rpc_avanzar_56_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_chain AND e.etapa_actual = 5
    ),
    'test 25: permanece en etapa 5'
  );

  -- 11. sin booking activo
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_no_booking),
    'test 11'
  );

  -- 12. booking cancelled
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_cancelled),
    'test 12'
  );

  -- 13. booking firmas
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_firmas),
    'test 13'
  );

  -- 14. actualiza etapa 8
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_admin, v_exp_ok);
  PERFORM public.__rpc_avanzar_56_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_ok AND e.etapa_actual = 8 AND e.subestado = 'en_proceso'
    ),
    'test 14'
  );

  -- 15. conserva fecha_cita
  SELECT e.fecha_cita INTO v_fecha_before FROM public.expedientes e WHERE e.id = v_exp_fecha;
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_admin, v_exp_fecha);
  PERFORM public.__rpc_avanzar_56_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_fecha AND e.fecha_cita = v_fecha_before
    ),
    'test 15'
  );

  -- 16. no cancela booking biométrico
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_admin, v_exp_booking);
  PERFORM public.__rpc_avanzar_56_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp_booking
        AND b.kind = 'biometricos'
        AND b.status = 'booked'
    ),
    'test 16'
  );

  -- 17. action_log
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_admin, v_exp_log, 'avance 5-8');
  PERFORM public.__rpc_avanzar_56_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_exp_log
        AND al.action = 'expediente.avanzar_etapa_operativa'
        AND (al.payload->>'etapa_anterior')::int = 5
        AND (al.payload->>'etapa_nueva')::int = 8
        AND al.payload->>'transition' = '5_8'
        AND al.payload->>'booking_id' IS NOT NULL
    ),
    'test 17'
  );

  -- 18. una llamada desde 5 llega a 8 (P132; no a 6/7)
  v_result := public.__rpc_avanzar_56_test_call_as(v_mesa_admin, v_exp_skip);
  PERFORM public.__rpc_avanzar_56_test_assert(
    (v_result->>'etapa_actual')::int = 8,
    'test 18: una llamada desde 5 llega a 8'
  );

  -- 19. no permite 8→9 sin Acuse (fixture ya en etapa 8)
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_etapa6),
    'test 19: no permite 8→9'
  );

  -- 20. regresión: rama 4→5 sigue evaluando gates (suite 008 cubre happy path)
  PERFORM public.__rpc_avanzar_56_test_assert(
    public.__rpc_avanzar_56_test_call_expect_fail(v_mesa_admin, v_exp_sanity),
    'test 20'
  );

  -- 21. no revisor
  SELECT COUNT(*) INTO v_roles_revisor
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__rpc_avanzar_56_test_assert(v_roles_revisor = 0, 'test 21');

  RAISE NOTICE 'RPC avanzar_etapa_operativa 5→8: 25 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_avanzar_56_test_insert_booking(UUID, UUID, UUID, public.booking_kind, public.booking_status, DATE, TIME);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_56_test_insert_expediente(UUID, UUID, UUID, CHAR, public.origen_mesa, BOOLEAN, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ, public.expediente_ciclo_estado);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_56_test_call_expect_fail_message(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_56_test_call_expect_fail(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_56_test_call_as(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_56_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_avanzar_56_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_56_test_assert(BOOLEAN, TEXT);
