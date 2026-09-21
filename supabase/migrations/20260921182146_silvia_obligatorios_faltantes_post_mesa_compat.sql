-- ConCasa CRM — compatibilidad post-Mesa para obligatorios actuales faltantes del Equipo Silvia.
--
-- Problema: expedientes históricos enviados antes del rollout pueden quedar con
-- nuevos obligatorios del paquete Silvia en "faltante" (p. ej. INE reverso).
-- El candado post-Mesa normal bloquea primeros uploads de obligatorios.
--
-- Alcance:
-- - solo expedientes activos y ya enviados a Mesa;
-- - dueño del expediente pertenece al Equipo Silvia;
-- - rollout del paquete nuevo Silvia está ON;
-- - el tipo solicitado pertenece al set obligatorio ACTUAL del dueño;
-- - el actor asesor puede operar el expediente y usar ese tipo;
-- - no existe ya un documento activo de ese tipo.
--
-- No cambia etapas, no hace backfill y no toca documentos existentes.

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
  IF v_tipo IS NULL THEN
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
     OR NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_envio_para(v_exp.asesor_id)))
     OR NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload_para(v_actor_id)))
     OR NOT public.asesor_puede_usar_tipo_documento(v_actor_id, v_tipo) THEN
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
  'Compat rollout Silvia: permite primer upload post-Mesa de un obligatorio actual faltante, solo para expediente activo del equipo, actor autorizado y tipo permitido.';
