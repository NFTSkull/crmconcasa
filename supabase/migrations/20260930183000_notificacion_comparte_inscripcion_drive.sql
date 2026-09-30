-- Notificación comparte el mismo cupo físico de Inscripción en Drive (Monterrey).
-- El booking conserva kind=notificacion y hora lógica 12:00 en CRM.
-- Solo la proyección física a Google Sheets usa kind=inscripcion y fila 11:00.

CREATE OR REPLACE FUNCTION public.agenda_notificacion_claim_inscripcion_ai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv_id UUID;
  v_location TEXT;
BEGIN
  IF NEW.kind::TEXT <> 'notificacion' OR NEW.status::TEXT <> 'booked' THEN
    RETURN NEW;
  END IF;

  v_location := lower(btrim(COALESCE(NEW.location_id, '')));

  -- Inscripción física existe únicamente en Monterrey. Apodaca conserva
  -- el comportamiento previo de Notificación y no se fuerza a una fila inexistente.
  IF v_location <> 'monterrey' THEN
    RETURN NEW;
  END IF;

  IF NOT public.agenda_sheet_inventory_enforced(NEW.booking_date) THEN
    RETURN NEW;
  END IF;

  IF NOT public.agenda_sheet_inventory_applies(v_location) THEN
    RETURN NEW;
  END IF;

  SELECT i.id
  INTO v_inv_id
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = NEW.organization_id
    AND i.booking_date = NEW.booking_date
    AND i.kind = 'inscripcion'
    AND i.location_id = v_location
    AND i.status = 'available'
    AND (
      i.sheet_slot_time = TIME '11:00'
      OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
    )
  ORDER BY i.sheet_row
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'claimed',
    booking_id = NEW.id,
    expediente_id = NEW.expediente_id,
    claimed_at = NOW(),
    linked_at = NULL,
    occupancy_source = 'crm',
    manual_occupancy_fingerprint = NULL,
    last_error = NULL,
    updated_at = NOW()
  WHERE i.id = v_inv_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aa_agenda_notificacion_claim_inscripcion_ai
  ON public.agenda_bookings;

CREATE TRIGGER aa_agenda_notificacion_claim_inscripcion_ai
AFTER INSERT ON public.agenda_bookings
FOR EACH ROW
WHEN (
  NEW.kind = 'notificacion'::public.booking_kind
  AND NEW.status = 'booked'::public.booking_status
)
EXECUTE FUNCTION public.agenda_notificacion_claim_inscripcion_ai();


