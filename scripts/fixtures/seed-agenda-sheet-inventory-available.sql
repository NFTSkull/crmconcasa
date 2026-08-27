-- Inventario Sheet disponible para fail-closed SIN_CUPO_REAL_EN_SHEET (local suites).
DO $$
DECLARE
  v_org UUID;
  v_d DATE;
  v_t TIME;
  v_row INTEGER := 1;
  v_times TIME[] := ARRAY[
    '08:00'::TIME, '08:30'::TIME, '09:00'::TIME, '09:30'::TIME, '10:00'::TIME,
    '11:00'::TIME, '12:00'::TIME, '13:00'::TIME, '14:00'::TIME,
    '15:00'::TIME, '16:00'::TIME, '17:00'::TIME
  ];
  v_kind TEXT;
  v_loc TEXT;
  v_i INTEGER;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at NULLS LAST, id LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'inventory seed: sin org, skip';
    RETURN;
  END IF;

  FOR v_d IN SELECT generate_series(CURRENT_DATE, CURRENT_DATE + 60, '1 day')::DATE LOOP
    IF NOT public.agenda_sheet_inventory_enforced(v_d) THEN
      CONTINUE;
    END IF;
    FOREACH v_kind IN ARRAY ARRAY['biometricos', 'firmas'] LOOP
      FOREACH v_loc IN ARRAY ARRAY['monterrey', 'apodaca'] LOOP
        FOR v_i IN 1..array_length(v_times, 1) LOOP
          v_t := v_times[v_i];
          -- 8 filas físicas disponibles por horario (cubre capacity típica de tests)
          FOR v_row IN 1..8 LOOP
            INSERT INTO public.agenda_sheet_slot_inventory (
              organization_id, spreadsheet_id, sheet_id, sheet_title,
              booking_date, sheet_row, kind, location_id, slot_time, slot_key,
              status, occupancy_source, observed_at, booking_id, expediente_id,
              claimed_at, linked_at, last_error
            ) VALUES (
              v_org,
              'iso-inventory-seed',
              (EXTRACT(EPOCH FROM v_d)::BIGINT * 100
                + CASE v_kind WHEN 'biometricos' THEN 10 ELSE 20 END
                + CASE v_loc WHEN 'monterrey' THEN 1 ELSE 2 END),
              'ISO ' || v_d::TEXT,
              v_d,
              (EXTRACT(EPOCH FROM v_d)::INTEGER % 100000) * 100
                + (CASE v_kind WHEN 'biometricos' THEN 0 ELSE 40 END)
                + (CASE v_loc WHEN 'monterrey' THEN 0 ELSE 20 END)
                + v_i * 10 + v_row,
              v_kind,
              v_loc,
              v_t,
              v_kind || '|' || v_loc || '|' || v_d::TEXT || '|' || to_char(v_t, 'HH24:MI') || '|' || v_row,
              'available',
              'reconciliation',
              NOW(),
              NULL,
              NULL,
              NULL,
              NULL,
              NULL
            )
            ON CONFLICT (spreadsheet_id, sheet_id, sheet_row) DO UPDATE
            SET
              status = 'available',
              booking_id = NULL,
              expediente_id = NULL,
              claimed_at = NULL,
              linked_at = NULL,
              last_error = NULL,
              occupancy_source = 'reconciliation',
              observed_at = NOW(),
              updated_at = NOW();
          END LOOP;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
