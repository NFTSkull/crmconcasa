-- ConCasa CRM — Inscripción Monterrey: máximo 4 personas/día durante septiembre 2026.
-- Autoridad: Supabase. Ocupación = bookings CRM activos + ocupación manual/externa del Sheet.
-- No modifica/cancela citas existentes. Días ya sobrecap quedan preservados y cerrados a nuevas altas.

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
     AND p_date >= DATE '2026-09-01' THEN
    v_hard_cap := 15;
  ELSIF v_kind = 'inscripcion'
     AND v_location = 'monterrey'
     AND p_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30' THEN
    v_hard_cap := 4;
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
  'Capacidad diaria efectiva. Septiembre 2026: inscripción Monterrey máximo 4; biométricos mantiene hard-cap 15; overrides nunca amplían hard-cap.';


-- El trigger BEFORE ya existe en agenda_bookings. Se amplía de biométricos a
-- inscripción para serializar concurrentes y evitar carreras 3→5.
CREATE OR REPLACE FUNCTION public.agenda_booking_biometricos_daily_lock_bi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text;
  v_location text;
  v_old_location text;
  v_cap integer;
  v_occ integer;
BEGIN
  v_kind := lower(btrim(COALESCE(NEW.kind::text, '')));

  IF v_kind NOT IN ('biometricos', 'inscripcion')
     OR NEW.status::text IS DISTINCT FROM 'booked' THEN
    RETURN NEW;
  END IF;

  v_location := lower(btrim(COALESCE(NEW.location_id, '')));

  -- Un UPDATE que ya era booked y permanece en el mismo scope diario no agrega cupo.
  IF TG_OP = 'UPDATE' THEN
    v_old_location := lower(btrim(COALESCE(OLD.location_id, '')));
    IF lower(btrim(COALESCE(OLD.kind::text, ''))) = v_kind
       AND OLD.status::text = 'booked'
       AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
       AND OLD.booking_date IS NOT DISTINCT FROM NEW.booking_date
       AND v_old_location = v_location THEN
      RETURN NEW;
    END IF;
  END IF;

  v_cap := public.agenda_daily_capacity(
    NEW.organization_id,
    v_kind,
    NEW.booking_date,
    v_location
  );

  IF v_cap IS NOT NULL THEN
    PERFORM public.agenda_advisory_lock_daily_capacity(
      NEW.organization_id,
      v_kind,
      NEW.booking_date,
      v_location
    );

    v_occ := public.agenda_daily_active_occupancy(
      NEW.organization_id,
      v_kind,
      NEW.booking_date,
      v_location
    ) + public.agenda_crm_manual_daily_count(
      NEW.organization_id,
      v_kind,
      NEW.booking_date,
      v_location
    );

    IF v_occ >= v_cap THEN
      IF v_kind = 'inscripcion' THEN
        RAISE EXCEPTION
          'SIN_CUPO_DIA: El cupo diario de inscripción está completo (máximo % personas).', v_cap
          USING ERRCODE = '22023';
      ELSE
        RAISE EXCEPTION
          'SIN_CUPO_DIA: El cupo diario de biométricos está completo (máximo % personas).', v_cap
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- Defensa posterior: respeta el mismo hard-cap y reclama primero las filas
-- físicas canónicas más altas de prioridad (menor sheet_row).
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_claim_ai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv_id UUID;
  v_cap INTEGER;
  v_occ INTEGER;
  v_canonical TEXT;
  v_inventory_location TEXT;
BEGIN
  IF NEW.kind IS NULL OR NEW.kind::TEXT NOT IN ('biometricos', 'firmas', 'inscripcion') THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'booked' THEN
    RETURN NEW;
  END IF;
  IF NOT public.agenda_sheet_inventory_enforced(NEW.booking_date) THEN
    RETURN NEW;
  END IF;
  IF NOT public.agenda_sheet_inventory_applies(NEW.location_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.kind::TEXT = 'firmas' THEN
    IF public.agenda_firmas_daily_cap_contract_enabled(NEW.booking_date) THEN
      v_canonical := public.agenda_firmas_canonical_location_id(NEW.location_id);
      IF v_canonical IS NOT NULL THEN
        v_cap := public.agenda_daily_capacity(
          NEW.organization_id, 'firmas', NEW.booking_date, v_canonical
        );
        IF v_cap IS NOT NULL THEN
          v_occ := public.agenda_firmas_daily_active_occupancy(
            NEW.organization_id, NEW.booking_date, v_canonical
          );
          IF v_occ > v_cap THEN
            RAISE EXCEPTION
              'SIN_CUPO_DIA: El cupo diario de firmas está completo (máximo 15 personas por sede).'
              USING ERRCODE = '22023';
          END IF;
        END IF;
      END IF;
    END IF;
  ELSE
    v_cap := public.agenda_daily_capacity(
      NEW.organization_id, NEW.kind::TEXT, NEW.booking_date, NEW.location_id
    );
    IF v_cap IS NOT NULL THEN
      v_occ := public.agenda_daily_active_occupancy(
        NEW.organization_id, NEW.kind::TEXT, NEW.booking_date, NEW.location_id
      );
      IF v_occ > v_cap THEN
        IF NEW.kind::TEXT = 'inscripcion' THEN
          RAISE EXCEPTION
            'SIN_CUPO_DIA: El cupo diario de inscripción está completo (máximo % personas).', v_cap
            USING ERRCODE = '22023';
        ELSE
          RAISE EXCEPTION
            'SIN_CUPO_DIA: El cupo diario de biométricos está completo (máximo % personas).', v_cap
            USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
  END IF;

  v_inventory_location := NEW.location_id;
  IF NEW.kind::TEXT = 'firmas'
     AND public.agenda_firmas_daily_cap_contract_enabled(NEW.booking_date) THEN
    v_canonical := public.agenda_firmas_canonical_location_id(NEW.location_id);
    IF v_canonical IS NOT NULL THEN
      v_inventory_location := v_canonical;
    END IF;
  END IF;

  IF NEW.kind::TEXT = 'inscripcion' THEN
    SELECT i.id INTO v_inv_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = NEW.organization_id
      AND i.booking_date = NEW.booking_date
      AND i.kind = 'inscripcion'
      AND i.location_id = v_inventory_location
      AND i.status = 'available'
      AND (
        i.sheet_slot_time = TIME '11:00'
        OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
      )
    ORDER BY i.sheet_row ASC NULLS LAST, i.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
  ELSE
    SELECT i.id INTO v_inv_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = NEW.organization_id
      AND i.booking_date = NEW.booking_date
      AND i.kind = NEW.kind::TEXT
      AND i.location_id = v_inventory_location
      AND i.slot_time = NEW.booking_time
      AND i.status = 'available'
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
  END IF;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'claimed',
    booking_id = NEW.id,
    expediente_id = NEW.expediente_id,
    claimed_at = NOW(),
    occupancy_source = 'crm',
    updated_at = NOW()
  WHERE i.id = v_inv_id;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.agenda_booking_biometricos_daily_lock_bi() IS
  'Lock BEFORE por cupo diario para biométricos e inscripción. Inscripción Sep-2026 máximo 4, incluyendo ocupación Sheet/manual.';
COMMENT ON FUNCTION public.agenda_sheet_inventory_claim_ai() IS
  'Claim AFTER booking + defensa hard-cap. Inscripción reclama primero menor sheet_row; CRM + Sheet manual no exceden capacidad diaria.';
