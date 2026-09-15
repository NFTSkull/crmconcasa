-- Mesa INFONAVIT: despacho inmediato y quirúrgico de los 3 PDFs recién solicitados.
-- El cron existente sigue como fallback. No toca expedientes, etapas, citas, cupos ni Sheets.

CREATE OR REPLACE FUNCTION public.infonavit_pdf_dispatch_outbox_now(p_outbox_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, net
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_request_id BIGINT;
  v_allowed BOOLEAN;
BEGIN
  IF p_outbox_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.infonavit_pdf_outbox o
    JOIN public.expediente_infonavit_submission_snapshots s
      ON s.id = o.snapshot_id
    WHERE o.id = p_outbox_id
      AND o.status = 'pending'
      AND s.submission_kind = 'mesa_manual'
  )
  INTO v_allowed;

  IF NOT COALESCE(v_allowed, false) THEN
    RETURN NULL;
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
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-concasa-worker-secret', v_secret
    ),
    body := jsonb_build_object('outbox_id', p_outbox_id),
    timeout_milliseconds := 25000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

COMMENT ON FUNCTION public.infonavit_pdf_dispatch_outbox_now(UUID) IS
  'Despacha inmediatamente un outbox mesa_manual específico al worker INFONAVIT; cron global permanece como fallback.';

REVOKE ALL ON FUNCTION public.infonavit_pdf_dispatch_outbox_now(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_dispatch_outbox_now(UUID)
  TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_dispatch_mesa_insert_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM public.infonavit_pdf_dispatch_outbox_now(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.infonavit_pdf_dispatch_mesa_insert_trigger()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_dispatch_mesa_insert_trigger()
  TO postgres, service_role;

DROP TRIGGER IF EXISTS infonavit_pdf_dispatch_mesa_on_insert
  ON public.infonavit_pdf_outbox;

CREATE TRIGGER infonavit_pdf_dispatch_mesa_on_insert
AFTER INSERT ON public.infonavit_pdf_outbox
FOR EACH ROW
WHEN (NEW.status = 'pending')
EXECUTE FUNCTION public.infonavit_pdf_dispatch_mesa_insert_trigger();
