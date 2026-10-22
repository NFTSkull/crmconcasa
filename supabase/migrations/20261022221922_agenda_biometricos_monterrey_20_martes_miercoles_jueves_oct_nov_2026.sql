-- Versión aplicada a producción 20261022221922. ConCasa, biométricos Monterrey 20 en fechas precisas.
-- Otros días y sedes permanecen 15. Excepciones previas de octubre 13-15 continúan.
ALTER TABLE public.agenda_daily_capacity_overrides DROP CONSTRAINT IF EXISTS agenda_daily_capacity_overrides_bio_hard_cap;
ALTER TABLE public.agenda_daily_capacity_overrides ADD CONSTRAINT agenda_daily_capacity_overrides_bio_hard_cap
CHECK (NOT(lower(btrim(kind))='biometricos' AND lower(btrim(location_id)) IN ('monterrey','apodaca') AND slot_date>=DATE '2026-09-01')
 OR capacity<=15
 OR (organization_id='50beae49-3961-4163-8e78-2251693f2c19'::uuid
 AND lower(btrim(kind))='biometricos' AND lower(btrim(location_id))='monterrey'
 AND slot_date IN (DATE '2026-10-13',DATE '2026-10-14',DATE '2026-10-15',DATE '2026-10-27',DATE '2026-10-28',DATE '2026-10-29',DATE '2026-11-03',DATE '2026-11-04',DATE '2026-11-05',DATE '2026-11-10',DATE '2026-11-11',DATE '2026-11-12',DATE '2026-11-17',DATE '2026-11-18',DATE '2026-11-19',DATE '2026-11-24',DATE '2026-11-25',DATE '2026-11-26') AND capacity<=20));
CREATE OR REPLACE FUNCTION public.agenda_daily_capacity(p_org uuid, p_kind text, p_date date, p_location text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

  IF v_kind = 'biometricos'
     AND v_location IN ('monterrey', 'apodaca')
     AND p_date >= DATE '2026-09-01' THEN
    v_hard_cap := CASE
      WHEN v_location = 'monterrey'
       AND p_org = '50beae49-3961-4163-8e78-2251693f2c19'::uuid
       AND p_date IN (DATE '2026-10-13', DATE '2026-10-14', DATE '2026-10-15', DATE '2026-10-27', DATE '2026-10-28', DATE '2026-10-29', DATE '2026-11-03', DATE '2026-11-04', DATE '2026-11-05', DATE '2026-11-10', DATE '2026-11-11', DATE '2026-11-12', DATE '2026-11-17', DATE '2026-11-18', DATE '2026-11-19', DATE '2026-11-24', DATE '2026-11-25', DATE '2026-11-26')
      THEN 20
      ELSE 15 END;
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
  WHERE lower(btrim(r.kind)) = v_kind
    AND lower(btrim(r.location_id)) = v_location
  LIMIT 1;

  IF v_hard_cap IS NOT NULL THEN
    RETURN LEAST(COALESCE(v_capacity, v_hard_cap), v_hard_cap);
  END IF;

  RETURN v_capacity;
END;
$function$;
INSERT INTO public.agenda_daily_capacity_overrides(organization_id,kind,location_id,slot_date,capacity,note,created_at,updated_at)
SELECT '50beae49-3961-4163-8e78-2251693f2c19'::uuid,'biometricos','monterrey',v.d::date,20,
 'Excepción temporal autorizada: 20 biométricos en Monterrey (10 a las 8:00 y 10 a las 9:00), solo fecha indicada.',now(),now()
FROM (VALUES ('2026-10-27'),('2026-10-28'),('2026-10-29'),('2026-11-03'),('2026-11-04'),('2026-11-05'),('2026-11-10'),('2026-11-11'),('2026-11-12'),('2026-11-17'),('2026-11-18'),('2026-11-19'),('2026-11-24'),('2026-11-25'),('2026-11-26')) v(d)
ON CONFLICT (organization_id,kind,location_id,slot_date)
DO UPDATE SET capacity=EXCLUDED.capacity,note=EXCLUDED.note,updated_at=now();
