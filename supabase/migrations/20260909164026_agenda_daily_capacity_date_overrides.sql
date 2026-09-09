CREATE TABLE IF NOT EXISTS public.agenda_daily_capacity_overrides (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (btrim(kind) <> ''),
  location_id text NOT NULL CHECK (btrim(location_id) <> ''),
  slot_date date NOT NULL,
  capacity integer NOT NULL CHECK (capacity >= 1 AND capacity <= 100),
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, kind, location_id, slot_date)
);

ALTER TABLE public.agenda_daily_capacity_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_daily_capacity_overrides FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS agenda_daily_capacity_overrides_date_idx
  ON public.agenda_daily_capacity_overrides (slot_date, kind, location_id);

COMMENT ON TABLE public.agenda_daily_capacity_overrides IS
  'Override excepcional de capacidad diaria por organización/tipo/sede/fecha. Sin fila = usa regla recurrente.';

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
BEGIN
  v_kind := lower(btrim(COALESCE(p_kind, '')));
  v_location := lower(btrim(COALESCE(p_location, '')));

  IF v_kind = 'firmas'
     AND NOT public.agenda_firmas_daily_cap_contract_enabled(p_date) THEN
    RETURN NULL;
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
    RETURN v_capacity;
  END IF;

  RETURN (
    SELECT r.capacity
    FROM public.agenda_daily_capacity_rules r
    WHERE r.kind = v_kind
      AND r.location_id = v_location
    LIMIT 1
  );
END;
$function$;

COMMENT ON FUNCTION public.agenda_daily_capacity(uuid,text,date,text) IS
  'Capacidad diaria efectiva: override exacto por fecha si existe; si no, regla recurrente. Firmas conserva contrato existente.';
