-- ConCasa CRM — Inscripción: máximo 4 lugares diarios en septiembre 2026.
-- Alcance: Monterrey / kind=inscripcion / 2026-09-01..2026-09-30.
-- No mueve, cancela ni crea citas. No cambia Sheets; solo configura y protege el cupo.

WITH concasa AS (
  SELECT id AS organization_id
  FROM public.organizations
  WHERE id = '50beae49-3961-4163-8e78-2251693f2c19'::uuid
),
dias AS (
  SELECT d::date AS slot_date
  FROM generate_series(
    DATE '2026-09-01',
    DATE '2026-09-30',
    INTERVAL '1 day'
  ) d
  WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5
)
INSERT INTO public.agenda_daily_capacity_overrides (
  organization_id,
  kind,
  location_id,
  slot_date,
  capacity,
  note,
  created_at,
  updated_at
)
SELECT
  c.organization_id,
  'inscripcion',
  'monterrey',
  d.slot_date,
  4,
  'Septiembre 2026: máximo 4 citas de inscripción por día',
  NOW(),
  NOW()
FROM concasa c
CROSS JOIN dias d
ON CONFLICT (organization_id, kind, location_id, slot_date)
DO UPDATE SET
  capacity = EXCLUDED.capacity,
  note = EXCLUDED.note,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.agenda_inscripcion_guard_daily_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cap INTEGER;
  v_remaining INTEGER;
BEGIN
  IF NEW.kind::TEXT IS DISTINCT FROM 'inscripcion'
     OR NEW.status::TEXT IS DISTINCT FROM 'booked'
     OR lower(btrim(COALESCE(NEW.location_id, ''))) IS DISTINCT FROM 'monterrey'
     OR NEW.booking_date < DATE '2026-09-01'
     OR NEW.booking_date > DATE '2026-09-30' THEN
    RETURN NEW;
  END IF;

  -- Actualizar una cita ya booked sin moverla de fecha/sede no consume otro lugar.
  IF TG_OP = 'UPDATE'
     AND OLD.kind::TEXT = 'inscripcion'
     AND OLD.status::TEXT = 'booked'
     AND OLD.booking_date IS NOT DISTINCT FROM NEW.booking_date
     AND lower(btrim(COALESCE(OLD.location_id, ''))) = 'monterrey' THEN
    RETURN NEW;
  END IF;

  v_cap := public.agenda_daily_capacity(
    NEW.organization_id,
    'inscripcion',
    NEW.booking_date,
    'monterrey'
  );

  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serializa carreras del último lugar: dos reservas simultáneas no pueden crear 5/4.
  PERFORM public.agenda_advisory_lock_daily_capacity(
    NEW.organization_id,
    'inscripcion',
    NEW.booking_date,
    'monterrey'
  );

  -- Fail-closed contra el inventario físico de Sheets.
  PERFORM public.agenda_sheet_assert_inventory_allows_booking(
    NEW.organization_id,
    'inscripcion',
    NEW.booking_date,
    TIME '11:00',
    'monterrey'
  );

  v_remaining := public.agenda_daily_remaining(
    NEW.organization_id,
    'inscripcion',
    NEW.booking_date,
    'monterrey'
  );

  IF COALESCE(v_remaining, 0) < 1 THEN
    RAISE EXCEPTION
      'CUPO_INSCRIPCION_AGOTADO: máximo 4 citas de inscripción por día'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agenda_inscripcion_guard_daily_capacity_biu
  ON public.agenda_bookings;

CREATE TRIGGER agenda_inscripcion_guard_daily_capacity_biu
BEFORE INSERT OR UPDATE OF kind, status, booking_date, booking_time, location_id
ON public.agenda_bookings
FOR EACH ROW
EXECUTE FUNCTION public.agenda_inscripcion_guard_daily_capacity();

COMMENT ON FUNCTION public.agenda_inscripcion_guard_daily_capacity() IS
  'Septiembre 2026: hard-cap 4 inscripción Monterrey; serializa último cupo y exige inventario Sheet disponible/fresco.';

REVOKE ALL ON FUNCTION public.agenda_inscripcion_guard_daily_capacity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_inscripcion_guard_daily_capacity()
  TO postgres, service_role;
