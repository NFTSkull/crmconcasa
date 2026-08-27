-- P193: origen de Cambios por revisar. Casos A–L + counts + Natividad-like + P192 parent.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p193_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P193 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p193_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p193_reset_auth()
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
  WHERE n.nspname = 'public' AND p.proname = 'mesa_cambio_revision_clasificacion'
  LIMIT 1;
  PERFORM public.__p193_assert(v_src IS NOT NULL, 'helper clasificacion existe');
  PERFORM public.__p193_assert(position('STABLE' in v_src) > 0, 'helper STABLE');
  PERFORM public.__p193_assert(position('REQUESTED_CORRECTION' in v_src) > 0, 'origin requested');
  PERFORM public.__p193_assert(position('ADVISOR_UPDATE' in v_src) > 0, 'origin advisor');
  PERFORM public.__p193_assert(position('AMBIGUOUS' in v_src) > 0, 'origin ambiguous');
  PERFORM public.__p193_assert(position('LEGACY' in v_src) > 0, 'origin legacy');
  PERFORM public.__p193_assert(position('UPDATE ' in v_src) = 0, 'helper sin UPDATE');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_categoria_resumen'
  LIMIT 1;
  PERFORM public.__p193_assert(
    position('expediente_tiene_correccion_asesor_pendiente' in v_src) > 0,
    'P192 categoria intacta'
  );
  PERFORM public.__p193_assert(position('etapa_actual' in v_src) = 0, 'P192 sin stage gate');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p193_assert(
    position('mesa_bandeja_categoria_resumen' in v_src) > 0,
    'lista hereda categoria P192'
  );
  PERFORM public.__p193_assert(
    position('expediente_asesor_cambio_lotes' in v_src) = 0,
    'lista no duplica predicado P130'
  );
  PERFORM public.__p193_assert(position('correccion_solicitada' in v_src) > 0, 'quick solicitada');
  PERFORM public.__p193_assert(position('otras_actualizaciones' in v_src) > 0, 'quick otras');
  PERFORM public.__p193_assert(position('correccionesSolicitadas' in v_src) > 0, 'count solicitadas');
  PERFORM public.__p193_assert(position('otrasActualizaciones' in v_src) > 0, 'count otras');
  PERFORM public.__p193_assert(
    position('asesor_inbox_categoria_correccion' in v_src) = 0,
    'lista no toca inbox asesor'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_categoria_correccion'
  LIMIT 1;
  PERFORM public.__p193_assert(
    position('mesa_cambio_revision_clasificacion' in v_src) = 0,
    'asesor inbox no usa P193'
  );

  RAISE NOTICE 'P193 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_envio TIMESTAMPTZ := timestamptz '2026-07-01 10:00:00+00';
  v_t1 TIMESTAMPTZ := timestamptz '2026-07-05 12:00:00+00';
  v_t2 TIMESTAMPTZ := timestamptz '2026-07-06 12:00:00+00';
  v_t3 TIMESTAMPTZ := timestamptz '2026-07-10 12:00:00+00';
  v_submit TIMESTAMPTZ := timestamptz '2026-07-20 18:00:00+00';
  v_exp UUID;
  v_doc UUID;
  v_doc2 UUID;
  v_lote UUID;
  v_rechazo UUID;
  v_cls RECORD;
  v_page JSONB;
  v_count INT;
  v_parent INT;
  v_req INT;
  v_otras INT;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_id UUID;
  v_seen INT;
BEGIN
  -- A. DG rejected abierta → lote = REQUESTED
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300001',
    'P193 A DG abierta', '5519230001', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_t1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC');
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'REQUESTED_CORRECTION', 'A origin');
  PERFORM public.__p193_assert(v_cls.request_type = 'SOLICITUD_DATOS_GENERALES', 'A type');
  PERFORM public.__p193_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'A parent P192'
  );

  -- B. DG rejected → validado → lote posterior = ADVISOR
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300002',
    'P193 B DG cerrada', '5519230002', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_t2)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_t2;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_t1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'validado'), v_t2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC');
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'ADVISOR_UPDATE', 'B origin');

  -- C. doc rejected abierta → lote = REQUESTED documental
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300003',
    'P193 C doc abierta', '5519230003', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_estado_cuenta',
    v_org::text || '/' || v_exp::text || '/cliente_estado_cuenta/p193c.pdf',
    'edc.pdf', 'application/pdf', 100, 1, 'subido', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc, v_exp, 'subido', 'rechazado', 'ilegible', v_mesa, v_t1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, document_kind, label)
  VALUES (v_lote, 'doc:edc', 'documento_reemplazado', 'documento', 'cliente_estado_cuenta', 'EDC');
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'REQUESTED_CORRECTION', 'C origin');
  PERFORM public.__p193_assert(v_cls.request_type = 'SOLICITUD_DOCUMENTAL', 'C type');

  -- D. doc rejected → validado same tipo (otro documento_id) → lote = ADVISOR
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300004',
    'P193 D doc cerrada', '5519230004', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role, deleted_at
  ) VALUES (
    v_org, v_exp, 'cliente_estado_cuenta',
    v_org::text || '/' || v_exp::text || '/cliente_estado_cuenta/p193d1.pdf',
    'edc1.pdf', 'application/pdf', 100, 1, 'rechazado', v_asesor, 'asesor', now()
  ) RETURNING id INTO v_doc;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_estado_cuenta',
    v_org::text || '/' || v_exp::text || '/cliente_estado_cuenta/p193d2.pdf',
    'edc2.pdf', 'application/pdf', 100, 2, 'validado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc2;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES
    (v_org, v_doc, v_exp, 'subido', 'rechazado', 'ilegible', v_mesa, v_t1),
    (v_org, v_doc2, v_exp, 'resubido', 'validado', NULL, v_mesa, v_t2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC');
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'ADVISOR_UPDATE', 'D origin same tipo');

  -- E. rechazo operativo abierto → lote = REQUESTED
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300005',
    'P193 E op abierto', '5519230005', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    gen_random_uuid(), v_org, v_exp, 2, 'en_proceso', 'revision operativa',
    'desconocida', v_mesa, 'mesa_admin', v_t1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC');
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'REQUESTED_CORRECTION', 'E origin');
  PERFORM public.__p193_assert(v_cls.request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION', 'E type');

  -- F. operativo → reactivación → lote posterior = ADVISOR
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300006',
    'P193 F op cerrado', '5519230006', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  v_rechazo := gen_random_uuid();
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    v_rechazo, v_org, v_exp, 2, 'en_proceso', 'revision operativa',
    'desconocida', v_mesa, 'mesa_admin', v_t1
  );
  INSERT INTO public.expediente_rechazo_reactivaciones (
    organization_id, expediente_id, rechazo_id, etapa,
    subestado_anterior, subestado_nuevo, reactivado_por, reactivado_por_rol, created_at
  ) VALUES (
    v_org, v_exp, v_rechazo, 2, 'rechazado', 'en_proceso', v_asesor, 'asesor', v_t2
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC');
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'ADVISOR_UPDATE', 'F origin');

  -- G. sin solicitud → P130 = ADVISOR
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300007',
    'P193 G sin solicitud', '5519230007', '', 'interno', 'activo',
    true, v_envio, 4, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC');
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'ADVISOR_UPDATE', 'G origin');

  -- H. submitted_at < fecha_envio_mesa sin prior = AMBIGUOUS
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300008',
    'P193 H ambiguous', '5519230008', '', 'interno', 'activo',
    true, timestamptz '2026-07-21 10:00:00+00', 9, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC');
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'AMBIGUOUS', 'H origin');

  -- I. legacy P102 sin P130 = LEGACY (cliente_datos actualizado post envío, sin validar)
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300009',
    'P193 I legacy', '5519230009', '', 'interno', 'activo',
    true, v_envio, 1, 'en_validacion_mesa', v_envio
  );
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, validated_at, updated_at
  ) VALUES (v_exp, v_org, '{}'::jsonb, 'completo', NULL, v_t3)
  ON CONFLICT (expediente_id) DO UPDATE
    SET estado = 'completo', validated_at = NULL, updated_at = v_t3;
  PERFORM public.__p193_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'I parent legacy P102'
  );
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'LEGACY', 'I origin');
  PERFORM public.__p193_assert(v_cls.batch_id IS NULL, 'I sin lote');

  -- J. etapa 12 requested
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300010',
    'P193 J etapa12 requested', '5519230010', '', 'interno', 'activo',
    true, v_envio, 12, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_t1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC');
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'REQUESTED_CORRECTION', 'J etapa12 requested');
  PERFORM public.__p193_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'J parent sin stage gate'
  );

  -- K + Natividad-like: etapa 12, lote vacío, sin solicitud = ADVISOR
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300011',
    'P193 K natividad-like', '5519230011', '', 'interno', 'activo',
    true, v_envio, 12, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'validado', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit);
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'ADVISOR_UPDATE', 'K natividad-like');
  PERFORM public.__p193_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'K parent YES'
  );

  -- L. lote revisado: no parent P130 (docs/DG validados)
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192300012',
    'P193 L revisado', '5519230012', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'validado', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (
    v_org, v_exp, v_asesor, 'revisado', v_t3, v_submit, v_mesa
  );
  PERFORM public.__p193_assert(
    public.expediente_tiene_correccion_asesor_pendiente(v_exp) IS FALSE,
    'L helper pending false'
  );
  PERFORM public.__p193_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) IS DISTINCT FROM 'correccion_enviada',
    'L no parent P130'
  );
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin IS NULL, 'L clasificacion vacia');

  -- No-solicitud events must not become requested (view/take/asesor)
  v_exp := v_ids[7]; -- G
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'mesa.expediente.view', 'expediente', v_exp, '{}'::jsonb, v_t1),
    (v_org, v_mesa, 'mesa_admin', 'mesa.expediente.take', 'expediente', v_exp, '{}'::jsonb, v_t1),
    (v_org, v_asesor, 'asesor', 'cliente_datos.actualizado_post_mesa', 'cliente_datos', v_exp,
     jsonb_build_object('estado_nuevo', 'validado'), v_t1),
    (v_org, v_asesor, 'asesor', 'cliente_datos.correccion_post_mesa', 'cliente_datos', v_exp,
     jsonb_build_object('estado_nuevo', 'completo'), v_t1);
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p193_assert(v_cls.origin = 'ADVISOR_UPDATE', 'G sigue advisor tras view/take');

  -- RPC: parent / subfiltros / counts / no overlap / Natividad-like
  PERFORM public.__p193_set_auth(v_mesa);
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_enviada', 'todo_mesa',
    'P193', NULL, NULL, false, NULL, 'rechazados', NULL, true
  );
  v_parent := coalesce((v_page->'counts'->>'correccionesEnviadas')::int, -1);
  v_req := coalesce((v_page->'counts'->>'correccionesSolicitadas')::int, -1);
  v_otras := coalesce((v_page->'counts'->>'otrasActualizaciones')::int, -1);
  PERFORM public.__p193_assert(v_parent = v_req + v_otras, 'counts parent = requested + otras');

  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' LIKE 'P193%';
  -- P198/P202: parent = PENDING_REVIEW. H (AMBIGUOUS pre-envio) e I (LEGACY sin lote)
  -- quedan CLOSED en estado_efectivo; categoria P192 puede seguir marcándolos.
  PERFORM public.__p193_assert(v_count >= 9, 'parent lista incluye fixtures P193 actionable');

  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P193 H ambiguous', 'P193 I legacy');
  PERFORM public.__p193_assert(v_count = 0, 'H/I no en parent P198 (CLOSED)');

  -- Natividad-like: parent yes, requested no, otras yes
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P193 K natividad-like';
  PERFORM public.__p193_assert(v_count = 1, 'K en parent');
  PERFORM public.__p193_assert(
    (
      SELECT x->>'cambio_revision_origen'
      FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
      WHERE x->>'cliente_nombre' = 'P193 K natividad-like'
      LIMIT 1
    ) = 'ADVISOR_UPDATE',
    'K metadata advisor'
  );

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_solicitada', 'todo_mesa',
    'P193 K natividad-like', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P193 K natividad-like';
  PERFORM public.__p193_assert(v_count = 0, 'K no en solicitadas');
  PERFORM public.__p193_assert((v_page->>'total_count')::int = 0, 'K total_count solicitadas 0');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'otras_actualizaciones', 'todo_mesa',
    'P193 K natividad-like', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P193 K natividad-like';
  PERFORM public.__p193_assert(v_count = 1, 'K en otras');

  -- A en solicitadas, no en otras
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_solicitada', 'todo_mesa',
    'P193 A DG abierta', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P193 A DG abierta';
  PERFORM public.__p193_assert(v_count = 1, 'A en solicitadas');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'otras_actualizaciones', 'todo_mesa',
    'P193 A DG abierta', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P193 A DG abierta';
  PERFORM public.__p193_assert(v_count = 0, 'A no en otras');

  -- No overlap / no orphan entre subfiltros para fixtures P193 del parent
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_enviada', 'todo_mesa',
    'P193', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  v_seen := 0;
  FOR v_id IN
    SELECT (x->>'id')::uuid
    FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
    WHERE x->>'cliente_nombre' LIKE 'P193%'
      AND x->>'cliente_nombre' IS DISTINCT FROM 'P193 L revisado'
  LOOP
    v_seen := v_seen + 1;
  END LOOP;
  PERFORM public.__p193_assert(v_seen >= 9, 'fixtures en parent actionable');

  -- Filtros existentes intactos (nuevos no vacío)
  v_page := public.mesa_list_bandeja_page(
    25, NULL, NULL, 'nuevos', 'todo_mesa',
    NULL, NULL, NULL, false, NULL, 'rechazados', NULL, true
  );
  PERFORM public.__p193_assert(v_page ? 'items', 'quick nuevos responde');
  PERFORM public.__p193_assert(v_page->'counts' ? 'nuevos', 'counts nuevos');

  PERFORM public.__p193_reset_auth();

  -- Cleanup fixtures para no contaminar P192/P130 (NSS unique).
  DELETE FROM public.expediente_asesor_cambios
  WHERE lote_id IN (
    SELECT id FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids)
  );
  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.documento_revisiones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_documentos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazo_reactivaciones
  WHERE rechazo_id IN (
    SELECT id FROM public.expediente_rechazos_operativos WHERE expediente_id = ANY(v_ids)
  );
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.action_log
  WHERE entity_id = ANY(v_ids);
  DELETE FROM public.cliente_datos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.mesa_expediente_ops WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expedientes WHERE id = ANY(v_ids);

  RAISE NOTICE 'P193 OK: A–L + counts + natividad-like + P192 parent';
END;
$$;

DROP FUNCTION IF EXISTS public.__p193_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p193_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p193_reset_auth();
