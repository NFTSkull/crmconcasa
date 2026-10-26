-- Applied in production: 2026-10-26. No ownership changes.
CREATE OR REPLACE FUNCTION public.asesor_can_operate_expediente_as(p_actor_id uuid,p_expediente_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $body$
DECLARE v_actor public.profiles%ROWTYPE; v_exp public.expedientes%ROWTYPE;
BEGIN
 IF p_actor_id IS NULL OR p_expediente_id IS NULL THEN RETURN false; END IF;
 SELECT * INTO v_actor FROM public.profiles p WHERE p.id=p_actor_id AND p.active=true;
 IF NOT FOUND OR v_actor.app_role<>'asesor' THEN RETURN false; END IF;
 SELECT * INTO v_exp FROM public.expedientes e WHERE e.id=p_expediente_id;
 IF NOT FOUND OR v_exp.deleted_at IS NOT NULL OR
    v_exp.organization_id IS DISTINCT FROM v_actor.organization_id THEN RETURN false; END IF;
 IF v_exp.submitted_to_mesa IS NOT TRUE AND v_exp.ciclo_estado='activo' THEN RETURN true; END IF;
 IF v_exp.asesor_id=p_actor_id THEN RETURN true; END IF;
 RETURN public.profile_has_capability(p_actor_id,'integrate_for_any_advisor')
   AND public.asesor_comparten_equipo_activo(p_actor_id,v_exp.asesor_id);
END $body$;
COMMENT ON FUNCTION public.asesor_can_operate_expediente_as(uuid,uuid)
 IS 'Pre-Mesa activo abierto a asesor activo de misma organización. Post-Mesa preserva titular/delegado P208.';