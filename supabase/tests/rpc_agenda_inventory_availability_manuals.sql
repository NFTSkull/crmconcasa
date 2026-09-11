-- Paridad: inventory_availability.available ≡ available_count (resta manuals CRM).
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p_inv_manual_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'INV-MANUAL FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_date DATE := DATE '2027-03-18';
  v_inv UUID := gen_random_uuid();
  v_payload JSONB;
  v_slot_avail INT;
  v_count INT;
BEGIN
  -- Ensure function body uses available_count for slot available
  PERFORM public.__p_inv_manual_assert(
    position(
      'agenda_sheet_inventory_available_count'
      in pg_get_functiondef('public.agenda_sheet_inventory_availability(text,date,text)'::regprocedure)
    ) > 0,
    'availability debe delegar available_count'
  );

  INSERT INTO public.agenda_sheet_slot_inventory (
    id, organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date,
    sheet_row, kind, location_id, slot_time, sheet_slot_time, slot_key, status,
    occupancy_source, observed_at, sheet_last_seen_at
  ) VALUES (
    v_inv, v_org, 'test-sheet', 1, '18 SEPTIEMBRE', v_date,
    10, 'biometricos', 'monterrey', TIME '08:00', TIME '08:00',
    'biometricos|2027-03-18|08:00|monterrey|sheet=08:00|sheetId=1|row=10',
    'available', 'reconciliation', NOW(), NOW()
  );

  -- Sin manuals: available = 1
  v_count := public.agenda_sheet_inventory_available_count(
    v_org, 'biometricos', v_date, TIME '08:00', 'monterrey'
  );
  PERFORM public.__p_inv_manual_assert(
    v_count = 1,
    format('count sin manual = 1 (got %s)', v_count)
  );

  -- Auth as asesor for availability RPC
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_payload := public.agenda_sheet_inventory_availability('biometricos', v_date, 'monterrey');
  SELECT (s->>'available')::INT INTO v_slot_avail
  FROM jsonb_array_elements(COALESCE(v_payload->'slots', '[]'::JSONB)) s
  WHERE left(s->>'slot_time', 5) = '08:00'
  LIMIT 1;
  PERFORM public.__p_inv_manual_assert(v_slot_avail = 1, 'UI sin manual = 1');

  PERFORM set_config('role', 'postgres', true);

  INSERT INTO public.agenda_manual_occupancies (
    organization_id, kind, booking_date, booking_time, location_id,
    status, source, counts_toward_capacity, nss, cliente_nombre, asesor_nombre,
    asesor_id, display_time
  ) VALUES (
    v_org, 'biometricos', v_date, TIME '08:00', 'monterrey',
    'active', 'manual_crm', TRUE, '12345678901', 'Manual Test', 'Asesor Test',
    v_asesor, TIME '08:00'
  );

  v_count := public.agenda_sheet_inventory_available_count(
    v_org, 'biometricos', v_date, TIME '08:00', 'monterrey'
  );
  PERFORM public.__p_inv_manual_assert(v_count = 0, 'count con manual = 0');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);

  v_payload := public.agenda_sheet_inventory_availability('biometricos', v_date, 'monterrey');
  SELECT (s->>'available')::INT INTO v_slot_avail
  FROM jsonb_array_elements(COALESCE(v_payload->'slots', '[]'::JSONB)) s
  WHERE left(s->>'slot_time', 5) = '08:00'
  LIMIT 1;
  PERFORM public.__p_inv_manual_assert(
    v_slot_avail = 0,
    format('UI con manual debe ser 0 (got %s)', v_slot_avail)
  );

  RAISE NOTICE 'INV-MANUAL parity PASS';
END;
$$;

ROLLBACK;
