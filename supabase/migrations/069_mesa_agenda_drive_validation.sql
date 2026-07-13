-- ConCasa CRM — P069: validación Drive por booking (Mesa agenda)
-- Columnas en agenda_bookings + extender get_mesa_agenda_bookings + RPC set/clear.
-- No altera status/fecha/kind/cupos ni historial de agenda.

-- =============================================================================
-- A) Columnas (pertenecen al booking_id, no al expediente)
-- =============================================================================
ALTER TABLE public.agenda_bookings
  ADD COLUMN IF NOT EXISTS drive_validated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drive_validated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS drive_validated_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agenda_bookings_drive_validated_idx
  ON public.agenda_bookings (organization_id, drive_validated)
  WHERE drive_validated = true;

COMMENT ON COLUMN public.agenda_bookings.drive_validated IS
  'Marca operativa Mesa: cita validada en Drive. Persistente por booking_id; nueva cita tras reagenda inicia en false.';
COMMENT ON COLUMN public.agenda_bookings.drive_validated_at IS
  'Timestamp de la última validación Drive (null si no validada).';
COMMENT ON COLUMN public.agenda_bookings.drive_validated_by IS
  'Perfil Mesa que marcó Validado en Drive (null si no validada).';

-- =============================================================================
-- B) Lectura Mesa: incluir campos drive_* (+ nombre de quien validó)
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind);

CREATE OR REPLACE FUNCTION public.get_mesa_agenda_bookings(
  p_start_date DATE,
  p_end_date DATE,
  p_include_cancelled BOOLEAN DEFAULT false,
  p_kind public.booking_kind DEFAULT NULL
)
RETURNS TABLE (
  booking_id UUID,
  expediente_id UUID,
  booking_date DATE,
  booking_time TIME,
  kind public.booking_kind,
  status public.booking_status,
  location_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cliente_nombre TEXT,
  nss TEXT,
  etapa_actual SMALLINT,
  subestado TEXT,
  submitted_to_mesa BOOLEAN,
  asesor_id UUID,
  asesor_full_name TEXT,
  asesor_email TEXT,
  created_by UUID,
  created_by_full_name TEXT,
  created_by_email TEXT,
  drive_validated BOOLEAN,
  drive_validated_at TIMESTAMPTZ,
  drive_validated_by UUID,
  drive_validated_by_full_name TEXT,
  drive_validated_by_email TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
  v_org_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_inactive';
  END IF;

  IF v_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  IF p_end_date - p_start_date > 62 THEN
    RAISE EXCEPTION 'date_range_too_large';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.expediente_id,
    b.booking_date,
    b.booking_time,
    b.kind,
    b.status,
    b.location_id,
    b.note,
    b.created_at,
    b.cancelled_at,
    CASE
      WHEN public.can_see_expediente(e.id) THEN e.cliente_nombre
      ELSE NULL
    END,
    CASE
      WHEN public.can_see_expediente(e.id) THEN e.nss::TEXT
      ELSE NULL
    END,
    e.etapa_actual,
    e.subestado::TEXT,
    e.submitted_to_mesa,
    e.asesor_id,
    NULLIF(btrim(pr_asesor.full_name), ''),
    NULLIF(btrim(pr_asesor.email), ''),
    b.created_by,
    NULLIF(btrim(pr_creator.full_name), ''),
    NULLIF(btrim(pr_creator.email), ''),
    b.drive_validated,
    b.drive_validated_at,
    b.drive_validated_by,
    NULLIF(btrim(pr_drive.full_name), ''),
    NULLIF(btrim(pr_drive.email), '')
  FROM public.agenda_bookings b
  INNER JOIN public.expedientes e
    ON e.id = b.expediente_id
   AND e.deleted_at IS NULL
   AND e.organization_id = v_org_id
  INNER JOIN public.profiles pr_asesor
    ON pr_asesor.id = e.asesor_id
   AND pr_asesor.active = true
  LEFT JOIN public.profiles pr_creator
    ON pr_creator.id = b.created_by
   AND pr_creator.active = true
  LEFT JOIN public.profiles pr_drive
    ON pr_drive.id = b.drive_validated_by
  WHERE b.organization_id = v_org_id
    AND b.booking_date >= p_start_date
    AND b.booking_date <= p_end_date
    AND (p_include_cancelled OR b.status = 'booked')
    AND (p_kind IS NULL OR b.kind = p_kind)
    AND public.can_see_expediente(e.id)
  ORDER BY b.booking_date ASC, b.booking_time ASC, b.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) IS
  'Consulta read-only de citas para Mesa (biométricos, firmas, notificación) incl. drive_validated. Rango máx. 62 días. Filtra organización + can_see_expediente.';

