-- ConCasa CRM — P162 inbound ocupación manual Sheets → inventario
-- Uso: scripts/verify-p162-inbound-sheets-isolated.sh
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p162_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P162 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p162_as_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
END;
$$;

DO $$
DECLARE
  v_org UUID;
  v_booking UUID := 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';
  v_exp UUID;
  v_asesor UUID;
  v_avail INTEGER;
  v_status TEXT;
  v_booking_txt TEXT;
  v_gate_msg TEXT;
  v_def TEXT;
BEGIN
  PERFORM public.__p162_as_service();

  PERFORM public.__p162_assert(EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agenda_sheet_slot_inventory'
      AND column_name='manual_occupancy_fingerprint'
  ), 'columna manual_occupancy_fingerprint');
  PERFORM public.__p162_assert(EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agenda_sheet_slot_inventory'
      AND column_name='sheet_last_seen_at'
  ), 'columna sheet_last_seen_at');

  v_def := pg_get_functiondef(
    'public.agenda_sheet_inventory_gate_after_config_assert(uuid,text,date,time,text,integer,integer)'::regprocedure
  );
  PERFORM public.__p162_assert(
    v_def ILIKE '%SIN_CUPO_REAL_EN_SHEET%'
    AND v_def ILIKE '%acaba de ocuparse%',
    'gate mensaje SIN_CUPO_REAL_EN_SHEET amigable'
  );

  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  PERFORM public.__p162_assert(v_org IS NOT NULL, 'seed organizations');

  SELECT id INTO v_asesor FROM public.profiles WHERE app_role::text = 'asesor' LIMIT 1;
  SELECT id INTO v_exp FROM public.expedientes WHERE organization_id = v_org LIMIT 1;
  PERFORM public.__p162_assert(v_asesor IS NOT NULL AND v_exp IS NOT NULL, 'seed asesor/expediente');

  DELETE FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = 'p162-test-ss' AND sheet_id = 16201;
  DELETE FROM public.agenda_bookings WHERE id = v_booking;

  -- Inventario base ANTES del booking (claim trigger requiere fila available)
  PERFORM public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', 'p162-test-ss',
      'sheet_id', 16201,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 10,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '09:00:00',
      'sheet_slot_time', '09:00:00',
      'slot_key', 'biometricos|2026-08-10|09:00|monterrey|sheet=09:00|sheetId=16201|row=10',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', 'p162-test-ss',
      'sheet_id', 16201,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 11,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '09:00:00',
      'sheet_slot_time', '09:00:00',
      'slot_key', 'biometricos|2026-08-10|09:00|monterrey|sheet=09:00|sheetId=16201|row=11',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', 'p162-test-ss',
      'sheet_id', 16201,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 12,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '09:00:00',
      'sheet_slot_time', '09:00:00',
      'slot_key', 'biometricos|2026-08-10|09:00|monterrey|sheet=09:00|sheetId=16201|row=12',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    )
  ));

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_booking, v_org, 'biometricos', v_exp, DATE '2026-08-10', TIME '09:00',
    'monterrey', 'booked', v_asesor
  );
  -- claim trigger debió marcar una fila claimed

  -- 1) al menos una available sigue libre
  SELECT status INTO v_status
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id='p162-test-ss' AND sheet_id=16201 AND sheet_row=10;
  -- row 10 pudo ser claimed; verificar que existe alguna available
  SELECT COUNT(*)::int INTO v_avail
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id='p162-test-ss' AND sheet_id=16201
    AND kind='biometricos' AND slot_time=TIME '09:00' AND status='available';
  PERFORM public.__p162_assert(v_avail >= 1, format('fila(s) libre(s) after claim=%s', v_avail));

  -- 2) manual bio + firmas → occupied_external
  PERFORM public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', 'p162-test-ss',
      'sheet_id', 16201,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 11,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '09:00:00',
      'sheet_slot_time', '09:00:00',
      'slot_key', 'biometricos|2026-08-10|09:00|monterrey|sheet=09:00|sheetId=16201|row=11',
      'status', 'occupied_external',
      'visible_name', 'MANUAL BIO',
      'visible_advisor', 'Externo',
      'occupancy_source', 'sheet_webhook',
      'manual_occupancy_fingerprint', 'mdeadbeef'
    ),
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', 'p162-test-ss',
      'sheet_id', 16201,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 20,
      'kind', 'firmas',
      'location_id', 'monterrey',
      'slot_time', '10:00:00',
      'sheet_slot_time', '10:00:00',
      'slot_key', 'firmas|2026-08-10|10:00|monterrey|sheet=10:00|sheetId=16201|row=20',
      'status', 'occupied_external',
      'visible_nss', '12345678901',
      'occupancy_source', 'sheet_webhook',
      'manual_occupancy_fingerprint', 'mcafe'
    )
  ));
  SELECT status INTO v_status
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id='p162-test-ss' AND sheet_id=16201 AND sheet_row=11;
  PERFORM public.__p162_assert(v_status = 'occupied_external', 'manual bio → occupied_external');
  SELECT status INTO v_status
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id='p162-test-ss' AND sheet_id=16201 AND sheet_row=20;
  PERFORM public.__p162_assert(v_status = 'occupied_external', 'manual firmas → occupied_external');

  -- Asegurar fila 12 linked al booking (si claim tomó otra, re-link)
  PERFORM public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', 'p162-test-ss',
      'sheet_id', 16201,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 12,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '09:00:00',
      'sheet_slot_time', '09:00:00',
      'slot_key', 'biometricos|2026-08-10|09:00|monterrey|sheet=09:00|sheetId=16201|row=12',
      'status', 'linked',
      'visible_nss', '999',
      'visible_name', 'CRM',
      'booking_id', v_booking,
      'occupancy_source', 'crm'
    )
  ));

  v_avail := public.agenda_sheet_inventory_available_count(
    v_org, 'biometricos', DATE '2026-08-10', TIME '09:00', 'monterrey'
  );
  -- 3 filas: manual + linked + ?available → expected 0 o 1 según claim
  PERFORM public.__p162_assert(v_avail <= 1, format('no overcount available=%s', v_avail));
  PERFORM public.__p162_assert(
    (
      SELECT COUNT(*) FROM public.agenda_sheet_slot_inventory
      WHERE spreadsheet_id='p162-test-ss' AND sheet_id=16201
        AND kind='biometricos' AND slot_time=TIME '09:00'
        AND status IN ('occupied_external','linked','claimed')
    ) >= 2,
    'ocupadas physical >=2 sin doble conteo inventado'
  );

  -- 4) CRM booking no se libera si Sheet llega vacío
  PERFORM public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', 'p162-test-ss',
      'sheet_id', 16201,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 12,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '09:00:00',
      'sheet_slot_time', '09:00:00',
      'slot_key', 'biometricos|2026-08-10|09:00|monterrey|sheet=09:00|sheetId=16201|row=12',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    )
  ));
  SELECT status, booking_id::text INTO v_status, v_booking_txt
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id='p162-test-ss' AND sheet_id=16201 AND sheet_row=12;
  PERFORM public.__p162_assert(
    v_status IN ('linked', 'claimed') AND v_booking_txt = v_booking::text,
    format('CRM no liberado status=%s booking=%s', v_status, v_booking_txt)
  );

  -- 5) hard gate: ocupar última available → SIN_CUPO_REAL_EN_SHEET
  PERFORM public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', 'p162-test-ss',
      'sheet_id', 16201,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 10,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '09:00:00',
      'sheet_slot_time', '09:00:00',
      'slot_key', 'biometricos|2026-08-10|09:00|monterrey|sheet=09:00|sheetId=16201|row=10',
      'status', 'occupied_external',
      'visible_name', 'FULL',
      'occupancy_source', 'sheet_webhook',
      'manual_occupancy_fingerprint', 'mfull'
    )
  ));
  v_avail := public.agenda_sheet_inventory_available_count(
    v_org, 'biometricos', DATE '2026-08-10', TIME '09:00', 'monterrey'
  );
  PERFORM public.__p162_assert(v_avail = 0, 'tras llenar available=0');

  BEGIN
    PERFORM public.agenda_sheet_inventory_gate_after_config_assert(
      v_org, 'biometricos', DATE '2026-08-10', TIME '09:00', 'monterrey', 3, 0
    );
    RAISE EXCEPTION 'P162 FAIL: gate debió fallar con cupo 0';
  EXCEPTION
    WHEN others THEN
      v_gate_msg := SQLERRM;
      IF v_gate_msg ILIKE 'P162 FAIL:%' THEN
        RAISE;
      END IF;
      PERFORM public.__p162_assert(
        v_gate_msg ILIKE '%SIN_CUPO_REAL_EN_SHEET%',
        format('hard gate mensaje=%s', v_gate_msg)
      );
  END;

  DELETE FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = 'p162-test-ss' AND sheet_id = 16201;
  DELETE FROM public.agenda_bookings WHERE id = v_booking;

  RAISE NOTICE 'P162 OK: manual occupancy inbound';
END;
$$;

DROP FUNCTION IF EXISTS public.__p162_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p162_as_service();
