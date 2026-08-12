-- ConCasa CRM — P172 B1: contingencia extraordinaria
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--   -f supabase/tests/rpc_agenda_contingencia_p172.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p172_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P172 FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p172_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p172_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'postgres', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p172_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9172-000000000001';
  v_org2 UUID := '00000000-0000-4000-9172-000000000002';
  v_asesor UUID := '00000000-0000-4000-9172-000000000011';
  v_asesor2 UUID := '00000000-0000-4000-9172-000000000013';
  v_mesa UUID := '00000000-0000-4000-9172-000000000012';
  v_exp UUID;
  v_exp2 UUID;
  v_exp_f UUID;
  v_exp_o UUID;
  v_book_bio UUID;
  v_book_bio2 UUID;
  v_book_firm UUID;
  v_book_cancel UUID;
  v_book_other_org UUID;
  v_book_other_day UUID;
  v_cont UUID;
  v_cont_f UUID;
  v_item UUID;
  v_item2 UUID;
  v_item_f UUID;
  v_ext UUID;
  v_res JSONB;
  v_res2 JSONB;
  v_cnt INT;
  v_cnt2 INT;
  v_outbox_before BIGINT;
  v_outbox_after BIGINT;
  v_inv_before BIGINT;
  v_inv_after BIGINT;
  v_links_before BIGINT;
  v_links_after BIGINT;
  v_status TEXT;
  v_date DATE;
  v_time TIME;
  v_loc TEXT;
  v_etapa INT;
  v_sub TEXT;
  v_ssid TEXT := 'p172-contingency-ssid';
  v_sid BIGINT := 172001;
  v_row INT := 20;
  v_fp TEXT;
  v_err TEXT;
  v_list JSONB;
