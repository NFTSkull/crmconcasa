-- P219: categoria_correccion alineada al episodio latest. 0 writers.
\set ON_ERROR_STOP on
\ir ../migrations/203_asesor_inbox_rechazo_operativo_vs_correccion.sql
\ir ../migrations/219_asesor_inbox_categoria_correccion_episodio_latest.sql

CREATE OR REPLACE FUNCTION public.__p219_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P219 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  -- Sin recursión: estado_efectivo no debe depender de categoria_correccion.
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_estado_efectivo';
  PERFORM public.__p219_assert(
    position('asesor_inbox_categoria_correccion' in v_src) = 0,
    'estado_efectivo no llama categoria_correccion'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_categoria_correccion';
  PERFORM public.__p219_assert(
    position('mesa_cambio_revision_estado_efectivo' in v_src) > 0,
    'categoria usa P198'
  );
  PERFORM public.__p219_assert(
    position('mesa_cambio_episodio_latest' in v_src) > 0,
    'categoria usa episodio_latest'
  );
  PERFORM public.__p219_assert(
    position('UPDATE ' in lower(v_src)) = 0,
    'categoria sin UPDATE'
  );
  RAISE NOTICE 'P219 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID;
  v_asesor UUID;
  v_mesa UUID;
  v_envio TIMESTAMPTZ := timestamptz '2026-09-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-09-05 12:00:00+00';
  v_s1 TIMESTAMPTZ := timestamptz '2026-09-06 12:00:00+00';
  v_r2 TIMESTAMPTZ := timestamptz '2026-09-07 14:51:11+00';
  v_s2 TIMESTAMPTZ := timestamptz '2026-09-07 16:00:00+00';
  v_e1 UUID; v_e2 UUID; v_e3 UUID; v_e4 UUID; v_e5 UUID; v_e6 UUID; v_e7 UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_cat TEXT;
  v_eff TEXT;
  v_p198 TEXT;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at NULLS LAST, id LIMIT 1;
  PERFORM public.__p219_assert(v_org IS NOT NULL, 'org seed');
  SELECT id INTO v_asesor FROM public.profiles WHERE organization_id = v_org ORDER BY created_at NULLS LAST, id LIMIT 1;
  PERFORM public.__p219_assert(v_asesor IS NOT NULL, 'asesor seed');
  v_mesa := v_asesor;

  -- EP1: R1 + S1 > R1 → correccion_enviada
  v_e1 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e1);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e1, v_org, v_asesor, 'mejoravit', '99121900001', 'P219 E1',
    '5512190001', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_e1, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e1,
    jsonb_build_object('expediente_id', v_e1, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_e1, v_asesor, 'pendiente_revision', v_s1);
  v_cat := public.asesor_inbox_categoria_correccion(v_e1);
  v_eff := public.asesor_inbox_estado_efectivo(v_e1);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_e1);
  PERFORM public.__p219_assert(v_p198 = 'CORRECTION_PENDING_REVIEW', 'E1 P198');
  PERFORM public.__p219_assert(v_cat = 'correccion_enviada', 'E1 cat enviada');
  PERFORM public.__p219_assert(v_eff = 'correccion_enviada', 'E1 eff enviada');

  -- EP2: R1 S1 R2>S1 → correccion_requerida (lote viejo NO gana)
  v_e2 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e2);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e2, v_org, v_asesor, 'mejoravit', '99121900002', 'P219 Nicolas-like',
    '5512190002', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, updated_at)
  VALUES (v_e2, v_org, jsonb_build_object('correccion_post_mesa', '2026-09-07T18:26:58Z'), 'completo', timestamptz '2026-09-07 18:26:58+00')
  ON CONFLICT (expediente_id) DO UPDATE
    SET estado = 'completo',
        datos = jsonb_build_object('correccion_post_mesa', '2026-09-07T18:26:58Z'),
        updated_at = timestamptz '2026-09-07 18:26:58+00';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e2,
     jsonb_build_object('expediente_id', v_e2, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e2,
     jsonb_build_object('expediente_id', v_e2, 'estado_nuevo', 'rechazado'), v_r2);
  -- Lote viejo submitted ANTES de R2 (como Nicolas)
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_e2, v_asesor, 'pendiente_revision', v_s1);
  v_cat := public.asesor_inbox_categoria_correccion(v_e2);
  v_eff := public.asesor_inbox_estado_efectivo(v_e2);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_e2);
  PERFORM public.__p219_assert(v_p198 = 'WAITING_ADVISOR', 'E2 WAITING');
  PERFORM public.__p219_assert(v_eff = 'correccion_requerida', 'E2 eff requerida');
  PERFORM public.__p219_assert(v_cat = 'correccion_requerida', 'E2 cat requerida (no stale enviada)');
  PERFORM public.__p219_assert(v_cat IS DISTINCT FROM 'correccion_enviada', 'E2 no enviada');

  -- EP3: R1 S1 R2 S2>R2 → correccion_enviada
  v_e3 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e3);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e3, v_org, v_asesor, 'mejoravit', '99121900003', 'P219 E3',
    '5512190003', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_e3, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e3,
     jsonb_build_object('expediente_id', v_e3, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e3,
     jsonb_build_object('expediente_id', v_e3, 'estado_nuevo', 'rechazado'), v_r2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES
    (v_org, v_e3, v_asesor, 'revisado', v_s1),
    (v_org, v_e3, v_asesor, 'pendiente_revision', v_s2);
  v_cat := public.asesor_inbox_categoria_correccion(v_e3);
  v_eff := public.asesor_inbox_estado_efectivo(v_e3);
  PERFORM public.__p219_assert(v_cat = 'correccion_enviada', 'E3 cat enviada');
  PERFORM public.__p219_assert(v_eff = 'correccion_enviada', 'E3 eff enviada');

  -- CLOSED: lote histórico no reabre corrección vía categoria (P198 CLOSED → fallback docs)
  v_e4 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e4);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e4, v_org, v_asesor, 'mejoravit', '99121900004', 'P219 CLOSED',
    '5512190004', '', 'interno', 'activo', true, v_envio, 3, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_e4, v_org, '{}'::jsonb, 'validado', v_s2)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_s2;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e4,
    jsonb_build_object('expediente_id', v_e4, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_e4, v_asesor, 'revisado', v_s1);
  -- Cierre canónico: validado post-lote (depende de mesa_cambio_tiene_cierre_canonico)
  v_cat := public.asesor_inbox_categoria_correccion(v_e4);
  v_eff := public.asesor_inbox_estado_efectivo(v_e4);
  PERFORM public.__p219_assert(v_cat IS DISTINCT FROM 'correccion_requerida' OR v_eff IS DISTINCT FROM 'correccion_requerida', 'E4 no reabre requerida inconsistente');
  -- Al menos: no forzar enviada por lote revisado viejo sin PENDING
  PERFORM public.__p219_assert(
    NOT public.expediente_tiene_correccion_asesor_pendiente(v_e4),
    'E4 sin lote pendiente'
  );

  -- Operativo WAITING: no convertir a correccion_requerida de DG vía categoria
  v_e5 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e5);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e5, v_org, v_asesor, 'mejoravit', '99121900005', 'P219 OP',
    '5512190005', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_e5, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'mesa.rechazo_operativo', 'expediente', v_e5,
    jsonb_build_object(
      'expediente_id', v_e5,
      'request_type', 'RECHAZO_OPERATIVO_CON_CORRECCION'
    ), v_r2
  );
  -- Si P198 clasifica OP WAITING, categoria no debe ser correccion_enviada por lote viejo
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_e5, v_asesor, 'pendiente_revision', v_s1);
  v_cat := public.asesor_inbox_categoria_correccion(v_e5);
  v_eff := public.asesor_inbox_estado_efectivo(v_e5);
  SELECT estado, request_type INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_e5);
  IF v_p198 = 'WAITING_ADVISOR' THEN
    PERFORM public.__p219_assert(v_cat IS DISTINCT FROM 'correccion_enviada', 'E5 OP no enviada stale');
    PERFORM public.__p219_assert(v_eff IS DISTINCT FROM 'correccion_requerida' OR v_eff = 'rechazado_mesa', 'E5 OP no DG requerida falsa');
  END IF;

  -- Retención abierta → correccion_requerida (sin regresión)
  v_e6 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e6);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e6, v_org, v_asesor, 'mejoravit', '99121900006', 'P219 RET',
    '5512190006', '', 'interno', 'activo', true, v_envio, 3, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_e6, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, opcion, estado, updated_at
  ) VALUES (v_e6, v_org, true, 'con_sello', 'correccion_requerida', now())
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'correccion_requerida', updated_at = now();
  v_cat := public.asesor_inbox_categoria_correccion(v_e6);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_e6);
  IF v_p198 IS DISTINCT FROM 'WAITING_ADVISOR' AND v_p198 IS DISTINCT FROM 'CORRECTION_PENDING_REVIEW' THEN
    PERFORM public.__p219_assert(v_cat = 'correccion_requerida', 'E6 cat retención');
  END IF;

  -- Documental sin episodio: faltantes / no forzar correccion_*
  v_e7 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e7);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e7, v_org, v_asesor, 'mejoravit', '99121900007', 'P219 DOC',
    '5512190007', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_e7, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  v_cat := public.asesor_inbox_categoria_correccion(v_e7);
  PERFORM public.__p219_assert(
    v_cat IN ('faltantes', 'pendiente_revision_documental', 'documentos_validados', 'correccion_requerida', 'correccion_enviada'),
    'E7 cat documental conocida'
  );
  -- Sin request DG: no debe ser correccion_enviada por lote inexistente
  PERFORM public.__p219_assert(
    NOT public.expediente_tiene_correccion_asesor_pendiente(v_e7),
    'E7 sin lote'
  );

  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY (v_ids);
  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY (v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY (v_ids);
  DELETE FROM public.cliente_datos WHERE expediente_id = ANY (v_ids);
  DELETE FROM public.retencion_envios WHERE expediente_id = ANY (v_ids);
  DELETE FROM public.expedientes WHERE id = ANY (v_ids);

  RAISE NOTICE 'P219 fixtures OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p219_assert(BOOLEAN, TEXT);
