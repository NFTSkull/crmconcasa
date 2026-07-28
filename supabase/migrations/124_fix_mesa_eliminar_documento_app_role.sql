-- ConCasa CRM — Fix P136: mesa_eliminar_documento_expediente
-- Causa: v_actor_role TEXT no castea a log_action(p_actor_role app_role) → fallo en runtime
-- tras soft-delete (TX rollback). Alinear a public.app_role como register_mesa_documento.
-- Sin tocar etapas/citas/montos/ingresos.

CREATE OR REPLACE FUNCTION public.mesa_eliminar_documento_expediente(
  p_expediente_id UUID,
  p_tipo_documento TEXT
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
  v_tipo TEXT;
  v_exp public.expedientes%ROWTYPE;
  v_doc_id UUID;
  v_version INT;
  v_storage_path TEXT;
  v_nombre TEXT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.mesa_tipos_documento_operativos_mutables())) THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: tipo_documento no permitido (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: expediente no disponible'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.version, d.storage_path, d.nombre_original
  INTO v_doc_id, v_version, v_storage_path, v_nombre
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_absent', true,
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo
    );
  END IF;

  UPDATE public.expediente_documentos
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE id = v_doc_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_eliminar_documento: conflicto concurrente'
      USING ERRCODE = '40001';
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.mesa_eliminar',
    'expediente_documento',
    v_doc_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version_eliminada', v_version,
      'documento_id', v_doc_id,
      'nombre_original', v_nombre,
      'storage_path', v_storage_path
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_absent', false,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'documento_id', v_doc_id,
    'version_eliminada', v_version,
    'storage_path', v_storage_path
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_eliminar_documento_expediente(UUID, TEXT) IS
  'P136/fix: soft-delete activo pagaré/notificación/apodaca. actor_role app_role para log_action. Idempotente.';

REVOKE ALL ON FUNCTION public.mesa_eliminar_documento_expediente(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_eliminar_documento_expediente(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_eliminar_documento_expediente(UUID, TEXT)
  TO authenticated, service_role, postgres;
