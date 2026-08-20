-- P204-A: rechazo operativo WAITING → Rechazado por Mesa (no Necesita).
\set ON_ERROR_STOP on
\ir ../migrations/203_asesor_inbox_rechazo_operativo_vs_correccion.sql

CREATE OR REPLACE FUNCTION public.__p204a_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P204-A FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_estado_efectivo';

  PERFORM public.__p204a_assert(
    position('RECHAZO_OPERATIVO_CON_CORRECCION' in v_src) > 0,
    'distingue request_type OP'
  );
  PERFORM public.__p204a_assert(
    position('UPDATE public.' in v_src) = 0
    AND position('UPDATE ' in replace(v_src, 'ADVISOR_UPDATE', 'ADVISOR_X')) = 0,
    'sin UPDATE negocio'
  );
  PERFORM public.__p204a_assert(position('sin_asignar' in v_src) = 0, 'no Disponibles');
  RAISE NOTICE 'P204-A contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_r TIMESTAMPTZ := timestamptz '2026-08-05 12:00:00+00';
  v_l TIMESTAMPTZ := timestamptz '2026-08-06 12:00:00+00';
  v_doc UUID;
  v_r1 UUID; v_r2 UUID; v_r3 UUID; v_r5 UUID;
  v_r6 UUID; v_r7 UUID; v_r8 UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_eff TEXT;
  v_p198 TEXT;
  v_rt TEXT;
  v_rechazo UUID;
  v_n_nec INT;
  v_n_rej INT;
