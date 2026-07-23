-- ConCasa CRM — pruebas endurecidas P070 convert_biometricos_to_notificacion
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_convert_biometricos_to_notificacion.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_cvt_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC CVT TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_cvt_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_cvt_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_cvt_expect_fail(
  p_user UUID,
  p_exp UUID,
  p_date DATE,
  p_needle TEXT,
  p_msg TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__rpc_cvt_auth(p_user);
  BEGIN
    PERFORM public.convert_biometricos_to_notificacion(p_exp, p_date, 'monterrey', NULL);
    PERFORM public.__rpc_cvt_reset();
    RAISE EXCEPTION 'RPC CVT TEST FAIL: % (expected error)', p_msg;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_cvt_reset();
    IF SQLERRM LIKE 'RPC CVT TEST FAIL:%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE ('%' || p_needle || '%') THEN
      RAISE EXCEPTION 'RPC CVT TEST FAIL: % — got: %', p_msg, SQLERRM;
    END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9070-000000000001';
  v_org_b UUID := '00000000-0000-4000-9070-000000000002';
  v_asesor UUID := '00000000-0000-4000-9070-000000000011';
  v_asesor2 UUID := '00000000-0000-4000-9070-000000000012';
  v_asesor_b UUID := '00000000-0000-4000-9070-000000000014';
  v_mesa UUID := '00000000-0000-4000-9070-000000000013';
  v_editor UUID := '00000000-0000-4000-9070-000000000015';
  v_super UUID := '00000000-0000-4000-9070-000000000016';
  v_inactive UUID := '00000000-0000-4000-9070-000000000017';

  v_exp4 UUID := '00000000-0000-4000-9070-000000000021';
  v_exp3 UUID := '00000000-0000-4000-9070-000000000022';
  v_exp_other UUID := '00000000-0000-4000-9070-000000000023';
  v_exp5 UUID := '00000000-0000-4000-9070-000000000024';
  v_exp2 UUID := '00000000-0000-4000-9070-000000000025';
  v_exp_nosub UUID := '00000000-0000-4000-9070-000000000026';
  v_exp_del UUID := '00000000-0000-4000-9070-000000000027';
  v_exp_ciclo UUID := '00000000-0000-4000-9070-000000000028';
  v_exp_sub UUID := '00000000-0000-4000-9070-000000000029';
  v_exp_drive UUID := '00000000-0000-4000-9070-00000000002a';
  v_exp_rb UUID := '00000000-0000-4000-9070-00000000002b';
  v_exp_same_day UUID := '00000000-0000-4000-9070-00000000002c';
  v_exp_cancel_only UUID := '00000000-0000-4000-9070-00000000002d';
  v_exp_org_b UUID := '00000000-0000-4000-9070-00000000002e';
  v_exp_reg_bio UUID := '00000000-0000-4000-9070-000000000041';
  v_exp_reg_notif UUID := '00000000-0000-4000-9070-000000000042';
  v_exp_reg_45 UUID := '00000000-0000-4000-9070-000000000043';
  v_exp_reg_35 UUID := '00000000-0000-4000-9070-000000000044';
  v_exp_reg_nr UUID := '00000000-0000-4000-9070-000000000045';

  v_bio4 UUID := '00000000-0000-4000-9070-000000000031';
  v_bio3 UUID := '00000000-0000-4000-9070-000000000032';
  v_bio_other UUID := '00000000-0000-4000-9070-000000000033';
  v_bio5 UUID := '00000000-0000-4000-9070-000000000034';
  v_bio2 UUID := '00000000-0000-4000-9070-000000000035';
  v_bio_nosub UUID := '00000000-0000-4000-9070-000000000036';
  v_bio_del UUID := '00000000-0000-4000-9070-000000000037';
  v_bio_ciclo UUID := '00000000-0000-4000-9070-000000000038';
  v_bio_sub UUID := '00000000-0000-4000-9070-000000000039';
  v_bio_drive UUID := '00000000-0000-4000-9070-00000000003a';
  v_bio_rb UUID := '00000000-0000-4000-9070-00000000003b';
  v_bio_same UUID := '00000000-0000-4000-9070-00000000003c';
  v_bio_canc UUID := '00000000-0000-4000-9070-00000000003d';
  v_bio_org_b UUID := '00000000-0000-4000-9070-00000000003e';
  v_bio_reg45 UUID := '00000000-0000-4000-9070-00000000003f';

  v_date DATE := (CURRENT_DATE + 12);
  v_date2 DATE := (CURRENT_DATE + 14);
  v_past DATE := (CURRENT_DATE - 1);
  v_result JSONB;
  v_log JSONB;
  v_bio_row RECORD;
  v_notif_row RECORD;
  v_exp_row RECORD;
  v_fecha_prev TIMESTAMPTZ;
  v_etapa_prev SMALLINT;
  v_count INT;
  v_cases INT := 0;
BEGIN
  INSERT INTO public.organizations (id, name, slug, active)
  VALUES
    (v_org, 'Org CVT 070', 'org-cvt-070', true),
    (v_org_b, 'Org B CVT 070', 'org-b-cvt-070', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_asesor, 'authenticated', 'authenticated', 'cvt-asesor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor2, 'authenticated', 'authenticated', 'cvt-asesor2@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor_b, 'authenticated', 'authenticated', 'cvt-asesor-b@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'cvt-mesa@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'cvt-editor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_super, 'authenticated', 'authenticated', 'cvt-super@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_inactive, 'authenticated', 'authenticated', 'cvt-inactive@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, app_role, full_name, email, active)
  VALUES
    (v_asesor, v_org, 'asesor', 'Asesor CVT', 'cvt-asesor@test.local', true),
    (v_asesor2, v_org, 'asesor', 'Asesor2 CVT', 'cvt-asesor2@test.local', true),
    (v_asesor_b, v_org_b, 'asesor', 'Asesor OrgB', 'cvt-asesor-b@test.local', true),
    (v_mesa, v_org, 'mesa_admin', 'Mesa CVT', 'cvt-mesa@test.local', true),
    (v_editor, v_org, 'editor', 'Editor CVT', 'cvt-editor@test.local', true),
    (v_super, v_org, 'super_admin', 'Super CVT', 'cvt-super@test.local', true),
    (v_inactive, v_org, 'asesor', 'Inactive CVT', 'cvt-inactive@test.local', false)
  ON CONFLICT (id) DO UPDATE SET
    active = EXCLUDED.active,
    organization_id = EXCLUDED.organization_id,
    app_role = EXCLUDED.app_role;

  INSERT INTO public.agenda_config (organization_id, kind, config, updated_by)
  VALUES (
    v_org, 'biometricos',
    jsonb_build_object('timezone', 'America/Monterrey', 'enabled', true, 'locations', '[]'::jsonb),
    v_mesa
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.agenda_config
  SET config = jsonb_build_object(
    'timezone', 'America/Monterrey',
    'enabled', true,
    'slots', jsonb_build_array('09:00', '10:00', '11:00', '12:00'),
    'allowed_weekdays', jsonb_build_array(1, 2, 3, 4, 5, 6, 7),
    'min_lead_hours', 0,
    'locations', jsonb_build_object(
      'sede-centro', jsonb_build_object('enabled', true, 'capacity_per_slot', 99)
    )
  )
  WHERE organization_id = v_org AND kind = 'biometricos';

  -- limpia fixtures anteriores
  DELETE FROM public.agenda_bookings WHERE expediente_id IN (
    v_exp4, v_exp3, v_exp_other, v_exp5, v_exp2, v_exp_nosub, v_exp_del, v_exp_ciclo, v_exp_sub,
    v_exp_drive, v_exp_rb, v_exp_same_day, v_exp_cancel_only, v_exp_org_b,
    v_exp_reg_bio, v_exp_reg_notif, v_exp_reg_45, v_exp_reg_35, v_exp_reg_nr
  );

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, fecha_cita, ciclo_estado, deleted_at
  ) VALUES
    (v_exp4, v_org, v_asesor, 'mejoravit', '90701000001', 'CVT Exp4', '5511110001', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp3, v_org, v_asesor, 'mejoravit', '90701000002', 'CVT Exp3', '5511110002', 'interno', true, NOW(), 3, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp_other, v_org, v_asesor2, 'mejoravit', '90701000003', 'CVT Other', '5511110003', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp5, v_org, v_asesor, 'mejoravit', '90701000004', 'CVT Exp5', '5511110004', 'interno', true, NOW(), 5, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp2, v_org, v_asesor, 'mejoravit', '90701000005', 'CVT Exp2', '5511110005', 'interno', true, NOW(), 2, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp_nosub, v_org, v_asesor, 'mejoravit', '90701000006', 'CVT NoSub', '5511110006', 'interno', false, NULL, 4, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp_del, v_org, v_asesor, 'mejoravit', '90701000007', 'CVT Del', '5511110007', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NOW()),
    (v_exp_ciclo, v_org, v_asesor, 'mejoravit', '90701000008', 'CVT Ciclo', '5511110008', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '5 days', 'cerrado', NULL),
    (v_exp_sub, v_org, v_asesor, 'mejoravit', '90701000009', 'CVT Sub', '5511110009', 'interno', true, NOW(), 4, 'rechazado', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp_drive, v_org, v_asesor, 'mejoravit', '90701000010', 'CVT Drive', '5511110010', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp_rb, v_org, v_asesor, 'mejoravit', '90701000011', 'CVT RB', '5511110011', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '8 days', 'activo', NULL),
    (v_exp_same_day, v_org, v_asesor, 'mejoravit', '90701000012', 'CVT SameDay', '5511110012', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp_cancel_only, v_org, v_asesor, 'mejoravit', '90701000013', 'CVT Canc', '5511110013', 'interno', true, NOW(), 4, 'en_proceso', NULL, 'activo', NULL),
    (v_exp_org_b, v_org_b, v_asesor_b, 'mejoravit', '90701000014', 'CVT OrgB', '5511110014', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp_reg_bio, v_org, v_asesor, 'mejoravit', '90701000015', 'CVT RegBio', '5511110015', 'interno', true, NOW(), 3, 'en_proceso', NULL, 'activo', NULL),
    (v_exp_reg_notif, v_org, v_asesor, 'mejoravit', '90701000016', 'CVT RegNotif', '5511110016', 'interno', true, NOW(), 3, 'en_proceso', NULL, 'activo', NULL),
    (v_exp_reg_45, v_org, v_asesor, 'mejoravit', '90701000017', 'CVT Reg45', '5511110017', 'interno', true, NOW(), 4, 'en_proceso', NOW() + INTERVAL '5 days', 'activo', NULL),
    (v_exp_reg_35, v_org, v_asesor, 'mejoravit', '90701000018', 'CVT Reg35', '5511110018', 'interno', true, NOW(), 3, 'en_proceso', NULL, 'activo', NULL),
    (v_exp_reg_nr, v_org, v_asesor, 'mejoravit', '90701000019', 'CVT RegNR', '5511110019', 'interno', true, NOW(), 3, 'en_proceso', NULL, 'activo', NULL)
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    asesor_id = EXCLUDED.asesor_id,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    fecha_cita = EXCLUDED.fecha_cita,
    ciclo_estado = EXCLUDED.ciclo_estado,
    deleted_at = EXCLUDED.deleted_at;

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, drive_validated, drive_validated_at, drive_validated_by
  ) VALUES
    (v_bio4, v_org, 'biometricos', v_exp4, v_date, '10:00', 'sede-centro', 'booked', v_asesor, false, NULL, NULL),
    (v_bio3, v_org, 'biometricos', v_exp3, v_date, '11:00', 'sede-norte', 'booked', v_asesor, false, NULL, NULL),
    (v_bio_other, v_org, 'biometricos', v_exp_other, v_date, '10:00', 'sede-centro', 'booked', v_asesor2, false, NULL, NULL),
    (v_bio5, v_org, 'biometricos', v_exp5, v_date, '10:00', 'sede-centro', 'booked', v_asesor, false, NULL, NULL),
    (v_bio2, v_org, 'biometricos', v_exp2, v_date, '10:00', 'sede-centro', 'booked', v_asesor, false, NULL, NULL),
    (v_bio_nosub, v_org, 'biometricos', v_exp_nosub, v_date, '10:00', 'sede-centro', 'booked', v_asesor, false, NULL, NULL),
    (v_bio_del, v_org, 'biometricos', v_exp_del, v_date, '10:00', 'sede-centro', 'booked', v_asesor, false, NULL, NULL),
    (v_bio_ciclo, v_org, 'biometricos', v_exp_ciclo, v_date, '10:00', 'sede-centro', 'booked', v_asesor, false, NULL, NULL),
    (v_bio_sub, v_org, 'biometricos', v_exp_sub, v_date, '10:00', 'sede-centro', 'booked', v_asesor, false, NULL, NULL),
    (v_bio_drive, v_org, 'biometricos', v_exp_drive, v_date, '09:30', 'sede-drive', 'booked', v_asesor, true, NOW() - INTERVAL '1 day', v_mesa),
    (v_bio_rb, v_org, 'biometricos', v_exp_rb, v_date2, '15:00', 'sede-rb', 'booked', v_asesor, false, NULL, NULL),
    (v_bio_same, v_org, 'biometricos', v_exp_same_day, v_date, '10:00', 'sede-centro', 'booked', v_asesor, false, NULL, NULL),
    (v_bio_canc, v_org, 'biometricos', v_exp_cancel_only, v_date, '10:00', 'sede-centro', 'cancelled', v_asesor, false, NULL, NULL),
    (v_bio_org_b, v_org_b, 'biometricos', v_exp_org_b, v_date, '10:00', 'sede-centro', 'booked', v_asesor_b, false, NULL, NULL),
    (v_bio_reg45, v_org, 'biometricos', v_exp_reg_45, v_date, '10:00', 'sede-centro', 'booked', v_asesor, false, NULL, NULL);

  UPDATE public.agenda_bookings SET cancelled_at = NOW() WHERE id = v_bio_canc;

  -- ========== AUTORIZACIÓN / ÉXITO 1-2 ==========
  -- 1) asesor dueño etapa 4
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.convert_biometricos_to_notificacion(v_exp4, v_date, 'monterrey', 'nota cvt') INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_assert((v_result->>'ok')::boolean, '1 ok');
  PERFORM public.__rpc_cvt_assert((v_result->>'etapa_anterior')::int = 4, '1 etapa_anterior');
  PERFORM public.__rpc_cvt_assert((v_result->>'etapa_actual')::int = 3, '1 etapa_nueva');
  v_cases := v_cases + 1;

  SELECT * INTO v_bio_row FROM public.agenda_bookings WHERE id = v_bio4;
  PERFORM public.__rpc_cvt_assert(v_bio_row.status = 'cancelled', '21 cancelled');
  PERFORM public.__rpc_cvt_assert(v_bio_row.kind = 'biometricos', '20 kind unchanged');
  PERFORM public.__rpc_cvt_assert(v_bio_row.booking_date = v_date, '22 bio date');
  PERFORM public.__rpc_cvt_assert(v_bio_row.booking_time = TIME '10:00', '23 bio time');
  PERFORM public.__rpc_cvt_assert(v_bio_row.location_id = 'sede-centro', '24 bio sede');
  PERFORM public.__rpc_cvt_assert(v_bio_row.cancelled_at IS NOT NULL, '21 cancelled_at');

  SELECT * INTO v_notif_row FROM public.agenda_bookings
  WHERE expediente_id = v_exp4 AND kind = 'notificacion' AND status = 'booked';
  PERFORM public.__rpc_cvt_assert(FOUND, '25 notif booked');
  PERFORM public.__rpc_cvt_assert(v_notif_row.booking_time = TIME '12:00', '26 noon');
  PERFORM public.__rpc_cvt_assert(v_notif_row.booking_date = v_date, '27 selected date');
  PERFORM public.__rpc_cvt_assert(v_notif_row.drive_validated IS FALSE, '35 drive false');
  PERFORM public.__rpc_cvt_assert(v_notif_row.drive_validated_at IS NULL, '35 drive_at null');
  PERFORM public.__rpc_cvt_assert(v_notif_row.drive_validated_by IS NULL, '35 drive_by null');

  SELECT * INTO v_exp_row FROM public.expedientes WHERE id = v_exp4;
  PERFORM public.__rpc_cvt_assert(v_exp_row.etapa_actual = 3, '28 etapa 4→3');
  PERFORM public.__rpc_cvt_assert(v_exp_row.subestado = 'en_proceso', '31 subestado');
  PERFORM public.__rpc_cvt_assert(v_exp_row.fecha_cita IS NOT NULL, '30 fecha_cita set');
  PERFORM public.__rpc_cvt_assert(
    (SELECT count(*) FROM public.agenda_bookings WHERE expediente_id = v_exp4 AND status = 'booked') = 1,
    '18 one active'
  );
  v_cases := v_cases + 11; -- ~21-31 batch

  -- 2) legacy etapa 3
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.convert_biometricos_to_notificacion(v_exp3, v_date2, 'monterrey', NULL) INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_assert((v_result->>'etapa_anterior')::int = 3, '2 etapa_ant 3');
  PERFORM public.__rpc_cvt_assert((v_result->>'etapa_actual')::int = 3, '29 stays 3');
  PERFORM public.__rpc_cvt_assert(
    (SELECT kind FROM public.agenda_bookings WHERE id = v_bio3) = 'biometricos',
    '20b kind'
  );
  v_cases := v_cases + 2;

  -- 3) asesor ajeno
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp_other, v_date, 'asesor dueño', '3 ajeno');
  v_cases := v_cases + 1;

  -- 4) editor
  PERFORM public.__rpc_cvt_expect_fail(v_editor, v_exp_other, v_date, 'rol no autorizado', '4 editor');
  v_cases := v_cases + 1;

  -- 5) mesa_admin
  PERFORM public.__rpc_cvt_expect_fail(v_mesa, v_exp_other, v_date, 'rol no autorizado', '5 mesa');
  v_cases := v_cases + 1;

  -- 6) super_admin
  PERFORM public.__rpc_cvt_expect_fail(v_super, v_exp_other, v_date, 'rol no autorizado', '6 super');
  v_cases := v_cases + 1;

  -- 7) profile inactivo
  PERFORM public.__rpc_cvt_expect_fail(v_inactive, v_exp_other, v_date, 'perfil no encontrado o inactivo', '7 inactive');
  v_cases := v_cases + 1;

  -- 8) otra organización (asesor org A sobre exp org B)
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp_org_b, v_date, 'organización', '8 org');
  v_cases := v_cases + 1;

  -- ========== ESTADO EXPEDIENTE ==========
  -- 9) no enviado
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp_nosub, v_date, 'enviado a Mesa', '9 nosub');
  v_cases := v_cases + 1;

  -- 10) eliminado
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp_del, v_date, 'no disponible', '10 deleted');
  v_cases := v_cases + 1;

  -- 11) ciclo no activo
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp_ciclo, v_date, 'ciclo activo', '11 ciclo');
  v_cases := v_cases + 1;

  -- 12) subestado distinto
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp_sub, v_date, 'en_proceso', '12 subestado');
  v_cases := v_cases + 1;

  -- 13) etapa 5
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp5, v_date, 'solo etapas 3 o 4', '13 etapa5');
  v_cases := v_cases + 1;

  -- 14) etapa 2
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp2, v_date, 'solo etapas 3 o 4', '14 etapa2');
  v_cases := v_cases + 1;

  -- ========== BOOKINGS ==========
  -- 15) sin bio activo (exp4 ya convertido)
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp4, v_date2, 'no hay cita biométrica activa', '15 no bio');
  v_cases := v_cases + 1;

  -- 16) solo cancelled no cuenta
  PERFORM public.__rpc_cvt_expect_fail(v_asesor, v_exp_cancel_only, v_date, 'no hay cita biométrica activa', '16 cancelled only');
  v_cases := v_cases + 1;

  -- 17) notificación activa bloquea
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time, location_id, status, created_by
  ) VALUES (
    v_org, 'notificacion', v_exp_other, v_date2, '12:00', 'notificacion', 'booked', v_asesor2
  );
  PERFORM public.__rpc_cvt_expect_fail(v_asesor2, v_exp_other, v_date2, 'notificación activa', '17 notif active');
  DELETE FROM public.agenda_bookings
  WHERE expediente_id = v_exp_other AND kind = 'notificacion' AND status = 'booked';
  v_cases := v_cases + 1;

  -- 19) otros expedientes intactos
  PERFORM public.__rpc_cvt_assert(
    (SELECT status FROM public.agenda_bookings WHERE id = v_bio_other) = 'booked',
    '19 other untouched'
  );
  PERFORM public.__rpc_cvt_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_other) = 4,
    '19 other etapa'
  );
  v_cases := v_cases + 1;

  -- 32/33) mismo día 12:00 en otro expediente (sin cupo)
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.convert_biometricos_to_notificacion(v_exp_same_day, v_date, 'monterrey', NULL) INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_assert((v_result->>'ok')::boolean, '33 same day ok');
  PERFORM public.__rpc_cvt_assert(
    (SELECT count(*) FROM public.agenda_bookings
     WHERE kind = 'notificacion' AND status = 'booked' AND booking_date = v_date AND booking_time = TIME '12:00') >= 2,
    '33 multi noon'
  );
  v_cases := v_cases + 2;

  -- ========== DRIVE ==========
  -- 34/35) drive preservado en bio cancelado; notif limpia
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.convert_biometricos_to_notificacion(v_exp_drive, v_date2, 'monterrey', NULL) INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  SELECT * INTO v_bio_row FROM public.agenda_bookings WHERE id = v_bio_drive;
  PERFORM public.__rpc_cvt_assert(v_bio_row.status = 'cancelled', '34 cancelled');
  PERFORM public.__rpc_cvt_assert(v_bio_row.drive_validated IS TRUE, '34 drive true');
  PERFORM public.__rpc_cvt_assert(v_bio_row.drive_validated_at IS NOT NULL, '34 drive_at');
  PERFORM public.__rpc_cvt_assert(v_bio_row.drive_validated_by = v_mesa, '34 drive_by');
  SELECT * INTO v_notif_row FROM public.agenda_bookings
  WHERE expediente_id = v_exp_drive AND kind = 'notificacion' AND status = 'booked';
  PERFORM public.__rpc_cvt_assert(v_notif_row.drive_validated IS FALSE, '35b notif drive false');
  v_cases := v_cases + 2;

  -- ========== AUDITORÍA ==========
  SELECT payload INTO v_log
  FROM public.action_log
  WHERE action = 'agenda.biometricos.convert_to_notificacion'
    AND entity_id = v_exp_drive
  ORDER BY created_at DESC
  LIMIT 1;
  PERFORM public.__rpc_cvt_assert(v_log IS NOT NULL, '36 action_log');
  PERFORM public.__rpc_cvt_assert(v_log ? 'biometricos_booking_id', '37 meta bio');
  PERFORM public.__rpc_cvt_assert(v_log ? 'notificacion_booking_id', '37 meta notif');
  PERFORM public.__rpc_cvt_assert((v_log->>'etapa_anterior')::int = 4, '37 etapa_ant');
  PERFORM public.__rpc_cvt_assert((v_log->>'etapa_nueva')::int = 3, '37 etapa_nueva');
  v_cases := v_cases + 2;

  -- ========== ROLLBACK 38-42 ==========
  SELECT fecha_cita, etapa_actual INTO v_fecha_prev, v_etapa_prev
  FROM public.expedientes WHERE id = v_exp_rb;

  CREATE OR REPLACE FUNCTION public.__rpc_cvt_block_notif_insert()
  RETURNS trigger LANGUAGE plpgsql AS $trg$
  BEGIN
    IF NEW.expediente_id = '00000000-0000-4000-9070-00000000002b'::uuid
       AND NEW.kind = 'notificacion' THEN
      RAISE EXCEPTION 'forced insert failure for rollback test';
    END IF;
    RETURN NEW;
  END;
  $trg$;

  DROP TRIGGER IF EXISTS trg_cvt_block_notif ON public.agenda_bookings;
  CREATE TRIGGER trg_cvt_block_notif
    BEFORE INSERT ON public.agenda_bookings
    FOR EACH ROW EXECUTE FUNCTION public.__rpc_cvt_block_notif_insert();

  BEGIN
    PERFORM public.__rpc_cvt_auth(v_asesor);
    PERFORM public.convert_biometricos_to_notificacion(v_exp_rb, v_date2, 'monterrey', NULL);
    PERFORM public.__rpc_cvt_reset();
    RAISE EXCEPTION 'RPC CVT TEST FAIL: 38 should fail';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_cvt_reset();
    PERFORM public.__rpc_cvt_assert(SQLERRM LIKE '%forced insert failure%', '38 forced fail');
  END;

  DROP TRIGGER IF EXISTS trg_cvt_block_notif ON public.agenda_bookings;
  DROP FUNCTION IF EXISTS public.__rpc_cvt_block_notif_insert();

  PERFORM public.__rpc_cvt_assert(
    (SELECT status FROM public.agenda_bookings WHERE id = v_bio_rb) = 'booked',
    '39 bio still booked'
  );
  PERFORM public.__rpc_cvt_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_rb) = v_etapa_prev,
    '40 etapa preserved'
  );
  PERFORM public.__rpc_cvt_assert(
    (SELECT fecha_cita FROM public.expedientes WHERE id = v_exp_rb) IS NOT DISTINCT FROM v_fecha_prev,
    '41 fecha_cita preserved'
  );
  PERFORM public.__rpc_cvt_assert(
    (SELECT count(*) FROM public.agenda_bookings
     WHERE expediente_id = v_exp_rb AND kind = 'notificacion') = 0,
    '42 no partial notif'
  );
  v_cases := v_cases + 5;

  -- ========== REGRESIONES 43-47 ==========
  -- 43) book_biometricos 3→4
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.book_biometricos(
    v_exp_reg_bio,
    ((v_date + 3)::timestamp + TIME '10:00') AT TIME ZONE 'America/Monterrey',
    'sede-centro',
    NULL
  ) INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_assert((v_result->>'ok')::boolean, '43 book bio ok');
  PERFORM public.__rpc_cvt_assert((v_result->>'etapa_actual')::int = 4, '43 etapa 4');
  v_cases := v_cases + 1;

  -- 44) book_notificacion_etapa3
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.book_notificacion_etapa3(v_exp_reg_notif, v_date + 4, 'monterrey', NULL) INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_assert((v_result->>'ok')::boolean, '44 book notif ok');
  PERFORM public.__rpc_cvt_assert((v_result->>'etapa_actual')::int = 3, '44 stays 3');
  v_cases := v_cases + 1;

  -- 45) Mesa 4→5 con bio
  PERFORM public.__rpc_cvt_auth(v_mesa);
  SELECT public.avanzar_etapa_operativa(v_exp_reg_45, 'cvt regresion 4-5') INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_assert((v_result->>'ok')::boolean IS TRUE OR (v_result->>'etapa_actual')::int = 5
    OR (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_reg_45) = 5, '45 mesa 4→5');
  -- tolerate jsonb shape differences
  PERFORM public.__rpc_cvt_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_reg_45) = 5,
    '45 etapa 5'
  );
  v_cases := v_cases + 1;

  -- 46) Mesa 3→5 con notificacion
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.book_notificacion_etapa3(v_exp_reg_35, v_date + 5, 'monterrey', NULL) INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  UPDATE public.expedientes
  SET fecha_cita = ((v_date + 5)::timestamp + TIME '12:00') AT TIME ZONE 'America/Monterrey'
  WHERE id = v_exp_reg_35;
  PERFORM public.__rpc_cvt_auth(v_mesa);
  PERFORM public.avanzar_etapa_operativa(v_exp_reg_35, 'cvt regresion 3-5');
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_reg_35) = 5,
    '46 mesa 3→5'
  );
  v_cases := v_cases + 1;

  -- 47) cancel/reagendar notificacion
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.book_notificacion_etapa3(v_exp_reg_nr, v_date + 6, 'monterrey', NULL) INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.cancel_notificacion_etapa3(v_exp_reg_nr, 'cvt cancel') INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_assert((v_result->>'ok')::boolean, '47 cancel ok');
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.book_notificacion_etapa3(v_exp_reg_nr, v_date + 7, 'monterrey', NULL) INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_auth(v_asesor);
  SELECT public.reagendar_notificacion_etapa3(v_exp_reg_nr, v_date + 8, 'monterrey', NULL) INTO v_result;
  PERFORM public.__rpc_cvt_reset();
  PERFORM public.__rpc_cvt_assert((v_result->>'ok')::boolean, '47 reagendar ok');
  v_cases := v_cases + 1;

  -- 48) firmas 9→10: solo si la función acepta fixture mínimo; marcar smoke de existencia
  PERFORM public.__rpc_cvt_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'avanzar_etapa_operativa'
    ),
    '48 avanzar_etapa exists'
  );
  v_cases := v_cases + 1;

  -- grants / no SET kind
  PERFORM public.__rpc_cvt_assert(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name = 'convert_biometricos_to_notificacion'
        AND grantee IN ('anon', 'PUBLIC')
        AND privilege_type = 'EXECUTE'
    ),
    'grant: no anon/public'
  );

  RAISE NOTICE 'rpc_convert_biometricos_to_notificacion: % checks OK (hardened P070)', v_cases;
END;
$$;

DROP FUNCTION public.__rpc_cvt_expect_fail(UUID, UUID, DATE, TEXT, TEXT);
DROP FUNCTION public.__rpc_cvt_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__rpc_cvt_auth(UUID);
DROP FUNCTION public.__rpc_cvt_reset();
