-- ConCasa CRM — defensa DB contra bloques no-agenda pegados a Biométricos MTY.
-- Desde 2026-09-14, si dentro del mismo batch Biométricos/Monterrey el orden
-- físico de horas retrocede (p.ej. 10:00 -> 08:00 al entrar a LEO), la cola
-- posterior del mismo bloque se sanitiza como disabled. No toca bookings.

CREATE OR REPLACE FUNCTION public.agenda_sheet_sanitize_inventory_batch(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'agenda_sheet_sanitize_inventory_batch: p_rows debe ser array JSON'
      USING ERRCODE = '22023';
  END IF;

  WITH src AS (
    SELECT
      e.ord,
      e.elem,
      btrim(COALESCE(e.elem->>'booking_id', '')) AS booking_text,
      CASE
        WHEN btrim(COALESCE(e.elem->>'booking_id', '')) ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (btrim(e.elem->>'booking_id'))::UUID
        ELSE NULL
      END AS booking_uuid,
      public.agenda_sheet_normalize_nss(e.elem->>'visible_nss') AS visible_nss_norm,
      NULLIF(btrim(COALESCE(e.elem->>'visible_name', '')), '') AS visible_name,
      NULLIF(btrim(COALESCE(e.elem->>'visible_advisor', '')), '') AS visible_advisor,
      lower(btrim(COALESCE(e.elem->>'kind', ''))) AS kind_norm,
      lower(btrim(COALESCE(e.elem->>'location_id', ''))) AS location_norm,
      btrim(COALESCE(e.elem->>'booking_date', '')) AS booking_date_text,
      btrim(COALESCE(e.elem->>'spreadsheet_id', '')) AS spreadsheet_id_text,
      btrim(COALESCE(e.elem->>'sheet_id', '')) AS sheet_id_text,
      left(btrim(COALESCE(e.elem->>'sheet_slot_time', '')), 5) AS sheet_slot_hhmm
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(elem, ord)
  ), marked AS (
    SELECT
      s.*,
      CASE
        WHEN s.kind_norm = 'biometricos'
         AND s.location_norm = 'monterrey'
         AND s.booking_date_text >= '2026-09-14'
         AND EXISTS (
           SELECT 1
           FROM src reg
           WHERE reg.ord <= s.ord
             AND reg.kind_norm = s.kind_norm
             AND reg.location_norm = s.location_norm
             AND reg.booking_date_text = s.booking_date_text
             AND reg.spreadsheet_id_text = s.spreadsheet_id_text
             AND reg.sheet_id_text = s.sheet_id_text
             AND reg.sheet_slot_hhmm <> ''
             AND EXISTS (
               SELECT 1
               FROM src prev
               WHERE prev.ord < reg.ord
                 AND prev.kind_norm = reg.kind_norm
                 AND prev.location_norm = reg.location_norm
                 AND prev.booking_date_text = reg.booking_date_text
                 AND prev.spreadsheet_id_text = reg.spreadsheet_id_text
                 AND prev.sheet_id_text = reg.sheet_id_text
                 AND prev.sheet_slot_hhmm > reg.sheet_slot_hhmm
             )
         )
        THEN TRUE
        ELSE FALSE
      END AS nonagenda_tail
    FROM src s
  ), auth AS (
    SELECT
      s.*,
      b.id AS auth_booking_id,
      b.expediente_id AS auth_expediente_id,
      b.booking_date AS auth_booking_date,
      b.booking_time AS auth_booking_time,
      b.location_id AS auth_location_id,
      b.kind::TEXT AS auth_kind,
      b.status::TEXT AS auth_status,
      public.agenda_sheet_normalize_nss(x.nss::TEXT) AS auth_nss_norm
    FROM marked s
    LEFT JOIN public.agenda_bookings b ON b.id = s.booking_uuid
    LEFT JOIN public.expedientes x ON x.id = b.expediente_id
  ), cleaned AS (
    SELECT
      ord,
      CASE
        WHEN nonagenda_tail THEN
          (elem - 'booking_id' - 'expediente_id') || jsonb_build_object(
            'booking_id', NULL,
            'expediente_id', NULL,
            'status', 'disabled',
            'occupancy_source', 'reconciliation',
            'visible_nss', NULL,
            'visible_name', NULL,
            'visible_advisor', NULL
          )
        WHEN booking_text = '' THEN elem
        WHEN booking_uuid IS NULL
          OR auth_booking_id IS NULL
          OR auth_status <> 'booked'
          OR auth_booking_date::TEXT <> btrim(COALESCE(elem->>'booking_date', ''))
          OR lower(auth_kind) <> lower(btrim(COALESCE(elem->>'kind', '')))
          OR lower(auth_location_id) <> lower(btrim(COALESCE(elem->>'location_id', '')))
          OR left(auth_booking_time::TEXT, 5) <> left(btrim(COALESCE(elem->>'slot_time', '')), 5)
          OR (
            visible_nss_norm IS NOT NULL
            AND visible_nss_norm IS DISTINCT FROM auth_nss_norm
          )
        THEN
          (elem - 'booking_id' - 'expediente_id') || jsonb_build_object(
            'booking_id', NULL,
            'expediente_id', NULL,
            'status', CASE
              WHEN visible_nss_norm IS NOT NULL OR visible_name IS NOT NULL OR visible_advisor IS NOT NULL
                THEN 'occupied_external'
              ELSE 'available'
            END,
            'occupancy_source', CASE
              WHEN visible_nss_norm IS NOT NULL OR visible_name IS NOT NULL OR visible_advisor IS NOT NULL
                THEN 'sheet_legacy'
              ELSE 'reconciliation'
            END
          )
        ELSE
          jsonb_set(
            jsonb_set(elem, '{booking_id}', to_jsonb(auth_booking_id::TEXT), true),
            '{expediente_id}', to_jsonb(auth_expediente_id::TEXT), true
          )
      END AS elem_clean
    FROM auth
  )
  SELECT COALESCE(jsonb_agg(elem_clean ORDER BY ord), '[]'::JSONB)
  INTO v_out
  FROM cleaned;

  RETURN v_out;
END;
$function$;
