-- Hotfix 160: cancel outbox conserva sheet_row; create trae prior; release z_.
-- Estilo runner aislado (sin pgTAP): RAISE EXCEPTION si falla.
-- No escribe Sheets ni Cloud.

DO $$
DECLARE
  v_def TEXT;
BEGIN
  IF to_regprocedure('public.agenda_sheet_outbox_on_booking_change()') IS NULL THEN
    RAISE EXCEPTION 'outbox trigger function missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'agenda_bookings'
      AND t.tgname = 'z_agenda_sheet_inventory_release_au'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'release trigger z_agenda_sheet_inventory_release_au missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'agenda_bookings'
      AND t.tgname = 'agenda_sheet_inventory_release_au'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'legacy release trigger agenda_sheet_inventory_release_au still present';
  END IF;

  v_def := pg_get_functiondef(
    'public.agenda_sheet_outbox_on_booking_change()'::regprocedure
  );

  IF position('prior_cancelled_booking_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'outbox missing prior_cancelled_booking_id';
  END IF;

  IF position('had_sheet_link' IN v_def) = 0 THEN
    RAISE EXCEPTION 'outbox missing had_sheet_link';
  END IF;

  IF position('old_booking_date' IN v_def) = 0 THEN
    RAISE EXCEPTION 'outbox missing old_booking_date';
  END IF;

  -- Bio + firmas siguen en el gate del outbox
  IF position('''biometricos''' IN v_def) = 0
     OR position('''firmas''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'outbox must cover biometricos and firmas';
  END IF;

  RAISE NOTICE 'rpc_agenda_sheet_reschedule_clear_prior_p160 OK';
END $$;

SELECT 'P160 RESCHEDULE CLEAR PRIOR OK' AS result;
