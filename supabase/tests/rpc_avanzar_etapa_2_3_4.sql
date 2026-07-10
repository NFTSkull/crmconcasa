-- ConCasa CRM — pruebas P2C-12 / P063 RPC avanzar_etapa_operativa (transiciones 2→3 y 3→5)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_avanzar_etapa_2_3_4.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC AVANZAR 234 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_call_as(
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
  PERFORM public.__rpc_avanzar_234_test_set_auth(p_user_id);
  SELECT public.avanzar_etapa_operativa(p_expediente_id, p_comentario) INTO v_result;
  PERFORM public.__rpc_avanzar_234_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_call_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_comentario TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_avanzar_234_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(p_expediente_id, p_comentario);
    PERFORM public.__rpc_avanzar_234_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_avanzar_234_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_call_book(
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
  PERFORM public.__rpc_avanzar_234_test_set_auth(p_user_id);
  SELECT public.book_biometricos(p_expediente_id, p_scheduled_at, p_location_id) INTO v_result;
  PERFORM public.__rpc_avanzar_234_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_origen public.origen_mesa DEFAULT 'interno',
  p_submitted BOOLEAN DEFAULT true,
  p_etapa SMALLINT DEFAULT 2,
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
    'Fixture Avanzar 2-3-4', '5566666666', p_origen,
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

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_insert_cliente(
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
    jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Fixture Cliente'),
    p_estado
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos,
    estado = EXCLUDED.estado,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_insert_docs(
  p_expediente_id UUID,
  p_org_id UUID,
  p_asesor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo TEXT;
BEGIN
  DELETE FROM public.expediente_documentos
  WHERE expediente_id = p_expediente_id
    AND tipo_documento = ANY(public.integration_doc_tipos_obligatorios());

  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_obligatorios()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org_id, p_expediente_id, v_tipo,
      'dev/avanzar234/' || p_expediente_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'validado', p_asesor_id, 'asesor'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_234_test_insert_booking(
  p_expediente_id UUID,
  p_org_id UUID,
  p_created_by UUID
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
    p_org_id, 'biometricos', p_expediente_id, CURRENT_DATE + 7, '10:00:00',
    'sede-centro', 'booked', p_created_by
  )
  RETURNING id INTO v_id;

  UPDATE public.expedientes
  SET fecha_cita = ((CURRENT_DATE + 7)::timestamp + TIME '10:00') AT TIME ZONE 'UTC'
  WHERE id = p_expediente_id;

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

  v_fecha_cita TIMESTAMPTZ := NOW() + INTERVAL '7 days';

  -- 2→3 fixtures (etapa 2)
  v_exp_23_admin UUID := '00000000-0000-4000-9014-000000000010';
  v_exp_23_int UUID := '00000000-0000-4000-9014-000000000011';
  v_exp_23_int_block UUID := '00000000-0000-4000-9014-000000000012';
  v_exp_23_ext UUID := '00000000-0000-4000-9014-000000000013';
  v_exp_23_roles UUID := '00000000-0000-4000-9014-000000000014';
  v_exp_23_not_sent UUID := '00000000-0000-4000-9014-000000000015';
  v_exp_23_deleted UUID := '00000000-0000-4000-9014-000000000016';
  v_exp_23_ciclo UUID := '00000000-0000-4000-9014-000000000017';
  v_exp_23_ok UUID := '00000000-0000-4000-9014-000000000018';
  v_exp_23_fecha UUID := '00000000-0000-4000-9014-000000000019';
  v_exp_23_log UUID := '00000000-0000-4000-9014-000000000020';

  -- 3→5 fixtures (etapa 3)
  v_exp_34_admin UUID := '00000000-0000-4000-9014-000000000030';
  v_exp_34_int UUID := '00000000-0000-4000-9014-000000000031';
  v_exp_34_ext UUID := '00000000-0000-4000-9014-000000000032';
  v_exp_34_roles UUID := '00000000-0000-4000-9014-000000000033';
  v_exp_34_ok UUID := '00000000-0000-4000-9014-000000000034';
  v_exp_34_fecha UUID := '00000000-0000-4000-9014-000000000035';
  v_exp_34_log UUID := '00000000-0000-4000-9014-000000000036';
  v_exp_34_book UUID := '00000000-0000-4000-9014-000000000037';

  -- Regresión / bloqueos
  v_exp_skip_24 UUID := '00000000-0000-4000-9014-000000000040';
  v_exp_skip_25 UUID := '00000000-0000-4000-9014-000000000041';
  v_exp_etapa5 UUID := '00000000-0000-4000-9014-000000000042';
  v_exp_reg_12 UUID := '00000000-0000-4000-9014-000000000043';
  v_exp_reg_45 UUID := '00000000-0000-4000-9014-000000000044';

  v_result JSONB;
  v_fecha_before TIMESTAMPTZ;
  v_slot TIMESTAMPTZ;
  v_roles_revisor INTEGER;
BEGIN
  -- Fixtures etapa 2
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_admin, v_org_id, v_asesor_a1, '91401000001', 'interno', true, 2::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_int, v_org_id, v_asesor_a1, '91401100011', 'interno', true, 2::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_int_block, v_org_id, v_asesor_a1, '91401200012', 'interno', true, 2::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_ext, v_org_id, v_asesor_a2, '91401300013', 'externo', true, 2::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_roles, v_org_id, v_asesor_a1, '91401400014', 'interno', true, 2::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_not_sent, v_org_id, v_asesor_a1, '91401500015', 'interno', false, 2::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_deleted, v_org_id, v_asesor_a1, '91401600016', 'interno', true, 2::smallint,
    'en_proceso', NULL, NOW()
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_ciclo, v_org_id, v_asesor_a1, '91401700017', 'interno', true, 2::smallint,
    'en_proceso', NULL, NULL, 'cerrado'
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_ok, v_org_id, v_asesor_a1, '91401800018', 'interno', true, 2::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_fecha, v_org_id, v_asesor_a1, '91401900019', 'interno', true, 2::smallint,
    'en_proceso', v_fecha_cita
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_23_log, v_org_id, v_asesor_a1, '91402000020', 'interno', true, 2::smallint
  );

  -- Fixtures etapa 3
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_34_admin, v_org_id, v_asesor_a1, '91403000030', 'interno', true, 3::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_34_int, v_org_id, v_asesor_a1, '91403100031', 'interno', true, 3::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_34_ext, v_org_id, v_asesor_a2, '91403200032', 'externo', true, 3::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_34_roles, v_org_id, v_asesor_a1, '91403300033', 'interno', true, 3::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_34_ok, v_org_id, v_asesor_a1, '91403400034', 'interno', true, 3::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_34_fecha, v_org_id, v_asesor_a1, '91403500035', 'interno', true, 3::smallint,
    'en_proceso', v_fecha_cita
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_34_log, v_org_id, v_asesor_a1, '91403600036', 'interno', true, 3::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_34_book, v_org_id, v_asesor_a1, '91403700037', 'interno', true, 3::smallint
  );

  -- Bookings activos para avance 3→5
  PERFORM public.__rpc_avanzar_234_test_insert_booking(v_exp_34_admin, v_org_id, v_asesor_a1);
  PERFORM public.__rpc_avanzar_234_test_insert_booking(v_exp_34_int, v_org_id, v_asesor_a1);
  PERFORM public.__rpc_avanzar_234_test_insert_booking(v_exp_34_ext, v_org_id, v_asesor_a2);
  PERFORM public.__rpc_avanzar_234_test_insert_booking(v_exp_34_ok, v_org_id, v_asesor_a1);
  PERFORM public.__rpc_avanzar_234_test_insert_booking(v_exp_34_fecha, v_org_id, v_asesor_a1);
  PERFORM public.__rpc_avanzar_234_test_insert_booking(v_exp_34_log, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_skip_24, v_org_id, v_asesor_a1, '91404000040', 'interno', true, 2::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_skip_25, v_org_id, v_asesor_a1, '91404100041', 'interno', true, 3::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_etapa5, v_org_id, v_asesor_a1, '91404200042', 'interno', true, 5::smallint
  );
  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_reg_12, v_org_id, v_asesor_a1, '91404300043', 'interno', true, 1::smallint,
    'en_validacion_mesa'
  );
  PERFORM public.__rpc_avanzar_234_test_insert_cliente(v_exp_reg_12, v_org_id);
  PERFORM public.__rpc_avanzar_234_test_insert_docs(v_exp_reg_12, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_234_test_insert_expediente(
    v_exp_reg_45, v_org_id, v_asesor_a1, '91404400044', 'interno', true, 4::smallint,
    'en_proceso', v_fecha_cita
  );
  PERFORM public.__rpc_avanzar_234_test_insert_booking(v_exp_reg_45, v_org_id, v_asesor_a1);

  -- === Transición 2→3 ===

  -- 1. mesa_admin
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_23_admin, 'listo biométrico');
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 3,
    'test 1: mesa_admin 2→3'
  );

  -- 2. mesa_interno interno
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_int, v_exp_23_int);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 2: mesa_interno 2→3'
  );

  -- 3. mesa_externo bloqueado en interno
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_mesa_ext, v_exp_23_int_block),
    'test 3: mesa_externo bloqueado interno 2→3'
  );

  -- 4. mesa_externo externo
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_ext, v_exp_23_ext);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 4: mesa_externo 2→3 externo'
  );

  -- 5. asesor bloqueado
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_asesor_a1, v_exp_23_roles),
    'test 5: asesor bloqueado 2→3'
  );

  -- 6. editor bloqueado
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_editor, v_exp_23_roles),
    'test 6: editor bloqueado 2→3'
  );

  -- 7. no enviado a Mesa
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_mesa_admin, v_exp_23_not_sent),
    'test 7: no enviado 2→3'
  );

  -- 8. soft-deleted
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_mesa_admin, v_exp_23_deleted),
    'test 8: soft-deleted 2→3'
  );

  -- 9. ciclo no activo
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_mesa_admin, v_exp_23_ciclo),
    'test 9: ciclo no activo 2→3'
  );

  -- 10. actualiza etapa a 3
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_23_ok);
  PERFORM public.__rpc_avanzar_234_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_23_ok AND e.etapa_actual = 3 AND e.subestado = 'en_proceso'
    ),
    'test 10: etapa 3 tras 2→3'
  );

  -- 11. conserva fecha_cita
  SELECT e.fecha_cita INTO v_fecha_before FROM public.expedientes e WHERE e.id = v_exp_23_fecha;
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_23_fecha);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 11: avance fecha 2→3 ok'
  );
  PERFORM public.__rpc_avanzar_234_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_23_fecha AND e.fecha_cita = v_fecha_before
    ),
    'test 11: fecha_cita conservada 2→3'
  );

  -- 12. action_log 2→3
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_23_log, 'avance 2-3');
  PERFORM public.__rpc_avanzar_234_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_exp_23_log
        AND al.action = 'expediente.avanzar_etapa_operativa'
        AND (al.payload->>'etapa_anterior')::int = 2
        AND (al.payload->>'etapa_nueva')::int = 3
        AND al.payload->>'transition' = '2_3'
    ),
    'test 12: action_log 2→3'
  );

  -- === Transición 3→5 ===

  -- 13. mesa_admin
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_34_admin);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'etapa_actual')::int = 5,
    'test 13: mesa_admin 3→5'
  );

  -- 14. mesa_interno
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_int, v_exp_34_int);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 14: mesa_interno 3→5'
  );

  -- 15. mesa_externo externo
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_ext, v_exp_34_ext);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 15: mesa_externo 3→5 externo'
  );

  -- 16. asesor bloqueado
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_asesor_a1, v_exp_34_roles),
    'test 16: asesor bloqueado 3→5'
  );

  -- 17. editor bloqueado
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_editor, v_exp_34_roles),
    'test 17: editor bloqueado 3→5'
  );

  -- 18. actualiza etapa a 5
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_34_ok);
  PERFORM public.__rpc_avanzar_234_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_34_ok AND e.etapa_actual = 5
    ),
    'test 18: etapa 5 tras 3→5'
  );

  -- 19. conserva fecha_cita
  SELECT e.fecha_cita INTO v_fecha_before FROM public.expedientes e WHERE e.id = v_exp_34_fecha;
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_34_fecha);
  PERFORM public.__rpc_avanzar_234_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_34_fecha AND e.fecha_cita = v_fecha_before
    ),
    'test 19: fecha_cita conservada 3→5'
  );

  -- 20. action_log 3→5
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_34_log, 'avance 3-5');
  PERFORM public.__rpc_avanzar_234_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_exp_34_log
        AND al.action = 'expediente.avanzar_etapa_operativa'
        AND (al.payload->>'etapa_anterior')::int = 3
        AND (al.payload->>'etapa_nueva')::int = 5
        AND al.payload->>'transition' = '3_5'
    ),
    'test 20: action_log 3→5'
  );

  -- 21. book_biometricos en etapa 3 y luego avance 3→5
  v_slot := public.agenda_biometricos_slot_ts(2, '12:00', 10);
  v_result := public.__rpc_avanzar_234_test_call_book(v_asesor_a1, v_exp_34_book, v_slot, 'sede-centro');
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 21a: book_biometricos en etapa 3'
  );
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_34_book);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'etapa_actual')::int = 5,
    'test 21b: avanzar 3→5 tras book en etapa 3'
  );

  -- === Regresiones ===

  -- 22. 1→2 sigue activa
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_reg_12);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'etapa_actual')::int = 2,
    'test 22: regresión 1→2'
  );

  -- 23. 4→5 sigue activa
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_reg_45);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'etapa_actual')::int = 5,
    'test 23: regresión 4→5'
  );

  -- 24. no salto 2→4 en una llamada
  v_result := public.__rpc_avanzar_234_test_call_as(v_mesa_admin, v_exp_skip_24);
  PERFORM public.__rpc_avanzar_234_test_assert(
    (v_result->>'etapa_actual')::int = 3,
    'test 24: una llamada desde 2 llega a 3 no a 4'
  );

  -- 25. sin booking bloquea 3→5
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_mesa_admin, v_exp_skip_25),
    'test 25: etapa 3 sin booking bloquea 3→5'
  );

  -- 26. no permite 5→6
  PERFORM public.__rpc_avanzar_234_test_assert(
    public.__rpc_avanzar_234_test_call_expect_fail(v_mesa_admin, v_exp_etapa5),
    'test 26: etapa 5 bloqueada'
  );

  -- 27. no revisor
  SELECT COUNT(*) INTO v_roles_revisor
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__rpc_avanzar_234_test_assert(v_roles_revisor = 0, 'test 27: no revisor');

  RAISE NOTICE 'RPC avanzar_etapa_operativa 2→3/3→5: 27 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_insert_booking(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_insert_docs(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_insert_cliente(UUID, UUID, public.cliente_datos_estado);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_insert_expediente(UUID, UUID, UUID, CHAR, public.origen_mesa, BOOLEAN, SMALLINT, public.operativo_subestado, TIMESTAMPTZ, TIMESTAMPTZ, public.expediente_ciclo_estado);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_call_book(UUID, UUID, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_call_expect_fail(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_call_as(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_234_test_assert(BOOLEAN, TEXT);
