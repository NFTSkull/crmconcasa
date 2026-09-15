-- Mesa: permitir previsualizar la versión anterior de un documento reemplazado
-- sin reactivarla ni modificar expediente_documentos.

CREATE OR REPLACE FUNCTION public.mesa_get_documento_historico_storage_path(
  p_documento_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_role public.app_role;
  v_actor_org uuid;
  v_doc record;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_get_documento_historico_storage_path: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_get_documento_historico_storage_path: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_documento_id IS NULL THEN
    RAISE EXCEPTION 'mesa_get_documento_historico_storage_path: documento_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    d.id,
    d.organization_id,
    d.expediente_id,
    d.storage_path,
    d.deleted_at
  INTO v_doc
  FROM public.expediente_documentos d
  WHERE d.id = p_documento_id;

  IF NOT FOUND OR NULLIF(btrim(COALESCE(v_doc.storage_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'mesa_get_documento_historico_storage_path: documento no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  -- Esta RPC existe exclusivamente para versiones reemplazadas/soft-deleted.
  IF v_doc.deleted_at IS NULL THEN
    RAISE EXCEPTION 'mesa_get_documento_historico_storage_path: el documento no es histórico'
      USING ERRCODE = '22023';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_doc.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'mesa_get_documento_historico_storage_path: fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(v_doc.expediente_id) THEN
    RAISE EXCEPTION 'mesa_get_documento_historico_storage_path: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_doc.storage_path;
END;
$function$;

REVOKE ALL ON FUNCTION public.mesa_get_documento_historico_storage_path(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_get_documento_historico_storage_path(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_get_documento_historico_storage_path(uuid) TO authenticated;
