BEGIN;
CREATE OR REPLACE FUNCTION public.agenda_sheet_sync_healthcheck()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Monterrey')::date;
  v_open int := 0;
  v_resolved int := 0;
BEGIN
  WITH cases AS (
    SELECT b.id booking_id,b.booking_date,b.kind::text kind,b.location_id,
           o.status outbox_status,left(o.last_error,200) outbox_error,
           CASE
             WHEN o.status='dead' THEN 'CREATION_SYNC_DEAD'
             WHEN EXISTS (
               SELECT 1 FROM public.agenda_sheet_slot_inventory i
               WHERE i.booking_id=b.id AND i.status='claimed'
                 AND i.updated_at<now()-interval '10 minutes'
             ) AND NOT EXISTS (
               SELECT 1 FROM public.agenda_sheet_slot_inventory i
               WHERE i.booking_id=b.id AND i.status='linked'
             ) THEN 'CLAIM_STALLED'
             WHEN b.kind <> 'notificacion'
               AND NOT EXISTS (
               SELECT 1 FROM public.agenda_sheet_slot_inventory i
               WHERE i.booking_id=b.id AND i.status IN ('linked','claimed')
             ) THEN 'MISSING_INVENTORY'
             ELSE NULL
           END incident_code
    FROM public.agenda_bookings b
    LEFT JOIN LATERAL (
      SELECT o.status,o.last_error
      FROM public.agenda_sheet_sync_outbox o
      WHERE o.booking_id=b.id AND o.event_type='booking_created'
      ORDER BY o.created_at DESC LIMIT 1
    ) o ON true
    WHERE b.status='booked'
      AND b.booking_date BETWEEN v_today AND v_today+60
      AND b.created_at < now()-interval '10 minutes'
  )
  INSERT INTO public.agenda_sheet_sync_health_incidents
      (booking_id,incident_code,incident_status,booking_date,kind,location_id,
       outbox_status,outbox_error,first_detected_at,last_detected_at,last_checked_at,resolved_at)
  SELECT c.booking_id,c.incident_code,'open',c.booking_date,c.kind,c.location_id,
         c.outbox_status,c.outbox_error,now(),now(),now(),NULL
  FROM cases c WHERE c.incident_code IS NOT NULL
  ON CONFLICT (booking_id) DO UPDATE
    SET incident_code=EXCLUDED.incident_code,
        incident_status='open',booking_date=EXCLUDED.booking_date,
        kind=EXCLUDED.kind,location_id=EXCLUDED.location_id,
        outbox_status=EXCLUDED.outbox_status,outbox_error=EXCLUDED.outbox_error,
        last_detected_at=now(),last_checked_at=now(),resolved_at=NULL;

  -- Resolución solo cuando ya no hay anomalía verificable en la DB.
  UPDATE public.agenda_sheet_sync_health_incidents a
  SET incident_status='resolved',resolved_at=now(),last_checked_at=now()
  WHERE a.incident_status='open'
    AND NOT EXISTS (
      SELECT 1
      FROM public.agenda_bookings b
      LEFT JOIN LATERAL (
        SELECT o.status
        FROM public.agenda_sheet_sync_outbox o
        WHERE o.booking_id=b.id AND o.event_type='booking_created'
        ORDER BY o.created_at DESC LIMIT 1
      ) o ON true
      WHERE b.id=a.booking_id AND b.status='booked'
        AND b.booking_date BETWEEN v_today AND v_today+60
        AND b.created_at<now()-interval '10 minutes'
        AND (
          o.status='dead'
          OR EXISTS (
            SELECT 1 FROM public.agenda_sheet_slot_inventory i
            WHERE i.booking_id=b.id AND i.status='claimed'
              AND i.updated_at<now()-interval '10 minutes'
          ) AND NOT EXISTS (
            SELECT 1 FROM public.agenda_sheet_slot_inventory i
            WHERE i.booking_id=b.id AND i.status='linked'
          )
          OR (b.kind <> 'notificacion' AND NOT EXISTS (
            SELECT 1 FROM public.agenda_sheet_slot_inventory i
            WHERE i.booking_id=b.id AND i.status IN ('linked','claimed')
          ))
        )
    );
  GET DIAGNOSTICS v_resolved=ROW_COUNT;
  SELECT count(*) INTO v_open FROM public.agenda_sheet_sync_health_incidents WHERE incident_status='open';
  RETURN jsonb_build_object('open',v_open,'resolved_now',v_resolved,'checked_at',now());
END;
$function$
;
COMMIT;