-- ConCasa CRM — P189 B4.1: despertar automático del worker PDF (LOCAL)
-- pg_cron → helper → pg_net POST {} → infonavit-pdf-worker
-- NO genera PDF. NO claim. NO lee snapshot/PII. NO HTTP en el envío a Mesa.
-- Scheduler P189 independiente (no reutiliza infra de agenda ni P188).
-- Vault (crear FUERA de esta migración, sin valores productivos aquí):
--   infonavit_pdf_worker_url    = URL completa del worker (local o Cloud)
--   infonavit_pdf_worker_secret = mismo valor que Edge INFONAVIT_PDF_WORKER_SECRET
-- Job: infonavit-pdf-worker-dispatch (* * * * *)
-- Auth: header x-concasa-worker-secret (contrato B4).
-- Timeout pg_net 25000 ms: net.http_post es async (encola + wake);
-- el timeout aplica al cliente HTTP. El worker B4 procesa el batch en el
-- mismo POST (hasta 3 PDFs + Storage). 5s default es corto; 55s (reconcile
-- agenda) es más de lo necesario. 25s cubre 3 renders locales sin bloquear.
-- Rollback: SELECT cron.unschedule('infonavit-pdf-worker-dispatch');
--
-- Nota: pg_cron solo se programa en la DB `postgres`.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_dispatch_worker()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, net
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_request_id bigint;
  v_has_work BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.infonavit_pdf_outbox o
    WHERE (
      (o.status = 'pending' AND o.available_at <= NOW())
      OR (
        o.status = 'processing'
        AND o.processing_started_at IS NOT NULL
        AND o.processing_started_at < NOW() - public.infonavit_pdf_worker_lease_interval()
      )
    )
  )
  INTO v_has_work;

  IF NOT COALESCE(v_has_work, false) THEN
    RETURN jsonb_build_object(
      'status', 'no_work',
      'request_id', NULL
    );
  END IF;

  SELECT NULLIF(btrim(ds.decrypted_secret), '')
    INTO v_url
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'infonavit_pdf_worker_url'
  LIMIT 1;

  SELECT NULLIF(btrim(ds.decrypted_secret), '')
    INTO v_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'infonavit_pdf_worker_secret'
  LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'missing_configuration',
      'request_id', NULL
    );
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-concasa-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  )
  INTO v_request_id;

  RETURN jsonb_build_object(
    'status', 'dispatched',
    'request_id', v_request_id
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_pdf_dispatch_worker() IS
  'P189 B4.1: si hay outbox procesable, POST {} al worker via pg_net. Fail-closed sin Vault. Sin PII/claim/PDF.';

REVOKE ALL ON FUNCTION public.infonavit_pdf_dispatch_worker() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.infonavit_pdf_dispatch_worker() FROM anon;
REVOKE ALL ON FUNCTION public.infonavit_pdf_dispatch_worker() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_dispatch_worker() TO postgres;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_dispatch_worker() TO service_role;

DO $m186$
DECLARE
  r RECORD;
  v_jobid bigint;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE NOTICE '186_infonavit_pdf_worker_schedule: skip cron (database=%; pg_cron requiere postgres)',
      current_database();
    RETURN;
  END IF;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '186: pg_cron already present / skip recreate (%): %', SQLSTATE, SQLERRM;
  END;

  GRANT USAGE ON SCHEMA cron TO postgres;

  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'infonavit-pdf-worker-dispatch'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  SELECT cron.schedule(
    'infonavit-pdf-worker-dispatch',
    '* * * * *',
    $cron$SELECT public.infonavit_pdf_dispatch_worker();$cron$
  )
  INTO v_jobid;

  RAISE NOTICE '186: scheduled infonavit-pdf-worker-dispatch jobid=%', v_jobid;
END
$m186$;
