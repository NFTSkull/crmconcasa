-- ConCasa CRM — Cancelación limpia fila Sheet (B:D + O:U) + reparación dirigida
-- Migración 136. No modifica 134/135.
--
-- Contrato: conservar A (HORA); limpiar B:D y O:U; no escribir CANCELADA
-- visible. Auditoría permanece en Supabase/outbox.

-- 1) Permitir event_type booking_cancelled_cleanup
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'agenda_sheet_sync_outbox'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.agenda_sheet_sync_outbox DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.agenda_sheet_sync_outbox
  ADD CONSTRAINT agenda_sheet_sync_outbox_event_type_check
  CHECK (event_type IN (
    'booking_created',
    'booking_updated',
    'booking_cancelled',
    'booking_rescheduled',
    'booking_cancelled_cleanup'
  ));

-- 2) Liberar link + inventario tras limpieza Sheet (service_role)
CREATE OR REPLACE FUNCTION public.agenda_sheet_mark_cancelled_cleared(
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_links INTEGER := 0;
  v_inv INTEGER := 0;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_mark_cancelled_cleared: booking_id requerido'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_sheet_slot_links l
  SET
    deleted_at = COALESCE(l.deleted_at, NOW()),
    sync_status = 'CANCELADA',
    updated_at = NOW()
  WHERE l.booking_id = p_booking_id
    AND l.deleted_at IS NULL;
  GET DIAGNOSTICS v_links = ROW_COUNT;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'available',
    booking_id = NULL,
    expediente_id = NULL,
    claimed_at = NULL,
    linked_at = NULL,
    visible_nss = NULL,
    visible_name = NULL,
    visible_advisor = NULL,
    occupancy_source = 'reconciliation',
    updated_at = NOW()
  WHERE i.booking_id = p_booking_id
    AND i.status IN ('claimed', 'linked', 'occupied_external');
  GET DIAGNOSTICS v_inv = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'links_soft_deleted', v_links,
    'inventory_released', v_inv
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_mark_cancelled_cleared(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_mark_cancelled_cleared(UUID)
  TO service_role, postgres;

COMMENT ON FUNCTION public.agenda_sheet_mark_cancelled_cleared(UUID) IS
  'Tras limpiar fila Sheet: soft-delete slot_links y libera inventario del booking cancelado.';

-- 3) Encolar limpieza dirigida (no toca bookings; no UPDATE outbox histórico)
CREATE OR REPLACE FUNCTION public.agenda_sheet_enqueue_cancel_cleanup(
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.agenda_bookings%ROWTYPE;
  v_key TEXT;
  v_existing UUID;
  v_id UUID;
  v_has_evidence BOOLEAN := false;
  v_payload JSONB := '{}'::JSONB;
  v_inv public.agenda_sheet_slot_inventory%ROWTYPE;
  v_link public.agenda_sheet_slot_links%ROWTYPE;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_enqueue_cancel_cleanup: booking_id requerido'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_b
  FROM public.agenda_bookings
  WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_sheet_enqueue_cancel_cleanup: booking no existe'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_b.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'agenda_sheet_enqueue_cancel_cleanup: booking no cancelled'
      USING ERRCODE = '22023';
  END IF;

  IF v_b.kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'agenda_sheet_enqueue_cancel_cleanup: kind no sincronizable'
      USING ERRCODE = '22023';
  END IF;

  -- Evidencia CRM de sync: link, inventario, o outbox cancel previo
  SELECT * INTO v_link
  FROM public.agenda_sheet_slot_links l
  WHERE l.booking_id = p_booking_id
  ORDER BY l.deleted_at NULLS FIRST, l.updated_at DESC NULLS LAST
  LIMIT 1;

  SELECT * INTO v_inv
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.booking_id = p_booking_id
  LIMIT 1;

  IF v_link.id IS NOT NULL OR v_inv.id IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.agenda_sheet_sync_outbox o
       WHERE o.booking_id = p_booking_id
         AND o.event_type IN ('booking_cancelled', 'booking_created', 'booking_cancelled_cleanup')
     ) THEN
    v_has_evidence := true;
  END IF;

  IF NOT v_has_evidence THEN
    RAISE EXCEPTION 'agenda_sheet_enqueue_cancel_cleanup: sin evidencia de sync CRM'
      USING ERRCODE = '22023';
  END IF;

  v_key := p_booking_id::TEXT || ':booking_cancelled_cleanup:v1';

  SELECT o.id INTO v_existing
  FROM public.agenda_sheet_sync_outbox o
  WHERE o.idempotency_key = v_key
     OR (
       o.booking_id = p_booking_id
       AND o.event_type = 'booking_cancelled_cleanup'
       AND o.status IN ('pending', 'processing', 'done')
     )
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already', true,
      'outbox_id', v_existing
    );
  END IF;

  v_payload := jsonb_build_object(
    'organization_id', v_b.organization_id,
    'expediente_id', v_b.expediente_id,
    'kind', v_b.kind,
    'booking_date', v_b.booking_date,
    'booking_time', v_b.booking_time,
    'location_id', v_b.location_id,
    'operation', 'cancel_cleanup_v1',
    'source', 'repair'
  );

  IF v_inv.id IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object(
      'sheet_id', v_inv.sheet_id,
      'sheet_title', v_inv.sheet_title,
      'sheet_row', v_inv.sheet_row,
      'inventory_id', v_inv.id
    );
  ELSIF v_link.id IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object(
      'sheet_id', v_link.sheet_id,
      'sheet_title', v_link.sheet_title,
      'sheet_row', v_link.row_number
    );
  END IF;

  INSERT INTO public.agenda_sheet_sync_outbox (
    organization_id, booking_id, event_type, idempotency_key, payload, status
  ) VALUES (
    v_b.organization_id,
    p_booking_id,
    'booking_cancelled_cleanup',
    v_key,
    v_payload,
    'pending'
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.agenda_sheet_sync_outbox
    WHERE idempotency_key = v_key;
    RETURN jsonb_build_object('ok', true, 'already', true, 'outbox_id', v_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'already', false, 'outbox_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_enqueue_cancel_cleanup(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_enqueue_cancel_cleanup(UUID)
  TO service_role, postgres;

COMMENT ON FUNCTION public.agenda_sheet_enqueue_cancel_cleanup(UUID) IS
  'Encola booking_cancelled_cleanup idempotente para booking cancelled con evidencia CRM; no muta bookings ni Sheets.';
