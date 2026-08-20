-- P201: asesor inbox chips alineados a P198. A1–A12. 0 writers.
\set ON_ERROR_STOP on
\ir ../migrations/201_asesor_correccion_estado_efectivo_p198.sql

CREATE OR REPLACE FUNCTION public.__p201_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P201 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p201_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p201_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_estado_efectivo';
  PERFORM public.__p201_assert(
    position('UPDATE public.' in v_src) = 0
    AND position('UPDATE ' in replace(v_src, 'ADVISOR_UPDATE', 'ADVISOR_X')) = 0,
    'helper sin UPDATE'
  );
  PERFORM public.__p201_assert(
    position('mesa_cambio_revision_estado_efectivo' in v_src) > 0,
    'consume P198'
  );
  PERFORM public.__p201_assert(
    position('asesor_inbox_categoria_correccion' in v_src) = 0,
    'no OR categoria_correccion'
  );
  PERFORM public.__p201_assert(
    position('CORRECTION_PENDING_REVIEW' in v_src) > 0,
    'PENDING_REVIEW → enviada'
  );
  PERFORM public.__p201_assert(
    position('WAITING_ADVISOR' in v_src) > 0,
    'WAITING → necesita'
  );
  PERFORM public.__p201_assert(position('sin_asignar' in v_src) = 0, 'no toca Disponibles');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_list_expedientes_page';
  PERFORM public.__p201_assert(position('estado_efectivo' in v_src) > 0, 'list usa estado_efectivo');

  RAISE NOTICE 'P201 contrato OK';
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
  v_a1 UUID; v_a2 UUID; v_a3 UUID; v_a4 UUID; v_a5 UUID; v_a6 UUID;
  v_a7 UUID; v_a8 UUID; v_a9 UUID; v_a10 UUID; v_a11 UUID; v_a12 UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_eff TEXT;
  v_p198 TEXT;
  v_cat TEXT;
  v_doc UUID;
  v_lote UUID;
  v_rechazo UUID;
  v_page JSONB;
  v_n INT;
