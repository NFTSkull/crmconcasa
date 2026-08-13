\set ON_ERROR_STOP on

-- P178: asesor inscripción self-service (auto-requirement source=asesor).
-- Requiere mig 173+174+175 aplicadas en local.

CREATE OR REPLACE FUNCTION public.__p178_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P178 FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p178_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p178_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'postgres', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p178_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9178-000000000001';
  v_org2 UUID := '00000000-0000-4000-9178-000000000002';
  v_asesor UUID := '00000000-0000-4000-9178-000000000011';
  v_asesor2 UUID := '00000000-0000-4000-9178-000000000012';
  v_asesor_org2 UUID := '00000000-0000-4000-9178-000000000013';
  v_mesa UUID := '00000000-0000-4000-9178-000000000014';
  v_exp UUID := '00000000-0000-4000-9178-000000000021';
  v_exp2 UUID := '00000000-0000-4000-9178-000000000022';
  v_exp_org2 UUID := '00000000-0000-4000-9178-000000000023';
  v_bio UUID := '00000000-0000-4000-9178-000000000031';
  v_inv1 UUID := '00000000-0000-4000-9178-000000000041';
  v_inv2 UUID := '00000000-0000-4000-9178-000000000042';
  v_inv3 UUID := '00000000-0000-4000-9178-000000000043';
  v_req UUID;
  v_req2 UUID;
  v_book UUID;
  v_res JSONB;
  v_etapa INT;
  v_fecha_cita TIMESTAMPTZ;
  v_fecha DATE := CURRENT_DATE + 7;
  v_n INT;
  v_src TEXT;
  v_status TEXT;
  v_ok INT;
  v_fail INT;
