-- ConCasa CRM — pruebas integrales P072 reingreso post-biométricos
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p072_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P072 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p072_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p072_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p072_expect_reingreso_fail(
  p_user UUID, p_parent UUID, p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p072_auth(p_user);
  BEGIN
    PERFORM public.iniciar_reingreso_post_biometricos(p_parent, NULL);
    PERFORM public.__p072_reset();
    RAISE EXCEPTION 'P072 TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p072_reset();
    IF SQLERRM LIKE 'P072 TEST FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE ('%' || p_code || '%') THEN
      RAISE EXCEPTION 'P072 TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p072_expect_advance_fail(
  p_user UUID, p_exp UUID, p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p072_auth(p_user);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(p_exp, NULL);
    PERFORM public.__p072_reset();
    RAISE EXCEPTION 'P072 TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p072_reset();
    IF SQLERRM LIKE 'P072 TEST FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE ('%' || p_code || '%') THEN
      RAISE EXCEPTION 'P072 TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p072_expect_editor_fail(
  p_user UUID, p_exp UUID, p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p072_auth(p_user);
  BEGIN
    PERFORM public.upsert_editor_decision(p_exp, 'aprobado', 100000, 'test');
    PERFORM public.__p072_reset();
    RAISE EXCEPTION 'P072 TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p072_reset();
    IF SQLERRM LIKE 'P072 TEST FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE ('%' || p_code || '%') THEN
      RAISE EXCEPTION 'P072 TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p072_expect_register_fail(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT, p_code TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p072_auth(p_user);
  BEGIN
    PERFORM public.register_expediente_documento(
      p_exp, p_tipo, p_path, 'archivo.pdf', 'application/pdf', 100
    );
    PERFORM public.__p072_reset();
    RAISE EXCEPTION 'P072 TEST FAIL: se esperaba %', p_code;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p072_reset();
    IF SQLERRM LIKE 'P072 TEST FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE ('%' || p_code || '%') THEN
      RAISE EXCEPTION 'P072 TEST FAIL: esperaba %, recibió %', p_code, SQLERRM;
    END IF;
  END;
END;
$$;

-- Bypass directo: la llamada a *_pre_reingreso como authenticated debe fallar
-- por privilegios (42501), nunca llegar a ejecutar la lógica interna.
CREATE OR REPLACE FUNCTION public.__p072_expect_priv_denied(
  p_user UUID, p_call TEXT, p_label TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p072_auth(p_user);
  BEGIN
    EXECUTE p_call;
    PERFORM public.__p072_reset();
    RAISE EXCEPTION 'P072 TEST FAIL: % debía fallar por permisos', p_label;
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM public.__p072_reset();
  WHEN OTHERS THEN
    PERFORM public.__p072_reset();
    IF SQLERRM LIKE 'P072 TEST FAIL:%' THEN RAISE; END IF;
    RAISE EXCEPTION 'P072 TEST FAIL: % esperaba permission denied, recibió %',
      p_label, SQLERRM;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p072_can_read(p_user UUID, p_path TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_allowed BOOLEAN;
BEGIN
  PERFORM public.__p072_auth(p_user);
  SELECT public.expediente_documento_storage_can_read(p_path) INTO v_allowed;
  PERFORM public.__p072_reset();
  RETURN v_allowed;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9272-000000000001';
  v_asesor UUID := '00000000-0000-4000-9272-000000000011';
  v_asesor_ajeno UUID := '00000000-0000-4000-9272-000000000012';
  v_editor UUID := '00000000-0000-4000-9272-000000000013';
  v_mesa_admin UUID := '00000000-0000-4000-9272-000000000014';
  v_mesa_interno UUID := '00000000-0000-4000-9272-000000000015';
  v_mesa_externo UUID := '00000000-0000-4000-9272-000000000016';
  v_parent UUID := '00000000-0000-4000-9272-000000000021';
  v_normal UUID := '00000000-0000-4000-9272-000000000022';
  v_other_parent UUID := '00000000-0000-4000-9272-000000000023';
  v_booking UUID := '00000000-0000-4000-9272-000000000031';
  v_other_booking UUID := '00000000-0000-4000-9272-000000000032';
  v_doc_ine UUID := '00000000-0000-4000-9272-000000000041';
  v_doc_acta UUID := '00000000-0000-4000-9272-000000000042';
  v_doc_sat_rech UUID := '00000000-0000-4000-9272-000000000043';
  v_doc_dom UUID := '00000000-0000-4000-9272-000000000044';
  v_doc_estado UUID := '00000000-0000-4000-9272-000000000045';
  v_rechazo UUID;
  v_other_rechazo UUID;
  v_child UUID;
  v_result JSONB;
  v_elig JSONB;
  v_dom_child UUID;
  v_estado_child UUID;
  v_reused_child UUID;
  v_parent_ine_path TEXT;
  v_parent_acta_path TEXT;
  v_parent_sat_path TEXT;
  v_parent_dom_path TEXT;
  v_parent_estado_path TEXT;
  v_child_dom_path TEXT;
  v_child_estado_path TEXT;
  v_child_ine_replacement_path TEXT;
  v_normal_dom_path TEXT;
  v_parent_before RECORD;
  v_count INTEGER;
BEGIN
  v_parent_ine_path := v_org || '/' || v_parent || '/cliente_ine_frente/ine.pdf';
  v_parent_acta_path := v_org || '/' || v_parent || '/cliente_acta_nacimiento/acta.pdf';
  v_parent_sat_path := v_org || '/' || v_parent || '/cliente_constancia_sat/sat.pdf';
  v_parent_dom_path := v_org || '/' || v_parent || '/cliente_comprobante_domicilio/dom.pdf';
  v_parent_estado_path := v_org || '/' || v_parent || '/cliente_estado_cuenta/estado.pdf';
  v_normal_dom_path := v_org || '/' || v_normal || '/cliente_comprobante_domicilio/normal.pdf';

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p072-org', 'P072 Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p072-asesor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor_ajeno, 'authenticated', 'authenticated', 'p072-ajeno@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'p072-editor@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa_admin, 'authenticated', 'authenticated', 'p072-admin@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa_interno, 'authenticated', 'authenticated', 'p072-interno@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa_externo, 'authenticated', 'authenticated', 'p072-externo@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa,
    tipo_asesor_origen, active
  ) VALUES
    (v_asesor, v_org, 'p072-asesor@test.local', 'Asesor', 'asesor', NULL, 'interno', true),
    (v_asesor_ajeno, v_org, 'p072-ajeno@test.local', 'Ajeno', 'asesor', NULL, 'interno', true),
    (v_editor, v_org, 'p072-editor@test.local', 'Editor', 'editor', NULL, NULL, true),
    (v_mesa_admin, v_org, 'p072-admin@test.local', 'Mesa Admin', 'mesa_admin', NULL, NULL, true),
    (v_mesa_interno, v_org, 'p072-interno@test.local', 'Mesa Interno', 'mesa_interno', 'interno', NULL, true),
    (v_mesa_externo, v_org, 'p072-externo@test.local', 'Mesa Externo', 'mesa_externo', 'externo', NULL, true);

  INSERT INTO public.agenda_config (organization_id, kind, config, updated_by)
  VALUES (
    v_org, 'biometricos',
    '{"timezone":"America/Monterrey","enabled":true}'::JSONB,
    v_mesa_admin
  );

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado,
    motivo_rechazo, comentario_rechazo, fecha_cita
  ) VALUES
    (v_parent, v_org, v_asesor, 'mejoravit', '92720000001', 'Cliente Padre',
     '5592720001', 'Dirección cliente', 'interno', 'activo', true, NOW(),
     5, 'en_proceso', NULL, NULL, NOW() - INTERVAL '2 days'),
    (v_normal, v_org, v_asesor, 'mejoravit', '92720000002', 'Normal enviado',
     '5592720002', '', 'interno', 'activo', true, NOW(),
     6, 'en_proceso', NULL, NULL, NULL),
    (v_other_parent, v_org, v_asesor, 'subcuenta', '92720000003', 'Otro padre',
     '5592720003', '', 'interno', 'cerrado', true, NOW(),
     5, 'rechazado', 'otro', NULL, NOW() - INTERVAL '3 days');

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES
    (v_booking, v_org, 'biometricos', v_parent, CURRENT_DATE - 2, '10:00',
     'centro', 'booked', 'evidencia padre', v_asesor),
    (v_other_booking, v_org, 'biometricos', v_other_parent, CURRENT_DATE - 3, '10:00',
     'centro', 'booked', 'otra evidencia', v_asesor);

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision, decided_by
  ) VALUES
    (v_parent, v_org, 'aprobado', 80000, 'decisión anterior', v_editor),
    (v_normal, v_org, 'pendiente', NULL, '', NULL);

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, comentario_rechazo,
    validated_at, validated_by, rejected_at, rejected_by, updated_by,
    telefono_normalizado, referencias, imagenes, porcentaje_cobro,
    monto_calculado, metodo_pago
  ) VALUES (
    v_parent,
    v_org,
    jsonb_build_object(
      'nombreCliente', 'Cliente Padre',
      'nss', '92720000001',
      'curp', 'CURP9272',
      'rfc', 'RFC9272',
      'celular', '5592720001',
      'telefono', '5592720001',
      'correo', 'cliente@test.local',
      'empresa', 'Empresa',
      'registroPatronal', 'RP-9272',
      'telefonoEmpresa', '5588888888',
      'referencias', jsonb_build_array(
        jsonb_build_object('nombre', 'Referencia', 'telefono', '5511111111')
      ),
      'beneficiario', jsonb_build_object('nombre', 'Beneficiario', 'parentesco', 'Hijo'),
      'direccionEmpresa', jsonb_build_object(
        'calle', 'Uno', 'colonia', 'Centro', 'municipio', 'Monterrey', 'cp', '64000'
      ),
      'plazo', '24 meses',
      'notaMesa', 'Información estable del cliente',
      'montoMejoravit', '80000',
      'montoCalculado', '11000',
      'claveFueraDelModelo', 'no copiar'
    ),
    'validado',
    'rechazo anterior',
    NOW(),
    v_mesa_admin,
    NOW(),
    v_mesa_admin,
    v_asesor,
    '5592720001',
    '[{"nombre":"Referencia","celular":"5511111111"}]'::JSONB,
    '[{"ruta":"ine.jpg"}]'::JSONB,
    10,
    11000,
    'transferencia'
  );

  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES
    ('expediente-documentos', v_parent_ine_path, v_asesor::TEXT),
    ('expediente-documentos', v_parent_acta_path, v_asesor::TEXT),
    ('expediente-documentos', v_parent_sat_path, v_asesor::TEXT),
    ('expediente-documentos', v_parent_dom_path, v_asesor::TEXT),
    ('expediente-documentos', v_parent_estado_path, v_asesor::TEXT),
    ('expediente-documentos', v_normal_dom_path, v_asesor::TEXT);

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    comentario_mesa, uploaded_by, uploaded_by_role
  ) VALUES
    (v_doc_ine, v_org, v_parent, 'cliente_ine_frente', v_parent_ine_path,
     'ine.pdf', 'application/pdf', 100, 1, 'validado', NULL, v_asesor, 'asesor'),
    (v_doc_acta, v_org, v_parent, 'cliente_acta_nacimiento', v_parent_acta_path,
     'acta.pdf', 'application/pdf', 100, 1, 'validado', NULL, v_mesa_admin, 'mesa_admin'),
    (v_doc_sat_rech, v_org, v_parent, 'cliente_constancia_sat', v_parent_sat_path,
     'sat.pdf', 'application/pdf', 100, 1, 'rechazado', 'rechazado', v_mesa_admin, 'mesa_admin'),
    (v_doc_dom, v_org, v_parent, 'cliente_comprobante_domicilio', v_parent_dom_path,
     'dom.pdf', 'application/pdf', 100, 1, 'validado', NULL, v_asesor, 'asesor'),
    (v_doc_estado, v_org, v_parent, 'cliente_estado_cuenta', v_parent_estado_path,
     'estado.pdf', 'application/pdf', 100, 1, 'validado', NULL, v_asesor, 'asesor');

  SELECT etapa_actual, subestado, motivo_rechazo, comentario_rechazo,
         fecha_cita, ciclo_estado
  INTO v_parent_before
  FROM public.expedientes
  WHERE id = v_parent;

  PERFORM public.__p072_auth(v_mesa_admin);
  SELECT public.rechazar_etapa_operativa(
    v_parent, 'Rechazo de inscripción', 'Puede reinscribirse',
    'reutilizables', 'Mesa confirma biométricos reutilizables', v_booking
  ) INTO v_result;
  PERFORM public.__p072_reset();
  v_rechazo := (v_result->>'rechazo_id')::UUID;

  PERFORM public.__p072_auth(v_asesor);
  SELECT public.get_reingreso_post_biometricos_elegibilidad(v_parent) INTO v_elig;
  PERFORM public.__p072_reset();
  PERFORM public.__p072_assert(
    (v_elig->>'eligible')::BOOLEAN AND v_elig->>'reason_code' = 'eligible',
    'elegibilidad comparte resultado eligible'
  );

  PERFORM public.__p072_auth(v_asesor_ajeno);
  SELECT public.get_reingreso_post_biometricos_elegibilidad(v_parent) INTO v_elig;
  PERFORM public.__p072_reset();
  PERFORM public.__p072_assert(
    v_elig->>'reason_code' = 'REENTRY_NOT_OWNER',
    'elegibilidad no filtra datos a asesor ajeno'
  );

  PERFORM public.__p072_auth(v_asesor);
  SELECT public.iniciar_reingreso_post_biometricos(v_parent, 'Nuevo ciclo') INTO v_result;
  PERFORM public.__p072_reset();
  v_child := (v_result->>'expediente_id')::UUID;

  PERFORM public.__p072_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes h
      WHERE h.id = v_child
        AND h.expediente_anterior_id = v_parent
        AND h.reingreso_rechazo_id = v_rechazo
        AND h.organization_id = v_org
        AND h.asesor_id = v_asesor
        AND h.nss = '92720000001'
        AND h.programa = 'mejoravit'
        AND h.etapa_actual = 6
        AND h.subestado = 'en_proceso'
        AND h.ciclo_estado = 'activo'
        AND h.submitted_to_mesa = true
        AND h.fecha_cita IS NULL
    ),
    'crea hijo enlazado con estado inicial exacto'
  );

  PERFORM public.__p072_assert(
    (SELECT etapa_actual = v_parent_before.etapa_actual
            AND subestado = 'rechazado'
            AND motivo_rechazo = 'Rechazo de inscripción'
            AND comentario_rechazo = 'Puede reinscribirse'
            AND fecha_cita IS NOT DISTINCT FROM v_parent_before.fecha_cita
            AND ciclo_estado = 'cerrado'
     FROM public.expedientes WHERE id = v_parent),
    'padre solo cierra ciclo y conserva historial del rechazo'
  );
  PERFORM public.__p072_assert(
    (SELECT status = 'booked' AND note = 'evidencia padre'
     FROM public.agenda_bookings WHERE id = v_booking),
    'booking histórico permanece intacto'
  );
  PERFORM public.__p072_assert(
    NOT EXISTS (SELECT 1 FROM public.agenda_bookings WHERE expediente_id = v_child),
    'hijo no recibe booking'
  );

  PERFORM public.__p072_assert(
    EXISTS (
      SELECT 1 FROM public.cliente_datos cd
      WHERE cd.expediente_id = v_child
        AND cd.estado = 'completo'
        AND cd.validated_at IS NULL
        AND cd.validated_by IS NULL
        AND cd.rejected_at IS NULL
        AND cd.rejected_by IS NULL
        AND cd.comentario_rechazo IS NULL
        AND cd.porcentaje_cobro = 10
        AND cd.metodo_pago = 'transferencia'
        AND cd.monto_calculado IS NULL
        AND cd.datos->>'nombreCliente' = 'Cliente Padre'
        AND cd.datos->>'plazo' = '24 meses'
        AND cd.datos->>'notaMesa' = 'Información estable del cliente'
        AND cd.datos->'referencias'->0->>'telefono' = '5511111111'
        AND NOT (cd.datos ? 'montoMejoravit')
        AND NOT (cd.datos ? 'montoCalculado')
        AND NOT (cd.datos ? 'claveFueraDelModelo')
        AND (
          SELECT count(*) = 15
          FROM jsonb_object_keys(cd.datos)
        )
    ),
    'cliente_datos copia precarga y reinicia validación/montos derivados'
  );

  SELECT count(*) INTO v_count
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_child AND d.deleted_at IS NULL;
  PERFORM public.__p072_assert(v_count = 2, 'solo clona whitelist validada disponible');
  PERFORM public.__p072_assert(
    EXISTS (
      SELECT 1 FROM public.expediente_documentos d
      WHERE d.expediente_id = v_child
        AND d.tipo_documento = 'cliente_ine_frente'
        AND d.reutilizado_de_documento_id = v_doc_ine
        AND d.storage_path = v_parent_ine_path
        AND d.estatus_revision = 'validado'
    )
    AND EXISTS (
      SELECT 1 FROM public.expediente_documentos d
      WHERE d.expediente_id = v_child
        AND d.tipo_documento = 'cliente_acta_nacimiento'
        AND d.reutilizado_de_documento_id = v_doc_acta
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.expediente_documentos d
      WHERE d.expediente_id = v_child
        AND d.tipo_documento IN (
          'cliente_constancia_sat',
          'cliente_comprobante_domicilio',
          'cliente_estado_cuenta'
        )
    ),
    'respeta whitelist, estatus y documentos siempre nuevos'
  );
  PERFORM public.__p072_assert(
    NOT EXISTS (
      SELECT 1 FROM public.documento_revisiones dr
      JOIN public.expediente_documentos d ON d.id = dr.documento_id
      WHERE d.expediente_id = v_child
    ),
    'no copia revisiones históricas'
  );

  PERFORM public.__p072_expect_reingreso_fail(
    v_asesor, v_parent, 'REENTRY_CYCLE_NOT_ACTIVE'
  );

  -- La FK compuesta impide enlazar un rechazo de otro padre.
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, biometricos_razon, biometricos_booking_id,
    decidido_por, decidido_por_rol
  ) VALUES (
    gen_random_uuid(), v_org, v_other_parent, 5, 'en_proceso', 'otro',
    'reutilizables', 'otra razón', v_other_booking, v_mesa_admin, 'mesa_admin'
  ) RETURNING id INTO v_other_rechazo;

  BEGIN
    UPDATE public.expedientes
    SET reingreso_rechazo_id = v_other_rechazo
    WHERE id = v_child;
    RAISE EXCEPTION 'P072 TEST FAIL: FK compuesta aceptó rechazo de otro padre';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  PERFORM public.__p072_expect_advance_fail(
    v_mesa_admin, v_child, 'REENTRY_AMOUNT_PENDING'
  );

  PERFORM public.__p072_expect_editor_fail(
    v_editor, v_normal, 'no se puede editar decisión tras enviar a Mesa'
  );

  PERFORM public.__p072_auth(v_editor);
  PERFORM public.upsert_editor_decision(
    v_child, 'aprobado', 100000, 'Nueva aprobación de reingreso'
  );
  PERFORM public.__p072_reset();
  PERFORM public.__p072_assert(
    (SELECT decision = 'aprobado' AND monto_aprobado = 100000
     FROM public.editor_decisions WHERE expediente_id = v_child),
    'editor procesa reingreso post-Mesa'
  );
  PERFORM public.__p072_assert(
    (SELECT monto_calculado = 11900
     FROM public.cliente_datos WHERE expediente_id = v_child),
    'recalcula cobro con monto nuevo y porcentaje precargado'
  );

  PERFORM public.__p072_expect_advance_fail(
    v_mesa_admin, v_child, 'REENTRY_DOCUMENTS_PENDING'
  );

  -- Bypass directo bloqueado: los respaldos *_pre_reingreso no son ejecutables
  -- por authenticated, así que nadie salta el gate de monto/documentos del hijo.
  PERFORM public.__p072_expect_priv_denied(
    v_mesa_admin,
    format(
      'SELECT public.avanzar_etapa_operativa_pre_reingreso(%L::uuid, NULL)',
      v_child
    ),
    'avanzar_etapa_operativa_pre_reingreso directo (mesa)'
  );
  PERFORM public.__p072_expect_priv_denied(
    v_asesor,
    format(
      'SELECT public.avanzar_etapa_operativa_pre_reingreso(%L::uuid, NULL)',
      v_child
    ),
    'avanzar_etapa_operativa_pre_reingreso directo (asesor)'
  );
  PERFORM public.__p072_expect_priv_denied(
    v_editor,
    format(
      'SELECT public.upsert_editor_decision_pre_reingreso(%L::uuid, %L::public.editor_decision, 999999, %L)',
      v_child, 'aprobado', 'bypass'
    ),
    'upsert_editor_decision_pre_reingreso directo'
  );
  PERFORM public.__p072_expect_priv_denied(
    v_asesor,
    format(
      'SELECT public.register_expediente_documento_pre_reingreso(%L::uuid, %L, %L, %L, %L, 100)',
      v_child, 'cliente_comprobante_domicilio',
      v_org || '/' || v_child || '/cliente_comprobante_domicilio/bypass.pdf',
      'bypass.pdf', 'application/pdf'
    ),
    'register_expediente_documento_pre_reingreso directo'
  );
  PERFORM public.__p072_assert(
    (SELECT etapa_actual = 6 FROM public.expedientes WHERE id = v_child),
    'el hijo permanece en etapa 6 tras los intentos de bypass'
  );

  v_child_dom_path := v_org || '/' || v_child || '/cliente_comprobante_domicilio/dom-nuevo.pdf';
  v_child_estado_path := v_org || '/' || v_child || '/cliente_estado_cuenta/estado-nuevo.pdf';
  v_child_ine_replacement_path := v_org || '/' || v_child || '/cliente_ine_frente/ine-nueva.pdf';

  PERFORM public.__p072_assert(
    public.__p072_can_read(v_asesor, v_parent_ine_path),
    'asesor dueño del hijo lee objeto reutilizado'
  );
  PERFORM public.__p072_assert(
    public.__p072_can_read(v_mesa_admin, v_parent_ine_path),
    'mesa admin lee objeto reutilizado'
  );
  PERFORM public.__p072_assert(
    public.__p072_can_read(v_mesa_interno, v_parent_ine_path),
    'mesa interno visible lee objeto reutilizado'
  );
  PERFORM public.__p072_assert(
    NOT public.__p072_can_read(v_mesa_externo, v_parent_ine_path),
    'mesa externo no lee expediente interno'
  );
  PERFORM public.__p072_assert(
    NOT public.__p072_can_read(v_asesor_ajeno, v_parent_ine_path),
    'asesor ajeno no lee objeto reutilizado'
  );

  UPDATE public.expedientes SET deleted_at = NOW() WHERE id = v_parent;
  PERFORM public.__p072_assert(
    public.__p072_can_read(v_asesor, v_parent_ine_path),
    'genealogía mantiene lectura del hijo tras soft-delete del padre'
  );
  UPDATE public.expedientes SET origen_mesa = 'externo' WHERE id IN (v_parent, v_child);
  PERFORM public.__p072_assert(
    public.__p072_can_read(v_mesa_externo, v_parent_ine_path),
    'mesa externo lee mediante hijo cuando el expediente es visible'
  );
  UPDATE public.expedientes SET origen_mesa = 'interno' WHERE id IN (v_parent, v_child);

  -- Inserciones reales bajo policy Storage: dueño permitido; ajeno denegado.
  PERFORM public.__p072_auth(v_asesor);
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES
    ('expediente-documentos', v_child_dom_path, v_asesor::TEXT),
    ('expediente-documentos', v_child_estado_path, v_asesor::TEXT),
    ('expediente-documentos', v_child_ine_replacement_path, v_asesor::TEXT);
  PERFORM public.__p072_reset();

  PERFORM public.__p072_assert(
    NOT public.expediente_documento_storage_asesor_post_mesa_upload_allowed(
      v_org || '/' || v_child || '/cliente_ine_reverso/no-permitido.pdf'
    ),
    'Storage no abre primer upload para otro obligatorio'
  );

  PERFORM public.__p072_auth(v_asesor);
  SELECT (public.register_expediente_documento(
    v_child, 'cliente_comprobante_domicilio', v_child_dom_path,
    'dom-nuevo.pdf', 'application/pdf', 100
  )->>'documento_id')::UUID INTO v_dom_child;
  SELECT (public.register_expediente_documento(
    v_child, 'cliente_estado_cuenta', v_child_estado_path,
    'estado-nuevo.pdf', 'application/pdf', 100
  )->>'documento_id')::UUID INTO v_estado_child;
  PERFORM public.__p072_reset();

  PERFORM public.__p072_expect_register_fail(
    v_asesor_ajeno, v_child, 'cliente_comprobante_domicilio',
    v_child_dom_path, 'solo el asesor dueño'
  );
  PERFORM public.__p072_expect_register_fail(
    v_asesor, v_normal, 'cliente_comprobante_domicilio',
    v_normal_dom_path, 'el expediente ya fue enviado a Mesa'
  );

  PERFORM public.__p072_auth(v_mesa_admin);
  PERFORM public.update_documento_revision(v_dom_child, 'validado', NULL);
  PERFORM public.update_documento_revision(v_estado_child, 'validado', NULL);
  PERFORM public.__p072_reset();

  PERFORM public.__p072_auth(v_mesa_admin);
  SELECT public.avanzar_etapa_operativa(v_child, 'Reingreso completo') INTO v_result;
  PERFORM public.__p072_reset();
  PERFORM public.__p072_assert(
    v_result->>'etapa_actual' = '7'
    AND (SELECT etapa_actual = 7 FROM public.expedientes WHERE id = v_child),
    'gate 6→7 avanza solo tras monto y documentos nuevos validados'
  );

  -- Reemplazar un reutilizado no borra el objeto ni la metadata del padre.
  UPDATE public.expedientes SET etapa_actual = 6 WHERE id = v_child;
  SELECT id INTO v_reused_child
  FROM public.expediente_documentos
  WHERE expediente_id = v_child
    AND tipo_documento = 'cliente_ine_frente'
    AND deleted_at IS NULL;

  PERFORM public.__p072_auth(v_asesor);
  PERFORM public.register_expediente_documento(
    v_child, 'cliente_ine_frente', v_child_ine_replacement_path,
    'ine-nueva.pdf', 'application/pdf', 100
  );
  PERFORM public.__p072_reset();

  PERFORM public.__p072_assert(
    (SELECT deleted_at IS NOT NULL
     FROM public.expediente_documentos WHERE id = v_reused_child)
    AND EXISTS (
      SELECT 1 FROM public.expediente_documentos WHERE id = v_doc_ine AND deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'expediente-documentos' AND name = v_parent_ine_path
    ),
    'reemplazo/soft-delete del hijo no elimina metadata ni objeto del padre'
  );

  PERFORM public.__p072_assert(
    EXISTS (
      SELECT 1 FROM public.action_log
      WHERE entity_id = v_child AND action = 'expediente.reingreso.crear'
    )
    AND EXISTS (
      SELECT 1 FROM public.action_log
      WHERE entity_id = v_parent AND action = 'expediente.reingreso.cerrar_anterior'
    ),
    'audita cierre y creación'
  );

  RAISE NOTICE 'P072 SQL tests: 35 cases passed';
END;
$$;

ROLLBACK;
