
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
        'mario.morales@concasa.mx'
      )
      AND p.tipo_asesor_origen = 'externo'
  );
$$;

COMMENT ON FUNCTION public.asesor_es_anette_externa(uuid) IS
  'Compatibilidad de paquete externo independiente: Anette Perez y Mario Morales, activos/origen externo.';

DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_old text := $old$v_actor_email = 'anette.perez@concasa.mx'$old$;
  v_new text := $new$v_actor_email IN ('anette.perez@concasa.mx', 'mario.morales@concasa.mx')$new$;
  v_count integer;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'asesor_puede_usar_tipo_documento'
    AND pg_get_function_identity_arguments(p.oid) = 'p_actor_id uuid, p_tipo_documento text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'asesor_puede_usar_tipo_documento no encontrada';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'marker Anette count %, esperado 1', v_count;
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.mesa_asesor_es_grupo_externo(
  p_asesor_id UUID
)
RETURNS BOOLEAN
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
          'mario.morales@concasa.mx'
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

COMMENT ON FUNCTION public.mesa_asesor_es_grupo_externo(UUID) IS
  'Clasificación operativa Mesa: Orlando + Silvia/equipo + Anette + Mario Morales independiente.';
