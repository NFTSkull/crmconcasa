
BEGIN;
CREATE TABLE IF NOT EXISTS public.agenda_sede_suspensiones (
 organization_id uuid NOT NULL,
 location_id text NOT NULL,
 start_date date NOT NULL,
 active boolean NOT NULL DEFAULT true,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id,location_id)
);
ALTER TABLE public.agenda_sede_suspensiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_sede_suspensiones FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.agenda_sede_suspensiones TO service_role;
INSERT INTO public.agenda_sede_suspensiones(organization_id,location_id,start_date,active,reason)
VALUES ('50beae49-3961-4163-8e78-2251693f2c19','apodaca',DATE '2026-10-21',true,
'Sede Apodaca suspendida desde 21/10/2026 hasta nuevo aviso. Solicitar reagenda en una sede habilitada.')
ON CONFLICT (organization_id,location_id)
DO UPDATE SET start_date=EXCLUDED.start_date,active=EXCLUDED.active,reason=EXCLUDED.reason,updated_at=now();

CREATE OR REPLACE FUNCTION public.agenda_sede_suspendida(
 p_org uuid,p_location text,p_date date
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT EXISTS(
 SELECT 1 FROM public.agenda_sede_suspensiones s
 WHERE s.organization_id=p_org AND s.location_id=lower(btrim(p_location))
 AND s.active AND p_date>=s.start_date
 );
$f$;
REVOKE ALL ON FUNCTION public.agenda_sede_suspendida(uuid,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sede_suspendida(uuid,text,date) TO postgres,service_role;

CREATE OR REPLACE FUNCTION public.agenda_guard_sede_suspendida_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $t$
BEGIN
 IF NEW.status='booked'
   AND public.agenda_sede_suspendida(NEW.organization_id,NEW.location_id,NEW.booking_date)
 THEN
  RAISE EXCEPTION 'SEDE_APODACA_SUSPENDIDA: Apodaca no tiene citas disponibles desde 21/10/2026. Solicita reagenda en una sede habilitada.'
    USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $t$;

DROP TRIGGER IF EXISTS a00_agenda_guard_sede_suspendida_booking ON public.agenda_bookings;
CREATE TRIGGER a00_agenda_guard_sede_suspendida_booking
BEFORE INSERT OR UPDATE OF organization_id,kind,location_id,booking_date,status
ON public.agenda_bookings FOR EACH ROW
EXECUTE FUNCTION public.agenda_guard_sede_suspendida_booking();

CREATE OR REPLACE FUNCTION public.agenda_guard_sede_suspendida_manual()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $t$
BEGIN
 IF NEW.status='active'
   AND public.agenda_sede_suspendida(NEW.organization_id,NEW.location_id,NEW.booking_date)
 THEN
  RAISE EXCEPTION 'SEDE_APODACA_SUSPENDIDA: captura manual de nuevas citas deshabilitada desde 21/10/2026.'
    USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $t$;

DROP TRIGGER IF EXISTS a00_agenda_guard_sede_suspendida_manual ON public.agenda_manual_occupancies;
CREATE TRIGGER a00_agenda_guard_sede_suspendida_manual
BEFORE INSERT OR UPDATE OF organization_id,kind,location_id,booking_date,status
ON public.agenda_manual_occupancies FOR EACH ROW
EXECUTE FUNCTION public.agenda_guard_sede_suspendida_manual();

CREATE OR REPLACE FUNCTION public.agenda_guard_sede_suspendida_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $t$
BEGIN
 IF NEW.status='available'
   AND public.agenda_sede_suspendida(NEW.organization_id,NEW.location_id,NEW.booking_date)
 THEN
  NEW.status := 'disabled';
  NEW.last_error := 'SEDE_APODACA_SUSPENDIDA';
 END IF;
 RETURN NEW;
END $t$;

DROP TRIGGER IF EXISTS a00_agenda_guard_sede_suspendida_inventory ON public.agenda_sheet_slot_inventory;
CREATE TRIGGER a00_agenda_guard_sede_suspendida_inventory
BEFORE INSERT OR UPDATE OF organization_id,kind,location_id,booking_date,status
ON public.agenda_sheet_slot_inventory FOR EACH ROW
EXECUTE FUNCTION public.agenda_guard_sede_suspendida_inventory();

COMMENT ON TABLE public.agenda_sede_suspensiones IS 'Cierre temporal por sede, con inicio y reapertura manual. Cancela solo vía agenda_bookings normal; nunca altera cita ajena.';
COMMIT;
