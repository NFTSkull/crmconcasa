-- ConCasa CRM — Mesa: búsqueda global también encuentra expedientes cancelados.
-- Alcance: SOLO lectura/búsqueda de la bandeja Mesa.
-- No reactiva, no muta expedientes, no cambia métricas, etapas, asignación ni cancelaciones.

CREATE OR REPLACE FUNCTION public.mesa_list_bandeja_search_global(
  p_limit integer DEFAULT 25,
  p_cursor_sort_ts timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_ops_filter text DEFAULT 'todo_mesa',
  p_buscar text DEFAULT NULL,
  p_etapa integer DEFAULT NULL,
  p_subestado text DEFAULT NULL,
  p_solo_citas_hoy boolean DEFAULT false,
  p_today_ymd text DEFAULT NULL,
  p_origen text DEFAULT NULL,
  p_include_counts boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $function$
DECLARE
  v_limit integer;
  v_active jsonb;
  v_cancelled jsonb;
  v_items jsonb;
  v_total bigint;
  v_combined_count integer;
  v_page_count integer;
  v_has_more boolean;
  v_last_item jsonb;
BEGIN
  v_limit := LEAST(100, GREATEST(1, COALESCE(p_limit, 25)));

  v_active := public.mesa_list_bandeja_page_base(
    p_limit => v_limit,
    p_cursor_sort_ts => p_cursor_sort_ts,
    p_cursor_id => p_cursor_id,
    p_quick_filter => 'todos',
    p_ops_filter => p_ops_filter,
    p_buscar => p_buscar,
    p_etapa => p_etapa,
    p_subestado => p_subestado,
    p_solo_citas_hoy => p_solo_citas_hoy,
    p_today_ymd => p_today_ymd,
    p_rechazos_sub => 'rechazados',
    p_origen => p_origen,
    p_include_counts => p_include_counts
  );

  v_cancelled := public.mesa_list_bandeja_page_base(
    p_limit => v_limit,
    p_cursor_sort_ts => p_cursor_sort_ts,
    p_cursor_id => p_cursor_id,
    p_quick_filter => 'rechazos_cancelaciones',
    p_ops_filter => p_ops_filter,
    p_buscar => p_buscar,
    p_etapa => p_etapa,
    p_subestado => p_subestado,
    p_solo_citas_hoy => p_solo_citas_hoy,
    p_today_ymd => p_today_ymd,
    p_rechazos_sub => 'cancelados',
    p_origen => p_origen,
    p_include_counts => false
  );

  v_combined_count :=
    jsonb_array_length(COALESCE(v_active->'items', '[]'::jsonb))
    + jsonb_array_length(COALESCE(v_cancelled->'items', '[]'::jsonb));

  SELECT
    COALESCE(jsonb_agg(x.item ORDER BY x.sort_ts, x.id), '[]'::jsonb),
    count(*)::integer
  INTO v_items, v_page_count
  FROM (
    SELECT
      m.item,
      (m.item->>'sort_ts')::timestamptz AS sort_ts,
      (m.item->>'id')::uuid AS id
    FROM (
      SELECT value AS item
      FROM jsonb_array_elements(COALESCE(v_active->'items', '[]'::jsonb))
      UNION ALL
      SELECT value AS item
      FROM jsonb_array_elements(COALESCE(v_cancelled->'items', '[]'::jsonb))
    ) m
    ORDER BY
      (m.item->>'sort_ts')::timestamptz,
      (m.item->>'id')::uuid
    LIMIT v_limit
  ) x;

  v_total :=
    COALESCE((v_active->>'total_count')::bigint, 0)
    + COALESCE((v_cancelled->>'total_count')::bigint, 0);

  v_has_more :=
    v_combined_count > v_limit
    OR COALESCE((v_active->>'has_more')::boolean, false)
    OR COALESCE((v_cancelled->>'has_more')::boolean, false);

  IF v_has_more AND COALESCE(v_page_count, 0) > 0 THEN
    SELECT e.value
    INTO v_last_item
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(value, ord)
    ORDER BY e.ord DESC
    LIMIT 1;
  ELSE
    v_last_item := NULL;
  END IF;

  RETURN jsonb_build_object(
    'items', COALESCE(v_items, '[]'::jsonb),
    'total_count', COALESCE(v_total, 0),
    'has_more', v_has_more,
    'next_cursor', CASE
      WHEN v_last_item IS NOT NULL THEN
        jsonb_build_object(
          'sort_ts', v_last_item->>'sort_ts',
          'id', v_last_item->>'id'
        )
      ELSE NULL
    END,
    'counts', v_active->'counts'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mesa_list_bandeja_search_global(
  integer,timestamptz,uuid,text,text,integer,text,boolean,text,text,boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_list_bandeja_search_global(
  integer,timestamptz,uuid,text,text,integer,text,boolean,text,text,boolean
) TO authenticated, service_role;

COMMENT ON FUNCTION public.mesa_list_bandeja_search_global(
  integer,timestamptz,uuid,text,text,integer,text,boolean,text,text,boolean
) IS
  'Búsqueda Mesa: combina coincidencias activas y canceladas sin reactivar ni mutar expedientes.';

CREATE OR REPLACE FUNCTION public.mesa_list_bandeja_page(
  p_limit integer DEFAULT 25,
  p_cursor_sort_ts timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_quick_filter text DEFAULT 'todos',
  p_ops_filter text DEFAULT 'todo_mesa',
  p_buscar text DEFAULT NULL,
  p_etapa integer DEFAULT NULL,
  p_subestado text DEFAULT NULL,
  p_solo_citas_hoy boolean DEFAULT false,
  p_today_ymd text DEFAULT NULL,
  p_rechazos_sub text DEFAULT 'rechazados',
  p_origen text DEFAULT NULL,
  p_include_counts boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $function$
DECLARE
  v_uid uuid;
  v_role public.app_role;
  v_external_scope boolean := false;
  v_ops_effective text;
  v_search_global boolean := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mesa_bandeja: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role
  INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_bandeja: perfil no encontrado o inactivo' USING ERRCODE = '42501';
  END IF;

  v_external_scope :=
    v_role = 'mesa_interno'
    AND public.profile_has_capability(v_uid, 'ver_externos_mesa');

  v_ops_effective := p_ops_filter;
  v_search_global :=
    NULLIF(btrim(COALESCE(p_buscar, '')), '') IS NOT NULL
    AND COALESCE(NULLIF(btrim(p_quick_filter), ''), 'todos') = 'todos';

  IF v_external_scope THEN
    -- En búsqueda explícita NO estrechar a sin_asignar: debe localizar cualquier
    -- expediente visible para Mesa, incluido un cancelado.
    IF NOT v_search_global
       AND p_etapa IN (1, 2)
       AND COALESCE(NULLIF(btrim(p_quick_filter), ''), 'todos') = 'todos'
       AND COALESCE(NULLIF(btrim(p_ops_filter), ''), 'todo_mesa') = 'todo_mesa' THEN
      v_ops_effective := 'sin_asignar';
    END IF;
  END IF;

  IF v_search_global THEN
    RETURN public.mesa_list_bandeja_search_global(
      p_limit => p_limit,
      p_cursor_sort_ts => p_cursor_sort_ts,
      p_cursor_id => p_cursor_id,
      p_ops_filter => v_ops_effective,
      p_buscar => p_buscar,
      p_etapa => p_etapa,
      p_subestado => p_subestado,
      p_solo_citas_hoy => p_solo_citas_hoy,
      p_today_ymd => p_today_ymd,
      p_origen => p_origen,
      p_include_counts => p_include_counts
    );
  END IF;

  RETURN public.mesa_list_bandeja_page_base(
    p_limit => p_limit,
    p_cursor_sort_ts => p_cursor_sort_ts,
    p_cursor_id => p_cursor_id,
    p_quick_filter => p_quick_filter,
    p_ops_filter => v_ops_effective,
    p_buscar => p_buscar,
    p_etapa => p_etapa,
    p_subestado => p_subestado,
    p_solo_citas_hoy => p_solo_citas_hoy,
    p_today_ymd => p_today_ymd,
    p_rechazos_sub => p_rechazos_sub,
    p_origen => p_origen,
    p_include_counts => p_include_counts
  );
END;
$function$;

COMMENT ON FUNCTION public.mesa_list_bandeja_page(
  integer,timestamptz,uuid,text,text,text,integer,text,boolean,text,text,text,boolean
) IS
  'Mesa bandeja: búsqueda textual global incluye activos y cancelados; filtros normales conservan semántica previa.';
