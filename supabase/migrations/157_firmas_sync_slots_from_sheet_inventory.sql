-- ConCasa CRM — Hotfix firmas 09:30 inventario Sheet → config (P158)
-- Causa Cloud (2026-08-07 Monterrey): inventario tiene 09:30×3 y 10:00×3 available,
-- pero agenda_config.firmas.slots omite 09:30 y capacity_by_time['10:00']=0 cierra el cupo.
--
-- Reglas:
-- 1) Capacidad al ABRIR = MAX de filas físicas por (sede,hora,fecha). NUNCA `available`.
-- 2) Open-only aditivo: solo escribe si la clave falta o está en 0.
--    Si capacidad existente > 0 → se conserva (no inflar con otros días; no reducir).
--    nueva = GREATEST(existente, físico) cuando se abre (existente 0 → físico).
-- 3) slots: agregar faltantes desde inventario firmas, conservar, ordenar HH:MM.
-- 4) No toca agenda_bookings, expedientes, etapas, Sheets, biométricos.
-- 5) Idempotente. Grants: service_role/postgres only.

BEGIN;

CREATE OR REPLACE FUNCTION public.agenda_firmas_sync_slots_from_sheet_inventory(
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_cfg JSONB;
  v_slots JSONB;
  v_locations JSONB;
  v_loc_id TEXT;
  v_loc JSONB;
  v_cbt JSONB;
  v_times TEXT[];
  v_time TEXT;
  v_phys INTEGER;
  v_existing INTEGER;
  v_new INTEGER;
  v_changed BOOLEAN;
  v_orgs_touched INTEGER := 0;
  v_report JSONB := '[]'::JSONB;
  v_sorted JSONB;
  v_has_key BOOLEAN;
BEGIN
  FOR r IN
    SELECT c.id, c.organization_id, c.config
    FROM public.agenda_config c
    WHERE c.kind = 'firmas'
      AND (p_organization_id IS NULL OR c.organization_id = p_organization_id)
  LOOP
    v_cfg := COALESCE(r.config, '{}'::JSONB);
    v_slots := COALESCE(v_cfg->'slots', '[]'::JSONB);
    IF jsonb_typeof(v_slots) <> 'array' THEN
      v_slots := '[]'::JSONB;
    END IF;
    v_locations := COALESCE(v_cfg->'locations', '{}'::JSONB);
    IF jsonb_typeof(v_locations) <> 'object' THEN
      CONTINUE;
    END IF;

    v_changed := false;

    SELECT COALESCE(
      array_agg(DISTINCT to_char(i.slot_time, 'HH24:MI') ORDER BY to_char(i.slot_time, 'HH24:MI')),
      ARRAY[]::TEXT[]
    )
    INTO v_times
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = r.organization_id
      AND i.kind = 'firmas'
      AND i.booking_date >= (CURRENT_DATE - 14)
      AND i.status IS DISTINCT FROM 'disabled';

    FOREACH v_time IN ARRAY v_times
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_slots) s WHERE s = v_time
      ) THEN
        v_slots := v_slots || to_jsonb(v_time);
        v_changed := true;
      END IF;
    END LOOP;

    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t), '[]'::JSONB)
    INTO v_sorted
    FROM (
      SELECT DISTINCT s AS t
      FROM jsonb_array_elements_text(v_slots) s
      WHERE s ~ '^\d{2}:\d{2}$'
    ) d;
    IF v_sorted IS DISTINCT FROM v_slots THEN
      v_slots := v_sorted;
      v_changed := true;
    END IF;

    FOR v_loc_id IN SELECT jsonb_object_keys(v_locations)
    LOOP
      IF v_loc_id NOT IN ('monterrey', 'apodaca') THEN
        CONTINUE;
      END IF;
      v_loc := v_locations->v_loc_id;
      v_cbt := COALESCE(v_loc->'capacity_by_time', '{}'::JSONB);
      IF jsonb_typeof(v_cbt) <> 'object' THEN
        v_cbt := '{}'::JSONB;
      END IF;

      FOREACH v_time IN ARRAY v_times
      LOOP
        -- Capacidad física observada = MAX de filas por fecha (sede+hora). No available.
        SELECT COALESCE(MAX(per_day.cnt), 0)::INTEGER
        INTO v_phys
        FROM (
          SELECT i.booking_date, COUNT(*)::INTEGER AS cnt
          FROM public.agenda_sheet_slot_inventory i
          WHERE i.organization_id = r.organization_id
            AND i.kind = 'firmas'
            AND i.location_id = v_loc_id
            AND to_char(i.slot_time, 'HH24:MI') = v_time
            AND i.booking_date >= CURRENT_DATE
            AND i.status IS DISTINCT FROM 'disabled'
          GROUP BY i.booking_date
        ) per_day;

        IF v_phys < 1 THEN
          CONTINUE;
        END IF;

        v_has_key := (v_cbt ? v_time);
        IF v_has_key THEN
          BEGIN
            v_existing := COALESCE((v_cbt->>v_time)::INTEGER, 0);
          EXCEPTION WHEN others THEN
            v_existing := 0;
          END;
        ELSE
          v_existing := 0;
        END IF;

        -- Open-only: no tocar capacidades ya > 0 (no reducir, no inflar).
        IF v_has_key AND v_existing > 0 THEN
          CONTINUE;
        END IF;

        -- Abrir faltante o 0 con filas físicas: GREATEST(0, físico) = físico.
        v_new := GREATEST(v_existing, v_phys);
        IF (NOT v_has_key) OR v_new IS DISTINCT FROM v_existing THEN
          v_cbt := jsonb_set(v_cbt, ARRAY[v_time], to_jsonb(v_new), true);
          v_changed := true;
        END IF;
      END LOOP;

      v_loc := jsonb_set(v_loc, '{capacity_by_time}', v_cbt, true);
      v_locations := jsonb_set(v_locations, ARRAY[v_loc_id], v_loc, true);
    END LOOP;

    IF v_changed THEN
      v_cfg := jsonb_set(v_cfg, '{slots}', v_slots, true);
      v_cfg := jsonb_set(v_cfg, '{locations}', v_locations, true);
      UPDATE public.agenda_config
      SET config = v_cfg, updated_at = NOW()
      WHERE id = r.id;
      v_orgs_touched := v_orgs_touched + 1;
      v_report := v_report || jsonb_build_array(jsonb_build_object(
        'organization_id', r.organization_id,
        'slots', v_slots,
        'updated', true
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'orgs_touched', v_orgs_touched,
    'details', v_report
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_firmas_sync_slots_from_sheet_inventory(UUID) IS
  'P158 hotfix firmas: abre slots/cupos faltantes o en 0 desde filas físicas (nunca available). Sin bookings ni Sheets.';

REVOKE ALL ON FUNCTION public.agenda_firmas_sync_slots_from_sheet_inventory(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_sync_slots_from_sheet_inventory(UUID)
  TO service_role, postgres;

COMMIT;
