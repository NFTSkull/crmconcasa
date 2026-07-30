-- ConCasa CRM — Extiende requeue dirigido para booking_cancelled dead
-- Migración 135. No modifica 134. Sin backfill histórico.
--
-- Caso José Osvaldo: booking cancelado 8b53fffc-… quedó dead (unhandled_event)
-- con fila Sheet en 30 JULIO fila 23. El RPC 134 solo reencolaba booking_created.

CREATE OR REPLACE FUNCTION public.agenda_sheet_requeue_dead_sync(
  p_booking_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created INTEGER := 0;
  v_cancelled INTEGER := 0;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  -- 1) booking_created dead de citas activas futuras
  UPDATE public.agenda_sheet_sync_outbox o
  SET
    status = 'pending',
    attempts = 0,
    last_error = NULL,
    available_at = NOW(),
    processed_at = NULL,
    updated_at = NOW(),
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

  GET DIAGNOSTICS v_created = ROW_COUNT;

  -- 2) booking_cancelled dead: SOLO dirigido (p_booking_id obligatorio)
  --    y solo si hay referencia de fila Sheet (payload / inventario / link).
  IF p_booking_id IS NOT NULL THEN
    UPDATE public.agenda_sheet_sync_outbox o
    SET
      status = 'pending',
      attempts = 0,
      last_error = NULL,
      available_at = NOW(),
      processed_at = NULL,
      updated_at = NOW(),
      payload = CASE
        WHEN i.id IS NOT NULL THEN
          o.payload || jsonb_build_object(
            'sheet_id', i.sheet_id,
            'sheet_title', i.sheet_title,
            'sheet_row', i.sheet_row,
            'inventory_id', i.id
          )
        WHEN l.id IS NOT NULL THEN
          o.payload || jsonb_build_object(
            'sheet_id', l.sheet_id,
            'sheet_title', l.sheet_title,
            'sheet_row', l.row_number
          )
        ELSE o.payload
      END
    FROM public.agenda_bookings b
    LEFT JOIN public.agenda_sheet_slot_inventory i
      ON i.booking_id = b.id
     AND i.status IN ('claimed', 'linked', 'occupied_external')
    LEFT JOIN LATERAL (
      SELECT sl.id, sl.sheet_id, sl.sheet_title, sl.row_number
      FROM public.agenda_sheet_slot_links sl
      WHERE sl.booking_id = b.id
        AND sl.deleted_at IS NULL
      ORDER BY sl.updated_at DESC NULLS LAST
      LIMIT 1
    ) l ON TRUE
    WHERE o.booking_id = b.id
      AND b.id = p_booking_id
      AND o.status = 'dead'
      AND o.event_type = 'booking_cancelled'
      AND b.status = 'cancelled'
      AND b.kind IN ('biometricos', 'firmas')
      AND (
        NULLIF(btrim(COALESCE(o.payload->>'sheet_row', '')), '') IS NOT NULL
        OR i.id IS NOT NULL
        OR l.id IS NOT NULL
      );

    GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'requeued', v_created + v_cancelled,
    'requeued_created', v_created,
    'requeued_cancelled', v_cancelled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_requeue_dead_sync(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_requeue_dead_sync(UUID)
  TO service_role, postgres;

COMMENT ON FUNCTION public.agenda_sheet_requeue_dead_sync(UUID) IS
  'Reencola outbox dead: booking_created (activos futuros) y booking_cancelled dirigido con fila Sheet; no muta bookings ni Sheets.';
