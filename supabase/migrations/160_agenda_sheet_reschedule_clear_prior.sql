-- ConCasa CRM — Hotfix reagendar Sheets: conservar coords al cancelar + prior en create
-- Causa: release_au corre antes que outbox (orden alfabético) y vacía booking_id del
-- inventario; payload cancel sin sheet_row → worker marca done sin batchClear → ghost.
-- Fix: (1) outbox captura coords desde inventario/links ANTES de depender del release;
--      (2) renombrar trigger release para que corra DESPUÉS del outbox;
--      (3) booking_created incluye prior_cancelled_booking_id para gate del worker.
-- No cambia RPCs reagendar_*, etapas, capacidades ni permisos.

CREATE OR REPLACE FUNCTION public.agenda_sheet_outbox_on_booking_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event TEXT;
  v_key TEXT;
  v_payload JSONB;
  v_version TEXT;
  v_sheet_id BIGINT;
  v_sheet_title TEXT;
  v_sheet_row INT;
  v_inventory_id UUID;
  v_had_link BOOLEAN := FALSE;
  v_prior_id UUID;
  v_prior_date DATE;
  v_prior_time TIME;
  v_prior_location TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind NOT IN ('biometricos', 'firmas') THEN
      RETURN NEW;
    END IF;
    IF NEW.status <> 'booked' THEN
      RETURN NEW;
    END IF;
    v_event := 'booking_created';
    v_version := '1';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.kind NOT IN ('biometricos', 'firmas')
       AND OLD.kind NOT IN ('biometricos', 'firmas') THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'booked' AND NEW.status = 'cancelled' THEN
      v_event := 'booking_cancelled';
      v_version := COALESCE(NEW.cancelled_at::TEXT, NEW.updated_at::TEXT, 'c');
    ELSIF OLD.status = 'booked' AND NEW.status = 'booked'
          AND (
            OLD.booking_date IS DISTINCT FROM NEW.booking_date
            OR OLD.booking_time IS DISTINCT FROM NEW.booking_time
            OR OLD.location_id IS DISTINCT FROM NEW.location_id
          ) THEN
      v_event := 'booking_rescheduled';
      v_version := NEW.updated_at::TEXT;
    ELSIF OLD.status = 'booked' AND NEW.status = 'booked'
          AND (
            OLD.note IS DISTINCT FROM NEW.note
            OR OLD.report_group IS DISTINCT FROM NEW.report_group
          ) THEN
      v_event := 'booking_updated';
      v_version := NEW.updated_at::TEXT;
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- 1) Inventario aún ligado (outbox corre antes del release gracias a z_ trigger)
  SELECT i.id, i.sheet_id, i.sheet_title, i.sheet_row
  INTO v_inventory_id, v_sheet_id, v_sheet_title, v_sheet_row
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.booking_id = NEW.id
  LIMIT 1;

  IF v_inventory_id IS NOT NULL THEN
    v_had_link := TRUE;
  END IF;

  -- 2) Link activo
  IF v_sheet_row IS NULL THEN
    SELECT l.sheet_id, l.sheet_title, l.row_number
    INTO v_sheet_id, v_sheet_title, v_sheet_row
    FROM public.agenda_sheet_slot_links l
    WHERE l.booking_id = NEW.id
      AND l.deleted_at IS NULL
    ORDER BY l.updated_at DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN
      v_had_link := TRUE;
    END IF;
  END IF;

  -- 3) Soft-deleted link
  IF v_sheet_row IS NULL THEN
    SELECT l.sheet_id, l.sheet_title, l.row_number
    INTO v_sheet_id, v_sheet_title, v_sheet_row
    FROM public.agenda_sheet_slot_links l
    WHERE l.booking_id = NEW.id
      AND l.deleted_at IS NOT NULL
    ORDER BY l.deleted_at DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN
      v_had_link := TRUE;
    END IF;
  END IF;

  IF NOT v_had_link THEN
    SELECT EXISTS (
      SELECT 1 FROM public.agenda_sheet_slot_links l WHERE l.booking_id = NEW.id
    ) INTO v_had_link;
  END IF;

  v_key := NEW.id::TEXT || ':' || v_event || ':' || v_version;
  v_payload := jsonb_build_object(
    'booking_id', NEW.id,
    'organization_id', NEW.organization_id,
    'kind', NEW.kind,
    'status', NEW.status,
    'booking_date', NEW.booking_date,
    'booking_time', NEW.booking_time,
    'location_id', NEW.location_id,
    'expediente_id', NEW.expediente_id,
    'event_type', v_event,
    'sync_source', 'crm',
    'sheet_id', v_sheet_id,
    'sheet_title', v_sheet_title,
    'sheet_row', v_sheet_row,
    'inventory_id', v_inventory_id,
    'had_sheet_link', v_had_link
  );

  IF v_event = 'booking_created' THEN
    SELECT b.id, b.booking_date, b.booking_time, b.location_id
    INTO v_prior_id, v_prior_date, v_prior_time, v_prior_location
    FROM public.agenda_bookings b
    WHERE b.expediente_id = NEW.expediente_id
      AND b.kind = NEW.kind
      AND b.status = 'cancelled'
      AND b.id IS DISTINCT FROM NEW.id
      AND b.cancelled_at IS NOT NULL
      AND b.cancelled_at > NOW() - INTERVAL '2 hours'
    ORDER BY b.cancelled_at DESC
    LIMIT 1;

    IF v_prior_id IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object(
        'prior_cancelled_booking_id', v_prior_id,
        'prior_booking_date', v_prior_date,
        'prior_booking_time', v_prior_time,
        'prior_location_id', v_prior_location,
        'reschedule_move', true
      );
    END IF;
  END IF;

  IF v_event = 'booking_cancelled' THEN
    v_payload := v_payload || jsonb_build_object(
      'old_booking_date', NEW.booking_date,
      'old_booking_time', NEW.booking_time,
      'old_location_id', NEW.location_id
    );
  END IF;

  INSERT INTO public.agenda_sheet_sync_outbox (
    organization_id, booking_id, event_type, idempotency_key, payload
  ) VALUES (
    NEW.organization_id, NEW.id, v_event, v_key, v_payload
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.agenda_sheet_outbox_on_booking_change() IS
  'Outbox CRM→Sheets; cancel captura sheet_* desde inventario/links; create adjunta prior_cancelled_booking_id en reagenda.';

DROP TRIGGER IF EXISTS agenda_sheet_inventory_release_au ON public.agenda_bookings;
DROP TRIGGER IF EXISTS z_agenda_sheet_inventory_release_au ON public.agenda_bookings;

CREATE TRIGGER z_agenda_sheet_inventory_release_au
  AFTER UPDATE ON public.agenda_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.agenda_sheet_inventory_release_au();

COMMENT ON TRIGGER z_agenda_sheet_inventory_release_au ON public.agenda_bookings IS
  'Libera inventario CRM tras cancel; nombre z_ para correr DESPUÉS de agenda_sheet_outbox_aiud.';
