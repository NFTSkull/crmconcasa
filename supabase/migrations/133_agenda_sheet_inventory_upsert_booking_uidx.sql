-- ConCasa CRM — upsert inventario: no chocar unique booking_id
-- Migración 133. Si el Sheet trae booking_id ya ligado a otra fila física
-- (p.ej. link NSS previo), se desasocia esa otra fila antes del upsert.
-- No crea bookings. No escribe Sheets.

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_upsert_batch(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_count INTEGER := 0;
  v_existing public.agenda_sheet_slot_inventory%ROWTYPE;
  v_status TEXT;
  v_booking_id UUID;
  v_expediente_id UUID;
  v_occ TEXT;
  v_visible_nss TEXT;
  v_visible_name TEXT;
  v_visible_advisor TEXT;
  v_ss TEXT;
  v_sheet_id BIGINT;
  v_sheet_row INTEGER;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_upsert_batch: p_rows debe ser array JSON'
      USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_status := NULLIF(btrim(COALESCE(v_elem->>'status', '')), '');
    BEGIN
      v_booking_id := NULLIF(btrim(COALESCE(v_elem->>'booking_id', '')), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_booking_id := NULL;
    END;
    BEGIN
      v_expediente_id := NULLIF(btrim(COALESCE(v_elem->>'expediente_id', '')), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_expediente_id := NULL;
    END;
    v_occ := NULLIF(btrim(COALESCE(v_elem->>'occupancy_source', '')), '');
    v_visible_nss := NULLIF(btrim(COALESCE(v_elem->>'visible_nss', '')), '');
    v_visible_name := NULLIF(btrim(COALESCE(v_elem->>'visible_name', '')), '');
    v_visible_advisor := NULLIF(btrim(COALESCE(v_elem->>'visible_advisor', '')), '');
    v_ss := btrim(COALESCE(v_elem->>'spreadsheet_id', ''));
    v_sheet_id := (v_elem->>'sheet_id')::BIGINT;
    v_sheet_row := (v_elem->>'sheet_row')::INTEGER;

    IF v_status IS NULL OR v_status NOT IN (
      'available', 'occupied_external', 'claimed', 'linked', 'disabled', 'conflict'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_inventory_upsert_batch: status inválido'
        USING ERRCODE = '22023';
    END IF;

    IF v_occ IS NULL OR v_occ NOT IN (
      'sheet_legacy', 'sheet_webhook', 'crm', 'reconciliation'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_inventory_upsert_batch: occupancy_source inválido'
        USING ERRCODE = '22023';
    END IF;

    -- Sheet O:U gana: liberar booking_id de otras filas físicas distintas
    IF v_booking_id IS NOT NULL THEN
      UPDATE public.agenda_sheet_slot_inventory i
      SET
        booking_id = NULL,
        expediente_id = CASE
          WHEN i.status IN ('linked', 'claimed') THEN i.expediente_id
          ELSE NULL
        END,
        status = CASE
          WHEN i.status IN ('linked', 'claimed') THEN 'occupied_external'
          ELSE i.status
        END,
        occupancy_source = CASE
          WHEN i.status IN ('linked', 'claimed') THEN 'reconciliation'
          ELSE i.occupancy_source
        END,
        linked_at = NULL,
        claimed_at = NULL,
        updated_at = NOW()
      WHERE i.booking_id = v_booking_id
        AND NOT (
          i.spreadsheet_id = v_ss
          AND i.sheet_id = v_sheet_id
          AND i.sheet_row = v_sheet_row
        );
    END IF;

    SELECT * INTO v_existing
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.spreadsheet_id = v_ss
      AND i.sheet_id = v_sheet_id
      AND i.sheet_row = v_sheet_row
    FOR UPDATE;

    IF FOUND THEN
      IF v_status = 'available' AND v_existing.booking_id IS NOT NULL THEN
        v_status := v_existing.status;
        v_booking_id := v_existing.booking_id;
        v_expediente_id := v_existing.expediente_id;
        v_occ := v_existing.occupancy_source;
      ELSIF v_status = 'occupied_external'
            AND v_existing.status IN ('claimed', 'linked')
            AND v_existing.booking_id IS NOT NULL
            AND (
              v_booking_id IS NULL
              OR v_booking_id = v_existing.booking_id
            ) THEN
        v_status := v_existing.status;
        v_booking_id := v_existing.booking_id;
        v_expediente_id := COALESCE(v_expediente_id, v_existing.expediente_id);
        v_occ := v_existing.occupancy_source;
      END IF;

      UPDATE public.agenda_sheet_slot_inventory i
      SET
        organization_id = COALESCE(
          NULLIF(btrim(COALESCE(v_elem->>'organization_id', '')), '')::UUID,
          i.organization_id
        ),
        sheet_title = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'sheet_title', '')), ''), i.sheet_title),
        booking_date = COALESCE((v_elem->>'booking_date')::DATE, i.booking_date),
        kind = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'kind', '')), ''), i.kind),
        location_id = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'location_id', '')), ''), i.location_id),
        slot_time = COALESCE((v_elem->>'slot_time')::TIME, i.slot_time),
        slot_key = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'slot_key', '')), ''), i.slot_key),
        status = v_status,
        visible_nss = v_visible_nss,
        visible_name = v_visible_name,
        visible_advisor = v_visible_advisor,
        booking_id = v_booking_id,
        expediente_id = v_expediente_id,
        occupancy_source = v_occ,
        observed_at = NOW(),
        last_error = CASE
          WHEN v_status = 'conflict' THEN COALESCE(v_elem->>'last_error', i.last_error)
          ELSE i.last_error
        END,
        updated_at = NOW()
      WHERE i.id = v_existing.id;
    ELSE
      INSERT INTO public.agenda_sheet_slot_inventory (
        organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date,
        sheet_row, kind, location_id, slot_time, slot_key, status,
        visible_nss, visible_name, visible_advisor,
        booking_id, expediente_id, occupancy_source, observed_at
      ) VALUES (
        (v_elem->>'organization_id')::UUID,
        v_ss,
        v_sheet_id,
        btrim(v_elem->>'sheet_title'),
        (v_elem->>'booking_date')::DATE,
        v_sheet_row,
        btrim(v_elem->>'kind'),
        btrim(v_elem->>'location_id'),
        (v_elem->>'slot_time')::TIME,
        btrim(v_elem->>'slot_key'),
        v_status,
        v_visible_nss,
        v_visible_name,
        v_visible_advisor,
        v_booking_id,
        v_expediente_id,
        v_occ,
        NOW()
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'upserted', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_upsert_batch(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_upsert_batch(JSONB)
  TO service_role, postgres;

COMMENT ON FUNCTION public.agenda_sheet_inventory_upsert_batch(JSONB) IS
  'Upsert inventario Sheet; desasocia booking_id duplicado en otras filas (mig. 133).';
