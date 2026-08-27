-- Re-apply P124 capacity_by_time after seed overwrite (seed legacy JSON).
DO $$
DECLARE
  v_row RECORD;
  v_config JSONB;
  v_slots JSONB;
  v_locations JSONB;
  v_slot TEXT;
  v_loc_id TEXT;
  v_loc JSONB;
  v_cbt JSONB;
  v_general INTEGER;
  v_changed BOOLEAN;
BEGIN
  FOR v_row IN
    SELECT id, config FROM public.agenda_config WHERE kind IN ('biometricos', 'firmas')
  LOOP
    v_config := v_row.config;
    v_slots := COALESCE(v_config->'slots', '[]'::jsonb);
    v_locations := COALESCE(v_config->'locations', '{}'::jsonb);
    v_changed := false;
    FOR v_loc_id IN SELECT jsonb_object_keys(v_locations)
    LOOP
      v_loc := v_locations->v_loc_id;
      IF COALESCE((v_loc->>'enabled')::boolean, false) IS NOT TRUE THEN
        CONTINUE;
      END IF;
      v_cbt := COALESCE(v_loc->'capacity_by_time', '{}'::jsonb);
      IF jsonb_typeof(v_cbt) <> 'object' THEN
        v_cbt := '{}'::jsonb;
      END IF;
      BEGIN
        v_general := GREATEST(1, COALESCE((v_loc->>'capacity_per_slot')::integer, 1));
      EXCEPTION WHEN OTHERS THEN
        v_general := 1;
      END;
      FOR v_slot IN SELECT jsonb_array_elements_text(v_slots)
      LOOP
        IF NOT (v_cbt ? v_slot) THEN
          v_cbt := v_cbt || jsonb_build_object(v_slot, v_general);
          v_changed := true;
        END IF;
      END LOOP;
      v_locations := jsonb_set(v_locations, ARRAY[v_loc_id, 'capacity_by_time'], v_cbt, true);
    END LOOP;
    IF v_changed THEN
      UPDATE public.agenda_config
      SET config = jsonb_set(v_config, '{locations}', v_locations, true),
          updated_at = NOW()
      WHERE id = v_row.id;
    END IF;
  END LOOP;
END $$;
