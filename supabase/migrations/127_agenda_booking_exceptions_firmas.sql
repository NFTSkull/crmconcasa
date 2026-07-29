-- ConCasa CRM — Excepción auditada one-time para booking de firmas (gate 5 días)
-- No altera la regla general; no cambia capacidad; no toca Sheets.

CREATE TABLE IF NOT EXISTS public.agenda_booking_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind = 'firmas'),
  location_id TEXT NOT NULL,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  granted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ NULL,
  booking_id UUID NULL REFERENCES public.agenda_bookings(id) ON DELETE SET NULL,
  CONSTRAINT agenda_booking_exceptions_location_chk
    CHECK (location_id = ANY (ARRAY['monterrey', 'apodaca']))
);

CREATE UNIQUE INDEX IF NOT EXISTS agenda_booking_exceptions_pending_uq
  ON public.agenda_booking_exceptions (
    organization_id, expediente_id, kind, location_id, booking_date, booking_time
  )
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS agenda_booking_exceptions_exp_idx
  ON public.agenda_booking_exceptions (expediente_id, used_at);

COMMENT ON TABLE public.agenda_booking_exceptions IS
  'Excepciones one-time auditadas al gate firma_agendable_desde. No crean cita por sí solas.';

ALTER TABLE public.agenda_booking_exceptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agenda_booking_exceptions FROM PUBLIC;
REVOKE ALL ON TABLE public.agenda_booking_exceptions FROM anon;
REVOKE ALL ON TABLE public.agenda_booking_exceptions FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agenda_booking_exceptions TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_firmas_find_pending_exception(
  p_organization_id UUID,
  p_expediente_id UUID,
  p_location_id TEXT,
  p_booking_date DATE,
  p_booking_time TIME
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.id
  FROM public.agenda_booking_exceptions x
  WHERE x.organization_id = p_organization_id
    AND x.expediente_id = p_expediente_id
    AND x.kind = 'firmas'
    AND x.location_id = p_location_id
    AND x.booking_date = p_booking_date
    AND x.booking_time = p_booking_time
    AND x.used_at IS NULL
  ORDER BY x.granted_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.agenda_firmas_find_pending_exception(UUID, UUID, TEXT, DATE, TIME) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agenda_firmas_find_pending_exception(UUID, UUID, TEXT, DATE, TIME) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_find_pending_exception(UUID, UUID, TEXT, DATE, TIME)
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_firmas_consume_booking_exception(
  p_organization_id UUID,
  p_expediente_id UUID,
  p_location_id TEXT,
  p_booking_date DATE,
  p_booking_time TIME,
  p_booking_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT x.id INTO v_id
  FROM public.agenda_booking_exceptions x
  WHERE x.organization_id = p_organization_id
    AND x.expediente_id = p_expediente_id
    AND x.kind = 'firmas'
    AND x.location_id = p_location_id
    AND x.booking_date = p_booking_date
    AND x.booking_time = p_booking_time
    AND x.used_at IS NULL
  ORDER BY x.granted_at ASC
  FOR UPDATE
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.agenda_booking_exceptions
  SET used_at = now(), booking_id = p_booking_id
  WHERE id = v_id AND used_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_firmas_consume_booking_exception(UUID, UUID, TEXT, DATE, TIME, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agenda_firmas_consume_booking_exception(UUID, UUID, TEXT, DATE, TIME, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_consume_booking_exception(UUID, UUID, TEXT, DATE, TIME, UUID)
  TO service_role, postgres;

DROP FUNCTION IF EXISTS public.agenda_firmas_assert_agendable_desde(UUID, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.agenda_firmas_assert_agendable_desde(
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_desde DATE;
  v_org UUID;
  v_local_date DATE;
  v_local_time TIME;
  v_loc TEXT;
  v_exc UUID;
BEGIN
  IF p_expediente_id IS NULL OR p_scheduled_at IS NULL THEN
    RETURN;
  END IF;

  SELECT e.firma_agendable_desde, e.organization_id
  INTO v_desde, v_org
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_desde IS NULL THEN
    RETURN;
  END IF;

  v_local_date := (p_scheduled_at AT TIME ZONE 'America/Monterrey')::DATE;
  v_local_time := (p_scheduled_at AT TIME ZONE 'America/Monterrey')::TIME;

  IF v_local_date >= v_desde THEN
    RETURN;
  END IF;

  v_loc := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_loc IS NOT NULL AND v_org IS NOT NULL THEN
    v_exc := public.agenda_firmas_find_pending_exception(
      v_org, p_expediente_id, v_loc, v_local_date, v_local_time
    );
    IF v_exc IS NOT NULL THEN
      RETURN;
    END IF;
  END IF;

  RAISE EXCEPTION 'agenda_firmas: la firma solo puede agendarse desde %', v_desde
    USING ERRCODE = '22023';
END;
$$;

COMMENT ON FUNCTION public.agenda_firmas_assert_agendable_desde(UUID, TIMESTAMPTZ, TEXT) IS
  'Gate firma_agendable_desde; excepción one-time pendiente puede omitirlo.';

REVOKE ALL ON FUNCTION public.agenda_firmas_assert_agendable_desde(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agenda_firmas_assert_agendable_desde(UUID, TIMESTAMPTZ, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_assert_agendable_desde(UUID, TIMESTAMPTZ, TEXT)
  TO service_role, postgres;


CREATE OR REPLACE FUNCTION public.super_admin_grant_booking_exception(
  p_expediente_id UUID,
  p_kind TEXT,
  p_location_id TEXT,
  p_booking_date DATE,
  p_booking_time TIME,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_exp RECORD;
  v_loc TEXT;
  v_kind TEXT;
  v_reason TEXT;
  v_id UUID;
  v_existing UUID;
BEGIN
  v_actor := public.__admin_require_super_admin();
  SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id = v_actor;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_booking_exception: organización del actor no disponible'
      USING ERRCODE = '22023';
  END IF;

  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind IS DISTINCT FROM 'firmas' THEN
    RAISE EXCEPTION 'admin_booking_exception: solo kind=firmas'
      USING ERRCODE = '22023';
  END IF;

  v_loc := lower(btrim(COALESCE(p_location_id, '')));
  IF v_loc IS NULL OR v_loc NOT IN ('monterrey', 'apodaca') THEN
    RAISE EXCEPTION 'admin_booking_exception: location_id inválida'
      USING ERRCODE = '22023';
  END IF;

  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RAISE EXCEPTION 'admin_booking_exception: fecha/hora obligatorias'
      USING ERRCODE = '22023';
  END IF;

  v_reason := btrim(COALESCE(p_reason, ''));
  IF length(v_reason) < 10 THEN
    RAISE EXCEPTION 'admin_booking_exception: motivo obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.id, e.organization_id, e.etapa_actual, e.ciclo_estado, e.subestado,
         e.deleted_at, e.firma_agendable_desde
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'admin_booking_exception: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'admin_booking_exception: expediente fuera de organización'
      USING ERRCODE = '42501';
  END IF;
  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'admin_booking_exception: ciclo no activo' USING ERRCODE = '22023';
  END IF;
  IF v_exp.subestado = 'rechazado' THEN
    RAISE EXCEPTION 'admin_booking_exception: rechazo activo' USING ERRCODE = '22023';
  END IF;
  IF v_exp.etapa_actual IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'admin_booking_exception: requiere etapa interna 9 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id AND b.kind = 'firmas'
      AND b.status = 'booked' AND b.cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'admin_booking_exception: ya existe booking firmas activo'
      USING ERRCODE = '22023';
  END IF;

  v_existing := public.agenda_firmas_find_pending_exception(
    v_org, p_expediente_id, v_loc, p_booking_date, p_booking_time
  );
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'exception_id', v_existing, 'already_granted', true,
      'firma_agendable_desde', v_exp.firma_agendable_desde
    );
  END IF;

  INSERT INTO public.agenda_booking_exceptions (
    organization_id, expediente_id, kind, location_id, booking_date, booking_time, reason, granted_by
  ) VALUES (
    v_org, p_expediente_id, 'firmas', v_loc, p_booking_date, p_booking_time, v_reason, v_actor
  ) RETURNING id INTO v_id;

  PERFORM public.log_action(
    v_org, v_actor, 'super_admin'::public.app_role,
    'agenda.firmas.exception_grant', 'agenda_booking_exception', v_id,
    jsonb_build_object(
      'exception_id', v_id, 'expediente_id', p_expediente_id, 'kind', 'firmas',
      'location_id', v_loc, 'booking_date', p_booking_date, 'booking_time', p_booking_time,
      'reason', v_reason, 'firma_agendable_desde', v_exp.firma_agendable_desde
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'exception_id', v_id, 'already_granted', false,
    'firma_agendable_desde', v_exp.firma_agendable_desde
  );
END;
$$;

COMMENT ON FUNCTION public.super_admin_grant_booking_exception(UUID, TEXT, TEXT, DATE, TIME, TEXT) IS
  'Super Admin: excepción one-time al gate de 5 días para un slot firmas exacto.';

REVOKE ALL ON FUNCTION public.super_admin_grant_booking_exception(UUID, TEXT, TEXT, DATE, TIME, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_grant_booking_exception(UUID, TEXT, TEXT, DATE, TIME, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_grant_booking_exception(UUID, TEXT, TEXT, DATE, TIME, TEXT)
  TO authenticated, service_role, postgres;


CREATE OR REPLACE FUNCTION public.book_firmas(p_expediente_id uuid, p_scheduled_at timestamp with time zone, p_location_id text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
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
  v_kind public.booking_kind := 'firmas';
  v_status public.booking_status := 'booked';
  v_agenda_meta JSONB;
  v_etapa_actual SMALLINT;
  v_exc_id UUID;
  v_advanced BOOLEAN := false;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'book_firmas: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_firmas: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('asesor', 'mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'book_firmas: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'book_firmas: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'book_firmas: scheduled_at es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'book_firmas: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'book_firmas: la cita debe ser en fecha/hora futura'
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
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_firmas: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_firmas: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'book_firmas: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'asesor'
     AND v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'book_firmas: solo el asesor dueño puede agendar firma'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role IN ('mesa_admin', 'super_admin')
     AND NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'book_firmas: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'book_firmas: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'book_firmas: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'book_firmas: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'book_firmas: solo se puede agendar en etapa 9 o 10 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = v_kind
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_firmas: ya existe una cita de firma activa para este expediente'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual = 10 THEN
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
      RAISE EXCEPTION 'book_firmas: etapa 10 requiere que la última cita de firma esté cancelada'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM public.agenda_firmas_assert_agendable_desde(
    p_expediente_id,
    p_scheduled_at,
    v_location_id
  );

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_scheduled_at,
    v_location_id
  );

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;
  v_etapa_actual := v_exp.etapa_actual;

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
      RAISE EXCEPTION 'book_firmas: ya existe una cita de firma activa para este expediente'
        USING ERRCODE = '22023';
  END;

  v_exc_id := public.agenda_firmas_consume_booking_exception(
    v_exp.organization_id,
    p_expediente_id,
    v_location_id,
    v_booking_date,
    v_booking_time,
    v_booking_id
  );

  IF v_exc_id IS NOT NULL AND v_etapa_actual = 9 THEN
    UPDATE public.expedientes
    SET
      fecha_cita = p_scheduled_at,
      etapa_actual = 10,
      updated_at = NOW()
    WHERE id = p_expediente_id;
    v_etapa_actual := 10;
    v_advanced := true;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 9,
        'etapa_nueva', 10,
        'booking_id', v_booking_id,
        'exception_id', v_exc_id,
        'transition', '9_10',
        'via', 'booking_exception'
      )
    );
  ELSE
    UPDATE public.expedientes
    SET
      fecha_cita = p_scheduled_at,
      updated_at = NOW()
    WHERE id = p_expediente_id;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'booking_id', v_booking_id,
      'expediente_id', p_expediente_id,
      'scheduled_at', p_scheduled_at,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'etapa_actual', v_etapa_actual,
      'exception_id', v_exc_id,
      'advanced_9_10', v_advanced,
      'no_etapa_change', NOT v_advanced
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking_id,
    'kind', v_kind,
    'scheduled_at', p_scheduled_at,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'fecha_cita', p_scheduled_at,
    'etapa_actual', v_etapa_actual,
    'exception_id', v_exc_id,
    'advanced_9_10', v_advanced,
    'no_etapa_change', NOT v_advanced
  );
END;
$function$;

COMMENT ON FUNCTION public.book_firmas(UUID, TIMESTAMPTZ, TEXT, TEXT) IS
  'Agenda firmas; gate 5 días con excepción one-time opcional; si consume excepción en etapa 9 avanza a 10.';


CREATE OR REPLACE FUNCTION public.mesa_book_firmas(p_expediente_id uuid, p_booking_at timestamp with time zone, p_timezone text, p_location_id text, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_booking_id UUID;
  v_timezone TEXT;
  v_location_id TEXT;
  v_nota TEXT;
  v_agenda_meta JSONB;
  v_booking_date DATE;
  v_booking_time TIME;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: perfil inactivo o rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente_id obligatorio'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_booking_at IS NULL OR p_booking_at <= NOW() THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_DATE: fecha de firma debe ser futura'
      USING ERRCODE = '22023';
  END IF;

  v_timezone := NULLIF(btrim(COALESCE(p_timezone, '')), '');
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_LOCATION: sede obligatoria'
      USING ERRCODE = '22023';
  END IF;
  v_nota := NULLIF(btrim(COALESCE(p_nota, '')), '');

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente no encontrado o no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STATE: expediente no elegible para agenda'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STAGE: solo etapas 9 o 10'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'firmas'
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_ALREADY_BOOKED: ya existe una firma activa'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.agenda_firmas_assert_agendable_desde(
    p_expediente_id,
    p_booking_at,
    v_location_id
  );

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_booking_at,
    v_location_id
  );

  IF v_agenda_meta->>'timezone' IS DISTINCT FROM v_timezone THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone debe coincidir con agenda_config (%)',
      v_agenda_meta->>'timezone'
      USING ERRCODE = '22023';
  END IF;

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;

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
      'firmas',
      p_expediente_id,
      v_booking_date,
      v_booking_time,
      v_location_id,
      'booked',
      v_nota,
      v_actor_id
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_ALREADY_BOOKED: conflicto de firma activa'
      USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET fecha_cita = p_booking_at, updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.mesa_book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'booking_id', v_booking_id,
      'expediente_id', p_expediente_id,
      'booking_at', p_booking_at,
      'timezone', v_timezone,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'etapa_actual', v_exp.etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking_id,
    'booking_at', p_booking_at,
    'timezone', v_timezone,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'etapa_actual', v_exp.etapa_actual
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.reagendar_firmas(p_expediente_id uuid, p_scheduled_at timestamp with time zone, p_location_id text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_booking_anterior_id UUID;
  v_booking_nuevo_id UUID;
  v_location_id TEXT;
  v_note TEXT;
  v_booking_date DATE;
  v_booking_time TIME;
  v_fecha_cita_anterior TIMESTAMPTZ;
  v_kind public.booking_kind := 'firmas';
  v_status public.booking_status := 'booked';
  v_agenda_meta JSONB;
  v_etapa_actual SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_firmas: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('asesor', 'mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'reagendar_firmas: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: scheduled_at es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'reagendar_firmas: la cita debe ser en fecha/hora futura'
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
    e.fecha_cita,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_firmas: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'reagendar_firmas: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'asesor'
     AND v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'reagendar_firmas: solo el asesor dueño puede reagendar firma'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role IN ('mesa_admin', 'super_admin')
     AND NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'reagendar_firmas: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'reagendar_firmas: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'reagendar_firmas: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'reagendar_firmas: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'reagendar_firmas: solo se puede reagendar en etapa 9 o 10 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  SELECT b.id
  INTO v_booking_anterior_id
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = v_kind
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_booking_anterior_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: no hay cita de firma activa para reagendar'
      USING ERRCODE = '22023';
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;
  v_etapa_actual := v_exp.etapa_actual;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN note IS NULL OR btrim(note) = '' THEN 'Reagendada'
      ELSE note || E'\nReagendada'
    END
  WHERE id = v_booking_anterior_id;

  PERFORM public.agenda_firmas_assert_agendable_desde(
    p_expediente_id,
    p_scheduled_at,
    v_location_id
  );

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_scheduled_at,
    v_location_id
  );

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;

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
    RETURNING id INTO v_booking_nuevo_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'reagendar_firmas: conflicto al crear la nueva cita de firma'
        USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET
    fecha_cita = p_scheduled_at,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.reagendar',
    'agenda_booking',
    v_booking_nuevo_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'old_booking_id', v_booking_anterior_id,
      'new_booking_id', v_booking_nuevo_id,
      'expediente_id', p_expediente_id,
      'old_fecha_cita', v_fecha_cita_anterior,
      'new_fecha_cita', p_scheduled_at,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'etapa_actual', v_etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'old_booking_id', v_booking_anterior_id,
    'new_booking_id', v_booking_nuevo_id,
    'kind', v_kind,
    'scheduled_at', p_scheduled_at,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'fecha_cita', p_scheduled_at,
    'etapa_actual', v_etapa_actual,
    'no_etapa_change', true
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.mesa_reagendar_firmas(p_expediente_id uuid, p_booking_at timestamp with time zone, p_timezone text, p_location_id text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_booking RECORD;
  v_new_booking_id UUID;
  v_timezone TEXT;
  v_location_id TEXT;
  v_motivo TEXT;
  v_agenda_meta JSONB;
  v_booking_date DATE;
  v_booking_time TIME;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: perfil inactivo o rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_at IS NULL OR p_booking_at <= NOW() THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_DATE: fecha de firma debe ser futura'
      USING ERRCODE = '22023';
  END IF;

  v_timezone := NULLIF(btrim(COALESCE(p_timezone, '')), '');
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone obligatorio'
      USING ERRCODE = '22023';
  END IF;
  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_LOCATION: sede obligatoria'
      USING ERRCODE = '22023';
  END IF;
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_REASON_REQUIRED: motivo obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente no encontrado o no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STATE: expediente no elegible para agenda'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STAGE: solo etapas 9 o 10'
      USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.booking_date, b.booking_time, b.location_id, b.note
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = 'firmas'
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NO_ACTIVE_BOOKING: no hay firma activa'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = concat_ws(
      E'\n',
      NULLIF(btrim(COALESCE(note, '')), ''),
      'Reagendada por Mesa: ' || v_motivo
    )
  WHERE id = v_booking.id;

  PERFORM public.agenda_firmas_assert_agendable_desde(
    p_expediente_id,
    p_booking_at,
    v_location_id
  );

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_booking_at,
    v_location_id
  );

  IF v_agenda_meta->>'timezone' IS DISTINCT FROM v_timezone THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone debe coincidir con agenda_config (%)',
      v_agenda_meta->>'timezone'
      USING ERRCODE = '22023';
  END IF;

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;

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
    'firmas',
    p_expediente_id,
    v_booking_date,
    v_booking_time,
    v_location_id,
    'booked',
    'Reagenda Mesa: ' || v_motivo,
    v_actor_id
  )
  RETURNING id INTO v_new_booking_id;

  UPDATE public.expedientes
  SET fecha_cita = p_booking_at, updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.mesa_reagendar',
    'agenda_booking',
    v_new_booking_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'old_booking_id', v_booking.id,
      'new_booking_id', v_new_booking_id,
      'expediente_id', p_expediente_id,
      'booking_at', p_booking_at,
      'timezone', v_timezone,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'motivo', v_motivo,
      'etapa_actual', v_exp.etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'old_booking_id', v_booking.id,
    'new_booking_id', v_new_booking_id,
    'booking_at', p_booking_at,
    'timezone', v_timezone,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'etapa_actual', v_exp.etapa_actual
  );
END;
$function$;

