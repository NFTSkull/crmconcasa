CREATE OR REPLACE FUNCTION public.agenda_sheet_book_by_nss(p_organization_id uuid, p_spreadsheet_id text, p_sheet_id bigint, p_sheet_title text, p_sheet_date date, p_row_number integer, p_location_id text, p_kind booking_kind, p_slot_time time without time zone, p_slot_ordinal integer, p_nss text, p_scheduled_at timestamp with time zone, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nss TEXT;
  v_exp RECORD;
  v_asesor RECORD;
  v_booking_id UUID;
  v_link_id UUID;
  v_agenda_meta JSONB;
  v_existing_link public.agenda_sheet_slot_links%ROWTYPE;
  v_count_exp INTEGER;
  v_etapa SMALLINT;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_organization_id IS NULL
     OR NULLIF(btrim(COALESCE(p_spreadsheet_id, '')), '') IS NULL
     OR p_sheet_id IS NULL
     OR p_sheet_date IS NULL
     OR p_row_number IS NULL OR p_row_number <= 0
     OR p_slot_ordinal IS NULL OR p_slot_ordinal <= 0
     OR p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: parámetros incompletos'
      USING ERRCODE = '22023';
  END IF;

  IF p_location_id NOT IN ('monterrey', 'apodaca') THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: sede incompatible'
      USING ERRCODE = '22023';
  END IF;

  IF p_kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: tipo incompatible'
      USING ERRCODE = '22023';
  END IF;

  v_nss := public.agenda_sheet_normalize_nss(p_nss);
  IF v_nss IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: NSS inválido'
      USING ERRCODE = '22023';
  END IF;

  -- Fila ya vinculada
  SELECT * INTO v_existing_link
  FROM public.agenda_sheet_slot_links l
  WHERE l.spreadsheet_id = btrim(p_spreadsheet_id)
    AND l.sheet_id = p_sheet_id
    AND l.row_number = p_row_number
    AND l.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND AND v_existing_link.booking_id IS NOT NULL THEN
    -- Idempotencia: misma fila + mismo NSS + booking activo → devolver canónicos
    SELECT
      b.id AS booking_id,
      b.status,
      b.kind,
      b.location_id,
      b.booking_date,
      b.booking_time,
      e.id AS expediente_id,
      e.nss,
      e.cliente_nombre,
      e.asesor_id,
      e.etapa_actual,
      COALESCE(NULLIF(btrim(p.full_name), ''), p.email, '') AS asesor_nombre
    INTO v_exp
    FROM public.agenda_bookings b
    JOIN public.expedientes e ON e.id = b.expediente_id
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
    WHERE b.id = v_existing_link.booking_id;

    IF FOUND
       AND v_exp.status = 'booked'
       AND public.agenda_sheet_normalize_nss(v_exp.nss) = v_nss
       AND v_existing_link.organization_id = p_organization_id THEN
      RETURN jsonb_build_object(
        'ok', true,
        'already', true,
        'booking_id', v_exp.booking_id,
        'link_id', v_existing_link.id,
        'expediente_id', v_exp.expediente_id,
        'nss', v_nss,
        'cliente_nombre', v_exp.cliente_nombre,
        'asesor_id', v_exp.asesor_id,
        'asesor_nombre', v_exp.asesor_nombre,
        'kind', v_exp.kind,
        'location_id', v_exp.location_id,
        'booking_date', v_exp.booking_date,
        'booking_time', to_char(v_exp.booking_time, 'HH24:MI'),
        'slot_ordinal', v_existing_link.slot_ordinal,
        'sync_status', v_existing_link.sync_status,
        'etapa_actual', v_exp.etapa_actual
      );
    END IF;

    RAISE EXCEPTION 'agenda_sheet_book_by_nss: Este espacio ya fue reservado en el CRM.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count_exp
  FROM public.expedientes e
  WHERE e.organization_id = p_organization_id
    AND e.nss = v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo';

  IF v_count_exp = 0 THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_count_exp > 1 THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.cliente_nombre,
    e.nss
  INTO v_exp
  FROM public.expedientes e
  WHERE e.organization_id = p_organization_id
    AND e.nss = v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo'
  FOR UPDATE;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.id, p.full_name, p.email
  INTO v_asesor
  FROM public.profiles p
  WHERE p.id = v_exp.asesor_id;

  IF p_kind = 'biometricos' THEN
    IF v_exp.etapa_actual NOT IN (3, 4, 5) THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp.id AND b.kind = 'biometricos' AND b.status = 'booked'
    ) OR EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp.id AND b.kind = 'notificacion' AND b.status = 'booked'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: La cita ya existe en otra fila u horario.'
        USING ERRCODE = '22023';
    END IF;
    IF v_exp.etapa_actual = 5 THEN
      IF v_exp.subestado <> 'en_proceso' THEN
        RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
          USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.agenda_bookings b
        WHERE b.expediente_id = v_exp.id AND b.kind = 'biometricos' AND b.status = 'cancelled'
          AND b.id = (
            SELECT b2.id FROM public.agenda_bookings b2
            WHERE b2.expediente_id = v_exp.id AND b2.kind = 'biometricos'
            ORDER BY b2.created_at DESC LIMIT 1
          )
      ) THEN
        RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    v_agenda_meta := public.agenda_biometricos_assert_slot_available(
      v_exp.organization_id, p_scheduled_at, p_location_id
    );
  ELSE
    IF v_exp.etapa_actual NOT IN (9, 10) OR v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp.id AND b.kind = 'firmas' AND b.status = 'booked'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: La cita ya existe en otra fila u horario.'
        USING ERRCODE = '22023';
    END IF;
    PERFORM public.agenda_firmas_assert_agendable_desde(
      v_exp.id, p_scheduled_at, p_location_id
    );
    v_agenda_meta := public.agenda_firmas_assert_slot_available(
      v_exp.organization_id, p_scheduled_at, p_location_id
    );
  END IF;

  -- Verifica que date/time del assert coincidan con la fila
  IF (v_agenda_meta->>'booking_date')::DATE IS DISTINCT FROM p_sheet_date
     OR (v_agenda_meta->>'booking_time')::TIME IS DISTINCT FROM p_slot_time THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: horario de fila no coincide con slot CRM'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    v_exp.organization_id, p_kind, v_exp.id,
    (v_agenda_meta->>'booking_date')::DATE,
    (v_agenda_meta->>'booking_time')::TIME,
    p_location_id, 'booked',
    'origen=google_sheets',
    v_exp.asesor_id
  )
  RETURNING id INTO v_booking_id;

  UPDATE public.expedientes
  SET fecha_cita = p_scheduled_at, updated_at = NOW()
  WHERE id = v_exp.id;

  v_etapa := v_exp.etapa_actual;
  IF p_kind = 'biometricos' AND v_exp.etapa_actual = 3 THEN
    UPDATE public.expedientes
    SET etapa_actual = 4, subestado = 'en_proceso', updated_at = NOW()
    WHERE id = v_exp.id;
    v_etapa := 4;
  END IF;

  INSERT INTO public.agenda_sheet_slot_links (
    organization_id, spreadsheet_id, sheet_id, sheet_title, sheet_date,
    row_number, location_id, kind, slot_time, slot_ordinal,
    booking_id, sync_status, sync_version, sync_source, last_synced_at
  ) VALUES (
    v_exp.organization_id, btrim(p_spreadsheet_id), p_sheet_id,
    COALESCE(NULLIF(btrim(p_sheet_title), ''), p_sheet_date::TEXT),
    p_sheet_date, p_row_number, p_location_id, p_kind, p_slot_time, p_slot_ordinal,
    v_booking_id, 'SINCRONIZADO', 1, 'sheets', NOW()
  )
  ON CONFLICT (spreadsheet_id, sheet_id, row_number) DO UPDATE
  SET
    booking_id = EXCLUDED.booking_id,
    location_id = EXCLUDED.location_id,
    kind = EXCLUDED.kind,
    slot_time = EXCLUDED.slot_time,
    slot_ordinal = EXCLUDED.slot_ordinal,
    sheet_date = EXCLUDED.sheet_date,
    sheet_title = EXCLUDED.sheet_title,
    sync_status = 'SINCRONIZADO',
    sync_source = 'sheets',
    last_synced_at = NOW(),
    sync_version = public.agenda_sheet_slot_links.sync_version + 1,
    deleted_at = NULL,
    updated_at = NOW()
  RETURNING id INTO v_link_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_exp.asesor_id,
    'asesor'::public.app_role,
    'agenda.sheet.book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'source', 'google_sheets',
      'nss', v_nss,
      'kind', p_kind,
      'location_id', p_location_id,
      'row_number', p_row_number,
      'sheet_id', p_sheet_id,
      'slot_ordinal', p_slot_ordinal,
      'link_id', v_link_id,
      'idempotency_key', p_idempotency_key,
      'etapa_actual', v_etapa
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'link_id', v_link_id,
    'expediente_id', v_exp.id,
    'nss', v_nss,
    'cliente_nombre', v_exp.cliente_nombre,
    'asesor_id', v_exp.asesor_id,
    'asesor_nombre', COALESCE(v_asesor.full_name, v_asesor.email, ''),
    'kind', p_kind,
    'location_id', p_location_id,
    'booking_date', (v_agenda_meta->>'booking_date'),
    'booking_time', to_char((v_agenda_meta->>'booking_time')::TIME, 'HH24:MI'),
    'slot_ordinal', p_slot_ordinal,
    'sync_status', 'SINCRONIZADO',
    'etapa_actual', v_etapa
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: Este espacio ya fue reservado en el CRM.'
      USING ERRCODE = '22023';
END;
$function$

