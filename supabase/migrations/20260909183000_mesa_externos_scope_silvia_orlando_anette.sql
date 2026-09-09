-- ConCasa CRM — alcance estricto de externos para Mesa interno con ver_externos_mesa.
--
-- Objetivo:
-- - Sara/Kass (hoy los únicos usuarios con capability ver_externos_mesa) ven SOLO
--   expedientes EXTERNOS ya enviados a Mesa pertenecientes a:
--   1) Silvia Reyes,
--   2) miembros activos del equipo activo liderado por Silvia Reyes,
--   3) Orlando Solis,
--   4) Anette Perez.
-- - No habilita internos.
-- - No habilita otros asesores externos.
-- - No modifica expedientes, membresías, capabilities ni datos existentes.
--
-- El resto de roles y reglas de can_see_expediente permanecen intactos.

CREATE OR REPLACE FUNCTION public.can_see_expediente(p_expediente_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_role = 'super_admin' THEN
    RETURN true;
  END IF;

  SELECT e.organization_id, e.asesor_id, e.submitted_to_mesa, e.origen_mesa, e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RETURN false;
  END IF;

  CASE v_role
    WHEN 'asesor' THEN
      RETURN v_exp.asesor_id = auth.uid()
        OR (
          public.profile_has_capability(auth.uid(), 'integrate_for_any_advisor')
          AND public.asesor_comparten_equipo_activo(auth.uid(), v_exp.asesor_id)
        );
    WHEN 'editor' THEN
      RETURN true;
    WHEN 'mesa_admin' THEN
      RETURN v_exp.submitted_to_mesa = true;
    WHEN 'mesa_interno' THEN
      -- Capability especial: fail-closed a externos enviados del scope autorizado.
      IF public.profile_has_capability(auth.uid(), 'ver_externos_mesa') THEN
        IF v_exp.submitted_to_mesa IS DISTINCT FROM true
           OR v_exp.origen_mesa IS DISTINCT FROM 'externo' THEN
          RETURN false;
        END IF;

        RETURN EXISTS (
          SELECT 1
          FROM public.profiles owner
          WHERE owner.id = v_exp.asesor_id
            AND owner.active = true
            AND owner.app_role = 'asesor'
            AND owner.organization_id = v_exp.organization_id
            AND (
              lower(btrim(owner.email)) IN (
                'silvia.reyes@concasa.mx',
                'orlando.solis@concasa.mx',
                'anette.perez@concasa.mx'
              )
              OR EXISTS (
                SELECT 1
                FROM public.asesor_equipo_miembros m
                INNER JOIN public.asesor_equipos t
                  ON t.id = m.team_id
                 AND t.active = true
                INNER JOIN public.profiles lider
                  ON lider.id = t.leader_id
                 AND lider.active = true
                 AND lider.app_role = 'asesor'
                WHERE m.asesor_id = owner.id
                  AND m.active = true
                  AND t.organization_id = v_exp.organization_id
                  AND lower(btrim(lider.email)) = 'silvia.reyes@concasa.mx'
              )
            )
        );
      END IF;

      RETURN v_exp.submitted_to_mesa = true
        AND v_exp.origen_mesa = 'interno';
    WHEN 'mesa_externo' THEN
      RETURN v_exp.submitted_to_mesa = true AND v_exp.origen_mesa = 'externo';
    ELSE
      RETURN false;
  END CASE;
END;
$function$;