REVOKE ALL ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) TO authenticated;

-- =============================================================================
-- C) Mutación: solo columnas drive_* del booking_id
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_set_agenda_drive_validation(
  p_booking_id UUID,
  p_validated BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_booking RECORD;
  v_was_validated BOOLEAN;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: booking_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_validated IS NULL THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: validated es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    b.id,
    b.organization_id,
    b.expediente_id,
    b.kind,
    b.status,
    b.drive_validated,
    b.booking_date,
    b.booking_time,
    e.deleted_at
  INTO v_booking
  FROM public.agenda_bookings b
  INNER JOIN public.expedientes e ON e.id = b.expediente_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: booking no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_booking.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: booking fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(v_booking.expediente_id) THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF p_validated IS TRUE AND v_booking.status <> 'booked' THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: solo se puede validar una cita activa (booked)'
      USING ERRCODE = '22023';
  END IF;

  v_was_validated := COALESCE(v_booking.drive_validated, false);

  IF p_validated IS TRUE THEN
    UPDATE public.agenda_bookings
    SET
      drive_validated = true,
      drive_validated_at = NOW(),
      drive_validated_by = v_actor_id
    WHERE id = p_booking_id;

    PERFORM public.log_action(
      v_booking.organization_id,
      v_actor_id,
      v_actor_role,
      'agenda.drive_validation.set',
      'agenda_booking',
      p_booking_id,
      jsonb_build_object(
        'expediente_id', v_booking.expediente_id,
        'kind', v_booking.kind,
        'booking_date', v_booking.booking_date,
        'booking_time', v_booking.booking_time,
        'previous_validated', v_was_validated,
        'drive_validated', true
      )
    );
  ELSE
    UPDATE public.agenda_bookings
    SET
      drive_validated = false,
      drive_validated_at = NULL,
      drive_validated_by = NULL
    WHERE id = p_booking_id;

    PERFORM public.log_action(
      v_booking.organization_id,
      v_actor_id,
      v_actor_role,
      'agenda.drive_validation.clear',
      'agenda_booking',
      p_booking_id,
      jsonb_build_object(
        'expediente_id', v_booking.expediente_id,
        'kind', v_booking.kind,
        'booking_date', v_booking.booking_date,
        'booking_time', v_booking.booking_time,
        'previous_validated', v_was_validated,
        'drive_validated', false
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'drive_validated', p_validated,
    'drive_validated_at', CASE WHEN p_validated THEN NOW() ELSE NULL END,
    'drive_validated_by', CASE WHEN p_validated THEN v_actor_id ELSE NULL END,
    'status_unchanged', v_booking.status,
    'kind_unchanged', v_booking.kind
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_set_agenda_drive_validation(UUID, BOOLEAN) IS
  'Mesa marca/quita Validado en Drive por agenda_bookings.id. Solo columnas drive_*. Roles mesa_* y super_admin. Validar exige status=booked.';

REVOKE ALL ON FUNCTION public.mesa_set_agenda_drive_validation(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_set_agenda_drive_validation(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_set_agenda_drive_validation(UUID, BOOLEAN) TO authenticated;
