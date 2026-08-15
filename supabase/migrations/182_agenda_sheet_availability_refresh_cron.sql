-- ConCasa CRM — P188: refresh periódico de inventario (availability horizon)
-- Migración 182. LOCAL until Cloud apply.
-- pg_cron → pg_net → agenda-sheet-live-sync { mode=availability, scope=horizon }
-- READ Google Sheets + upsert agenda_sheet_slot_inventory. 0 Sheet writes. 0 bookings.
-- No altera reconcile (132) ni sync-worker (130).
-- Rollback: SELECT cron.unschedule('agenda-sheet-availability-refresh-every-2h');
--
-- Timeout 55000 ms: mismo presupuesto que invoke_reconcile (132). Horizon hace
-- 1 listSheets + 1 values.batchGet (no P170/colores); debe terminar holgado.

DO $m182$
DECLARE
  r RECORD;
  v_jobid bigint;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE NOTICE '182_agenda_sheet_availability_refresh_cron: skip (database=%; pg_cron requiere postgres)',
      current_database();
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '182: pg_cron already present / skip recreate (%): %', SQLSTATE, SQLERRM;
  END;

  GRANT USAGE ON SCHEMA cron TO postgres;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.agenda_sheet_invoke_availability_refresh()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $f$
DECLARE
  v_base TEXT;
  v_secret TEXT;
  v_url TEXT;
  v_request_id bigint;
BEGIN
  SELECT ds.decrypted_secret
    INTO v_base
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'agenda_sheet_project_url'
  LIMIT 1;

  SELECT ds.decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'agenda_sheet_worker_secret'
  LIMIT 1;

  IF v_base IS NULL OR length(trim(v_base)) = 0 THEN
    RAISE WARNING 'agenda_sheet_invoke_availability_refresh: missing vault secret agenda_sheet_project_url';
    RETURN NULL;
  END IF;
  IF v_secret IS NULL OR length(trim(v_secret)) = 0 THEN
    RAISE WARNING 'agenda_sheet_invoke_availability_refresh: missing vault secret agenda_sheet_worker_secret';
    RETURN NULL;
  END IF;

  v_url := rtrim(trim(v_base), '/') || '/functions/v1/agenda-sheet-live-sync';

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-concasa-worker-secret', v_secret
    ),
    body := jsonb_build_object(
      'mode', 'availability',
      'scope', 'horizon'
    ),
    timeout_milliseconds := 55000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$f$;
$fn$;

  REVOKE ALL ON FUNCTION public.agenda_sheet_invoke_availability_refresh() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.agenda_sheet_invoke_availability_refresh() TO postgres;

  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'agenda-sheet-availability-refresh-every-2h'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  SELECT cron.schedule(
    'agenda-sheet-availability-refresh-every-2h',
    '7 */2 * * *',
    $cron$SELECT public.agenda_sheet_invoke_availability_refresh();$cron$
  )
  INTO v_jobid;

  RAISE NOTICE '182: scheduled agenda-sheet-availability-refresh-every-2h jobid=%', v_jobid;
END
$m182$;
