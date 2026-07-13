-- ConCasa CRM — P067: lectura Mesa de citas org-wide (biométricos, firmas, notificación)
-- Solo lectura; sin mutaciones. Filtra por organización y can_see_expediente.

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
  created_by_email TEXT
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
    NULLIF(btrim(pr_creator.email), '')
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
  'Consulta read-only de citas para Mesa (biométricos, firmas, notificación). Rango máximo 62 días. Filtra por organización del actor y can_see_expediente. Uso exclusivo roles mesa_admin, mesa_interno, mesa_externo y super_admin.';

REVOKE ALL ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_mesa_agenda_bookings(DATE, DATE, BOOLEAN, public.booking_kind) TO authenticated;
