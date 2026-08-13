-- P165: proyección operativa Bernardo (CITAS 2026)
-- Casos: tabla/unique/upsert idempotente, SuperAdmin gate, P180 COMPLETED_CURRENT,
-- periodo por booking_date (no updated_at), sin mutar expedientes/bookings.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p165_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P165 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p165_as_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'postgres', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p165_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p165_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'postgres', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_admin UUID := '00000000-0000-4000-8006-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_ss TEXT := 'p165-test-ss';
  v_sheet BIGINT := 16511;
  v_sum JSONB;
  v_det JSONB;
  v_cnt BIGINT;
  v_upsert JSONB;
  v_exp_before BIGINT;
  v_book_before BIGINT;
  v_exp_after BIGINT;
  v_book_after BIGINT;
  v_err TEXT;
  v_pub BOOLEAN;
BEGIN
  PERFORM public.__p165_as_service();

  -- A. tabla
  PERFORM public.__p165_assert(
    to_regclass('public.agenda_sheet_operational_results') IS NOT NULL,
    'tabla agenda_sheet_operational_results existe'
  );
  PERFORM public.__p165_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'bernardo_ops_summary'
    ),
    'RPC bernardo_ops_summary'
  );
  PERFORM public.__p165_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'bernardo_ops_detail'
    ),
    'RPC bernardo_ops_detail'
  );

  -- K. Realtime publication (idempotente)
  SELECT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agenda_sheet_operational_results'
  ) INTO v_pub;
  -- Si la publicación no existe en el entorno aislado, no fallar; documentar.
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    PERFORM public.__p165_assert(v_pub, 'tabla en supabase_realtime');
  END IF;

  SELECT COUNT(*) INTO v_exp_before FROM public.expedientes;
  SELECT COUNT(*) INTO v_book_before FROM public.agenda_bookings;

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p165-bernardo-ops-org', 'P165 Bernardo Ops Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_admin, 'authenticated', 'authenticated', 'p165-admin@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor, 'authenticated', 'authenticated', 'p165-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p165-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES
    (v_admin, v_org, 'p165-admin@test.local', 'P165 Admin', 'super_admin', true),
    (v_asesor, v_org, 'p165-asesor@test.local', 'P165 Asesor', 'asesor', true),
    (v_mesa, v_org, 'p165-mesa@test.local', 'P165 Mesa', 'mesa_admin', true)
  ON CONFLICT (id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        app_role = EXCLUDED.app_role,
        active = true;

  DELETE FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet;

  -- C/D. upsert idempotente + reemplazo de estado (no acumula)
  v_upsert := public.agenda_sheet_ops_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '11 AGOSTO',
      'booking_date', '2026-08-11',
      'sheet_row', 25,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:30',
      'biometric_result_class', 'COMPLETED',
      'biometric_result_raw', 'CESI MTY',
      'notification_result_class', 'COMPLETED',
      'notification_result_raw', 'BETTY 8',
      'signature_result_class', 'PENDING',
      'biometric_color', 'GREEN',
      'notification_color', 'GREEN',
      'signature_color', 'UNKNOWN',
      'biometric_effective_result', 'COMPLETED_CURRENT',
      'notification_effective_result', 'COMPLETED_CURRENT',
      'signature_effective_result', 'PENDING',
      'projection_status', 'CURRENT'
    ),
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '11 AGOSTO',
      'booking_date', '2026-08-11',
      'sheet_row', 26,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:30',
      'biometric_result_class', 'FAILED_OR_NOT_ATTENDED',
      'biometric_result_raw', 'X',
      'notification_result_class', 'FAILED_OR_NOT_ATTENDED',
      'notification_result_raw', 'X',
      'signature_result_class', 'PENDING',
      'biometric_color', 'RED',
      'notification_color', 'RED',
      'signature_color', 'UNKNOWN',
      'biometric_effective_result', 'FAILED',
      'notification_effective_result', 'FAILED',
      'signature_effective_result', 'PENDING',
      'projection_status', 'CURRENT'
    ),
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '11 AGOSTO',
      'booking_date', '2026-08-11',
      'sheet_row', 11,
      'kind', 'firmas',
      'location_id', 'monterrey',
      'slot_time', '09:00',
      'biometric_result_class', 'PENDING',
      'notification_result_class', 'PENDING',
      'signature_result_class', 'COMPLETED',
      'signature_result_raw', 'SI',
      'biometric_color', 'UNKNOWN',
      'notification_color', 'UNKNOWN',
      'signature_color', 'GREEN',
      'biometric_effective_result', 'PENDING',
      'notification_effective_result', 'PENDING',
      'signature_effective_result', 'COMPLETED_CURRENT',
      'projection_status', 'CURRENT'
    ),
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '11 AGOSTO',
      'booking_date', '2026-08-11',
      'sheet_row', 19,
      'kind', 'firmas',
      'location_id', 'monterrey',
      'slot_time', '10:00',
      'biometric_result_class', 'PENDING',
      'notification_result_class', 'PENDING',
      'signature_result_class', 'FAILED_OR_NOT_ATTENDED',
      'signature_result_raw', 'FALTA ACUSE',
      'biometric_color', 'UNKNOWN',
      'notification_color', 'UNKNOWN',
      'signature_color', 'RED',
      'biometric_effective_result', 'PENDING',
      'notification_effective_result', 'PENDING',
      'signature_effective_result', 'FAILED',
      'projection_status', 'CURRENT'
    ),
    -- fila con booking_date 12-ago para probar filtro de periodo
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '12 AGOSTO',
      'booking_date', '2026-08-12',
      'sheet_row', 30,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '10:00',
      'biometric_result_class', 'COMPLETED',
      'biometric_result_raw', 'YA EN CESI',
      'notification_result_class', 'PENDING',
      'signature_result_class', 'PENDING',
      'biometric_color', 'GREEN',
      'notification_color', 'UNKNOWN',
      'signature_color', 'UNKNOWN',
      'biometric_effective_result', 'COMPLETED_CURRENT',
      'notification_effective_result', 'PENDING',
      'signature_effective_result', 'PENDING',
      'projection_status', 'CURRENT',
      'last_seen_at', '2026-08-11T23:00:00Z'
    )
  ));
  PERFORM public.__p165_assert((v_upsert->>'upserted')::int = 5, 'primer upsert 5 filas');

  SELECT COUNT(*) INTO v_cnt
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet;
  PERFORM public.__p165_assert(v_cnt = 5, 'B. 5 filas tras upsert (sin duplicar)');

  -- Idempotencia: mismo batch otra vez
  v_upsert := public.agenda_sheet_ops_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '11 AGOSTO',
      'booking_date', '2026-08-11',
      'sheet_row', 25,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:30',
      'biometric_result_class', 'COMPLETED',
      'biometric_result_raw', 'CESI MTY',
      'notification_result_class', 'COMPLETED',
      'notification_result_raw', 'BETTY 8',
      'signature_result_class', 'PENDING',
      'biometric_color', 'GREEN',
      'notification_color', 'GREEN',
      'signature_color', 'UNKNOWN',
      'biometric_effective_result', 'COMPLETED_CURRENT',
      'notification_effective_result', 'COMPLETED_CURRENT',
      'signature_effective_result', 'PENDING',
      'projection_status', 'CURRENT'
    )
  ));
  SELECT COUNT(*) INTO v_cnt
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet AND sheet_row = 25;
  PERFORM public.__p165_assert(v_cnt = 1, 'C. upsert idempotente (1 fila row 25)');

  -- D. corrección X → COMPLETED reemplaza, no suma
  PERFORM public.agenda_sheet_ops_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '11 AGOSTO',
      'booking_date', '2026-08-11',
      'sheet_row', 26,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:30',
      'biometric_result_class', 'COMPLETED',
      'biometric_result_raw', 'CESI MTY',
      'notification_result_class', 'PENDING',
      'signature_result_class', 'PENDING',
      'biometric_color', 'GREEN',
      'notification_color', 'UNKNOWN',
      'signature_color', 'UNKNOWN',
      'biometric_effective_result', 'COMPLETED_CURRENT',
      'notification_effective_result', 'PENDING',
      'signature_effective_result', 'PENDING',
      'projection_status', 'CURRENT'
    )
  ));
  SELECT biometric_result_class INTO v_err
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet AND sheet_row = 26;
  PERFORM public.__p165_assert(v_err = 'COMPLETED', 'D. fila 26 reemplazada a COMPLETED');

  -- E/F/G. SuperAdmin vs asesor/mesa
  PERFORM public.__p165_auth(v_admin);
  v_sum := public.bernardo_ops_summary(DATE '2026-08-11', DATE '2026-08-11');
  PERFORM public.__p165_assert((v_sum->>'biometricos')::int = 2, 'H. bio COMPLETED=2 el 11');
  PERFORM public.__p165_assert((v_sum->>'firmas')::int = 1, 'H. firmas COMPLETED=1 el 11');
  PERFORM public.__p165_assert((v_sum->>'notificaciones')::int = 1, 'H. notif COMPLETED=1 el 11');

  v_det := public.bernardo_ops_detail('biometricos', DATE '2026-08-11', DATE '2026-08-11');
  PERFORM public.__p165_assert(
    (v_det->>'total')::int = (v_sum->>'biometricos')::int
    AND jsonb_array_length(v_det->'items') = (v_sum->>'biometricos')::int,
    'KPI == detail biométricos'
  );

  -- I. periodo por booking_date (fila 12-ago con last_seen 11-ago NO cuenta el 11)
  PERFORM public.__p165_assert(
    (v_sum->>'biometricos')::int = 2,
    'I. booking_date manda (12-ago no entra en 11)'
  );
  v_sum := public.bernardo_ops_summary(DATE '2026-08-12', DATE '2026-08-12');
  PERFORM public.__p165_assert((v_sum->>'biometricos')::int = 1, 'I. 12-ago cuenta 1 bio');

  -- G. asesor denegado
  PERFORM public.__p165_auth(v_asesor);
  BEGIN
    PERFORM public.bernardo_ops_summary(DATE '2026-08-11', DATE '2026-08-11');
    PERFORM public.__p165_assert(false, 'asesor no debe ejecutar summary');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    NULL;
  END;

  PERFORM public.__p165_auth(v_mesa);
  BEGIN
    PERFORM public.bernardo_ops_detail('firmas', DATE '2026-08-11', DATE '2026-08-11');
    PERFORM public.__p165_assert(false, 'mesa no debe ejecutar detail');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    NULL;
  END;

  PERFORM public.__p165_reset();
  PERFORM public.__p165_as_service();

  SELECT COUNT(*) INTO v_exp_after FROM public.expedientes;
  SELECT COUNT(*) INTO v_book_after FROM public.agenda_bookings;
  PERFORM public.__p165_assert(v_exp_after = v_exp_before, 'L. no mutó expedientes');
  PERFORM public.__p165_assert(v_book_after = v_book_before, 'L. no mutó agenda_bookings');

  DELETE FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet;

  RAISE NOTICE 'P165 PASS';
END;
$$;
