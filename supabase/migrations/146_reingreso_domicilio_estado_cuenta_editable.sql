-- ConCasa CRM — Hotfix: reingreso puede subir/reemplazar domicilio y estado de cuenta
-- Tipos: cliente_comprobante_domicilio, cliente_estado_cuenta
-- Cubre: P072 (etapa 6) + reingreso manual (mismo expediente, count > 0).
-- No toca Acuse/Pagaré/agenda/padre/etapa automática.

CREATE OR REPLACE FUNCTION public.es_reingreso_manual_docs_editables(
  p_expediente_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.id = p_expediente_id
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa IS TRUE
      AND COALESCE(e.reingreso_manual_count, 0) > 0
  );
$$;

COMMENT ON FUNCTION public.es_reingreso_manual_docs_editables(uuid) IS
  'True si el expediente tiene reingreso manual activo (mismo id) y puede actualizar domicilio/estado de cuenta.';

REVOKE ALL ON FUNCTION public.es_reingreso_manual_docs_editables(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.es_reingreso_manual_docs_editables(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.es_reingreso_manual_docs_editables(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.es_reingreso_docs_domicilio_estado_cuenta(
  p_expediente_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.es_reingreso_post_biometricos_valido(p_expediente_id)
      OR public.es_reingreso_manual_docs_editables(p_expediente_id);
$$;

COMMENT ON FUNCTION public.es_reingreso_docs_domicilio_estado_cuenta(uuid) IS
  'True si P072 válido (etapa 6) o reingreso manual activo — docs domicilio/estado de cuenta editables.';

REVOKE ALL ON FUNCTION public.es_reingreso_docs_domicilio_estado_cuenta(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.es_reingreso_docs_domicilio_estado_cuenta(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.es_reingreso_docs_domicilio_estado_cuenta(uuid) TO authenticated;

-- Storage: primer upload post-Mesa de domicilio/estado de cuenta en reingreso (P072 o manual).
CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
BEGIN
  SELECT * INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL
     OR NOT (v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR v_actor.organization_id IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL
     OR v_exp.asesor_id IS DISTINCT FROM v_actor_id
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.expediente_documentos d
    WHERE d.expediente_id = v_exp.id
      AND d.tipo_documento = v_parsed.tipo_documento
      AND d.deleted_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  IF v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
    RETURN true;
  END IF;

  RETURN (
    v_parsed.tipo_documento IN (
      'cliente_comprobante_domicilio', 'cliente_estado_cuenta'
    )
    AND public.es_reingreso_docs_domicilio_estado_cuenta(v_exp.id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(text)
  TO authenticated;

-- Wrapper: ruta reingreso para domicilio/estado de cuenta (primer upload o reemplazo).
CREATE OR REPLACE FUNCTION public.register_expediente_documento(
  p_expediente_id uuid,
  p_tipo_documento text,
  p_storage_path text,
  p_nombre_original text,
  p_mime_type text,
  p_size_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');

  IF NOT (
    v_tipo IN ('cliente_comprobante_domicilio', 'cliente_estado_cuenta')
    AND public.es_reingreso_docs_domicilio_estado_cuenta(p_expediente_id)
  ) THEN
    RETURN public.register_expediente_documento_pre_reingreso(
      p_expediente_id, p_tipo_documento, p_storage_path,
      p_nombre_original, p_mime_type, p_size_bytes
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF v_actor_id IS NULL OR NOT FOUND
     OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR v_exp.asesor_id IS DISTINCT FROM v_actor_id
     OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id
     OR v_exp.deleted_at IS NOT NULL
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: solo el asesor dueño puede cargar documentos'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.es_reingreso_docs_domicilio_estado_cuenta(p_expediente_id) THEN
    RAISE EXCEPTION 'register_expediente_documento: reingreso no válido para este documento'
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = ''
     OR p_nombre_original IS NULL OR btrim(p_nombre_original) = ''
     OR p_size_bytes IS NULL OR p_size_bytes <= 0
     OR p_size_bytes > public.expediente_documento_max_size_bytes()
     OR NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo)
     OR NOT public.expediente_documento_storage_path_valid(
       btrim(p_storage_path), v_exp.organization_id, p_expediente_id, v_tipo
     ) THEN
    RAISE EXCEPTION 'register_expediente_documento: metadata o path inválido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
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
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_exp.organization_id, p_expediente_id, v_tipo, btrim(p_storage_path),
    btrim(p_nombre_original), lower(btrim(p_mime_type)), p_size_bytes, v_new_version,
    v_new_estatus, v_actor_id, 'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
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
      'reemplazo', v_prev_id IS NOT NULL,
      'reingreso_docs_update', true
    )
  );

  IF v_prev_id IS NOT NULL THEN
    PERFORM public.asesor_cambio_record_doc_reemplazo(
      v_exp.organization_id,
      p_expediente_id,
      v_actor_id,
      v_tipo,
      v_prev_id,
      v_new_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'reemplazo', v_prev_id IS NOT NULL,
    'integration_docs_presentes', public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos', public.integration_docs_completos(p_expediente_id)
  );
END;
$function$;

COMMENT ON FUNCTION public.register_expediente_documento(uuid, text, text, text, text, bigint) IS
  'Registro documentos asesor. Reingreso (P072/manual): domicilio y estado de cuenta con upload/reemplazo; resto vía pre_reingreso.';

REVOKE ALL ON FUNCTION public.register_expediente_documento(uuid, text, text, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_expediente_documento(uuid, text, text, text, text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_expediente_documento(uuid, text, text, text, text, bigint) TO authenticated;
