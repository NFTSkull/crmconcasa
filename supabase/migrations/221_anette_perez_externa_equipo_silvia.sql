-- ConCasa CRM — Anette Perez como asesora externa (mismo contrato que Equipo Silvia)
-- Cambio mínimo de configuración: agrega únicamente su membresía activa al Equipo Silvia Reyes.
-- Efecto esperado: asesor_paquete_documental_externos=true y hereda el mismo paquete/documentos externos.
-- Sin cambios a funciones, UI, documentos, expedientes ni datos de clientes.

DO $$
DECLARE
  v_anette_id uuid;
  v_org_id uuid;
  v_team_id uuid;
  v_team_count integer;
BEGIN
  SELECT p.id, p.organization_id
  INTO v_anette_id, v_org_id
  FROM public.profiles p
  WHERE lower(btrim(p.email)) = 'anette.perez@concasa.mx'
    AND p.active = true
    AND p.app_role = 'asesor';

  IF v_anette_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Anette Perez activa/asesor no encontrada';
  END IF;

  SELECT count(*), min(t.id)
  INTO v_team_count, v_team_id
  FROM public.asesor_equipos t
  JOIN public.profiles lider
    ON lider.id = t.leader_id
   AND lider.active = true
   AND lider.app_role = 'asesor'
  WHERE t.active = true
    AND t.organization_id = v_org_id
    AND lower(btrim(lider.email)) = 'silvia.reyes@concasa.mx';

  IF v_team_count <> 1 OR v_team_id IS NULL THEN
    RAISE EXCEPTION 'Se esperaba exactamente 1 Equipo Silvia Reyes activo; encontrados=%', v_team_count;
  END IF;

  INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active)
  VALUES (v_team_id, v_anette_id, true)
  ON CONFLICT (team_id, asesor_id)
  DO UPDATE SET active = EXCLUDED.active;
END;
$$;