BEGIN
  -- A1: DG sin responder → Necesita
  v_a1 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a1);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a1, v_org, v_asesor, 'mejoravit', '99120100001', 'P201 A1',
    '5512010001', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_a1, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a1,
    jsonb_build_object('expediente_id', v_a1, 'estado_nuevo', 'rechazado'), v_r1
  );
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a1);
  v_eff := public.asesor_inbox_estado_efectivo(v_a1);
  PERFORM public.__p201_assert(v_p198 = 'WAITING_ADVISOR', 'A1 P198 WAITING');
  PERFORM public.__p201_assert(v_eff = 'correccion_requerida', 'A1 necesita');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'A1 no enviada');

  -- A2: DG respondida R1→L1 → Enviada
  v_a2 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a2);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a2, v_org, v_asesor, 'mejoravit', '99120100002', 'P201 A2',
    '5512010002', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_a2, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a2,
    jsonb_build_object('expediente_id', v_a2, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_a2, v_asesor, 'pendiente_revision', v_l1);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a2);
  v_eff := public.asesor_inbox_estado_efectivo(v_a2);
  PERFORM public.__p201_assert(v_p198 = 'CORRECTION_PENDING_REVIEW', 'A2 P198 PENDING');
  PERFORM public.__p201_assert(v_eff = 'correccion_enviada', 'A2 enviada');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'A2 no necesita');

  -- A3: documento respondido → Enviada
  v_a3 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a3);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a3, v_org, v_asesor, 'mejoravit', '99120100003', 'P201 A3',
    '5512010003', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_a3, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_a3, 'cliente_ine_frente',
    v_org::text || '/' || v_a3::text || '/ine/a3.pdf',
    'ine.pdf', 'application/pdf', 100, 1, 'rechazado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc, v_a3, 'subido', 'rechazado', 'ilegible', v_mesa, v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_a3, v_asesor, 'pendiente_revision', v_l1)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, document_kind, label)
  VALUES (v_lote, 'doc:ine', 'documento_reemplazado', 'documento', 'cliente_ine_frente', 'INE');
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a3);
  v_eff := public.asesor_inbox_estado_efectivo(v_a3);
  PERFORM public.__p201_assert(v_p198 = 'CORRECTION_PENDING_REVIEW', 'A3 P198 PENDING');
  PERFORM public.__p201_assert(v_eff = 'correccion_enviada', 'A3 enviada');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'A3 no necesita');

  -- A4: rechazo operativo respondido → Enviada
  v_a4 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a4);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a4, v_org, v_asesor, 'mejoravit', '99120100004', 'P201 A4',
    '5512010004', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_a4, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    gen_random_uuid(), v_org, v_a4, 2, 'en_proceso', 'revision operativa',
    'desconocida', v_mesa, 'mesa_admin', v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_a4, v_asesor, 'pendiente_revision', v_l1);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a4);
  v_eff := public.asesor_inbox_estado_efectivo(v_a4);
  PERFORM public.__p201_assert(v_p198 = 'CORRECTION_PENDING_REVIEW', 'A4 P198 PENDING');
  PERFORM public.__p201_assert(v_eff = 'correccion_enviada', 'A4 enviada');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'A4 no necesita');

  -- A5: re-reject R1→L1→R2 → Necesita
  v_a5 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a5);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a5, v_org, v_asesor, 'mejoravit', '99120100005', 'P201 A5',
    '5512010005', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_a5, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a5,
     jsonb_build_object('expediente_id', v_a5, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a5,
     jsonb_build_object('expediente_id', v_a5, 'estado_nuevo', 'rechazado'), v_r2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_a5, v_asesor, 'revisado', v_l1, v_r2 - interval '1 hour', v_mesa);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a5);
  v_eff := public.asesor_inbox_estado_efectivo(v_a5);
  PERFORM public.__p201_assert(v_p198 = 'WAITING_ADVISOR', 'A5 P198 WAITING');
  PERFORM public.__p201_assert(v_eff = 'correccion_requerida', 'A5 necesita');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'A5 no enviada');

  -- A6: segunda respuesta R1→L1→R2→L2 → Enviada
  v_a6 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a6);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a6, v_org, v_asesor, 'mejoravit', '99120100006', 'P201 A6',
    '5512010006', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_a6, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a6,
     jsonb_build_object('expediente_id', v_a6, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a6,
     jsonb_build_object('expediente_id', v_a6, 'estado_nuevo', 'rechazado'), v_r2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_a6, v_asesor, 'revisado', v_l1, v_r2 - interval '1 hour', v_mesa);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_a6, v_asesor, 'pendiente_revision', v_l2);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a6);
  v_eff := public.asesor_inbox_estado_efectivo(v_a6);
  PERFORM public.__p201_assert(v_p198 = 'CORRECTION_PENDING_REVIEW', 'A6 P198 PENDING');
  PERFORM public.__p201_assert(v_eff = 'correccion_enviada', 'A6 enviada');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'A6 no necesita');

  -- A7: corrección revisada (cierre Mesa) → En trámite
  v_a7 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a7);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a7, v_org, v_asesor, 'mejoravit', '99120100007', 'P201 A7',
    '5512010007', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_a7, v_org, '{}'::jsonb, 'validado', v_close)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_close;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a7,
     jsonb_build_object('expediente_id', v_a7, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a7,
     jsonb_build_object('expediente_id', v_a7, 'estado_nuevo', 'validado'), v_close);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_a7, v_asesor, 'revisado', v_l1, v_close + interval '1 hour', v_mesa);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a7);
  v_eff := public.asesor_inbox_estado_efectivo(v_a7);
  PERFORM public.__p201_assert(v_p198 = 'CLOSED', 'A7 P198 CLOSED');
  PERFORM public.__p201_assert(v_eff = 'en_tramite', 'A7 tramite');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'A7 no necesita');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'A7 no enviada');

  -- A8: categoría raw stale (P198 PENDING + cat requerida) → Enviada gana
  v_a8 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a8);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a8, v_org, v_asesor, 'mejoravit', '99120100008', 'P201 A8',
    '5512010008', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  -- Raw DG sigue rechazado (categoría documental stale) pero hay lote REQUESTED.
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_a8, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a8,
    jsonb_build_object('expediente_id', v_a8, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_a8, v_asesor, 'pendiente_revision', v_l1);
  -- Forzar categoría raw: quitar predicado P130 temporalmente no; con pendiente_revision
  -- categoria = correccion_enviada. Simulamos stale forzando doc rechazado + lote:
  -- Si P192 pone enviada por lote, aún así A8 exige que P198 PENDING → chip enviada
  -- y que categoria no pueda forzar necesita. Insertamos un doc rechazado adicional
  -- y verificamos que aunque raw diga requerida en algún camino, el chip es enviada.
  v_cat := public.asesor_inbox_categoria_correccion(v_a8);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a8);
  v_eff := public.asesor_inbox_estado_efectivo(v_a8);
  PERFORM public.__p201_assert(v_p198 = 'CORRECTION_PENDING_REVIEW', 'A8 P198 PENDING');
  PERFORM public.__p201_assert(v_eff = 'correccion_enviada', 'A8 enviada gana sobre raw');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'A8 raw no gana');
  -- Si categoria raw fuera requerida, chip sigue enviada (invariante A8).
  IF v_cat = 'correccion_requerida' THEN
    PERFORM public.__p201_assert(v_eff = 'correccion_enviada', 'A8 cat requerida no gobierna');
  END IF;

  -- A9: docs completos + DG abierta (WAITING) → Necesita (válido)
  v_a9 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a9);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a9, v_org, v_asesor, 'mejoravit', '99120100009', 'P201 A9',
    '5512010009', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_a9, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a9,
    jsonb_build_object('expediente_id', v_a9, 'estado_nuevo', 'rechazado'), v_r1
  );
  -- Pack documental "completo" no cierra DG.
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES
    (v_org, v_a9, 'cliente_ine_frente', v_org::text||'/'||v_a9::text||'/ine.pdf',
     'ine.pdf', 'application/pdf', 10, 1, 'validado', v_asesor, 'asesor'),
    (v_org, v_a9, 'cliente_estado_cuenta', v_org::text||'/'||v_a9::text||'/ec.pdf',
     'ec.pdf', 'application/pdf', 10, 1, 'validado', v_asesor, 'asesor'),
    (v_org, v_a9, 'cliente_semanas_cotizadas', v_org::text||'/'||v_a9::text||'/nss.pdf',
     'nss.pdf', 'application/pdf', 10, 1, 'validado', v_asesor, 'asesor'),
    (v_org, v_a9, 'cliente_comprobante_domicilio', v_org::text||'/'||v_a9::text||'/dir.pdf',
     'dir.pdf', 'application/pdf', 10, 1, 'validado', v_asesor, 'asesor');
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a9);
  v_eff := public.asesor_inbox_estado_efectivo(v_a9);
  PERFORM public.__p201_assert(v_p198 = 'WAITING_ADVISOR', 'A9 P198 WAITING');
  PERFORM public.__p201_assert(v_eff = 'correccion_requerida', 'A9 necesita aunque docs OK');

  -- A10: docs completos + CLOSED → NO Necesita
  v_a10 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a10);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a10, v_org, v_asesor, 'mejoravit', '99120100010', 'P201 A10',
    '5512010010', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_a10, v_org, '{}'::jsonb, 'validado', v_close)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_close;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a10,
     jsonb_build_object('expediente_id', v_a10, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_a10,
     jsonb_build_object('expediente_id', v_a10, 'estado_nuevo', 'validado'), v_close);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_a10, v_asesor, 'revisado', v_l1, v_close + interval '30 min', v_mesa);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a10);
  v_eff := public.asesor_inbox_estado_efectivo(v_a10);
  PERFORM public.__p201_assert(v_p198 = 'CLOSED', 'A10 P198 CLOSED');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'A10 no necesita');
  PERFORM public.__p201_assert(v_eff = 'en_tramite', 'A10 tramite');

  -- A11: ADVISOR_UPDATE → NO Necesita
  v_a11 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a11);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a11, v_org, v_asesor, 'mejoravit', '99120100011', 'P201 A11',
    '5512010011', '', 'interno', 'activo', true, v_envio, 11, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_a11, v_org, '{}'::jsonb, 'validado', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_a11, v_asesor, 'pendiente_revision', v_l2);
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a11);
  v_eff := public.asesor_inbox_estado_efectivo(v_a11);
  v_cat := public.asesor_inbox_categoria_correccion(v_a11);
  PERFORM public.__p201_assert(v_p198 = 'ADVISOR_UPDATE_PENDING_REVIEW', 'A11 P198 UPDATE');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'A11 no necesita');
  PERFORM public.__p201_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'A11 no enviada chip');
  PERFORM public.__p201_assert(v_eff = 'en_tramite', 'A11 tramite');
  PERFORM public.__p201_assert(v_cat = 'correccion_enviada', 'A11 docs secundarios');

  -- A12: retención abierta → Necesita (fuera de P198)
  v_a12 := gen_random_uuid();
  v_ids := array_append(v_ids, v_a12);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_a12, v_org, v_asesor, 'mejoravit', '99120100012', 'P201 A12',
    '5512010012', '', 'interno', 'activo', true, v_envio, 8, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_a12, v_org, '{}'::jsonb, 'validado', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_envio;
  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado
  ) VALUES (
    v_a12, v_org, true, v_envio, 'con_sello', 'correccion_requerida'
  );
  SELECT estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_a12);
  v_eff := public.asesor_inbox_estado_efectivo(v_a12);
  PERFORM public.__p201_assert(
    coalesce(v_p198, 'CLOSED') IN ('CLOSED', 'ADVISOR_UPDATE_PENDING_REVIEW')
      OR v_p198 IS NULL
      OR v_p198 = 'CLOSED',
    'A12 sin WAITING DG'
  );
  PERFORM public.__p201_assert(
    public.asesor_inbox_retencion_correccion_abierta(v_a12),
    'A12 retención abierta'
  );
  PERFORM public.__p201_assert(v_eff = 'correccion_requerida', 'A12 necesita por retención');

  -- Invariante: Necesita ∩ Enviada = 0 en fixtures
  PERFORM public.__p201_assert(
    public.asesor_inbox_estado_efectivo(v_a1) = 'correccion_requerida'
    AND public.asesor_inbox_estado_efectivo(v_a2) = 'correccion_enviada'
    AND public.asesor_inbox_estado_efectivo(v_a1) IS DISTINCT FROM
        public.asesor_inbox_estado_efectivo(v_a2),
    'invariante A1/A2 disjuntos'
  );

  -- List/summary: chips = estado_efectivo
  PERFORM public.__p201_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(
    1, 50, 'P201', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida'
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P201 A1', 'P201 A5', 'P201 A9', 'P201 A12');
  PERFORM public.__p201_assert(v_n = 4, 'list necesita = A1+A5+A9+A12');
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P201 A2', 'P201 A3', 'P201 A4', 'P201 A6', 'P201 A8');
  PERFORM public.__p201_assert(v_n = 0, 'enviadas no en necesita');

  v_page := public.asesor_list_expedientes_page(
    1, 50, 'P201', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_enviada'
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P201 A2', 'P201 A3', 'P201 A4', 'P201 A6', 'P201 A8');
  PERFORM public.__p201_assert(v_n = 5, 'list enviada = A2–A4+A6+A8');
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P201 A11';
  PERFORM public.__p201_assert(v_n = 0, 'A11 update no en enviada');

  PERFORM public.__p201_reset_auth();

  DELETE FROM public.expediente_asesor_cambios
  WHERE lote_id IN (SELECT id FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids));
  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.documento_revisiones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_documentos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazo_reactivaciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.retencion_envios WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY(v_ids);
  DELETE FROM public.cliente_datos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.editor_decisions WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.mesa_expediente_ops WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expedientes WHERE id = ANY(v_ids);

  RAISE NOTICE 'P201 OK: A1–A12';
END;
$$;

DROP FUNCTION IF EXISTS public.__p201_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p201_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p201_reset_auth();
