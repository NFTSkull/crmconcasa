-- ConCasa CRM — blindaje definitivo Biométricos: máximo diario 15.
-- Conserva únicamente la excepción histórica Monterrey 2026-09-18 = 20.
-- Desde 2026-09-19 Monterrey y desde 2026-09-18 Apodaca quedan hard-capped a 15;
-- por lo tanto 2026-09-21 y cualquier fecha posterior nunca puede exceder 15.

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

  IF v_kind = 'biometricos'
     AND v_location IN ('monterrey', 'apodaca')
     AND p_date >= DATE '2026-09-18' THEN
    v_hard_cap := 15;
  END IF;

  -- Única excepción histórica autorizada.
  IF v_kind = 'biometricos'
     AND v_location = 'monterrey'
     AND p_date = DATE '2026-09-18' THEN
    v_hard_cap := 20;
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

COMMENT ON FUNCTION public.agenda_daily_capacity(uuid,text,date,text) IS
  'Capacidad diaria efectiva con hard-cap Biométricos: Monterrey/Apodaca <=15 desde 2026-09-18, excepto Monterrey 2026-09-18 <=20.';

-- La regla recurrente nunca puede declarar >15 para Biométricos en sedes operativas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agenda_daily_capacity_rules_bio_all_max_15'
      AND conrelid = 'public.agenda_daily_capacity_rules'::regclass
  ) THEN
    ALTER TABLE public.agenda_daily_capacity_rules
      ADD CONSTRAINT agenda_daily_capacity_rules_bio_all_max_15
      CHECK (
        NOT (
          lower(btrim(kind)) = 'biometricos'
          AND lower(btrim(location_id)) IN ('monterrey','apodaca')
        )
        OR capacity <= 15
      );
  END IF;
END
$$;

-- Overrides tampoco pueden abrir >15, salvo la excepción histórica Monterrey 18/09 = 20.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agenda_daily_capacity_overrides_bio_hard_cap'
      AND conrelid = 'public.agenda_daily_capacity_overrides'::regclass
  ) THEN
    ALTER TABLE public.agenda_daily_capacity_overrides
      ADD CONSTRAINT agenda_daily_capacity_overrides_bio_hard_cap
      CHECK (
        NOT (
          lower(btrim(kind)) = 'biometricos'
          AND lower(btrim(location_id)) IN ('monterrey','apodaca')
          AND slot_date >= DATE '2026-09-18'
        )
        OR capacity <= CASE
          WHEN lower(btrim(location_id)) = 'monterrey'
               AND slot_date = DATE '2026-09-18' THEN 20
          ELSE 15
        END
      );
  END IF;
END
$$;

-- Gate BEFORE INSERT: serializa por día/sede y rechaza el intento #16 antes de insertarlo.
-- Cuenta CRM + ocupación externa de Sheet + manual CRM sin reconciliar.
CREATE OR REPLACE FUNCTION public.agenda_booking_biometricos_daily_lock_bi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_location text;
  v_cap integer;
  v_occ integer;
BEGIN
  IF NEW.kind::text IS DISTINCT FROM 'biometricos'
     OR NEW.status::text IS DISTINCT FROM 'booked' THEN
    RETURN NEW;
  END IF;

  v_location := lower(btrim(COALESCE(NEW.location_id, '')));
  v_cap := public.agenda_daily_capacity(
    NEW.organization_id,
    'biometricos',
    NEW.booking_date,
    v_location
  );

  IF v_cap IS NOT NULL THEN
    PERFORM public.agenda_advisory_lock_daily_capacity(
      NEW.organization_id,
      'biometricos',
      NEW.booking_date,
      v_location
    );

    v_occ := public.agenda_daily_active_occupancy(
      NEW.organization_id,
      'biometricos',
      NEW.booking_date,
      v_location
    ) + public.agenda_crm_manual_daily_count(
      NEW.organization_id,
      'biometricos',
      NEW.booking_date,
      v_location
    );

    IF v_occ >= v_cap THEN
      RAISE EXCEPTION
        'SIN_CUPO_DIA: El cupo diario de biométricos está completo (máximo % personas).', v_cap
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.agenda_booking_biometricos_daily_lock_bi() IS
  'BEFORE INSERT hard gate Biométricos: advisory lock diario + ocupación total; impide insertar la cita #16 incluso si otra capa falla.';
