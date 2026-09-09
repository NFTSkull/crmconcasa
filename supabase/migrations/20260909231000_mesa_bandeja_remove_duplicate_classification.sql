-- ConCasa CRM — Mesa: eliminar clasificación P198 duplicada en el read-model.
--
-- Alcance: SOLO lectura / definición de función.
-- 0 UPDATE / 0 DELETE / 0 INSERT de negocio / 0 backfill.
--
-- `mesa_list_bandeja_page_base` ya calcula `state_bulk` mediante
-- `mesa_cambio_revision_estado_bandeja_bulk`, que devuelve origin,
-- request_type, request_at, batch_id y batch_submitted_at. La versión vigente
-- volvía a ejecutar `mesa_cambio_revision_clasificacion(en.id)` por cada fila
-- y solo la usaba como fallback para origin/request_type/request_at.
--
-- Validación Production previa (2026-09-09): 140 filas accionables
-- CORRECTION_PENDING_REVIEW / ADVISOR_UPDATE_PENDING_REVIEW y 0 diferencias
-- entre bulk y clasificación individual en origin, request_type, request_at,
-- batch_id y batch_submitted_at.
--
-- Fail-closed: si la definición vigente no contiene exactamente los patrones
-- esperados, la migración aborta y no modifica la función.

DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_old_classification text := $old$
      (
        SELECT to_jsonb(t)
        FROM public.mesa_cambio_revision_clasificacion(en.id) t
        LIMIT 1
      ) AS cambio_cls,
$old$;
  v_old_origin text := $old$coalesce(p.cambio_eff->>'origin', p.cambio_cls->>'origin')$old$;
  v_old_request_type text := $old$coalesce(p.cambio_eff->>'request_type', p.cambio_cls->>'request_type')$old$;
  v_old_request_at text := $old$coalesce(p.cambio_eff->>'request_at', p.cambio_cls->>'request_at')$old$;
BEGIN
  SELECT p.oid
  INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mesa_list_bandeja_page_base'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_limit integer, p_cursor_sort_ts timestamp with time zone, p_cursor_id uuid, p_quick_filter text, p_ops_filter text, p_buscar text, p_etapa integer, p_subestado text, p_solo_citas_hoy boolean, p_today_ymd text, p_rechazos_sub text, p_origen text, p_include_counts boolean';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mesa_list_bandeja_page_base signature not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF strpos(v_def, v_old_classification) = 0 THEN
    RAISE EXCEPTION 'mesa perf patch aborted: duplicate classification block not found';
  END IF;
  IF strpos(v_def, v_old_origin) = 0
     OR strpos(v_def, v_old_request_type) = 0
     OR strpos(v_def, v_old_request_at) = 0 THEN
    RAISE EXCEPTION 'mesa perf patch aborted: expected fallback expressions not found';
  END IF;

  v_def := replace(v_def, v_old_classification, E'');
  v_def := replace(v_def, v_old_origin, E'p.cambio_eff->>''origin''');
  v_def := replace(v_def, v_old_request_type, E'p.cambio_eff->>''request_type''');
  v_def := replace(v_def, v_old_request_at, E'p.cambio_eff->>''request_at''');

  IF strpos(v_def, 'mesa_cambio_revision_clasificacion(en.id)') > 0
     OR strpos(v_def, 'p.cambio_cls') > 0 THEN
    RAISE EXCEPTION 'mesa perf patch aborted: stale classification reference remains';
  END IF;

  EXECUTE v_def;
END;
$do$;

COMMENT ON FUNCTION public.mesa_list_bandeja_page_base(
  integer, timestamptz, uuid, text, text, text, integer, text,
  boolean, text, text, text, boolean
) IS
  'Mesa paginated read-model. P202/P198 metadata comes from bulk state once; duplicate per-row classification removed 2026-09-09.';
