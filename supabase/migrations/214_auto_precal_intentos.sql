-- P214: seguimiento de intentos auto-precalificar (reintentos cron).
-- Solo service_role escribe/lee vía API route; no otorga a anon/authenticated.

CREATE TABLE IF NOT EXISTS public.auto_precal_intentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expediente_id uuid NOT NULL REFERENCES public.expedientes (id) ON DELETE CASCADE,
  intentado_en timestamptz NOT NULL DEFAULT now(),
  resultado text NOT NULL,
  razon text NULL,
  CONSTRAINT auto_precal_intentos_resultado_chk CHECK (
    resultado IN ('aprobado', 'no_cumple', 'pending_error')
  )
);

CREATE INDEX IF NOT EXISTS auto_precal_intentos_expediente_id_idx
  ON public.auto_precal_intentos (expediente_id);

CREATE INDEX IF NOT EXISTS auto_precal_intentos_expediente_intentado_idx
  ON public.auto_precal_intentos (expediente_id, intentado_en DESC);

COMMENT ON TABLE public.auto_precal_intentos IS
  'P214: historial de corridas auto-precalificar (scraper). Base para reintentos cron solo si hubo scraper_failed.';

ALTER TABLE public.auto_precal_intentos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auto_precal_intentos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.auto_precal_intentos TO service_role;
