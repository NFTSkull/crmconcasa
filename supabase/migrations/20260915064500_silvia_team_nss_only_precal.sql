-- ConCasa CRM — Equipo Silvia: precalificación NSS-only como Anette.
--
-- Objetivo:
--   - Silvia Reyes + miembros activos de su equipo pueden iniciar/reiniciar
--     precalificación capturando únicamente NSS, igual que Anette.
--   - El backend valida el alcance; no se habilita para Orlando ni otros externos.
--   - Se habilita autofill_nombre_infonavit para Silvia + equipo activo, de modo
--     que el nombre del scraper llegue al Editor/Datos Generales.
--   - Si el nombre sigue en POR CAPTURAR, el Editor puede capturarlo manualmente
--     mediante editor_fill_nombre_infonavit (mismo contrato existente).
--   - Sin UPDATE/DELETE de expedientes, documentos, citas o cupos.

CREATE OR REPLACE FUNCTION public.asesor_precal_nss_only_habilitado()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := public.current_profile_id();
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_actor_id
      AND p.active = true
      AND p.app_role = 'asesor'
      AND p.tipo_asesor_origen = 'externo'
  ) THEN
    RETURN false;
  END IF;

  RETURN public.asesor_es_anette_externa(v_actor_id)
    OR public.asesor_es_equipo_silvia(v_actor_id);
END;
$$;

COMMENT ON FUNCTION public.asesor_precal_nss_only_habilitado() IS
  'True solo para Anette o Silvia/equipo activo, siempre que el asesor sea externo activo.';

REVOKE ALL ON FUNCTION public.asesor_precal_nss_only_habilitado()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_precal_nss_only_habilitado()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asesor_preparar_precalificacion_nss_only(
  p_nss text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.asesor_precal_nss_only_habilitado() THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only: flujo no habilitado para este asesor'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.asesor_preparar_precalificacion_externo_nss(
    p_nss,
    p_idempotency_key
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_preparar_precalificacion_nss_only(text, text) IS
  'Wrapper NSS-only con alcance estricto Anette + Equipo Silvia; reutiliza el contrato externo existente.';

REVOKE ALL ON FUNCTION public.asesor_preparar_precalificacion_nss_only(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_preparar_precalificacion_nss_only(text, text)
  TO authenticated, service_role;

-- Habilitar autofill de nombre para Silvia y miembros activos actuales/futuros
-- sin hardcodear UUIDs. ON CONFLICT preserva idempotencia y reactiva si existía OFF.
INSERT INTO public.profile_capabilities (profile_id, capability, active)
SELECT p.id, 'autofill_nombre_infonavit', true
FROM public.profiles p
WHERE p.active = true
  AND p.app_role = 'asesor'
  AND public.asesor_es_equipo_silvia(p.id)
ON CONFLICT (profile_id, capability)
DO UPDATE SET active = EXCLUDED.active;
