CREATE TABLE IF NOT EXISTS public.agenda_blocked_dates (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  blocked_date date NOT NULL,
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, blocked_date)
);

ALTER TABLE public.agenda_blocked_dates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_blocked_dates FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agenda_date_is_blocked(
  p_organization_id uuid,
  p_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_blocked_dates b
    WHERE b.organization_id = p_organization_id
      AND b.blocked_date = p_date
      AND b.active = true
  );
$function$;

REVOKE ALL ON FUNCTION public.agenda_date_is_blocked(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_date_is_blocked(uuid,date) TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_guard_blocked_date_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.agenda_date_is_blocked(NEW.organization_id, NEW.booking_date) THEN
      RAISE EXCEPTION 'AGENDA_FECHA_BLOQUEADA: No se permiten citas en la fecha seleccionada.'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.booking_date IS DISTINCT FROM OLD.booking_date
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
       AND public.agenda_date_is_blocked(NEW.organization_id, NEW.booking_date) THEN
      RAISE EXCEPTION 'AGENDA_FECHA_BLOQUEADA: No se permiten citas en la fecha seleccionada.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_agenda_bookings_blocked_date ON public.agenda_bookings;
CREATE TRIGGER trg_agenda_bookings_blocked_date
BEFORE INSERT OR UPDATE OF booking_date, organization_id
ON public.agenda_bookings
FOR EACH ROW EXECUTE FUNCTION public.agenda_guard_blocked_date_write();

DROP TRIGGER IF EXISTS trg_agenda_manual_occupancies_blocked_date ON public.agenda_manual_occupancies;
CREATE TRIGGER trg_agenda_manual_occupancies_blocked_date
BEFORE INSERT OR UPDATE OF booking_date, organization_id
ON public.agenda_manual_occupancies
FOR EACH ROW EXECUTE FUNCTION public.agenda_guard_blocked_date_write();

DROP TRIGGER IF EXISTS trg_agenda_extraordinary_bookings_blocked_date ON public.agenda_extraordinary_bookings;
CREATE TRIGGER trg_agenda_extraordinary_bookings_blocked_date
BEFORE INSERT OR UPDATE OF booking_date, organization_id
ON public.agenda_extraordinary_bookings
FOR EACH ROW EXECUTE FUNCTION public.agenda_guard_blocked_date_write();

COMMENT ON TABLE public.agenda_blocked_dates IS
  'Bloqueos exactos por fecha para impedir nuevas citas sin alterar otros días.';
