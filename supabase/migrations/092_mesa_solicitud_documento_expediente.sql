-- ConCasa CRM — P096: Solicitud documento (cliente_solicitud) para Mesa
-- Allowlist Mesa + MIME PDF/JPEG/PNG + gate etapa_actual >= 7 en register_mesa_documento.
-- Conserva cliente_pagare (P090) y cliente_notificacion (P092) intactos.
-- No es gate de avance. No obligatorio. Sin herencia reingreso.
-- Distinto de agenda_bookings.kind = 'notificacion' (P070 — intacto). Nunca tipo corto 'solicitud'.

-- =============================================================================
-- A) Allowlist Mesa: agregar cliente_solicitud (conservar pagaré + notificación)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.integration_doc_tipos_mesa_upload()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_semanas_cotizadas',
    'cliente_acta_nacimiento',
    'cliente_constancia_sat',
    'cliente_pagare',
    'cliente_notificacion',
    'cliente_solicitud'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_mesa_upload() IS
  'P030/P090/P092/P096: tipos Mesa (semanas, acta, SAT, pagaré, notificación doc, solicitud doc). Opcionales; no gate. Distinto de agenda kind=notificacion.';

REVOKE ALL ON FUNCTION public.integration_doc_tipos_mesa_upload() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_mesa_upload() TO authenticated, service_role, postgres;

-- =============================================================================
-- B) MIME: PDF/JPEG/PNG para cliente_pagare, cliente_notificacion y cliente_solicitud
-- =============================================================================
CREATE OR REPLACE FUNCTION public.expediente_documento_mime_permitido(
  p_mime_type TEXT,
  p_tipo_documento TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_mime TEXT;
  v_tipo TEXT;
BEGIN
  v_mime := lower(btrim(COALESCE(p_mime_type, '')));
  v_tipo := NULLIF(lower(btrim(COALESCE(p_tipo_documento, ''))), '');

  IF v_mime = 'application/pdf' THEN
    RETURN TRUE;
  END IF;

  -- Pagaré + Notificación doc + Solicitud doc: PDF (arriba) + JPEG/PNG
  IF v_tipo IN ('cliente_pagare', 'cliente_notificacion', 'cliente_solicitud')
     AND v_mime IN ('image/jpeg', 'image/png') THEN
    RETURN TRUE;
  END IF;

  -- Tipos asesor que ya aceptaban imagen (INE, carta, acta digital)
  IF v_tipo IN (
       'cliente_ine_frente',
       'cliente_ine_reverso',
       'cliente_carta_empresa',
       'cliente_acta_nacimiento_digital'
     )
     AND v_mime IN (
       'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
     ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT) IS
  'MIME por tipo. PDF global. Pagaré/Notificación/Solicitud doc: PDF/JPEG/PNG. INE/carta/acta digital: PDF+imágenes. Acta/SAT/semanas Mesa: solo PDF.';

REVOKE ALL ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- C) register_mesa_documento: gate Pagaré + Notificación + Solicitud etapa >= 7
-- =============================================================================
CREATE OR REPLACE FUNCTION public.register_mesa_documento(
  p_expediente_id UUID,
  p_tipo_documento TEXT,
  p_storage_path TEXT,
  p_nombre_original TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_mesa_documento: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_mesa_documento: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'register_mesa_documento: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_mesa_documento: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_mesa_documento: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_mesa_upload())) THEN
    RAISE EXCEPTION 'register_mesa_documento: tipo_documento no permitido para Mesa (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_mesa_documento: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_mesa_documento: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_mesa_documento: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_mesa_documento: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_mesa_documento: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  -- Orden de bloqueo estable: expediente → documento vigente del tipo
  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at,
    e.etapa_actual
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE OF e;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_mesa_documento: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_mesa_documento: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_mesa_documento: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'register_mesa_documento: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_mesa_documento: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa <> true THEN
    RAISE EXCEPTION 'register_mesa_documento: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  -- P090: Pagaré solo desde etapa 7. No aplica a complementarios.
  IF v_tipo = 'cliente_pagare' AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_mesa_documento: El Pagaré solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  -- P092: documento Notificación (cliente_notificacion) solo desde etapa 7.
  -- No confundir con agenda_bookings.kind = 'notificacion'.
  IF v_tipo = 'cliente_notificacion' AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_mesa_documento: El documento Notificación solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  -- P096: documento Solicitud (cliente_solicitud) solo desde etapa 7.
  -- Nunca usar tipo corto 'solicitud'.
  IF v_tipo = 'cliente_solicitud' AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_mesa_documento: El documento Solicitud solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_mesa_documento: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_mesa_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    uploaded_by,
    uploaded_by_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_tipo,
    btrim(p_storage_path),
    btrim(p_nombre_original),
    lower(btrim(p_mime_type)),
    p_size_bytes,
    v_new_version,
    v_new_estatus,
    v_actor_id,
    v_actor_role::TEXT
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.mesa_register',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', lower(btrim(p_mime_type)),
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path)
  );
END;
$$;

COMMENT ON FUNCTION public.register_mesa_documento(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) IS
  'P030/P090/P092/P096: Mesa registra complementarios, Pagaré, Notificación doc y Solicitud doc (etapa>=7, PDF/JPEG/PNG). Soft-delete versionado. No gate de avance.';

REVOKE ALL ON FUNCTION public.register_mesa_documento(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_mesa_documento(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_mesa_documento(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT)
  TO authenticated, service_role, postgres;
