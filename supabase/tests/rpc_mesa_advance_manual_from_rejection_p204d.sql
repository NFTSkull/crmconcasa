-- ConCasa CRM — P204-D: avance/manual desde rechazo (atómico)
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p204d_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P204D TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p204d_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p204d_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9204-000000000001';
  v_asesor UUID := '00000000-0000-4000-9204-000000000011';
  v_mesa UUID := '00000000-0000-4000-9204-000000000012';
  v_exp UUID := '00000000-0000-4000-9204-000000000101';
  v_exp2 UUID := '00000000-0000-4000-9204-000000000102';
  v_exp3 UUID := '00000000-0000-4000-9204-000000000103';
  v_rechazo UUID;
  v_res JSONB;
  v_etapa SMALLINT;
  v_sub TEXT;
  v_reac_count INTEGER;
  v_mov_count INTEGER;
  v_tipo TEXT;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p204d-org', 'P204D Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p204d-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p204d-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES
    (v_asesor, v_org, 'p204d-asesor@test.local', 'Asesor P204D', 'asesor', true),
    (v_mesa, v_org, 'p204d-mesa@test.local', 'Mesa P204D', 'mesa_interno', true);

  -- N5: rechazado etapa1 + DG/docs → avance orquestado 1→2
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '92040000001',
    'Fixture P204D Avance', '5512040001', 'interno', 'activo', true,
    NOW(), 1, 'rechazado'
  );

  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (
    v_exp, v_org,
    jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Fixture'),
    'validado'
  );

  FOREACH v_tipo IN ARRAY ARRAY[
    'cliente_ine_frente',
    'cliente_ine_reverso',
    'cliente_comprobante_domicilio',
    'cliente_estado_cuenta'
  ]::TEXT[] LOOP
    INSERT INTO public.expediente_documentos (
      id, organization_id, expediente_id, tipo_documento, storage_path,
      nombre_original, mime_type, size_bytes, version, estatus_revision,
      uploaded_by, uploaded_by_role
    ) VALUES (
      gen_random_uuid(), v_org, v_exp, v_tipo, 'p204d/' || v_tipo,
      v_tipo || '.pdf', 'application/pdf', 10, 1, 'validado',
      v_asesor, 'asesor'
    );
  END LOOP;

  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior,
    motivo, comentario, biometricos_condicion, decidido_por, decidido_por_rol
  ) VALUES (
    '00000000-0000-4000-9204-000000000201', v_org, v_exp, 1, 'en_validacion_mesa',
    'RFC DEL EDC NO EXISTE', NULL, 'desconocida', v_mesa, 'mesa_interno'
  )
  RETURNING id INTO v_rechazo;

  PERFORM public.__p204d_auth(v_mesa);
  v_res := public.mesa_avanzar_etapa_reactivando_si_necesario(v_exp, NULL);
  PERFORM public.__p204d_reset();

  SELECT e.etapa_actual, e.subestado::TEXT INTO v_etapa, v_sub
  FROM public.expedientes e WHERE e.id = v_exp;
  PERFORM public.__p204d_assert(v_etapa = 2, 'N5 etapa=2');
  PERFORM public.__p204d_assert(v_sub = 'en_proceso', 'N5 subestado=en_proceso');
  PERFORM public.__p204d_assert(
    COALESCE((v_res ->> 'reactivado')::BOOLEAN, false),
    'N5 reactivado=true'
  );

  SELECT COUNT(*)::INTEGER INTO v_reac_count
  FROM public.expediente_rechazo_reactivaciones x
  WHERE x.expediente_id = v_exp AND x.rechazo_id = v_rechazo;
  PERFORM public.__p204d_assert(v_reac_count = 1, 'N5/N7 una reactivación');

  PERFORM public.__p204d_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_exp AND al.action = 'expediente.rechazo_reactivacion'
    )
    AND EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_exp
        AND al.action = 'expediente.avanzar_etapa_operativa'
    ),
    'N5 audit reactivacion + avance'
  );

  -- N8 historial de rechazo intacto
  PERFORM public.__p204d_assert(
    EXISTS (
      SELECT 1 FROM public.expediente_rechazos_operativos r WHERE r.id = v_rechazo
    ),
    'N8 rechazo histórico permanece'
  );

  -- M1 manual 1→2 (sin docs: override)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '92040000002',
    'Fixture P204D Manual', '5512040002', 'interno', 'activo', true,
    NOW(), 1, 'rechazado'
  );

  INSERT INTO public.expediente_rechazos_operativos (
    organization_id, expediente_id, etapa, subestado_anterior,
    motivo, biometricos_condicion, decidido_por, decidido_por_rol
  ) VALUES (
    v_org, v_exp2, 1, 'en_validacion_mesa',
    'Docs', 'desconocida', v_mesa, 'mesa_interno'
  );

  PERFORM public.__p204d_auth(v_mesa);
  v_res := public.mesa_mover_etapa_operativa(
    v_exp2, 2::SMALLINT, 1::SMALLINT, 'Override P204D'
  );
  PERFORM public.__p204d_reset();

  SELECT e.etapa_actual, e.subestado::TEXT INTO v_etapa, v_sub
  FROM public.expedientes e WHERE e.id = v_exp2;
  PERFORM public.__p204d_assert(v_etapa = 2, 'M4 etapa=2');
  PERFORM public.__p204d_assert(v_sub = 'en_proceso', 'M4 subestado=en_proceso');

  SELECT COUNT(*)::INTEGER INTO v_reac_count
  FROM public.expediente_rechazo_reactivaciones x WHERE x.expediente_id = v_exp2;
  PERFORM public.__p204d_assert(v_reac_count = 1, 'M2 una reactivación');

  SELECT COUNT(*)::INTEGER INTO v_mov_count
  FROM public.expediente_movimientos_mesa m WHERE m.expediente_id = v_exp2;
  PERFORM public.__p204d_assert(v_mov_count = 1, 'M3 un movimiento');

  -- M5 docs faltantes → manual PASS (ya probado con v_exp2 sin docs)
  PERFORM public.__p204d_assert(true, 'M5 docs faltantes no bloquean manual');

  -- M8 rollback: same stage after reactivación attempt
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado
  ) VALUES (
    v_exp3, v_org, v_asesor, 'mejoravit', '92040000003',
    'Fixture P204D Rollback', '5512040003', 'interno', 'activo', true,
    NOW(), 1, 'rechazado'
  );

  INSERT INTO public.expediente_rechazos_operativos (
    organization_id, expediente_id, etapa, subestado_anterior,
    motivo, biometricos_condicion, decidido_por, decidido_por_rol
  ) VALUES (
    v_org, v_exp3, 1, 'en_validacion_mesa',
    'Docs', 'desconocida', v_mesa, 'mesa_interno'
  );

  PERFORM public.__p204d_auth(v_mesa);
  BEGIN
    PERFORM public.mesa_mover_etapa_operativa(
      v_exp3, 1::SMALLINT, 1::SMALLINT, 'mismo destino'
    );
    PERFORM public.__p204d_reset();
    RAISE EXCEPTION 'P204D TEST FAIL: se esperaba MESA_MOVE_SAME_STAGE';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p204d_reset();
    IF SQLERRM LIKE 'P204D TEST FAIL:%' THEN RAISE; END IF;
    IF position('MESA_MOVE_SAME_STAGE' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'P204D TEST FAIL: esperaba SAME_STAGE, recibió %', SQLERRM;
    END IF;
  END;

  SELECT e.subestado::TEXT INTO v_sub FROM public.expedientes e WHERE e.id = v_exp3;
  PERFORM public.__p204d_assert(v_sub = 'rechazado', 'M8 sigue rechazado');
  SELECT COUNT(*)::INTEGER INTO v_reac_count
  FROM public.expediente_rechazo_reactivaciones x WHERE x.expediente_id = v_exp3;
  PERFORM public.__p204d_assert(v_reac_count = 0, 'M8 sin reactivación');

  -- M9 no Mesa
  PERFORM public.__p204d_auth(v_asesor);
  BEGIN
    PERFORM public.mesa_mover_etapa_operativa(
      v_exp3, 2::SMALLINT, 1::SMALLINT, 'x'
    );
    PERFORM public.__p204d_reset();
    RAISE EXCEPTION 'P204D TEST FAIL: se esperaba unauthorized';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p204d_reset();
    IF SQLERRM LIKE 'P204D TEST FAIL:%' THEN RAISE; END IF;
    IF position('UNAUTHORIZED' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'P204D TEST FAIL: esperaba UNAUTHORIZED, recibió %', SQLERRM;
    END IF;
  END;

  -- M12 motivo vacío
  PERFORM public.__p204d_auth(v_mesa);
  BEGIN
    PERFORM public.mesa_mover_etapa_operativa(
      v_exp3, 2::SMALLINT, 1::SMALLINT, '   '
    );
    PERFORM public.__p204d_reset();
    RAISE EXCEPTION 'P204D TEST FAIL: se esperaba REASON_REQUIRED';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p204d_reset();
    IF SQLERRM LIKE 'P204D TEST FAIL:%' THEN RAISE; END IF;
    IF position('MESA_MOVE_REASON_REQUIRED' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'P204D TEST FAIL: esperaba REASON_REQUIRED, recibió %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'P204-D SQL fixtures OK';
END;
$$;

ROLLBACK;
