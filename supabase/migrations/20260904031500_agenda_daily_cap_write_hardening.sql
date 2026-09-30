-- ConCasa CRM — P222: hardening del límite diario Biométricos Monterrey.
--
-- Defensa adicional a P213/P221:
-- 1) todo INSERT booked de biométricos toma el mismo advisory lock diario antes
--    del AFTER INSERT que revalida agenda_daily_active_occupancy. Esto cierra
--    carreras incluso para una futura ruta interna que inserte sin llamar al assert.
-- 2) un booking biométrico no puede reactivarse ni moverse in-place con UPDATE.
--    Reagendar debe ser siempre cancelación + INSERT nuevo, para volver a pasar
--    por cupo diario, inventario físico, outbox y sincronización con Sheets.
--
-- No modifica bookings existentes ni inventario.

CREATE OR REPLACE FUNCTION public.agenda_booking_biometricos_daily_lock_bi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cap integer;
BEGIN
  IF NEW.kind::text IS DISTINCT FROM 'biometricos'
     OR NEW.status::text IS DISTINCT FROM 'booked' THEN
    RETURN NEW;
  END IF;

  v_cap := public.agenda_daily_capacity(
    NEW.organization_id,
    'biometricos',
    NEW.booking_date,
    lower(btrim(COALESCE(NEW.location_id, '')))
  );

  IF v_cap IS NOT NULL THEN
    PERFORM public.agenda_advisory_lock_daily_capacity(
      NEW.organization_id,
      'biometricos',
      NEW.booking_date,
      lower(btrim(COALESCE(NEW.location_id, '')))
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS a_agenda_booking_biometricos_daily_lock_bi
  ON public.agenda_bookings;

CREATE TRIGGER a_agenda_booking_biometricos_daily_lock_bi
BEFORE INSERT ON public.agenda_bookings
FOR EACH ROW
EXECUTE FUNCTION public.agenda_booking_biometricos_daily_lock_bi();

CREATE OR REPLACE FUNCTION public.agenda_booking_biometricos_no_inplace_move_bu()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.kind::text IS DISTINCT FROM 'biometricos'
     AND NEW.kind::text IS DISTINCT FROM 'biometricos' THEN
    RETURN NEW;
  END IF;

  -- Nunca reactivar un booking biométrico cancelado/otro estado. Crear uno nuevo.
  IF OLD.status::text IS DISTINCT FROM 'booked'
     AND NEW.status::text = 'booked' THEN
    RAISE EXCEPTION
      'AGENDA_BIOMETRICOS_REACTIVATION_REQUIRES_NEW_BOOKING: cancela/reagenda creando una cita nueva'
      USING ERRCODE = '22023';
  END IF;

  -- Mientras siga activo, su identidad física no se puede mover in-place.
  IF OLD.status::text = 'booked'
     AND NEW.status::text = 'booked'
     AND (
       OLD.organization_id IS DISTINCT FROM NEW.organization_id
       OR OLD.expediente_id IS DISTINCT FROM NEW.expediente_id
       OR OLD.kind IS DISTINCT FROM NEW.kind
       OR OLD.booking_date IS DISTINCT FROM NEW.booking_date
       OR OLD.booking_time IS DISTINCT FROM NEW.booking_time
       OR lower(btrim(COALESCE(OLD.location_id, ''))) IS DISTINCT FROM
          lower(btrim(COALESCE(NEW.location_id, '')))
     ) THEN
    RAISE EXCEPTION
      'AGENDA_BIOMETRICOS_MOVE_REQUIRES_CANCEL_CREATE: reagenda mediante cancelación + nueva cita'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS a_agenda_booking_biometricos_no_inplace_move_bu
  ON public.agenda_bookings;

CREATE TRIGGER a_agenda_booking_biometricos_no_inplace_move_bu
BEFORE UPDATE ON public.agenda_bookings
FOR EACH ROW
EXECUTE FUNCTION public.agenda_booking_biometricos_no_inplace_move_bu();

REVOKE ALL ON FUNCTION public.agenda_booking_biometricos_daily_lock_bi() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agenda_booking_biometricos_no_inplace_move_bu() FROM PUBLIC;

COMMENT ON FUNCTION public.agenda_booking_biometricos_daily_lock_bi() IS
  'P222: serializa todo INSERT booked biométricos contra el hard-cap diario antes del AFTER INSERT.';
COMMENT ON FUNCTION public.agenda_booking_biometricos_no_inplace_move_bu() IS
  'P222: biométricos activos no se mueven/reactivan in-place; reagenda = cancel + create.';
