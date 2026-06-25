-- ConCasa CRM — pruebas P2C-20 RPC avanzar_etapa_operativa (transición 9→10)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_avanzar_etapa_9_10.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'RPC AVANZAR 910 TEST FAIL: %', p_msg; END IF; END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_slot_ts(
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

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_firmas_config()
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

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_upsert_firmas_config(p_org_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (p_org_id, 'firmas', public.__rpc_avanzar_910_test_firmas_config())
  ON CONFLICT (organization_id, kind) DO UPDATE
    SET config = EXCLUDED.config, updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11),
  p_etapa SMALLINT DEFAULT 9,
  p_subestado public.operativo_subestado DEFAULT 'en_proceso',
  p_submitted BOOLEAN DEFAULT true,
  p_fecha_cita TIMESTAMPTZ DEFAULT NULL,
  p_origen public.origen_mesa DEFAULT 'interno',
  p_ciclo public.expediente_ciclo_estado DEFAULT 'activo',
  p_deleted_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, fecha_cita, ciclo_estado, deleted_at
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture Avanzar 9-10',
    '5555555555', p_origen, p_submitted, CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, p_subestado, p_fecha_cita, p_ciclo, p_deleted_at
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    asesor_id = EXCLUDED.asesor_id,
    origen_mesa = EXCLUDED.origen_mesa,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_cita = EXCLUDED.fecha_cita,
    ciclo_estado = EXCLUDED.ciclo_estado,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = NOW();
  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_book_firmas(
  p_asesor UUID, p_exp UUID, p_at TIMESTAMPTZ, p_loc TEXT DEFAULT 'mty-centro'
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_avanzar_910_test_set_auth(p_asesor);
  SELECT public.book_firmas(p_exp, p_at, p_loc) INTO v_result;
  PERFORM public.__rpc_avanzar_910_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_call_as(
  p_user UUID, p_exp UUID, p_comentario TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_avanzar_910_test_set_auth(p_user);
  SELECT public.avanzar_etapa_operativa(p_exp, p_comentario) INTO v_result;
  PERFORM public.__rpc_avanzar_910_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_expect_fail(
  p_user UUID, p_exp UUID, p_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__rpc_avanzar_910_test_set_auth(p_user);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(p_exp);
    PERFORM public.__rpc_avanzar_910_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_avanzar_910_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC AVANZAR 910 TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_910_test_setup_listo(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11), p_slot TIMESTAMPTZ,
  p_origen public.origen_mesa DEFAULT 'interno'
)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__rpc_avanzar_910_test_insert_exp(
    p_id, p_org, p_asesor, p_nss, 9::smallint, 'en_proceso', true, p_slot, p_origen
  );
  RETURN public.__rpc_avanzar_910_test_book_firmas(p_asesor, p_id, p_slot);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_org_other UUID := '00000000-0000-4000-8020-000000000002';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';

  v_exp_ok UUID := '00000000-0000-4000-9040-000000000010';
  v_exp_super UUID := '00000000-0000-4000-9040-000000000011';
  v_exp_no_fecha UUID := '00000000-0000-4000-9040-000000000012';
  v_exp_no_book UUID := '00000000-0000-4000-9040-000000000013';
  v_exp_cancel UUID := '00000000-0000-4000-9040-000000000014';
  v_exp_bio UUID := '00000000-0000-4000-9040-000000000015';
  v_exp_etapa8 UUID := '00000000-0000-4000-9040-000000000016';
  v_exp_etapa10 UUID := '00000000-0000-4000-9040-000000000017';
  v_exp_asesor UUID := '00000000-0000-4000-9040-000000000018';
  v_exp_roles UUID := '00000000-0000-4000-9040-000000000019';
  v_exp_org UUID := '00000000-0000-4000-9040-000000000020';
  v_exp_fx UUID := '00000000-0000-4000-9040-000000000021';
  v_exp_int UUID := '00000000-0000-4000-9040-000000000022';
  v_exp_ext UUID := '00000000-0000-4000-9040-000000000023';
  v_exp_int_block UUID := '00000000-0000-4000-9040-000000000024';
  v_exp_not_sent UUID := '00000000-0000-4000-9040-000000000025';
  v_exp_deleted UUID := '00000000-0000-4000-9040-000000000026';
  v_exp_ciclo UUID := '00000000-0000-4000-9040-000000000027';
  v_exp_wrong_sub UUID := '00000000-0000-4000-9040-000000000028';
  v_exp_wrong_book UUID := '00000000-0000-4000-9040-000000000029';
  v_exp_other_book UUID := '00000000-0000-4000-9040-000000000030';

  v_slot TIMESTAMPTZ;
  v_slot2 TIMESTAMPTZ;
  v_result JSONB;
  v_fecha_before TIMESTAMPTZ;
  v_fecha_after TIMESTAMPTZ;
  v_booking_before UUID;
  v_booking_status TEXT;
  v_booking_count INTEGER;
  v_roles_revisor INTEGER;
  v_etapa_after SMALLINT;
  v_docs_before INTEGER;
  v_ret_before INTEGER;
  v_ed_before INTEGER;
  v_cd_before INTEGER;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org_other, 'fixture-avanzar-910-other', 'Fixture Avanzar 910 Other', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  PERFORM public.__rpc_avanzar_910_test_upsert_firmas_config(v_org);
  PERFORM public.__rpc_avanzar_910_test_upsert_firmas_config(v_org_other);

  DELETE FROM public.agenda_bookings WHERE organization_id IN (v_org, v_org_other);

  v_slot := public.__rpc_avanzar_910_test_slot_ts(1, '10:00', 20);
  v_slot2 := public.__rpc_avanzar_910_test_slot_ts(2, '11:00', 20);

  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_ok, v_org, v_a1, '94001000010', v_slot);
  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_super, v_org, v_a1, '94001100011', v_slot2);
  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_no_fecha, v_org, v_a1, '94001200012', public.__rpc_avanzar_910_test_slot_ts(2, '10:00', 20));
  UPDATE public.expedientes SET fecha_cita = NULL WHERE id = v_exp_no_fecha;

  PERFORM public.__rpc_avanzar_910_test_insert_exp(
    v_exp_no_book, v_org, v_a1, '94001300013', 9::smallint, 'en_proceso', true, v_slot
  );

  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_cancel, v_org, v_a1, '94001400014', public.__rpc_avanzar_910_test_slot_ts(3, '10:00', 20));
  UPDATE public.agenda_bookings
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE expediente_id = v_exp_cancel AND kind = 'firmas';

  PERFORM public.__rpc_avanzar_910_test_insert_exp(
    v_exp_bio, v_org, v_a1, '94001500015', 9::smallint, 'en_proceso', true, v_slot
  );
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org, 'biometricos', v_exp_bio,
    (v_slot AT TIME ZONE 'America/Monterrey')::date,
    (v_slot AT TIME ZONE 'America/Monterrey')::time,
    'mty-centro', 'booked', v_a1
  );

  PERFORM public.__rpc_avanzar_910_test_insert_exp(v_exp_etapa8, v_org, v_a1, '94001600016', 11::smallint);
  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_etapa10, v_org, v_a1, '94001700017', public.__rpc_avanzar_910_test_slot_ts(4, '10:00', 20));
  UPDATE public.expedientes SET etapa_actual = 10 WHERE id = v_exp_etapa10;

  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_asesor, v_org, v_a1, '94001800018', public.__rpc_avanzar_910_test_slot_ts(4, '11:00', 20));
  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_roles, v_org, v_a1, '94001900019', public.__rpc_avanzar_910_test_slot_ts(5, '10:00', 20));

  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_int, v_org, v_a1, '94002200022', public.__rpc_avanzar_910_test_slot_ts(1, '09:00', 21), 'interno');
  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_ext, v_org, v_a2, '94002300023', public.__rpc_avanzar_910_test_slot_ts(2, '09:00', 21), 'externo');
  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_int_block, v_org, v_a1, '94002400024', public.__rpc_avanzar_910_test_slot_ts(3, '09:00', 21), 'interno');

  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_not_sent, v_org, v_a1, '94002500025', public.__rpc_avanzar_910_test_slot_ts(3, '10:00', 21));
  UPDATE public.expedientes SET submitted_to_mesa = false, fecha_envio_mesa = NULL WHERE id = v_exp_not_sent;

  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_deleted, v_org, v_a1, '94002600026', public.__rpc_avanzar_910_test_slot_ts(4, '10:00', 21));
  UPDATE public.expedientes SET deleted_at = NOW() WHERE id = v_exp_deleted;

  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_ciclo, v_org, v_a1, '94002700027', public.__rpc_avanzar_910_test_slot_ts(5, '10:00', 21));
  UPDATE public.expedientes SET ciclo_estado = 'cerrado' WHERE id = v_exp_ciclo;

  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_wrong_sub, v_org, v_a1, '94002800028', public.__rpc_avanzar_910_test_slot_ts(1, '11:00', 22));
  UPDATE public.expedientes SET subestado = 'pendiente' WHERE id = v_exp_wrong_sub;

  PERFORM public.__rpc_avanzar_910_test_insert_exp(
    v_exp_wrong_book, v_org, v_a1, '94002900029', 9::smallint, 'en_proceso', true,
    public.__rpc_avanzar_910_test_slot_ts(2, '11:00', 22)
  );
  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_other_book, v_org, v_a1, '94003000030', public.__rpc_avanzar_910_test_slot_ts(2, '11:00', 22));

  PERFORM public.__rpc_avanzar_910_test_insert_exp(
    v_exp_org, v_org_other, v_a1, '94002000020', 9::smallint, 'en_proceso', true,
    public.__rpc_avanzar_910_test_slot_ts(1, '12:00', 20)
  );
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org_other, 'firmas', v_exp_org,
    (public.__rpc_avanzar_910_test_slot_ts(1, '12:00', 20) AT TIME ZONE 'America/Monterrey')::date,
    (public.__rpc_avanzar_910_test_slot_ts(1, '12:00', 20) AT TIME ZONE 'America/Monterrey')::time,
    'mty-centro', 'booked', v_a1
  );

  PERFORM public.__rpc_avanzar_910_test_setup_listo(v_exp_fx, v_org, v_a1, '94002100021', public.__rpc_avanzar_910_test_slot_ts(2, '12:00', 20));
  SELECT fecha_cita INTO v_fecha_before FROM public.expedientes WHERE id = v_exp_ok;
  SELECT id INTO v_booking_before FROM public.agenda_bookings
  WHERE expediente_id = v_exp_ok AND kind = 'firmas' AND status = 'booked' LIMIT 1;

  v_result := public.__rpc_avanzar_910_test_call_as(v_mesa, v_exp_ok, 'avance firma');
  PERFORM public.__rpc_avanzar_910_test_assert(
    (v_result->>'ok')::boolean = true
      AND (v_result->>'etapa_actual')::int = 10
      AND (v_result->>'subestado') = 'en_proceso'
      AND v_result->>'transition' = '9_10',
    'test 1: mesa_admin'
  );
  SELECT fecha_cita INTO v_fecha_after FROM public.expedientes WHERE id = v_exp_ok;
  PERFORM public.__rpc_avanzar_910_test_assert(v_fecha_after = v_fecha_before, 'test 1: fecha_cita intacta');
  PERFORM public.__rpc_avanzar_910_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.id = v_booking_before AND b.status = 'booked' AND b.kind = 'firmas'
    ),
    'test 1: booking intacto'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_exp_ok AND al.action = 'expediente.avanzar_etapa_operativa'
        AND al.payload->>'transition' = '9_10'
    ),
    'test 1: action_log'
  );

  -- 2. mesa_interno visible
  v_result := public.__rpc_avanzar_910_test_call_as(v_mesa_int, v_exp_int);
  PERFORM public.__rpc_avanzar_910_test_assert((v_result->>'etapa_actual')::int = 10, 'test 2: mesa_interno');

  -- 3. mesa_externo expediente externo visible
  v_result := public.__rpc_avanzar_910_test_call_as(v_mesa_ext, v_exp_ext);
  PERFORM public.__rpc_avanzar_910_test_assert((v_result->>'etapa_actual')::int = 10, 'test 3: mesa_externo externo');

  -- 4. super_admin
  v_result := public.__rpc_avanzar_910_test_call_as(v_super, v_exp_super);
  PERFORM public.__rpc_avanzar_910_test_assert((v_result->>'etapa_actual')::int = 10, 'test 4: super_admin');

  -- roles bloqueados
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_a1, v_exp_asesor, 'no autorizado'),
    'test 5: asesor'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_editor, v_exp_roles, 'no autorizado'),
    'test 6: editor'
  );
  SELECT COUNT(*) INTO v_roles_revisor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__rpc_avanzar_910_test_assert(v_roles_revisor = 0, 'test 7: sin revisor');
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa_ext, v_exp_int_block, 'no autorizado'),
    'test 8: mesa_externo bloqueado en interno'
  );

  -- gates etapa / envío / ciclo / subestado
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_etapa8, 'transición no permitida'),
    'test 9: etapa distinta de 9 (11)'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_etapa10, 'transición no permitida'),
    'test 10: etapa distinta de 9 (10)'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_super, v_exp_not_sent, 'enviado a Mesa'),
    'test 11: no enviado a Mesa'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_deleted, 'no disponible'),
    'test 12: soft-deleted'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_ciclo, 'ciclo activo'),
    'test 13: ciclo no activo'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_wrong_sub, 'en_proceso'),
    'test 14: subestado distinto'
  );

  -- gates firmas
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_no_fecha, 'fecha de cita de firma'),
    'test 15: sin fecha_cita'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_no_book, 'booking de firma activo'),
    'test 16: sin booking firmas'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_cancel, 'booking de firma activo'),
    'test 17: booking cancelled'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_bio, 'booking de firma activo'),
    'test 18: solo booking biométrico'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_wrong_book, 'booking de firma activo'),
    'test 19: booking de otro expediente no cuenta'
  );

  -- org / cross-org
  PERFORM public.__rpc_avanzar_910_test_assert(
    public.__rpc_avanzar_910_test_expect_fail(v_mesa, v_exp_org, 'fuera de la organización'),
    'test 20: org distinta mesa_admin'
  );
  v_result := public.__rpc_avanzar_910_test_call_as(v_super, v_exp_org);
  PERFORM public.__rpc_avanzar_910_test_assert((v_result->>'etapa_actual')::int = 10, 'test 21: super_admin cross-org');

  -- efectos: etapa, fecha_cita, booking, action_log enriquecido
  SELECT e.fecha_cita, b.id INTO v_fecha_before, v_booking_before
  FROM public.expedientes e
  JOIN public.agenda_bookings b ON b.expediente_id = e.id AND b.kind = 'firmas' AND b.status = 'booked'
  WHERE e.id = v_exp_fx;
  SELECT COUNT(*) INTO v_docs_before FROM public.expediente_documentos WHERE expediente_id = v_exp_fx;
  SELECT COUNT(*) INTO v_ret_before FROM public.retencion_envios WHERE expediente_id = v_exp_fx;
  SELECT COUNT(*) INTO v_ed_before FROM public.editor_decisions WHERE expediente_id = v_exp_fx;
  SELECT COUNT(*) INTO v_cd_before FROM public.cliente_datos WHERE expediente_id = v_exp_fx;
  v_result := public.__rpc_avanzar_910_test_call_as(v_mesa, v_exp_fx, 'fx 9-10');
  SELECT fecha_cita, etapa_actual INTO v_fecha_after, v_etapa_after FROM public.expedientes WHERE id = v_exp_fx;
  SELECT status INTO v_booking_status FROM public.agenda_bookings WHERE id = v_booking_before;
  PERFORM public.__rpc_avanzar_910_test_assert(v_etapa_after = 10, 'test 22: etapa 10');
  PERFORM public.__rpc_avanzar_910_test_assert(
    v_fecha_after = v_fecha_before AND v_booking_status = 'booked',
    'test 23-24: fecha_cita y booking intactos'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_exp_fx AND al.action = 'expediente.avanzar_etapa_operativa'
        AND al.payload->>'transition' = '9_10'
        AND al.payload ? 'booking_date'
        AND al.payload ? 'booking_time'
        AND al.payload ? 'location_id'
    ),
    'test 25: action_log con booking_date/time/location'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    (SELECT COUNT(*) FROM public.expediente_documentos WHERE expediente_id = v_exp_fx) = v_docs_before,
    'test 26: documentos sin cambio'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    (SELECT COUNT(*) FROM public.retencion_envios WHERE expediente_id = v_exp_fx) = v_ret_before,
    'test 27: retención sin cambio'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    (SELECT COUNT(*) FROM public.cliente_datos WHERE expediente_id = v_exp_fx) = v_cd_before,
    'test 28: cliente_datos sin cambio'
  );
  PERFORM public.__rpc_avanzar_910_test_assert(
    (SELECT COUNT(*) FROM public.editor_decisions WHERE expediente_id = v_exp_fx) = v_ed_before,
    'test 29: editor_decisions sin cambio'
  );

  RAISE NOTICE 'RPC avanzar_etapa_operativa 9→10: 29 pruebas OK (regresiones vía runner)';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_setup_listo(UUID, UUID, UUID, CHAR, TIMESTAMPTZ, public.origen_mesa);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_setup_listo(UUID, UUID, UUID, CHAR, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_expect_fail(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_call_as(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_book_firmas(UUID, UUID, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_insert_exp(UUID, UUID, UUID, CHAR, SMALLINT, public.operativo_subestado, BOOLEAN, TIMESTAMPTZ, public.origen_mesa, public.expediente_ciclo_estado, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_insert_exp(UUID, UUID, UUID, CHAR, SMALLINT, public.operativo_subestado, BOOLEAN, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_upsert_firmas_config(UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_firmas_config();
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_slot_ts(INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_910_test_assert(BOOLEAN, TEXT);
