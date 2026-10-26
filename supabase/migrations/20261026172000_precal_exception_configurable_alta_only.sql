-- ConCasa: excepciones de alta precalificadora bajo configuración administrativa.
-- Un alta nueva puede ser permitida sin autorizar un segundo envío a Mesa.
-- La configuración privada está en app_settings, clave precal_excepciones_alta.
CREATE OR REPLACE FUNCTION public.nss_precal_alta_excepcion_activa(
 p_org_id uuid,p_nss text,p_programa public.programa
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $body$
 SELECT EXISTS (
  SELECT 1 FROM public.app_settings s,
   LATERAL jsonb_array_elements(COALESCE(s.value->'rules','[]'::jsonb)) rule
  WHERE s.key='precal_excepciones_alta'
    AND s.value->>'enabled'='true'
    AND rule->>'org'=p_org_id::text
    AND rule->>'nss'=public.normalize_nss_mexico(p_nss)
    AND rule->>'programa'=p_programa::text
    AND rule->>'enabled'='true'
 );
$body$;
REVOKE ALL ON FUNCTION public.nss_precal_alta_excepcion_activa(uuid,text,public.programa) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nss_precal_alta_excepcion_activa(uuid,text,public.programa) TO authenticated;

CREATE OR REPLACE FUNCTION public.nss_bloqueado_en_mesa(
 p_organization_id uuid,p_nss text,p_programa public.programa,
 p_exclude_expediente_id uuid DEFAULT NULL::uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $body$
 SELECT NOT (
  p_exclude_expediente_id IS NULL
  AND public.nss_precal_alta_excepcion_activa(p_organization_id,p_nss,p_programa)
 ) AND EXISTS (
  SELECT 1
  FROM public.expedientes e
  INNER JOIN public.cliente_datos cd ON cd.expediente_id=e.id
  WHERE e.organization_id=p_organization_id
    AND e.nss=public.normalize_nss_mexico(p_nss)
    AND e.programa=p_programa
    AND e.ciclo_estado='activo'
    AND e.deleted_at IS NULL
    AND e.submitted_to_mesa=true
    AND (p_exclude_expediente_id IS NULL OR e.id IS DISTINCT FROM p_exclude_expediente_id)
 );
$body$;
