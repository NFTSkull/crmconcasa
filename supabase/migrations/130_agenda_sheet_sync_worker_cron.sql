-- ConCasa CRM — Scheduler oficial CRM→Sheets (agenda-sheet-sync-worker)
-- Migración 130. No modifica bookings ni secretos con valores.
-- Requiere Vault secrets (crear fuera de esta migración, sin hardcodear):
--   agenda_sheet_project_url  = https://<project-ref>.supabase.co
--   agenda_sheet_worker_secret = mismo valor que Edge GOOGLE_SHEETS_WORKER_SECRET
-- Job: agenda-sheet-sync-worker-every-minute (* * * * *)
-- Auth worker: header x-concasa-worker-secret (ver Edge Function).
-- Con GOOGLE_SHEETS_SYNC_ENABLED=false el worker responde 2xx no-op.
--
-- Nota: pg_cron solo puede instalarse/programarse en la DB configurada
-- (Cloud = postgres). En runners aislados con otro nombre de DB se omite.

DO $m130$
DECLARE
  r RECORD;
  v_jobid bigint;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE NOTICE '130_agenda_sheet_sync_worker_cron: skip (database=%; pg_cron requiere postgres)',
      current_database();
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

  GRANT USAGE ON SCHEMA cron TO postgres;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

  -- Wrapper SECURITY DEFINER: lee solo Vault por nombre; sin secretos en SQL.
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.agenda_sheet_invoke_sync_worker()
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
    RAISE WARNING 'agenda_sheet_invoke_sync_worker: missing vault secret agenda_sheet_project_url';
    RETURN NULL;
  END IF;
  IF v_secret IS NULL OR length(trim(v_secret)) = 0 THEN
    RAISE WARNING 'agenda_sheet_invoke_sync_worker: missing vault secret agenda_sheet_worker_secret';
    RETURN NULL;
  END IF;

  v_url := rtrim(trim(v_base), '/') || '/functions/v1/agenda-sheet-sync-worker';

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-concasa-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$f$;
$fn$;

  REVOKE ALL ON FUNCTION public.agenda_sheet_invoke_sync_worker() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.agenda_sheet_invoke_sync_worker() TO postgres;

  -- Idempotente: un solo job con nombre estable.
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'agenda-sheet-sync-worker-every-minute'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  SELECT cron.schedule(
    'agenda-sheet-sync-worker-every-minute',
    '* * * * *',
    $cron$SELECT public.agenda_sheet_invoke_sync_worker();$cron$
  )
  INTO v_jobid;

  RAISE NOTICE '130: scheduled agenda-sheet-sync-worker-every-minute jobid=%', v_jobid;
END
$m130$;
