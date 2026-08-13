/**
 * P176 — restore agenda_sheet_inventory_availability contract (fresh/enforced/slots)
 * Local SQL suite (no Cloud writes).
 */
CREATE OR REPLACE FUNCTION public.__p176_assert(cond BOOLEAN, msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT cond THEN
    RAISE EXCEPTION 'P176 assert failed: %', msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p176_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p176_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'postgres', true);
END;
$$;

DO $$
DECLARE
  v_org UUID;
  v_asesor UUID;
  v_fecha DATE := DATE '2026-08-17';
  v_res JSONB;
  v_slot JSONB;
  v_n INT;
BEGIN
  PERFORM public.__p176_service();

  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'P176: no organizations fixture';
  END IF;

  SELECT id INTO v_asesor
  FROM public.profiles
  WHERE organization_id = v_org AND app_role = 'asesor' AND active = true
  LIMIT 1;
  IF v_asesor IS NULL THEN
    INSERT INTO public.profiles (id, organization_id, email, app_role, active, full_name)
    VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      v_org,
      'p176-asesor@example.com',
      'asesor',
      true,
      'P176 Asesor'
    )
    RETURNING id INTO v_asesor;
  END IF;

  DELETE FROM public.agenda_sheet_slot_inventory
  WHERE organization_id = v_org
    AND booking_date = v_fecha
    AND location_id = 'apodaca'
    AND kind = 'biometricos';

  INSERT INTO public.agenda_sheet_slot_inventory (
    organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date,
    kind, location_id, slot_time, sheet_slot_time, sheet_row, status, slot_key, occupancy_source,
    observed_at
  ) VALUES
    (v_org, 'ss-p176', 17601, '17 AGOSTO', v_fecha, 'biometricos', 'apodaca',
     TIME '08:00', TIME '08:30', 10, 'available',
     'biometricos|2026-08-17|08:00|apodaca|sheet=08:30|sheetId=17601|row=10', 'reconciliation', now()),
    (v_org, 'ss-p176', 17601, '17 AGOSTO', v_fecha, 'biometricos', 'apodaca',
     TIME '08:00', TIME '08:30', 11, 'available',
     'biometricos|2026-08-17|08:00|apodaca|sheet=08:30|sheetId=17601|row=11', 'reconciliation', now()),
    (v_org, 'ss-p176', 17601, '17 AGOSTO', v_fecha, 'biometricos', 'apodaca',
     TIME '10:00', TIME '10:00', 12, 'available',
     'biometricos|2026-08-17|10:00|apodaca|sheet=10:00|sheetId=17601|row=12', 'reconciliation', now()),
    (v_org, 'ss-p176', 17601, '17 AGOSTO', v_fecha, 'biometricos', 'apodaca',
     TIME '10:00', TIME '10:00', 13, 'available',
     'biometricos|2026-08-17|10:00|apodaca|sheet=10:00|sheetId=17601|row=13', 'reconciliation', now());

  PERFORM public.__p176_auth(v_asesor);

  v_res := public.agenda_sheet_inventory_availability('biometricos', v_fecha, 'apodaca');
  PERFORM public.__p176_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'bio ok');
  PERFORM public.__p176_assert(v_res ? 'fresh', 'bio has fresh');
  PERFORM public.__p176_assert(v_res ? 'enforced', 'bio has enforced');
  PERFORM public.__p176_assert(jsonb_typeof(v_res->'slots') = 'array', 'bio slots array');
  PERFORM public.__p176_assert((v_res->>'fresh')::BOOLEAN IS TRUE, 'bio fresh');
  PERFORM public.__p176_assert((v_res->>'enforced')::BOOLEAN IS TRUE, 'bio enforced');

  SELECT s INTO v_slot
  FROM jsonb_array_elements(v_res->'slots') s
  WHERE (s->>'slot_time') LIKE '08:00%';
  PERFORM public.__p176_assert(v_slot IS NOT NULL, 'bucket 08:00');
  PERFORM public.__p176_assert((v_slot->>'available')::INT = 2, '08:00 available=2');
  PERFORM public.__p176_assert((v_slot->>'physical_total')::INT = 2, '08:00 physical=2');
  PERFORM public.__p176_assert((v_slot->>'capacity')::INT = 2, '08:00 capacity=2');
  PERFORM public.__p176_assert((v_slot->>'sheet_slot_time') LIKE '08:30%', 'sheet 08:30');

  SELECT s INTO v_slot
  FROM jsonb_array_elements(v_res->'slots') s
  WHERE (s->>'slot_time') LIKE '10:00%';
  PERFORM public.__p176_assert(v_slot IS NOT NULL, 'bucket 10:00');
  PERFORM public.__p176_assert((v_slot->>'available')::INT = 2, '10:00 available=2');
  PERFORM public.__p176_assert((v_slot->>'physical_total')::INT = 2, '10:00 physical=2');

  v_res := public.agenda_sheet_inventory_availability('firmas', v_fecha, 'apodaca');
  PERFORM public.__p176_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'firmas ok');
  PERFORM public.__p176_assert(v_res ? 'fresh', 'firmas fresh key');
  PERFORM public.__p176_assert(v_res ? 'enforced', 'firmas enforced key');
  PERFORM public.__p176_assert(v_res ? 'slots', 'firmas slots key');

  PERFORM public.__p176_service();

  DELETE FROM public.agenda_sheet_slot_inventory
  WHERE organization_id = v_org
    AND booking_date = v_fecha
    AND location_id = 'monterrey'
    AND kind = 'inscripcion';

  INSERT INTO public.agenda_sheet_slot_inventory (
    organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date,
    kind, location_id, slot_time, sheet_slot_time, sheet_row, status, slot_key, occupancy_source,
    observed_at
  ) VALUES
    (v_org, 'ss-p176', 17602, '17 AGOSTO', v_fecha, 'inscripcion', 'monterrey',
     TIME '11:00', TIME '11:00', 20, 'available',
     'inscripcion|2026-08-17|11:00|monterrey|sheet=11:00|sheetId=17602|row=20', 'reconciliation', now()),
    (v_org, 'ss-p176', 17602, '17 AGOSTO', v_fecha, 'inscripcion', 'monterrey',
     TIME '11:00', TIME '11:00', 21, 'available',
     'inscripcion|2026-08-17|11:00|monterrey|sheet=11:00|sheetId=17602|row=21', 'reconciliation', now()),
    (v_org, 'ss-p176', 17602, '17 AGOSTO', v_fecha, 'inscripcion', 'monterrey',
     TIME '11:00', TIME '11:00', 22, 'available',
     'inscripcion|2026-08-17|11:00|monterrey|sheet=11:00|sheetId=17602|row=22', 'reconciliation', now());

  PERFORM public.__p176_auth(v_asesor);

  v_res := public.agenda_sheet_inventory_availability('inscripcion', v_fecha, 'monterrey');
  PERFORM public.__p176_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'insc ok');
  PERFORM public.__p176_assert((v_res->>'capacity')::INT = 3, 'insc top capacity 3');
  PERFORM public.__p176_assert((v_res->>'available')::INT = 3, 'insc top available 3');
  PERFORM public.__p176_assert(v_res->>'fixed_time' = '11:00', 'insc fixed_time');
  SELECT s INTO v_slot FROM jsonb_array_elements(v_res->'slots') s LIMIT 1;
  PERFORM public.__p176_assert(v_slot IS NOT NULL, 'insc slot');
  PERFORM public.__p176_assert((v_slot->>'slot_time') LIKE '11:00%', 'insc 11:00');
  PERFORM public.__p176_assert((v_slot->>'sheet_slot_time') LIKE '11:00%', 'insc sheet 11:00');
  PERFORM public.__p176_assert((v_slot->>'available')::INT = 3, 'insc slot available');
  PERFORM public.__p176_assert((v_slot->>'physical_total')::INT = 3, 'insc physical');
  PERFORM public.__p176_assert((v_slot->>'capacity')::INT = 3, 'insc slot capacity');
  PERFORM public.__p176_assert((v_slot->>'occupied')::INT = 0, 'insc occupied 0');

  PERFORM public.__p176_service();
  SELECT count(*) INTO v_n
  FROM public.agenda_sheet_slot_inventory
  WHERE organization_id = v_org AND booking_date = v_fecha
    AND kind = 'biometricos' AND location_id = 'apodaca';
  PERFORM public.__p176_assert(v_n = 4, 'fixture still 4 bio rows');

  RAISE NOTICE 'P176 SQL: ALL PASSED';
END;
$$;

SELECT 'P176 SQL: PASSED' AS result;

DROP FUNCTION IF EXISTS public.__p176_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p176_auth(UUID);
DROP FUNCTION IF EXISTS public.__p176_service();
