-- Cada booking activo consume un lugar del pool combinado; no deduplicar por NSS.

CREATE OR REPLACE FUNCTION public.agenda_mty_shared_pool_crm_occupancy(
  p_org UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT count(*)::INTEGER
  FROM public.agenda_bookings b
  WHERE b.organization_id = p_org
    AND b.booking_date = p_date
    AND b.status = 'booked'::public.booking_status
    AND (
      (
        b.kind = 'firmas'::public.booking_kind
        AND public.agenda_firmas_canonical_location_id(b.location_id) = 'monterrey'
      )
      OR (
        b.kind IN ('inscripcion'::public.booking_kind, 'notificacion'::public.booking_kind)
        AND lower(btrim(COALESCE(b.location_id, ''))) = 'monterrey'
      )
    );
$function$;

COMMENT ON FUNCTION public.agenda_mty_shared_pool_crm_occupancy(UUID,DATE) IS
  'Cuenta cada booking activo del pool Monterrey Firmas+Inscripción+Notificación. No deduplica NSS: cada cita consume lugar.';
