-- ConCasa CRM — Scheduler inventario Sheet (agenda-sheet-reconcile)
-- Migración 132. Mantiene inventario fresco (<6h) para bio/firmas.
-- Reutiliza Vault: agenda_sheet_project_url + agenda_sheet_worker_secret.
-- Job: agenda-sheet-reconcile-every-15m (*/15 * * * *)
-- No toca bookings ni escribe Google Sheets (solo inventario interno).

DO $m132$
DECLARE
  r RECORD;
  v_jobid bigint;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE NOTICE '132_agenda_sheet_reconcile_cron: skip (database=%; pg_cron requiere postgres)',
      current_database();
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

  GRANT USAGE ON SCHEMA cron TO postgres;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.agenda_sheet_invoke_reconcile()
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
    RAISE WARNING 'agenda_sheet_invoke_reconcile: missing vault secret agenda_sheet_project_url';
    RETURN NULL;
  END IF;
  IF v_secret IS NULL OR length(trim(v_secret)) = 0 THEN
    RAISE WARNING 'agenda_sheet_invoke_reconcile: missing vault secret agenda_sheet_worker_secret';
    RETURN NULL;
  END IF;

  v_url := rtrim(trim(v_base), '/') || '/functions/v1/agenda-sheet-reconcile';

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-concasa-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$f$;
$fn$;

  REVOKE ALL ON FUNCTION public.agenda_sheet_invoke_reconcile() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.agenda_sheet_invoke_reconcile() TO postgres;

  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'agenda-sheet-reconcile-every-15m'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  SELECT cron.schedule(
    'agenda-sheet-reconcile-every-15m',
    '*/15 * * * *',
    $cron$SELECT public.agenda_sheet_invoke_reconcile();$cron$
  )
  INTO v_jobid;

  RAISE NOTICE '132: scheduled agenda-sheet-reconcile-every-15m jobid=%', v_jobid;
END
$m132$;
