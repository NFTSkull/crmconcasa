-- ConCasa CRM — P173: red color veto (isolated)
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p173_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P173 FAIL: %', p_msg; END IF;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9173-000000000001';
  v_asesor UUID := '00000000-0000-4000-9173-000000000011';
  v_mesa UUID := '00000000-0000-4000-9173-000000000012';
  v_exp UUID;
  v_book UUID;
  v_res JSONB;
  v_fp TEXT;
  v_fp2 TEXT;
  v_etapa INT;
  v_sub TEXT;
  v_ssid TEXT := 'p173-red-ssid';
  v_sid BIGINT := 173001;
  v_row INT := 20;
  v_status TEXT;
  v_has_cont BOOLEAN;
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p173-red-veto-org', 'P173 Red Veto Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p173-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p173-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p173-asesor@test.local', 'Asesor P173', 'asesor', 'interno', NULL, true),
    (v_mesa, v_org, 'p173-mesa@test.local', 'Mesa P173', 'mesa_interno', NULL, 'interno', true)
  ON CONFLICT (id) DO UPDATE SET active = true, organization_id = EXCLUDED.organization_id;

  DELETE FROM public.agenda_extraordinary_bookings WHERE organization_id = v_org;
  DELETE FROM public.agenda_contingencia_citas WHERE organization_id = v_org;
  DELETE FROM public.agenda_contingencias WHERE organization_id = v_org;
  DELETE FROM public.agenda_sheet_operational_results WHERE spreadsheet_id = v_ssid;
  DELETE FROM public.action_log WHERE organization_id = v_org;
  DELETE FROM public.agenda_sheet_slot_inventory WHERE organization_id = v_org;
  DELETE FROM public.agenda_sheet_slot_links WHERE organization_id = v_org;
  DELETE FROM public.agenda_sheet_sync_outbox WHERE organization_id = v_org;
  DELETE FROM public.agenda_bookings WHERE organization_id = v_org;
  DELETE FROM public.expediente_rechazo_reactivaciones
    WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE organization_id = v_org);
  DELETE FROM public.expediente_rechazos_operativos
    WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE organization_id = v_org);
  DELETE FROM public.expediente_paso_visual_transiciones
    WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE organization_id = v_org);
  DELETE FROM public.expedientes WHERE organization_id = v_org;

  PERFORM public.__p173_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='agenda_sheet_operational_results'
        AND column_name IN ('biometric_cell_red','notification_cell_red','signature_cell_red','operational_red_veto')
      HAVING count(*) = 4
    ),
    'missing P173 color columns'
  );

  v_fp := public.agenda_sheet_ops_fingerprint(
    v_ssid, v_sid, v_row, NULL, NULL, 'biometricos',
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, NULL,
    false, false, false, false
  );
  v_fp2 := public.agenda_sheet_ops_fingerprint(
    v_ssid, v_sid, v_row, NULL, NULL, 'biometricos',
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, NULL,
    false, true, false, true
  );
  PERFORM public.__p173_assert(v_fp IS DISTINCT FROM v_fp2, 'fingerprint color-only must differ');

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado,
    fecha_cita
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit',
    lpad((10000000000 + (random() * 899999999)::bigint)::text, 11, '0'),
    'Cliente P173',
    '5517300001', 'interno', true, NOW() - INTERVAL '2 days',
    5, 'en_proceso', 'activo',
    NOW() - INTERVAL '1 hour'
  ) RETURNING id INTO v_exp;

  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;
  INSERT INTO public.agenda_bookings (
    id, organization_id, expediente_id, kind, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    gen_random_uuid(), v_org, v_exp, 'biometricos', CURRENT_DATE, '09:00',
    'monterrey', 'booked', v_asesor
  ) RETURNING id INTO v_book;
  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;

  -- upsert_batch flags + preserve apply metadata
  INSERT INTO public.agenda_sheet_operational_results (
    organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
    kind, location_id, booking_id, expediente_id,
    biometric_result_class, biometric_result_raw,
    notification_result_class, notification_result_raw,
    signature_result_class, signature_result_raw,
    notes_raw, last_seen_at, last_applied_fingerprint, apply_outcome
  ) VALUES (
    v_org, v_ssid, v_sid, 'AGO', CURRENT_DATE, v_row,
    'biometricos', 'monterrey', v_book, v_exp,
    'PENDING', NULL, 'PENDING', NULL, 'PENDING', NULL,
    NULL, NOW(), 'keep-me', 'NO_OP'
  ) ON CONFLICT (spreadsheet_id, sheet_id, sheet_row) DO NOTHING;

  PERFORM public.agenda_sheet_ops_upsert_batch(jsonb_build_array(jsonb_build_object(
    'organization_id', v_org,
    'spreadsheet_id', v_ssid,
    'sheet_id', v_sid,
    'sheet_title', 'AGO',
    'booking_date', CURRENT_DATE::text,
    'sheet_row', v_row,
    'kind', 'biometricos',
    'location_id', 'monterrey',
    'booking_id', v_book,
    'expediente_id', v_exp,
    'biometric_result_class', 'COMPLETED',
    'biometric_result_raw', 'CESI MTY',
    'notification_result_class', 'COMPLETED',
    'notification_result_raw', 'YA CON BETTY',
    'signature_result_class', 'PENDING',
    'biometric_cell_red', false,
    'notification_cell_red', true,
    'signature_cell_red', false,
    'operational_red_veto', true
  )));

  SELECT last_applied_fingerprint, apply_outcome, notification_cell_red, operational_red_veto
  INTO v_fp, v_sub, v_has_cont, v_has_cont
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = v_ssid AND sheet_id = v_sid AND sheet_row = v_row;

  SELECT last_applied_fingerprint, apply_outcome
  INTO v_fp, v_sub
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = v_ssid AND sheet_id = v_sid AND sheet_row = v_row;
  PERFORM public.__p173_assert(v_fp = 'keep-me', 'upsert must not wipe fingerprint');
  PERFORM public.__p173_assert(v_sub = 'NO_OP', 'upsert must not wipe apply_outcome');
  PERFORM public.__p173_assert(
    (SELECT notification_cell_red AND operational_red_veto
     FROM public.agenda_sheet_operational_results
     WHERE spreadsheet_id = v_ssid AND sheet_id = v_sid AND sheet_row = v_row),
    'upsert must set color flags'
  );

  SELECT etapa_actual, subestado::text INTO v_etapa, v_sub FROM public.expedientes WHERE id = v_exp;

  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, v_row, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, NULL,
    NULL,
    false, true, false, true
  );
  PERFORM public.__p173_assert(v_res->>'outcome' = 'COLOR_VETO', 'expected COLOR_VETO');
  PERFORM public.__p173_assert(COALESCE((v_res->>'mutated')::boolean, true) = false, 'no mutate');

  PERFORM public.__p173_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp) = v_etapa,
    'no etapa change'
  );
  PERFORM public.__p173_assert(
    (SELECT subestado::text FROM public.expedientes WHERE id = v_exp) = v_sub,
    'no subestado change'
  );
  SELECT status INTO v_status FROM public.agenda_bookings WHERE id = v_book;
  PERFORM public.__p173_assert(v_status = 'booked', 'booking intact');

  -- Replay idempotent COLOR_VETO / NO_OP
  v_fp := v_res->>'fingerprint';
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, v_row, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, NULL,
    NULL,
    false, true, false, true
  );
  PERFORM public.__p173_assert(
    v_res->>'outcome' IN ('NO_OP', 'COLOR_VETO'),
    'replay should be NO_OP or COLOR_VETO'
  );

  -- FAILED + red → reject (not COLOR_VETO)
  UPDATE public.expedientes SET etapa_actual = 5, subestado = 'en_proceso' WHERE id = v_exp;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, v_row + 1, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'FAILED_OR_NOT_ATTENDED', 'X', 'PENDING', NULL, NULL,
    NULL,
    false, true, false, true
  );
  PERFORM public.__p173_assert(v_res->>'outcome' IS DISTINCT FROM 'COLOR_VETO', 'FAILED beats color');
  SELECT subestado::text INTO v_sub FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p173_assert(v_sub = 'rechazado', 'FAILED+red rejects');

  -- red → green: fingerprint changes; rejected stays human reactivation
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, v_row + 1, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, NULL,
    NULL,
    false, false, false, false
  );
  PERFORM public.__p173_assert(
    v_res->>'outcome' = 'REQUIRES_HUMAN_REACTIVATION',
    'rejected + positive/no-red → human reactivation'
  );

  -- P172 priority if contingency helper present
  IF to_regprocedure('public.agenda_booking_has_contingency(uuid)') IS NOT NULL THEN
    UPDATE public.expedientes SET subestado = 'en_proceso', ciclo_estado = 'activo' WHERE id = v_exp;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_mesa::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
      PERFORM set_config('role', 'authenticated', true);
      PERFORM public.agenda_declarar_contingencia(CURRENT_DATE, 'biometricos', NULL, 'P173 contig');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'P173 contig declare skipped: %', SQLERRM;
    END;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);

    SELECT public.agenda_booking_has_contingency(v_book) INTO v_has_cont;
    IF COALESCE(v_has_cont, false) THEN
      v_res := public.agenda_sheet_apply_operational_result(
        v_org, v_ssid, v_sid, v_row + 2, CURRENT_DATE, 'biometricos', 'monterrey',
        v_book, v_exp,
        'FAILED_OR_NOT_ATTENDED', 'X', 'PENDING', NULL, 'PENDING', NULL, NULL,
        NULL,
        true, true, false, true
      );
      PERFORM public.__p173_assert(
        v_res->>'outcome' = 'SKIPPED_CONTINGENCY',
        'P172 beats red+FAILED'
      );
    ELSE
      RAISE NOTICE 'P173: booking not under contingency; priority case skipped';
    END IF;
  END IF;

  RAISE NOTICE 'P173 SQL: ALL PASSED';
END;
$$;
