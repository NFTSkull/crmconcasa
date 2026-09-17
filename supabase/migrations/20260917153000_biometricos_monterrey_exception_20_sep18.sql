-- ConCasa CRM — excepción extraordinaria Biométricos Monterrey.
-- 2026-09-18: máximo 20. Desde 2026-09-19: máximo 15.
-- LEO/HACER PAGARÉS y Apodaca no forman parte de este tope de Monterrey.

INSERT INTO public.agenda_daily_capacity_overrides (
  organization_id,
  kind,
  location_id,
  slot_date,
  capacity,
  created_at,
  updated_at
)
VALUES (
  '50beae49-3961-4163-8e78-2251693f2c19'::uuid,
  'biometricos',
  'monterrey',
  DATE '2026-09-18',
  20,
  now(),
  now()
)
ON CONFLICT (organization_id, kind, location_id, slot_date)
DO UPDATE SET capacity = EXCLUDED.capacity, updated_at = now();

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

  -- Biométricos Monterrey solamente:
  -- excepción extraordinaria 2026-09-18 = 20;
  -- desde 2026-09-19 = 15. Apodaca conserva su propia regla independiente.
  IF v_kind = 'biometricos' AND v_location = 'monterrey' THEN
    IF p_date = DATE '2026-09-18' THEN
      v_hard_cap := 20;
    ELSIF p_date >= DATE '2026-09-19' THEN
      v_hard_cap := 15;
    END IF;
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
