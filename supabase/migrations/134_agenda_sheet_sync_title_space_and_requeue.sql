-- ConCasa CRM — Fix sync CRM→Sheet: títulos con trailing space + recuperación outbox
-- Migración 134. No modifica 132/133. No escribe Google Sheets.
--
-- Causa productiva (José Osvaldo Limón, booking d4c91a59-…):
--   outbox dead: Unable to parse range: '03 AGOSTO'!A38:U38
--   pestaña real: '03 AGOSTO ' (espacio final). upsert_batch hacía btrim(sheet_title).

-- 1) upsert_batch: preservar sheet_title exacto (sin btrim)
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
  v_sheet_title TEXT;
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
    -- CRÍTICO: no btrim — pestañas operativas pueden terminar en espacio ("03 AGOSTO ").
    v_sheet_title := COALESCE(v_elem->>'sheet_title', '');
    IF v_sheet_title = '' THEN
      v_sheet_title := NULL;
    END IF;

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
        sheet_title = COALESCE(v_sheet_title, i.sheet_title),
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
        COALESCE(v_sheet_title, v_ss),
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

-- 2) claim: recuperar processing abandonados (>10 min)
CREATE OR REPLACE FUNCTION public.agenda_sheet_claim_outbox(p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.agenda_sheet_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  -- Liberar claims processing abandonados
  UPDATE public.agenda_sheet_sync_outbox o
  SET
    status = CASE
      WHEN o.attempts >= o.max_attempts THEN 'dead'
      ELSE 'failed'
    END,
    last_error = COALESCE(NULLIF(o.last_error, ''), 'processing_timeout'),
    available_at = CASE
      WHEN o.attempts >= o.max_attempts THEN o.available_at
      ELSE NOW()
    END,
    processed_at = CASE
      WHEN o.attempts >= o.max_attempts THEN COALESCE(o.processed_at, NOW())
      ELSE o.processed_at
    END,
    updated_at = NOW()
  WHERE o.status = 'processing'
    AND o.updated_at < NOW() - INTERVAL '10 minutes';

  RETURN QUERY
  WITH cte AS (
    SELECT o.id
    FROM public.agenda_sheet_sync_outbox o
    WHERE o.status IN ('pending', 'failed')
      AND o.attempts < o.max_attempts
      AND o.available_at <= NOW()
    ORDER BY o.available_at ASC, o.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
  )
  UPDATE public.agenda_sheet_sync_outbox o
  SET status = 'processing',
      attempts = o.attempts + 1,
      updated_at = NOW()
  FROM cte
  WHERE o.id = cte.id
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_claim_outbox(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_claim_outbox(INTEGER)
  TO service_role, postgres;

-- 3) Reencolar outbox dead de bookings activos futuros (sin mutar bookings)
CREATE OR REPLACE FUNCTION public.agenda_sheet_requeue_dead_sync(
  p_booking_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER := 0;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  UPDATE public.agenda_sheet_sync_outbox o
  SET
    status = 'pending',
    attempts = 0,
    last_error = NULL,
    available_at = NOW(),
    processed_at = NULL,
    updated_at = NOW(),
    -- refrescar título/fila desde inventario claimed/linked si existe
    payload = CASE
      WHEN i.id IS NOT NULL THEN
        o.payload || jsonb_build_object(
          'sheet_id', i.sheet_id,
          'sheet_title', i.sheet_title,
          'sheet_row', i.sheet_row,
          'inventory_id', i.id
        )
      ELSE o.payload
    END
  FROM public.agenda_bookings b
  LEFT JOIN public.agenda_sheet_slot_inventory i
    ON i.booking_id = b.id
   AND i.status IN ('claimed', 'linked')
  WHERE o.booking_id = b.id
    AND o.status = 'dead'
    AND o.event_type = 'booking_created'
    AND b.status = 'booked'
    AND b.kind IN ('biometricos', 'firmas')
    AND b.booking_date >= CURRENT_DATE
    AND (p_booking_id IS NULL OR o.booking_id = p_booking_id);

  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'requeued', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_requeue_dead_sync(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_requeue_dead_sync(UUID)
  TO service_role, postgres;

COMMENT ON FUNCTION public.agenda_sheet_requeue_dead_sync(UUID) IS
  'Reencola outbox dead de booking_created para citas activas futuras; no muta bookings ni Sheets.';