BEGIN
  PERFORM public.__p172_reset();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES
    (v_org, 'p172-contingency-org', 'P172 Contingency Org', true),
    (v_org2, 'p172-contingency-org2', 'P172 Contingency Org2', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p172-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor2, 'authenticated', 'authenticated', 'p172-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p172-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p172-asesor@test.local', 'Asesor P172', 'asesor', 'interno', NULL, true),
    (v_asesor2, v_org, 'p172-asesor2@test.local', 'Asesor2 P172', 'asesor', 'interno', NULL, true),
    (v_mesa, v_org, 'p172-mesa@test.local', 'Mesa P172', 'mesa_interno', NULL, 'interno', true)
  ON CONFLICT (id) DO UPDATE SET
    active = true, organization_id = EXCLUDED.organization_id, app_role = EXCLUDED.app_role;

  -- Cleanup prior P172 fixtures
  UPDATE public.agenda_contingencia_citas
    SET extraordinary_booking_id = NULL
    WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_extraordinary_bookings WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_contingencia_citas WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_contingencias WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_sheet_operational_results WHERE spreadsheet_id = v_ssid;
  DELETE FROM public.action_log WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_sheet_slot_inventory WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_sheet_slot_links WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_sheet_sync_outbox WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_bookings WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.expediente_paso_visual_transiciones
    WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE organization_id IN (v_org, v_org2));
  DELETE FROM public.expedientes WHERE organization_id IN (v_org, v_org2);

  -- Fixtures: desactivar claim/outbox triggers para inserts de prueba (aislar P172)
  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;

  -- Fixtures
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91720000001', 'Cliente P172 Bio',
    '5517200001', 'interno', true, now(), 4, 'en_proceso', 'activo', now() - interval '1 hour'
  );

  v_exp2 := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp2, v_org, v_asesor2, 'mejoravit', '91720000002', 'Cliente P172 Bio2',
    '5517200002', 'interno', true, now(), 4, 'en_proceso', 'activo', now() - interval '1 hour'
  );

  v_exp_f := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp_f, v_org, v_asesor, 'mejoravit', '91720000003', 'Cliente P172 Firm',
    '5517200003', 'interno', true, now(), 9, 'en_proceso', 'activo', now() - interval '1 hour'
  );

  v_exp_o := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp_o, v_org2, v_asesor, 'mejoravit', '91720000099', 'Cliente Other Org',
    '5517200099', 'interno', true, now(), 4, 'en_proceso', 'activo', now() - interval '1 hour'
  );

  v_book_bio := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_book_bio, v_org, 'biometricos', v_exp, CURRENT_DATE, time '08:30',
    'monterrey', 'booked', v_asesor
  );

  v_book_bio2 := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_book_bio2, v_org, 'biometricos', v_exp2, CURRENT_DATE, time '09:00',
    'apodaca', 'booked', v_asesor2
  );

  v_book_firm := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_book_firm, v_org, 'firmas', v_exp_f, CURRENT_DATE, time '10:00',
    'monterrey', 'booked', v_asesor
  );

  v_book_cancel := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, cancelled_at
  ) VALUES (
    v_book_cancel, v_org, 'biometricos', v_exp, CURRENT_DATE, time '11:00',
    'monterrey', 'cancelled', v_asesor, now()
  );

  v_book_other_day := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '91720000004', 'Cliente Other Day',
    '5517200004', 'interno', true, now(), 4, 'en_proceso', 'activo', now()
  );
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  )
  SELECT v_book_other_day, v_org, 'biometricos', e.id, CURRENT_DATE + 1, time '08:30',
         'monterrey', 'booked', v_asesor
  FROM public.expedientes e
  WHERE e.organization_id = v_org AND e.nss = '91720000004'
  LIMIT 1;

  v_book_other_org := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_book_other_org, v_org2, 'biometricos', v_exp_o, CURRENT_DATE, time '08:30',
    'monterrey', 'booked', v_asesor
  );

  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;

  SELECT count(*) INTO v_outbox_before FROM public.agenda_sheet_sync_outbox;
  SELECT count(*) INTO v_inv_before FROM public.agenda_sheet_slot_inventory WHERE organization_id = v_org;
  SELECT count(*) INTO v_links_before FROM public.agenda_sheet_slot_links WHERE organization_id = v_org;

  SELECT booking_date, booking_time, location_id, status::text, etapa_actual, subestado::text
  INTO v_date, v_time, v_loc, v_status, v_etapa, v_sub
  FROM public.agenda_bookings b
  JOIN public.expedientes e ON e.id = b.expediente_id
  WHERE b.id = v_book_bio;

  -- ========== 1. Mesa declara biometricos ==========
  PERFORM public.__p172_auth(v_mesa);
  v_res := public.agenda_declarar_contingencia(CURRENT_DATE, 'biometricos', NULL, 'Contingencia bio sede completa');
  PERFORM public.__p172_assert(v_res->>'ok' = 'true', '1 mesa declara bio ok');
  v_cont := (v_res->>'contingency_id')::uuid;
  PERFORM public.__p172_assert((v_res->>'affected_count')::int = 2, '1 affected=2 (bio booked same day)');
  PERFORM public.__p172_assert((v_res->>'advisor_count')::int = 2, '1 advisors=2');
  PERFORM public.__p172_assert(v_res->>'kind' = 'biometricos', '1 kind');

  -- ========== 16. duplicate declaration idempotente ==========
  v_res2 := public.agenda_declarar_contingencia(CURRENT_DATE, 'biometricos', NULL, 'doble click');
  PERFORM public.__p172_assert((v_res2->>'contingency_id')::uuid = v_cont, '16 same contingency');
  PERFORM public.__p172_assert(COALESCE((v_res2->>'reused')::boolean, false) = true, '16 reused');

  -- ========== 2+3+4. Firmas independientes coexisten ==========
  v_res := public.agenda_declarar_contingencia(CURRENT_DATE, 'firmas', NULL, 'Contingencia firmas');
  PERFORM public.__p172_assert(v_res->>'ok' = 'true', '2 mesa declara firmas');
  v_cont_f := (v_res->>'contingency_id')::uuid;
  PERFORM public.__p172_assert(v_cont_f IS DISTINCT FROM v_cont, '3 independientes');
  PERFORM public.__p172_assert((v_res->>'affected_count')::int = 1, '4 firmas count=1');

  -- ========== 5. sede scope ==========
  PERFORM public.__p172_reset();
  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES
    (gen_random_uuid(), v_org, v_asesor, 'mejoravit', '91720000051', 'Sede MTY',
     '5517200051', 'interno', true, now(), 4, 'en_proceso', 'activo', now()),
    (gen_random_uuid(), v_org, v_asesor2, 'mejoravit', '91720000052', 'Sede APO',
     '5517200052', 'interno', true, now(), 4, 'en_proceso', 'activo', now());
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  )
  SELECT gen_random_uuid(), v_org, 'biometricos', e.id, CURRENT_DATE + 2, time '08:30',
         'monterrey', 'booked', v_asesor
  FROM public.expedientes e WHERE e.nss = '91720000051' AND e.organization_id = v_org;
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  )
  SELECT gen_random_uuid(), v_org, 'biometricos', e.id, CURRENT_DATE + 2, time '09:00',
         'apodaca', 'booked', v_asesor2
  FROM public.expedientes e WHERE e.nss = '91720000052' AND e.organization_id = v_org;
  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;
  PERFORM public.__p172_auth(v_mesa);
  v_res := public.agenda_declarar_contingencia(CURRENT_DATE + 2, 'biometricos', 'monterrey', 'Solo MTY');
  PERFORM public.__p172_assert((v_res->>'affected_count')::int = 1, '5 sede scope monterrey only');

  -- ========== 6-9 snapshot filters ==========
  PERFORM public.__p172_reset();
  SELECT count(*) INTO v_cnt FROM public.agenda_contingencia_citas
  WHERE contingency_id = v_cont AND original_booking_id = v_book_bio;
  PERFORM public.__p172_assert(v_cnt = 1, '6 booked incluido');

  SELECT count(*) INTO v_cnt FROM public.agenda_contingencia_citas
  WHERE contingency_id = v_cont AND original_booking_id = v_book_cancel;
  PERFORM public.__p172_assert(v_cnt = 0, '7 cancelled fuera');

  SELECT count(*) INTO v_cnt FROM public.agenda_contingencia_citas
  WHERE contingency_id = v_cont AND original_booking_id = v_book_firm;
  PERFORM public.__p172_assert(v_cnt = 0, '8 other kind fuera');

  SELECT count(*) INTO v_cnt FROM public.agenda_contingencia_citas
  WHERE contingency_id = v_cont AND original_booking_id = v_book_other_org;
  PERFORM public.__p172_assert(v_cnt = 0, '9 other org fuera');

  SELECT count(*) INTO v_cnt FROM public.agenda_contingencia_citas
  WHERE contingency_id = v_cont AND original_booking_id = v_book_other_day;
  PERFORM public.__p172_assert(v_cnt = 0, '9b other day fuera');

  -- ========== 10 no mutation agenda_booking ==========
  SELECT booking_date, booking_time, location_id, status::text
  INTO v_date, v_time, v_loc, v_status
  FROM public.agenda_bookings WHERE id = v_book_bio;
  PERFORM public.__p172_assert(v_status = 'booked', '10 status intacto');
  PERFORM public.__p172_assert(v_date = CURRENT_DATE, '10 date intacta');
  PERFORM public.__p172_assert(v_time = time '08:30', '10 time intacta');
  PERFORM public.__p172_assert(v_loc = 'monterrey', '10 location intacta');

  -- ========== 11-14 inventory/slot_links/outbox/sheet ==========
  PERFORM public.__p172_reset();
  SELECT count(*) INTO v_outbox_after FROM public.agenda_sheet_sync_outbox;
  SELECT count(*) INTO v_inv_after FROM public.agenda_sheet_slot_inventory WHERE organization_id = v_org;
  SELECT count(*) INTO v_links_after FROM public.agenda_sheet_slot_links WHERE organization_id = v_org;
  PERFORM public.__p172_assert(v_outbox_after = v_outbox_before, '13 outbox intacto declarar');
  PERFORM public.__p172_assert(v_inv_after = v_inv_before, '11 inventory intacto');
  PERFORM public.__p172_assert(v_links_after = v_links_before, '12 slot_links intacto');
  PERFORM public.__p172_assert(
    NOT EXISTS (
      SELECT 1 FROM public.agenda_sheet_operational_results WHERE spreadsheet_id = v_ssid
    ),
    '14 sheet metadata no creada por declarar'
  );

  -- ========== 15 etapa intacta ==========
  SELECT etapa_actual, subestado::text INTO v_etapa, v_sub
  FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p172_assert(v_etapa = 4, '15 etapa intacta');
  PERFORM public.__p172_assert(v_sub = 'en_proceso', '15 subestado intacto');

  -- ========== D) booking nuevo post-snapshot no entra ==========
  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;
  -- nuevo expediente (unique active bio por expediente)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '91720000077', 'Post Snapshot',
    '5517200077', 'interno', true, now(), 4, 'en_proceso', 'activo', now()
  );
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  )
  SELECT gen_random_uuid(), v_org, 'biometricos', e.id, CURRENT_DATE, time '12:00',
         'monterrey', 'booked', v_asesor
  FROM public.expedientes e
  WHERE e.organization_id = v_org AND e.nss = '91720000077'
  LIMIT 1;
  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;
  PERFORM public.__p172_auth(v_mesa);
  v_res2 := public.agenda_declarar_contingencia(CURRENT_DATE, 'biometricos', NULL, 'reuse');
  PERFORM public.__p172_assert((v_res2->>'affected_count')::int = 2, 'D post-snapshot no entra');

  -- ========== 17+18 asesor ownership ==========
  SELECT id INTO v_item FROM public.agenda_contingencia_citas
  WHERE contingency_id = v_cont AND original_booking_id = v_book_bio;
  SELECT id INTO v_item2 FROM public.agenda_contingencia_citas
  WHERE contingency_id = v_cont AND original_booking_id = v_book_bio2;

  -- 24 task pending
  PERFORM public.__p172_assert(
    public.asesor_inbox_pendiente_cita_extraordinaria(v_exp) = true,
    '24 pendiente hasta rebook'
  );
  PERFORM public.__p172_auth(v_asesor);
  v_list := public.asesor_list_contingencia_pendientes();
  PERFORM public.__p172_assert(jsonb_array_length(v_list->'items') >= 1, '24 list Cloud pendiente');

  -- 18 foreign denied
  v_err := NULL;
  BEGIN
    PERFORM public.__p172_auth(v_asesor);
    PERFORM public.asesor_agendar_cita_extraordinaria(v_item2, CURRENT_DATE + 3, time '08:30', 'monterrey');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.__p172_assert(v_err IS NOT NULL AND v_err ILIKE '%FORBIDDEN%', '18 foreign denied');

  -- 17 own item + 19/20/21 no capacity/inventory/outbox + 23 atomic rebook
  PERFORM public.__p172_reset();
  SELECT count(*) INTO v_outbox_before FROM public.agenda_sheet_sync_outbox;
  SELECT count(*) INTO v_inv_before FROM public.agenda_sheet_slot_inventory WHERE organization_id = v_org;

  PERFORM public.__p172_auth(v_asesor);
  v_res := public.asesor_agendar_cita_extraordinaria(v_item, CURRENT_DATE + 3, time '08:30', 'monterrey');
  PERFORM public.__p172_assert(v_res->>'ok' = 'true', '17 own rebook ok');
  v_ext := (v_res->>'extraordinary_booking_id')::uuid;
  PERFORM public.__p172_assert(v_res->>'status' = 'rebooked', '23 item rebooked');
  PERFORM public.__p172_assert((v_res->>'etapa_actual')::int = 4, '9 etapa no cambia');

  PERFORM public.__p172_reset();
  SELECT count(*) INTO v_outbox_after FROM public.agenda_sheet_sync_outbox;
  SELECT count(*) INTO v_inv_after FROM public.agenda_sheet_slot_inventory WHERE organization_id = v_org;
  PERFORM public.__p172_assert(v_outbox_after = v_outbox_before, '21 extraordinary 0 outbox');
  PERFORM public.__p172_assert(v_inv_after = v_inv_before, '20 extraordinary 0 inventory');

  -- 19 coexist with full capacity conceptually: extraordinary table separate
  PERFORM public.__p172_assert(
    EXISTS (SELECT 1 FROM public.agenda_extraordinary_bookings WHERE id = v_ext AND status = 'booked'),
    '19 extraordinary booked sin agenda_bookings'
  );
  PERFORM public.__p172_assert(
    NOT EXISTS (SELECT 1 FROM public.agenda_bookings WHERE id = v_ext),
    '19 no usa agenda_bookings'
  );

  -- 22 duplicate extraordinary blocked
  v_err := NULL;
  BEGIN
    PERFORM public.__p172_auth(v_asesor);
    PERFORM public.asesor_agendar_cita_extraordinaria(v_item, CURRENT_DATE + 4, time '09:00', 'apodaca');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.__p172_assert(v_err IS NOT NULL, '22 duplicate blocked');

  -- 24 resolved after rebook
  PERFORM public.__p172_assert(
    public.asesor_inbox_pendiente_cita_extraordinaria(v_exp) = false,
    '24 pendiente resuelta tras rebook'
  );

  -- ========== 25+26 P170 SKIPPED_CONTINGENCY ==========
  PERFORM public.__p172_service();
  SELECT etapa_actual, subestado::text INTO v_etapa, v_sub
  FROM public.expedientes WHERE id = v_exp;

  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, v_row, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book_bio, v_exp,
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p172_assert(v_res->>'outcome' = 'SKIPPED_CONTINGENCY', '25 SKIPPED_CONTINGENCY');
  PERFORM public.__p172_assert(COALESCE((v_res->>'mutated')::boolean, true) = false, '25 mutated=false');

  SELECT etapa_actual, subestado::text INTO v_cnt, v_status
  FROM public.expedientes WHERE id = v_exp;
  -- reuse vars carefully
  PERFORM public.__p172_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp) = v_etapa,
    '26 zero etapa mutation'
  );
  PERFORM public.__p172_assert(
    (SELECT subestado::text FROM public.expedientes WHERE id = v_exp) = v_sub,
    '26 zero subestado mutation'
  );
  PERFORM public.__p172_assert(
    public.agenda_ops_row_contingency_flag(v_book_bio) = 'CONTINGENCY',
    'P165 flag CONTINGENCY'
  );

  -- ========== 27 action_log ==========
  PERFORM public.__p172_reset();
  SELECT count(*) INTO v_cnt FROM public.action_log
  WHERE organization_id = v_org AND action = 'AGENDA_CONTINGENCY_DECLARED';
  PERFORM public.__p172_assert(v_cnt >= 1, '27 DECLARED log');
  SELECT count(*) INTO v_cnt FROM public.action_log
  WHERE organization_id = v_org AND action = 'AGENDA_EXTRAORDINARY_REBOOKED';
  PERFORM public.__p172_assert(v_cnt >= 1, '27 REBOOKED log');

  -- ========== 28 RLS anon denied ==========
  BEGIN
    PERFORM set_config('role', 'anon', true);
    PERFORM set_config('request.jwt.claim.role', 'anon', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SELECT count(*) INTO v_cnt FROM public.agenda_contingencias WHERE organization_id = v_org;
    -- Si hay GRANT+RLS: 0 filas. Si no hay GRANT: permission denied (también OK).
    PERFORM public.__p172_assert(v_cnt = 0, '28 anon no lee contingencias');
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- denied at privilege layer
  END;
  BEGIN
    PERFORM set_config('role', 'anon', true);
    SELECT count(*) INTO v_cnt FROM public.agenda_contingencia_citas WHERE organization_id = v_org;
    PERFORM public.__p172_assert(v_cnt = 0, '28 anon no lee items');
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM set_config('role', 'anon', true);
    SELECT count(*) INTO v_cnt FROM public.agenda_extraordinary_bookings WHERE organization_id = v_org;
    PERFORM public.__p172_assert(v_cnt = 0, '28 anon no lee extraordinary');
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM public.__p172_reset();

  -- ========== empty contingency rejected ==========
  v_err := NULL;
  BEGIN
    PERFORM public.__p172_auth(v_mesa);
    PERFORM public.agenda_declarar_contingencia(CURRENT_DATE + 30, 'biometricos', NULL, 'vacia');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.__p172_assert(v_err ILIKE '%NO_AFFECTED%', 'empty rejected');

  -- Asesor cannot declare
  v_err := NULL;
  BEGIN
    PERFORM public.__p172_auth(v_asesor);
    PERFORM public.agenda_declarar_contingencia(CURRENT_DATE, 'biometricos', NULL, 'asesor no');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.__p172_assert(v_err ILIKE '%UNAUTHORIZED%', 'asesor no declara');

  RAISE NOTICE 'P172 SQL: ALL PASSED';
END;
$$;

-- Race A/B: doble declaración concurrente vía advisory lock → 1 contingencia
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9172-000000000091';
  v_mesa UUID := '00000000-0000-4000-9172-000000000092';
  v_asesor UUID := '00000000-0000-4000-9172-000000000093';
  v_exp UUID;
  v_book UUID;
  v_a UUID;
  v_b UUID;
  v_cnt INT;
BEGIN
  PERFORM public.__p172_reset();
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p172-race-org', 'P172 Race', true)
  ON CONFLICT (id) DO UPDATE SET active = true;
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_mesa, 'authenticated', 'authenticated', 'p172-race-mesa@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor, 'authenticated', 'authenticated', 'p172-race-asesor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active)
  VALUES
    (v_mesa, v_org, 'p172-race-mesa@test.local', 'Mesa Race', 'mesa_interno', NULL, 'interno', true),
    (v_asesor, v_org, 'p172-race-asesor@test.local', 'Asesor Race', 'asesor', 'interno', NULL, true)
  ON CONFLICT (id) DO UPDATE SET active = true, organization_id = EXCLUDED.organization_id, app_role = EXCLUDED.app_role;

  UPDATE public.agenda_contingencia_citas SET extraordinary_booking_id = NULL WHERE organization_id = v_org;
  DELETE FROM public.agenda_extraordinary_bookings WHERE organization_id = v_org;
  DELETE FROM public.agenda_contingencia_citas WHERE organization_id = v_org;
  DELETE FROM public.agenda_contingencias WHERE organization_id = v_org;
  DELETE FROM public.agenda_bookings WHERE organization_id = v_org;
  DELETE FROM public.expediente_paso_visual_transiciones
    WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE organization_id = v_org);
  DELETE FROM public.expedientes WHERE organization_id = v_org;

  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91720910001', 'Race Cliente',
    '5517291001', 'interno', true, now(), 4, 'en_proceso', 'activo', now()
  );
  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;
  v_book := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_book, v_org, 'biometricos', v_exp, CURRENT_DATE + 7, time '08:30', 'monterrey', 'booked', v_asesor
  );
  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;

  PERFORM public.__p172_auth(v_mesa);
  v_a := (public.agenda_declarar_contingencia(CURRENT_DATE + 7, 'biometricos', NULL, 'race A')->>'contingency_id')::uuid;
  v_b := (public.agenda_declarar_contingencia(CURRENT_DATE + 7, 'biometricos', NULL, 'race B')->>'contingency_id')::uuid;
  PERFORM public.__p172_assert(v_a = v_b, 'race A/B same contingency');
  SELECT count(*)::int INTO v_cnt FROM public.agenda_contingencias
  WHERE organization_id = v_org AND affected_date = CURRENT_DATE + 7 AND kind = 'biometricos' AND status = 'active';
  PERFORM public.__p172_assert(v_cnt = 1, 'race A/B single active');
  PERFORM public.__p172_reset();
  RAISE NOTICE 'P172 race A/B: PASSED';
