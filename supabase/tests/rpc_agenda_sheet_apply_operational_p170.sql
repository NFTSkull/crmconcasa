-- ConCasa CRM — P170: agenda_sheet_apply_operational_result
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--   -f supabase/tests/rpc_agenda_sheet_apply_operational_p170.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p170_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P170 FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p170_set_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p170_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9170-000000000001';
  v_asesor UUID := '00000000-0000-4000-9170-000000000011';
  v_mesa UUID := '00000000-0000-4000-9170-000000000012';
  v_exp UUID;
  v_exp2 UUID;
  v_book UUID;
  v_book2 UUID;
  v_book_f UUID;
  v_res JSONB;
  v_res2 JSONB;
  v_fp TEXT;
  v_fp2 TEXT;
  v_etapa INT;
  v_sub TEXT;
  v_motivo TEXT;
  v_cnt INT;
  v_cnt_log INT;
  v_cnt_rech INT;
  v_status TEXT;
  v_ssid TEXT := 'p170-sheet-ssid';
  v_sid BIGINT := 170001;
  v_row INT := 10;
  v_firma_before DATE;
  v_firma_after DATE;
  v_docs_before INT;
  v_docs_after INT;
BEGIN
  PERFORM public.__p170_reset_auth();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p170-sheet-apply-org', 'P170 Sheet Apply Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p170-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p170-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p170-asesor@test.local', 'Asesor P170', 'asesor', 'interno', NULL, true),
    (v_mesa, v_org, 'p170-mesa@test.local', 'Mesa P170', 'mesa_interno', NULL, 'interno', true)
  ON CONFLICT (id) DO UPDATE SET active = true, organization_id = EXCLUDED.organization_id, app_role = EXCLUDED.app_role;

  INSERT INTO public.agenda_config (organization_id, kind, config, updated_by)
  VALUES (
    v_org, 'biometricos',
    jsonb_build_object('timezone', 'America/Monterrey', 'locations', jsonb_build_array('monterrey')),
    v_mesa
  ) ON CONFLICT (organization_id, kind) DO NOTHING;

  -- Cleanup prior
  DELETE FROM public.agenda_sheet_operational_results WHERE spreadsheet_id = v_ssid;
  DELETE FROM public.expediente_rechazo_reactivaciones WHERE organization_id = v_org;
  DELETE FROM public.expediente_rechazos_operativos WHERE organization_id = v_org;
  DELETE FROM public.action_log WHERE organization_id = v_org;
  DELETE FROM public.agenda_extraordinary_bookings WHERE organization_id = v_org;
  DELETE FROM public.agenda_contingencia_citas WHERE organization_id = v_org;
  DELETE FROM public.agenda_contingencias WHERE organization_id = v_org;
  DELETE FROM public.agenda_bookings WHERE organization_id = v_org;
  DELETE FROM public.editor_decisions WHERE organization_id = v_org;
  DELETE FROM public.cliente_datos WHERE organization_id = v_org;
  DELETE FROM public.expediente_paso_visual_transiciones
    WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE organization_id = v_org);
  DELETE FROM public.expedientes WHERE organization_id = v_org;

  -- P173 harness: claim inventory P131 bloquea INSERT fixtures sin sheet cupo.
  -- Desactivar triggers USER solo para seed del suite (misma técnica P172/P173).
  ALTER TABLE public.agenda_bookings DISABLE TRIGGER USER;

  -- Helper: create expediente + bio booking at etapa
  CREATE TEMP TABLE IF NOT EXISTS __p170_scratch (k TEXT PRIMARY KEY, v UUID);

  -- ========== Fixture base (etapa 4, bio booked, submitted) ==========
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado,
    fecha_cita
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91700000001', 'Cliente P170 Bio',
    '5517000001', 'interno', true, now(), 4, 'en_proceso', 'activo',
    now() - interval '1 hour'
  );

  v_book := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_book, v_org, 'biometricos', v_exp, CURRENT_DATE, time '10:00',
    'monterrey', 'booked', v_asesor
  );

  -- --- IDENTIDAD ---
  -- 1 Q null
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, v_row, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, NULL,
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'NO_APPLY', '1 Q null');

  -- 2 P null
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, v_row, CURRENT_DATE, 'biometricos', 'monterrey',
    NULL, v_exp,
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'NO_APPLY', '2 P null');

  -- 3 P otro expediente
  v_exp2 := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '91700000002', 'Otro',
    '5517000002', 'interno', true, now(), 4, 'en_proceso', 'activo', now() - interval '1 hour'
  );
  v_book2 := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_book2, v_org, 'biometricos', v_exp2, CURRENT_DATE, '11:00', 'monterrey', 'booked', v_asesor
  );
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 11, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book2, v_exp, -- mismatch
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'LINK_MISMATCH', '3 P otro expediente');

  -- 4 kind mismatch
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 12, CURRENT_DATE, 'firmas', 'monterrey',
    v_book, v_exp,
    'PENDING', NULL, 'PENDING', NULL, 'COMPLETED', 'SI', NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'LINK_MISMATCH', '4 kind mismatch');

  -- 5 org mismatch — use wrong org uuid that won't match booking
  -- (booking org is v_org; pass different org)
  v_res := public.agenda_sheet_apply_operational_result(
    '00000000-0000-4000-9170-999999999999'::uuid, v_ssid, v_sid, 13, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' IN ('LINK_MISMATCH', 'NO_APPLY'), '5 org mismatch');

  -- --- BIO 6: CESI + pending desde 4 → 5 ---
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 20, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '6 applied');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 5, '6 etapa 5');
  v_fp := v_res->>'fingerprint';

  -- 7 same at 5 → no-op (new row fingerprint same state)
  v_res2 := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 20, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res2->>'outcome' = 'NO_OP', '7 noop fingerprint');
  SELECT count(*) INTO v_cnt_log FROM public.action_log
  WHERE entity_id = v_exp AND action = 'agenda_sheet.operational.bio_advance';
  PERFORM public.__p170_assert(v_cnt_log = 1, '7 single bio_advance log');

  -- 8 >5 no downgrade: set etapa 8 manually then COMPLETED pending
  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_exp;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 21, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, 'note', NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'NO_OP', '8 no downgrade');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 8, '8 stays 8');

  -- Reset exp to 5 for notif close tests
  UPDATE public.expedientes SET etapa_actual = 5, subestado = 'en_proceso',
    fecha_cita = now() - interval '2 hours', motivo_rechazo = NULL, comentario_rechazo = NULL
  WHERE id = v_exp;

  -- 9/10 bio+notif COMPLETED → 8 from 5
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 22, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '10 applied 5→8');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 8, '10 etapa 8');
  PERFORM public.__p170_assert(
    EXISTS (
      SELECT 1 FROM public.action_log
      WHERE entity_id = v_exp AND action = 'agenda_sheet.operational.notification_close'
    ),
    '10 notification_close log'
  );

  -- 11 from 8+ noop
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 23, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'NO_OP', '11 noop >=8');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 8, '11 stays 8');

  -- 12 NO 8→9
  PERFORM public.__p170_assert(v_etapa = 8, '12 not 9');

  -- 13 firma_agendable_desde intact if column exists
  BEGIN
    EXECUTE 'SELECT firma_agendable_desde FROM public.expedientes WHERE id = $1'
      INTO v_firma_before USING v_exp;
    v_res := public.agenda_sheet_apply_operational_result(
      v_org, v_ssid, v_sid, 24, CURRENT_DATE, 'biometricos', 'monterrey',
      v_book, v_exp,
      'COMPLETED', 'CESI MTY', 'COMPLETED', 'SI', 'PENDING', NULL, 'x', NULL
    );
    EXECUTE 'SELECT firma_agendable_desde FROM public.expedientes WHERE id = $1'
      INTO v_firma_after USING v_exp;
    PERFORM public.__p170_assert(v_firma_before IS NOT DISTINCT FROM v_firma_after, '13 firma_agendable intact');
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;

  -- --- BIO FAIL 14-17 ---
  UPDATE public.expedientes SET etapa_actual = 4, subestado = 'en_proceso',
    motivo_rechazo = NULL, comentario_rechazo = NULL WHERE id = v_exp;
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 30, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'FAILED_OR_NOT_ATTENDED', 'X', 'PENDING', NULL, 'PENDING', NULL, 'NO ASISTIO SHEET', NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '14 reject applied');
  SELECT etapa_actual, subestado::text, motivo_rechazo INTO v_etapa, v_sub, v_motivo
  FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 4, '14 etapa intacta');
  PERFORM public.__p170_assert(v_sub = 'rechazado', '14 rechazado');
  PERFORM public.__p170_assert(v_motivo = 'NO ASISTIO SHEET', '15 motivo notes');

  -- 16 raw fallback
  UPDATE public.expedientes SET subestado = 'en_proceso', motivo_rechazo = NULL WHERE id = v_exp;
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 31, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'FAILED_OR_NOT_ATTENDED', 'NO ASISTIO', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  SELECT motivo_rechazo INTO v_motivo FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_motivo = 'NO ASISTIO', '16 raw fallback');

  -- 17 no avance positivo
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 4, '17 no advance on fail');

  -- --- 18-20 bio OK + notif FAIL ---
  UPDATE public.expedientes SET etapa_actual = 4, subestado = 'en_proceso',
    motivo_rechazo = NULL, comentario_rechazo = NULL, fecha_cita = now() - interval '1 hour'
  WHERE id = v_exp;
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 32, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'FAILED_OR_NOT_ATTENDED', 'X', 'PENDING', NULL, 'SE RETIRO', NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '18 applied');
  SELECT etapa_actual, subestado::text, motivo_rechazo INTO v_etapa, v_sub, v_motivo
  FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 5, '19 etapa 5');
  PERFORM public.__p170_assert(v_sub = 'rechazado', '19 rechazado');
  PERFORM public.__p170_assert(v_motivo = 'SE RETIRO', '20 notes');

  -- booking intact
  SELECT status::text INTO v_status FROM public.agenda_bookings WHERE id = v_book;
  PERFORM public.__p170_assert(v_status = 'booked', '38 booking intact bio');

  -- --- FIRMAS ---
  v_exp2 := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, fecha_cita
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '91700000003', 'Cliente Firma',
    '5517000003', 'interno', true, now(), 9, 'en_proceso', 'activo', now() - interval '1 hour'
  );
  v_book_f := gen_random_uuid();
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_book_f, v_org, 'firmas', v_exp2, CURRENT_DATE, '12:00', 'monterrey', 'booked', v_asesor
  );

  -- 21 FIRMO SI from 9 → 11
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 40, CURRENT_DATE, 'firmas', 'monterrey',
    v_book_f, v_exp2,
    'PENDING', NULL, 'PENDING', NULL, 'COMPLETED', 'SI', NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '21 applied');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp2;
  PERFORM public.__p170_assert(v_etapa = 11, '21 etapa 11');

  -- 23 >=11 noop
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 40, CURRENT_DATE, 'firmas', 'monterrey',
    v_book_f, v_exp2,
    'PENDING', NULL, 'PENDING', NULL, 'COMPLETED', 'SI', NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'NO_OP', '23 noop >=11');

  -- 22 from 10 → 11
  UPDATE public.expedientes SET etapa_actual = 10, subestado = 'en_proceso' WHERE id = v_exp2;
  -- new fingerprint via notes
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 41, CURRENT_DATE, 'firmas', 'monterrey',
    v_book_f, v_exp2,
    'PENDING', NULL, 'PENDING', NULL, 'COMPLETED', 'SI', 'from10', NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '22 from 10');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp2;
  PERFORM public.__p170_assert(v_etapa = 11, '22 etapa 11');

  -- 24 <9 skipped
  UPDATE public.expedientes SET etapa_actual = 8, subestado = 'en_proceso' WHERE id = v_exp2;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 42, CURRENT_DATE, 'firmas', 'monterrey',
    v_book_f, v_exp2,
    'PENDING', NULL, 'PENDING', NULL, 'COMPLETED', 'SI', 'pre9', NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'SKIPPED_STAGE', '24 skipped <9');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp2;
  PERFORM public.__p170_assert(v_etapa = 8, '24 stays 8');

  -- 25 never 12
  UPDATE public.expedientes SET etapa_actual = 11, subestado = 'en_proceso' WHERE id = v_exp2;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 43, CURRENT_DATE, 'firmas', 'monterrey',
    v_book_f, v_exp2,
    'PENDING', NULL, 'PENDING', NULL, 'COMPLETED', 'SI', 'stay11', NULL
  );
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp2;
  PERFORM public.__p170_assert(v_etapa = 11, '25 not 12');

  -- 26-28 firma FAIL
  UPDATE public.expedientes SET etapa_actual = 10, subestado = 'en_proceso',
    motivo_rechazo = NULL WHERE id = v_exp2;
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp2;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 44, CURRENT_DATE, 'firmas', 'monterrey',
    v_book_f, v_exp2,
    'PENDING', NULL, 'PENDING', NULL, 'FAILED_OR_NOT_ATTENDED', 'X', 'NO ASISTIO', NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '26 reject firma');
  SELECT etapa_actual, subestado::text, motivo_rechazo INTO v_etapa, v_sub, v_motivo
  FROM public.expedientes WHERE id = v_exp2;
  PERFORM public.__p170_assert(v_etapa = 10, '26 etapa intacta');
  PERFORM public.__p170_assert(v_sub = 'rechazado', '26 rechazado');
  PERFORM public.__p170_assert(v_motivo = 'NO ASISTIO', '27 motivo');
  SELECT status::text INTO v_status FROM public.agenda_bookings WHERE id = v_book_f;
  PERFORM public.__p170_assert(v_status = 'booked', '28 booking intact');

  -- --- LATE EDIT 29-32 ---
  UPDATE public.expedientes SET etapa_actual = 5, subestado = 'en_proceso',
    motivo_rechazo = NULL, comentario_rechazo = NULL, fecha_cita = now() - interval '3 hours'
  WHERE id = v_exp;
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp;
  DELETE FROM public.action_log WHERE entity_id = v_exp AND action LIKE 'agenda_sheet.operational.%';

  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 50, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '29 green apply');
  v_fp := v_res->>'fingerprint';
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 8, '29 →8');

  v_res2 := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 50, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res2->>'outcome' = 'NO_OP', '30 replay A');
  SELECT count(*) INTO v_cnt_rech FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp;
  PERFORM public.__p170_assert(v_cnt_rech = 0, '30 no reject yet');

  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 50, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'FAILED_OR_NOT_ATTENDED', 'X', 'PENDING', NULL, 'NO CUMPLE', NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '31 late X');
  v_fp2 := v_res->>'fingerprint';
  PERFORM public.__p170_assert(v_fp2 IS DISTINCT FROM v_fp, '31 new fingerprint');
  SELECT etapa_actual, subestado::text, motivo_rechazo INTO v_etapa, v_sub, v_motivo
  FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 8, '31 no rollback');
  PERFORM public.__p170_assert(v_sub = 'rechazado', '31 rechazado');
  PERFORM public.__p170_assert(v_motivo = 'NO CUMPLE', '31 motivo');
  SELECT count(*) INTO v_cnt_rech FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp;
  PERFORM public.__p170_assert(v_cnt_rech = 1, '31 one rechazo');

  v_res2 := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 50, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'FAILED_OR_NOT_ATTENDED', 'X', 'PENDING', NULL, 'NO CUMPLE', NULL
  );
  PERFORM public.__p170_assert(v_res2->>'outcome' = 'NO_OP', '32 replay B');
  SELECT count(*) INTO v_cnt_rech FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp;
  PERFORM public.__p170_assert(v_cnt_rech = 1, '32 no second rechazo');

  -- 33 X→verde no auto-reactiva
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 50, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI MTY', 'COMPLETED', 'YA CON BETTY', 'PENDING', NULL, 'recovered', NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'REQUIRES_HUMAN_REACTIVATION', '33 no auto-reactivate');
  SELECT subestado::text INTO v_sub FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_sub = 'rechazado', '33 sigue rechazado');

  -- --- SEGURIDAD 42-45 ---
  PERFORM public.__p170_assert(
    has_function_privilege('anon', 'public.agenda_sheet_apply_operational_result(uuid,text,bigint,integer,date,text,text,uuid,uuid,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean)', 'EXECUTE') = false,
    '42 anon no execute'
  );
  PERFORM public.__p170_assert(
    has_function_privilege('authenticated', 'public.agenda_sheet_apply_operational_result(uuid,text,bigint,integer,date,text,text,uuid,uuid,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean)', 'EXECUTE') = false,
    '43 authenticated no execute'
  );
  PERFORM public.__p170_assert(
    has_function_privilege('service_role', 'public.agenda_sheet_apply_operational_result(uuid,text,bigint,integer,date,text,text,uuid,uuid,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean)', 'EXECUTE')
    OR has_function_privilege('postgres', 'public.agenda_sheet_apply_operational_result(uuid,text,bigint,integer,date,text,text,uuid,uuid,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean)', 'EXECUTE'),
    '44 service/postgres execute'
  );

  -- assertion fails under authenticated role
  PERFORM public.__p170_set_auth(v_mesa);
  BEGIN
    PERFORM public.agenda_sheet_assert_service_role();
    PERFORM public.__p170_assert(false, '45 assert should fail');
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    PERFORM public.__p170_assert(position('service_role' IN SQLERRM) > 0, '45 assert service_role');
  END;
  PERFORM public.__p170_reset_auth();

  -- --- REGRESIÓN rechazo humano P096 ---
  UPDATE public.expedientes SET etapa_actual = 5, subestado = 'en_proceso',
    motivo_rechazo = NULL, comentario_rechazo = NULL WHERE id = v_exp;
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp;
  PERFORM public.__p170_set_auth(v_mesa);
  v_res := public.rechazar_etapa_operativa(
    v_exp, 'Motivo humano', NULL, 'desconocida'::public.biometricos_condicion, NULL, NULL
  );
  PERFORM public.__p170_assert(COALESCE((v_res->>'ok')::boolean, false), format('40 human reject ok: %s', v_res::text));
  PERFORM public.__p170_reset_auth();
  SELECT count(*) INTO v_cnt FROM public.expediente_rechazos_operativos
  WHERE expediente_id = v_exp AND decision_source = 'human' AND decidido_por = v_mesa;
  PERFORM public.__p170_assert(v_cnt = 1, '40 decidido_por mesa human');

  -- Reactivación P108A
  PERFORM public.__p170_set_auth(v_asesor);
  BEGIN
    v_res := public.reactivar_expediente_rechazado(v_exp);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p170_set_auth(v_mesa);
    v_res := public.reactivar_expediente_rechazado(v_exp);
  END;
  PERFORM public.__p170_assert(COALESCE((v_res->>'ok')::boolean, false), format('41 reactivate: %s', v_res::text));
  PERFORM public.__p170_reset_auth();
  SELECT subestado::text INTO v_sub FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_sub <> 'rechazado', '41 no longer rechazado');

  -- 3→5 path from etapa 3
  UPDATE public.expedientes SET etapa_actual = 3, subestado = 'en_proceso',
    fecha_cita = now() - interval '1 hour', motivo_rechazo = NULL WHERE id = v_exp;
  DELETE FROM public.expediente_rechazo_reactivaciones WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = v_exp;
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 60, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI APODACA', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'APPLIED', '6b from 3 applied');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p170_assert(v_etapa = 5, '6b etapa 5 from 3');

  -- fingerprint determinism
  v_fp := public.agenda_sheet_ops_fingerprint(
    v_ssid, v_sid, 99, v_exp, v_book, 'biometricos',
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, 'ABC'
  );
  v_fp2 := public.agenda_sheet_ops_fingerprint(
    v_ssid, v_sid, 99, v_exp, v_book, 'biometricos',
    'COMPLETED', 'CESI MTY', 'PENDING', NULL, 'PENDING', NULL, 'ABC'
  );
  PERFORM public.__p170_assert(v_fp = v_fp2, '34 fingerprint stable');

  -- 35 concurrencia determinista: FOR UPDATE en booking+expediente+ops;
  -- replay inmediato del mismo fingerprint bajo la misma sesión = una sola mutación
  SELECT count(*) INTO v_cnt_log FROM public.action_log
  WHERE entity_id = v_exp AND action LIKE 'agenda_sheet.operational.%'
    AND payload->>'fingerprint' = (
      SELECT last_applied_fingerprint FROM public.agenda_sheet_operational_results
      WHERE spreadsheet_id = v_ssid AND sheet_id = v_sid AND sheet_row = 60
    );
  PERFORM public.__p170_assert(v_cnt_log >= 1, '35 at least one logged mutation');
  v_res := public.agenda_sheet_apply_operational_result(
    v_org, v_ssid, v_sid, 60, CURRENT_DATE, 'biometricos', 'monterrey',
    v_book, v_exp,
    'COMPLETED', 'CESI APODACA', 'PENDING', NULL, 'PENDING', NULL, NULL, NULL
  );
  PERFORM public.__p170_assert(v_res->>'outcome' = 'NO_OP', '35 locked replay noop');
  SELECT count(*) INTO v_cnt FROM public.action_log
  WHERE entity_id = v_exp AND action LIKE 'agenda_sheet.operational.%'
    AND payload->>'fingerprint' = (
      SELECT last_applied_fingerprint FROM public.agenda_sheet_operational_results
      WHERE spreadsheet_id = v_ssid AND sheet_id = v_sid AND sheet_row = 60
    );
  PERFORM public.__p170_assert(v_cnt = v_cnt_log, '35 no duplicate log on replay');

  ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;
  RAISE NOTICE 'P170 SQL tests PASSED';
EXCEPTION WHEN OTHERS THEN
  BEGIN
    ALTER TABLE public.agenda_bookings ENABLE TRIGGER USER;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RAISE;
END;
$$;

DROP FUNCTION IF EXISTS public.__p170_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p170_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p170_reset_auth();
