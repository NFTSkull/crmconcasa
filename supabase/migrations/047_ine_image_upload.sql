-- ConCasa CRM — INE frente/reverso aceptan imagen en upload asesor
-- P047: MIME por tipo en expediente_documento_mime_permitido + bucket Storage

DROP FUNCTION IF EXISTS public.expediente_documento_mime_permitido(TEXT);

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

  IF v_tipo IN ('cliente_ine_frente', 'cliente_ine_reverso')
     AND v_mime IN (
       'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
     ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT) IS
  'PDF para todos; imágenes solo en cliente_ine_frente y cliente_ine_reverso.';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]::TEXT[]
WHERE id = 'expediente-documentos';

CREATE OR REPLACE FUNCTION public.register_expediente_documento(
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
    RAISE EXCEPTION 'register_expediente_documento: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento no permitido para upload asesor (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'register_expediente_documento: solo el asesor dueño puede registrar documentos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    RAISE EXCEPTION 'register_expediente_documento: el expediente ya fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: objeto no encontrado en storage'
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
    'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.register',
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
    'storage_path', btrim(p_storage_path),
    'integration_docs_presentes', public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos', public.integration_docs_completos(p_expediente_id)
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.register_expediente_documento_correccion(
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
  v_new_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: tipo_documento no permitido (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: solo el asesor dueño puede corregir documentos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_prev_estatus IS DISTINCT FROM 'rechazado' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: solo se puede corregir un documento rechazado por Mesa'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.expediente_documentos
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE id = v_prev_id;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

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
    comentario_mesa,
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
    'resubido',
    NULL,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.asesor_correccion',
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
      'estatus_revision', 'resubido',
      'documento_rechazado_id', v_prev_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', 'resubido',
    'storage_path', btrim(p_storage_path)
  );
END;
$$;


