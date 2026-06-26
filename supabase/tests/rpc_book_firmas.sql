-- ConCasa CRM — pruebas P2C-18 RPC book_firmas + agenda_config firmas
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_book_firmas.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC FIRMAS TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_slot_ts(
  p_iso_dow INTEGER, p_slot TEXT, p_min_days INTEGER DEFAULT 3, p_tz TEXT DEFAULT 'America/Monterrey'
)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE AS $$
DECLARE v_date DATE; v_parts TEXT[]; v_hour INTEGER; v_minute INTEGER;
BEGIN
  v_date := ((NOW() AT TIME ZONE p_tz)::DATE + p_min_days);
  WHILE EXTRACT(ISODOW FROM v_date)::INTEGER <> p_iso_dow LOOP v_date := v_date + 1; END LOOP;
  v_parts := regexp_split_to_array(p_slot, ':');
  v_hour := v_parts[1]::INTEGER; v_minute := v_parts[2]::INTEGER;
  RETURN (v_date + make_time(v_hour, v_minute, 0)) AT TIME ZONE p_tz;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_standard_config()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'enabled', true, 'timezone', 'America/Monterrey', 'min_lead_hours', 24,
    'allowed_weekdays', jsonb_build_array(1, 2, 3, 4, 5),
    'locations', jsonb_build_object(
      'mty-centro', jsonb_build_object('enabled', true, 'capacity_per_slot', 3)
    ),
    'slots', jsonb_build_array('09:00', '10:00', '11:00', '12:00', '16:00')
  );
