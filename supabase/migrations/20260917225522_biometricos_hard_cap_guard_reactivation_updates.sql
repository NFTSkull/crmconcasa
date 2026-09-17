-- ConCasa CRM — hard-cap Biométricos también en reactivaciones/movimientos por UPDATE.
-- Impide que una fila cancelada se reactive como booked y se convierta en la #16.

CREATE OR REPLACE FUNCTION public.agenda_booking_biometricos_daily_lock_bi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_location text;
  v_old_location text;
  v_cap integer;
  v_occ integer;
BEGIN
  IF NEW.kind::text IS DISTINCT FROM 'biometricos'
     OR NEW.status::text IS DISTINCT FROM 'booked' THEN
    RETURN NEW;
  END IF;

  v_location := lower(btrim(COALESCE(NEW.location_id, '')));

  -- Un UPDATE que ya era booked y permanece en el mismo scope diario no agrega cupo.
  IF TG_OP = 'UPDATE' THEN
    v_old_location := lower(btrim(COALESCE(OLD.location_id, '')));
    IF OLD.kind::text = 'biometricos'
       AND OLD.status::text = 'booked'
       AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
       AND OLD.booking_date IS NOT DISTINCT FROM NEW.booking_date
       AND v_old_location = v_location THEN
      RETURN NEW;
    END IF;
  END IF;

  v_cap := public.agenda_daily_capacity(
    NEW.organization_id,
    'biometricos',
    NEW.booking_date,
    v_location
  );

  IF v_cap IS NOT NULL THEN
    PERFORM public.agenda_advisory_lock_daily_capacity(
      NEW.organization_id,
      'biometricos',
      NEW.booking_date,
      v_location
    );

    v_occ := public.agenda_daily_active_occupancy(
      NEW.organization_id,
      'biometricos',
      NEW.booking_date,
      v_location
    ) + public.agenda_crm_manual_daily_count(
      NEW.organization_id,
      'biometricos',
      NEW.booking_date,
      v_location
    );

    IF v_occ >= v_cap THEN
      RAISE EXCEPTION
        'SIN_CUPO_DIA: El cupo diario de biométricos está completo (máximo % personas).', v_cap
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS a_agenda_booking_biometricos_daily_lock_bi
  ON public.agenda_bookings;

CREATE TRIGGER a_agenda_booking_biometricos_daily_lock_bi
BEFORE INSERT OR UPDATE OF organization_id, kind, status, booking_date, location_id
ON public.agenda_bookings
FOR EACH ROW
EXECUTE FUNCTION public.agenda_booking_biometricos_daily_lock_bi();

COMMENT ON FUNCTION public.agenda_booking_biometricos_daily_lock_bi() IS
  'Hard gate Biométricos BEFORE INSERT/activación/movimiento: lock diario + ocupación total; impide #16 también por UPDATE cancelled→booked.';
