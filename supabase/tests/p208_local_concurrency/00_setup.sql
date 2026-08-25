-- P208 local-only fixture. Org aislada. No Cloud.
\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS public.p208_race_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

DELETE FROM public.p208_race_meta;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8208-000000000001';
  v_a1 UUID := '00000000-0000-4000-8208-0000000000a1';
  v_a2 UUID := '00000000-0000-4000-8208-0000000000a2';
  v_d18 DATE := DATE '2026-10-06';
  v_dest DATE := DATE '2026-10-07';
  v_origin DATE := DATE '2026-10-13';
  v_dest2 DATE := DATE '2026-10-08';
  v_time TIME := TIME '10:00';
  v_i INTEGER;
  v_exp UUID;
  v_bid UUID;
  v_origin_bid UUID;
  v_cfg JSONB;
  v_occ INTEGER;
  v_lock_key TEXT;
BEGIN
  DELETE FROM public.agenda_sheet_sync_outbox WHERE organization_id = v_org;
  DELETE FROM public.agenda_sheet_slot_inventory WHERE organization_id = v_org;
  DELETE FROM public.agenda_bookings WHERE organization_id = v_org;
  DELETE FROM public.expedientes WHERE organization_id = v_org;
  DELETE FROM public.agenda_config WHERE organization_id = v_org;
  DELETE FROM public.action_log WHERE organization_id = v_org;
  DELETE FROM public.profiles WHERE organization_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p208-iso', 'P208 Isolated', true);

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, tipo_asesor_origen, active)
  VALUES
    (v_a1, v_org, 'p208.a1@iso.local', 'P208 Asesor A', 'asesor', 'interno', true),
    (v_a2, v_org, 'p208.a2@iso.local', 'P208 Asesor B', 'asesor', 'interno', true);

  v_cfg := jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Monterrey',
    'min_lead_hours', 0,
    'allowed_weekdays', jsonb_build_array(1, 2, 3, 4, 5),
    'slots', jsonb_build_array('10:00', '11:00'),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object(
        'enabled', true,
        'capacity_by_time', jsonb_build_object('10:00', 20, '11:00', 20)
      )
    )
  );
  INSERT INTO public.agenda_config (organization_id, kind, config, updated_by)
  VALUES (v_org, 'biometricos', v_cfg, v_a1);

  ALTER TABLE public.agenda_bookings DISABLE TRIGGER agenda_sheet_inventory_claim_ai;
  ALTER TABLE public.agenda_bookings DISABLE TRIGGER z_agenda_sheet_inventory_release_au;

  FOR v_i IN 1..36 LOOP
    v_exp := ('00000000-0000-4000-8208-00000000' || lpad(v_i::text, 4, '0'))::uuid;
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
      origen_mesa, ciclo_estado, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado
    ) VALUES (
      v_exp, v_org,
      CASE WHEN v_i % 2 = 0 THEN v_a2 ELSE v_a1 END,
      'mejoravit', lpad((20800000000 + v_i)::text, 11, '0'),
      'P208 Exp ' || v_i, '5582080000', 'interno', 'activo', true, now(), 4, 'en_proceso'
    );
  END LOOP;

  -- D18: 14 booked on 2026-10-06 exp 1-14
  FOR v_i IN 1..14 LOOP
    v_exp := ('00000000-0000-4000-8208-00000000' || lpad(v_i::text, 4, '0'))::uuid;
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
    ) VALUES (
      v_org, 'biometricos', v_exp, v_d18, v_time, 'monterrey', 'booked', v_a1
    ) RETURNING id INTO v_bid;
    INSERT INTO public.agenda_sheet_slot_inventory (
      organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
      kind, location_id, slot_time, slot_key, status, booking_id, expediente_id,
      occupancy_source, observed_at, linked_at
    ) VALUES (
      v_org, 'p208-iso-sheet', 208, 'BIO MTY', v_d18, v_i,
      'biometricos', 'monterrey', v_time, '10:00', 'linked', v_bid, v_exp,
      'crm', now(), now()
    );
  END LOOP;
  FOR v_i IN 15..24 LOOP
    INSERT INTO public.agenda_sheet_slot_inventory (
      organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
      kind, location_id, slot_time, slot_key, status, occupancy_source, observed_at
    ) VALUES (
      v_org, 'p208-iso-sheet', 208, 'BIO MTY', v_d18, v_i,
      'biometricos', 'monterrey', v_time, '10:00', 'available', 'sheet_legacy', now()
    );
  END LOOP;

  -- dest 14/15 on 2026-10-07 exp 19-32
  FOR v_i IN 19..32 LOOP
    v_exp := ('00000000-0000-4000-8208-00000000' || lpad(v_i::text, 4, '0'))::uuid;
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
    ) VALUES (
      v_org, 'biometricos', v_exp, v_dest, v_time, 'monterrey', 'booked', v_a1
    ) RETURNING id INTO v_bid;
    INSERT INTO public.agenda_sheet_slot_inventory (
      organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
      kind, location_id, slot_time, slot_key, status, booking_id, expediente_id,
      occupancy_source, observed_at, linked_at
    ) VALUES (
      v_org, 'p208-iso-sheet', 208, 'BIO MTY', v_dest, 1000 + v_i,
      'biometricos', 'monterrey', v_time, '10:00', 'linked', v_bid, v_exp,
      'crm', now(), now()
    );
  END LOOP;
  FOR v_i IN 33..42 LOOP
    INSERT INTO public.agenda_sheet_slot_inventory (
      organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
      kind, location_id, slot_time, slot_key, status, occupancy_source, observed_at
    ) VALUES (
      v_org, 'p208-iso-sheet', 208, 'BIO MTY', v_dest, 1100 + v_i,
      'biometricos', 'monterrey', v_time, '10:00', 'available', 'sheet_legacy', now()
    );
  END LOOP;

  -- dest2 14/15 on 2026-10-08 — need 14 more bookings. Use exp 1-14 already on d18.
  -- Instead seed dest2 with inventory-only occupied_external x14 + 0 CRM = occupancy 14.
  FOR v_i IN 50..63 LOOP
    INSERT INTO public.agenda_sheet_slot_inventory (
      organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
      kind, location_id, slot_time, slot_key, status, occupancy_source, observed_at
    ) VALUES (
      v_org, 'p208-iso-sheet', 208, 'BIO MTY', v_dest2, v_i,
      'biometricos', 'monterrey', v_time, '10:00', 'occupied_external', 'sheet_legacy', now()
    );
  END LOOP;
  FOR v_i IN 64..72 LOOP
    INSERT INTO public.agenda_sheet_slot_inventory (
      organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
      kind, location_id, slot_time, slot_key, status, occupancy_source, observed_at
    ) VALUES (
      v_org, 'p208-iso-sheet', 208, 'BIO MTY', v_dest2, v_i,
      'biometricos', 'monterrey', v_time, '10:00', 'available', 'sheet_legacy', now()
    );
  END LOOP;

  v_exp := '00000000-0000-4000-8208-000000000017'::uuid;
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_org, 'biometricos', v_exp, v_origin, v_time, 'monterrey', 'booked', v_a1
  ) RETURNING id INTO v_origin_bid;
  INSERT INTO public.agenda_sheet_slot_inventory (
    organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
    kind, location_id, slot_time, slot_key, status, booking_id, expediente_id,
    occupancy_source, observed_at, linked_at
  ) VALUES (
    v_org, 'p208-iso-sheet', 208, 'BIO MTY', v_origin, 100,
    'biometricos', 'monterrey', v_time, '10:00', 'linked', v_origin_bid, v_exp,
    'crm', now(), now()
  );
  INSERT INTO public.agenda_sheet_slot_inventory (
    organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
    kind, location_id, slot_time, slot_key, status, occupancy_source, observed_at
  ) VALUES (
    v_org, 'p208-iso-sheet', 208, 'BIO MTY', v_origin, 101,
    'biometricos', 'monterrey', v_time, '10:00', 'available', 'sheet_legacy', now()
  );

  ALTER TABLE public.agenda_bookings ENABLE TRIGGER agenda_sheet_inventory_claim_ai;
  ALTER TABLE public.agenda_bookings ENABLE TRIGGER z_agenda_sheet_inventory_release_au;

  v_occ := public.agenda_daily_active_occupancy(v_org, 'biometricos', v_d18, 'monterrey');
  IF v_occ IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'D18 fixture occupancy != 14: %', v_occ;
  END IF;
  v_occ := public.agenda_daily_active_occupancy(v_org, 'biometricos', v_dest, 'monterrey');
  IF v_occ IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'dest fixture occupancy != 14: %', v_occ;
  END IF;
  v_occ := public.agenda_daily_active_occupancy(v_org, 'biometricos', v_dest2, 'monterrey');
  IF v_occ IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'dest2 fixture occupancy != 14: %', v_occ;
  END IF;

  v_lock_key := v_org::text || ':daily:biometricos:' || v_d18::text || ':monterrey';

  INSERT INTO public.p208_race_meta (k, v) VALUES
    ('org', v_org::text),
    ('a1', v_a1::text),
    ('a2', v_a2::text),
    ('d18', v_d18::text),
    ('dest', v_dest::text),
    ('dest2', v_dest2::text),
    ('origin', v_origin::text),
    ('exp_a', '00000000-0000-4000-8208-000000000015'),
    ('exp_b', '00000000-0000-4000-8208-000000000016'),
    ('exp_reag', '00000000-0000-4000-8208-000000000017'),
    ('exp_book_dest', '00000000-0000-4000-8208-000000000018'),
    ('exp_book_dest2', '00000000-0000-4000-8208-000000000035'),
    ('origin_bid', v_origin_bid::text),
    ('lock_key_d18', v_lock_key),
    ('lock_hash_d18', hashtext(v_lock_key)::text),
    ('ts_d18', (TIMESTAMP '2026-10-06 10:00:00' AT TIME ZONE 'America/Monterrey')::text),
    ('ts_dest', (TIMESTAMP '2026-10-07 10:00:00' AT TIME ZONE 'America/Monterrey')::text),
    ('ts_dest2', (TIMESTAMP '2026-10-08 10:00:00' AT TIME ZONE 'America/Monterrey')::text);
END;
$$;

SELECT k, v FROM public.p208_race_meta ORDER BY k;
SELECT public.agenda_daily_capacity('00000000-0000-4000-8208-000000000001'::uuid, 'biometricos', DATE '2026-10-06', 'monterrey') AS cap;
