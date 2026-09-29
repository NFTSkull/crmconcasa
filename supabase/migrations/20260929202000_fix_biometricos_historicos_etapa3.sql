-- ConCasa CRM — corregir citas biométricas históricas que bloquean etapa 3
-- Caso observado: expediente reingresa, Mesa lo deja en etapa 3, pero una cita vieja
-- sigue status=booked. El asesor no lo ve en "Agendar biométricos" y book_biometricos
-- rechaza la nueva cita por creer que la histórica sigue activa.
--
-- Alcance:
-- 1) En etapa 3, una cita biométrica booked de fecha anterior a hoy ya no bloquea el chip.
-- 2) Al agendar desde etapa 3, book_biometricos autocierra cualquier booked histórica.
-- 3) Se corrigen los casos actualmente atascados (solo activos/en_proceso/etapa 3).
--    Los UPDATE de agenda_bookings conservan los triggers existentes de outbox/Drive.

CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_agendar_biometricos(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT coalesce(p_submitted_to_mesa, false) THEN false
    WHEN NOT public.asesor_inbox_es_accionable(p_expediente_id) THEN false
    WHEN public.asesor_inbox_latest_booking_status(p_expediente_id, 'notificacion') = 'booked'
      THEN false
    WHEN p_etapa_actual = 3 THEN
      NOT EXISTS (
        SELECT 1
        FROM public.agenda_bookings b
        WHERE b.expediente_id = p_expediente_id
          AND b.kind = 'biometricos'
          AND b.status = 'booked'
          AND b.booking_date >= (clock_timestamp() AT TIME ZONE 'America/Monterrey')::date
      )
    WHEN public.asesor_inbox_latest_booking_status(p_expediente_id, 'biometricos') = 'booked'
      THEN false
    WHEN p_etapa_actual IN (4, 5) THEN
      public.asesor_inbox_latest_booking_status(p_expediente_id, 'biometricos') = 'cancelled'
    ELSE false
  END;
$function$;

COMMENT ON FUNCTION public.asesor_inbox_pendiente_agendar_biometricos(BOOLEAN, SMALLINT, UUID) IS
  'Etapa 3: booked biométrico histórico (fecha < hoy MTY) no bloquea Agendar biométricos. Etapas 4/5 conservan lógica de reagenda.';

CREATE OR REPLACE FUNCTION public.book_biometricos(
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_booking_id UUID;
  v_location_id TEXT;
  v_note TEXT;
  v_booking_date DATE;
  v_booking_time TIME;
  v_kind public.booking_kind := 'biometricos';
  v_status public.booking_status := 'booked';
  v_agenda_meta JSONB;
  v_etapa_actual SMALLINT;
  v_stale_booking_id UUID;
  v_stale_booking_date DATE;
  v_today_mty DATE := (clock_timestamp() AT TIME ZONE 'America/Monterrey')::date;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_biometricos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'book_biometricos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: scheduled_at es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'book_biometricos: la cita debe ser en fecha/hora futura'
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
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_biometricos: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_biometricos: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'book_biometricos: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'book_biometricos: solo el asesor dueño puede agendar biométricos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'book_biometricos: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'book_biometricos: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (3, 4, 5) THEN
    RAISE EXCEPTION 'book_biometricos: solo se puede agendar en etapa 3, 4 o 5 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  -- En etapa 3, una cita booked anterior a hoy es histórica/stale y no debe
  -- bloquear el nuevo agendamiento. Citas de hoy o futuras sí siguen bloqueando.
  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = v_kind
      AND b.status = 'booked'
      AND NOT (
        v_exp.etapa_actual = 3
        AND b.booking_date < v_today_mty
      )
  ) THEN
    RAISE EXCEPTION 'book_biometricos: ya existe una cita biométrica activa para este expediente'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'notificacion'
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_biometricos: ya existe una notificación activa para este expediente'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual = 5 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'book_biometricos: etapa 5 requiere subestado en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.agenda_bookings b
      WHERE b.expediente_id = p_expediente_id
        AND b.kind = v_kind
        AND b.status = 'cancelled'
        AND b.id = (
          SELECT b2.id
          FROM public.agenda_bookings b2
          WHERE b2.expediente_id = p_expediente_id
            AND b2.kind = v_kind
          ORDER BY b2.created_at DESC
          LIMIT 1
        )
    ) THEN
      RAISE EXCEPTION 'book_biometricos: etapa 5 requiere que la última cita biométrica esté cancelada'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM public.assert_expediente_vigencia_documental_ok(p_expediente_id);
  v_agenda_meta := public.agenda_biometricos_assert_slot_available(
    v_exp.organization_id,
    p_scheduled_at,
    v_location_id
  );

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;
  v_etapa_actual := v_exp.etapa_actual;

  -- El slot nuevo ya fue validado. Antes del INSERT, liberar el único booked
  -- histórico posible para no chocar con el índice unique de cita activa.
  IF v_exp.etapa_actual = 3 THEN
    SELECT b.id, b.booking_date
    INTO v_stale_booking_id, v_stale_booking_date
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = v_kind
      AND b.status = 'booked'
      AND b.booking_date < v_today_mty
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.agenda_bookings
      SET
        status = 'cancelled',
        cancelled_at = NOW(),
        note = CASE
          WHEN note IS NULL OR btrim(note) = '' THEN
            'Auto-cierre técnico: cita biométrica histórica; expediente etapa 3 listo para reagendar.'
          ELSE
            note || E'\nAuto-cierre técnico: cita biométrica histórica; expediente etapa 3 listo para reagendar.'
        END
      WHERE id = v_stale_booking_id;

      UPDATE public.expedientes
      SET fecha_cita = NULL, updated_at = NOW()
      WHERE id = p_expediente_id;

      PERFORM public.log_action(
        v_exp.organization_id,
        v_actor_id,
        v_actor_role,
        'agenda.biometricos.stale_autoclose',
        'agenda_booking',
        v_stale_booking_id,
        jsonb_build_object(
          'expediente_id', p_expediente_id,
          'booking_id', v_stale_booking_id,
          'booking_date', v_stale_booking_date,
          'reason', 'stage3_historical_booked_before_new_booking'
        )
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.agenda_bookings (
      organization_id,
      kind,
      expediente_id,
      booking_date,
      booking_time,
      location_id,
      status,
      note,
      created_by
    ) VALUES (
      v_exp.organization_id,
      v_kind,
      p_expediente_id,
      v_booking_date,
      v_booking_time,
      v_location_id,
      v_status,
      v_note,
      v_actor_id
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'book_biometricos: ya existe una cita biométrica activa para este expediente'
        USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET
    fecha_cita = p_scheduled_at,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  IF v_exp.etapa_actual = 3 THEN
    UPDATE public.expedientes
    SET etapa_actual = 4, updated_at = NOW()
    WHERE id = p_expediente_id;
    v_etapa_actual := 4;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.biometricos.book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'asesor_id', v_exp.asesor_id,
      'organization_id', v_exp.organization_id,
      'scheduled_at', p_scheduled_at,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'note', v_note,
      'booking_kind', v_kind,
      'booking_status', v_status,
      'agenda_config_applied', true,
      'capacity_per_slot', v_agenda_meta->'capacity_per_slot',
      'booked_count_before', v_agenda_meta->'booked_count_before'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'expediente_id', p_expediente_id,
    'scheduled_at', p_scheduled_at,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'status', v_status,
    'kind', v_kind,
    'etapa_actual', v_etapa_actual
  );
END;
$function$;

-- Reparación de los casos que ya están atascados.
-- Solo se tocan expedientes que el propio estado operativo declara:
-- etapa 3 + en_proceso + activo + enviado a Mesa.
DO $repair$
DECLARE
  v RECORD;
BEGIN
  FOR v IN
    SELECT
      b.id AS booking_id,
      b.expediente_id,
      b.booking_date,
      b.booking_time,
      b.location_id,
      e.organization_id
    FROM public.agenda_bookings b
    JOIN public.expedientes e ON e.id = b.expediente_id
    WHERE b.kind = 'biometricos'
      AND b.status = 'booked'
      AND b.booking_date < (clock_timestamp() AT TIME ZONE 'America/Monterrey')::date
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa IS TRUE
      AND e.etapa_actual = 3
      AND e.subestado = 'en_proceso'
    ORDER BY b.booking_date, b.id
    FOR UPDATE OF b
  LOOP
    UPDATE public.agenda_bookings
    SET
      status = 'cancelled',
      cancelled_at = NOW(),
      note = CASE
        WHEN note IS NULL OR btrim(note) = '' THEN
          'Auto-cierre técnico: cita biométrica histórica; expediente etapa 3 listo para reagendar.'
        ELSE
          note || E'\nAuto-cierre técnico: cita biométrica histórica; expediente etapa 3 listo para reagendar.'
      END
    WHERE id = v.booking_id
      AND status = 'booked';

    UPDATE public.expedientes
    SET fecha_cita = NULL, updated_at = NOW()
    WHERE id = v.expediente_id
      AND etapa_actual = 3
      AND subestado = 'en_proceso';

    PERFORM public.log_action(
      v.organization_id,
      NULL,
      NULL,
      'agenda.biometricos.stale_repair',
      'agenda_booking',
      v.booking_id,
      jsonb_build_object(
        'expediente_id', v.expediente_id,
        'booking_id', v.booking_id,
        'booking_date', v.booking_date,
        'booking_time', v.booking_time,
        'location_id', v.location_id,
        'reason', 'stage3_historical_booked_repair'
      )
    );
  END LOOP;
END
$repair$;