CREATE OR REPLACE FUNCTION public.agenda_notificacion_inscripcion_outbox_aiu()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event TEXT;
  v_version TEXT;
  v_key TEXT;
  v_payload JSONB;
  v_inventory_id UUID;
  v_sheet_id BIGINT;
  v_sheet_title TEXT;
  v_sheet_row INTEGER;
  v_prior_id UUID;
  v_prior_date DATE;
  v_prior_location TEXT;
  v_location TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind::TEXT <> 'notificacion'
       OR NEW.status::TEXT <> 'booked'
       OR lower(btrim(COALESCE(NEW.location_id, ''))) <> 'monterrey' THEN
      RETURN NEW;
    END IF;

    v_event := 'booking_created';
    v_version := '1';
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.kind::TEXT <> 'notificacion'
       OR OLD.status::TEXT <> 'booked'
       OR NEW.status::TEXT <> 'cancelled'
       OR lower(btrim(COALESCE(OLD.location_id, ''))) <> 'monterrey' THEN
      RETURN NEW;
    END IF;

    v_event := 'booking_cancelled';
    v_version := COALESCE(NEW.cancelled_at::TEXT, NEW.updated_at::TEXT, 'c');
  ELSE
    RETURN NEW;
  END IF;

  v_location := lower(btrim(COALESCE(NEW.location_id, OLD.location_id, 'monterrey')));

  -- En INSERT este trigger corre después de aa_* y ya existe claim.
  -- En CANCEL corre antes de z_agenda_sheet_inventory_release_au.
  SELECT i.id, i.sheet_id, i.sheet_title, i.sheet_row
  INTO v_inventory_id, v_sheet_id, v_sheet_title, v_sheet_row
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.booking_id = NEW.id
  ORDER BY i.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_sheet_row IS NULL THEN
    SELECT l.sheet_id, l.sheet_title, l.row_number
    INTO v_sheet_id, v_sheet_title, v_sheet_row
    FROM public.agenda_sheet_slot_links l
    WHERE l.booking_id = NEW.id
      AND l.deleted_at IS NULL
    ORDER BY l.updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_sheet_row IS NULL THEN
    SELECT l.sheet_id, l.sheet_title, l.row_number
    INTO v_sheet_id, v_sheet_title, v_sheet_row
    FROM public.agenda_sheet_slot_links l
    WHERE l.booking_id = NEW.id
      AND l.deleted_at IS NOT NULL
    ORDER BY l.deleted_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  v_payload := jsonb_build_object(
    'booking_id', NEW.id,
    'organization_id', NEW.organization_id,
    'kind', 'inscripcion',
    'booking_kind', 'notificacion',
    'shared_drive_pool', 'inscripcion',
    'status', NEW.status,
    'booking_date', NEW.booking_date,
    'booking_time', TIME '11:00',
    'actual_booking_time', NEW.booking_time,
    'location_id', v_location,
    'expediente_id', NEW.expediente_id,
    'event_type', v_event,
    'sync_source', 'crm',
    'sheet_id', v_sheet_id,
    'sheet_title', v_sheet_title,
    'sheet_row', v_sheet_row,
    'inventory_id', v_inventory_id,
    'had_sheet_link', (v_sheet_row IS NOT NULL)
  );

  IF v_event = 'booking_created' THEN
    SELECT b.id, b.booking_date, b.location_id
    INTO v_prior_id, v_prior_date, v_prior_location
    FROM public.agenda_bookings b
    WHERE b.expediente_id = NEW.expediente_id
      AND b.kind = 'notificacion'::public.booking_kind
      AND b.status = 'cancelled'::public.booking_status
      AND b.id IS DISTINCT FROM NEW.id
      AND b.cancelled_at IS NOT NULL
      AND b.cancelled_at > NOW() - INTERVAL '2 hours'
    ORDER BY b.cancelled_at DESC
    LIMIT 1;

    IF v_prior_id IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object(
        'prior_cancelled_booking_id', v_prior_id,
        'prior_booking_date', v_prior_date,
        'prior_booking_time', TIME '11:00',
        'prior_location_id', lower(btrim(COALESCE(v_prior_location, 'monterrey'))),
        'reschedule_move', true
      );
    END IF;
  ELSE
    v_payload := v_payload || jsonb_build_object(
      'old_booking_date', NEW.booking_date,
      'old_booking_time', TIME '11:00',
      'old_location_id', v_location
    );
  END IF;

  v_key := NEW.id::TEXT || ':notificacion_shared_inscripcion:' ||
    v_event || ':' || v_version;

  INSERT INTO public.agenda_sheet_sync_outbox (
    organization_id,
    booking_id,
    event_type,
    idempotency_key,
    payload
  ) VALUES (
    NEW.organization_id,
    NEW.id,
    v_event,
    v_key,
    v_payload
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ab_agenda_notificacion_inscripcion_outbox_aiu
  ON public.agenda_bookings;

CREATE TRIGGER ab_agenda_notificacion_inscripcion_outbox_aiu
AFTER INSERT OR UPDATE ON public.agenda_bookings
FOR EACH ROW
EXECUTE FUNCTION public.agenda_notificacion_inscripcion_outbox_aiu();

COMMENT ON FUNCTION public.agenda_notificacion_claim_inscripcion_ai() IS
  'Notificación Monterrey conserva kind/hora CRM, pero reclama una fila física de Inscripción 11:00 en Drive.';

COMMENT ON FUNCTION public.agenda_notificacion_inscripcion_outbox_aiu() IS
  'Outbox de Notificación Monterrey proyectada al mismo pool físico Inscripción 11:00 de Google Sheets.';
