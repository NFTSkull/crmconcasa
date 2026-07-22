-- ConCasa CRM — pruebas P071 rechazar_etapa_operativa
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p071_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P071 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p071_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p071_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p071_expect_fail(
  p_user UUID,
  p_expediente UUID,
  p_motivo TEXT,
  p_condicion public.biometricos_condicion,
  p_razon TEXT,
  p_booking UUID,
  p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p071_auth(p_user);
  BEGIN
    PERFORM public.rechazar_etapa_operativa(
      p_expediente, p_motivo, NULL, p_condicion, p_razon, p_booking
    );
    PERFORM public.__p071_reset();
    RAISE EXCEPTION 'P071 TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p071_reset();
    IF SQLERRM LIKE 'P071 TEST FAIL:%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE ('%' || p_code || '%') THEN
      RAISE EXCEPTION 'P071 TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9171-000000000001';
  v_asesor UUID := '00000000-0000-4000-9171-000000000011';
  v_mesa UUID := '00000000-0000-4000-9171-000000000012';
  v_editor UUID := '00000000-0000-4000-9171-000000000013';
  v_exp5 UUID := '00000000-0000-4000-9171-000000000021';
  v_exp6 UUID := '00000000-0000-4000-9171-000000000022';
  v_exp4 UUID := '00000000-0000-4000-9171-000000000023';
  v_exp_future UUID := '00000000-0000-4000-9171-000000000024';
  v_exp_cancel_before UUID := '00000000-0000-4000-9171-000000000025';
  v_exp_unknown UUID := '00000000-0000-4000-9171-000000000026';
  v_book5 UUID := '00000000-0000-4000-9171-000000000031';
  v_book6 UUID := '00000000-0000-4000-9171-000000000032';
  v_book_future UUID := '00000000-0000-4000-9171-000000000033';
  v_book_cancel_before UUID := '00000000-0000-4000-9171-000000000034';
  v_result JSONB;
  v_before RECORD;
  v_after RECORD;
  v_count INTEGER;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p071-org', 'P071 Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p071-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p071-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'p071-editor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES
    (v_asesor, v_org, 'p071-asesor@test.local', 'Asesor P071', 'asesor', true),
    (v_mesa, v_org, 'p071-mesa@test.local', 'Mesa P071', 'mesa_admin', true),
    (v_editor, v_org, 'p071-editor@test.local', 'Editor P071', 'editor', true);

  INSERT INTO public.agenda_config (organization_id, kind, config, updated_by)
  VALUES (
    v_org,
    'biometricos',
    '{"timezone":"America/Monterrey","enabled":true}'::JSONB,
    v_mesa
  );

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado, fecha_cita
  ) VALUES
    (v_exp5, v_org, v_asesor, 'mejoravit', '91710000001', 'Exp 5',
     '5517100001', 'interno', 'activo', true, NOW(), 5, 'en_proceso', NOW() - INTERVAL '2 days'),
    (v_exp6, v_org, v_asesor, 'mejoravit', '91710000002', 'Exp 6',
     '5517100002', 'interno', 'activo', true, NOW(), 6, 'en_proceso', NOW() - INTERVAL '3 days'),
    (v_exp4, v_org, v_asesor, 'mejoravit', '91710000003', 'Exp 4',
     '5517100003', 'interno', 'activo', true, NOW(), 4, 'en_proceso', NOW() - INTERVAL '1 day'),
    (v_exp_future, v_org, v_asesor, 'mejoravit', '91710000004', 'Exp Future',
     '5517100004', 'interno', 'activo', true, NOW(), 5, 'en_proceso', NOW() + INTERVAL '3 days'),
    (v_exp_cancel_before, v_org, v_asesor, 'mejoravit', '91710000005', 'Exp Cancel Before',
     '5517100005', 'interno', 'activo', true, NOW(), 5, 'en_proceso', NOW() - INTERVAL '1 day'),
    (v_exp_unknown, v_org, v_asesor, 'mejoravit', '91710000006', 'Exp Unknown',
     '5517100006', 'interno', 'activo', true, NOW(), 6, 'en_proceso', NULL);

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by, cancelled_at
  ) VALUES
    (v_book5, v_org, 'biometricos', v_exp5, CURRENT_DATE - 2, '10:00',
     'centro', 'booked', 'evidencia histórica', v_asesor, NULL),
    (v_book6, v_org, 'biometricos', v_exp6, CURRENT_DATE - 3, '10:00',
     'centro', 'cancelled', 'cancelación posterior', v_asesor, NOW() - INTERVAL '1 day'),
    (v_book_future, v_org, 'biometricos', v_exp_future, CURRENT_DATE + 3, '10:00',
     'centro', 'booked', 'futura', v_asesor, NULL),
    (v_book_cancel_before, v_org, 'biometricos', v_exp_cancel_before, CURRENT_DATE - 1, '10:00',
     'centro', 'cancelled', 'cancelada antes', v_asesor, NOW() - INTERVAL '5 days');

  SELECT e.fecha_cita, b.status, b.note
  INTO v_before
  FROM public.expedientes e
  JOIN public.agenda_bookings b ON b.id = v_book5
  WHERE e.id = v_exp5;

  PERFORM public.__p071_auth(v_mesa);
  SELECT public.rechazar_etapa_operativa(
    v_exp5,
    'Proceso detenido',
    'Reingreso permitido',
    'reutilizables',
    'Mesa confirma biométricos aprovechables',
    v_book5
  ) INTO v_result;
  PERFORM public.__p071_reset();

  PERFORM public.__p071_assert(v_result->>'biometricos_condicion' = 'reutilizables',
    'retorna condición reutilizables');

  SELECT e.fecha_cita, b.status, b.note
  INTO v_after
  FROM public.expedientes e
  JOIN public.agenda_bookings b ON b.id = v_book5
  WHERE e.id = v_exp5;

  PERFORM public.__p071_assert(
    v_after.fecha_cita IS NOT DISTINCT FROM v_before.fecha_cita,
    'conserva fecha_cita histórica'
  );
  PERFORM public.__p071_assert(
    v_after.status IS NOT DISTINCT FROM v_before.status
    AND v_after.note IS NOT DISTINCT FROM v_before.note,
    'conserva status y nota del booking histórico'
  );
  PERFORM public.__p071_assert(
    (SELECT subestado = 'rechazado' AND etapa_actual = 5
     FROM public.expedientes WHERE id = v_exp5),
    'rechaza sin cambiar etapa'
  );
  PERFORM public.__p071_assert(
    EXISTS (
      SELECT 1 FROM public.expediente_rechazos_operativos r
      WHERE r.id = (v_result->>'rechazo_id')::UUID
        AND r.expediente_id = v_exp5
        AND r.biometricos_booking_id = v_book5
        AND r.decidido_por = v_mesa
    ),
    'persiste decisión append-only'
  );
  PERFORM public.__p071_assert(
    EXISTS (
      SELECT 1 FROM public.action_log l
      WHERE l.entity_id = v_exp5
        AND l.action = 'expediente.rechazo_operativo'
    ),
    'escribe action_log'
  );

  -- Cancelado después de la cita sí puede respaldar un intento inválido.
  PERFORM public.__p071_auth(v_mesa);
  PERFORM public.rechazar_etapa_operativa(
    v_exp6, 'Biometría inválida', NULL, 'invalidos',
    'Mesa confirma intento inválido', v_book6
  );
  PERFORM public.__p071_reset();
  PERFORM public.__p071_assert(
    (SELECT status = 'cancelled' FROM public.agenda_bookings WHERE id = v_book6),
    'no reinterpreta booking cancelado posterior'
  );

  -- Sin intento formal, desconocida puede carecer de booking.
  PERFORM public.__p071_auth(v_mesa);
  PERFORM public.rechazar_etapa_operativa(
    v_exp_unknown, 'Sin evidencia suficiente', NULL, 'desconocida', NULL, NULL
  );
  PERFORM public.__p071_reset();

  PERFORM public.__p071_expect_fail(
    v_mesa, v_exp4, 'No procede', 'reutilizables', 'razón', NULL,
    'REENTRY_BOOKING_EVIDENCE_MISSING'
  );

  -- P108A: etapa 4 con desconocida ya es elegible (antes fallaba REENTRY_NOT_STAGE_5_OR_6).
  PERFORM public.__p071_auth(v_mesa);
  PERFORM public.rechazar_etapa_operativa(
    v_exp4, 'Rechazo etapa 4', NULL, 'desconocida', NULL, NULL
  );
  PERFORM public.__p071_reset();
  PERFORM public.__p071_assert(
    (SELECT subestado = 'rechazado' AND etapa_actual = 4
     FROM public.expedientes WHERE id = v_exp4),
    'P108A permite rechazo en etapa 4'
  );

  PERFORM public.__p071_expect_fail(
    v_mesa, v_exp_future, 'No procede', 'reutilizables', 'razón', v_book_future,
    'REENTRY_FUTURE_BOOKING_ACTIVE'
  );

  PERFORM public.__p071_expect_fail(
    v_mesa, v_exp_cancel_before, 'No procede', 'repetir', 'razón', v_book_cancel_before,
    'REENTRY_BOOKING_EVIDENCE_MISSING'
  );

  -- Editor no puede usar la RPC.
  PERFORM public.__p071_expect_fail(
    v_editor, v_exp_cancel_before, 'No procede', 'desconocida', NULL, NULL,
    'REENTRY_NOT_OWNER'
  );

  -- Las condiciones con intento exigen booking y razón no vacía.
  UPDATE public.expedientes SET subestado = 'en_proceso' WHERE id = v_exp_cancel_before;
  PERFORM public.__p071_expect_fail(
    v_mesa, v_exp_cancel_before, 'No procede', 'invalidos', ' ', NULL,
    'REENTRY_BOOKING_EVIDENCE_MISSING'
  );

  SELECT count(*) INTO v_count
  FROM public.expediente_rechazos_operativos
  WHERE expediente_id IN (v_exp5, v_exp6, v_exp_unknown);
  PERFORM public.__p071_assert(v_count = 3, 'crea exactamente tres rechazos válidos');

  RAISE NOTICE 'P071 SQL tests: 12 cases passed';
END;
$$;

ROLLBACK;
