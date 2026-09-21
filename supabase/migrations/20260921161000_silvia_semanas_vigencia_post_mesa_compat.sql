-- ConCasa CRM — compatibilidad post-Mesa para slot nuevo Equipo Silvia.
--
-- Problema: expedientes históricos enviados antes del rollout pueden quedar con el
-- nuevo obligatorio `cliente_semanas_o_vigencia_derechos` en "faltante".
-- El candado post-Mesa normal bloquea primeros uploads de obligatorios.
--
-- Alcance quirúrgico:
-- - solo el tipo combinado Semanas|Vigencia;
-- - solo expedientes activos, ya enviados a Mesa, cuyo dueño pertenece a Equipo Silvia;
-- - solo mientras el rollout nuevo de Silvia está ON;
-- - solo si todavía NO existe un documento activo de ese tipo;
-- - actor asesor autorizado por `asesor_can_operate_expediente_as`.
--
-- No abre INE/domicilio/estado de cuenta/acta faltantes, no cambia etapas,
-- no hace backfill y no toca documentos existentes.

CREATE OR REPLACE FUNCTION public.asesor_silvia_combined_post_mesa_missing_allowed(
  p_expediente_id uuid,
  p_tipo_documento text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor record;
  v_exp record;
  v_tipo text;
BEGIN
  v_tipo := nullif(btrim(coalesce(p_tipo_documento, '')), '');
  IF v_tipo IS DISTINCT FROM 'cliente_semanas_o_vigencia_derechos' THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF NOT FOUND
     OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor' THEN
    RETURN false;
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

  IF NOT FOUND
     OR v_exp.deleted_at IS NOT NULL
     OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id)
     OR NOT public.asesor_es_equipo_silvia(v_exp.asesor_id)
     OR NOT public.asesor_equipo_silvia_paquete_nuevo_habilitado()
     OR NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload_para(v_actor_id))) THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = v_exp.id
      AND d.tipo_documento = v_tipo
      AND d.deleted_at IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_silvia_combined_post_mesa_missing_allowed(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_silvia_combined_post_mesa_missing_allowed(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.asesor_silvia_combined_post_mesa_missing_allowed(uuid, text) IS
  'Compat rollout Silvia: permite solo primer upload post-Mesa del slot cliente_semanas_o_vigencia_derechos faltante; conserva cerrados otros obligatorios.';


-- Storage: conserva toda la lógica vigente y suma únicamente la excepción
-- anterior. Esta función alimenta las policies INSERT y DELETE del bucket.
CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
     OR v_parsed.tipo_documento IS NULL THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();

  IF NOT (
    v_parsed.tipo_documento =
      ANY(public.integration_doc_tipos_asesor_upload_para(v_actor_id))
  ) THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL
     OR NOT FOUND
     OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR v_actor.organization_id IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
  END IF;

  IF NOT public.asesor_puede_usar_tipo_documento(
    v_actor_id,
    v_parsed.tipo_documento
  ) THEN
    RETURN false;
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND
     OR v_exp.deleted_at IS NOT NULL
     OR NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id)
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = v_exp.id
      AND d.tipo_documento = v_parsed.tipo_documento
      AND d.deleted_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  IF v_parsed.tipo_documento =
     ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
    RETURN true;
  END IF;

  IF public.asesor_silvia_combined_post_mesa_missing_allowed(
    v_exp.id,
    v_parsed.tipo_documento
  ) THEN
    RETURN true;
  END IF;

  RETURN public.es_reingreso_asesor_edicion_activa(v_exp.id);
END;
$$;

REVOKE ALL ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(text)
  TO authenticated;


-- RPC dedicado: evita relajar register_expediente_documento para cualquier
-- obligatorio faltante y mantiene la compatibilidad aislada al slot combinado.
CREATE OR REPLACE FUNCTION public.register_expediente_documento_silvia_combined_post_mesa(
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
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor record;
  v_exp record;
  v_tipo text;
  v_new_version integer;
  v_new_id uuid;
BEGIN
  v_tipo := nullif(btrim(coalesce(p_tipo_documento, '')), '');
  v_actor_id := public.current_profile_id();

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_silvia_combined_post_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF NOT FOUND
     OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento_silvia_combined_post_mesa: actor no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_exp.deleted_at IS NOT NULL
     OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id) THEN
    RAISE EXCEPTION 'register_expediente_documento_silvia_combined_post_mesa: expediente no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.asesor_silvia_combined_post_mesa_missing_allowed(
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_silvia_combined_post_mesa: compatibilidad no aplicable'
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = ''
     OR p_nombre_original IS NULL OR btrim(p_nombre_original) = ''
     OR p_size_bytes IS NULL OR p_size_bytes <= 0
     OR p_size_bytes > public.expediente_documento_max_size_bytes()
     OR NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo)
     OR NOT public.expediente_documento_storage_path_valid(
       btrim(p_storage_path),
       v_exp.organization_id,
       p_expediente_id,
       v_tipo
     ) THEN
    RAISE EXCEPTION 'register_expediente_documento_silvia_combined_post_mesa: metadata o path inválido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_silvia_combined_post_mesa: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  -- Revalidar bajo el lock del expediente: este RPC es solo primer alta.
  IF EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND d.tipo_documento = v_tipo
      AND d.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_silvia_combined_post_mesa: el documento ya existe'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(d.version), 0) + 1
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
    'subido',
    v_actor_id,
    'asesor'
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
      'estatus_revision', 'subido',
      'reemplazo', false,
      'compat_silvia_combined_post_mesa', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', 'subido',
    'storage_path', btrim(p_storage_path),
    'integration_docs_presentes',
      public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos',
      public.integration_docs_completos(p_expediente_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_expediente_documento_silvia_combined_post_mesa(
  uuid, text, text, text, text, bigint
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_expediente_documento_silvia_combined_post_mesa(
  uuid, text, text, text, text, bigint
) TO authenticated;

COMMENT ON FUNCTION public.register_expediente_documento_silvia_combined_post_mesa(
  uuid, text, text, text, text, bigint
) IS
  'Primer alta post-Mesa del slot Semanas|Vigencia para Equipo Silvia rollout ON; no abre otros obligatorios ni reemplazos.';
