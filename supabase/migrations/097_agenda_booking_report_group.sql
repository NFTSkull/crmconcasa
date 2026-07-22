-- ConCasa CRM — P109: clasificación report_group para Excel de citas Mesa
-- kind operativo permanece intacto; report_group solo organiza el Excel.

ALTER TABLE public.agenda_bookings
  ADD COLUMN IF NOT EXISTS report_group TEXT NULL;

ALTER TABLE public.agenda_bookings
  DROP CONSTRAINT IF EXISTS agenda_bookings_report_group_chk;

ALTER TABLE public.agenda_bookings
  ADD CONSTRAINT agenda_bookings_report_group_chk
    CHECK (
      report_group IS NULL
      OR report_group IN (
        'biometricos_tramite_completo',
        'biometricos',
        'inscripcion',
        'firmas',
        'notificacion'
      )
    );

COMMENT ON COLUMN public.agenda_bookings.report_group IS
  'P109: clasificación exclusiva para Excel de citas. NULL = fallback por kind. No altera operación ni booking_kind.';

CREATE INDEX IF NOT EXISTS agenda_bookings_report_group_idx
  ON public.agenda_bookings (organization_id, report_group)
  WHERE report_group IS NOT NULL;

-- Extiende lectura Mesa con report_group (firma idéntica; DROP requerido por RETURNS TABLE).
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
  drive_validated_by_email TEXT,
  report_group TEXT
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
    NULLIF(btrim(pr_drive.email), ''),
    b.report_group
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
  'P109: lectura Mesa de citas incl. report_group (Excel). kind operativo intacto.';

REVOKE ALL ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) TO authenticated;

CREATE OR REPLACE FUNCTION public.mesa_set_agenda_booking_report_group(
  p_booking_id UUID,
  p_report_group TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_booking RECORD;
  v_group TEXT;
  v_prev TEXT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_REPORT_GROUP_UNAUTHORIZED: usuario no autenticado'
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
    RAISE EXCEPTION 'MESA_REPORT_GROUP_UNAUTHORIZED: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'MESA_REPORT_GROUP_NOT_FOUND: booking_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_group := NULLIF(btrim(COALESCE(p_report_group, '')), '');
  IF v_group IS NULL OR v_group NOT IN (
    'biometricos_tramite_completo',
    'biometricos',
    'inscripcion',
    'firmas',
    'notificacion'
  ) THEN
    RAISE EXCEPTION 'MESA_REPORT_GROUP_INVALID: clasificación no permitida'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    b.id,
    b.organization_id,
    b.expediente_id,
    b.kind,
    b.status,
    b.booking_date,
    b.booking_time,
    b.report_group,
    b.location_id,
    b.note
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESA_REPORT_GROUP_NOT_FOUND: booking no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_booking.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_REPORT_GROUP_UNAUTHORIZED: booking fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(v_booking.expediente_id) THEN
    RAISE EXCEPTION 'MESA_REPORT_GROUP_UNAUTHORIZED: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  v_prev := v_booking.report_group;

  UPDATE public.agenda_bookings
  SET
    report_group = v_group,
    updated_at = NOW()
  WHERE id = p_booking_id
    AND kind IS NOT DISTINCT FROM v_booking.kind
    AND status IS NOT DISTINCT FROM v_booking.status
    AND booking_date IS NOT DISTINCT FROM v_booking.booking_date
    AND booking_time IS NOT DISTINCT FROM v_booking.booking_time
    AND location_id IS NOT DISTINCT FROM v_booking.location_id
    AND note IS NOT DISTINCT FROM v_booking.note;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESA_REPORT_GROUP_CONFLICT: el booking cambió concurrentemente'
      USING ERRCODE = '40001';
  END IF;

  PERFORM public.log_action(
    v_booking.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.booking.report_group',
    'agenda_booking',
    p_booking_id,
    jsonb_build_object(
      'booking_id', p_booking_id,
      'expediente_id', v_booking.expediente_id,
      'kind', v_booking.kind,
      'report_group_anterior', v_prev,
      'report_group', v_group
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'report_group', v_group,
    'report_group_anterior', v_prev,
    'kind', v_booking.kind
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_set_agenda_booking_report_group(UUID, TEXT) IS
  'P109: Mesa actualiza solo report_group de un booking. No muta kind/fecha/hora/status.';

REVOKE ALL ON FUNCTION public.mesa_set_agenda_booking_report_group(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_set_agenda_booking_report_group(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_set_agenda_booking_report_group(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_set_agenda_booking_report_group(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mesa_set_agenda_booking_report_group(UUID, TEXT) TO postgres;
