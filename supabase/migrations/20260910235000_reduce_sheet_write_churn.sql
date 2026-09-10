-- ConCasa CRM — contención de write-churn de Google Sheets
-- Objetivo: bajar WAL / Disk I/O / autovacuum sin cambiar la semántica operativa.
--
-- 1) agenda_sheet_operational_results recibe reconciliaciones repetidas del mismo
--    estado. Hoy cada observación idéntica genera UPDATE solo por last_seen_at /
--    updated_at, WAL y evento Realtime. Conservamos un heartbeat máximo cada 6 h,
--    pero cualquier cambio real de negocio sigue escribiéndose inmediatamente.
-- 2) El cron CRM→Sheets corre cada minuto aunque el outbox esté vacío. Evitamos el
--    HTTP/pg_net no-op y mantenemos exactamente el mismo claim cuando sí hay trabajo.
--
-- NO toca agenda_sheet_slot_inventory: sus timestamps participan en gates de
-- frescura/capacidad y se preservan intactos.

CREATE OR REPLACE FUNCTION public.agenda_sheet_ops_suppress_recent_timestamp_only_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Comparación NULL-safe de toda la fila salvo los dos timestamps de observación.
  -- Si cualquier otro campo cambia (incluido apply metadata), el UPDATE pasa.
  IF (
    (to_jsonb(NEW) - ARRAY['last_seen_at', 'updated_at']::text[])
      IS NOT DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['last_seen_at', 'updated_at']::text[])
  )
  AND COALESCE(OLD.updated_at, OLD.last_seen_at, '-infinity'::timestamptz)
        >= clock_timestamp() - interval '6 hours'
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_agenda_sheet_ops_suppress_recent_timestamp_only_update
  ON public.agenda_sheet_operational_results;

CREATE TRIGGER trg_agenda_sheet_ops_suppress_recent_timestamp_only_update
BEFORE UPDATE ON public.agenda_sheet_operational_results
FOR EACH ROW
EXECUTE FUNCTION public.agenda_sheet_ops_suppress_recent_timestamp_only_update();

COMMENT ON FUNCTION public.agenda_sheet_ops_suppress_recent_timestamp_only_update() IS
  'P225 perf: suprime UPDATEs repetidos que solo refrescan last_seen_at/updated_at durante 6h; cambios de negocio/apply pasan siempre.';

CREATE OR REPLACE FUNCTION public.agenda_sheet_invoke_sync_worker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
  v_has_work BOOLEAN;
  v_base TEXT;
  v_secret TEXT;
  v_url TEXT;
  v_request_id bigint;
BEGIN
  -- Mismo universo reclamable que agenda_sheet_claim_outbox(). También despierta
  -- el worker si existe un processing abandonado para que el claim lo recupere.
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_sheet_sync_outbox o
    WHERE (
      o.status IN ('pending', 'failed')
      AND o.attempts < o.max_attempts
      AND o.available_at <= NOW()
    )
    OR (
      o.status = 'processing'
      AND o.updated_at < NOW() - INTERVAL '10 minutes'
    )
  )
  INTO v_has_work;

  IF NOT COALESCE(v_has_work, false) THEN
    RETURN NULL;
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.agenda_sheet_invoke_sync_worker()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_invoke_sync_worker()
  TO postgres, service_role;

COMMENT ON FUNCTION public.agenda_sheet_invoke_sync_worker() IS
  'P225 perf: cron cada minuto no invoca Edge/pg_net si el outbox no tiene trabajo reclamable; comportamiento de claim intacto cuando sí hay trabajo.';
