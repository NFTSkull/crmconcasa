-- P180: effective_result + projection_status + KPI CURRENT/COMPLETED_CURRENT
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p180_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P180 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p180_as_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'postgres', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p180_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_admin UUID := '00000000-0000-4000-8006-000000000001';
  v_ss TEXT := 'p180-test-ss';
  v_sheet BIGINT := 18013;
  v_sum JSONB;
  v_det JSONB;
  v_stale JSONB;
  v_status TEXT;
  v_eff TEXT;
BEGIN
  PERFORM public.__p180_as_service();

  PERFORM public.__p180_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='agenda_sheet_operational_results'
        AND column_name='biometric_effective_result'
    ),
    'col biometric_effective_result'
  );

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p180-eff-org', 'P180 Eff Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  DELETE FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet;

  -- legacy COMPLETED sin effective → NO cuenta en KPI
  PERFORM public.agenda_sheet_ops_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '13 AGOSTO',
      'booking_date', '2026-08-13',
      'sheet_row', 17,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '11:00',
      'biometric_result_class', 'COMPLETED',
      'biometric_result_raw', 'CESI MTY',
      'notification_result_class', 'FAILED_OR_NOT_ATTENDED',
      'notification_result_raw', 'X',
      'signature_result_class', 'PENDING',
      'biometric_color', 'RED',
      'notification_color', 'RED',
      'signature_color', 'UNKNOWN',
      'biometric_effective_result', 'MANUAL_REVIEW',
      'notification_effective_result', 'FAILED',
      'signature_effective_result', 'PENDING',
      'projection_status', 'CURRENT'
    ),
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '13 AGOSTO',
      'booking_date', '2026-08-13',
      'sheet_row', 24,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:30',
      'biometric_result_class', 'COMPLETED',
      'biometric_result_raw', 'CESI MTY',
      'notification_result_class', 'COMPLETED',
      'notification_result_raw', 'YA CON BETTY',
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
      'sheet_title', '13 AGOSTO',
      'booking_date', '2026-08-13',
      'sheet_row', 47,
      'kind', 'biometricos',
      'location_id', 'apodaca',
      'slot_time', '08:30',
      'biometric_result_class', 'COMPLETED',
      'biometric_result_raw', 'CESI APODACA',
      'notification_result_class', 'PENDING',
      'signature_result_class', 'PENDING',
      'biometric_color', 'GREEN',
      'notification_color', 'UNKNOWN',
      'signature_color', 'UNKNOWN',
      'biometric_effective_result', 'COMPLETED_CURRENT',
      'notification_effective_result', 'PENDING',
      'signature_effective_result', 'PENDING',
      'projection_status', 'CURRENT'
    ),
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '13 AGOSTO',
      'booking_date', '2026-08-13',
      'sheet_row', 7,
      'kind', 'firmas',
      'location_id', 'monterrey',
      'slot_time', '08:30',
      'biometric_result_class', 'PENDING',
      'notification_result_class', 'PENDING',
      'signature_result_class', 'PENDING',
      'signature_result_raw', 'YA CON BETTY',
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
      'sheet_title', '13 AGOSTO',
      'booking_date', '2026-08-13',
      'sheet_row', 33,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:00',
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
      'projection_status', 'CURRENT'
    )
  ));

  v_stale := public.agenda_sheet_ops_mark_stale_except(
    v_ss, v_sheet, ARRAY[7,17,24], 1, 50, false
  );
  PERFORM public.__p180_assert(COALESCE((v_stale->>'skipped')::boolean, false) = false, 'stale not skipped');
  PERFORM public.__p180_assert((v_stale->>'stale_marked')::int >= 2, 'stale marked');

  v_stale := public.agenda_sheet_ops_mark_stale_except(
    v_ss, v_sheet, ARRAY[]::INTEGER[], 1, 50, false
  );
  PERFORM public.__p180_assert((v_stale->>'skipped')::boolean = true, 'empty snapshot skipped');

  SELECT projection_status INTO v_status
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id=v_ss AND sheet_id=v_sheet AND sheet_row=33;
  PERFORM public.__p180_assert(v_status = 'STALE', 'row33 STALE');

  SELECT projection_status INTO v_status
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id=v_ss AND sheet_id=v_sheet AND sheet_row=47;
  PERFORM public.__p180_assert(v_status = 'STALE', 'row47 STALE');

  -- reject bad effective string
  PERFORM public.agenda_sheet_ops_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', v_org,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet,
      'sheet_title', '13 AGOSTO',
      'booking_date', '2026-08-13',
      'sheet_row', 99,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'biometric_result_class', 'COMPLETED',
      'notification_result_class', 'PENDING',
      'signature_result_class', 'PENDING',
      'biometric_effective_result', 'HACKED'
    )
  ));
  PERFORM public.__p180_assert(
    NOT EXISTS (
      SELECT 1 FROM public.agenda_sheet_operational_results
      WHERE spreadsheet_id=v_ss AND sheet_id=v_sheet AND sheet_row=99
    ),
    'allowlist rejects HACKED effective'
  );

  PERFORM public.__p180_auth(v_admin);
  v_sum := public.bernardo_ops_summary(DATE '2026-08-13', DATE '2026-08-13');
  -- bio: only row24 CURRENT+COMPLETED_CURRENT (17 MANUAL, 33/47 STALE)
  PERFORM public.__p180_assert((v_sum->>'biometricos')::int = 1, 'KPI bio=1');
  PERFORM public.__p180_assert((v_sum->>'firmas')::int = 1, 'KPI firmas=1');
  PERFORM public.__p180_assert((v_sum->>'notificaciones')::int = 1, 'KPI notif=1');

  v_det := public.bernardo_ops_detail('firmas', DATE '2026-08-13', DATE '2026-08-13');
  PERFORM public.__p180_assert((v_det->>'total')::int = 1, 'detail firmas=1');
  PERFORM public.__p180_assert(
    v_det->'items'->0->>'result_class' = 'COMPLETED_CURRENT',
    'detail result_class=effective'
  );

  -- legacy class COMPLETED on RED row no gobierna KPI
  PERFORM public.__p180_as_service();
  SELECT biometric_result_class, biometric_effective_result INTO v_status, v_eff
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id=v_ss AND sheet_id=v_sheet AND sheet_row=17;
  PERFORM public.__p180_assert(v_status = 'COMPLETED', 'legacy class still COMPLETED');
  PERFORM public.__p180_assert(v_eff = 'MANUAL_REVIEW', 'effective MANUAL_REVIEW');

  DELETE FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet;

  RAISE NOTICE 'P180 PASS';
END;
$$;
