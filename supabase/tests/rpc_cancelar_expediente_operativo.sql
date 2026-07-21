-- ConCasa CRM — pruebas P094 B1 cancelar_expediente_operativo
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p094_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P094 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p094_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p094_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p094_expect_fail(
  p_user UUID,
  p_expediente UUID,
  p_motivo TEXT,
  p_comentario TEXT,
  p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p094_auth(p_user);
  BEGIN
    PERFORM public.cancelar_expediente_operativo(p_expediente, p_motivo, p_comentario);
    PERFORM public.__p094_reset();
    RAISE EXCEPTION 'P094 TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p094_reset();
    IF SQLERRM LIKE 'P094 TEST FAIL:%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE ('%' || p_code || '%') THEN
      RAISE EXCEPTION 'P094 TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9094-000000000001';
  v_org2 UUID := '00000000-0000-4000-9094-000000000002';
  v_asesor UUID := '00000000-0000-4000-9094-000000000011';
  v_mesa UUID := '00000000-0000-4000-9094-000000000012';
  v_editor UUID := '00000000-0000-4000-9094-000000000013';
  v_asesor2 UUID := '00000000-0000-4000-9094-000000000014';
  v_mesa2 UUID := '00000000-0000-4000-9094-000000000015';
  v_exp UUID := '00000000-0000-4000-9094-000000000021';
  v_exp_rechazado UUID := '00000000-0000-4000-9094-000000000022';
  v_exp_gates UUID := '00000000-0000-4000-9094-000000000023';
  v_exp_nosub UUID := '00000000-0000-4000-9094-000000000024';
  v_exp_cerrado UUID := '00000000-0000-4000-9094-000000000025';
  v_exp_other_org UUID := '00000000-0000-4000-9094-000000000026';
  v_exp_dup UUID := '00000000-0000-4000-9094-000000000027';
  v_book UUID := '00000000-0000-4000-9094-000000000031';
  v_book_rechazo UUID := '00000000-0000-4000-9094-000000000032';
  v_book_gates UUID := '00000000-0000-4000-9094-000000000033';
  v_result JSONB;
  v_before RECORD;
  v_after RECORD;
  v_count INTEGER;
  v_cancelacion_id UUID;
  v_subestado_prev public.operativo_subestado;
  v_etapa_prev SMALLINT;
  v_long TEXT;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES
    (v_org, 'p094-org', 'P094 Org', true),
    (v_org2, 'p094-org-2', 'P094 Org 2', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p094-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p094-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'p094-editor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor2, 'authenticated', 'authenticated', 'p094-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa2, 'authenticated', 'authenticated', 'p094-mesa2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES
    (v_asesor, v_org, 'p094-asesor@test.local', 'Asesor P094', 'asesor', true),
    (v_mesa, v_org, 'p094-mesa@test.local', 'Mesa P094', 'mesa_admin', true),
    (v_editor, v_org, 'p094-editor@test.local', 'Editor P094', 'editor', true),
    (v_asesor2, v_org2, 'p094-asesor2@test.local', 'Asesor P094 Org2', 'asesor', true),
    (v_mesa2, v_org2, 'p094-mesa2@test.local', 'Mesa P094 Org2', 'mesa_admin', true);

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
    (v_exp, v_org, v_asesor, 'mejoravit', '90940000001', 'Exp Cancel Happy',
     '5509400001', 'interno', 'activo', true, NOW(), 7, 'en_proceso', NOW() - INTERVAL '2 days'),
    (v_exp_rechazado, v_org, v_asesor, 'mejoravit', '90940000002', 'Exp Ya Rechazado',
     '5509400002', 'interno', 'activo', true, NOW(), 5, 'en_proceso', NOW() - INTERVAL '2 days'),
    (v_exp_gates, v_org, v_asesor, 'mejoravit', '90940000003', 'Exp Gates',
     '5509400003', 'interno', 'activo', true, NOW(), 5, 'en_proceso', NOW() - INTERVAL '1 day'),
    (v_exp_nosub, v_org, v_asesor, 'mejoravit', '90940000004', 'Exp No Enviado',
     '5509400004', 'interno', 'activo', false, NULL, 3, 'pendiente', NULL),
    (v_exp_cerrado, v_org, v_asesor, 'mejoravit', '90940000005', 'Exp Ciclo Cerrado',
     '5509400005', 'interno', 'cerrado', true, NOW(), 6, 'en_proceso', NULL),
    (v_exp_other_org, v_org2, v_asesor2, 'mejoravit', '90940000006', 'Exp Otra Org',
     '5509400006', 'interno', 'activo', true, NOW(), 4, 'en_proceso', NULL),
    (v_exp_dup, v_org, v_asesor, 'mejoravit', '90940000007', 'Exp Dup Cancel',
     '5509400007', 'interno', 'activo', true, NOW(), 8, 'en_proceso', NULL);

  -- Rechazo previo canónico (para cancelar sobre rechazado + reingreso).
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by, cancelled_at
  ) VALUES
    (v_book, v_org, 'biometricos', v_exp, CURRENT_DATE - 2, '10:00',
     'centro', 'booked', 'cita viva P094', v_asesor, NULL),
    (v_book_rechazo, v_org, 'biometricos', v_exp_rechazado, CURRENT_DATE - 2, '11:00',
     'centro', 'booked', 'evidencia rechazo', v_asesor, NULL),
    (v_book_gates, v_org, 'biometricos', v_exp_gates, CURRENT_DATE - 1, '09:00',
     'centro', 'booked', 'gates booking', v_asesor, NULL);

  PERFORM public.__p094_auth(v_mesa);
  PERFORM public.rechazar_etapa_operativa(
    v_exp_rechazado,
    'Rechazo previo P094',
    NULL,
    'reutilizables',
    'Condición documentada',
    v_book_rechazo
  );
  PERFORM public.__p094_reset();

  PERFORM public.__p094_assert(
    (SELECT subestado = 'rechazado' AND ciclo_estado = 'activo'
     FROM public.expedientes WHERE id = v_exp_rechazado),
    'fixture rechazo canónico activo'
  );

  -- Snapshot bookings antes del happy path.
  SELECT
    e.fecha_cita,
    e.subestado,
    e.etapa_actual,
    e.ciclo_estado,
    b.status,
    b.note,
    b.cancelled_at,
    (SELECT COUNT(*)::INTEGER FROM public.agenda_bookings x WHERE x.expediente_id = v_exp) AS book_count
  INTO v_before
  FROM public.expedientes e
  JOIN public.agenda_bookings b ON b.id = v_book
  WHERE e.id = v_exp;

  v_subestado_prev := v_before.subestado;
  v_etapa_prev := v_before.etapa_actual;

  -- 1) Happy path
  PERFORM public.__p094_auth(v_mesa);
  SELECT public.cancelar_expediente_operativo(
    v_exp, 'Cliente no continúa', 'Abandono confirmado'
  ) INTO v_result;
  PERFORM public.__p094_reset();

  PERFORM public.__p094_assert(COALESCE((v_result->>'ok')::BOOLEAN, false), 'ok true');
  PERFORM public.__p094_assert(v_result->>'ciclo_estado' = 'cancelado', 'response ciclo cancelado');
  PERFORM public.__p094_assert(v_result->>'subestado' = v_subestado_prev::TEXT, 'response conserva subestado');
  PERFORM public.__p094_assert((v_result->>'etapa')::SMALLINT = v_etapa_prev, 'response conserva etapa');

  v_cancelacion_id := (v_result->>'cancelacion_id')::UUID;

  SELECT
    e.fecha_cita,
    e.subestado,
    e.etapa_actual,
    e.ciclo_estado,
    b.status,
    b.note,
    b.cancelled_at,
    (SELECT COUNT(*)::INTEGER FROM public.agenda_bookings x WHERE x.expediente_id = v_exp) AS book_count
  INTO v_after
  FROM public.expedientes e
  JOIN public.agenda_bookings b ON b.id = v_book
  WHERE e.id = v_exp;

  PERFORM public.__p094_assert(v_after.ciclo_estado = 'cancelado', 'persiste ciclo cancelado');
  PERFORM public.__p094_assert(v_after.subestado = v_subestado_prev, 'no muta subestado a rechazado');
  PERFORM public.__p094_assert(v_after.etapa_actual = v_etapa_prev, 'no muta etapa');
  PERFORM public.__p094_assert(
    v_after.fecha_cita IS NOT DISTINCT FROM v_before.fecha_cita,
    'conserva fecha_cita'
  );
  PERFORM public.__p094_assert(
    v_after.status IS NOT DISTINCT FROM v_before.status
    AND v_after.note IS NOT DISTINCT FROM v_before.note
    AND v_after.cancelled_at IS NOT DISTINCT FROM v_before.cancelled_at
    AND v_after.book_count = v_before.book_count,
    'no muta bookings (status/note/cancelled_at/count)'
  );

  PERFORM public.__p094_assert(
    EXISTS (
      SELECT 1 FROM public.expediente_cancelaciones c
      WHERE c.id = v_cancelacion_id
        AND c.expediente_id = v_exp
        AND c.motivo = 'Cliente no continúa'
        AND c.comentario = 'Abandono confirmado'
        AND c.decidido_por = v_mesa
        AND c.etapa = v_etapa_prev
        AND c.subestado_anterior = v_subestado_prev
    ),
    'persiste fila append-only'
  );

  PERFORM public.__p094_assert(
    EXISTS (
      SELECT 1 FROM public.action_log l
      WHERE l.entity_id = v_exp
        AND l.action = 'expediente.cancelacion_operativa'
        AND (l.payload->>'cancelacion_id')::UUID = v_cancelacion_id
        AND (l.payload->>'sin_efectos_agenda')::BOOLEAN IS TRUE
    ),
    'escribe action_log'
  );

  PERFORM public.__p094_assert(
    NOT EXISTS (
      SELECT 1 FROM public.expediente_rechazos_operativos r
      WHERE r.expediente_id = v_exp
    ),
    'no crea rechazo operativo'
  );

  -- 2) Idempotencia / ya cancelado
  PERFORM public.__p094_expect_fail(
    v_mesa, v_exp, 'Otra vez', NULL, 'MESA_CANCEL_EXP_ALREADY_CANCELLED'
  );

  -- 3) Cancelar expediente ya rechazado (permitido) → reingreso inelegible
  PERFORM public.__p094_auth(v_mesa);
  SELECT public.cancelar_expediente_operativo(
    v_exp_rechazado, 'Cliente abandona tras rechazo', NULL
  ) INTO v_result;
  PERFORM public.__p094_reset();

  PERFORM public.__p094_assert(
    (SELECT ciclo_estado = 'cancelado' AND subestado = 'rechazado'
     FROM public.expedientes WHERE id = v_exp_rechazado),
    'cancelado conserva subestado rechazado'
  );
  PERFORM public.__p094_assert(
    (SELECT status FROM public.agenda_bookings WHERE id = v_book_rechazo) = 'booked',
    'booking de rechazo intacto tras cancelar'
  );
  PERFORM public.__p094_assert(
    (SELECT COUNT(*) FROM public.expediente_rechazos_operativos
     WHERE expediente_id = v_exp_rechazado) = 1,
    'no agrega rechazo al cancelar'
  );

  PERFORM public.__p094_auth(v_asesor);
  BEGIN
    PERFORM public.iniciar_reingreso_post_biometricos(v_exp_rechazado, NULL);
    PERFORM public.__p094_reset();
    RAISE EXCEPTION 'P094 TEST FAIL: se esperaba REENTRY_CYCLE_NOT_ACTIVE';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p094_reset();
    IF SQLERRM LIKE 'P094 TEST FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%REENTRY_CYCLE_NOT_ACTIVE%' THEN
      RAISE EXCEPTION 'P094 TEST FAIL: esperaba REENTRY_CYCLE_NOT_ACTIVE, recibió %', SQLERRM;
    END IF;
  END;

  -- 4) Gates post-cancelación sobre expediente dedicado
  PERFORM public.__p094_auth(v_mesa);
  PERFORM public.cancelar_expediente_operativo(v_exp_gates, 'Cierre terminal gates', NULL);
  PERFORM public.__p094_reset();

  PERFORM public.__p094_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_gates, NULL);
    PERFORM public.__p094_reset();
    RAISE EXCEPTION 'P094 TEST FAIL: se esperaba fallo avance';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p094_reset();
    IF SQLERRM LIKE 'P094 TEST FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%ciclo activo%' THEN
      RAISE EXCEPTION 'P094 TEST FAIL: avance debía fallar por ciclo, recibió %', SQLERRM;
    END IF;
  END;

  PERFORM public.__p094_auth(v_mesa);
  BEGIN
    PERFORM public.mesa_mover_etapa_operativa(v_exp_gates, 6::SMALLINT, 5::SMALLINT, 'intento');
    PERFORM public.__p094_reset();
    RAISE EXCEPTION 'P094 TEST FAIL: se esperaba MESA_MOVE_CYCLE_NOT_ACTIVE';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p094_reset();
    IF SQLERRM LIKE 'P094 TEST FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%MESA_MOVE_CYCLE_NOT_ACTIVE%' THEN
      RAISE EXCEPTION 'P094 TEST FAIL: esperaba MESA_MOVE_CYCLE_NOT_ACTIVE, recibió %', SQLERRM;
    END IF;
  END;

  PERFORM public.__p094_auth(v_mesa);
  BEGIN
    PERFORM public.rechazar_etapa_operativa(
      v_exp_gates, 'No', NULL, 'desconocida', NULL, NULL
    );
    PERFORM public.__p094_reset();
    RAISE EXCEPTION 'P094 TEST FAIL: se esperaba REENTRY_CYCLE_NOT_ACTIVE en rechazo';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p094_reset();
    IF SQLERRM LIKE 'P094 TEST FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%REENTRY_CYCLE_NOT_ACTIVE%' THEN
      RAISE EXCEPTION 'P094 TEST FAIL: rechazo post-cancel debía fallar ciclo, recibió %', SQLERRM;
    END IF;
  END;

  PERFORM public.__p094_auth(v_asesor);
  BEGIN
    PERFORM public.book_biometricos(
      v_exp_gates,
      (NOW() + INTERVAL '3 days'),
      'centro',
      NULL
    );
    PERFORM public.__p094_reset();
    RAISE EXCEPTION 'P094 TEST FAIL: se esperaba fallo book_biometricos';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p094_reset();
    IF SQLERRM LIKE 'P094 TEST FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%ciclo activo%' THEN
      RAISE EXCEPTION 'P094 TEST FAIL: book debía fallar por ciclo, recibió %', SQLERRM;
    END IF;
  END;

  PERFORM public.__p094_assert(
    (SELECT status FROM public.agenda_bookings WHERE id = v_book_gates) = 'booked',
    'booking gates intacto tras intentos bloqueados'
  );

  -- 5) Validaciones de entrada / auth / estado
  PERFORM public.__p094_expect_fail(
    v_mesa, v_exp_nosub, 'Motivo', NULL, 'MESA_CANCEL_EXP_NOT_SUBMITTED'
  );
  PERFORM public.__p094_expect_fail(
    v_mesa, v_exp_cerrado, 'Motivo', NULL, 'MESA_CANCEL_EXP_CYCLE_NOT_ACTIVE'
  );
  PERFORM public.__p094_expect_fail(
    v_mesa, NULL, 'Motivo', NULL, 'MESA_CANCEL_EXP_NOT_FOUND'
  );
  PERFORM public.__p094_expect_fail(
    v_mesa, '00000000-0000-4000-9094-000000009999', 'Motivo', NULL,
    'MESA_CANCEL_EXP_NOT_FOUND'
  );
  PERFORM public.__p094_expect_fail(
    v_mesa, v_exp_dup, '   ', NULL, 'MESA_CANCEL_EXP_REASON_REQUIRED'
  );
  PERFORM public.__p094_expect_fail(
    v_editor, v_exp_dup, 'Motivo', NULL, 'MESA_CANCEL_EXP_UNAUTHORIZED'
  );
  PERFORM public.__p094_expect_fail(
    v_asesor, v_exp_dup, 'Motivo', NULL, 'MESA_CANCEL_EXP_UNAUTHORIZED'
  );
  PERFORM public.__p094_expect_fail(
    v_mesa, v_exp_other_org, 'Motivo', NULL, 'MESA_CANCEL_EXP_UNAUTHORIZED'
  );

  v_long := repeat('x', 501);
  PERFORM public.__p094_expect_fail(
    v_mesa, v_exp_dup, v_long, NULL, 'MESA_CANCEL_EXP_REASON_TOO_LONG'
  );
  v_long := repeat('y', 2001);
  PERFORM public.__p094_expect_fail(
    v_mesa, v_exp_dup, 'Motivo ok', v_long, 'MESA_CANCEL_EXP_COMMENT_TOO_LONG'
  );

  -- 6) RLS: SELECT visible; INSERT directo denegado
  PERFORM public.__p094_auth(v_mesa);
  SELECT COUNT(*) INTO v_count
  FROM public.expediente_cancelaciones
  WHERE expediente_id = v_exp;
  PERFORM public.__p094_reset();
  PERFORM public.__p094_assert(v_count = 1, 'mesa puede leer cancelaciones visibles');

  PERFORM public.__p094_auth(v_mesa);
  BEGIN
    INSERT INTO public.expediente_cancelaciones (
      organization_id, expediente_id, etapa, subestado_anterior,
      motivo, decidido_por, decidido_por_rol
    ) VALUES (
      v_org, v_exp_dup, 8, 'en_proceso', 'bypass', v_mesa, 'mesa_admin'
    );
    PERFORM public.__p094_reset();
    RAISE EXCEPTION 'P094 TEST FAIL: INSERT directo debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p094_reset();
    IF SQLERRM LIKE 'P094 TEST FAIL:%' THEN RAISE; END IF;
  END;

  PERFORM public.__p094_assert(
    NOT EXISTS (
      SELECT 1 FROM public.expediente_cancelaciones WHERE expediente_id = v_exp_dup
    ),
    'sin fila por INSERT directo'
  );

  -- Cancelación válida residual del expediente dup (sanity final)
  PERFORM public.__p094_auth(v_mesa);
  PERFORM public.cancelar_expediente_operativo(v_exp_dup, 'Cierre final fixture', NULL);
  PERFORM public.__p094_reset();

  SELECT COUNT(*) INTO v_count
  FROM public.expediente_cancelaciones
  WHERE expediente_id IN (v_exp, v_exp_rechazado, v_exp_gates, v_exp_dup);
  PERFORM public.__p094_assert(v_count = 4, 'exactamente cuatro cancelaciones válidas');

  RAISE NOTICE 'P094 SQL tests: cancelar_expediente_operativo OK';
END;
$$;

ROLLBACK;
