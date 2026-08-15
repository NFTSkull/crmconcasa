-- P188: contrato migration 182 (availability horizon cron).
-- Si la función aún no está aplicada (B1 LOCAL sin db reset), SKIP con NOTICE.
-- No muta bookings / Sheets / reconcile / sync-worker.

\set ON_ERROR_STOP on

DO $p188$
DECLARE
  v_def TEXT;
  v_n INT;
BEGIN
  IF to_regprocedure('public.agenda_sheet_invoke_availability_refresh()') IS NULL THEN
    RAISE NOTICE 'P188 SQL SKIP: agenda_sheet_invoke_availability_refresh not applied (expected until local reset)';
    RETURN;
  END IF;

  v_def := pg_get_functiondef('public.agenda_sheet_invoke_availability_refresh()'::regprocedure);
  IF v_def NOT LIKE '%agenda_sheet_project_url%' THEN
    RAISE EXCEPTION 'P188: vault URL missing';
  END IF;
  IF v_def NOT LIKE '%agenda_sheet_worker_secret%' THEN
    RAISE EXCEPTION 'P188: vault worker secret missing';
  END IF;
  IF v_def NOT LIKE '%/functions/v1/agenda-sheet-live-sync%' THEN
    RAISE EXCEPTION 'P188: live-sync endpoint missing';
  END IF;
  IF v_def NOT LIKE '%scope%' OR v_def NOT LIKE '%horizon%' THEN
    RAISE EXCEPTION 'P188: payload scope=horizon missing';
  END IF;
  IF v_def NOT LIKE '%55000%' THEN
    RAISE EXCEPTION 'P188: timeout 55000 missing';
  END IF;
  IF v_def LIKE '%BEGIN PRIVATE KEY%' THEN
    RAISE EXCEPTION 'P188: secret literal';
  END IF;

  IF has_function_privilege('anon', 'public.agenda_sheet_invoke_availability_refresh()', 'EXECUTE') THEN
    RAISE EXCEPTION 'P188: anon must not EXECUTE invoke';
  END IF;
  IF has_function_privilege('authenticated', 'public.agenda_sheet_invoke_availability_refresh()', 'EXECUTE') THEN
    RAISE EXCEPTION 'P188: authenticated must not EXECUTE invoke';
  END IF;

  SELECT count(*) INTO v_n
  FROM cron.job
  WHERE jobname = 'agenda-sheet-availability-refresh-every-2h';
  IF v_n > 1 THEN
    RAISE EXCEPTION 'P188: duplicate cron jobs';
  END IF;
  IF v_n = 1 THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'agenda-sheet-availability-refresh-every-2h'
        AND schedule = '7 */2 * * *'
    ) THEN
      RAISE EXCEPTION 'P188: unexpected cron schedule';
    END IF;
  END IF;

  -- Jobs ajenos intactos si existen.
  RAISE NOTICE 'P188 SQL PASS (function present; cron count=%)', v_n;
END
$p188$;
