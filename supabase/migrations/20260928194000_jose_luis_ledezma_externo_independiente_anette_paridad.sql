
CREATE OR REPLACE FUNCTION public.asesor_es_anette_externa(p_asesor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_asesor_id
      AND p.active = true
      AND p.app_role = 'asesor'
      AND lower(btrim(p.email)) IN (
        'anette.perez@concasa.mx',
        'mario.morales@concasa.mx',
        'jose.luis.ledezma@concasa.mx'
      )
      AND p.tipo_asesor_origen = 'externo'
  );
$$;

COMMENT ON FUNCTION public.asesor_es_anette_externa(uuid) IS
  'Compatibilidad de paquete externo independiente: Anette Perez, Mario Morales y Jose Luis Ledezma, activos/origen externo.';

CREATE OR REPLACE FUNCTION public.asesor_puede_usar_tipo_documento(
  p_actor_id uuid,
  p_tipo_documento text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo text;
  v_leader_emails text[];
  v_leader_email text;
  v_actor_org uuid;
  v_actor_email text;
  v_actor_origen text;
  v_team_ids uuid[];
  v_n integer;
  v_team_id uuid;
BEGIN
  v_tipo := NULLIF(lower(btrim(COALESCE(p_tipo_documento, ''))), '');
  IF p_actor_id IS NULL OR v_tipo IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.organization_id, lower(btrim(p.email)), p.tipo_asesor_origen::text
  INTO v_actor_org, v_actor_email, v_actor_origen
  FROM public.profiles p
  WHERE p.id = p_actor_id
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND OR v_actor_org IS NULL THEN
    RETURN false;
  END IF;

  IF v_actor_email IN (
       'anette.perez@concasa.mx',
       'mario.morales@concasa.mx',
       'jose.luis.ledezma@concasa.mx'
     )
     AND v_actor_origen = 'externo'
     AND v_tipo = ANY(ARRAY[
       'cliente_solicitud_credito',
       'cliente_lista_nominal',
       'cliente_bajo_protesta',
       'cliente_presupuesto'
     ]::text[])
  THEN
    RETURN true;
  END IF;

  SELECT coalesce(
    array_agg(DISTINCT lower(btrim(s.leader_email)) ORDER BY lower(btrim(s.leader_email))),
    ARRAY[]::text[]
  )
  INTO v_leader_emails
  FROM public.documento_tipo_scope_equipo s
  WHERE lower(btrim(s.tipo_documento)) = v_tipo
    AND s.active = true;

  IF coalesce(cardinality(v_leader_emails), 0) = 0 THEN
    RETURN true;
  END IF;

  FOREACH v_leader_email IN ARRAY v_leader_emails
  LOOP
    SELECT coalesce(array_agg(t.id), ARRAY[]::uuid[])
    INTO v_team_ids
    FROM public.asesor_equipos t
    INNER JOIN public.profiles lider
      ON lider.id = t.leader_id
     AND lider.active = true
     AND lider.app_role = 'asesor'
    WHERE t.active = true
      AND t.organization_id = v_actor_org
      AND lower(btrim(lider.email)) = v_leader_email;

    v_n := coalesce(cardinality(v_team_ids), 0);
    IF v_n = 1 THEN
      v_team_id := v_team_ids[1];
      IF public.asesor_pertenece_equipo_activo(v_team_id, p_actor_id) THEN
        RETURN true;
      END IF;
    ELSIF v_n <> 0 THEN
      RAISE WARNING 'asesor_puede_usar_tipo_documento: fail-closed tipo=% leader_email=% team_count=% actor=% org=%',
        v_tipo, v_leader_email, v_n, p_actor_id, v_actor_org;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.mesa_asesor_es_grupo_externo(
  p_asesor_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles owner
    WHERE owner.id = p_asesor_id
      AND owner.active = true
      AND owner.app_role = 'asesor'
      AND (
        lower(btrim(owner.email)) IN (
          'orlando.solis@concasa.mx',
          'silvia.reyes@concasa.mx',
          'anette.perez@concasa.mx',
          'mario.morales@concasa.mx',
          'jose.luis.ledezma@concasa.mx'
        )
        OR EXISTS (
          SELECT 1
          FROM public.asesor_equipo_miembros m
          INNER JOIN public.asesor_equipos t
            ON t.id = m.team_id
           AND t.active = true
           AND t.organization_id = owner.organization_id
          INNER JOIN public.profiles lider
            ON lider.id = t.leader_id
           AND lider.active = true
           AND lider.app_role = 'asesor'
           AND lider.organization_id = owner.organization_id
          WHERE m.asesor_id = owner.id
            AND m.active = true
            AND lower(btrim(lider.email)) = 'silvia.reyes@concasa.mx'
        )
      )
  );
$$;

COMMENT ON FUNCTION public.mesa_asesor_es_grupo_externo(uuid) IS
  'Clasificación operativa Mesa: Orlando + Silvia/equipo + Anette + Mario Morales + Jose Luis Ledezma independiente.';