BEGIN
  -- R1 documento → Necesita, NO Rechazado
  v_r1 := gen_random_uuid();
  v_ids := array_append(v_ids, v_r1);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_r1, v_org, v_asesor, 'mejoravit', '99120400001', 'P204A R1',
    true, v_envio, 5, 'en_proceso', 'activo'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_r1, v_org, 'aprobado');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_r1, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_r1, 'cliente_ine_frente', 'p204a/r1.pdf',
    'r1.pdf', 'application/pdf', 10, 1, 'rechazado',
    v_asesor, 'asesor'
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc, v_r1, 'subido', 'rechazado', 'ilegible', v_mesa, v_r
  );
  SELECT estado, request_type INTO v_p198, v_rt
  FROM public.mesa_cambio_revision_estado_efectivo(v_r1);
  v_eff := public.asesor_inbox_estado_efectivo(v_r1);
  PERFORM public.__p204a_assert(v_p198 = 'WAITING_ADVISOR', 'R1 P198 WAITING');
  PERFORM public.__p204a_assert(v_rt = 'SOLICITUD_DOCUMENTAL', 'R1 DOC');
  PERFORM public.__p204a_assert(v_eff = 'correccion_requerida', 'R1 Necesita');
  PERFORM public.__p204a_assert(v_eff IS DISTINCT FROM 'rechazado_mesa', 'R1 no Rechazado');

  -- R2 DG → Necesita
  v_r2 := gen_random_uuid();
  v_ids := array_append(v_ids, v_r2);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_r2, v_org, v_asesor, 'mejoravit', '99120400002', 'P204A R2',
    true, v_envio, 2, 'en_proceso', 'activo'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_r2, v_org, 'aprobado');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_r2, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_r2,
    jsonb_build_object('expediente_id', v_r2, 'estado_nuevo', 'rechazado'), v_r
  );
  v_eff := public.asesor_inbox_estado_efectivo(v_r2);
  PERFORM public.__p204a_assert(v_eff = 'correccion_requerida', 'R2 Necesita DG');

  -- R3/R4 rechazo operativo vigente → Rechazado por Mesa
  v_r3 := gen_random_uuid();
  v_ids := array_append(v_ids, v_r3);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado,
    motivo_rechazo
  ) VALUES (
    v_r3, v_org, v_asesor, 'mejoravit', '99120400003', 'P204A R3',
    true, v_envio, 5, 'rechazado', 'activo',
    'Biométricos no aprobados'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_r3, v_org, 'aprobado');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_r3, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    gen_random_uuid(), v_org, v_r3, 5, 'en_proceso', 'Biométricos no aprobados',
    'desconocida', v_mesa, 'mesa_admin', v_r
  );
  SELECT estado, request_type INTO v_p198, v_rt
  FROM public.mesa_cambio_revision_estado_efectivo(v_r3);
  v_eff := public.asesor_inbox_estado_efectivo(v_r3);
  PERFORM public.__p204a_assert(v_p198 = 'WAITING_ADVISOR', 'R3 P198 WAITING');
  PERFORM public.__p204a_assert(v_rt = 'RECHAZO_OPERATIVO_CON_CORRECCION', 'R3 OP');
  PERFORM public.__p204a_assert(v_eff = 'rechazado_mesa', 'R3/R4 Rechazado');
  PERFORM public.__p204a_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'R3 no Necesita');

  -- R5 reactivado → NO Rechazado
  v_r5 := gen_random_uuid();
  v_ids := array_append(v_ids, v_r5);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_r5, v_org, v_asesor, 'mejoravit', '99120400005', 'P204A R5',
    true, v_envio, 5, 'en_proceso', 'activo'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_r5, v_org, 'aprobado');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_r5, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  v_rechazo := gen_random_uuid();
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    v_rechazo, v_org, v_r5, 5, 'en_proceso', 'tmp',
    'desconocida', v_mesa, 'mesa_admin', v_r
  );
  INSERT INTO public.expediente_rechazo_reactivaciones (
    organization_id, expediente_id, rechazo_id, etapa,
    subestado_anterior, subestado_nuevo, reactivado_por, reactivado_por_rol, created_at
  ) VALUES (
    v_org, v_r5, v_rechazo, 5, 'rechazado', 'en_proceso', v_mesa, 'mesa_admin',
    v_r + interval '1 hour'
  );
  v_eff := public.asesor_inbox_estado_efectivo(v_r5);
  PERFORM public.__p204a_assert(v_eff IS DISTINCT FROM 'rechazado_mesa', 'R5 no Rechazado');

  -- R6 corrección documental enviada → Enviada
  v_r6 := gen_random_uuid();
  v_ids := array_append(v_ids, v_r6);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_r6, v_org, v_asesor, 'mejoravit', '99120400006', 'P204A R6',
    true, v_envio, 5, 'en_proceso', 'activo'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_r6, v_org, 'aprobado');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_r6, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_r6, 'cliente_ine_reverso', 'p204a/r6.pdf',
    'r6.pdf', 'application/pdf', 10, 1, 'rechazado',
    v_asesor, 'asesor'
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc, v_r6, 'subido', 'rechazado', 'ilegible', v_mesa, v_r
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (
    v_org, v_r6, v_asesor, 'pendiente_revision', v_l
  );
  v_eff := public.asesor_inbox_estado_efectivo(v_r6);
  PERFORM public.__p204a_assert(v_eff = 'correccion_enviada', 'R6 Enviada');

  -- R7 cancelado → Cancelado
  v_r7 := gen_random_uuid();
  v_ids := array_append(v_ids, v_r7);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_r7, v_org, v_asesor, 'mejoravit', '99120400007', 'P204A R7',
    true, v_envio, 5, 'rechazado', 'cancelado'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_r7, v_org, 'aprobado');
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    gen_random_uuid(), v_org, v_r7, 5, 'en_proceso', 'cancel path',
    'desconocida', v_mesa, 'mesa_admin', v_r
  );
  v_eff := public.asesor_inbox_estado_efectivo(v_r7);
  PERFORM public.__p204a_assert(v_eff = 'cancelado', 'R7 Cancelado');

  -- R8 subestado rechazado stale + reactivado + lote revisado → NO Rechazado
  v_r8 := gen_random_uuid();
  v_ids := array_append(v_ids, v_r8);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_r8, v_org, v_asesor, 'mejoravit', '99120400008', 'P204A R8',
    true, v_envio, 5, 'rechazado', 'activo'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_r8, v_org, 'aprobado');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_r8, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  v_rechazo := gen_random_uuid();
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    v_rechazo, v_org, v_r8, 5, 'en_proceso', 'stale',
    'desconocida', v_mesa, 'mesa_admin', v_r
  );
  INSERT INTO public.expediente_rechazo_reactivaciones (
    organization_id, expediente_id, rechazo_id, etapa,
    subestado_anterior, subestado_nuevo, reactivado_por, reactivado_por_rol, created_at
  ) VALUES (
    v_org, v_r8, v_rechazo, 5, 'rechazado', 'en_proceso', v_mesa, 'mesa_admin',
    v_r + interval '2 hour'
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (
    v_org, v_r8, v_asesor, 'revisado', v_l, v_l + interval '30 min', v_mesa
  );
  v_eff := public.asesor_inbox_estado_efectivo(v_r8);
  PERFORM public.__p204a_assert(v_eff IS DISTINCT FROM 'rechazado_mesa', 'R8 no Rechazado');

  SELECT count(*) INTO v_n_nec
  FROM unnest(v_ids) AS x(id)
  WHERE public.asesor_inbox_estado_efectivo(x.id) = 'correccion_requerida';
  SELECT count(*) INTO v_n_rej
  FROM unnest(v_ids) AS x(id)
  WHERE public.asesor_inbox_estado_efectivo(x.id) = 'rechazado_mesa';
  PERFORM public.__p204a_assert(v_n_nec = 2, 'R9 Necesita = R1+R2');
  PERFORM public.__p204a_assert(v_n_rej = 1, 'R9 Rechazado = R3');

  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazo_reactivaciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.documento_revisiones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_documentos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY(v_ids);
  DELETE FROM public.cliente_datos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.editor_decisions WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expedientes WHERE id = ANY(v_ids);

  RAISE NOTICE 'P204-A R1–R10 OK';
END;
$$;
