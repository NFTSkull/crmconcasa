-- ConCasa CRM — restaura Acuse a su etapa canónica 8.
-- Evita que una cita biométrica activa habilite Acuse en etapas 3–7 y salte a etapa 9.
-- El helper es consumido por UI/RPC/Storage; etapa >=8 conserva carga/reemplazo.

CREATE OR REPLACE FUNCTION public.expediente_acuse_habilitado_desde_biometricos(
  p_expediente_id uuid,
  p_etapa_actual smallint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p_expediente_id IS NOT NULL
    AND p_etapa_actual IS NOT NULL
    AND p_etapa_actual >= 8;
$function$;

REVOKE ALL ON FUNCTION public.expediente_acuse_habilitado_desde_biometricos(uuid, smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expediente_acuse_habilitado_desde_biometricos(uuid, smallint)
  TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.expediente_acuse_habilitado_desde_biometricos(uuid, smallint) IS
  'Acuse asesor: disponible únicamente desde etapa 8. No permite saltar etapas 3-7 aunque exista cita biométrica activa.';
