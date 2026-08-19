-- ConCasa CRM — P200: read-model sync CRM→Sheets (sin exponer outbox)
-- Causa: UI afirmaba "reagendada correctamente" tras RPC CRM aunque Drive
-- no estuviera escrito. RPC STABLE de solo lectura para PENDING/SYNCED/FAILED.
-- No muta bookings, outbox, links ni Sheets. No modifica 129/130/160.

CREATE OR REPLACE FUNCTION public.agenda_booking_sheet_sync_status(
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role public.app_role;
  v_active BOOLEAN;
  v_exp UUID;
  v_link_synced BOOLEAN := FALSE;
  v_inv_linked BOOLEAN := FALSE;
  v_last_synced TIMESTAMPTZ;
  v_pending BOOLEAN := FALSE;
  v_dead BOOLEAN := FALSE;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL OR p_booking_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT p.app_role, p.active
    INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF v_role NOT IN (
    'asesor', 'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT b.expediente_id
    INTO v_exp
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF NOT public.can_see_expediente(v_exp) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_sheet_slot_links l
    WHERE l.booking_id = p_booking_id
      AND l.deleted_at IS NULL
      AND upper(btrim(l.sync_status)) IN ('SINCRONIZADO', 'SYNCED')
  )
  INTO v_link_synced;

  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.booking_id = p_booking_id
      AND i.status = 'linked'
  )
  INTO v_inv_linked;

  SELECT COALESCE(
    (
      SELECT max(l.last_synced_at)
      FROM public.agenda_sheet_slot_links l
      WHERE l.booking_id = p_booking_id
    ),
    (
      SELECT i.updated_at
      FROM public.agenda_sheet_slot_inventory i
      WHERE i.booking_id = p_booking_id
        AND i.status = 'linked'
      LIMIT 1
    )
  )
  INTO v_last_synced;

  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_sheet_sync_outbox o
    WHERE o.booking_id = p_booking_id
      AND o.event_type IN ('booking_created', 'booking_updated')
      AND o.status IN ('pending', 'processing', 'failed')
  )
  INTO v_pending;

  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_sheet_sync_outbox o
    WHERE o.booking_id = p_booking_id
      AND o.event_type IN ('booking_created', 'booking_updated')
      AND o.status = 'dead'
      AND NOT EXISTS (
        SELECT 1
        FROM public.agenda_sheet_sync_outbox d
        WHERE d.booking_id = p_booking_id
          AND d.event_type = o.event_type
          AND d.status = 'done'
      )
  )
  INTO v_dead;

  IF (v_link_synced OR v_inv_linked) AND NOT v_pending AND NOT v_dead THEN
    v_status := 'SYNCED';
  ELSIF v_dead AND NOT v_link_synced AND NOT v_inv_linked THEN
    v_status := 'FAILED';
  ELSIF v_pending THEN
    v_status := 'PENDING';
  ELSIF v_link_synced OR v_inv_linked THEN
    v_status := 'SYNCED';
  ELSE
    v_status := 'PENDING';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'sync_status', v_status,
    'last_synced_at', v_last_synced,
    'sync_pending', (v_status = 'PENDING'),
    'sync_error', (v_status = 'FAILED')
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_booking_sheet_sync_status(UUID) IS
  'P200 read-model sync CRM→Sheets: PENDING/SYNCED/FAILED. Asesor dueño / Mesa / super_admin. Sin payload outbox ni secretos.';

REVOKE ALL ON FUNCTION public.agenda_booking_sheet_sync_status(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_booking_sheet_sync_status(UUID)
  TO authenticated, service_role, postgres;
