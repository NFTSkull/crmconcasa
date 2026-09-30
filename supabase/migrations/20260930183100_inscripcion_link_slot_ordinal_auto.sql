-- Inscripción usa varias filas físicas con la misma hora (11:00).
-- El worker puede solicitar ordinal=1 en reintentos; este helper conserva el
-- ordinal de la fila o asigna el siguiente libre sin colisionar.

CREATE OR REPLACE FUNCTION public.agenda_sheet_upsert_link_from_crm(
  p_organization_id uuid,
  p_spreadsheet_id text,
  p_sheet_id bigint,
  p_sheet_title text,
  p_sheet_date date,
  p_row_number integer,
  p_location_id text,
  p_kind public.booking_kind,
  p_slot_time time without time zone,
  p_slot_ordinal integer,
  p_booking_id uuid,
  p_sync_status text DEFAULT 'SINCRONIZADO'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_slot_ordinal INTEGER := GREATEST(COALESCE(p_slot_ordinal, 1), 1);
  v_existing_ordinal INTEGER;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_kind::TEXT = 'inscripcion' THEN
    -- Serializa únicamente el pool físico Inscripción de este día/sede/hora.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(
          '|',
          btrim(p_spreadsheet_id),
          p_sheet_id::TEXT,
          p_sheet_date::TEXT,
          lower(btrim(p_location_id)),
          p_kind::TEXT,
          p_slot_time::TEXT
        ),
        0
      )
    );

    SELECT l.slot_ordinal
    INTO v_existing_ordinal
    FROM public.agenda_sheet_slot_links l
    WHERE l.spreadsheet_id = btrim(p_spreadsheet_id)
      AND l.sheet_id = p_sheet_id
      AND l.row_number = p_row_number
      AND l.deleted_at IS NULL
    LIMIT 1
    FOR UPDATE;

    IF v_existing_ordinal IS NOT NULL THEN
      v_slot_ordinal := v_existing_ordinal;
    ELSIF EXISTS (
      SELECT 1
      FROM public.agenda_sheet_slot_links l
      WHERE l.spreadsheet_id = btrim(p_spreadsheet_id)
        AND l.sheet_id = p_sheet_id
        AND l.sheet_date = p_sheet_date
        AND lower(btrim(l.location_id)) = lower(btrim(p_location_id))
        AND l.kind = p_kind
        AND l.slot_time = p_slot_time
        AND l.slot_ordinal = v_slot_ordinal
        AND l.deleted_at IS NULL
        AND l.row_number <> p_row_number
    ) THEN
      SELECT gs.n
      INTO v_slot_ordinal
      FROM generate_series(1, 100) AS gs(n)
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.agenda_sheet_slot_links l
        WHERE l.spreadsheet_id = btrim(p_spreadsheet_id)
          AND l.sheet_id = p_sheet_id
          AND l.sheet_date = p_sheet_date
          AND lower(btrim(l.location_id)) = lower(btrim(p_location_id))
          AND l.kind = p_kind
          AND l.slot_time = p_slot_time
          AND l.slot_ordinal = gs.n
          AND l.deleted_at IS NULL
          AND l.row_number <> p_row_number
      )
      ORDER BY gs.n
      LIMIT 1;

      IF v_slot_ordinal IS NULL THEN
        RAISE EXCEPTION 'agenda_sheet_upsert_link_from_crm: sin ordinal libre para Inscripción'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.agenda_sheet_slot_links (
    organization_id,
    spreadsheet_id,
    sheet_id,
    sheet_title,
    sheet_date,
    row_number,
    location_id,
    kind,
    slot_time,
    slot_ordinal,
    booking_id,
    sync_status,
    sync_source,
    last_synced_at
  ) VALUES (
    p_organization_id,
    btrim(p_spreadsheet_id),
    p_sheet_id,
    p_sheet_title,
    p_sheet_date,
    p_row_number,
    p_location_id,
    p_kind,
    p_slot_time,
    v_slot_ordinal,
    p_booking_id,
    COALESCE(p_sync_status, 'SINCRONIZADO'),
    'crm',
    NOW()
  )
  ON CONFLICT (spreadsheet_id, sheet_id, row_number) DO UPDATE
  SET
    organization_id = EXCLUDED.organization_id,
    sheet_title = EXCLUDED.sheet_title,
    sheet_date = EXCLUDED.sheet_date,
    location_id = EXCLUDED.location_id,
    kind = EXCLUDED.kind,
    slot_time = EXCLUDED.slot_time,
    slot_ordinal = EXCLUDED.slot_ordinal,
    booking_id = EXCLUDED.booking_id,
    sync_status = EXCLUDED.sync_status,
    sync_source = 'crm',
    last_synced_at = NOW(),
    sync_version = public.agenda_sheet_slot_links.sync_version + 1,
    deleted_at = NULL,
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.agenda_sheet_upsert_link_from_crm(
  uuid,text,bigint,text,date,integer,text,public.booking_kind,time without time zone,integer,uuid,text
) IS
  'Upsert CRM→Sheet; para Inscripción asigna ordinal libre por fila física para soportar múltiples cupos 11:00.';
