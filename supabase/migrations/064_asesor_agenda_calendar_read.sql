-- ConCasa CRM — P064: calendario de citas read-only para asesores (org-wide, campos seguros)
-- Sin mutaciones; no altera book/cancel/reagendar existentes.

CREATE OR REPLACE FUNCTION public.get_asesor_agenda_calendar(
  p_start_date DATE,
  p_end_date DATE,
  p_include_cancelled BOOLEAN DEFAULT false
)
RETURNS TABLE (
  booking_id UUID,
  booking_date DATE,
  booking_time TIME,
  kind public.booking_kind,
  status public.booking_status,
  location_id TEXT,
  asesor_id UUID,
  asesor_full_name TEXT,
  asesor_email TEXT
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
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF v_role NOT IN ('asesor', 'mesa_admin', 'super_admin') THEN
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
    b.booking_date,
    b.booking_time,
    b.kind,
    b.status,
    b.location_id,
    e.asesor_id,
    NULLIF(btrim(pr.full_name), ''),
    NULLIF(btrim(pr.email), '')
  FROM public.agenda_bookings b
  INNER JOIN public.expedientes e
    ON e.id = b.expediente_id
   AND e.deleted_at IS NULL
   AND e.organization_id = v_org_id
  INNER JOIN public.profiles pr
    ON pr.id = e.asesor_id
   AND pr.active = true
  WHERE b.organization_id = v_org_id
    AND b.booking_date >= p_start_date
    AND b.booking_date <= p_end_date
    AND (p_include_cancelled OR b.status = 'booked')
  ORDER BY b.booking_date ASC, b.booking_time ASC, b.kind ASC;
END;
$$;

COMMENT ON FUNCTION public.get_asesor_agenda_calendar(DATE, DATE, BOOLEAN) IS
  'Calendario org-wide de citas (biométricos/firmas) solo lectura para asesor/mesa_admin/super_admin. Sin datos de cliente.';

REVOKE ALL ON FUNCTION public.get_asesor_agenda_calendar(DATE, DATE, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_asesor_agenda_calendar(DATE, DATE, BOOLEAN) TO authenticated;
