-- ConCasa: fecha de inscripción posterior a los biométricos futuros.
-- Sin modificar expedientes, agenda histórica o cupos. Idempotente.

CREATE OR REPLACE FUNCTION public.agenda_inscripcion_earliest_post_bio_date(p_expediente_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 SELECT CASE
   WHEN e.etapa_actual = 4 THEN (
     SELECT MAX(b.booking_date) + 1
     FROM public.agenda_bookings b
     WHERE b.expediente_id = e.id
       AND b.organization_id = e.organization_id
       AND b.kind = 'biometricos'::public.booking_kind
       AND b.status = 'booked'::public.booking_status
       AND b.booking_date >= (now() AT TIME ZONE 'America/Monterrey')::date
   )
   ELSE NULL::date END
 FROM public.expedientes e
 WHERE e.id = p_expediente_id
 $function$
;
