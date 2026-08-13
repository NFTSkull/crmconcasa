\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p175_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P175 FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p175_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p175_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'postgres', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p175_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9175-000000000001';
  v_asesor UUID := '00000000-0000-4000-9175-000000000011';
  v_mesa UUID := '00000000-0000-4000-9175-000000000012';
  v_exp UUID := '00000000-0000-4000-9175-000000000021';
  v_bio UUID := '00000000-0000-4000-9175-000000000031';
  v_req UUID;
  v_book UUID;
  v_book2 UUID;
  v_res JSONB;
  v_etapa INT;
  v_fecha DATE := CURRENT_DATE + 5;
  v_inv1 UUID := '00000000-0000-4000-9175-000000000041';
  v_inv2 UUID := '00000000-0000-4000-9175-000000000042';
  v_inv3 UUID := '00000000-0000-4000-9175-000000000043';
  v_ok INT;
  v_fail INT;
  v_sub TEXT;
BEGIN
  PERFORM public.__p175_reset();

  DELETE FROM public.agenda_inscripcion_requerimientos WHERE organization_id = v_org;
  DELETE FROM public.agenda_sheet_operational_results WHERE organization_id = v_org;
  DELETE FROM public.agenda_sheet_slot_inventory WHERE organization_id = v_org;
  DELETE FROM public.agenda_sheet_sync_outbox WHERE organization_id = v_org;
  DELETE FROM public.agenda_bookings WHERE organization_id = v_org;
  DELETE FROM public.action_log WHERE organization_id = v_org;
  DELETE FROM public.expediente_paso_visual_transiciones
    WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE organization_id = v_org);
  DELETE FROM public.expedientes WHERE organization_id = v_org;
  DELETE FROM public.profiles WHERE organization_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p175-org', 'P175 Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p175-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p175-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p175-asesor@test.local', 'Asesor P175', 'asesor', 'interno', NULL, true),
    (v_mesa, v_org, 'p175-mesa@test.local', 'Mesa P175', 'mesa_admin', NULL, 'interno', true)
  ON CONFLICT (id) DO UPDATE SET
    active = true, organization_id = EXCLUDED.organization_id, app_role = EXCLUDED.app_role;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91750000001', 'Cliente P175',
    '5517500001', 'interno', true, now(), 5, 'en_proceso', 'activo', now()
  );

  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_bio, v_org, 'biometricos', v_exp, v_fecha - 1, TIME '10:00',
    'monterrey', 'booked', v_asesor
  );
  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;

  INSERT INTO public.agenda_sheet_operational_results (
    organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
    kind, location_id, booking_id, expediente_id,
    biometric_result_class, biometric_result_raw,
    notification_result_class, notification_result_raw,
    signature_result_class, inscripcion_rebook_required, inscripcion_rebook_reason_raw
  ) VALUES (
    v_org, 'sheet-p175', 1, '01 ENE', v_fecha - 1, 10,
    'biometricos', 'monterrey', v_bio, v_exp,
    'COMPLETED', 'CESI MTY',
    'PENDING', 'REAGENDA INSCRIPCION, FALLA SISTEMA',
    'PENDING', true, 'REAGENDA INSCRIPCION, FALLA SISTEMA'
  );

  INSERT INTO public.agenda_sheet_slot_inventory (
    id, organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date,
    kind, location_id, slot_time, sheet_slot_time, sheet_row, status, slot_key, occupancy_source
  ) VALUES
    (v_inv1, v_org, 'sheet-p175', 2, 'FECHA', v_fecha, 'inscripcion', 'monterrey',
     TIME '11:00', TIME '11:00', 5, 'available',
     'inscripcion|'||v_fecha||'|11:00|monterrey|sheet=11:00|sheetId=2|row=5', 'sheet_webhook'),
    (v_inv2, v_org, 'sheet-p175', 2, 'FECHA', v_fecha, 'inscripcion', 'monterrey',
     TIME '11:00', TIME '11:00', 6, 'available',
     'inscripcion|'||v_fecha||'|11:00|monterrey|sheet=11:00|sheetId=2|row=6', 'sheet_webhook'),
    (v_inv3, v_org, 'sheet-p175', 2, 'FECHA', v_fecha, 'inscripcion', 'monterrey',
     TIME '11:00', TIME '11:00', 7, 'available',
     'inscripcion|'||v_fecha||'|11:00|monterrey|sheet=11:00|sheetId=2|row=7', 'sheet_webhook');

  PERFORM public.__p175_auth(v_asesor);
  v_res := public.agenda_sheet_inventory_availability('inscripcion', v_fecha, 'monterrey');
  PERFORM public.__p175_assert((v_res->>'capacity')::INT = 3, 'capacity 3');
  PERFORM public.__p175_assert((v_res->>'available')::INT = 3, 'available 3');

  PERFORM public.__p175_auth(v_mesa);
  v_res := public.mesa_solicitar_cita_inscripcion(v_exp, 'Falla sistema inscripción');
  PERFORM public.__p175_assert((v_res->>'ok')::BOOLEAN, 'mesa require ok');
  v_req := (v_res->>'requirement_id')::UUID;
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p175_assert(v_etapa = 5, 'etapa unchanged after require');

  v_res := public.mesa_solicitar_cita_inscripcion(v_exp, 'otra');
  PERFORM public.__p175_assert((v_res->>'idempotent')::BOOLEAN, 'require idempotent');

  PERFORM public.__p175_service();
  v_res := public.agenda_inscripcion_require_from_sheet(
    v_org, v_bio, v_exp, 1, 10, 'REAGENDA INSCRIPCION, FALLA SISTEMA'
  );
  PERFORM public.__p175_assert((v_res->>'idempotent')::BOOLEAN, 'sheet require idempotent');

  PERFORM public.__p175_auth(v_asesor);
  v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', NULL);
  PERFORM public.__p175_assert((v_res->>'ok')::BOOLEAN, 'book ok');
  PERFORM public.__p175_assert(v_res->>'booking_time' = '11:00', 'fixed 11:00');
  v_book := (v_res->>'booking_id')::UUID;
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p175_assert(v_etapa = 5, 'etapa unchanged after book');

  v_res := public.agenda_sheet_inventory_availability('inscripcion', v_fecha, 'monterrey');
  PERFORM public.__p175_assert((v_res->>'available')::INT = 2, 'available 2 after book');

  BEGIN
    PERFORM public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', NULL);
    PERFORM public.__p175_assert(false, 'duplicate book should fail');
  EXCEPTION WHEN others THEN
    PERFORM public.__p175_assert(
      SQLERRM ILIKE '%activa%' OR SQLERRM ILIKE '%requirement%',
      'duplicate blocked'
    );
  END;

  -- Cancel → rebook_required (stage invariant)
  v_res := public.cancel_inscripcion_extraordinaria(v_book, 'para test cancel', false);
  PERFORM public.__p175_assert(v_res->>'requirement_status' = 'rebook_required', 'rebook_required');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p175_assert(v_etapa = 5, 'etapa unchanged after cancel');

  -- Re-book then reagenda (reagenda cancela+crea)
  v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', 'pre-reagenda');
  PERFORM public.__p175_assert((v_res->>'ok')::BOOLEAN, 'rebook before reagenda');
  v_book := (v_res->>'booking_id')::UUID;

  v_res := public.reagendar_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', 'reagenda');
  PERFORM public.__p175_assert((v_res->>'ok')::BOOLEAN, 'reagenda ok');
  PERFORM public.__p175_assert(v_res->>'booking_time' = '11:00', 'reagenda keeps 11:00');
  v_book2 := COALESCE(
    (v_res->>'booking_id')::UUID,
    (v_res->'booking'->>'booking_id')::UUID
  );
  PERFORM public.__p175_assert(v_book2 IS NOT NULL, 'reagenda booking_id');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p175_assert(v_etapa = 5, 'etapa unchanged after reagenda');

  -- Race: leave one seat
  PERFORM public.cancel_inscripcion_extraordinaria(v_book2, 'race setup', false);
  PERFORM public.__p175_reset();
  UPDATE public.agenda_sheet_slot_inventory
  SET status = 'available', booking_id = NULL, expediente_id = NULL, claimed_at = NULL
  WHERE organization_id = v_org AND kind = 'inscripcion' AND booking_date = v_fecha;
  UPDATE public.agenda_sheet_slot_inventory
  SET status = 'occupied_external'
  WHERE id IN (v_inv1, v_inv2);

  PERFORM public.__p175_auth(v_asesor);
  v_ok := 0; v_fail := 0;
  BEGIN
    v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', 'race-a');
    IF (v_res->>'ok')::BOOLEAN THEN v_ok := v_ok + 1; END IF;
  EXCEPTION WHEN others THEN
    v_fail := v_fail + 1;
  END;
  BEGIN
    UPDATE public.agenda_inscripcion_requerimientos
    SET status = 'pending_booking', booked_booking_id = NULL
    WHERE expediente_id = v_exp AND status IN ('booked','rebook_required');
    v_res := public.book_inscripcion_extraordinaria(v_exp, v_fecha, 'monterrey', 'race-b');
    IF (v_res->>'ok')::BOOLEAN THEN v_ok := v_ok + 1; END IF;
  EXCEPTION WHEN others THEN
    v_fail := v_fail + 1;
  END;
  PERFORM public.__p175_assert(v_ok = 1 AND v_fail = 1, format('race ok=%s fail=%s', v_ok, v_fail));

  PERFORM public.__p175_assert(
    EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'booking_kind' AND e.enumlabel = 'inscripcion'
    ),
    'enum inscripcion'
  );

  -- Apply: no reject when flag set (even if class FAILED)
  PERFORM public.__p175_service();
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, 'sheet-p175', 1::bigint, 10, (v_fecha - 1), 'biometricos', 'monterrey',
    v_bio, v_exp,
    'COMPLETED', 'CESI MTY',
    'FAILED_OR_NOT_ATTENDED', 'REAGENDA INSCRIPCION, FALLA SISTEMA',
    'PENDING', NULL, NULL,
    'fp-p175-1',
    false, false, false, false
  );
  PERFORM public.__p175_assert(v_res->>'outcome' = 'REQUIRES_INSCRIPCION_REBOOK', 'apply no reject');
  SELECT subestado INTO v_sub FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p175_assert(v_sub = 'en_proceso', 'no rechazo subestado');

  PERFORM public.__p175_reset();
  RAISE NOTICE 'P175 SQL: ALL PASSED';
END;
$$;

SELECT 'P175 SQL: PASSED' AS result;