$$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_upsert_config(p_org_id UUID, p_config JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (p_org_id, 'firmas', p_config)
  ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_delete_config(p_org_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.agenda_config WHERE organization_id = p_org_id AND kind = 'firmas';
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11),
  p_etapa SMALLINT DEFAULT 9, p_submitted BOOLEAN DEFAULT true,
  p_subestado public.operativo_subestado DEFAULT 'en_proceso',
  p_deleted TIMESTAMPTZ DEFAULT NULL, p_ciclo public.expediente_ciclo_estado DEFAULT 'activo',
  p_origen public.origen_mesa DEFAULT 'interno'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, deleted_at, ciclo_estado, fecha_cita
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture Firmas',
    '5555555555', p_origen, p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, p_subestado, p_deleted, p_ciclo, NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id, asesor_id = EXCLUDED.asesor_id,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa, etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado, deleted_at = EXCLUDED.deleted_at,
    ciclo_estado = EXCLUDED.ciclo_estado, fecha_cita = NULL, updated_at = NOW();
  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_call(
  p_user UUID, p_exp UUID, p_at TIMESTAMPTZ, p_loc TEXT DEFAULT 'mty-centro', p_note TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_firmas_test_set_auth(p_user);
  SELECT public.book_firmas(p_exp, p_at, p_loc, p_note) INTO v_result;
  PERFORM public.__rpc_firmas_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_expect_fail(
  p_user UUID, p_exp UUID, p_at TIMESTAMPTZ, p_loc TEXT DEFAULT 'mty-centro', p_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__rpc_firmas_test_set_auth(p_user);
  BEGIN
    PERFORM public.book_firmas(p_exp, p_at, p_loc);
    PERFORM public.__rpc_firmas_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_firmas_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC FIRMAS TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_expect_assert_fail(
  p_org UUID, p_at TIMESTAMPTZ, p_loc TEXT, p_contains TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  BEGIN
    PERFORM public.agenda_firmas_assert_slot_available(p_org, p_at, p_loc);
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC FIRMAS TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_test_insert_booking(
  p_exp UUID, p_org UUID, p_asesor UUID, p_date DATE, p_time TIME, p_loc TEXT,
  p_kind public.booking_kind DEFAULT 'firmas', p_status public.booking_status DEFAULT 'booked'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (p_org, p_kind, p_exp, p_date, p_time, p_loc, p_status, p_asesor);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_org_no_cfg UUID := '00000000-0000-4000-8020-000000000002';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';

  v_exp_ok UUID := '00000000-0000-4000-9020-000000000010';
  v_exp_mesa UUID := '00000000-0000-4000-9020-000000000011';
  v_exp_super UUID := '00000000-0000-4000-9020-000000000012';
  v_exp_owner UUID := '00000000-0000-4000-9020-000000000013';
  v_exp_roles UUID := '00000000-0000-4000-9020-000000000014';
  v_exp_etapa UUID := '00000000-0000-4000-9020-000000000015';
  v_exp_not_sent UUID := '00000000-0000-4000-9020-000000000016';
  v_exp_deleted UUID := '00000000-0000-4000-9020-000000000017';
  v_exp_ciclo UUID := '00000000-0000-4000-9020-000000000018';
  v_exp_bad_sub UUID := '00000000-0000-4000-9020-000000000019';
  v_exp_dup UUID := '00000000-0000-4000-9020-000000000020';
  v_exp_side UUID := '00000000-0000-4000-9020-000000000021';
  v_exp_bio UUID := '00000000-0000-4000-9020-000000000022';
  v_exp_cap1 UUID := '00000000-0000-4000-9020-000000000023';
  v_exp_cap2 UUID := '00000000-0000-4000-9020-000000000024';
  v_exp_cap3 UUID := '00000000-0000-4000-9020-000000000025';
  v_exp_cap4 UUID := '00000000-0000-4000-9020-000000000026';
  v_exp_cfg UUID := '00000000-0000-4000-9020-000000000027';
  v_exp_etapa10 UUID := '00000000-0000-4000-9020-000000000028';
  v_exp_etapa10_nocancel UUID := '00000000-0000-4000-9020-000000000029';
  v_exp_etapa10_booked UUID := '00000000-0000-4000-9020-000000000030';

  v_slot_mon TIMESTAMPTZ;
  v_slot_sun TIMESTAMPTZ;
  v_slot_bad TIMESTAMPTZ;
  v_slot_lead TIMESTAMPTZ;
  v_slot_bio_regression TIMESTAMPTZ;
  v_norm JSONB;
  v_result JSONB;
  v_etapa_before SMALLINT;
  v_fecha_before TIMESTAMPTZ;
  v_bio_before BIGINT;
  v_bio_after BIGINT;
  v_doc_count BIGINT;
  v_ret_count BIGINT;
  v_cliente_count BIGINT;
  v_editor_count BIGINT;
  v_roles_revisor INTEGER;
  v_cfg_row JSONB;
  v_date DATE;
  v_time TIME;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org_no_cfg, 'fixture-firmas-no-cfg', 'Fixture Firmas Sin Config', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  PERFORM public.__rpc_firmas_test_upsert_config(v_org, public.__rpc_firmas_test_standard_config());

  v_slot_mon := public.__rpc_firmas_test_slot_ts(1, '10:00', 3);
  v_slot_sun := public.__rpc_firmas_test_slot_ts(7, '10:00', 3);
  v_slot_bad := public.__rpc_firmas_test_slot_ts(1, '08:30', 3);
  v_slot_lead := (NOW() AT TIME ZONE 'America/Monterrey' + INTERVAL '2 hours') AT TIME ZONE 'America/Monterrey';

  -- Fixtures expediente etapa 9
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_ok, v_org, v_a1, '92001000010');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_mesa, v_org, v_a1, '92001100011');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_super, v_org, v_a1, '92001200012');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_owner, v_org, v_a2, '92001300013');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_roles, v_org, v_a1, '92001400014');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_etapa, v_org, v_a1, '92001500015', 8::smallint);
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_not_sent, v_org, v_a1, '92001600016', 9::smallint, false);
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_deleted, v_org, v_a1, '92001700017');
  UPDATE public.expedientes SET deleted_at = NOW() WHERE id = v_exp_deleted;
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_ciclo, v_org, v_a1, '92001800018');
  UPDATE public.expedientes SET ciclo_estado = 'cerrado' WHERE id = v_exp_ciclo;
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_bad_sub, v_org, v_a1, '92001900019');
  UPDATE public.expedientes SET subestado = 'pendiente' WHERE id = v_exp_bad_sub;
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_dup, v_org, v_a1, '92002000020');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_side, v_org, v_a1, '92002100021');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_bio, v_org, v_a1, '92002200022', 4::smallint);
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_cap1, v_org, v_a1, '92002300023');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_cap2, v_org, v_a1, '92002400024');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_cap3, v_org, v_a1, '92002500025');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_cap4, v_org, v_a1, '92002600026');
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_cfg, v_org_no_cfg, v_a1, '92002700027');

  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp_side, v_org, '{"rfc":"XAXX010101000"}'::jsonb, 'validado')
  ON CONFLICT (expediente_id) DO NOTHING;
  INSERT INTO public.retencion_envios (expediente_id, organization_id, enviado, opcion, estado)
  VALUES (v_exp_side, v_org, true, 'con_sello', 'enviado')
  ON CONFLICT (expediente_id) DO NOTHING;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado, decided_by)
  VALUES (v_exp_side, v_org, 'aprobado', 100000, v_editor)
  ON CONFLICT (expediente_id) DO NOTHING;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp_side, 'ine', 'dev/firmas-side/ine.pdf', 'ine.pdf',
    'application/pdf', 100, 'validado', v_a1, 'asesor'
  );

  -- 1. sin agenda_config firmas
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_assert_fail(v_org_no_cfg, v_slot_mon, 'mty-centro', 'configuración firmas no encontrada'),
    'test 1'
  );

  -- 2. normaliza defaults
  v_norm := public.agenda_firmas_normalize_config('{}'::jsonb);
  PERFORM public.__rpc_firmas_test_assert(
    (v_norm->>'min_lead_hours')::int = 24
      AND v_norm->'locations' ? 'mty-centro'
      AND jsonb_array_length(v_norm->'slots') = 5,
    'test 2: normalize defaults'
  );

  -- 3–5. config inválida
  PERFORM public.__rpc_firmas_test_upsert_config(
    v_org, public.__rpc_firmas_test_standard_config() || jsonb_build_object('locations', '{}'::jsonb)
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_assert_fail(v_org, v_slot_mon, 'mty-centro', 'sedes firmas no configuradas'),
    'test 3'
  );

  PERFORM public.__rpc_firmas_test_upsert_config(
    v_org, public.__rpc_firmas_test_standard_config() || jsonb_build_object('slots', '[]'::jsonb)
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_assert_fail(v_org, v_slot_mon, 'mty-centro', 'horarios firmas no configurados'),
    'test 4'
  );

  PERFORM public.__rpc_firmas_test_upsert_config(
    v_org, public.__rpc_firmas_test_standard_config() || jsonb_build_object('allowed_weekdays', '[]'::jsonb)
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_assert_fail(v_org, v_slot_mon, 'mty-centro', 'días firmas no configurados'),
    'test 5'
  );

  PERFORM public.__rpc_firmas_test_upsert_config(v_org, public.__rpc_firmas_test_standard_config());

  -- 6–9. sede/hora/día/anticipación
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_assert_fail(v_org, v_slot_mon, 'sede-inexistente', 'sede firmas no permitida'),
    'test 6'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_assert_fail(v_org, v_slot_bad, 'mty-centro', 'horario firmas no permitido'),
    'test 7'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_assert_fail(v_org, v_slot_sun, 'mty-centro', 'día firmas no permitido'),
    'test 8'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_assert_fail(v_org, v_slot_lead, 'mty-centro', 'anticipación mínima'),
    'test 9'
  );

  -- 10–11. cupo
  v_date := (v_slot_mon AT TIME ZONE 'America/Monterrey')::date;
  v_time := (v_slot_mon AT TIME ZONE 'America/Monterrey')::time;
  PERFORM public.__rpc_firmas_test_insert_booking(v_exp_cap1, v_org, v_a1, v_date, v_time, 'mty-centro');
  PERFORM public.__rpc_firmas_test_insert_booking(v_exp_cap2, v_org, v_a1, v_date, v_time, 'mty-centro');
  PERFORM public.__rpc_firmas_test_insert_booking(v_exp_cap3, v_org, v_a1, v_date, v_time, 'mty-centro');
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_a1, v_exp_cap4, v_slot_mon, 'mty-centro', 'cupo firmas agotado'),
    'test 10'
  );
  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp_cap1, v_exp_cap2, v_exp_cap3);
  v_result := public.agenda_firmas_assert_slot_available(v_org, v_slot_mon, 'mty-centro');
  PERFORM public.__rpc_firmas_test_assert((v_result->>'agenda_config_applied')::boolean = true, 'test 11: cupo disponible');

  -- 12–18. happy path
  v_result := public.__rpc_firmas_test_call(v_a1, v_exp_ok, v_slot_mon);
  SELECT etapa_actual, fecha_cita INTO v_etapa_before, v_fecha_before FROM public.expedientes WHERE id = v_exp_ok;
  PERFORM public.__rpc_firmas_test_assert(
    (v_result->>'ok')::boolean = true AND v_result->>'kind' = 'firmas'
      AND v_etapa_before = 9 AND v_fecha_before IS NOT NULL,
    'test 12-17: asesor dueño'
  );
  PERFORM public.__rpc_firmas_test_assert(
    EXISTS (SELECT 1 FROM public.agenda_bookings b WHERE b.expediente_id = v_exp_ok AND b.kind = 'firmas' AND b.status = 'booked'),
    'test 15'
  );
  PERFORM public.__rpc_firmas_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = (v_result->>'booking_id')::uuid
        AND al.action = 'agenda.firmas.book'
        AND (al.payload->>'no_etapa_change')::boolean = true
    ),
    'test 18'
  );

  v_result := public.__rpc_firmas_test_call(v_mesa, v_exp_mesa, public.__rpc_firmas_test_slot_ts(1, '11:00', 3));
  PERFORM public.__rpc_firmas_test_assert((v_result->>'ok')::boolean = true, 'test 13: mesa_admin');

  v_result := public.__rpc_firmas_test_call(v_super, v_exp_super, public.__rpc_firmas_test_slot_ts(1, '12:00', 3));
  PERFORM public.__rpc_firmas_test_assert((v_result->>'ok')::boolean = true, 'test 14: super_admin');

  -- 19–23. roles bloqueados
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_a1, v_exp_owner, public.__rpc_firmas_test_slot_ts(1, '16:00', 3)),
    'test 19'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_mesa_int, v_exp_roles, public.__rpc_firmas_test_slot_ts(2, '10:00', 3)),
    'test 20'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_mesa_ext, v_exp_roles, public.__rpc_firmas_test_slot_ts(2, '10:00', 3)),
    'test 21'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_editor, v_exp_roles, public.__rpc_firmas_test_slot_ts(2, '10:00', 3)),
    'test 22'
  );
  SELECT COUNT(*) INTO v_roles_revisor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__rpc_firmas_test_assert(v_roles_revisor = 0, 'test 23');

  -- 24–29. gates expediente
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_mesa, v_exp_etapa, public.__rpc_firmas_test_slot_ts(2, '11:00', 3)),
    'test 24'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_mesa, v_exp_not_sent, public.__rpc_firmas_test_slot_ts(2, '11:00', 3)),
    'test 25'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_mesa, v_exp_deleted, public.__rpc_firmas_test_slot_ts(2, '11:00', 3)),
    'test 26'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_mesa, v_exp_ciclo, public.__rpc_firmas_test_slot_ts(2, '11:00', 3)),
    'test 27'
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_mesa, v_exp_bad_sub, public.__rpc_firmas_test_slot_ts(2, '11:00', 3)),
    'test 28'
  );
  PERFORM public.__rpc_firmas_test_call(v_a1, v_exp_dup, public.__rpc_firmas_test_slot_ts(3, '10:00', 3));
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(v_a1, v_exp_dup, public.__rpc_firmas_test_slot_ts(3, '11:00', 3), 'mty-centro', 'cita de firma activa'),
    'test 29'
  );

  -- 30–34. efectos colaterales
  PERFORM public.__rpc_firmas_test_insert_booking(
    v_exp_side, v_org, v_a1,
    (public.__rpc_firmas_test_slot_ts(1, '09:00', 10) AT TIME ZONE 'America/Monterrey')::date,
    (public.__rpc_firmas_test_slot_ts(1, '09:00', 10) AT TIME ZONE 'America/Monterrey')::time,
    'sede-centro', 'biometricos', 'booked'
  );
  SELECT count(*) INTO v_bio_before FROM public.agenda_bookings
  WHERE expediente_id = v_exp_side AND kind = 'biometricos' AND status = 'booked';
  SELECT count(*) INTO v_doc_count FROM public.expediente_documentos WHERE expediente_id = v_exp_side;
  SELECT count(*) INTO v_ret_count FROM public.retencion_envios WHERE expediente_id = v_exp_side;
  SELECT count(*) INTO v_cliente_count FROM public.cliente_datos WHERE expediente_id = v_exp_side;
  SELECT count(*) INTO v_editor_count FROM public.editor_decisions WHERE expediente_id = v_exp_side;
  v_result := public.__rpc_firmas_test_call(v_a1, v_exp_side, public.__rpc_firmas_test_slot_ts(4, '10:00', 3));
  SELECT count(*) INTO v_bio_after FROM public.agenda_bookings
  WHERE expediente_id = v_exp_side AND kind = 'biometricos' AND status = 'booked';
  PERFORM public.__rpc_firmas_test_assert(v_bio_after = v_bio_before AND v_bio_before >= 1, 'test 30');
  PERFORM public.__rpc_firmas_test_assert(
    (SELECT count(*) FROM public.expediente_documentos WHERE expediente_id = v_exp_side) = v_doc_count,
    'test 31'
  );
  PERFORM public.__rpc_firmas_test_assert(
    (SELECT count(*) FROM public.retencion_envios WHERE expediente_id = v_exp_side) = v_ret_count,
    'test 32'
  );
  PERFORM public.__rpc_firmas_test_assert(
    (SELECT count(*) FROM public.cliente_datos WHERE expediente_id = v_exp_side) = v_cliente_count,
    'test 33'
  );
  PERFORM public.__rpc_firmas_test_assert(
    (SELECT count(*) FROM public.editor_decisions WHERE expediente_id = v_exp_side) = v_editor_count,
    'test 34'
  );

  -- 35. regresión book_biometricos (sanity en org seed; slot aislado — no colisionar con suites previas)
  v_slot_bio_regression := public.agenda_biometricos_slot_ts(5, '09:00', 25);
  PERFORM public.__rpc_firmas_test_insert_exp(
    '00000000-0000-4000-9020-000000000099', v_org, v_a1, '92009900099', 4::smallint
  );
  DELETE FROM public.agenda_bookings
  WHERE organization_id = v_org
    AND kind = 'biometricos'
    AND location_id = 'sede-centro'
    AND booking_date = (v_slot_bio_regression AT TIME ZONE 'America/Monterrey')::date
    AND booking_time = (v_slot_bio_regression AT TIME ZONE 'America/Monterrey')::time;
  PERFORM public.__rpc_firmas_test_set_auth(v_a1);
  SELECT public.book_biometricos(
    '00000000-0000-4000-9020-000000000099',
    v_slot_bio_regression,
    'sede-centro'
  ) INTO v_result;
  PERFORM public.__rpc_firmas_test_reset_auth();
  PERFORM public.__rpc_firmas_test_assert((v_result->>'kind') = 'biometricos', 'test 35: book_biometricos sanity');

  -- 36. asesor agenda firmas en etapa 10 tras cancelación Mesa
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_etapa10, v_org, v_a1, '92002800028', 10::smallint);
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, cancelled_at, note
  ) VALUES (
    v_org, 'firmas', v_exp_etapa10,
    (public.__rpc_firmas_test_slot_ts(2, '10:00', 2) AT TIME ZONE 'America/Monterrey')::date,
    (public.__rpc_firmas_test_slot_ts(2, '10:00', 2) AT TIME ZONE 'America/Monterrey')::time,
    'mty-centro', 'cancelled', v_a1, NOW(), 'Cancelado: Mesa solicita reagenda'
  );
  v_result := public.__rpc_firmas_test_call(
    v_a1, v_exp_etapa10, public.__rpc_firmas_test_slot_ts(2, '11:00', 4)
  );
  PERFORM public.__rpc_firmas_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 10,
    'test 36: book firmas etapa 10 tras cancel'
  );
  PERFORM public.__rpc_firmas_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_etapa10 AND e.etapa_actual = 10
    ),
    'test 36: etapa sigue 10'
  );

  -- 37. etapa 10 sin cancelación previa
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_etapa10_nocancel, v_org, v_a1, '92002900029', 10::smallint);
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(
      v_a1, v_exp_etapa10_nocancel, public.__rpc_firmas_test_slot_ts(2, '11:00', 5)
    ),
    'test 37: etapa 10 sin cancelación previa falla'
  );

  -- 38. etapa 10 con último booking no cancelado
  PERFORM public.__rpc_firmas_test_insert_exp(v_exp_etapa10_booked, v_org, v_a1, '92003000030', 10::smallint);
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org, 'firmas', v_exp_etapa10_booked,
    (public.__rpc_firmas_test_slot_ts(2, '10:00', 5) AT TIME ZONE 'America/Monterrey')::date,
    (public.__rpc_firmas_test_slot_ts(2, '10:00', 5) AT TIME ZONE 'America/Monterrey')::time,
    'mty-centro', 'booked', v_a1
  );
  PERFORM public.__rpc_firmas_test_assert(
    public.__rpc_firmas_test_expect_fail(
      v_a1, v_exp_etapa10_booked, public.__rpc_firmas_test_slot_ts(2, '11:00', 6)
    ),
    'test 38: etapa 10 último booking no cancelado falla'
  );

  -- Regresión agenda_config / avanzar_*: cubierta por otras suites del runner SQL

  -- Restaurar config firmas org principal
  PERFORM public.__rpc_firmas_test_upsert_config(v_org, public.__rpc_firmas_test_standard_config());

  RAISE NOTICE 'RPC book_firmas: 38 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_firmas_test_insert_booking(UUID, UUID, UUID, DATE, TIME, TEXT, public.booking_kind, public.booking_status);
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_expect_assert_fail(UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_expect_fail(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_call(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_insert_exp(UUID, UUID, UUID, CHAR, SMALLINT, BOOLEAN, public.operativo_subestado, TIMESTAMPTZ, public.expediente_ciclo_estado, public.origen_mesa);
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_delete_config(UUID);
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_upsert_config(UUID, JSONB);
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_standard_config();
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_slot_ts(INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_firmas_test_assert(BOOLEAN, TEXT);
