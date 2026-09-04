-- ConCasa CRM — Parte B: wrappers de conveniencia sobre helpers Parte A
-- NO modifica asesor_paquete_documental_externos / integration_doc_tipos_*_para.
-- Checklist documental depende del DUEÑO (p_asesor_id), no solo del actor JWT.
-- Fail-closed: identity/profile inválido → 4 clásicos / false.

CREATE OR REPLACE FUNCTION public.asesor_documentos_obligatorios_envio(
  p_asesor_id uuid DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_target_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN public.integration_doc_tipos_asesor_envio();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_actor_id
      AND p.active = true
  ) THEN
    RETURN public.integration_doc_tipos_asesor_envio();
  END IF;

  v_target_id := COALESCE(p_asesor_id, v_actor_id);
  RETURN public.integration_doc_tipos_asesor_envio_para(v_target_id);
END;
$$;

COMMENT ON FUNCTION public.asesor_documentos_obligatorios_envio(uuid) IS
  'UI: docs obligatorios de envío para p_asesor_id (dueño) o JWT. Delega a integration_doc_tipos_asesor_envio_para. Fail-closed → 4 clásicos.';

REVOKE ALL ON FUNCTION public.asesor_documentos_obligatorios_envio(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_documentos_obligatorios_envio(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_documentos_obligatorios_envio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_documentos_obligatorios_envio(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.asesor_es_paquete_documental_externos(
  p_asesor_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_target_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_actor_id
      AND p.active = true
  ) THEN
    RETURN false;
  END IF;

  v_target_id := COALESCE(p_asesor_id, v_actor_id);
  RETURN public.asesor_paquete_documental_externos(v_target_id);
END;
$$;

COMMENT ON FUNCTION public.asesor_es_paquete_documental_externos(uuid) IS
  'UI: true si p_asesor_id (o JWT) está en paquete documental externos (Parte A SQL). Fail-closed → false.';

REVOKE ALL ON FUNCTION public.asesor_es_paquete_documental_externos(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_es_paquete_documental_externos(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_es_paquete_documental_externos(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_es_paquete_documental_externos(uuid) TO service_role;