BEGIN
  PERFORM public.__p178_reset();

  DELETE FROM public.agenda_inscripcion_requerimientos WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_sheet_operational_results WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_sheet_slot_inventory WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_sheet_sync_outbox WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.agenda_bookings WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.action_log WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.expediente_paso_visual_transiciones
    WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE organization_id IN (v_org, v_org2));
  DELETE FROM public.expedientes WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.profiles WHERE organization_id IN (v_org, v_org2);
  DELETE FROM public.organizations WHERE id IN (v_org, v_org2);

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES
    (v_org, 'p178-org', 'P178 Org', true),
    (v_org2, 'p178-org2', 'P178 Org2', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p178-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor2, 'authenticated', 'authenticated', 'p178-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor_org2, 'authenticated', 'authenticated', 'p178-asesor-org2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p178-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p178-asesor@test.local', 'Asesor P178', 'asesor', 'interno', NULL, true),
    (v_asesor2, v_org, 'p178-asesor2@test.local', 'Asesor2 P178', 'asesor', 'interno', NULL, true),
    (v_asesor_org2, v_org2, 'p178-asesor-org2@test.local', 'Asesor Org2', 'asesor', 'interno', NULL, true),
    (v_mesa, v_org, 'p178-mesa@test.local', 'Mesa P178', 'mesa_admin', NULL, 'interno', true)
  ON CONFLICT (id) DO UPDATE SET
    active = true, organization_id = EXCLUDED.organization_id, app_role = EXCLUDED.app_role;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91780000001', 'Cliente P178',
    '5517800001', 'interno', true, now(), 5, 'en_proceso', 'activo', now()
  );

  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_bio, v_org, 'biometricos', v_exp, v_fecha - 2, TIME '10:00',
    'monterrey', 'booked', v_asesor
  );
  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;

  INSERT INTO public.agenda_sheet_slot_inventory (
    id, organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date,
    kind, location_id, slot_time, sheet_slot_time, sheet_row, status, slot_key, occupancy_source
  ) VALUES
    (v_inv1, v_org, 'sheet-p178', 2, 'FECHA', v_fecha, 'inscripcion', 'monterrey',
     TIME '11:00', TIME '11:00', 5, 'available',
     'inscripcion|'||v_fecha||'|11:00|monterrey|sheet=11:00|sheetId=2|row=5', 'sheet_webhook'),
    (v_inv2, v_org, 'sheet-p178', 2, 'FECHA', v_fecha, 'inscripcion', 'monterrey',
     TIME '11:00', TIME '11:00', 6, 'available',
     'inscripcion|'||v_fecha||'|11:00|monterrey|sheet=11:00|sheetId=2|row=6', 'sheet_webhook'),
    (v_inv3, v_org, 'sheet-p178', 2, 'FECHA', v_fecha, 'inscripcion', 'monterrey',
     TIME '11:00', TIME '11:00', 7, 'available',
     'inscripcion|'||v_fecha||'|11:00|monterrey|sheet=11:00|sheetId=2|row=7', 'sheet_webhook');

  -- A) elegible sin requirement → create asesor + book + outbox
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.agenda_inscripcion_asesor_eligibility(v_exp);
  PERFORM public.__p178_assert((v_res->>'eligible')::BOOLEAN, 'A eligible');
  PERFORM public.__p178_assert(v_res->>'reason_code' = 'eligible', 'A reason');

  SELECT etapa_actual, fecha_cita INTO v_etapa, v_fecha_cita FROM public.expedientes WHERE id = v_exp;
  v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', NULL);
  PERFORM public.__p178_assert((v_res->>'ok')::BOOLEAN, 'A book ok');
  PERFORM public.__p178_assert((v_res->>'requirement_created')::BOOLEAN, 'A req created');
  PERFORM public.__p178_assert(v_res->>'booking_time' = '11:00', 'A 11:00');
  PERFORM public.__p178_assert(v_res->>'location_id' = 'monterrey', 'A mty');
  v_book := (v_res->>'booking_id')::UUID;
  v_req := (v_res->>'requirement_id')::UUID;
  SELECT source_type, status INTO v_src, v_status
  FROM public.agenda_inscripcion_requerimientos WHERE id = v_req;
  PERFORM public.__p178_assert(v_src = 'asesor', 'A source asesor');
  PERFORM public.__p178_assert(v_status = 'booked', 'A req booked');
  SELECT etapa_actual INTO v_n FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p178_assert(v_n = v_etapa, 'A etapa unchanged');
  PERFORM public.__p178_assert(
    (SELECT fecha_cita FROM public.expedientes WHERE id = v_exp) IS NOT DISTINCT FROM v_fecha_cita,
    'N fecha_cita unchanged'
  );
  PERFORM public.__p178_service();
  SELECT count(*) INTO v_n FROM public.agenda_sheet_sync_outbox o
  WHERE o.organization_id = v_org
    AND o.event_type = 'booking_created'
    AND (o.payload->>'booking_id' = v_book::text OR o.payload->>'kind' = 'inscripcion');
  PERFORM public.__p178_assert(v_n >= 1, 'A outbox booking_created');
  PERFORM public.__p178_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_sheet_sync_outbox o
      WHERE o.organization_id = v_org
        AND o.event_type = 'booking_created'
        AND o.payload->>'kind' = 'inscripcion'
        AND left(COALESCE(o.payload->>'booking_time', ''), 5) = '11:00'
        AND o.payload->>'location_id' = 'monterrey'
    ),
    'A outbox payload kind/time/loc'
  );
  PERFORM public.__p178_assert(
    EXISTS (
      SELECT 1 FROM public.action_log a
      WHERE a.organization_id = v_org
        AND a.action = 'agenda.inscripcion.require'
        AND a.payload->>'source_type' = 'asesor'
        AND (a.payload->>'auto_created_during_book')::BOOLEAN
    ),
    'A action_log require auto'
  );
  PERFORM public.__p178_auth(v_asesor);

  -- I) segundo book bloqueado
  BEGIN
    PERFORM public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', NULL);
    PERFORM public.__p178_assert(false, 'I should fail');
  EXCEPTION WHEN others THEN
    PERFORM public.__p178_assert(SQLERRM ILIKE '%activa%' OR SQLERRM ILIKE '%requirement%', 'I blocked');
  END;

  -- B) requirement sheet existente → no duplicar
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.cancel_inscripcion_extraordinaria(v_book, 'p178 cancel B', false);
  PERFORM public.__p178_assert(v_res->>'requirement_status' = 'rebook_required', 'B rebook_required');
  PERFORM public.__p178_service();
  UPDATE public.agenda_inscripcion_requerimientos
  SET source_type = 'sheet', status = 'pending_booking', booked_booking_id = NULL
  WHERE id = v_req;
  UPDATE public.agenda_sheet_slot_inventory
  SET status = 'available', booking_id = NULL, expediente_id = NULL, claimed_at = NULL
  WHERE organization_id = v_org AND kind = 'inscripcion' AND booking_date = v_fecha;
  SELECT count(*) INTO v_n FROM public.agenda_inscripcion_requerimientos WHERE expediente_id = v_exp;
  PERFORM public.__p178_assert(v_n = 1, 'B single req before');
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', NULL);
  PERFORM public.__p178_assert((v_res->>'ok')::BOOLEAN, 'B book ok');
  PERFORM public.__p178_assert(NOT COALESCE((v_res->>'requirement_created')::BOOLEAN, true), 'B no create');
  PERFORM public.__p178_service();
  SELECT count(*) INTO v_n FROM public.agenda_inscripcion_requerimientos WHERE expediente_id = v_exp;
  PERFORM public.__p178_assert(v_n = 1, 'B still one req');
  SELECT source_type INTO v_src FROM public.agenda_inscripcion_requerimientos WHERE id = v_req;
  PERFORM public.__p178_assert(v_src = 'sheet', 'B keeps sheet');
  v_book := (v_res->>'booking_id')::UUID;

  -- C) requirement mesa → no duplicar
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.cancel_inscripcion_extraordinaria(v_book, 'p178 cancel C', false);
  PERFORM public.__p178_service();
  UPDATE public.agenda_inscripcion_requerimientos
  SET source_type = 'mesa', status = 'pending_booking', booked_booking_id = NULL
  WHERE id = v_req;
  UPDATE public.agenda_sheet_slot_inventory
  SET status = 'available', booking_id = NULL, expediente_id = NULL, claimed_at = NULL
  WHERE organization_id = v_org AND kind = 'inscripcion' AND booking_date = v_fecha;
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', NULL);
  PERFORM public.__p178_assert((v_res->>'ok')::BOOLEAN, 'C book ok');
  PERFORM public.__p178_assert(NOT COALESCE((v_res->>'requirement_created')::BOOLEAN, true), 'C no create');
  PERFORM public.__p178_service();
  SELECT source_type INTO v_src
  FROM public.agenda_inscripcion_requerimientos WHERE id = (v_res->>'requirement_id')::UUID;
  PERFORM public.__p178_assert(v_src = 'mesa', 'C keeps mesa');
  v_book := (v_res->>'booking_id')::UUID;

  -- J) Apodaca rechazado + sin residual
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.cancel_inscripcion_extraordinaria(v_book, 'prep apodaca', true);
  PERFORM public.__p178_service();
  DELETE FROM public.agenda_inscripcion_requerimientos WHERE expediente_id = v_exp;
  UPDATE public.agenda_sheet_slot_inventory
  SET status = 'available', booking_id = NULL, expediente_id = NULL, claimed_at = NULL
  WHERE organization_id = v_org AND kind = 'inscripcion' AND booking_date = v_fecha;
  PERFORM public.__p178_auth(v_asesor);
  BEGIN
    PERFORM public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'apodaca', NULL);
    PERFORM public.__p178_assert(false, 'J should fail');
  EXCEPTION WHEN others THEN
    PERFORM public.__p178_assert(SQLERRM ILIKE '%Monterrey%' OR SQLERRM ILIKE '%sede%', 'J apodaca');
  END;
  PERFORM public.__p178_service();
  SELECT count(*) INTO v_n FROM public.agenda_inscripcion_requerimientos WHERE expediente_id = v_exp;
  PERFORM public.__p178_assert(v_n = 0, 'J no residual req');

  -- D) sin biométricos → no book / no residual
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '91780000002', 'Cliente sin bio',
    '5517800002', 'interno', true, now(), 5, 'en_proceso', 'activo', now()
  );
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.agenda_inscripcion_asesor_eligibility(v_exp2);
  PERFORM public.__p178_assert(NOT (v_res->>'eligible')::BOOLEAN, 'D not eligible');
  PERFORM public.__p178_assert(v_res->>'reason_code' = 'sin_biometricos', 'D code');
  BEGIN
    PERFORM public.book_inscripcion_extraordinaria(v_exp2, v_fecha, 'monterrey', NULL);
    PERFORM public.__p178_assert(false, 'D book should fail');
  EXCEPTION WHEN others THEN
    PERFORM public.__p178_assert(SQLERRM ILIKE '%biométric%', 'D blocked');
  END;
  PERFORM public.__p178_service();
  SELECT count(*) INTO v_n FROM public.agenda_inscripcion_requerimientos WHERE expediente_id = v_exp2;
  PERFORM public.__p178_assert(v_n = 0, 'D no residual');

  -- E) asesor ajeno
  PERFORM public.__p178_auth(v_asesor2);
  v_res := public.agenda_inscripcion_asesor_eligibility(v_exp);
  PERFORM public.__p178_assert(NOT (v_res->>'eligible')::BOOLEAN, 'E not owner');
  PERFORM public.__p178_assert(v_res->>'reason_code' = 'not_owner', 'E code');
  BEGIN
    PERFORM public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', NULL);
    PERFORM public.__p178_assert(false, 'E should fail');
  EXCEPTION WHEN others THEN
    PERFORM public.__p178_assert(SQLERRM ILIKE '%autorizado%', 'E blocked');
  END;

  -- F) org ajena
  PERFORM public.__p178_service();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp_org2, v_org2, v_asesor_org2, 'mejoravit', '91780000003', 'Cliente org2',
    '5517800003', 'interno', true, now(), 5, 'en_proceso', 'activo', now()
  );
  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org2, 'biometricos', v_exp_org2, v_fecha - 1, TIME '10:00',
    'monterrey', 'booked', v_asesor_org2
  );
  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.agenda_inscripcion_asesor_eligibility(v_exp_org2);
  PERFORM public.__p178_assert(NOT (v_res->>'eligible')::BOOLEAN, 'F org mismatch');
  BEGIN
    PERFORM public.book_inscripcion_extraordinaria(v_exp_org2, v_fecha, 'monterrey', NULL);
    PERFORM public.__p178_assert(false, 'F should fail');
  EXCEPTION WHEN others THEN
    PERFORM public.__p178_assert(
      SQLERRM ILIKE '%autorizado%' OR SQLERRM ILIKE '%disponible%',
      'F blocked'
    );
  END;

  -- G) rechazado
  PERFORM public.__p178_reset();
  UPDATE public.expedientes SET subestado = 'rechazado' WHERE id = v_exp;
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.agenda_inscripcion_asesor_eligibility(v_exp);
  PERFORM public.__p178_assert(NOT (v_res->>'eligible')::BOOLEAN, 'G rejected');
  PERFORM public.__p178_assert(v_res->>'reason_code' = 'rejected', 'G code');
  PERFORM public.__p178_service();
  UPDATE public.expedientes SET subestado = 'en_proceso' WHERE id = v_exp;

  -- H) no submitted
  UPDATE public.expedientes SET submitted_to_mesa = false WHERE id = v_exp;
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.agenda_inscripcion_asesor_eligibility(v_exp);
  PERFORM public.__p178_assert(NOT (v_res->>'eligible')::BOOLEAN, 'H not submitted');
  PERFORM public.__p178_assert(v_res->>'reason_code' = 'not_submitted', 'H code');
  PERFORM public.__p178_service();
  UPDATE public.expedientes SET submitted_to_mesa = true WHERE id = v_exp;

  -- K) sin cupo → rollback requirement autocreado
  DELETE FROM public.agenda_inscripcion_requerimientos WHERE expediente_id = v_exp;
  DELETE FROM public.agenda_bookings
  WHERE expediente_id = v_exp AND kind = 'inscripcion'::public.booking_kind;
  UPDATE public.agenda_sheet_slot_inventory
  SET status = 'occupied_external', booking_id = NULL, expediente_id = NULL
  WHERE organization_id = v_org AND kind = 'inscripcion' AND booking_date = v_fecha;
  PERFORM public.__p178_auth(v_asesor);
  BEGIN
    PERFORM public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', NULL);
    PERFORM public.__p178_assert(false, 'K should fail');
  EXCEPTION WHEN others THEN
    PERFORM public.__p178_assert(SQLERRM ILIKE '%SIN_CUPO%' OR SQLERRM ILIKE '%cupo%', 'K sin cupo');
  END;
  PERFORM public.__p178_service();
  SELECT count(*) INTO v_n FROM public.agenda_inscripcion_requerimientos WHERE expediente_id = v_exp;
  PERFORM public.__p178_assert(v_n = 0, 'K rollback requirement');

  -- L) race requirement → exactamente 1 abierto (simula unique_violation path)
  UPDATE public.agenda_sheet_slot_inventory
  SET status = 'available', booking_id = NULL, expediente_id = NULL, claimed_at = NULL
  WHERE organization_id = v_org AND kind = 'inscripcion' AND booking_date = v_fecha;
  INSERT INTO public.agenda_inscripcion_requerimientos (
    organization_id, expediente_id, source_type, status, requested_by, reason
  ) VALUES (
    v_org, v_exp, 'sheet', 'pending_booking', v_mesa, 'pre-race'
  ) RETURNING id INTO v_req2;
  PERFORM public.__p178_auth(v_asesor);
  v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', 'race-req');
  PERFORM public.__p178_assert((v_res->>'ok')::BOOLEAN, 'L book ok');
  PERFORM public.__p178_assert(NOT COALESCE((v_res->>'requirement_created')::BOOLEAN, true), 'L reuse');
  PERFORM public.__p178_service();
  SELECT count(*) INTO v_n FROM public.agenda_inscripcion_requerimientos
  WHERE expediente_id = v_exp AND status IN ('pending_booking','booked','rebook_required');
  PERFORM public.__p178_assert(v_n = 1, 'L one open');
  v_book := (v_res->>'booking_id')::UUID;

  -- M) race último cupo → 1 booking
  PERFORM public.__p178_auth(v_asesor);
  PERFORM public.cancel_inscripcion_extraordinaria(v_book, 'race cupo setup', false);
  PERFORM public.__p178_service();
  UPDATE public.agenda_inscripcion_requerimientos
  SET status = 'pending_booking', booked_booking_id = NULL
  WHERE expediente_id = v_exp;
  UPDATE public.agenda_sheet_slot_inventory
  SET status = 'available', booking_id = NULL, expediente_id = NULL, claimed_at = NULL
  WHERE organization_id = v_org AND kind = 'inscripcion' AND booking_date = v_fecha;
  UPDATE public.agenda_sheet_slot_inventory
  SET status = 'occupied_external'
  WHERE id IN (v_inv1, v_inv2);

  PERFORM public.__p178_auth(v_asesor);
  v_ok := 0; v_fail := 0;
  BEGIN
    v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', 'race-a');
    IF (v_res->>'ok')::BOOLEAN THEN v_ok := v_ok + 1; END IF;
  EXCEPTION WHEN others THEN
    v_fail := v_fail + 1;
  END;
  BEGIN
    PERFORM public.__p178_service();
    UPDATE public.agenda_inscripcion_requerimientos
    SET status = 'pending_booking', booked_booking_id = NULL
    WHERE expediente_id = v_exp AND status IN ('booked','rebook_required');
    -- Force no inventory left if first succeeded
    UPDATE public.agenda_sheet_slot_inventory
    SET status = 'occupied_external'
    WHERE organization_id = v_org AND kind = 'inscripcion' AND booking_date = v_fecha
      AND status = 'available';
    PERFORM public.__p178_auth(v_asesor);
    v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', 'race-b');
    IF (v_res->>'ok')::BOOLEAN THEN v_ok := v_ok + 1; END IF;
  EXCEPTION WHEN others THEN
    v_fail := v_fail + 1;
  END;
  PERFORM public.__p178_assert(v_ok = 1 AND v_fail = 1, format('M race ok=%s fail=%s', v_ok, v_fail));
  PERFORM public.__p178_service();
  SELECT count(*) INTO v_n FROM public.agenda_bookings
  WHERE expediente_id = v_exp AND kind = 'inscripcion'::public.booking_kind AND status = 'booked';
  PERFORM public.__p178_assert(v_n = 1, 'M one active booking');

  -- source_type check accepts asesor
  PERFORM public.__p178_assert(
    EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'agenda_inscripcion_requerimientos'
        AND c.conname = 'agenda_inscripcion_requerimientos_source_type_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%asesor%'
    ),
    'source_type check includes asesor'
  );

  PERFORM public.__p178_reset();
  RAISE NOTICE 'P178 SQL: ALL PASSED';
END;
$$;

SELECT 'P178 SQL: PASSED' AS result;

DROP FUNCTION IF EXISTS public.__p178_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p178_auth(UUID);
DROP FUNCTION IF EXISTS public.__p178_service();
DROP FUNCTION IF EXISTS public.__p178_reset();
