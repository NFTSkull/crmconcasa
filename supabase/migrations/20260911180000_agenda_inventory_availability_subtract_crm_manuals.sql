-- ConCasa CRM: alinear cupos UI con el hard-gate de book.
-- Bug: agenda_sheet_inventory_availability contaba filas status=available
-- sin restar agenda_manual_occupancies (manual_crm), mientras
-- agenda_sheet_inventory_available_count (usado en book/assert) sí las resta.
-- Resultado: UI "1 lugar disponible" + book → SIN_CUPO_REAL_EN_SHEET.
-- Read-model only. 0 writers. Sin tocar Sheets/cupos físicos/RLS.

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_availability(
  p_kind TEXT,
  p_date DATE,
  p_location_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_kind TEXT;
  v_loc TEXT;
  v_enforced BOOLEAN;
  v_fresh BOOLEAN;
  v_slots JSONB := '[]'::JSONB;
  v_capacity INT := 0;
  v_available INT := 0;
  v_occupied INT := 0;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.active = true;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind NOT IN ('biometricos', 'firmas', 'inscripcion') THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: kind inválido'
      USING ERRCODE = '22023';
  END IF;

  v_loc := lower(btrim(COALESCE(p_location_id, '')));
  IF v_loc NOT IN ('monterrey', 'apodaca') THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: sede inválida'
      USING ERRCODE = '22023';
  END IF;

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: fecha inválida'
      USING ERRCODE = '22023';
  END IF;

  v_enforced := public.agenda_sheet_inventory_enforced(p_date);
  v_fresh := public.agenda_sheet_inventory_fresh(v_org, p_date);

  IF v_enforced AND NOT v_fresh THEN
    RETURN jsonb_build_object(
      'ok', true,
      'fresh', false,
      'enforced', true,
      'slots', '[]'::JSONB,
      'capacity', 0,
      'available', 0,
      'occupied', 0,
      'daily_capacity', public.agenda_daily_capacity(v_org, v_kind, p_date, v_loc),
      'daily_occupancy', public.agenda_daily_active_occupancy(v_org, v_kind, p_date, v_loc),
      'daily_remaining', public.agenda_daily_remaining(v_org, v_kind, p_date, v_loc),
      'fixed_time', CASE WHEN v_kind = 'inscripcion' THEN '11:00' ELSE NULL END,
      'kind', v_kind,
      'booking_date', p_date,
      'location_id', v_loc
    );
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'slot_time', to_char(s.slot_time, 'HH24:MI:SS'),
      'sheet_slot_time', to_char(s.sheet_slot_time, 'HH24:MI:SS'),
      -- Misma semántica que agenda_sheet_inventory_available_count (resta manuals CRM).
      'available', public.agenda_sheet_inventory_available_count(
        v_org, v_kind, p_date, s.slot_time, v_loc
      ),
      'physical_total', s.physical_total,
      'capacity', s.physical_total,
      'occupied', GREATEST(
        s.physical_total - public.agenda_sheet_inventory_available_count(
          v_org, v_kind, p_date, s.slot_time, v_loc
        ),
        0
      ),
      'occupied_external', s.occupied_external,
      'claimed', s.claimed,
      'linked', s.linked,
      'disabled', s.disabled
    )
    ORDER BY s.slot_time
  ), '[]'::JSONB)
  INTO v_slots
  FROM (
    SELECT
      i.slot_time,
      MIN(COALESCE(i.sheet_slot_time, i.slot_time)) AS sheet_slot_time,
      COUNT(*) FILTER (WHERE i.status IS DISTINCT FROM 'disabled')::INTEGER AS physical_total,
      COUNT(*) FILTER (WHERE i.status = 'occupied_external')::INTEGER AS occupied_external,
      COUNT(*) FILTER (WHERE i.status = 'claimed')::INTEGER AS claimed,
      COUNT(*) FILTER (WHERE i.status = 'linked')::INTEGER AS linked,
      COUNT(*) FILTER (WHERE i.status = 'disabled')::INTEGER AS disabled
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = v_org
      AND i.kind = v_kind
      AND i.booking_date = p_date
      AND i.location_id = v_loc
      AND (
        v_kind <> 'inscripcion'
        OR i.sheet_slot_time = TIME '11:00'
        OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
      )
    GROUP BY i.slot_time
  ) s;

  SELECT
    COALESCE(SUM((s->>'physical_total')::INT), 0)::INT,
    COALESCE(SUM((s->>'available')::INT), 0)::INT
  INTO v_capacity, v_available
  FROM jsonb_array_elements(COALESCE(v_slots, '[]'::JSONB)) s;

  v_occupied := GREATEST(v_capacity - v_available, 0);

  RETURN jsonb_build_object(
    'ok', true,
    'fresh', v_fresh,
    'enforced', v_enforced,
    'slots', COALESCE(v_slots, '[]'::JSONB),
    'capacity', v_capacity,
    'available', v_available,
    'occupied', v_occupied,
    'daily_capacity', public.agenda_daily_capacity(v_org, v_kind, p_date, v_loc),
    'daily_occupancy', public.agenda_daily_active_occupancy(v_org, v_kind, p_date, v_loc),
    'daily_remaining', public.agenda_daily_remaining(v_org, v_kind, p_date, v_loc),
    'daily_overcapacity', COALESCE(public.agenda_daily_active_occupancy(v_org, v_kind, p_date, v_loc), 0)
      > COALESCE(public.agenda_daily_capacity(v_org, v_kind, p_date, v_loc), 2147483647),
    'fixed_time', CASE WHEN v_kind = 'inscripcion' THEN '11:00' ELSE NULL END,
    'kind', v_kind,
    'booking_date', p_date,
    'location_id', v_loc
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT) IS
  'Cupo real por slot: available = inventory available_count (resta manuals CRM). Paridad con hard-gate book.';

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT)
  TO authenticated, service_role, postgres;
