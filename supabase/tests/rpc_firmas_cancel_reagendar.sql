-- ConCasa CRM — pruebas P2C-19 RPC cancel_firmas y reagendar_firmas
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_firmas_cancel_reagendar.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'RPC FIRMAS CR TEST FAIL: %', p_msg; END IF; END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_slot_ts(
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

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_standard_config()
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

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_upsert_config(p_org_id UUID, p_config JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (p_org_id, 'firmas', p_config)
  ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11),
  p_etapa SMALLINT DEFAULT 9, p_submitted BOOLEAN DEFAULT true,
  p_subestado public.operativo_subestado DEFAULT 'en_proceso',
  p_deleted TIMESTAMPTZ DEFAULT NULL, p_ciclo public.expediente_ciclo_estado DEFAULT 'activo'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, deleted_at, ciclo_estado, fecha_cita
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture Firmas CR',
    '5555555555', 'interno', p_submitted,
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

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_book_as(
  p_user UUID, p_exp UUID, p_at TIMESTAMPTZ, p_loc TEXT DEFAULT 'mty-centro'
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_firmas_cr_test_set_auth(p_user);
  SELECT public.book_firmas(p_exp, p_at, p_loc) INTO v_result;
  PERFORM public.__rpc_firmas_cr_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_cancel_as(
  p_user UUID, p_exp UUID, p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_firmas_cr_test_set_auth(p_user);
  SELECT public.cancel_firmas(p_exp, p_motivo) INTO v_result;
  PERFORM public.__rpc_firmas_cr_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_reagendar_as(
  p_user UUID, p_exp UUID, p_at TIMESTAMPTZ, p_loc TEXT, p_note TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_firmas_cr_test_set_auth(p_user);
  SELECT public.reagendar_firmas(p_exp, p_at, p_loc, p_note) INTO v_result;
  PERFORM public.__rpc_firmas_cr_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_expect_fail_cancel(
  p_user UUID, p_exp UUID, p_motivo TEXT DEFAULT NULL, p_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__rpc_firmas_cr_test_set_auth(p_user);
  BEGIN
    PERFORM public.cancel_firmas(p_exp, p_motivo);
    PERFORM public.__rpc_firmas_cr_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_firmas_cr_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC FIRMAS CR TEST FAIL: cancel esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_expect_fail_reagendar(
  p_user UUID, p_exp UUID, p_at TIMESTAMPTZ, p_loc TEXT, p_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__rpc_firmas_cr_test_set_auth(p_user);
  BEGIN
    PERFORM public.reagendar_firmas(p_exp, p_at, p_loc);
    PERFORM public.__rpc_firmas_cr_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_firmas_cr_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC FIRMAS CR TEST FAIL: reagendar esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_firmas_cr_test_insert_booking(
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
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';

  v_exp_cancel9 UUID := '00000000-0000-4000-9030-000000000001';
  v_exp_cancel10 UUID := '00000000-0000-4000-9030-000000000002';
  v_exp_cancel_mesa UUID := '00000000-0000-4000-9030-000000000003';
  v_exp_cancel_super UUID := '00000000-0000-4000-9030-000000000004';
  v_exp_cancel_owner UUID := '00000000-0000-4000-9030-000000000005';
  v_exp_cancel_roles UUID := '00000000-0000-4000-9030-000000000006';
  v_exp_cancel_etapa UUID := '00000000-0000-4000-9030-000000000007';
  v_exp_cancel_nobook UUID := '00000000-0000-4000-9030-000000000008';
  v_exp_cancel_del UUID := '00000000-0000-4000-9030-000000000009';
  v_exp_cancel_ciclo UUID := '00000000-0000-4000-9030-000000000010';
  v_exp_cancel_sub UUID := '00000000-0000-4000-9030-000000000011';
  v_exp_cancel_mesa_int UUID := '00000000-0000-4000-9030-000000000012';
  v_exp_cancel_mesa_ext UUID := '00000000-0000-4000-9030-000000000013';
  v_exp_cancel_motivo UUID := '00000000-0000-4000-9030-000000000014';

  v_exp_reag9 UUID := '00000000-0000-4000-9030-000000000020';
  v_exp_reag10 UUID := '00000000-0000-4000-9030-000000000021';
  v_exp_reag_mesa UUID := '00000000-0000-4000-9030-000000000022';
  v_exp_reag_super UUID := '00000000-0000-4000-9030-000000000023';
  v_exp_reag_owner UUID := '00000000-0000-4000-9030-000000000024';
  v_exp_reag_roles UUID := '00000000-0000-4000-9030-000000000025';
  v_exp_reag_etapa UUID := '00000000-0000-4000-9030-000000000026';
  v_exp_reag_nobook UUID := '00000000-0000-4000-9030-000000000027';
  v_exp_reag_val UUID := '00000000-0000-4000-9030-000000000028';
  v_exp_reag_same UUID := '00000000-0000-4000-9030-000000000029';
  v_exp_reag_cap1 UUID := '00000000-0000-4000-9030-000000000030';
  v_exp_reag_cap2 UUID := '00000000-0000-4000-9030-000000000031';
  v_exp_reag_cap3 UUID := '00000000-0000-4000-9030-000000000032';
  v_exp_reag_cap4 UUID := '00000000-0000-4000-9030-000000000033';
  v_exp_side UUID := '00000000-0000-4000-9030-000000000040';

  v_slot_mon TIMESTAMPTZ;
  v_slot_tue TIMESTAMPTZ;
  v_slot_wed TIMESTAMPTZ;
  v_slot_thu TIMESTAMPTZ;
  v_slot_fri TIMESTAMPTZ;
  v_slot_sun TIMESTAMPTZ;
  v_slot_bad TIMESTAMPTZ;
  v_slot_lead TIMESTAMPTZ;
  v_result JSONB;
  v_etapa SMALLINT;
  v_fecha TIMESTAMPTZ;
  v_booking_id UUID;
  v_old_id UUID;
  v_new_id UUID;
  v_active_count INTEGER;
  v_roles_revisor INTEGER;
  v_bio_before BIGINT;
  v_bio_after BIGINT;
  v_doc_count BIGINT;
  v_ret_count BIGINT;
  v_cliente_count BIGINT;
  v_editor_count BIGINT;
  v_date DATE;
  v_time TIME;
BEGIN
  PERFORM public.__rpc_firmas_cr_test_upsert_config(v_org, public.__rpc_firmas_cr_test_standard_config());

  v_slot_mon := public.__rpc_firmas_cr_test_slot_ts(1, '10:00', 3);
  v_slot_tue := public.__rpc_firmas_cr_test_slot_ts(2, '10:00', 3);
  v_slot_wed := public.__rpc_firmas_cr_test_slot_ts(3, '11:00', 3);
  v_slot_thu := public.__rpc_firmas_cr_test_slot_ts(4, '12:00', 3);
  v_slot_fri := public.__rpc_firmas_cr_test_slot_ts(5, '16:00', 3);
  v_slot_sun := public.__rpc_firmas_cr_test_slot_ts(7, '10:00', 3);
  v_slot_bad := public.__rpc_firmas_cr_test_slot_ts(1, '08:30', 3);
  v_slot_lead := (NOW() AT TIME ZONE 'America/Monterrey' + INTERVAL '2 hours') AT TIME ZONE 'America/Monterrey';

  -- Fixtures cancel
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel9, v_org, v_a1, '93000100001');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel10, v_org, v_a1, '93000200002');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_mesa, v_org, v_a1, '93000300003');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_super, v_org, v_a1, '93000400004');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_owner, v_org, v_a2, '93000500005');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_roles, v_org, v_a1, '93000600006');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_etapa, v_org, v_a1, '93000700007', 8::smallint);
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_nobook, v_org, v_a1, '93000800008');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_del, v_org, v_a1, '93000900009');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_ciclo, v_org, v_a1, '93001000010');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_sub, v_org, v_a1, '93001100011');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(
    v_exp_cancel_mesa_int, v_org, v_a1, '93001200012', 9::smallint, true, 'en_proceso', NULL, 'activo'
  );
  UPDATE public.expedientes SET origen_mesa = 'interno' WHERE id = v_exp_cancel_mesa_int;
  PERFORM public.__rpc_firmas_cr_test_insert_exp(
    v_exp_cancel_mesa_ext, v_org, v_a1, '93001300013', 9::smallint, true, 'en_proceso', NULL, 'activo'
  );
  UPDATE public.expedientes SET origen_mesa = 'externo' WHERE id = v_exp_cancel_mesa_ext;
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_cancel_motivo, v_org, v_a1, '93001400014');

  -- Fixtures reagendar
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag9, v_org, v_a1, '93002000020');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag10, v_org, v_a1, '93002100021');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_mesa, v_org, v_a1, '93002200022');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_super, v_org, v_a1, '93002300023');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_owner, v_org, v_a2, '93002400024');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_roles, v_org, v_a1, '93002500025');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_etapa, v_org, v_a1, '93002600026', 8::smallint);
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_nobook, v_org, v_a1, '93002700027');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_val, v_org, v_a1, '93002800028');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_same, v_org, v_a1, '93002900029');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_cap1, v_org, v_a1, '93003000030');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_cap2, v_org, v_a1, '93003100031');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_cap3, v_org, v_a1, '93003200032');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_reag_cap4, v_org, v_a1, '93003300033');
  PERFORM public.__rpc_firmas_cr_test_insert_exp(v_exp_side, v_org, v_a1, '93004000040');

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
    v_org, v_exp_side, 'ine', 'dev/firmas-cr-side/ine.pdf', 'ine.pdf',
    'application/pdf', 100, 'validado', v_a1, 'asesor'
  );

  -- Book firmas para expedientes que necesitan cita activa
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_cancel9, v_slot_mon);
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_cancel10, public.__rpc_firmas_cr_test_slot_ts(1, '11:00', 3));
  UPDATE public.expedientes SET etapa_actual = 10 WHERE id = v_exp_cancel10;
  PERFORM public.__rpc_firmas_cr_test_book_as(v_mesa, v_exp_cancel_mesa, public.__rpc_firmas_cr_test_slot_ts(2, '10:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_super, v_exp_cancel_super, public.__rpc_firmas_cr_test_slot_ts(2, '11:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a2, v_exp_cancel_owner, public.__rpc_firmas_cr_test_slot_ts(2, '12:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_cancel_roles, public.__rpc_firmas_cr_test_slot_ts(3, '10:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_cancel_del, public.__rpc_firmas_cr_test_slot_ts(3, '11:00', 3));
  UPDATE public.expedientes SET deleted_at = NOW() WHERE id = v_exp_cancel_del;
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_cancel_ciclo, public.__rpc_firmas_cr_test_slot_ts(3, '12:00', 3));
  UPDATE public.expedientes SET ciclo_estado = 'cerrado' WHERE id = v_exp_cancel_ciclo;
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_cancel_sub, public.__rpc_firmas_cr_test_slot_ts(4, '10:00', 3));
  UPDATE public.expedientes SET subestado = 'pendiente' WHERE id = v_exp_cancel_sub;
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_cancel_mesa_int, public.__rpc_firmas_cr_test_slot_ts(4, '11:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_cancel_mesa_ext, public.__rpc_firmas_cr_test_slot_ts(4, '12:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_cancel_motivo, public.__rpc_firmas_cr_test_slot_ts(5, '10:00', 3));

  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_reag9, v_slot_wed);
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_reag10, public.__rpc_firmas_cr_test_slot_ts(1, '16:00', 3));
  UPDATE public.expedientes SET etapa_actual = 10 WHERE id = v_exp_reag10;
  PERFORM public.__rpc_firmas_cr_test_book_as(v_mesa, v_exp_reag_mesa, public.__rpc_firmas_cr_test_slot_ts(2, '16:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_super, v_exp_reag_super, public.__rpc_firmas_cr_test_slot_ts(3, '09:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a2, v_exp_reag_owner, public.__rpc_firmas_cr_test_slot_ts(3, '10:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_reag_roles, public.__rpc_firmas_cr_test_slot_ts(4, '09:00', 3));
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_reag_val, v_slot_thu);
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_reag_same, v_slot_fri);
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_reag_cap4, public.__rpc_firmas_cr_test_slot_ts(5, '09:00', 3));

  -- 1. asesor dueño cancela etapa 9
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp_cancel9;
  v_result := public.__rpc_firmas_cr_test_cancel_as(v_a1, v_exp_cancel9, 'motivo test');
  PERFORM public.__rpc_firmas_cr_test_assert(
    (v_result->>'ok')::boolean = true AND v_result->>'status' = 'cancelled'
      AND v_result->>'kind' = 'firmas' AND (v_result->>'no_etapa_change')::boolean = true,
    'test 1'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp_cancel9 AND b.kind = 'firmas' AND b.status = 'cancelled'
    ),
    'test 5'
  );
  SELECT fecha_cita INTO v_fecha FROM public.expedientes WHERE id = v_exp_cancel9;
  PERFORM public.__rpc_firmas_cr_test_assert(v_fecha IS NULL, 'test 6');
  PERFORM public.__rpc_firmas_cr_test_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_cancel9) = v_etapa,
    'test 7'
  );
  v_booking_id := (v_result->>'booking_id')::uuid;
  PERFORM public.__rpc_firmas_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_booking_id AND al.action = 'agenda.firmas.cancel'
        AND (al.payload->>'no_etapa_change')::boolean = true
    ),
    'test 8'
  );

  -- 2. asesor dueño cancela etapa 10
  v_result := public.__rpc_firmas_cr_test_cancel_as(v_a1, v_exp_cancel10);
  PERFORM public.__rpc_firmas_cr_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 10,
    'test 2'
  );

  -- 3–4. mesa_admin y super_admin
  v_result := public.__rpc_firmas_cr_test_cancel_as(v_mesa, v_exp_cancel_mesa, 'Mesa admin cancela firma');
  PERFORM public.__rpc_firmas_cr_test_assert((v_result->>'ok')::boolean = true, 'test 3');
  v_result := public.__rpc_firmas_cr_test_cancel_as(v_super, v_exp_cancel_super, 'Super admin cancela firma');
  PERFORM public.__rpc_firmas_cr_test_assert((v_result->>'ok')::boolean = true, 'test 4');

  -- 9–17. cancel roles/gates
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_cancel(v_a1, v_exp_cancel_owner, NULL, 'asesor dueño'),
    'test 9'
  );
  v_result := public.__rpc_firmas_cr_test_cancel_as(
    v_mesa_int, v_exp_cancel_mesa_int, 'Mesa interno cancela firma'
  );
  PERFORM public.__rpc_firmas_cr_test_assert((v_result->>'ok')::boolean = true, 'test 10: mesa_interno');
  v_result := public.__rpc_firmas_cr_test_cancel_as(
    v_mesa_ext, v_exp_cancel_mesa_ext, 'Mesa externo cancela firma'
  );
  PERFORM public.__rpc_firmas_cr_test_assert((v_result->>'ok')::boolean = true, 'test 11: mesa_externo');
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_cancel(v_mesa_ext, v_exp_cancel_mesa_int, 'motivo', 'no autorizado'),
    'test 11b: mesa_externo bloqueado en interno'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_cancel(v_editor, v_exp_cancel_roles),
    'test 12'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_cancel(v_mesa, v_exp_cancel_etapa),
    'test 13'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_cancel(v_a1, v_exp_cancel_nobook, NULL, 'cita de firma activa'),
    'test 14'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_cancel(v_a1, v_exp_cancel_del),
    'test 15'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_cancel(v_a1, v_exp_cancel_ciclo),
    'test 16'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_cancel(v_a1, v_exp_cancel_sub),
    'test 17'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_cancel(
      v_mesa, v_exp_cancel_motivo, '   ', 'motivo es obligatorio'
    ),
    'test 17b: motivo vacío bloqueado Mesa firmas'
  );

  -- 18–26. reagendar happy path
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp_reag9;
  v_result := public.__rpc_firmas_cr_test_reagendar_as(v_a1, v_exp_reag9, v_slot_tue, 'mty-centro', 'nueva nota');
  v_old_id := (v_result->>'old_booking_id')::uuid;
  v_new_id := (v_result->>'new_booking_id')::uuid;
  PERFORM public.__rpc_firmas_cr_test_assert(
    (v_result->>'ok')::boolean = true AND v_old_id IS NOT NULL AND v_new_id IS NOT NULL
      AND v_old_id <> v_new_id AND (v_result->>'no_etapa_change')::boolean = true,
    'test 18'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    EXISTS (SELECT 1 FROM public.agenda_bookings WHERE id = v_old_id AND status = 'cancelled'),
    'test 22'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    EXISTS (SELECT 1 FROM public.agenda_bookings WHERE id = v_new_id AND kind = 'firmas' AND status = 'booked'),
    'test 23'
  );
  SELECT fecha_cita INTO v_fecha FROM public.expedientes WHERE id = v_exp_reag9;
  PERFORM public.__rpc_firmas_cr_test_assert(v_fecha = v_slot_tue, 'test 24');
  PERFORM public.__rpc_firmas_cr_test_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_reag9) = v_etapa,
    'test 25'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_new_id AND al.action = 'agenda.firmas.reagendar'
        AND (al.payload->>'no_etapa_change')::boolean = true
    ),
    'test 26'
  );

  v_result := public.__rpc_firmas_cr_test_reagendar_as(v_a1, v_exp_reag10, public.__rpc_firmas_cr_test_slot_ts(2, '11:00', 3), 'mty-centro');
  PERFORM public.__rpc_firmas_cr_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 10,
    'test 19'
  );

  v_result := public.__rpc_firmas_cr_test_reagendar_as(v_mesa, v_exp_reag_mesa, public.__rpc_firmas_cr_test_slot_ts(3, '11:00', 3), 'mty-centro');
  PERFORM public.__rpc_firmas_cr_test_assert((v_result->>'ok')::boolean = true, 'test 20');

  v_result := public.__rpc_firmas_cr_test_reagendar_as(v_super, v_exp_reag_super, public.__rpc_firmas_cr_test_slot_ts(4, '10:00', 3), 'mty-centro');
  PERFORM public.__rpc_firmas_cr_test_assert((v_result->>'ok')::boolean = true, 'test 21');

  -- 27–32. reagendar roles/gates
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_a1, v_exp_reag_owner, v_slot_mon, 'mty-centro', 'asesor dueño'),
    'test 27'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_mesa_int, v_exp_reag_roles, v_slot_mon, 'mty-centro'),
    'test 28'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_mesa_ext, v_exp_reag_roles, v_slot_mon, 'mty-centro'),
    'test 29'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_editor, v_exp_reag_roles, v_slot_mon, 'mty-centro'),
    'test 30'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_mesa, v_exp_reag_etapa, v_slot_mon, 'mty-centro'),
    'test 31'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_a1, v_exp_reag_nobook, v_slot_mon, 'mty-centro', 'cita de firma activa'),
    'test 32'
  );

  -- 33–37. reagendar validaciones agenda
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_a1, v_exp_reag_val, v_slot_mon, 'sede-inexistente', 'sede firmas no permitida'),
    'test 33'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_a1, v_exp_reag_val, v_slot_bad, 'mty-centro', 'horario firmas no permitido'),
    'test 34'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_a1, v_exp_reag_val, v_slot_sun, 'mty-centro', 'día firmas no permitido'),
    'test 35'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(v_a1, v_exp_reag_val, v_slot_lead, 'mty-centro', 'anticipación mínima'),
    'test 36'
  );

  -- 38. mismo slot no deja duplicado activo (antes de llenar cupo)
  v_result := public.__rpc_firmas_cr_test_reagendar_as(v_a1, v_exp_reag_same, v_slot_fri, 'mty-centro');
  SELECT COUNT(*) INTO v_active_count
  FROM public.agenda_bookings
  WHERE expediente_id = v_exp_reag_same AND kind = 'firmas' AND status = 'booked';
  PERFORM public.__rpc_firmas_cr_test_assert(v_active_count = 1, 'test 38');

  -- 37. cupo lleno en slot distinto
  v_date := (public.__rpc_firmas_cr_test_slot_ts(5, '12:00', 4) AT TIME ZONE 'America/Monterrey')::date;
  v_time := (public.__rpc_firmas_cr_test_slot_ts(5, '12:00', 4) AT TIME ZONE 'America/Monterrey')::time;
  PERFORM public.__rpc_firmas_cr_test_insert_booking(v_exp_reag_cap1, v_org, v_a1, v_date, v_time, 'mty-centro');
  PERFORM public.__rpc_firmas_cr_test_insert_booking(v_exp_reag_cap2, v_org, v_a1, v_date, v_time, 'mty-centro');
  PERFORM public.__rpc_firmas_cr_test_insert_booking(v_exp_reag_cap3, v_org, v_a1, v_date, v_time, 'mty-centro');
  PERFORM public.__rpc_firmas_cr_test_assert(
    public.__rpc_firmas_cr_test_expect_fail_reagendar(
      v_a1, v_exp_reag_cap4,
      public.__rpc_firmas_cr_test_slot_ts(5, '12:00', 4),
      'mty-centro', 'cupo firmas agotado'
    ),
    'test 37'
  );

  -- 39–44. efectos colaterales
  PERFORM public.__rpc_firmas_cr_test_insert_booking(
    v_exp_side, v_org, v_a1,
    (public.__rpc_firmas_cr_test_slot_ts(1, '09:00', 10) AT TIME ZONE 'America/Monterrey')::date,
    (public.__rpc_firmas_cr_test_slot_ts(1, '09:00', 10) AT TIME ZONE 'America/Monterrey')::time,
    'sede-centro', 'biometricos', 'booked'
  );
  PERFORM public.__rpc_firmas_cr_test_book_as(v_a1, v_exp_side, public.__rpc_firmas_cr_test_slot_ts(4, '11:00', 3));
  SELECT count(*) INTO v_bio_before FROM public.agenda_bookings
  WHERE expediente_id = v_exp_side AND kind = 'biometricos' AND status = 'booked';
  SELECT count(*) INTO v_doc_count FROM public.expediente_documentos WHERE expediente_id = v_exp_side;
  SELECT count(*) INTO v_ret_count FROM public.retencion_envios WHERE expediente_id = v_exp_side;
  SELECT count(*) INTO v_cliente_count FROM public.cliente_datos WHERE expediente_id = v_exp_side;
  SELECT count(*) INTO v_editor_count FROM public.editor_decisions WHERE expediente_id = v_exp_side;
  v_result := public.__rpc_firmas_cr_test_cancel_as(v_a1, v_exp_side, 'side cancel');
  SELECT count(*) INTO v_bio_after FROM public.agenda_bookings
  WHERE expediente_id = v_exp_side AND kind = 'biometricos' AND status = 'booked';
  PERFORM public.__rpc_firmas_cr_test_assert(v_bio_after = v_bio_before AND v_bio_before >= 1, 'test 39');
  PERFORM public.__rpc_firmas_cr_test_assert(
    (SELECT count(*) FROM public.expediente_documentos WHERE expediente_id = v_exp_side) = v_doc_count,
    'test 40'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    (SELECT count(*) FROM public.retencion_envios WHERE expediente_id = v_exp_side) = v_ret_count,
    'test 41'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    (SELECT count(*) FROM public.cliente_datos WHERE expediente_id = v_exp_side) = v_cliente_count,
    'test 42'
  );
  PERFORM public.__rpc_firmas_cr_test_assert(
    (SELECT count(*) FROM public.editor_decisions WHERE expediente_id = v_exp_side) = v_editor_count,
    'test 43'
  );
  SELECT COUNT(*) INTO v_roles_revisor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__rpc_firmas_cr_test_assert(v_roles_revisor = 0, 'test 44');

  -- 45. regresión book_firmas sanity
  PERFORM public.__rpc_firmas_cr_test_insert_exp(
    '00000000-0000-4000-9030-000000000099', v_org, v_a1, '93009900099'
  );
  v_result := public.__rpc_firmas_cr_test_book_as(
    v_a1, '00000000-0000-4000-9030-000000000099',
    public.__rpc_firmas_cr_test_slot_ts(1, '12:00', 5)
  );
  PERFORM public.__rpc_firmas_cr_test_assert((v_result->>'kind') = 'firmas', 'test 45');

  -- 46–47: cubiertos por suites biométricos cancel/reagendar y avances 1→9 en runner SQL

  RAISE NOTICE 'RPC firmas cancel/reagendar: 44 pruebas OK (45-47 vía runner regresión)';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_insert_booking(UUID, UUID, UUID, DATE, TIME, TEXT, public.booking_kind, public.booking_status);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_expect_fail_reagendar(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_expect_fail_cancel(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_reagendar_as(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_cancel_as(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_book_as(UUID, UUID, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_insert_exp(UUID, UUID, UUID, CHAR, SMALLINT, BOOLEAN, public.operativo_subestado, TIMESTAMPTZ, public.expediente_ciclo_estado);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_upsert_config(UUID, JSONB);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_standard_config();
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_slot_ts(INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_firmas_cr_test_assert(BOOLEAN, TEXT);
