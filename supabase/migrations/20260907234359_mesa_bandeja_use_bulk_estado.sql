-- ConCasa CRM — wire Mesa inbox RPCs to bulk effective-state helper.
-- Read-only DDL. Exact response contract preserved.

DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  v_old text;
  v_repl text;
BEGIN
  -- Counts: bulk resolve states once for base IDs.
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='mesa_bandeja_counts_fast'
    AND pg_get_function_identity_arguments(p.oid)='p_today_ymd text, p_origen text';
  v_def := pg_get_functiondef(v_oid);
  v_old := $old$classified AS MATERIALIZED (
    SELECT
      b.id,
      b.etapa_actual,
      b.subestado,
      b.ciclo_estado,
      b.fecha_cita,
      b.pago_concasa_resultado,
      public.mesa_bandeja_categoria_resumen_fast(b.id, b.fecha_envio_mesa) AS categoria,
      (
        SELECT t.estado
        FROM public.mesa_cambio_revision_estado_bandeja_fast(b.id) t
        LIMIT 1
      ) AS cambio_estado
    FROM base b
  )$old$;
  v_repl := $new$state_bulk AS MATERIALIZED (
    SELECT s.*
    FROM public.mesa_cambio_revision_estado_bandeja_bulk(
      (SELECT coalesce(array_agg(b.id), ARRAY[]::uuid[]) FROM base b)
    ) s
  ),
  classified AS MATERIALIZED (
    SELECT
      b.id,
      b.etapa_actual,
      b.subestado,
      b.ciclo_estado,
      b.fecha_cita,
      b.pago_concasa_resultado,
      public.mesa_bandeja_categoria_resumen_fast(b.id, b.fecha_envio_mesa) AS categoria,
      s.estado AS cambio_estado
    FROM base b
    LEFT JOIN state_bulk s ON s.expediente_id = b.id
  )$new$;
  v_new := replace(v_def, v_old, v_repl);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'counts bulk replacement did not match';
  END IF;
  EXECUTE v_new;

  -- List: bulk resolve effective state; preserve existing classification fallback.
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='mesa_list_bandeja_page'
    AND pg_get_function_identity_arguments(p.oid)='p_limit integer, p_cursor_sort_ts timestamp with time zone, p_cursor_id uuid, p_quick_filter text, p_ops_filter text, p_buscar text, p_etapa integer, p_subestado text, p_solo_citas_hoy boolean, p_today_ymd text, p_rechazos_sub text, p_origen text, p_include_counts boolean';
  v_def := pg_get_functiondef(v_oid);
  v_old := $old$classified AS (
    SELECT
      en.*,
      (
        SELECT to_jsonb(t)
        FROM public.mesa_cambio_revision_clasificacion(en.id) t
        LIMIT 1
      ) AS cambio_cls,
      (
        SELECT to_jsonb(t)
        FROM public.mesa_cambio_revision_estado_bandeja_fast(en.id) t
        LIMIT 1
      ) AS cambio_eff
    FROM enriched en
  )$old$;
  v_repl := $new$state_bulk AS MATERIALIZED (
    SELECT s.*
    FROM public.mesa_cambio_revision_estado_bandeja_bulk(
      (SELECT coalesce(array_agg(x.id), ARRAY[]::uuid[]) FROM enriched x)
    ) s
  ),
  classified AS (
    SELECT
      en.*,
      (
        SELECT to_jsonb(t)
        FROM public.mesa_cambio_revision_clasificacion(en.id) t
        LIMIT 1
      ) AS cambio_cls,
      (to_jsonb(s) - 'expediente_id') AS cambio_eff
    FROM enriched en
    LEFT JOIN state_bulk s ON s.expediente_id = en.id
  )$new$;
  v_new := replace(v_def, v_old, v_repl);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'list bulk replacement did not match';
  END IF;
  EXECUTE v_new;
END;
$do$;
