CREATE TABLE IF NOT EXISTS public.auto_precal_scraper_lease (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.auto_precal_scraper_lease (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.auto_precal_scraper_lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_precal_scraper_lease FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auto_precal_scraper_lease FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.auto_precal_scraper_lease TO service_role;

CREATE OR REPLACE FUNCTION public.auto_precal_scraper_try_claim(
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 180
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_claimed boolean := false;
BEGIN
  IF p_owner_token IS NULL THEN
    RAISE EXCEPTION 'auto_precal_scraper_try_claim: owner token requerido'
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'auto_precal_scraper_try_claim: lease fuera de rango'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.auto_precal_scraper_lease (singleton)
  VALUES (true)
  ON CONFLICT (singleton) DO NOTHING;

  UPDATE public.auto_precal_scraper_lease
  SET owner_token = p_owner_token,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE singleton = true
    AND (
      lease_until IS NULL
      OR lease_until <= now()
      OR owner_token = p_owner_token
    )
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_precal_scraper_release(
  p_owner_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_owner_token IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.auto_precal_scraper_lease
  SET owner_token = NULL,
      lease_until = NULL,
      updated_at = now()
  WHERE singleton = true
    AND owner_token = p_owner_token;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_precal_scraper_try_claim(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_precal_scraper_release(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_precal_scraper_try_claim(uuid, integer) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.auto_precal_scraper_release(uuid) TO service_role, postgres;

COMMENT ON TABLE public.auto_precal_scraper_lease IS
  'Lease singleton para serializar navegaciones Infonavit contra el scraper Railway compartido.';
COMMENT ON FUNCTION public.auto_precal_scraper_try_claim(uuid, integer) IS
  'Claim atómico del scraper global. Expira automáticamente para recuperación ante crash.';
COMMENT ON FUNCTION public.auto_precal_scraper_release(uuid) IS
  'Libera el lease global solo si el owner token coincide.';
