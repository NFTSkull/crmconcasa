-- P200: agenda_booking_sheet_sync_status — contrato de read-model (sin Sheets).
DO $$
DECLARE
  v_def TEXT;
BEGIN
  IF to_regprocedure('public.agenda_booking_sheet_sync_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.agenda_booking_sheet_sync_status(uuid)'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL OR v_def !~* 'LANGUAGE plpgsql' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status def missing';
  END IF;
  IF v_def !~* 'STABLE' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status must be STABLE';
  END IF;
  IF v_def !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status must be SECURITY DEFINER';
  END IF;
  IF v_def !~* 'can_see_expediente' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status must authorize via can_see_expediente';
  END IF;
  IF v_def !~* 'agenda_sheet_slot_inventory' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status must consider inventory linked';
  END IF;
  IF v_def !~* '''PENDING''' OR v_def !~* '''SYNCED''' OR v_def !~* '''FAILED''' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status must emit PENDING/SYNCED/FAILED';
  END IF;
  IF v_def ~* 'decrypted_secret' OR v_def ~* 'vault' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status must not read vault';
  END IF;
  IF v_def ~* 'o\.payload' OR v_def ~* 'last_error' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status must not expose outbox payload/last_error';
  END IF;
  IF v_def ~* 'GOOGLE_SHEETS' OR v_def ~* 'service_account' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status must not mention sheet secrets';
  END IF;
  IF v_def !~* 'asesor' OR v_def !~* 'mesa_admin' OR v_def !~* 'super_admin' THEN
    RAISE EXCEPTION 'agenda_booking_sheet_sync_status role allowlist incomplete';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.agenda_booking_sheet_sync_status(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated missing EXECUTE on agenda_booking_sheet_sync_status';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.agenda_booking_sheet_sync_status(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not EXECUTE agenda_booking_sheet_sync_status';
  END IF;

  RAISE NOTICE 'rpc_agenda_booking_sheet_sync_status_p200 OK';
END $$;
