-- Applied in production: 2026-10-26. Preserve all non-advisor roles.
CREATE OR REPLACE FUNCTION public.can_see_expediente(p_expediente_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $body$
DECLARE v_role public.app_role; v_org_id uuid; v_exp record;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 SELECT p.app_role,p.organization_id INTO v_role,v_org_id
 FROM public.profiles p WHERE p.id=auth.uid() AND p.active=true;
 IF NOT FOUND THEN RETURN false; END IF;
 IF v_role='super_admin' THEN RETURN true; END IF;
 SELECT e.organization_id,e.asesor_id,e.submitted_to_mesa,e.ciclo_estado,e.origen_mesa,e.deleted_at
 INTO v_exp FROM public.expedientes e WHERE e.id=p_expediente_id;
 IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN RETURN false; END IF;
 IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN RETURN false; END IF;
 CASE v_role
 WHEN 'asesor' THEN
   RETURN (v_exp.submitted_to_mesa IS NOT TRUE AND v_exp.ciclo_estado='activo')
     OR v_exp.asesor_id=auth.uid()
     OR (public.profile_has_capability(auth.uid(),'integrate_for_any_advisor')
         AND public.asesor_comparten_equipo_activo(auth.uid(),v_exp.asesor_id));
 WHEN 'editor' THEN RETURN true;
 WHEN 'mesa_admin' THEN RETURN v_exp.submitted_to_mesa=true;
 WHEN 'mesa_interno' THEN RETURN v_exp.submitted_to_mesa=true;
 WHEN 'mesa_externo' THEN RETURN v_exp.submitted_to_mesa=true;
 ELSE RETURN false;
 END CASE;
END $body$;
COMMENT ON FUNCTION public.can_see_expediente(uuid)
 IS 'Pre-Mesa activo visible a asesores activos de la misma org; post-Mesa reglas previas. Mesa/editor sin cambios.';