END;
$$;

-- =============================================================================
-- P172 B1.1 — hardening: SKIP permanente + bloqueo mutaciones normales
-- =============================================================================
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9172-000000000101';
  v_org_ok UUID := '00000000-0000-4000-9172-000000000102';
  v_mesa UUID := '00000000-0000-4000-9172-000000000112';
  v_asesor UUID := '00000000-0000-4000-9172-000000000111';
  v_exp UUID;
  v_exp_ok UUID;
  v_book UUID;
  v_book_ok UUID;
  v_cont UUID;
  v_item UUID;
  v_res JSONB;
  v_err TEXT;
  v_etapa INT;
  v_sub TEXT;
  v_outbox_before BIGINT;
  v_outbox_after BIGINT;
  v_inv_before BIGINT;
  v_inv_after BIGINT;
  v_ssid TEXT := 'p172-b11-ssid';
  v_sid BIGINT := 172101;
BEGIN
  PERFORM public.__p172_reset();

  INSERT INTO public.organizations (id, slug, name, active) VALUES
    (v_org, 'p172-b11-org', 'P172 B11', true),
    (v_org_ok, 'p172-b11-org-ok', 'P172 B11 OK', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_mesa, 'authenticated', 'authenticated', 'p172-b11-mesa@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor, 'authenticated', 'authenticated', 'p172-b11-asesor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active)
  VALUES
    (v_mesa, v_org, 'p172-b11-mesa@test.local', 'Mesa B11', 'mesa_interno', NULL, 'interno', true),
    (v_asesor, v_org, 'p172-b11-asesor@test.local', 'Asesor B11', 'asesor', 'interno', NULL, true)
  ON CONFLICT (id) DO UPDATE SET active=true, organization_id=EXCLUDED.organization_id, app_role=EXCLUDED.app_role;

  UPDATE public.profiles SET organization_id = v_org WHERE id IN (v_mesa, v_asesor);

  UPDATE public.agenda_contingencia_citas SET extraordinary_booking_id = NULL
    WHERE organization_id IN (v_org, v_org_ok);
  DELETE FROM public.agenda_extraordinary_bookings WHERE organization_id IN (v_org, v_org_ok);
  DELETE FROM public.agenda_contingencia_citas WHERE organization_id IN (v_org, v_org_ok);
  DELETE FROM public.agenda_contingencias WHERE organization_id IN (v_org, v_org_ok);
  DELETE FROM public.agenda_sheet_operational_results WHERE spreadsheet_id = v_ssid;
  DELETE FROM public.agenda_bookings WHERE organization_id IN (v_org, v_org_ok);
  DELETE FROM public.expediente_paso_visual_transiciones
    WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE organization_id IN (v_org, v_org_ok));
  DELETE FROM public.expedientes WHERE organization_id IN (v_org, v_org_ok);

  -- Helper exists
  PERFORM public.__p172_assert(
    public.agenda_booking_has_contingency(NULL) IS NOT TRUE,
    'helper null = false'
  );

  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;
  -- Re-enable ONLY our contingency guard (DISABLE TRIGGER USER disables all user triggers)
  -- We'll enable all after fixtures and rely on full triggers for mutation tests.

  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91721100001', 'B11 Cont',
    '5517211001', 'interno', true, now(), 4, 'en_proceso', 'activo', now()
  );
  v_book := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_book, v_org, 'biometricos', v_exp, CURRENT_DATE + 10, time '08:30', 'monterrey', 'booked', v_asesor
  );

  -- A) booking SIN contingencia: cancel/status change OK (con triggers off excepto después)
  v_exp_ok := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp_ok, v_org_ok, v_asesor, 'mejoravit', '91721100002', 'B11 OK',
    '5517211002', 'interno', true, now(), 4, 'en_proceso', 'activo', now()
  );
  -- put asesor also in org_ok for ownership? cancel uses org of actor - keep mesa/asesor on v_org
  -- For A/B use direct UPDATE without contingency (actor irrelevant)
  v_book_ok := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_book_ok, v_org_ok, 'biometricos', v_exp_ok, CURRENT_DATE + 11, time '09:00', 'apodaca', 'booked', v_asesor
  );
  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;

  -- A) normal cancel via status update (no contingency)
  UPDATE public.agenda_bookings SET status = 'cancelled', cancelled_at = now() WHERE id = v_book_ok;
  PERFORM public.__p172_assert(
    (SELECT status::text FROM public.agenda_bookings WHERE id = v_book_ok) = 'cancelled',
    'A normal cancel OK'
  );
  -- restore for reagenda test B
  UPDATE public.agenda_bookings SET status = 'booked', cancelled_at = NULL WHERE id = v_book_ok;
  UPDATE public.agenda_bookings SET booking_date = CURRENT_DATE + 12 WHERE id = v_book_ok;
  PERFORM public.__p172_assert(
    (SELECT booking_date FROM public.agenda_bookings WHERE id = v_book_ok) = CURRENT_DATE + 12,
    'B normal reagenda date OK'
  );

  -- Declare contingency on v_book
  PERFORM public.__p172_reset();
  UPDATE public.profiles SET organization_id = v_org WHERE id = v_mesa;
  UPDATE public.profiles SET organization_id = v_org WHERE id = v_asesor;
  PERFORM public.__p172_auth(v_mesa);
  v_res := public.agenda_declarar_contingencia(CURRENT_DATE + 10, 'biometricos', NULL, 'B11 hardening');
  PERFORM public.__p172_assert(v_res->>'ok' = 'true', 'declare ok');
  v_cont := (v_res->>'contingency_id')::uuid;
  PERFORM public.__p172_assert(public.agenda_booking_has_contingency(v_book), 'helper true after declare');
  SELECT id INTO v_item FROM public.agenda_contingencia_citas WHERE original_booking_id = v_book;

  -- Mutaciones de prueba como postgres (RLS no debe ocultar el UPDATE silencioso)
  PERFORM public.__p172_reset();

  -- C) cancel DENIED
  v_err := NULL;
  BEGIN
    UPDATE public.agenda_bookings SET status = 'cancelled', cancelled_at = now() WHERE id = v_book;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.__p172_assert(v_err ILIKE '%BOOKING_UNDER_CONTINGENCY%', 'C cancel denied');
  PERFORM public.__p172_assert(
    (SELECT status::text FROM public.agenda_bookings WHERE id = v_book) = 'booked',
    'C status still booked'
  );

  -- D) reagenda DENIED
  v_err := NULL;
  BEGIN
    UPDATE public.agenda_bookings SET booking_date = CURRENT_DATE + 20 WHERE id = v_book;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.__p172_assert(v_err ILIKE '%BOOKING_UNDER_CONTINGENCY%', 'D reagenda denied');

  -- E) Drive validation DENIED
  v_err := NULL;
  BEGIN
    PERFORM public.__p172_auth(v_mesa);
    PERFORM public.mesa_set_agenda_drive_validation(v_book, true);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.__p172_assert(v_err ILIKE '%BOOKING_UNDER_CONTINGENCY%', 'E Drive denied');

  -- F) P170 ACTIVE → SKIPPED
  PERFORM public.__p172_service();
  SELECT etapa_actual, subestado::text INTO v_etapa, v_sub FROM public.expedientes WHERE id = v_exp;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 30, CURRENT_DATE + 10, 'biometricos', 'monterrey',
    v_book, v_exp, 'COMPLETED', 'CESI', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p172_assert(v_res->>'outcome' = 'SKIPPED_CONTINGENCY', 'F ACTIVE skip');

  -- G/H/I) close contingency → still SKIPPED; FAILED no reject
  PERFORM public.__p172_reset();
  UPDATE public.agenda_contingencias SET status = 'closed', updated_at = now() WHERE id = v_cont;
  PERFORM public.__p172_assert(public.agenda_booking_has_contingency(v_book), 'G helper true when CLOSED');
  PERFORM public.__p172_service();
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 31, CURRENT_DATE + 10, 'biometricos', 'monterrey',
    v_book, v_exp, 'COMPLETED', 'CESI', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p172_assert(v_res->>'outcome' = 'SKIPPED_CONTINGENCY', 'G CLOSED still skip');
  PERFORM public.__p172_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp) = v_etapa,
    'H CLOSED no etapa advance'
  );

  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 32, CURRENT_DATE + 10, 'biometricos', 'monterrey',
    v_book, v_exp, 'FAILED_OR_NOT_ATTENDED', 'X', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p172_assert(v_res->>'outcome' = 'SKIPPED_CONTINGENCY', 'I CLOSED FAILED skip');
  PERFORM public.__p172_assert(
    (SELECT subestado::text FROM public.expedientes WHERE id = v_exp) = v_sub,
    'I no rechazo'
  );

  -- Re-open contingency active for J extraordinary (item still pending)
  UPDATE public.agenda_contingencias SET status = 'active' WHERE id = v_cont;
  SELECT count(*) INTO v_outbox_before FROM public.agenda_sheet_sync_outbox;
  SELECT count(*) INTO v_inv_before FROM public.agenda_sheet_slot_inventory WHERE organization_id = v_org;

  PERFORM public.__p172_reset();
  UPDATE public.profiles SET organization_id = v_org WHERE id = v_asesor;
  PERFORM public.__p172_auth(v_asesor);
  v_res := public.asesor_agendar_cita_extraordinaria(v_item, CURRENT_DATE + 25, time '08:30', 'monterrey');
  PERFORM public.__p172_assert(v_res->>'ok' = 'true', 'J extraordinary allowed');

  PERFORM public.__p172_reset();
  SELECT count(*) INTO v_outbox_after FROM public.agenda_sheet_sync_outbox;
  SELECT count(*) INTO v_inv_after FROM public.agenda_sheet_slot_inventory WHERE organization_id = v_org;
  PERFORM public.__p172_assert(v_outbox_after = v_outbox_before, 'K 0 outbox');
  PERFORM public.__p172_assert(v_inv_after = v_inv_before, 'K 0 inventory');
  PERFORM public.__p172_assert(
    NOT EXISTS (
      SELECT 1 FROM public.agenda_sheet_slot_links sl
      JOIN public.agenda_extraordinary_bookings eb ON eb.id = sl.booking_id
      WHERE eb.organization_id = v_org
    ),
    'K 0 slot_link on extraordinary'
  );

  -- CLOSED still blocks cancel after rebook
  UPDATE public.agenda_contingencias SET status = 'closed' WHERE id = v_cont;
  v_err := NULL;
  BEGIN
    UPDATE public.agenda_bookings SET status = 'cancelled' WHERE id = v_book;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.__p172_assert(v_err ILIKE '%BOOKING_UNDER_CONTINGENCY%', 'CLOSED still blocks cancel');

  RAISE NOTICE 'P172 B1.1 hardening: ALL PASSED';
END;
$$;
