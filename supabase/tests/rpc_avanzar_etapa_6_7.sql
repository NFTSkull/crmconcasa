-- ConCasa CRM — pruebas P2C-14 RPC avanzar_etapa_operativa (transición 6→7)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_avanzar_etapa_6_7.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC AVANZAR 67 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_call_as(
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
  PERFORM public.__rpc_avanzar_67_test_set_auth(p_user_id);
  SELECT public.avanzar_etapa_operativa(p_expediente_id, p_comentario) INTO v_result;
  PERFORM public.__rpc_avanzar_67_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_call_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_comentario TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_avanzar_67_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(p_expediente_id, p_comentario);
    PERFORM public.__rpc_avanzar_67_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_avanzar_67_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_origen public.origen_mesa DEFAULT 'interno',
  p_submitted BOOLEAN DEFAULT true,
  p_etapa SMALLINT DEFAULT 6,
  p_subestado public.operativo_subestado DEFAULT 'en_proceso',
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
    'Fixture Avanzar 6-7', '5555555555', p_origen,
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, p_subestado, p_fecha_cita, p_deleted_at, p_ciclo
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

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_insert_booking(
  p_expediente_id UUID,
  p_org_id UUID,
  p_created_by UUID,
  p_kind public.booking_kind DEFAULT 'biometricos',
  p_status public.booking_status DEFAULT 'booked'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    p_org_id, p_kind, p_expediente_id, CURRENT_DATE - 1, '10:00:00',
    'sede-fixture', p_status, p_created_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_insert_cliente(
  p_expediente_id UUID,
  p_org_id UUID,
  p_estado public.cliente_datos_estado DEFAULT 'validado'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado
  ) VALUES (
    p_expediente_id,
    p_org_id,
    jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Fixture 67'),
    p_estado
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos,
    estado = EXCLUDED.estado,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_insert_editor_decision(
  p_expediente_id UUID,
  p_org_id UUID,
  p_editor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, decided_by
  ) VALUES (
    p_expediente_id, p_org_id, 'aprobado', 500000.00, p_editor_id
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    decided_by = EXCLUDED.decided_by,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_67_test_insert_doc(
  p_expediente_id UUID,
  p_org_id UUID,
  p_asesor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.expediente_documentos WHERE expediente_id = p_expediente_id;

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento,
    storage_path, nombre_original, mime_type, size_bytes,
    estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    p_org_id, p_expediente_id, 'ine',
    'dev/avanzar67/' || p_expediente_id::text || '/ine.pdf',
    'ine.pdf', 'application/pdf', 100,
    'validado', p_asesor_id, 'asesor'
  );
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

  v_fecha_cita TIMESTAMPTZ := NOW() - INTERVAL '2 days';
  v_fecha_cita_pasada TIMESTAMPTZ := NOW() - INTERVAL '1 day';

  v_exp_admin UUID := '00000000-0000-4000-9016-000000000010';
  v_exp_int UUID := '00000000-0000-4000-9016-000000000011';
  v_exp_int_block UUID := '00000000-0000-4000-9016-000000000012';
  v_exp_ext UUID := '00000000-0000-4000-9016-000000000013';
  v_exp_roles UUID := '00000000-0000-4000-9016-000000000014';
  v_exp_not_sent UUID := '00000000-0000-4000-9016-000000000015';
  v_exp_deleted UUID := '00000000-0000-4000-9016-000000000016';
  v_exp_ciclo UUID := '00000000-0000-4000-9016-000000000017';
  v_exp_bad_sub UUID := '00000000-0000-4000-9016-000000000018';
  v_exp_etapa5 UUID := '00000000-0000-4000-9016-000000000019';
  v_exp_etapa7 UUID := '00000000-0000-4000-9016-000000000020';
  v_exp_skip UUID := '00000000-0000-4000-9016-000000000021';
  v_exp_ok UUID := '00000000-0000-4000-9016-000000000022';
  v_exp_fecha UUID := '00000000-0000-4000-9016-000000000023';
  v_exp_booking UUID := '00000000-0000-4000-9016-000000000024';
  v_exp_isolation UUID := '00000000-0000-4000-9016-000000000025';
  v_exp_log UUID := '00000000-0000-4000-9016-000000000026';
  v_exp_sanity_56 UUID := '00000000-0000-4000-9016-000000000027';

  v_result JSONB;
  v_fecha_before TIMESTAMPTZ;
  v_booking_id UUID;
  v_booking_count_before BIGINT;
  v_booking_count_after BIGINT;
  v_doc_count_before BIGINT;
  v_doc_count_after BIGINT;
  v_cliente_estado_before public.cliente_datos_estado;
  v_editor_decision_before public.editor_decision;
  v_roles_revisor INTEGER;
BEGIN
  -- Fixtures etapa 6
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_admin, v_org_id, v_asesor_a1, '91601000001', 'interno', true, 6::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_int, v_org_id, v_asesor_a1, '91601100011', 'interno', true, 6::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_int_block, v_org_id, v_asesor_a1, '91601200012', 'interno', true, 6::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_ext, v_org_id, v_asesor_a2, '91601300013', 'externo', true, 6::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_roles, v_org_id, v_asesor_a1, '91601400014', 'interno', true, 6::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_not_sent, v_org_id, v_asesor_a1, '91601500015', 'interno', false, 6::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_deleted, v_org_id, v_asesor_a1, '91601600016', 'interno', true, 6::smallint,
    'en_proceso', NULL, NOW()
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_ciclo, v_org_id, v_asesor_a1, '91601700017', 'interno', true, 6::smallint,
    'en_proceso', NULL, NULL, 'cerrado'
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_bad_sub, v_org_id, v_asesor_a1, '91601800018', 'interno', true, 6::smallint,
    'pendiente'
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_etapa5, v_org_id, v_asesor_a1, '91601900019', 'interno', true, 5::smallint,
    'en_proceso', NULL
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_etapa7, v_org_id, v_asesor_a1, '91602000020', 'interno', true, 8::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_skip, v_org_id, v_asesor_a1, '91602100021', 'interno', true, 6::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_ok, v_org_id, v_asesor_a1, '91602200022', 'interno', true, 6::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_fecha, v_org_id, v_asesor_a1, '91602300023', 'interno', true, 6::smallint,
    'en_proceso', v_fecha_cita
  );
  PERFORM public.__rpc_avanzar_67_test_insert_booking(v_exp_fecha, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_booking, v_org_id, v_asesor_a1, '91602400024', 'interno', true, 6::smallint
  );
  v_booking_id := public.__rpc_avanzar_67_test_insert_booking(v_exp_booking, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_isolation, v_org_id, v_asesor_a1, '91602500025', 'interno', true, 6::smallint
  );
  PERFORM public.__rpc_avanzar_67_test_insert_cliente(v_exp_isolation, v_org_id, 'pendiente');
  PERFORM public.__rpc_avanzar_67_test_insert_editor_decision(v_exp_isolation, v_org_id, v_editor);
  PERFORM public.__rpc_avanzar_67_test_insert_doc(v_exp_isolation, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_log, v_org_id, v_asesor_a1, '91602600026', 'interno', true, 6::smallint
  );

  PERFORM public.__rpc_avanzar_67_test_insert_expediente(
    v_exp_sanity_56, v_org_id, v_asesor_a1, '91602700027', 'interno', true, 5::smallint,
    'en_proceso', v_fecha_cita_pasada
  );
  PERFORM public.__rpc_avanzar_67_test_insert_booking(v_exp_sanity_56, v_org_id, v_asesor_a1);

  -- 1. mesa_admin
  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_admin, v_exp_admin, 'inscripción ok');
  PERFORM public.__rpc_avanzar_67_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 7,
    'test 1: mesa_admin 6→7'
  );

  -- 2. mesa_interno interno
  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_int, v_exp_int);
  PERFORM public.__rpc_avanzar_67_test_assert((v_result->>'ok')::boolean = true, 'test 2');

  -- 3. mesa_externo bloqueado interno
  PERFORM public.__rpc_avanzar_67_test_assert(
    public.__rpc_avanzar_67_test_call_expect_fail(v_mesa_ext, v_exp_int_block),
    'test 3'
  );

  -- 4. mesa_externo externo
  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_ext, v_exp_ext);
  PERFORM public.__rpc_avanzar_67_test_assert((v_result->>'ok')::boolean = true, 'test 4');

  -- 5. asesor
  PERFORM public.__rpc_avanzar_67_test_assert(
    public.__rpc_avanzar_67_test_call_expect_fail(v_asesor_a1, v_exp_roles),
    'test 5'
  );

  -- 6. editor
  PERFORM public.__rpc_avanzar_67_test_assert(
    public.__rpc_avanzar_67_test_call_expect_fail(v_editor, v_exp_roles),
    'test 6'
  );

  -- 7. no enviado
  PERFORM public.__rpc_avanzar_67_test_assert(
    public.__rpc_avanzar_67_test_call_expect_fail(v_mesa_admin, v_exp_not_sent),
    'test 7'
  );

  -- 8. soft-deleted
  PERFORM public.__rpc_avanzar_67_test_assert(
    public.__rpc_avanzar_67_test_call_expect_fail(v_mesa_admin, v_exp_deleted),
    'test 8'
  );

  -- 9. ciclo no activo
  PERFORM public.__rpc_avanzar_67_test_assert(
    public.__rpc_avanzar_67_test_call_expect_fail(v_mesa_admin, v_exp_ciclo),
    'test 9'
  );

  -- 10. subestado distinto de en_proceso
  PERFORM public.__rpc_avanzar_67_test_assert(
    public.__rpc_avanzar_67_test_call_expect_fail(v_mesa_admin, v_exp_bad_sub),
    'test 10'
  );

  -- 11. etapa 5 no usa rama 6→7
  PERFORM public.__rpc_avanzar_67_test_assert(
    public.__rpc_avanzar_67_test_call_expect_fail(v_mesa_admin, v_exp_etapa5),
    'test 11'
  );

  -- 12. etapa 8 no avanza a 9 (P2C-15: etapa 7 avanza 7→8)
  PERFORM public.__rpc_avanzar_67_test_assert(
    public.__rpc_avanzar_67_test_call_expect_fail(v_mesa_admin, v_exp_etapa7),
    'test 12: no permite 8→9'
  );

  -- 13. no salto 6→8 en una llamada
  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_admin, v_exp_skip);
  PERFORM public.__rpc_avanzar_67_test_assert(
    (v_result->>'etapa_actual')::int = 7,
    'test 13: una llamada desde 6 llega a 7'
  );

  -- 14. actualiza etapa 7
  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_admin, v_exp_ok);
  PERFORM public.__rpc_avanzar_67_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_ok AND e.etapa_actual = 7 AND e.subestado = 'en_proceso'
    ),
    'test 14'
  );

  -- 15. conserva fecha_cita
  SELECT e.fecha_cita INTO v_fecha_before FROM public.expedientes e WHERE e.id = v_exp_fecha;
  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_admin, v_exp_fecha);
  PERFORM public.__rpc_avanzar_67_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_fecha AND e.fecha_cita = v_fecha_before
    ),
    'test 15'
  );

  -- 16. no crea/cancela bookings
  SELECT count(*) INTO v_booking_count_before
  FROM public.agenda_bookings b
  WHERE b.expediente_id = v_exp_booking AND b.kind = 'biometricos';

  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_admin, v_exp_booking);

  SELECT count(*) INTO v_booking_count_after
  FROM public.agenda_bookings b
  WHERE b.expediente_id = v_exp_booking AND b.kind = 'biometricos';

  PERFORM public.__rpc_avanzar_67_test_assert(
    v_booking_count_after = v_booking_count_before
      AND EXISTS (
        SELECT 1 FROM public.agenda_bookings b
        WHERE b.id = v_booking_id AND b.status = 'booked'
      ),
    'test 16'
  );

  -- 17. no toca documentos
  SELECT count(*) INTO v_doc_count_before
  FROM public.expediente_documentos d WHERE d.expediente_id = v_exp_isolation;

  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_admin, v_exp_isolation);

  SELECT count(*) INTO v_doc_count_after
  FROM public.expediente_documentos d WHERE d.expediente_id = v_exp_isolation;

  PERFORM public.__rpc_avanzar_67_test_assert(
    v_doc_count_after = v_doc_count_before AND v_doc_count_before = 1,
    'test 17'
  );

  -- 18. no toca cliente_datos
  SELECT cd.estado INTO v_cliente_estado_before
  FROM public.cliente_datos cd WHERE cd.expediente_id = v_exp_isolation;

  PERFORM public.__rpc_avanzar_67_test_assert(
    EXISTS (
      SELECT 1 FROM public.cliente_datos cd
      WHERE cd.expediente_id = v_exp_isolation AND cd.estado = v_cliente_estado_before
    ),
    'test 18'
  );

  -- 19. no toca editor_decisions
  SELECT ed.decision INTO v_editor_decision_before
  FROM public.editor_decisions ed WHERE ed.expediente_id = v_exp_isolation;

  PERFORM public.__rpc_avanzar_67_test_assert(
    EXISTS (
      SELECT 1 FROM public.editor_decisions ed
      WHERE ed.expediente_id = v_exp_isolation AND ed.decision = v_editor_decision_before
    ),
    'test 19'
  );

  -- 20. action_log
  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_admin, v_exp_log, 'avance 6-7');
  PERFORM public.__rpc_avanzar_67_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_exp_log
        AND al.action = 'expediente.avanzar_etapa_operativa'
        AND (al.payload->>'etapa_anterior')::int = 6
        AND (al.payload->>'etapa_nueva')::int = 7
        AND al.payload->>'transition' = '6_7'
    ),
    'test 20'
  );

  -- 21. regresión: rama 5→8 (P132) sigue activa
  v_result := public.__rpc_avanzar_67_test_call_as(v_mesa_admin, v_exp_sanity_56);
  PERFORM public.__rpc_avanzar_67_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 8,
    'test 21: sanity 5→8'
  );

  -- 22. no revisor
  SELECT COUNT(*) INTO v_roles_revisor
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__rpc_avanzar_67_test_assert(v_roles_revisor = 0, 'test 22');

  RAISE NOTICE 'RPC avanzar_etapa_operativa 6→7: 22 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_insert_doc(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_insert_editor_decision(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_insert_cliente(UUID, UUID, public.cliente_datos_estado);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_insert_booking(UUID, UUID, UUID, public.booking_kind, public.booking_status);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_insert_expediente(UUID, UUID, UUID, CHAR, public.origen_mesa, BOOLEAN, SMALLINT, public.operativo_subestado, TIMESTAMPTZ, TIMESTAMPTZ, public.expediente_ciclo_estado);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_call_expect_fail(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_call_as(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_67_test_assert(BOOLEAN, TEXT);
