-- P194: detalle robusto cambios asesor — preview, labels, recover read-time.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p194_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P194 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p194_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p194_reset_auth()
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
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_asesor_cambios_summary'
  LIMIT 1;
  PERFORM public.__p194_assert(v_src IS NOT NULL, 'summary existe');
  PERFORM public.__p194_assert(position('preview_changes' in v_src) > 0, 'summary preview_changes');
  PERFORM public.__p194_assert(position('LIMIT 3' in v_src) > 0, 'summary max 3');
  PERFORM public.__p194_assert(position('mesa_asesor_cambio_recover_empty_lote' in v_src) > 0, 'summary recover');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_asesor_cambio_preview_item'
  LIMIT 1;
  PERFORM public.__p194_assert(position('has_old' in v_src) > 0, 'preview has_old');
  PERFORM public.__p194_assert(position('''valor_anterior''' in v_src) = 0, 'preview sin clave valor_anterior');
  PERFORM public.__p194_assert(position('''valor_nuevo''' in v_src) = 0, 'preview sin clave valor_nuevo');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_get_asesor_cambio_lote'
  LIMIT 1;
  PERFORM public.__p194_assert(position('recovered_changes' in v_src) > 0, 'detalle recovered');
  PERFORM public.__p194_assert(position('history_confidence' in v_src) > 0, 'detalle history');

  PERFORM public.__p194_assert(
    public.mesa_asesor_cambio_doc_kind_label('asesor_evidencia', 'documento_reemplazado')
      = 'Evidencia del asesor reemplazada',
    'label asesor_evidencia'
  );
  PERFORM public.__p194_assert(
    public.mesa_asesor_cambio_doc_kind_label('cliente_notificacion', 'documento_reemplazado')
      = 'Notificación reemplazada',
    'label notificacion fem'
  );
  PERFORM public.__p194_assert(
    public.mesa_asesor_cambio_doc_kind_label('cliente_notificacion_apodaca', 'documento_reemplazado')
      = 'Notificación reemplazada',
    'label apodaca fem'
  );
  PERFORM public.__p194_assert(
    public.mesa_asesor_cambio_doc_kind_label('cliente_carta_empresa', 'documento_reemplazado')
      = 'Carta de la empresa reemplazada',
    'label carta fem'
  );
  PERFORM public.__p194_assert(
    public.mesa_asesor_cambio_doc_kind_label('cliente_ine_frente', 'documento_reemplazado')
      = 'INE frente reemplazada',
    'label ine frente fem'
  );
  PERFORM public.__p194_assert(
    public.mesa_asesor_cambio_doc_kind_label('cliente_ine_reverso', 'documento_reemplazado')
      = 'INE reverso reemplazada',
    'label ine reverso fem'
  );

  RAISE NOTICE 'P194 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_envio TIMESTAMPTZ := timestamptz '2026-07-01 10:00:00+00';
  v_submit TIMESTAMPTZ := timestamptz '2026-07-20 18:00:00+00';
  v_exp UUID;
  v_lote UUID;
  v_doc_old UUID;
  v_doc_new UUID;
  v_summary JSONB;
  v_item JSONB;
  v_detail JSONB;
  v_page JSONB;
  v_parent INT;
  v_req INT;
  v_otras INT;
  v_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  -- Fixtures como postgres (mismo patrón P193). JWT Mesa solo para RPCs.
  -- 1 field → preview 1
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401001',
    'P194 preview 1', '5519240101', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:plazo', 'campo_actualizado', 'cliente_datos', 'plazo', 'Plazo actualizado');

  -- 3 fields
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401002',
    'P194 preview 3', '5519240102', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES
    (v_lote, 'campo:plazo', 'campo_actualizado', 'cliente_datos', 'plazo', 'Plazo actualizado'),
    (v_lote, 'campo:notaMesa', 'campo_actualizado', 'cliente_datos', 'notaMesa', 'Notas para Mesa actualizadas'),
    (v_lote, 'doc:dom', 'documento_reemplazado', 'documento', NULL, 'Comprobante de domicilio reemplazado');

  UPDATE public.expediente_asesor_cambios
  SET document_kind = 'cliente_comprobante_domicilio'
  WHERE lote_id = v_lote AND change_key = 'doc:dom';

  -- 5 changes
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401003',
    'P194 preview 5', '5519240103', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  SELECT v_lote, 'campo:' || g.i, 'campo_actualizado', 'cliente_datos', 'plazo', 'Plazo actualizado ' || g.i
  FROM generate_series(1, 5) g(i);

  -- doc + RFC sin valores en summary
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401004',
    'P194 doc rfc', '5519240104', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, entidad, campo, label, valor_anterior, valor_nuevo, document_kind
  ) VALUES
    (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC actualizado', '"OLD"', '"NEW"', NULL),
    (v_lote, 'doc:ine', 'documento_reemplazado', 'documento', NULL, 'INE frente reemplazado', NULL, NULL, 'cliente_ine_frente');

  PERFORM public.__p194_set_auth(v_mesa);
  v_summary := public.mesa_list_asesor_cambios_summary(ARRAY[v_ids[4]]);
  v_item := (
    SELECT elem FROM jsonb_array_elements(v_summary->'items') elem
    WHERE (elem->>'expediente_id')::uuid = v_ids[4] LIMIT 1
  );
  PERFORM public.__p194_assert(jsonb_array_length(v_item->'preview_changes') = 2, 'doc+rfc preview 2');
  PERFORM public.__p194_assert(position('valor' in v_item::text) = 0, 'summary sin valor_*');
  PERFORM public.__p194_assert(
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_item->'preview_changes') e
      WHERE e->>'label' = 'INE frente reemplazada'
    ),
    'summary normaliza INE fem'
  );

  v_summary := public.mesa_list_asesor_cambios_summary(ARRAY[v_ids[1]]);
  v_item := (
    SELECT elem FROM jsonb_array_elements(v_summary->'items') elem
    WHERE (elem->>'expediente_id')::uuid = v_ids[1] LIMIT 1
  );
  PERFORM public.__p194_assert(jsonb_array_length(v_item->'preview_changes') = 1, 'preview 1');

  v_summary := public.mesa_list_asesor_cambios_summary(ARRAY[v_ids[2]]);
  v_item := (
    SELECT elem FROM jsonb_array_elements(v_summary->'items') elem
    WHERE (elem->>'expediente_id')::uuid = v_ids[2] LIMIT 1
  );
  PERFORM public.__p194_assert(jsonb_array_length(v_item->'preview_changes') = 3, 'preview 3');

  v_summary := public.mesa_list_asesor_cambios_summary(ARRAY[v_ids[3]]);
  v_item := (
    SELECT elem FROM jsonb_array_elements(v_summary->'items') elem
    WHERE (elem->>'expediente_id')::uuid = v_ids[3] LIMIT 1
  );
  PERFORM public.__p194_assert((v_item->>'changes_count')::int = 5, 'count 5');
  PERFORM public.__p194_assert(jsonb_array_length(v_item->'preview_changes') = 3, 'preview capped 3');

  PERFORM public.__p194_reset_auth();
  -- Natividad-like EXACT
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  v_submit := timestamptz '2026-07-27 23:24:19+00';
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401005',
    'P194 natividad-like', '5519240105', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role, deleted_at
  ) VALUES (
    v_org, v_exp, 'cliente_comprobante_domicilio', 'old/dom.pdf',
    'dom.pdf', 'application/pdf', 10, 1, 'subido', v_asesor, 'asesor', v_submit - interval '6 seconds'
  ) RETURNING id INTO v_doc_old;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_comprobante_domicilio', 'new/dom.pdf',
    'dom2.pdf', 'application/pdf', 11, 2, 'subido', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc_new;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_asesor, 'asesor', 'expediente.documento.register', 'expediente_documento', v_doc_new,
    jsonb_build_object(
      'expediente_id', v_exp,
      'tipo_documento', 'cliente_comprobante_domicilio',
      'version', 2,
      'reemplazo', true
    ),
    v_submit - interval '6 seconds'
  );

  PERFORM public.__p194_set_auth(v_mesa);
  v_summary := public.mesa_list_asesor_cambios_summary(ARRAY[v_exp]);
  v_item := (v_summary->'items'->0);
  PERFORM public.__p194_assert((v_item->>'changes_count')::int = 0, 'natividad count físico 0');
  PERFORM public.__p194_assert(v_item->>'history_confidence' = 'EXACT', 'natividad EXACT');
  PERFORM public.__p194_assert(v_item->>'history_source' = 'HISTORY_RECOVERED', 'natividad source');
  PERFORM public.__p194_assert(
    (v_item->'preview_changes'->0->>'label') = 'Comprobante de domicilio reemplazado',
    'natividad label'
  );

  v_detail := public.mesa_get_asesor_cambio_lote(v_exp);
  PERFORM public.__p194_assert(jsonb_array_length(v_detail->'recovered_changes') = 1, 'detalle recovered 1');
  PERFORM public.__p194_assert(
    (v_detail->'recovered_changes'->0->>'documento_nuevo_id')::uuid = v_doc_new,
    'detalle doc nuevo'
  );
  PERFORM public.__p194_assert(
    (v_detail->'recovered_changes'->0->>'documento_anterior_id')::uuid = v_doc_old,
    'detalle doc anterior'
  );

  PERFORM public.__p194_reset_auth();
  -- false positive: fuera de ventana 90s
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401006',
    'P194 fp window', '5519240106', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_estado_cuenta', 'late/ec.pdf',
    'ec.pdf', 'application/pdf', 10, 1, 'subido', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc_new;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_asesor, 'asesor', 'expediente.documento.register', 'expediente_documento', v_doc_new,
    jsonb_build_object('expediente_id', v_exp, 'tipo_documento', 'cliente_estado_cuenta', 'reemplazo', true),
    v_submit - interval '90 seconds'
  );
  PERFORM public.__p194_assert(
    public.mesa_asesor_cambio_recover_empty_lote(v_exp, v_asesor, v_submit, v_org) IS NULL,
    'fp ventana 90s'
  );

  -- false positive: otro expediente
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401007',
    'P194 fp otro exp', '5519240107', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit);
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_asesor, 'asesor', 'expediente.documento.register', 'expediente_documento', gen_random_uuid(),
    jsonb_build_object('expediente_id', gen_random_uuid(), 'tipo_documento', 'cliente_estado_cuenta', 'reemplazo', true),
    v_submit - interval '5 seconds'
  );
  PERFORM public.__p194_set_auth(v_mesa);
  PERFORM public.__p194_assert(
    (public.mesa_list_asesor_cambios_summary(ARRAY[v_exp])->'items'->0->>'history_confidence') IS NULL,
    'fp otro expediente'
  );

  PERFORM public.__p194_reset_auth();
  -- false positive: reemplazo=false
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401008',
    'P194 fp no reemplazo', '5519240108', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit);
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_asesor, 'asesor', 'expediente.documento.register', 'expediente_documento', gen_random_uuid(),
    jsonb_build_object('expediente_id', v_exp, 'tipo_documento', 'cliente_estado_cuenta', 'reemplazo', false),
    v_submit - interval '5 seconds'
  );
  PERFORM public.__p194_assert(
    public.mesa_asesor_cambio_recover_empty_lote(v_exp, v_asesor, v_submit, v_org) IS NULL,
    'fp reemplazo false'
  );

  -- PARTIAL
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401009',
    'P194 partial', '5519240109', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit);
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_asesor, 'asesor', 'cliente_datos.actualizado_post_mesa', 'cliente_datos', v_exp,
    jsonb_build_object(
      'rfc_anterior', 'AAA', 'rfc_nuevo', 'BBB',
      'telefono_anterior', '8111111111', 'telefono_nuevo', '8111111112'
    ),
    v_submit - interval '3 seconds'
  );
  PERFORM public.__p194_set_auth(v_mesa);
  v_item := (public.mesa_list_asesor_cambios_summary(ARRAY[v_exp])->'items'->0);
  PERFORM public.__p194_assert(v_item->>'history_confidence' = 'PARTIAL', 'partial confidence');
  PERFORM public.__p194_assert(
    (v_item->'preview_changes'->0->>'label') = 'Revisión histórica de Datos Generales',
    'partial label'
  );

  PERFORM public.__p194_reset_auth();
  -- NO_DIFF
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192401010',
    'P194 no diff', '5519240110', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit);
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (
      v_org, v_asesor, 'asesor', 'cliente_datos.save', 'cliente_datos', v_exp,
      jsonb_build_object(
        'rfc_anterior', 'RFC1', 'rfc_nuevo', 'RFC1',
        'telefono_anterior', '8111111111', 'telefono_nuevo', '8111111111',
        'cliente_nombre_anterior', 'N', 'cliente_nombre_nuevo', 'N',
        'estado_anterior', 'completo', 'estado_nuevo', 'completo',
        'referencias_count', 0, 'imagenes_count', 0, 'direccion_opcional', 'X'
      ),
      v_submit - interval '30 minutes'
    ),
    (
      v_org, v_asesor, 'asesor', 'cliente_datos.actualizado_post_mesa', 'cliente_datos', v_exp,
      jsonb_build_object(
        'rfc_anterior', 'RFC1', 'rfc_nuevo', 'RFC1',
        'telefono_anterior', '8111111111', 'telefono_nuevo', '8111111111',
        'cliente_nombre_anterior', 'N', 'cliente_nombre_nuevo', 'N',
        'estado_anterior', 'completo', 'estado_nuevo', 'completo',
        'referencias_count', 0, 'imagenes_count', 0, 'direccion_opcional', 'X'
      ),
      v_submit - interval '2 seconds'
    );
  PERFORM public.__p194_set_auth(v_mesa);
  v_item := (public.mesa_list_asesor_cambios_summary(ARRAY[v_exp])->'items'->0);
  PERFORM public.__p194_assert(v_item->>'history_confidence' = 'NO_DIFF', 'no diff confidence');
  PERFORM public.__p194_assert(jsonb_array_length(coalesce(v_item->'preview_changes', '[]'::jsonb)) = 0, 'no diff sin preview');

  -- P193 counts regression (parent = requested + other)
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_enviada', 'todo_mesa',
    'P194', NULL, NULL, false, NULL, 'rechazados', NULL, true
  );
  v_parent := coalesce((v_page->'counts'->>'correccionesEnviadas')::int, -1);
  v_req := coalesce((v_page->'counts'->>'correccionesSolicitadas')::int, -1);
  v_otras := coalesce((v_page->'counts'->>'otrasActualizaciones')::int, -1);
  PERFORM public.__p194_assert(v_parent = v_req + v_otras, 'P193 counts intactos');

  PERFORM public.__p194_reset_auth();
  RAISE NOTICE 'P194 fixtures OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p194_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p194_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p194_reset_auth();
