CREATE OR REPLACE FUNCTION public.agenda_guard_sede_suspendida_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $t$
BEGIN
 IF NEW.status IN ('available','occupied_external')
   AND NEW.booking_id IS NULL
   AND public.agenda_sede_suspendida(NEW.organization_id,NEW.location_id,NEW.booking_date)
 THEN
  NEW.status := 'disabled';
  NEW.last_error := 'SEDE_APODACA_SUSPENDIDA';
 END IF;
 RETURN NEW;
END $t$;
UPDATE public.agenda_sheet_slot_inventory
SET status='disabled',last_error='SEDE_APODACA_SUSPENDIDA'
WHERE organization_id='50beae49-3961-4163-8e78-2251693f2c19'
AND location_id='apodaca' AND booking_date>='2026-10-21'
AND booking_id IS NULL AND status IN ('available','occupied_external');
