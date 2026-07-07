-- Storage RLS: asesor puede subir/reemplazar documentos post-Mesa (espejo RPC 057/059).
-- Sin tocar otras policies; solo añade helper y OR en INSERT/DELETE existentes.

CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(
  p_object_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
BEGIN
  SELECT *
  INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RETURN false;
  END IF;

  IF v_actor_org IS DISTINCT FROM v_parsed.organization_id THEN
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
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RETURN false;
  END IF;

  IF v_exp.ciclo_estado <> 'activo' OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = v_parsed.expediente_id
      AND d.tipo_documento = v_parsed.tipo_documento
      AND d.deleted_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  IF v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(TEXT) IS
  'Storage INSERT/DELETE — asesor post-Mesa: reemplazo si existe doc; primer upload opcional faltante.';

REVOKE ALL ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(TEXT) TO authenticated;

DROP POLICY IF EXISTS expediente_documentos_storage_insert ON storage.objects;
CREATE POLICY expediente_documentos_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'expediente-documentos'
    AND (
      public.expediente_documento_storage_asesor_upload_allowed(name)
      OR public.expediente_documento_storage_mesa_upload_allowed(name)
      OR public.expediente_documento_storage_asesor_correccion_allowed(name)
      OR public.expediente_documento_storage_asesor_retencion_upload_allowed(name)
      OR public.expediente_documento_storage_asesor_post_mesa_upload_allowed(name)
    )
  );

DROP POLICY IF EXISTS expediente_documentos_storage_delete ON storage.objects;
CREATE POLICY expediente_documentos_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expediente-documentos'
    AND (
      public.expediente_documento_storage_asesor_upload_allowed(name)
      OR public.expediente_documento_storage_mesa_upload_allowed(name)
      OR public.expediente_documento_storage_asesor_correccion_allowed(name)
      OR public.expediente_documento_storage_asesor_retencion_upload_allowed(name)
      OR public.expediente_documento_storage_asesor_post_mesa_upload_allowed(name)
    )
  );
