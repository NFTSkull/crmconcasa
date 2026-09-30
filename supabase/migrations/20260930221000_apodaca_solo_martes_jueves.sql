-- ConCasa CRM — Apodaca opera únicamente martes y jueves desde 2026-10-05.
-- Protege todas las altas/reagendas de agenda_bookings y evita que el inventario
-- de Google Sheets vuelva a publicar cupo en lunes/miércoles/viernes (o fin de semana).

CREATE OR REPLACE FUNCTION public.agenda_apodaca_fecha_habilitada(p_date date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_date IS NOT NULL
    AND (
      p_date < DATE '2026-10-05'
      OR EXTRACT(ISODOW FROM p_date)::int IN (2, 4)
    );
$$;

COMMENT ON FUNCTION public.agenda_apodaca_fecha_habilitada(date) IS
  'Desde 2026-10-05 Apodaca solo admite citas martes y jueves. Histórico anterior no se altera.';

CREATE OR REPLACE FUNCTION public.agenda_guard_apodaca_martes_jueves()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(btrim(coalesce(NEW.location_id, ''))) = 'apodaca'
     AND NEW.status = 'booked'
     AND NEW.cancelled_at IS NULL
     AND NOT public.agenda_apodaca_fecha_habilitada(NEW.booking_date)
  THEN
    RAISE EXCEPTION 'APODACA_SOLO_MARTES_JUEVES: en Apodaca solo se permiten citas los martes y jueves'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agenda_guard_apodaca_martes_jueves_biu
  ON public.agenda_bookings;

CREATE TRIGGER agenda_guard_apodaca_martes_jueves_biu
BEFORE INSERT OR UPDATE OF booking_date, location_id, status, cancelled_at
ON public.agenda_bookings
FOR EACH ROW
EXECUTE FUNCTION public.agenda_guard_apodaca_martes_jueves();

CREATE OR REPLACE FUNCTION public.agenda_inventory_guard_apodaca_martes_jueves()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(btrim(coalesce(NEW.location_id, ''))) = 'apodaca'
     AND NOT public.agenda_apodaca_fecha_habilitada(NEW.booking_date)
     AND NEW.status = 'available'
  THEN
    NEW.status := 'disabled';
    NEW.last_error := 'APODACA_SOLO_MARTES_JUEVES';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agenda_inventory_guard_apodaca_martes_jueves_biu
  ON public.agenda_sheet_slot_inventory;

CREATE TRIGGER agenda_inventory_guard_apodaca_martes_jueves_biu
BEFORE INSERT OR UPDATE OF booking_date, location_id, status
ON public.agenda_sheet_slot_inventory
FOR EACH ROW
EXECUTE FUNCTION public.agenda_inventory_guard_apodaca_martes_jueves();

-- Cierra cupos que ya estaban publicados en el inventario para fechas futuras no permitidas.
UPDATE public.agenda_sheet_slot_inventory
SET
  status = 'disabled',
  last_error = 'APODACA_SOLO_MARTES_JUEVES',
  updated_at = now()
WHERE lower(btrim(location_id)) = 'apodaca'
  AND booking_date >= DATE '2026-10-05'
  AND EXTRACT(ISODOW FROM booking_date)::int NOT IN (2, 4)
  AND status = 'available';
