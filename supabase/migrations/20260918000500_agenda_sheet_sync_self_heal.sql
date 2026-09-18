-- ConCasa CRM — agenda Sheets self-heal para reagendas y coordenadas desplazadas.
-- 1) requeue incluye inscripción;
-- 2) permite mover atómicamente un claim a una fila física válida;
-- 3) permite rebind seguro cuando una reagenda conserva exactamente el mismo slot.

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_reassign_claim(
  p_booking_id UUID,
  p_to_inventory_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.agenda_bookings%ROWTYPE;
  v_old public.agenda_sheet_slot_inventory%ROWTYPE;
  v_target public.agenda_sheet_slot_inventory%ROWTYPE;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_booking_id IS NULL OR p_to_inventory_id IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_reassign_claim: parámetros requeridos'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_booking
  FROM public.agenda_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND OR v_booking.status::TEXT <> 'booked' THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_reassign_claim: booking activo no encontrado'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old
  FROM public.agenda_sheet_slot_inventory
  WHERE booking_id = p_booking_id
    AND status IN ('claimed','linked','conflict')
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_reassign_claim: claim origen no encontrado'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target
  FROM public.agenda_sheet_slot_inventory
  WHERE id = p_to_inventory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_reassign_claim: destino no encontrado'
      USING ERRCODE = '22023';
  END IF;

  IF v_target.id = v_old.id
     OR v_target.status <> 'available'
     OR v_target.booking_id IS NOT NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_reassign_claim: destino no disponible'
      USING ERRCODE = '22023';
  END IF;

  IF v_target.organization_id IS DISTINCT FROM v_booking.organization_id
     OR v_target.booking_date IS DISTINCT FROM v_booking.booking_date
     OR v_target.kind IS DISTINCT FROM v_booking.kind::TEXT
     OR lower(btrim(v_target.location_id)) IS DISTINCT FROM lower(btrim(v_booking.location_id))
     OR v_target.slot_time IS DISTINCT FROM v_booking.booking_time THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_reassign_claim: destino fuera del mismo slot lógico'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_sheet_slot_inventory
  SET
    status = 'disabled',
    booking_id = NULL,
    expediente_id = NULL,
    claimed_at = NULL,
    linked_at = NULL,
    occupancy_source = 'reconciliation',
    visible_nss = NULL,
    visible_name = NULL,
    visible_advisor = NULL,
    last_error = 'stale_coordinate_reassigned',
    updated_at = NOW()
  WHERE id = v_old.id;

  UPDATE public.agenda_sheet_slot_inventory
  SET
    status = 'claimed',
    booking_id = v_booking.id,
    expediente_id = v_booking.expediente_id,
    claimed_at = NOW(),
    linked_at = NULL,
    occupancy_source = 'crm',
    visible_nss = NULL,
    visible_name = NULL,
    visible_advisor = NULL,
    last_error = NULL,
    updated_at = NOW()
  WHERE id = v_target.id;

  UPDATE public.agenda_sheet_sync_outbox
  SET
    payload = payload || jsonb_build_object(
      'sheet_id', v_target.sheet_id,
      'sheet_title', v_target.sheet_title,
      'sheet_row', v_target.sheet_row,
      'inventory_id', v_target.id
    ),
    updated_at = NOW()
  WHERE booking_id = p_booking_id
    AND event_type = 'booking_created'
    AND status IN ('pending','processing','failed','dead');

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload
  ) VALUES (
    v_booking.organization_id, NULL, NULL,
    'agenda.sheet.inventory_coordinate_reassigned',
    'agenda_booking', v_booking.id,
    jsonb_build_object(
      'from_inventory_id', v_old.id,
      'from_sheet_row', v_old.sheet_row,
      'to_inventory_id', v_target.id,
      'to_sheet_row', v_target.sheet_row,
      'booking_date', v_booking.booking_date,
      'kind', v_booking.kind,
      'location_id', v_booking.location_id,
      'booking_time', v_booking.booking_time
    )
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'inventory_id', v_target.id,
    'sheet_id', v_target.sheet_id,
    'sheet_title', v_target.sheet_title,
    'sheet_row', v_target.sheet_row
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_reassign_claim(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_reassign_claim(UUID, UUID)
  TO service_role;


CREATE OR REPLACE FUNCTION public.agenda_sheet_rebind_same_slot_reschedule(
  p_prior_booking_id UUID,
  p_new_booking_id UUID,
  p_sheet_id BIGINT,
  p_sheet_row INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prior public.agenda_bookings%ROWTYPE;
  v_new public.agenda_bookings%ROWTYPE;
  v_target public.agenda_sheet_slot_inventory%ROWTYPE;
  v_link public.agenda_sheet_slot_links%ROWTYPE;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_prior_booking_id IS NULL OR p_new_booking_id IS NULL
     OR p_sheet_id IS NULL OR p_sheet_row IS NULL OR p_sheet_row < 1 THEN
    RAISE EXCEPTION 'agenda_sheet_rebind_same_slot_reschedule: parámetros requeridos'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prior
  FROM public.agenda_bookings
  WHERE id = p_prior_booking_id
  FOR UPDATE;

  SELECT * INTO v_new
  FROM public.agenda_bookings
  WHERE id = p_new_booking_id
  FOR UPDATE;

  IF v_prior.id IS NULL OR v_new.id IS NULL
     OR v_prior.status::TEXT <> 'cancelled'
     OR v_new.status::TEXT <> 'booked'
     OR v_prior.organization_id IS DISTINCT FROM v_new.organization_id
     OR v_prior.expediente_id IS DISTINCT FROM v_new.expediente_id
     OR v_prior.kind IS DISTINCT FROM v_new.kind
     OR v_prior.booking_date IS DISTINCT FROM v_new.booking_date
     OR v_prior.booking_time IS DISTINCT FROM v_new.booking_time
     OR lower(btrim(v_prior.location_id)) IS DISTINCT FROM lower(btrim(v_new.location_id)) THEN
    RAISE EXCEPTION 'agenda_sheet_rebind_same_slot_reschedule: reagenda no es mismo slot/expediente'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link
  FROM public.agenda_sheet_slot_links
  WHERE booking_id = p_prior_booking_id
    AND sheet_id = p_sheet_id
    AND row_number = p_sheet_row
    AND deleted_at IS NULL
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_sheet_rebind_same_slot_reschedule: link previo activo no encontrado'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = v_link.spreadsheet_id
    AND sheet_id = p_sheet_id
    AND sheet_row = p_sheet_row
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_sheet_rebind_same_slot_reschedule: inventario de fila no encontrado'
      USING ERRCODE = '22023';
  END IF;

  IF v_target.booking_id IS NOT NULL
     AND v_target.booking_id NOT IN (p_prior_booking_id, p_new_booking_id) THEN
    RAISE EXCEPTION 'agenda_sheet_rebind_same_slot_reschedule: fila pertenece a otro booking'
      USING ERRCODE = '22023';
  END IF;

  -- El nuevo booking pudo haber reclamado otra coordenada antes de detectar el same-slot.
  UPDATE public.agenda_sheet_slot_inventory
  SET
    status = 'disabled',
    booking_id = NULL,
    expediente_id = NULL,
    claimed_at = NULL,
    linked_at = NULL,
    occupancy_source = 'reconciliation',
    visible_nss = NULL,
    visible_name = NULL,
    visible_advisor = NULL,
    last_error = 'same_slot_rebound_elsewhere',
    updated_at = NOW()
  WHERE booking_id = p_new_booking_id
    AND id <> v_target.id;

  UPDATE public.agenda_sheet_slot_inventory
  SET
    booking_date = v_new.booking_date,
    kind = v_new.kind::TEXT,
    location_id = lower(btrim(v_new.location_id)),
    slot_time = v_new.booking_time,
    status = 'linked',
    booking_id = p_new_booking_id,
    expediente_id = v_new.expediente_id,
    claimed_at = COALESCE(claimed_at, NOW()),
    linked_at = NOW(),
    occupancy_source = 'crm',
    last_error = NULL,
    updated_at = NOW()
  WHERE id = v_target.id;

  UPDATE public.agenda_sheet_slot_links
  SET
    booking_id = p_new_booking_id,
    organization_id = v_new.organization_id,
    sheet_date = v_new.booking_date,
    location_id = lower(btrim(v_new.location_id)),
    kind = v_new.kind,
    slot_time = v_new.booking_time,
    sync_status = 'SINCRONIZADO',
    sync_source = 'crm',
    sync_version = sync_version + 1,
    last_synced_at = NOW(),
    deleted_at = NULL,
    updated_at = NOW()
  WHERE id = v_link.id;

  UPDATE public.agenda_sheet_slot_links
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE booking_id IN (p_prior_booking_id, p_new_booking_id)
    AND id <> v_link.id
    AND deleted_at IS NULL;

  UPDATE public.agenda_sheet_sync_outbox
  SET
    status = 'done',
    last_error = NULL,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE booking_id = p_prior_booking_id
    AND event_type IN ('booking_cancelled','booking_cancelled_cleanup')
    AND status IN ('pending','processing','failed','dead');

  UPDATE public.agenda_sheet_sync_outbox
  SET
    payload = payload || jsonb_build_object(
      'sheet_id', v_link.sheet_id,
      'sheet_title', v_link.sheet_title,
      'sheet_row', v_link.row_number,
      'inventory_id', v_target.id
    ),
    updated_at = NOW()
  WHERE booking_id = p_new_booking_id
    AND event_type = 'booking_created'
    AND status IN ('pending','processing','failed','dead');

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload
  ) VALUES (
    v_new.organization_id, NULL, NULL,
    'agenda.sheet.same_slot_reschedule_rebound',
    'agenda_booking', v_new.id,
    jsonb_build_object(
      'prior_booking_id', p_prior_booking_id,
      'sheet_id', p_sheet_id,
      'sheet_row', p_sheet_row,
      'booking_date', v_new.booking_date,
      'kind', v_new.kind,
      'location_id', v_new.location_id,
      'booking_time', v_new.booking_time
    )
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'inventory_id', v_target.id,
    'sheet_id', v_link.sheet_id,
    'sheet_title', v_link.sheet_title,
    'sheet_row', v_link.row_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_sheet_rebind_same_slot_reschedule(UUID, UUID, BIGINT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_rebind_same_slot_reschedule(UUID, UUID, BIGINT, INTEGER)
  TO service_role;


-- Requeue: incluir inscripción en el mismo mecanismo conservador ya existente.
CREATE OR REPLACE FUNCTION public.agenda_sheet_requeue_dead_sync(
  p_booking_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_created INTEGER := 0;
  v_cancelled INTEGER := 0;
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
    AND b.kind IN ('biometricos', 'firmas', 'inscripcion')
    AND b.booking_date >= CURRENT_DATE
    AND (p_booking_id IS NULL OR o.booking_id = p_booking_id);

  GET DIAGNOSTICS v_created = ROW_COUNT;

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
      AND b.kind IN ('biometricos', 'firmas', 'inscripcion')
      AND (
        NULLIF(btrim(COALESCE(o.payload->>'sheet_row', '')), '') IS NOT NULL
        OR i.id IS NOT NULL
        OR l.id IS NOT NULL
      );

    GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'requeued', v_created + v_cancelled,
    'requeued_created', v_created,
    'requeued_cancelled', v_cancelled
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_sheet_requeue_dead_sync(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_requeue_dead_sync(UUID)
  TO service_role;
