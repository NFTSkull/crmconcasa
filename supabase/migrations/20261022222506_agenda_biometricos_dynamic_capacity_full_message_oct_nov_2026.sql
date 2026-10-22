-- Versión aplicada a producción 20261022222506. Muestra cupo real (15 o 20) al completarse.
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_gate_after_config_assert(p_org uuid, p_kind text, p_date date, p_time time without time zone, p_location text, p_config_capacity integer, p_booked_count integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_available INTEGER;
  v_effective INTEGER;
  v_daily INTEGER;
  v_capacity_daily INTEGER;
  v_inventory_location TEXT;
  v_canonical TEXT;
BEGIN
  v_inventory_location := p_location;
  IF lower(btrim(COALESCE(p_kind, ''))) = 'firmas'
     AND public.agenda_firmas_daily_cap_contract_enabled(p_date) THEN
    v_canonical := public.agenda_firmas_canonical_location_id(p_location);
    IF v_canonical IS NOT NULL THEN
      v_inventory_location := v_canonical;
    END IF;
  END IF;

  PERFORM public.agenda_sheet_assert_inventory_allows_booking(
    p_org, p_kind, p_date, p_time, v_inventory_location
  );

  IF NOT public.agenda_sheet_inventory_enforced(p_date) THEN
    RETURN;
  END IF;
  IF NOT public.agenda_sheet_inventory_applies(v_inventory_location) THEN
    RETURN;
  END IF;

  v_available := public.agenda_sheet_inventory_available_count(
    p_org, p_kind, p_date, p_time, v_inventory_location
  );

  v_effective := LEAST(
    GREATEST(COALESCE(p_config_capacity, 0) - COALESCE(p_booked_count, 0), 0),
    COALESCE(v_available, 0)
  );

  IF v_effective < 1 THEN
    RAISE EXCEPTION
      'SIN_CUPO_REAL_EN_SHEET: Ese horario acaba de ocuparse. Selecciona otro disponible.'
      USING ERRCODE = '22023';
  END IF;

  -- Firmas: daily cap SOLO con contrato ON. Nunca caer al path biométricos.
  IF lower(btrim(COALESCE(p_kind, ''))) = 'firmas' THEN
    IF public.agenda_firmas_daily_cap_contract_enabled(p_date) THEN
      v_canonical := public.agenda_firmas_canonical_location_id(p_location);
      IF v_canonical IS NOT NULL THEN
        v_daily := public.agenda_firmas_daily_remaining(p_org, p_date, v_canonical);
        IF v_daily IS NOT NULL AND v_daily < 1 THEN
          RAISE EXCEPTION
            'SIN_CUPO_DIA: El cupo diario de firmas está completo (máximo 15 personas por sede).'
            USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  v_daily := public.agenda_daily_remaining(p_org, p_kind, p_date, p_location);
  IF v_daily IS NOT NULL AND v_daily < 1 THEN
    v_capacity_daily := public.agenda_daily_capacity(p_org,p_kind,p_date,p_location);
    RAISE EXCEPTION
      'SIN_CUPO_DIA: El cupo diario de biométricos Monterrey está completo (máximo % personas).',
      COALESCE(v_capacity_daily,15)
      USING ERRCODE = '22023';
  END IF;
END;
$function$;
