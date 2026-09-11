-- ConCasa CRM — sincroniza en Git la optimización ya aplicada en Production.
-- Reduce write churn de agenda_sheet_slot_inventory sin alterar datos de negocio.
--
-- Regla:
-- - Si todos los campos funcionales son idénticos y la fila fue observada en las últimas 2h,
--   se suprime el UPDATE que solo refrescaría observed_at/sheet_last_seen_at/updated_at.
-- - Cualquier cambio real de cupo, booking, NSS, cliente, asesor, expediente, horario,
--   sede, estado, fingerprint, claim/link o error se persiste inmediatamente.
-- - El fail-closed de frescura de 6h y el refresco completo cada 2h permanecen intactos.

CREATE OR REPLACE FUNCTION public.agenda_sheet_slot_inventory_suppress_recent_heartbeat()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.observed_at IS NOT NULL
     AND OLD.observed_at >= (NOW() - INTERVAL '2 hours')
     AND NEW.observed_at IS DISTINCT FROM OLD.observed_at
     AND NEW.sheet_last_seen_at IS DISTINCT FROM OLD.sheet_last_seen_at
     AND NEW.observed_at >= (NOW() - INTERVAL '5 minutes')
     AND NEW.sheet_last_seen_at >= (NOW() - INTERVAL '5 minutes')
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.spreadsheet_id IS NOT DISTINCT FROM OLD.spreadsheet_id
     AND NEW.sheet_id IS NOT DISTINCT FROM OLD.sheet_id
     AND NEW.sheet_title IS NOT DISTINCT FROM OLD.sheet_title
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NEW.sheet_row IS NOT DISTINCT FROM OLD.sheet_row
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.location_id IS NOT DISTINCT FROM OLD.location_id
     AND NEW.slot_time IS NOT DISTINCT FROM OLD.slot_time
     AND NEW.sheet_slot_time IS NOT DISTINCT FROM OLD.sheet_slot_time
     AND NEW.slot_key IS NOT DISTINCT FROM OLD.slot_key
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.visible_nss IS NOT DISTINCT FROM OLD.visible_nss
     AND NEW.visible_name IS NOT DISTINCT FROM OLD.visible_name
     AND NEW.visible_advisor IS NOT DISTINCT FROM OLD.visible_advisor
     AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
     AND NEW.expediente_id IS NOT DISTINCT FROM OLD.expediente_id
     AND NEW.occupancy_source IS NOT DISTINCT FROM OLD.occupancy_source
     AND NEW.manual_occupancy_fingerprint IS NOT DISTINCT FROM OLD.manual_occupancy_fingerprint
     AND NEW.claimed_at IS NOT DISTINCT FROM OLD.claimed_at
     AND NEW.linked_at IS NOT DISTINCT FROM OLD.linked_at
     AND NEW.last_error IS NOT DISTINCT FROM OLD.last_error
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_agenda_sheet_slot_inventory_suppress_recent_heartbeat
ON public.agenda_sheet_slot_inventory;

CREATE TRIGGER trg_agenda_sheet_slot_inventory_suppress_recent_heartbeat
BEFORE UPDATE ON public.agenda_sheet_slot_inventory
FOR EACH ROW
EXECUTE FUNCTION public.agenda_sheet_slot_inventory_suppress_recent_heartbeat();
