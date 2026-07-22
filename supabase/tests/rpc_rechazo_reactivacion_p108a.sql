-- ConCasa CRM — P108A: rechazo 1–12 + reactivar_expediente_rechazado
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p108a_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P108A TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p108a_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p108a_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p108a_expect_rechazo_fail(
  p_user UUID,
  p_expediente UUID,
  p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p108a_auth(p_user);
  BEGIN
    PERFORM public.rechazar_etapa_operativa(
      p_expediente, 'Motivo prueba', NULL, 'desconocida', NULL, NULL
    );
    PERFORM public.__p108a_reset();
    RAISE EXCEPTION 'P108A TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p108a_reset();
    IF SQLERRM LIKE 'P108A TEST FAIL:%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE ('%' || p_code || '%') THEN
      RAISE EXCEPTION 'P108A TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p108a_expect_reactivar_fail(
  p_user UUID,
  p_expediente UUID,
  p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p108a_auth(p_user);
  BEGIN
    PERFORM public.reactivar_expediente_rechazado(p_expediente);
    PERFORM public.__p108a_reset();
    RAISE EXCEPTION 'P108A TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p108a_reset();
    IF SQLERRM LIKE 'P108A TEST FAIL:%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE ('%' || p_code || '%') THEN
      RAISE EXCEPTION 'P108A TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9188-000000000001';
  v_asesor UUID := '00000000-0000-4000-9188-000000000011';
  v_asesor2 UUID := '00000000-0000-4000-9188-000000000014';
  v_mesa UUID := '00000000-0000-4000-9188-000000000012';
  v_editor UUID := '00000000-0000-4000-9188-000000000013';
  v_exp UUID;
  v_etapa SMALLINT;
  v_result JSONB;
  v_bookings_before INTEGER;
  v_bookings_after INTEGER;
  v_docs_before INTEGER;
  v_docs_after INTEGER;
  v_rechazo_id UUID;
  v_sub TEXT;
  v_cancel_exp UUID := '00000000-0000-4000-9188-000000000099';
  v_book UUID := '00000000-0000-4000-9188-000000000031';
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p108a-org', 'P108A Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p108a-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor2, 'authenticated', 'authenticated', 'p108a-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p108a-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'p108a-editor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES
    (v_asesor, v_org, 'p108a-asesor@test.local', 'Asesor P108A', 'asesor', true),
    (v_asesor2, v_org, 'p108a-asesor2@test.local', 'Asesor2 P108A', 'asesor', true),
    (v_mesa, v_org, 'p108a-mesa@test.local', 'Mesa P108A', 'mesa_admin', true),
    (v_editor, v_org, 'p108a-editor@test.local', 'Editor P108A', 'editor', true);

  INSERT INTO public.agenda_config (organization_id, kind, config, updated_by)
  VALUES (
    v_org,
    'biometricos',
    '{"timezone":"America/Monterrey","enabled":true}'::JSONB,
    v_mesa
  );

  -- Rechazo + reactivación en internas 1–12
  FOR v_etapa IN 1..12 LOOP
    v_exp := (
      '00000000-0000-4000-9188-0000000001'
      || lpad(v_etapa::TEXT, 2, '0')
    )::UUID;

    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
      fecha_envio_mesa, etapa_actual, subestado, fecha_cita
    ) VALUES (
      v_exp, v_org, v_asesor, 'mejoravit',
      '918800000' || lpad(v_etapa::TEXT, 2, '0'),
      'Exp etapa ' || v_etapa,
      '55188000' || lpad(v_etapa::TEXT, 2, '0'),
      'interno', 'activo', true, NOW(), v_etapa,
      CASE WHEN v_etapa = 1 THEN 'en_validacion_mesa'::public.operativo_subestado
           ELSE 'en_proceso'::public.operativo_subestado END,
      NOW() - INTERVAL '2 days'
    );

    INSERT INTO public.agenda_bookings (
      id, organization_id, kind, expediente_id, booking_date, booking_time,
      location_id, status, note, created_by, cancelled_at
    ) VALUES (
      (
        '00000000-0000-4000-9188-0000000002'
        || lpad(v_etapa::TEXT, 2, '0')
      )::UUID,
      v_org,
      'biometricos',
      v_exp,
      CURRENT_DATE - 2,
      '10:00',
      'centro',
      'booked',
      'booking intacto',
      v_asesor,
      NULL
    );

    INSERT INTO public.expediente_documentos (
      id, organization_id, expediente_id, tipo_documento, storage_path,
      nombre_original, mime_type, size_bytes, version, estatus_revision,
      uploaded_by, uploaded_by_role
    ) VALUES (
      (
        '00000000-0000-4000-9188-0000000003'
        || lpad(v_etapa::TEXT, 2, '0')
      )::UUID,
      v_org,
      v_exp,
      'cliente_ine_frente',
      'org/' || v_org::TEXT || '/exp/' || v_exp::TEXT || '/ine.pdf',
      'ine.pdf',
      'application/pdf',
      1024,
      1,
      'validado',
      v_asesor,
      'asesor'
    );

    SELECT COUNT(*)::INTEGER INTO v_bookings_before
    FROM public.agenda_bookings WHERE expediente_id = v_exp;
    SELECT COUNT(*)::INTEGER INTO v_docs_before
    FROM public.expediente_documentos
    WHERE expediente_id = v_exp AND deleted_at IS NULL;

    PERFORM public.__p108a_auth(v_mesa);
    SELECT public.rechazar_etapa_operativa(
      v_exp, 'Motivo etapa ' || v_etapa, 'Nota ' || v_etapa, 'desconocida', NULL, NULL
    ) INTO v_result;
    PERFORM public.__p108a_reset();

    PERFORM public.__p108a_assert(v_result->>'ok' = 'true', 'rechazo ok etapa ' || v_etapa);
    PERFORM public.__p108a_assert(
      (v_result->>'etapa')::SMALLINT = v_etapa,
      'rechazo conserva etapa ' || v_etapa
    );
    PERFORM public.__p108a_assert(
      (SELECT subestado = 'rechazado' AND etapa_actual = v_etapa
         AND ciclo_estado = 'activo'
         AND motivo_rechazo = 'Motivo etapa ' || v_etapa
         AND comentario_rechazo = 'Nota ' || v_etapa
       FROM public.expedientes WHERE id = v_exp),
      'expediente rechazado vigente etapa ' || v_etapa
    );

    v_rechazo_id := (v_result->>'rechazo_id')::UUID;
    PERFORM public.__p108a_assert(
      EXISTS (
        SELECT 1 FROM public.expediente_rechazos_operativos r
        WHERE r.id = v_rechazo_id
          AND r.etapa = v_etapa
          AND r.motivo = 'Motivo etapa ' || v_etapa
          AND r.comentario = 'Nota ' || v_etapa
          AND r.biometricos_condicion = 'desconocida'
      ),
      'historial rechazo etapa ' || v_etapa
    );

    -- Doble rechazo
    PERFORM public.__p108a_expect_rechazo_fail(v_mesa, v_exp, 'REENTRY_NOT_REJECTED');

    -- Reactivación por asesor propietario
    PERFORM public.__p108a_auth(v_asesor);
    SELECT public.reactivar_expediente_rechazado(v_exp) INTO v_result;
    PERFORM public.__p108a_reset();

    v_sub := CASE WHEN v_etapa = 1 THEN 'en_validacion_mesa' ELSE 'en_proceso' END;
    PERFORM public.__p108a_assert(v_result->>'ok' = 'true', 'reactivación ok etapa ' || v_etapa);
    PERFORM public.__p108a_assert(
      (v_result->>'etapa')::SMALLINT = v_etapa
      AND v_result->>'subestado' = v_sub
      AND v_result->>'rechazo_id' = v_rechazo_id::TEXT,
      'reactivación estado canónico etapa ' || v_etapa
    );
    PERFORM public.__p108a_assert(
      (SELECT subestado::TEXT = v_sub
            AND etapa_actual = v_etapa
            AND ciclo_estado = 'activo'
            AND motivo_rechazo IS NULL
            AND comentario_rechazo IS NULL
       FROM public.expedientes WHERE id = v_exp),
      'expediente reactivado etapa ' || v_etapa
    );
    PERFORM public.__p108a_assert(
      EXISTS (
        SELECT 1 FROM public.expediente_rechazos_operativos r
        WHERE r.id = v_rechazo_id AND r.motivo = 'Motivo etapa ' || v_etapa
      ),
      'conserva historial rechazo tras reactivación etapa ' || v_etapa
    );
    PERFORM public.__p108a_assert(
      EXISTS (
        SELECT 1 FROM public.expediente_rechazo_reactivaciones x
        WHERE x.rechazo_id = v_rechazo_id
          AND x.expediente_id = v_exp
          AND x.etapa = v_etapa
          AND x.subestado_nuevo::TEXT = v_sub
          AND x.reactivado_por = v_asesor
      ),
      'traza reactivación etapa ' || v_etapa
    );
    PERFORM public.__p108a_assert(
      EXISTS (
        SELECT 1 FROM public.action_log l
        WHERE l.entity_id = v_exp
          AND l.action = 'expediente.rechazo_reactivacion'
          AND (l.payload->>'rechazo_id') = v_rechazo_id::TEXT
      ),
      'action_log reactivación etapa ' || v_etapa
    );

    SELECT COUNT(*)::INTEGER INTO v_bookings_after
    FROM public.agenda_bookings WHERE expediente_id = v_exp;
    SELECT COUNT(*)::INTEGER INTO v_docs_after
    FROM public.expediente_documentos
    WHERE expediente_id = v_exp AND deleted_at IS NULL;
    PERFORM public.__p108a_assert(
      v_bookings_before = v_bookings_after AND v_docs_before = v_docs_after,
      'citas/docs intactos etapa ' || v_etapa
    );

    -- Doble reactivación (ya no rechazado)
    PERFORM public.__p108a_expect_reactivar_fail(v_asesor, v_exp, 'REACTIVATION_NOT_REJECTED');
  END LOOP;

  -- Cancelado no se rechaza ni reactiva
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado
  ) VALUES (
    v_cancel_exp, v_org, v_asesor, 'mejoravit', '91880000099', 'Exp cancelado',
    '5518800099', 'interno', 'cancelado', true, NOW(), 5, 'en_proceso'
  );

  PERFORM public.__p108a_expect_rechazo_fail(v_mesa, v_cancel_exp, 'REENTRY_CYCLE_NOT_ACTIVE');
  PERFORM public.__p108a_expect_reactivar_fail(v_asesor, v_cancel_exp, 'REACTIVATION_CYCLE_NOT_ACTIVE');

  -- Permisos: editor no; otro asesor no
  v_exp := '00000000-0000-4000-9188-000000000105'::UUID;
  UPDATE public.expedientes
  SET subestado = 'en_proceso', motivo_rechazo = NULL, comentario_rechazo = NULL
  WHERE id = v_exp;

  PERFORM public.__p108a_auth(v_mesa);
  PERFORM public.rechazar_etapa_operativa(
    v_exp, 'Solo mesa', NULL, 'desconocida', NULL, NULL
  );
  PERFORM public.__p108a_reset();

  PERFORM public.__p108a_expect_reactivar_fail(v_editor, v_exp, 'REACTIVATION_UNAUTHORIZED');
  PERFORM public.__p108a_expect_reactivar_fail(v_asesor2, v_exp, 'REACTIVATION_UNAUTHORIZED');

  -- Mesa admin sí puede reactivar
  PERFORM public.__p108a_auth(v_mesa);
  SELECT public.reactivar_expediente_rechazado(v_exp) INTO v_result;
  PERFORM public.__p108a_reset();
  PERFORM public.__p108a_assert(v_result->>'ok' = 'true', 'mesa puede reactivar');

  -- P072 intacto: rechazo reutilizables en 5 sigue disponible vía RPC P071 (sin reactivar aquí)
  v_exp := '00000000-0000-4000-9188-000000000205'::UUID;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado, fecha_cita
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91880000205', 'Exp P072',
    '5518800205', 'interno', 'activo', true, NOW(), 5, 'en_proceso',
    NOW() - INTERVAL '3 days'
  );
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    v_book, v_org, 'biometricos', v_exp, CURRENT_DATE - 3, '11:00',
    'centro', 'booked', 'evidencia p072', v_asesor
  );

  PERFORM public.__p108a_auth(v_mesa);
  SELECT public.rechazar_etapa_operativa(
    v_exp, 'P072 path', NULL, 'reutilizables', 'evidencia ok', v_book
  ) INTO v_result;
  PERFORM public.__p108a_reset();
  PERFORM public.__p108a_assert(
    v_result->>'biometricos_condicion' = 'reutilizables'
    AND (SELECT subestado = 'rechazado' AND etapa_actual = 5 FROM public.expedientes WHERE id = v_exp),
    'P071/P072 rechazo reutilizables en 5 intacto'
  );

  -- Función P072 de elegibilidad sigue existiendo y no depende de reactivación
  PERFORM public.__p108a_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'iniciar_reingreso_post_biometricos'
    ),
    'P072 RPC iniciar_reingreso intacta'
  );

  RAISE NOTICE 'P108A OK: rechazo+reactivación 1–12, cancelados bloqueados, P072 intacto';
END;
$$;

ROLLBACK;
