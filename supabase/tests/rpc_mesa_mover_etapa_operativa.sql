-- ConCasa CRM — pruebas P074 mesa_mover_etapa_operativa
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p074_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P074 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p074_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p074_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p074_call(
  p_user UUID,
  p_expediente UUID,
  p_destino INTEGER,
  p_esperada INTEGER,
  p_motivo TEXT
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__p074_auth(p_user);
  SELECT public.mesa_mover_etapa_operativa(
    p_expediente, p_destino::SMALLINT, p_esperada::SMALLINT, p_motivo
  ) INTO v_result;
  PERFORM public.__p074_reset();
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.__p074_reset();
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p074_expect_fail(
  p_user UUID,
  p_expediente UUID,
  p_destino INTEGER,
  p_esperada INTEGER,
  p_motivo TEXT,
  p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p074_auth(p_user);
  BEGIN
    PERFORM public.mesa_mover_etapa_operativa(
      p_expediente, p_destino::SMALLINT, p_esperada::SMALLINT, p_motivo
    );
    PERFORM public.__p074_reset();
    RAISE EXCEPTION 'P074 TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p074_reset();
    IF SQLERRM LIKE 'P074 TEST FAIL:%' THEN
      RAISE;
    END IF;
    IF position(p_code IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'P074 TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p074_insert_exp(
  p_id UUID,
  p_org UUID,
  p_asesor UUID,
  p_nss TEXT,
  p_etapa INTEGER,
  p_subestado public.operativo_subestado DEFAULT 'en_proceso',
  p_origen public.origen_mesa DEFAULT 'interno',
  p_submitted BOOLEAN DEFAULT true,
  p_ciclo public.expediente_ciclo_estado DEFAULT 'activo',
  p_deleted TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado, deleted_at
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture P074',
    '5574000000', p_origen, p_ciclo, p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, p_subestado, p_deleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.__p074_force_action_log_failure()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'mesa.expediente.mover_etapa' THEN
    RAISE EXCEPTION 'P074_FORCED_ROLLBACK';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9074-000000000001';
  v_other_org UUID := '00000000-0000-4000-9074-000000000002';
  v_asesor UUID := '00000000-0000-4000-9074-000000000011';
  v_editor UUID := '00000000-0000-4000-9074-000000000012';
  v_mesa UUID := '00000000-0000-4000-9074-000000000013';
  v_interno UUID := '00000000-0000-4000-9074-000000000014';
  v_externo UUID := '00000000-0000-4000-9074-000000000015';
  v_super UUID := '00000000-0000-4000-9074-000000000016';
  v_inactivo UUID := '00000000-0000-4000-9074-000000000017';
  v_other_mesa UUID := '00000000-0000-4000-9074-000000000018';

  v_exp_main UUID := '00000000-0000-4000-9074-000000000101';
  v_exp_int UUID := '00000000-0000-4000-9074-000000000102';
  v_exp_ext UUID := '00000000-0000-4000-9074-000000000103';
  v_exp_other UUID := '00000000-0000-4000-9074-000000000104';
  v_exp_not_sent UUID := '00000000-0000-4000-9074-000000000105';
  v_exp_closed UUID := '00000000-0000-4000-9074-000000000106';
  v_exp_cancelled UUID := '00000000-0000-4000-9074-000000000107';
  v_exp_rejected UUID := '00000000-0000-4000-9074-000000000108';
  v_exp_approved UUID := '00000000-0000-4000-9074-000000000109';
  v_exp_pending UUID := '00000000-0000-4000-9074-000000000110';
  v_exp_double UUID := '00000000-0000-4000-9074-000000000111';
  v_exp_rollback UUID := '00000000-0000-4000-9074-000000000112';
  v_exp_normal_gate UUID := '00000000-0000-4000-9074-000000000113';
  v_parent UUID := '00000000-0000-4000-9074-000000000114';
  v_exp_rich UUID := '00000000-0000-4000-9074-000000000115';

  v_doc UUID := '00000000-0000-4000-9074-000000000201';
  v_revision UUID := '00000000-0000-4000-9074-000000000202';
  v_booking UUID := '00000000-0000-4000-9074-000000000203';
  v_rechazo UUID := '00000000-0000-4000-9074-000000000204';
  v_result JSONB;
  v_before_exp JSONB;
  v_before_booking JSONB;
  v_before_doc JSONB;
  v_before_revision JSONB;
  v_before_editor JSONB;
  v_before_cliente JSONB;
  v_before_retencion JSONB;
  v_before_rechazo JSONB;
  v_p070_hash TEXT;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active) VALUES
    (v_org, 'p074-org', 'P074 Org', true),
    (v_other_org, 'p074-other', 'P074 Other Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p074-asesor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'p074-editor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p074-mesa@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_interno, 'authenticated', 'authenticated', 'p074-int@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_externo, 'authenticated', 'authenticated', 'p074-ext@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_super, 'authenticated', 'authenticated', 'p074-super@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_inactivo, 'authenticated', 'authenticated', 'p074-inactive@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_other_mesa, 'authenticated', 'authenticated', 'p074-other-mesa@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p074-asesor@test.local', 'Asesor P074', 'asesor', NULL, true),
    (v_editor, v_org, 'p074-editor@test.local', 'Editor P074', 'editor', NULL, true),
    (v_mesa, v_org, 'p074-mesa@test.local', 'Mesa P074', 'mesa_admin', NULL, true),
    (v_interno, v_org, 'p074-int@test.local', 'Mesa Interno P074', 'mesa_interno', 'interno', true),
    (v_externo, v_org, 'p074-ext@test.local', 'Mesa Externo P074', 'mesa_externo', 'externo', true),
    (v_super, v_org, 'p074-super@test.local', 'Super P074', 'super_admin', NULL, true),
    (v_inactivo, v_org, 'p074-inactive@test.local', 'Inactivo P074', 'mesa_admin', NULL, false),
    (v_other_mesa, v_other_org, 'p074-other-mesa@test.local', 'Otra Mesa P074', 'mesa_admin', NULL, true);

  PERFORM public.__p074_insert_exp(v_exp_main, v_org, v_asesor, '90740000101', 1, 'en_validacion_mesa');
  PERFORM public.__p074_insert_exp(v_exp_int, v_org, v_asesor, '90740000102', 4, 'en_proceso', 'interno');
  PERFORM public.__p074_insert_exp(v_exp_ext, v_org, v_asesor, '90740000103', 4, 'en_proceso', 'externo');
  PERFORM public.__p074_insert_exp(v_exp_other, v_other_org, v_other_mesa, '90740000104', 3);
  PERFORM public.__p074_insert_exp(v_exp_not_sent, v_org, v_asesor, '90740000105', 2, 'en_proceso', 'interno', false);
  PERFORM public.__p074_insert_exp(v_exp_closed, v_org, v_asesor, '90740000106', 6, 'en_proceso', 'interno', true, 'cerrado');
  PERFORM public.__p074_insert_exp(v_exp_cancelled, v_org, v_asesor, '90740000107', 6, 'en_proceso', 'interno', true, 'cancelado');
  PERFORM public.__p074_insert_exp(v_exp_rejected, v_org, v_asesor, '90740000108', 5, 'rechazado');
  PERFORM public.__p074_insert_exp(v_exp_approved, v_org, v_asesor, '90740000109', 10, 'aprobado');
  PERFORM public.__p074_insert_exp(v_exp_pending, v_org, v_asesor, '90740000110', 1, 'pendiente');
  PERFORM public.__p074_insert_exp(v_exp_double, v_org, v_asesor, '90740000111', 2);
  PERFORM public.__p074_insert_exp(v_exp_rollback, v_org, v_asesor, '90740000112', 3);
  PERFORM public.__p074_insert_exp(v_exp_normal_gate, v_org, v_asesor, '90740000113', 1, 'en_validacion_mesa');

  -- Avance sin documentos, retroceso, salto y subestado derivado.
  v_result := public.__p074_call(v_mesa, v_exp_main, 2, 1, 'Avance manual sin documentos');
  PERFORM public.__p074_assert(v_result->>'direccion' = 'avance', 'clasifica avance');
  PERFORM public.__p074_assert(
    (SELECT etapa_actual = 2 AND subestado = 'en_proceso' FROM public.expedientes WHERE id = v_exp_main),
    'avance manual no exige documentos y fija en_proceso'
  );

  v_result := public.__p074_call(v_mesa, v_exp_main, 1, 2, 'Retroceso manual');
  PERFORM public.__p074_assert(v_result->>'direccion' = 'retroceso', 'clasifica retroceso');
  PERFORM public.__p074_assert(
    (SELECT etapa_actual = 1 AND subestado = 'en_validacion_mesa' FROM public.expedientes WHERE id = v_exp_main),
    'destino 1 fija en_validacion_mesa'
  );

  v_result := public.__p074_call(v_mesa, v_exp_main, 11, 1, 'Salto a firmado sin side effects');
  PERFORM public.__p074_assert(v_result->>'direccion' = 'salto', 'clasifica salto');
  PERFORM public.__p074_assert(
    (SELECT etapa_actual = 11 AND subestado = 'en_proceso' FROM public.expedientes WHERE id = v_exp_main),
    'permite etapa 11 sin firma'
  );
  PERFORM public.__p074_call(v_mesa, v_exp_main, 12, 11, 'Posición manual de pago');
  PERFORM public.__p074_assert(
    (SELECT etapa_actual = 12 AND ciclo_estado = 'activo' FROM public.expedientes WHERE id = v_exp_main),
    'permite etapa 12 sin cerrar ciclo ni registrar pago'
  );

  -- Matriz de roles/origen/organización.
  PERFORM public.__p074_call(v_interno, v_exp_int, 5, 4, 'Interno visible');
  PERFORM public.__p074_expect_fail(v_interno, v_exp_ext, 5, 4, 'No visible', 'MESA_MOVE_NOT_VISIBLE');
  PERFORM public.__p074_call(v_externo, v_exp_ext, 5, 4, 'Externo visible');
  PERFORM public.__p074_expect_fail(v_externo, v_exp_int, 6, 5, 'No visible', 'MESA_MOVE_NOT_VISIBLE');
  PERFORM public.__p074_call(v_super, v_exp_other, 8, 3, 'Super cross-org');
  PERFORM public.__p074_expect_fail(v_asesor, v_exp_main, 2, 12, 'No autorizado', 'MESA_MOVE_UNAUTHORIZED');
  PERFORM public.__p074_expect_fail(v_editor, v_exp_main, 2, 12, 'No autorizado', 'MESA_MOVE_UNAUTHORIZED');
  PERFORM public.__p074_expect_fail(v_inactivo, v_exp_main, 2, 12, 'No autorizado', 'MESA_MOVE_UNAUTHORIZED');
  PERFORM public.__p074_expect_fail(v_other_mesa, v_exp_main, 2, 12, 'Otra org', 'MESA_MOVE_NOT_VISIBLE');

  -- Estados y validaciones de entrada.
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_not_sent, 3, 2, 'No enviado', 'MESA_MOVE_NOT_SUBMITTED');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_closed, 7, 6, 'Cerrado', 'MESA_MOVE_CYCLE_NOT_ACTIVE');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_cancelled, 7, 6, 'Cancelado', 'MESA_MOVE_CYCLE_NOT_ACTIVE');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_rejected, 6, 5, 'Rechazado', 'MESA_MOVE_BAD_SUBSTATE');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_approved, 11, 10, 'Aprobado', 'MESA_MOVE_BAD_SUBSTATE');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_pending, 2, 1, 'Pendiente', 'MESA_MOVE_BAD_SUBSTATE');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_main, 0, 12, 'Destino 0', 'MESA_MOVE_BAD_DESTINATION');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_main, 13, 12, 'Destino 13', 'MESA_MOVE_BAD_DESTINATION');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_main, 12, 12, 'Misma', 'MESA_MOVE_SAME_STAGE');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_main, 2, 12, ' ', 'MESA_MOVE_REASON_REQUIRED');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_main, 2, 12, repeat('x', 501), 'MESA_MOVE_REASON_TOO_LONG');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_main, 2, 11, 'Pantalla obsoleta', 'MESA_MOVE_STAGE_CONFLICT');

  -- Doble request: el segundo usa etapa esperada obsoleta y no duplica evento.
  PERFORM public.__p074_call(v_mesa, v_exp_double, 7, 2, 'Primer request');
  PERFORM public.__p074_expect_fail(v_mesa, v_exp_double, 7, 2, 'Segundo request', 'MESA_MOVE_STAGE_CONFLICT');
  PERFORM public.__p074_assert(
    (SELECT count(*) = 1 FROM public.expediente_movimientos_mesa WHERE expediente_id = v_exp_double),
    'doble request produce un solo evento'
  );

  -- Fixture rico: preserva datos, decisiones, cobro, retención, docs, booking y reingreso.
  PERFORM public.__p074_insert_exp(v_parent, v_org, v_asesor, '90740000114', 5, 'rechazado', 'interno', true, 'cerrado');
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol
  ) VALUES (
    v_rechazo, v_org, v_parent, 5, 'en_proceso', 'Fixture histórico',
    'desconocida', v_mesa, 'mesa_admin'
  );

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado, fecha_cita,
    expediente_anterior_id, reingreso_rechazo_id
  ) VALUES (
    v_exp_rich, v_org, v_asesor, 'subcuenta', '90740000115', 'Fixture rico',
    '5574000115', 'interno', 'activo', true, NOW(), 9, 'en_proceso',
    NOW() + INTERVAL '10 days', v_parent, v_rechazo
  );

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    v_booking, v_org, 'firmas', v_exp_rich, CURRENT_DATE + 10,
    '10:00', 'p074-sede', 'booked', 'No cancelar', v_mesa
  );

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_doc, v_org, v_exp_rich, 'cliente_ine_frente',
    v_org || '/' || v_exp_rich || '/cliente_ine_frente/fixture.pdf',
    'fixture.pdf', 'application/pdf', 10, 1, 'validado', v_asesor, 'asesor'
  );

  INSERT INTO public.documento_revisiones (
    id, organization_id, documento_id, expediente_id, estatus_anterior,
    estatus_nuevo, comentario_mesa, actor_id
  ) VALUES (
    v_revision, v_org, v_doc, v_exp_rich, 'subido', 'validado',
    'Validado antes', v_mesa
  );

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado,
    notas_revision, decided_by
  ) VALUES (
    v_exp_rich, v_org, 'aprobado', 123456.78, 'Conservar', v_editor
  );

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, porcentaje_cobro,
    monto_calculado, metodo_pago, updated_by
  ) VALUES (
    v_exp_rich, v_org, '{"rfc":"P074010101AA1","plazo":24}'::JSONB,
    'validado', 12.50, 15432.10, 'transferencia', v_asesor
  );

  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, opcion, estado
  ) VALUES (
    v_exp_rich, v_org, true, 'con_sello', 'enviado'
  );

  SELECT to_jsonb(e) - ARRAY['etapa_actual', 'subestado', 'updated_at']
  INTO v_before_exp FROM public.expedientes e WHERE e.id = v_exp_rich;
  SELECT to_jsonb(b) INTO v_before_booking FROM public.agenda_bookings b WHERE b.id = v_booking;
  SELECT to_jsonb(d) INTO v_before_doc FROM public.expediente_documentos d WHERE d.id = v_doc;
  SELECT to_jsonb(r) INTO v_before_revision FROM public.documento_revisiones r WHERE r.id = v_revision;
  SELECT to_jsonb(ed) INTO v_before_editor FROM public.editor_decisions ed WHERE ed.expediente_id = v_exp_rich;
  SELECT to_jsonb(cd) INTO v_before_cliente FROM public.cliente_datos cd WHERE cd.expediente_id = v_exp_rich;
  SELECT to_jsonb(re) INTO v_before_retencion FROM public.retencion_envios re WHERE re.expediente_id = v_exp_rich;
  SELECT to_jsonb(ro) INTO v_before_rechazo FROM public.expediente_rechazos_operativos ro WHERE ro.id = v_rechazo;

  v_result := public.__p074_call(v_mesa, v_exp_rich, 3, 9, 'Retroceso preservando todo');
  PERFORM public.__p074_assert(
    (SELECT to_jsonb(e) - ARRAY['etapa_actual', 'subestado', 'updated_at'] = v_before_exp
     FROM public.expedientes e WHERE e.id = v_exp_rich),
    'solo cambia etapa, subestado y updated_at del expediente'
  );
  PERFORM public.__p074_assert(
    (SELECT to_jsonb(b) = v_before_booking FROM public.agenda_bookings b WHERE b.id = v_booking),
    'preserva booking y fecha de booking'
  );
  PERFORM public.__p074_assert(
    (SELECT to_jsonb(d) = v_before_doc FROM public.expediente_documentos d WHERE d.id = v_doc)
    AND (SELECT to_jsonb(r) = v_before_revision FROM public.documento_revisiones r WHERE r.id = v_revision),
    'preserva documentos y revisiones'
  );
  PERFORM public.__p074_assert(
    (SELECT to_jsonb(ed) = v_before_editor FROM public.editor_decisions ed WHERE ed.expediente_id = v_exp_rich)
    AND (SELECT to_jsonb(cd) = v_before_cliente FROM public.cliente_datos cd WHERE cd.expediente_id = v_exp_rich),
    'preserva editor, monto, cobro y cliente_datos'
  );
  PERFORM public.__p074_assert(
    (SELECT to_jsonb(re) = v_before_retencion FROM public.retencion_envios re WHERE re.expediente_id = v_exp_rich)
    AND (SELECT to_jsonb(ro) = v_before_rechazo FROM public.expediente_rechazos_operativos ro WHERE ro.id = v_rechazo),
    'preserva retención y rechazo 071'
  );
  PERFORM public.__p074_assert(
    (SELECT fecha_cita IS NOT NULL
       AND expediente_anterior_id = v_parent
       AND reingreso_rechazo_id = v_rechazo
       AND ciclo_estado = 'activo'
       AND submitted_to_mesa
     FROM public.expedientes WHERE id = v_exp_rich),
    'preserva fecha_cita, ciclo, envío y relaciones 072'
  );
  PERFORM public.__p074_assert(
    EXISTS (
      SELECT 1 FROM public.expediente_movimientos_mesa m
      WHERE m.id = (v_result->>'movimiento_id')::UUID
        AND m.actor_id = v_mesa
        AND m.actor_role = 'mesa_admin'
        AND m.etapa_origen = 9
        AND m.etapa_destino = 3
        AND m.motivo = 'Retroceso preservando todo'
    ),
    'evento contiene actor, rol, origen, destino y motivo'
  );
  PERFORM public.__p074_assert(
    EXISTS (
      SELECT 1 FROM public.action_log l
      WHERE l.entity_id = v_exp_rich
        AND l.action = 'mesa.expediente.mover_etapa'
        AND l.payload->>'movimiento_id' = v_result->>'movimiento_id'
    ),
    'escribe action_log enlazado'
  );

  -- Tabla append-only para roles de aplicación.
  PERFORM public.__p074_auth(v_mesa);
  BEGIN
    INSERT INTO public.expediente_movimientos_mesa (
      organization_id, expediente_id, etapa_origen, etapa_destino,
      subestado_origen, subestado_destino, motivo, actor_id, actor_role
    ) VALUES (
      v_org, v_exp_rich, 3, 4, 'en_proceso', 'en_proceso',
      'Inserción directa prohibida', v_mesa, 'mesa_admin'
    );
    RAISE EXCEPTION 'P074 TEST FAIL: INSERT directo debió fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.expediente_movimientos_mesa SET motivo = 'Mutado'
    WHERE expediente_id = v_exp_rich;
    RAISE EXCEPTION 'P074 TEST FAIL: UPDATE directo debió fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.expediente_movimientos_mesa WHERE expediente_id = v_exp_rich;
    RAISE EXCEPTION 'P074 TEST FAIL: DELETE directo debió fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.__p074_reset();

  -- Fallo posterior al INSERT de auditoría revierte evento y expediente.
  CREATE TRIGGER p074_force_action_log_failure
    BEFORE INSERT ON public.action_log
    FOR EACH ROW EXECUTE FUNCTION public.__p074_force_action_log_failure();
  PERFORM public.__p074_expect_fail(
    v_mesa, v_exp_rollback, 8, 3, 'Debe revertir', 'P074_FORCED_ROLLBACK'
  );
  DROP TRIGGER p074_force_action_log_failure ON public.action_log;
  PERFORM public.__p074_assert(
    (SELECT etapa_actual = 3 FROM public.expedientes WHERE id = v_exp_rollback)
    AND NOT EXISTS (
      SELECT 1 FROM public.expediente_movimientos_mesa
      WHERE expediente_id = v_exp_rollback
    ),
    'rollback total ante fallo posterior'
  );

  -- El flujo normal conserva sus gates.
  PERFORM public.__p074_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_normal_gate);
    PERFORM public.__p074_reset();
    RAISE EXCEPTION 'P074 TEST FAIL: avance normal sin datos/docs debió bloquear';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p074_reset();
    IF SQLERRM LIKE 'P074 TEST FAIL:%' THEN RAISE; END IF;
    IF position('faltan datos del cliente' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'P074 TEST FAIL: gate normal inesperado: %', SQLERRM;
    END IF;
  END;

  SELECT md5(pg_get_functiondef(p.oid))
  INTO v_p070_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'convert_biometricos_to_notificacion';
  PERFORM public.__p074_assert(v_p070_hash IS NOT NULL, 'P070 sigue presente e íntegra');
END;
$$;

ROLLBACK;

\echo 'P074 mesa_mover_etapa_operativa: OK'
