-- P217: seguimiento de intentos auto-reprecalificar (reintentos cron).
-- Espejo de auto_precal_intentos (P214) pero keyed por intento de reprecal.
-- Solo service_role escribe/lee vía API route; no otorga a anon/authenticated.

CREATE TABLE IF NOT EXISTS public.auto_reprecal_intentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intento_id uuid NOT NULL REFERENCES public.expediente_precalificacion_intentos (id) ON DELETE CASCADE,
  intentado_en timestamptz NOT NULL DEFAULT now(),
  resultado text NOT NULL,
  razon text NULL,
  CONSTRAINT auto_reprecal_intentos_resultado_chk CHECK (
    resultado IN ('aprobado', 'no_cumple', 'pending_error')
  )
);

CREATE INDEX IF NOT EXISTS auto_reprecal_intentos_intento_id_idx
  ON public.auto_reprecal_intentos (intento_id);

CREATE INDEX IF NOT EXISTS auto_reprecal_intentos_intento_intentado_idx
  ON public.auto_reprecal_intentos (intento_id, intentado_en DESC);

COMMENT ON TABLE public.auto_reprecal_intentos IS
  'P217: historial de corridas auto-reprecalificar (scraper). Base para reintentos cron solo si hubo scraper_failed.';

ALTER TABLE public.auto_reprecal_intentos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auto_reprecal_intentos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.auto_reprecal_intentos TO service_role;
