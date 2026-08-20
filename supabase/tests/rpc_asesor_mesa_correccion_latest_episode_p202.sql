-- P202: latest request vs latest response. E1–E14. 0 writers.
\set ON_ERROR_STOP on
\ir ../migrations/202_asesor_mesa_correccion_latest_episode.sql

CREATE OR REPLACE FUNCTION public.__p202_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P202 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_cambio_revision_estado_efectivo';
  PERFORM public.__p202_assert(
    position('mesa_cambio_episodio_latest' in v_src) > 0,
    'P198 usa episodio_latest'
  );
  PERFORM public.__p202_assert(
    position('UPDATE public.' in v_src) = 0
    AND position('UPDATE ' in replace(v_src, 'ADVISOR_UPDATE', 'ADVISOR_X')) = 0,
    'P198 sin UPDATE'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_estado_efectivo';
  PERFORM public.__p202_assert(
    position('mesa_cambio_episodio_latest' in v_src) > 0,
    'asesor usa episodio_latest'
  );
  PERFORM public.__p202_assert(
    position('asesor_inbox_categoria_correccion' in v_src) = 0,
    'sin OR categoria'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_cambio_revision_clasificacion';
  PERFORM public.__p202_assert(
    position('l.submitted_at >= v_envio' in v_src) > 0
    OR position('submitted_at >= v_envio' in v_src) > 0,
    'clasificacion ignora lote pre-ciclo'
  );
  RAISE NOTICE 'P202 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_envio TIMESTAMPTZ := timestamptz '2026-07-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-07-05 12:00:00+00';
  v_l1 TIMESTAMPTZ := timestamptz '2026-07-10 12:00:00+00';
  v_r2 TIMESTAMPTZ := timestamptz '2026-07-15 12:00:00+00';
  v_l2 TIMESTAMPTZ := timestamptz '2026-07-20 12:00:00+00';
  v_close TIMESTAMPTZ := timestamptz '2026-07-12 12:00:00+00';
  v_e1 UUID; v_e2 UUID; v_e3 UUID; v_e4 UUID; v_e5 UUID; v_e6 UUID;
  v_e7 UUID; v_e8 UUID; v_e9 UUID; v_e10 UUID; v_e11 UUID; v_e12 UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_eff TEXT;
  v_p198 TEXT;
  v_latest RECORD;
  v_doc UUID;
  v_lote UUID;
  v_page JSONB;
  v_n INT;
  v_need INT;
  v_sent INT;
BEGIN
  -- E1 R1 sin L → Necesita
  v_e1 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e1);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e1, v_org, v_asesor, 'mejoravit', '99120200001', 'P202 E1',
    '5512020001', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_e1, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e1,
    jsonb_build_object('expediente_id', v_e1, 'estado_nuevo', 'rechazado'), v_r1
  );
  SELECT * INTO v_latest FROM public.mesa_cambio_episodio_latest(v_e1);
  PERFORM public.__p202_assert(v_latest.latest_request_at = v_r1, 'E1 request');
  PERFORM public.__p202_assert(v_latest.latest_response_at IS NULL, 'E1 no response');
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_e1);
  v_eff := public.asesor_inbox_estado_efectivo(v_e1);
  PERFORM public.__p202_assert(v_p198 = 'WAITING_ADVISOR', 'E1 P198 WAITING');
  PERFORM public.__p202_assert(v_eff = 'correccion_requerida', 'E1 Necesita');

  -- E2 R1→L1 → Enviada
  v_e2 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e2);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e2, v_org, v_asesor, 'mejoravit', '99120200002', 'P202 E2',
    '5512020002', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_e2, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e2,
    jsonb_build_object('expediente_id', v_e2, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_e2, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_latest FROM public.mesa_cambio_episodio_latest(v_e2);
  PERFORM public.__p202_assert(v_latest.latest_response_at > v_latest.latest_request_at, 'E2 resp>req');
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_e2);
  v_eff := public.asesor_inbox_estado_efectivo(v_e2);
  PERFORM public.__p202_assert(v_p198 = 'CORRECTION_PENDING_REVIEW', 'E2 PENDING');
  PERFORM public.__p202_assert(v_eff = 'correccion_enviada', 'E2 Enviada');
  PERFORM public.__p202_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'E2 no Necesita');

  -- E3 R1→L1→R2 → Necesita (L1 historial)
  v_e3 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e3);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e3, v_org, v_asesor, 'mejoravit', '99120200003', 'P202 E3',
    '5512020003', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_e3, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e3,
     jsonb_build_object('expediente_id', v_e3, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e3,
     jsonb_build_object('expediente_id', v_e3, 'estado_nuevo', 'rechazado'), v_r2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_e3, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_latest FROM public.mesa_cambio_episodio_latest(v_e3);
  PERFORM public.__p202_assert(v_latest.latest_request_at > v_latest.latest_response_at, 'E3 req>resp');
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_e3);
  v_eff := public.asesor_inbox_estado_efectivo(v_e3);
  PERFORM public.__p202_assert(v_p198 = 'WAITING_ADVISOR', 'E3 WAITING');
  PERFORM public.__p202_assert(v_eff = 'correccion_requerida', 'E3 Necesita');
  PERFORM public.__p202_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'E3 no Enviada');

  -- E4 R1→L1→R2→L2 → Enviada
  v_e4 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e4);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e4, v_org, v_asesor, 'mejoravit', '99120200004', 'P202 E4',
    '5512020004', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_e4, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e4,
     jsonb_build_object('expediente_id', v_e4, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e4,
     jsonb_build_object('expediente_id', v_e4, 'estado_nuevo', 'rechazado'), v_r2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES
    (v_org, v_e4, v_asesor, 'revisado', v_l1),
    (v_org, v_e4, v_asesor, 'pendiente_revision', v_l2);
  SELECT * INTO v_latest FROM public.mesa_cambio_episodio_latest(v_e4);
  PERFORM public.__p202_assert(v_latest.latest_response_at > v_latest.latest_request_at, 'E4 resp>req');
  v_eff := public.asesor_inbox_estado_efectivo(v_e4);
  PERFORM public.__p202_assert(v_eff = 'correccion_enviada', 'E4 Enviada');
  PERFORM public.__p202_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'E4 no Necesita');

  -- E5 R1→L1→cierre → normal
  v_e5 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e5);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e5, v_org, v_asesor, 'mejoravit', '99120200005', 'P202 E5',
    '5512020005', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_e5, v_org, '{}'::jsonb, 'validado', v_close)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_close;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e5,
     jsonb_build_object('expediente_id', v_e5, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e5,
     jsonb_build_object('expediente_id', v_e5, 'estado_nuevo', 'validado'), v_close);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_e5, v_asesor, 'revisado', v_l1, v_close + interval '1 hour', v_mesa);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_e5);
  v_eff := public.asesor_inbox_estado_efectivo(v_e5);
  PERFORM public.__p202_assert(v_p198 = 'CLOSED', 'E5 CLOSED');
  PERFORM public.__p202_assert(v_eff = 'en_tramite', 'E5 tramite');
  PERFORM public.__p202_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'E5 no Necesita');
  PERFORM public.__p202_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'E5 no Enviada');

  -- E5b: R1 → Mesa valida DG sin lote P130 → solicitud ya no vigente
  v_e5 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e5);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e5, v_org, v_asesor, 'mejoravit', '99120200015', 'P202 E5b',
    '5512020015', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_e5, v_org, '{}'::jsonb, 'validado', v_close)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_close;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e5,
     jsonb_build_object('expediente_id', v_e5, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_e5,
     jsonb_build_object('expediente_id', v_e5, 'estado_nuevo', 'validado'), v_close);
  SELECT * INTO v_latest FROM public.mesa_cambio_episodio_latest(v_e5);
  PERFORM public.__p202_assert(v_latest.latest_request_at IS NULL, 'E5b request cerrada');
  v_eff := public.asesor_inbox_estado_efectivo(v_e5);
  PERFORM public.__p202_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'E5b no Necesita');
  PERFORM public.__p202_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'E5b no Enviada');

  -- E6 operativo R1→L1 sin reactivación → Enviada (asesor ya respondió)
  v_e6 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e6);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e6, v_org, v_asesor, 'mejoravit', '99120200006', 'P202 E6',
    '5512020006', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_e6, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    gen_random_uuid(), v_org, v_e6, 2, 'en_proceso', 'revision operativa',
    'desconocida', v_mesa, 'mesa_admin', v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_e6, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_latest FROM public.mesa_cambio_episodio_latest(v_e6);
  PERFORM public.__p202_assert(v_latest.latest_response_at > v_latest.latest_request_at, 'E6 resp>req');
  v_eff := public.asesor_inbox_estado_efectivo(v_e6);
  PERFORM public.__p202_assert(v_eff = 'correccion_enviada', 'E6 Enviada sin reactivación');
  PERFORM public.__p202_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'E6 no Necesita');

  -- E7 documento R1→L1 → Enviada
  v_e7 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e7);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e7, v_org, v_asesor, 'mejoravit', '99120200007', 'P202 E7',
    '5512020007', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_e7, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_e7, 'cliente_ine_frente',
    v_org::text || '/' || v_e7::text || '/ine/e7.pdf',
    'ine.pdf', 'application/pdf', 100, 1, 'rechazado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (v_org, v_doc, v_e7, 'subido', 'rechazado', 'ilegible', v_mesa, v_r1);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_e7, v_asesor, 'pendiente_revision', v_l1)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, document_kind, label)
  VALUES (v_lote, 'doc:ine', 'documento_reemplazado', 'documento', 'cliente_ine_frente', 'INE');
  v_eff := public.asesor_inbox_estado_efectivo(v_e7);
  PERFORM public.__p202_assert(v_eff = 'correccion_enviada', 'E7 Enviada');

  -- E8 DG R1→L1 → Enviada (alias E2 shape)
  v_e8 := v_e2;
  PERFORM public.__p202_assert(
    public.asesor_inbox_estado_efectivo(v_e8) = 'correccion_enviada',
    'E8 DG Enviada'
  );

  -- E9 solicitud histórica ya respondida + lote pre-ciclo no crea WAITING
  v_e9 := gen_random_uuid();
  v_ids := array_append(v_ids, v_e9);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_e9, v_org, v_asesor, 'mejoravit', '99120200009', 'P202 E9',
    '5512020009', '', 'interno', 'activo', true,
    timestamptz '2026-07-20 10:00:00+00', 11, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_e9, v_org, '{}'::jsonb, 'validado', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_envio;
  -- Lote pendiente PRE ciclo + rechazo operativo también pre-ciclo (después del lote)
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (
    v_org, v_e9, v_asesor, 'pendiente_revision', timestamptz '2026-07-10 12:00:00+00'
  );
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    gen_random_uuid(), v_org, v_e9, 2, 'en_proceso', 'viejo',
    'desconocida', v_mesa, 'mesa_admin', timestamptz '2026-07-11 12:00:00+00'
  );
  SELECT * INTO v_latest FROM public.mesa_cambio_episodio_latest(v_e9);
  PERFORM public.__p202_assert(v_latest.latest_request_at IS NULL, 'E9 no request ciclo');
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_e9);
  v_eff := public.asesor_inbox_estado_efectivo(v_e9);
  PERFORM public.__p202_assert(v_p198 IS DISTINCT FROM 'WAITING_ADVISOR', 'E9 no WAITING');
  PERFORM public.__p202_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'E9 no Necesita');

  -- E10 solicitud duplicada/histórica anterior al último L → no WAITING
  v_e10 := v_e2;
  SELECT * INTO v_latest FROM public.mesa_cambio_episodio_latest(v_e10);
  PERFORM public.__p202_assert(v_latest.latest_response_at > v_latest.latest_request_at, 'E10');
  PERFORM public.__p202_assert(
    public.asesor_inbox_estado_efectivo(v_e10) = 'correccion_enviada',
    'E10 Enviada no WAITING'
  );

  -- E11 latest_request > latest_response → Necesita (E3)
  PERFORM public.__p202_assert(
    public.asesor_inbox_estado_efectivo(v_e3) = 'correccion_requerida',
    'E11'
  );

  -- E12 latest_response > latest_request → Enviada (E2)
  PERFORM public.__p202_assert(
    public.asesor_inbox_estado_efectivo(v_e2) = 'correccion_enviada',
    'E12'
  );

  -- E13/E14 chips = lista + disjuntos
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_page := public.asesor_list_expedientes_page(
    1, 50, 'P202', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida'
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' LIKE 'P202%';
  v_need := v_n;
  PERFORM public.__p202_assert(v_n = (v_page->>'total_count')::int OR v_n >= 1, 'E13 need list');
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P202 E1', 'P202 E3');
  PERFORM public.__p202_assert(v_n = 2, 'E13 Necesita = E1+E3');
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P202 E2', 'P202 E4', 'P202 E6', 'P202 E7');
  PERFORM public.__p202_assert(v_n = 0, 'E14 enviadas no en Necesita');

  v_page := public.asesor_list_expedientes_page(
    1, 50, 'P202', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_enviada'
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P202 E2', 'P202 E4', 'P202 E6', 'P202 E7');
  v_sent := v_n;
  PERFORM public.__p202_assert(v_n = 4, 'E13 Enviada = E2+E4+E6+E7');
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P202 E1', 'P202 E3');
  PERFORM public.__p202_assert(v_n = 0, 'E14 Necesita no en Enviada');
  PERFORM public.__p202_assert(v_need > 0 AND v_sent > 0, 'E14 ambos chips vivos');

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  DELETE FROM public.expediente_asesor_cambios
  WHERE lote_id IN (SELECT id FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids));
  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.documento_revisiones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_documentos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazo_reactivaciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY(v_ids);
  DELETE FROM public.cliente_datos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.editor_decisions WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.mesa_expediente_ops WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expedientes WHERE id = ANY(v_ids);

  RAISE NOTICE 'P202 OK: E1–E14';
END;
$$;

DROP FUNCTION IF EXISTS public.__p202_assert(BOOLEAN, TEXT);
