-- ConCasa CRM — filtro Internos / Externos para Sara/Kass (Mesa).
-- Read-model/UI authority only. No UPDATE/DELETE/backfill, no agenda/citas/Sheets.
--
-- Regla de negocio "Externos":
--   - Orlando Solís
--   - Silvia Reyes
--   - miembros activos del equipo activo de Silvia Reyes
--   - Anette Perez
-- El resto se clasifica como "Internos" para este filtro.
--
-- Para mesa_admin/super_admin se conserva la semántica histórica por origen_mesa.
-- Para mesa_interno + capability ver_externos_mesa, el filtro usa el grupo de negocio.

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
          'anette.perez@concasa.mx'
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
  'Clasificación operativa Mesa: Orlando + Silvia + equipo activo de Silvia + Anette. Sin depender de origen_mesa.';

REVOKE ALL ON FUNCTION public.mesa_asesor_es_grupo_externo(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_asesor_es_grupo_externo(UUID)
  TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.mesa_puede_filtrar_internos_externos()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role public.app_role;
  v_active BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.active
    INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  IF v_role IN ('mesa_admin', 'super_admin') THEN
    RETURN true;
  END IF;

  RETURN v_role = 'mesa_interno'
    AND public.profile_has_capability(v_uid, 'ver_externos_mesa');
END;
$$;

COMMENT ON FUNCTION public.mesa_puede_filtrar_internos_externos() IS
  'UI Mesa: habilita selector Todos/Internos/Externos a admin o mesa_interno con ver_externos_mesa.';

REVOKE ALL ON FUNCTION public.mesa_puede_filtrar_internos_externos()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_puede_filtrar_internos_externos()
  TO authenticated, service_role;

DO $do$
DECLARE
  v_oid OID;
  v_def TEXT;
  v_old TEXT;
  v_new TEXT;
  v_count INTEGER;
BEGIN
  -- --------------------------------------------------------------------------
  -- 1) Lista paginada: para Sara/Kass, p_origen se interpreta por grupo asesor.
  -- --------------------------------------------------------------------------
  SELECT p.oid
    INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mesa_list_bandeja_page_base'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_limit integer, p_cursor_sort_ts timestamp with time zone, p_cursor_id uuid, p_quick_filter text, p_ops_filter text, p_buscar text, p_etapa integer, p_subestado text, p_solo_citas_hoy boolean, p_today_ymd text, p_rechazos_sub text, p_origen text, p_include_counts boolean';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mesa_filtro_origen: mesa_list_bandeja_page_base no encontrada';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_old := $old$
      AND (
        p_origen IS NULL OR p_origen = '' OR p_origen = 'todos'
        OR (p_origen = 'interno' AND coalesce(e.origen_mesa::text, 'interno') = 'interno')
        OR (p_origen = 'externo' AND e.origen_mesa::text = 'externo')
      )
$old$;

  v_new := $new$
      AND (
        p_origen IS NULL OR p_origen = '' OR p_origen = 'todos'
        OR (
          v_can_externos
          AND p_origen = 'interno'
          AND NOT public.mesa_asesor_es_grupo_externo(e.asesor_id)
        )
        OR (
          v_can_externos
          AND p_origen = 'externo'
          AND public.mesa_asesor_es_grupo_externo(e.asesor_id)
        )
        OR (
          NOT v_can_externos
          AND p_origen = 'interno'
          AND coalesce(e.origen_mesa::text, 'interno') = 'interno'
        )
        OR (
          NOT v_can_externos
          AND p_origen = 'externo'
          AND e.origen_mesa::text = 'externo'
        )
      )
$new$;

  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mesa_filtro_origen: marker list count %, esperado 1', v_count;
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;

  -- --------------------------------------------------------------------------
  -- 2) KPIs/counts: exactamente la misma clasificación que la lista.
  -- --------------------------------------------------------------------------
  SELECT p.oid
    INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mesa_bandeja_counts_fast'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_today_ymd text, p_origen text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mesa_filtro_origen: mesa_bandeja_counts_fast no encontrada';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mesa_filtro_origen: marker counts count %, esperado 1', v_count;
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$do$;

COMMENT ON FUNCTION public.mesa_list_bandeja_page_base(
  integer, timestamptz, uuid, text, text, text, integer, text, boolean, text, text, text, boolean
) IS
  'Mesa read-model: Sara/Kass clasifican Internos/Externos por asesor (Orlando + Silvia/equipo + Anette); resto de roles conserva origen_mesa.';

COMMENT ON FUNCTION public.mesa_bandeja_counts_fast(text, text) IS
  'Mesa counts: misma clasificación Internos/Externos que la lista para ver_externos_mesa.';
