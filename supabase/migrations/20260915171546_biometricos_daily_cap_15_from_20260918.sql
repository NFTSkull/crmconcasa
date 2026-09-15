-- ConCasa CRM — Biométricos: hard-cap diario = 15 desde 2026-09-18.
-- No cancela ni mueve citas existentes. Si un día ya supera 15, remaining=0.
-- Respeta overrides menores y conserva intactos los días anteriores al corte.

CREATE OR REPLACE FUNCTION public.agenda_daily_capacity(
  p_org uuid,
  p_kind text,
  p_date date,
  p_location text
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text;
  v_location text;
  v_capacity integer;
  v_hard_cap integer;
BEGIN
  v_kind := lower(btrim(COALESCE(p_kind, '')));
  v_location := lower(btrim(COALESCE(p_location, '')));

  IF v_kind = 'firmas'
     AND NOT public.agenda_firmas_daily_cap_contract_enabled(p_date) THEN
    RETURN NULL;
  END IF;

  -- Desde 2026-09-18, Biométricos en las sedes operativas del calendario
  -- nunca puede ofrecer más de 15 lugares diarios. Un override menor se respeta.
  IF v_kind = 'biometricos'
     AND v_location IN ('monterrey', 'apodaca')
     AND p_date >= DATE '2026-09-18' THEN
    v_hard_cap := 15;
  END IF;

  SELECT o.capacity
    INTO v_capacity
  FROM public.agenda_daily_capacity_overrides o
  WHERE o.organization_id = p_org
    AND lower(btrim(o.kind)) = v_kind
    AND lower(btrim(o.location_id)) = v_location
    AND o.slot_date = p_date
  LIMIT 1;

  IF FOUND THEN
    IF v_hard_cap IS NOT NULL THEN
      RETURN LEAST(v_capacity, v_hard_cap);
    END IF;
    RETURN v_capacity;
  END IF;

  SELECT r.capacity
    INTO v_capacity
  FROM public.agenda_daily_capacity_rules r
  WHERE r.kind = v_kind
    AND r.location_id = v_location
  LIMIT 1;

  IF v_hard_cap IS NOT NULL THEN
    RETURN LEAST(COALESCE(v_capacity, v_hard_cap), v_hard_cap);
  END IF;

  RETURN v_capacity;
END;
$function$;
