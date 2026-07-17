-- ConCasa CRM — pruebas P075 gestión de firmas por Mesa
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p075_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P075 TEST FAIL: %', p_msg; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p075_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p075_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p075_slot(
  p_days INTEGER,
  p_hour INTEGER DEFAULT 10
)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_date DATE := (NOW() AT TIME ZONE 'America/Monterrey')::DATE + p_days;
BEGIN
  WHILE EXTRACT(ISODOW FROM v_date)::INTEGER > 5 LOOP
    v_date := v_date + 1;
  END LOOP;
  RETURN (v_date + make_time(p_hour, 0, 0)) AT TIME ZONE 'America/Monterrey';
END;
$$;

CREATE OR REPLACE FUNCTION public.__p075_call_book(
  p_user UUID, p_exp UUID, p_at TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__p075_auth(p_user);
  SELECT public.mesa_book_firmas(
    p_exp, p_at, 'America/Monterrey', 'p075-sede', 'Agenda Mesa'
  ) INTO v_result;
  PERFORM public.__p075_reset();
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.__p075_reset();
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p075_expect_book_fail(
  p_user UUID, p_exp UUID, p_at TIMESTAMPTZ, p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p075_auth(p_user);
  BEGIN
    PERFORM public.mesa_book_firmas(
      p_exp, p_at, 'America/Monterrey', 'p075-sede', 'Debe fallar'
    );
    PERFORM public.__p075_reset();
    RAISE EXCEPTION 'P075 TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p075_reset();
    IF SQLERRM LIKE 'P075 TEST FAIL:%' THEN RAISE; END IF;
    IF position(p_code IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'P075 TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p075_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss TEXT,
  p_etapa INTEGER, p_origen public.origen_mesa DEFAULT 'interno'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture P075',
    '5575000000', p_origen, 'activo', true, NOW(), p_etapa, 'en_proceso'
  );
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9075-000000000001';
  v_other_org UUID := '00000000-0000-4000-9075-000000000002';
  v_asesor UUID := '00000000-0000-4000-9075-000000000011';
  v_editor UUID := '00000000-0000-4000-9075-000000000012';
  v_admin UUID := '00000000-0000-4000-9075-000000000013';
  v_interno UUID := '00000000-0000-4000-9075-000000000014';
  v_externo UUID := '00000000-0000-4000-9075-000000000015';
  v_super UUID := '00000000-0000-4000-9075-000000000016';
  v_other_asesor UUID := '00000000-0000-4000-9075-000000000017';
  v_other_admin UUID := '00000000-0000-4000-9075-000000000018';

  v_admin9 UUID := '00000000-0000-4000-9075-000000000101';
  v_admin10 UUID := '00000000-0000-4000-9075-000000000102';
  v_int UUID := '00000000-0000-4000-9075-000000000103';
  v_ext UUID := '00000000-0000-4000-9075-000000000104';
  v_super_exp UUID := '00000000-0000-4000-9075-000000000105';
  v_wrong_stage UUID := '00000000-0000-4000-9075-000000000106';
  v_duplicate UUID := '00000000-0000-4000-9075-000000000107';
  v_move UUID := '00000000-0000-4000-9075-000000000108';
  v_original UUID := '00000000-0000-4000-9075-000000000109';
  v_cancel_admin UUID := '00000000-0000-4000-9075-000000000110';
  v_cancel_int UUID := '00000000-0000-4000-9075-000000000111';
  v_cancel_ext UUID := '00000000-0000-4000-9075-000000000112';
  v_cancel_super UUID := '00000000-0000-4000-9075-000000000113';
  v_hist_fecha UUID := '00000000-0000-4000-9075-000000000114';

  v_slot TIMESTAMPTZ := public.__p075_slot(7, 10);
  v_slot2 TIMESTAMPTZ := public.__p075_slot(8, 11);
  v_slot_hist TIMESTAMPTZ := public.__p075_slot(9, 10);
  v_result JSONB;
  v_booking UUID;
  v_fecha TIMESTAMPTZ;
  v_fecha_hist TIMESTAMPTZ := TIMESTAMPTZ '2025-01-15 16:00:00+00';
  v_fecha_after TIMESTAMPTZ;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active) VALUES
    (v_org, 'p075-org', 'P075 Org', true),
    (v_other_org, 'p075-other', 'P075 Other', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p075-asesor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'p075-editor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_admin, 'authenticated', 'authenticated', 'p075-admin@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_interno, 'authenticated', 'authenticated', 'p075-int@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_externo, 'authenticated', 'authenticated', 'p075-ext@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_super, 'authenticated', 'authenticated', 'p075-super@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_other_asesor, 'authenticated', 'authenticated', 'p075-other-a@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_other_admin, 'authenticated', 'authenticated', 'p075-other-m@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa,
    tipo_asesor_origen, active
  ) VALUES
    (v_asesor, v_org, 'p075-asesor@test.local', 'Asesor', 'asesor', NULL, 'interno', true),
    (v_editor, v_org, 'p075-editor@test.local', 'Editor', 'editor', NULL, NULL, true),
    (v_admin, v_org, 'p075-admin@test.local', 'Admin', 'mesa_admin', NULL, NULL, true),
    (v_interno, v_org, 'p075-int@test.local', 'Interno', 'mesa_interno', 'interno', NULL, true),
    (v_externo, v_org, 'p075-ext@test.local', 'Externo', 'mesa_externo', 'externo', NULL, true),
    (v_super, v_org, 'p075-super@test.local', 'Super', 'super_admin', NULL, NULL, true),
    (v_other_asesor, v_other_org, 'p075-other-a@test.local', 'Otro Asesor', 'asesor', NULL, 'interno', true),
    (v_other_admin, v_other_org, 'p075-other-m@test.local', 'Otro Admin', 'mesa_admin', NULL, NULL, true);

  INSERT INTO public.agenda_config (organization_id, kind, config, updated_by)
  VALUES
    (
      v_org, 'firmas',
      '{"enabled":true,"timezone":"America/Monterrey","min_lead_hours":1,"allowed_weekdays":[1,2,3,4,5],"slots":["10:00","11:00"],"locations":{"p075-sede":{"enabled":true,"capacity_per_slot":50}}}'::JSONB,
      v_admin
    ),
    (
      v_other_org, 'firmas',
      '{"enabled":true,"timezone":"America/Monterrey","min_lead_hours":1,"allowed_weekdays":[1,2,3,4,5],"slots":["10:00","11:00"],"locations":{"p075-sede":{"enabled":true,"capacity_per_slot":50}}}'::JSONB,
      v_other_admin
    );

  PERFORM public.__p075_insert_exp(v_admin9, v_org, v_asesor, '90750000101', 9);
  PERFORM public.__p075_insert_exp(v_admin10, v_org, v_asesor, '90750000102', 10);
  PERFORM public.__p075_insert_exp(v_int, v_org, v_asesor, '90750000103', 9, 'interno');
  PERFORM public.__p075_insert_exp(v_ext, v_org, v_asesor, '90750000104', 9, 'externo');
  PERFORM public.__p075_insert_exp(v_super_exp, v_other_org, v_other_asesor, '90750000105', 9);
  PERFORM public.__p075_insert_exp(v_wrong_stage, v_org, v_asesor, '90750000106', 8);
  PERFORM public.__p075_insert_exp(v_duplicate, v_org, v_asesor, '90750000107', 9);
  PERFORM public.__p075_insert_exp(v_move, v_org, v_asesor, '90750000108', 9);
  PERFORM public.__p075_insert_exp(v_original, v_org, v_asesor, '90750000109', 9);
  PERFORM public.__p075_insert_exp(v_cancel_admin, v_org, v_asesor, '90750000110', 9);
  PERFORM public.__p075_insert_exp(v_cancel_int, v_org, v_asesor, '90750000111', 9, 'interno');
  PERFORM public.__p075_insert_exp(v_cancel_ext, v_org, v_asesor, '90750000112', 9, 'externo');
  PERFORM public.__p075_insert_exp(v_cancel_super, v_other_org, v_other_asesor, '90750000113', 9);
  PERFORM public.__p075_insert_exp(v_hist_fecha, v_org, v_asesor, '90750000114', 9);
  -- P079: fecha_cita histórica sin booking activo no bloquea mesa_book_firmas.
  UPDATE public.expedientes
  SET fecha_cita = v_fecha_hist, updated_at = NOW()
  WHERE id = v_hist_fecha;

  -- Alta por todos los roles Mesa y etapas 9/10.
  v_result := public.__p075_call_book(v_admin, v_admin9, v_slot);
  PERFORM public.__p075_assert(v_result->>'etapa_actual' = '9', 'admin agenda etapa 9 sin mover');
  PERFORM public.__p075_call_book(v_admin, v_admin10, v_slot);
  PERFORM public.__p075_assert(
    (SELECT etapa_actual = 10 FROM public.expedientes WHERE id = v_admin10),
    'admin agenda etapa 10 sin cancelación previa y no mueve'
  );
  PERFORM public.__p075_call_book(v_interno, v_int, v_slot);
  PERFORM public.__p075_expect_book_fail(v_interno, v_ext, v_slot, 'MESA_SIGNATURE_NOT_VISIBLE');
  PERFORM public.__p075_call_book(v_externo, v_ext, v_slot);
  PERFORM public.__p075_expect_book_fail(v_externo, v_int, v_slot, 'MESA_SIGNATURE_NOT_VISIBLE');
  PERFORM public.__p075_call_book(v_super, v_super_exp, v_slot);

  -- Roles no Mesa, otra org, etapa y fecha inválida.
  PERFORM public.__p075_expect_book_fail(v_asesor, v_duplicate, v_slot, 'MESA_SIGNATURE_UNAUTHORIZED');
  PERFORM public.__p075_expect_book_fail(v_editor, v_duplicate, v_slot, 'MESA_SIGNATURE_UNAUTHORIZED');
  PERFORM public.__p075_expect_book_fail(v_other_admin, v_duplicate, v_slot, 'MESA_SIGNATURE_NOT_VISIBLE');
  PERFORM public.__p075_expect_book_fail(v_admin, v_wrong_stage, v_slot, 'MESA_SIGNATURE_BAD_STAGE');
  PERFORM public.__p075_expect_book_fail(v_admin, v_duplicate, NOW() - INTERVAL '1 hour', 'MESA_SIGNATURE_BAD_DATE');

  -- Doble booking.
  PERFORM public.__p075_call_book(v_admin, v_duplicate, v_slot);
  PERFORM public.__p075_expect_book_fail(v_admin, v_duplicate, v_slot2, 'MESA_SIGNATURE_ALREADY_BOOKED');

  -- Reagenda por admin, interno y externo; conserva etapa.
  PERFORM public.__p075_auth(v_admin);
  SELECT public.mesa_reagendar_firmas(
    v_admin9, v_slot2, 'America/Monterrey', 'p075-sede', 'Cambio admin'
  ) INTO v_result;
  PERFORM public.__p075_reset();
  PERFORM public.__p075_assert(
    (SELECT etapa_actual = 9 FROM public.expedientes WHERE id = v_admin9)
    AND (SELECT count(*) = 1 FROM public.agenda_bookings WHERE expediente_id = v_admin9 AND status = 'booked')
    AND (SELECT count(*) = 1 FROM public.agenda_bookings WHERE expediente_id = v_admin9 AND status = 'cancelled'),
    'reagenda admin es atómica y no cambia etapa'
  );

  PERFORM public.__p075_auth(v_interno);
  PERFORM public.mesa_reagendar_firmas(
    v_int, v_slot2, 'America/Monterrey', 'p075-sede', 'Cambio interno'
  );
  PERFORM public.__p075_reset();
  PERFORM public.__p075_auth(v_externo);
  PERFORM public.mesa_reagendar_firmas(
    v_ext, v_slot2, 'America/Monterrey', 'p075-sede', 'Cambio externo'
  );
  PERFORM public.__p075_reset();

  -- Cancelación explícita por los cuatro roles.
  PERFORM public.__p075_call_book(v_admin, v_cancel_admin, v_slot);
  PERFORM public.__p075_call_book(v_interno, v_cancel_int, v_slot);
  PERFORM public.__p075_call_book(v_externo, v_cancel_ext, v_slot);
  PERFORM public.__p075_call_book(v_super, v_cancel_super, v_slot);

  PERFORM public.__p075_auth(v_admin);
  PERFORM public.mesa_cancel_firmas(v_cancel_admin, 'Cancela admin');
  PERFORM public.__p075_reset();
  PERFORM public.__p075_auth(v_interno);
  PERFORM public.mesa_cancel_firmas(v_cancel_int, 'Cancela interno');
  PERFORM public.__p075_reset();
  PERFORM public.__p075_auth(v_externo);
  PERFORM public.mesa_cancel_firmas(v_cancel_ext, 'Cancela externo');
  PERFORM public.__p075_reset();
  PERFORM public.__p075_auth(v_super);
  PERFORM public.mesa_cancel_firmas(v_cancel_super, 'Cancela super');
  PERFORM public.__p075_reset();
  PERFORM public.__p075_assert(
    (SELECT bool_and(etapa_actual = 9) FROM public.expedientes
     WHERE id IN (v_cancel_admin, v_cancel_int, v_cancel_ext, v_cancel_super)),
    'cancelar nunca cambia etapa'
  );

  -- Movimiento manual fuera de 9/10 conserva booking y fecha; cancelación sigue explícita.
  v_result := public.__p075_call_book(v_admin, v_move, v_slot);
  v_booking := (v_result->>'booking_id')::UUID;
  SELECT fecha_cita INTO v_fecha FROM public.expedientes WHERE id = v_move;
  PERFORM public.__p075_auth(v_admin);
  PERFORM public.mesa_mover_etapa_operativa(
    v_move, 4::SMALLINT, 9::SMALLINT, 'Regreso con firma activa'
  );
  PERFORM public.__p075_reset();
  PERFORM public.__p075_assert(
    (SELECT status = 'booked' FROM public.agenda_bookings WHERE id = v_booking)
    AND (SELECT fecha_cita IS NOT DISTINCT FROM v_fecha AND etapa_actual = 4
         FROM public.expedientes WHERE id = v_move),
    'movimiento manual conserva booking y fecha_cita'
  );
  PERFORM public.__p075_auth(v_admin);
  PERFORM public.mesa_cancel_firmas(v_move, 'Cancelación explícita fuera de etapa');
  PERFORM public.__p075_reset();
  PERFORM public.__p075_assert(
    (SELECT status = 'cancelled' FROM public.agenda_bookings WHERE id = v_booking)
    AND (SELECT etapa_actual = 4 FROM public.expedientes WHERE id = v_move),
    'cancelación explícita funciona fuera de 9/10 sin mover etapa'
  );

  -- Flujo original del asesor sigue vigente; interno no gana acceso a RPC compartida.
  PERFORM public.__p075_auth(v_asesor);
  PERFORM public.book_firmas(v_original, v_slot, 'p075-sede', 'Flujo asesor');
  PERFORM public.__p075_reset();
  PERFORM public.__p075_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings
      WHERE expediente_id = v_original AND kind = 'firmas' AND status = 'booked'
    ),
    'book_firmas original del asesor funciona'
  );

  PERFORM public.__p075_auth(v_interno);
  BEGIN
    PERFORM public.book_firmas(v_wrong_stage, v_slot, 'p075-sede', 'No autorizado');
    PERFORM public.__p075_reset();
    RAISE EXCEPTION 'P075 TEST FAIL: book_firmas original permitió mesa_interno';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p075_reset();
    IF SQLERRM LIKE 'P075 TEST FAIL:%' THEN RAISE; END IF;
    IF position('rol no autorizado' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'P075 TEST FAIL: error original inesperado: %', SQLERRM;
    END IF;
  END;

  -- P079/P080: etapa 9 + fecha_cita histórica + sin booking → Mesa puede agendar.
  PERFORM public.__p075_assert(
    (SELECT fecha_cita = v_fecha_hist AND etapa_actual = 9 FROM public.expedientes WHERE id = v_hist_fecha)
    AND NOT EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_hist_fecha AND b.kind = 'firmas' AND b.status = 'booked'
    ),
    'fixture histórica: etapa 9, fecha previa, sin booking'
  );
  v_result := public.__p075_call_book(v_admin, v_hist_fecha, v_slot_hist);
  SELECT fecha_cita INTO v_fecha_after FROM public.expedientes WHERE id = v_hist_fecha;
  PERFORM public.__p075_assert(
    (v_result->>'ok')::boolean = true
    AND (SELECT count(*) = 1 FROM public.agenda_bookings
         WHERE expediente_id = v_hist_fecha AND kind = 'firmas' AND status = 'booked')
    AND (SELECT count(*) = 0 FROM public.agenda_bookings
         WHERE expediente_id = v_hist_fecha AND kind = 'firmas' AND status = 'booked'
           AND id IS DISTINCT FROM (v_result->>'booking_id')::UUID)
    AND v_fecha_after IS NOT DISTINCT FROM v_slot_hist
    AND (SELECT etapa_actual = 9 FROM public.expedientes WHERE id = v_hist_fecha),
    'P079: fecha_cita histórica no bloquea mesa_book_firmas; un booking y fecha normalizada'
  );
  PERFORM public.__p075_expect_book_fail(v_admin, v_hist_fecha, v_slot2, 'MESA_SIGNATURE_ALREADY_BOOKED');

  PERFORM public.__p075_assert(
    EXISTS (
      SELECT 1 FROM public.action_log
      WHERE action IN (
        'agenda.firmas.mesa_book',
        'agenda.firmas.mesa_reagendar',
        'agenda.firmas.mesa_cancel'
      )
    ),
    'operaciones Mesa escriben action_log'
  );
  PERFORM public.__p075_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'convert_biometricos_to_notificacion'
    ),
    'P070 permanece intacta'
  );
END;
$$;

ROLLBACK;

\echo 'P075 mesa_gestion_firmas: OK'
