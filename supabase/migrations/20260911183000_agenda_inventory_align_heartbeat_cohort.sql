-- ConCasa CRM — disponibilidad real después de reducir write-churn del inventario.
--
-- Causa raíz:
-- - P276 suprime heartbeats idénticos hasta 2h para reducir Disk I/O.
-- - agenda_sheet_inventory_available_count conserva una guardia anti-stale que solo
--   cuenta filas dentro de 5 minutos del MAX(observed_at) del scope.
-- - Si una sola fila cambia (booking/link/etc.), esa fila recibe observed_at=NOW(),
--   mientras las filas available idénticas conservan un observed_at anterior.
--   Resultado: la UI/hard-gate puede ver 0 disponibles aunque el Sheet tenga huecos.
--
-- Fix:
-- - NO desactiva la supresión de heartbeats.
-- - Después de un batch real de Sheet, solo si las filas presentes EN ESE MISMO BATCH
--   quedaron separadas >5m en observed_at, alinea una vez el cohort completo.
-- - No toca filas ausentes del batch, por lo que la guardia anti-stale sigue excluyendo
--   filas que ya no fueron vistas físicamente.
-- - Un scope estable sigue sin generar writes de heartbeat repetitivos.

CREATE OR REPLACE FUNCTION public.agenda_sheet_slot_inventory_suppress_recent_heartbeat()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Escape hatch interno y transaccional usado únicamente por el post-proceso del
  -- batch cuando existe skew real de timestamps dentro del cohort recién leído.
  IF current_setting('app.agenda_force_inventory_heartbeat', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF OLD.observed_at IS NOT NULL
     AND OLD.observed_at >= (NOW() - INTERVAL '2 hours')
     AND NEW.observed_at IS DISTINCT FROM OLD.observed_at
     AND NEW.sheet_last_seen_at IS DISTINCT FROM OLD.sheet_last_seen_at
     AND NEW.observed_at >= (NOW() - INTERVAL '5 minutes')
     AND NEW.sheet_last_seen_at >= (NOW() - INTERVAL '5 minutes')
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.spreadsheet_id IS NOT DISTINCT FROM OLD.spreadsheet_id
     AND NEW.sheet_id IS NOT DISTINCT FROM OLD.sheet_id
     AND NEW.sheet_title IS NOT DISTINCT FROM OLD.sheet_title
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NEW.sheet_row IS NOT DISTINCT FROM OLD.sheet_row
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.location_id IS NOT DISTINCT FROM OLD.location_id
     AND NEW.slot_time IS NOT DISTINCT FROM OLD.slot_time
     AND NEW.sheet_slot_time IS NOT DISTINCT FROM OLD.sheet_slot_time
     AND NEW.slot_key IS NOT DISTINCT FROM OLD.slot_key
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.visible_nss IS NOT DISTINCT FROM OLD.visible_nss
     AND NEW.visible_name IS NOT DISTINCT FROM OLD.visible_name
     AND NEW.visible_advisor IS NOT DISTINCT FROM OLD.visible_advisor
     AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
     AND NEW.expediente_id IS NOT DISTINCT FROM OLD.expediente_id
     AND NEW.occupancy_source IS NOT DISTINCT FROM OLD.occupancy_source
     AND NEW.manual_occupancy_fingerprint IS NOT DISTINCT FROM OLD.manual_occupancy_fingerprint
     AND NEW.claimed_at IS NOT DISTINCT FROM OLD.claimed_at
     AND NEW.linked_at IS NOT DISTINCT FROM OLD.linked_at
     AND NEW.last_error IS NOT DISTINCT FROM OLD.last_error
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_align_batch_heartbeat(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope RECORD;
  v_min_observed TIMESTAMPTZ;
  v_max_observed TIMESTAMPTZ;
  v_rows INTEGER;
  v_total INTEGER := 0;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  FOR v_scope IN
    SELECT DISTINCT
      NULLIF(btrim(e.elem->>'organization_id'), '')::UUID AS organization_id,
      NULLIF(btrim(e.elem->>'booking_date'), '')::DATE AS booking_date,
      lower(btrim(COALESCE(e.elem->>'kind', ''))) AS kind,
      lower(btrim(COALESCE(e.elem->>'location_id', ''))) AS location_id
    FROM jsonb_array_elements(p_rows) AS e(elem)
    WHERE NULLIF(btrim(e.elem->>'organization_id'), '') IS NOT NULL
      AND NULLIF(btrim(e.elem->>'booking_date'), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(e.elem->>'kind', '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(e.elem->>'location_id', '')), '') IS NOT NULL
  LOOP
    SELECT MIN(i.observed_at), MAX(i.observed_at)
    INTO v_min_observed, v_max_observed
    FROM public.agenda_sheet_slot_inventory i
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_rows) AS e(elem)
      WHERE NULLIF(btrim(e.elem->>'organization_id'), '')::UUID = v_scope.organization_id
        AND NULLIF(btrim(e.elem->>'booking_date'), '')::DATE = v_scope.booking_date
        AND lower(btrim(COALESCE(e.elem->>'kind', ''))) = v_scope.kind
        AND lower(btrim(COALESCE(e.elem->>'location_id', ''))) = v_scope.location_id
        AND i.spreadsheet_id = btrim(COALESCE(e.elem->>'spreadsheet_id', ''))
        AND i.sheet_id = (e.elem->>'sheet_id')::BIGINT
        AND i.sheet_row = (e.elem->>'sheet_row')::INTEGER
    );

    -- Sin skew >5m no hay motivo para escribir: conserva el ahorro de I/O.
    IF v_max_observed IS NULL
       OR v_min_observed IS NULL
       OR v_min_observed >= (v_max_observed - INTERVAL '5 minutes') THEN
      CONTINUE;
    END IF;

    BEGIN
      PERFORM set_config('app.agenda_force_inventory_heartbeat', 'on', true);

      UPDATE public.agenda_sheet_slot_inventory i
      SET
        observed_at = NOW(),
        sheet_last_seen_at = NOW(),
        updated_at = NOW()
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_rows) AS e(elem)
        WHERE NULLIF(btrim(e.elem->>'organization_id'), '')::UUID = v_scope.organization_id
          AND NULLIF(btrim(e.elem->>'booking_date'), '')::DATE = v_scope.booking_date
          AND lower(btrim(COALESCE(e.elem->>'kind', ''))) = v_scope.kind
          AND lower(btrim(COALESCE(e.elem->>'location_id', ''))) = v_scope.location_id
          AND i.spreadsheet_id = btrim(COALESCE(e.elem->>'spreadsheet_id', ''))
          AND i.sheet_id = (e.elem->>'sheet_id')::BIGINT
          AND i.sheet_row = (e.elem->>'sheet_row')::INTEGER
      );

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_total := v_total + COALESCE(v_rows, 0);
      PERFORM set_config('app.agenda_force_inventory_heartbeat', 'off', true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('app.agenda_force_inventory_heartbeat', 'off', true);
      RAISE;
    END;
  END LOOP;

  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_align_batch_heartbeat(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_align_batch_heartbeat(jsonb)
  TO service_role, postgres;

-- Mantener intacta la lógica compleja de sanitización/reconciliación vigente: se
-- renombra el wrapper actual y se añade únicamente un post-proceso de heartbeat.
ALTER FUNCTION public.agenda_sheet_inventory_upsert_batch(jsonb)
  RENAME TO agenda_sheet_inventory_upsert_batch_pre_p279;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_upsert_batch_pre_p279(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_upsert_batch_pre_p279(jsonb)
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_upsert_batch(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_clean JSONB;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  -- El wrapper previo conserva 100% de la semántica de negocio y anti-steal.
  v_result := public.agenda_sheet_inventory_upsert_batch_pre_p279(p_rows);

  -- Usar exactamente el mismo batch sanitizado para alinear solo filas que sí
  -- estuvieron presentes en la relectura física actual.
  v_clean := public.agenda_sheet_sanitize_inventory_batch(p_rows);
  PERFORM public.agenda_sheet_inventory_align_batch_heartbeat(v_clean);

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_upsert_batch(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_upsert_batch(jsonb)
  TO service_role, postgres;

COMMENT ON FUNCTION public.agenda_sheet_inventory_align_batch_heartbeat(jsonb) IS
  'Alinea observed_at solo cuando el cohort del batch quedó >5m desfasado por heartbeat suppression; no toca filas ausentes.';
COMMENT ON FUNCTION public.agenda_sheet_inventory_upsert_batch(jsonb) IS
  'Wrapper P279: lógica previa intacta + alineación puntual del cohort para compatibilidad con anti-stale de disponibilidad.';
