-- ConCasa CRM — Membresía genérica a equipo por email de líder
-- Reusa asesor_equipos + asesor_pertenece_equipo_activo (mismo espíritu que
-- documento_tipo_scope_equipo / asesor_puede_usar_tipo_documento).
-- Fail-closed: 0 o >1 equipos activos con ese líder en la org → false + WARNING.
-- p_asesor_id NULL → current_profile_id() (actor JWT).
-- No hardcodea Silvia; el FE pasa el leader_email.

CREATE OR REPLACE FUNCTION public.asesor_en_equipo_por_lider_email(
  p_leader_email text,
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
  v_leader_email TEXT;
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_team_ids UUID[];
  v_n INTEGER;
  v_team_id UUID;
BEGIN
  v_leader_email := lower(btrim(COALESCE(p_leader_email, '')));
  IF v_leader_email = '' OR v_leader_email !~ '^[^@]+@[^@]+$' THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_target_id := COALESCE(p_asesor_id, v_actor_id);

  SELECT *
  INTO v_target
  FROM public.profiles p
  WHERE p.id = v_target_id
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_actor.organization_id IS DISTINCT FROM v_target.organization_id THEN
    RETURN false;
  END IF;

  -- Lectura booleana same-org: actor asesor / mesa_* / editor / super_admin.
  IF v_actor.app_role NOT IN (
    'asesor',
    'mesa_interno',
    'mesa_externo',
    'mesa_admin',
    'editor',
    'super_admin'
  ) THEN
    RETURN false;
  END IF;

  SELECT coalesce(array_agg(t.id ORDER BY t.id), ARRAY[]::uuid[])
  INTO v_team_ids
  FROM public.asesor_equipos t
  INNER JOIN public.profiles lider
    ON lider.id = t.leader_id
   AND lider.active = true
   AND lider.app_role = 'asesor'
  WHERE t.active = true
    AND t.organization_id = v_target.organization_id
    AND lower(btrim(lider.email)) = v_leader_email;

  v_n := coalesce(cardinality(v_team_ids), 0);
  IF v_n <> 1 THEN
    RAISE WARNING 'asesor_en_equipo_por_lider_email: fail-closed leader_email=% team_count=% target=% org=% actor=%',
      v_leader_email, v_n, v_target_id, v_target.organization_id, v_actor_id;
    RETURN false;
  END IF;

  v_team_id := v_team_ids[1];
  RETURN public.asesor_pertenece_equipo_activo(v_team_id, v_target_id);
END;
$$;

COMMENT ON FUNCTION public.asesor_en_equipo_por_lider_email(text, uuid) IS
  'UI/gates: true si el asesor (p_asesor_id o JWT) pertenece al único equipo activo cuyo líder tiene p_leader_email. Fail-closed 0/>1 equipos o auth/org inválidos.';

REVOKE ALL ON FUNCTION public.asesor_en_equipo_por_lider_email(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_en_equipo_por_lider_email(text, uuid) TO authenticated;
