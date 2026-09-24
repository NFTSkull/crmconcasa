-- ConCasa CRM — P228 gate fiscal SAT (A–P + extras)
-- Solo local / preview branch — NUNCA producción.
\set ON_ERROR_STOP on
\i supabase/tests/_p189_infonavit_datos_fixture.sql

CREATE OR REPLACE FUNCTION public.__p228_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P228 FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p228_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p228_set_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p228_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9228-000000000001';
  v_a1 UUID := '00000000-0000-4000-9228-000000000011';
  v_a2 UUID := '00000000-0000-4000-9228-000000000012';
  v_del UUID := '00000000-0000-4000-9228-000000000014';
  v_sa UUID := '00000000-0000-4000-9228-000000000015';
  v_mesa_admin UUID := '00000000-0000-4000-9228-000000000016';
  v_exp1 UUID := '00000000-0000-4000-9228-000000000021';
  v_exp2 UUID := '00000000-0000-4000-9228-000000000022';
  v_exp_r UUID := '00000000-0000-4000-9228-000000000023';
  v_edc1 UUID := '00000000-0000-4000-9228-000000000031';
  v_edc2 UUID := '00000000-0000-4000-9228-000000000032';
  v_edc_new UUID := '00000000-0000-4000-9228-000000000039';
  v_res JSONB;
  v_ok BOOLEAN;
  v_estado TEXT;
  v_cnt INT;
  v_tipo TEXT;
  v_err TEXT;
BEGIN
  PERFORM public.__p228_reset();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p228-fiscal-gate-org', 'P228 Fiscal Gate Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_a1, 'authenticated', 'authenticated', 'p228-a1@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_a2, 'authenticated', 'authenticated', 'p228-a2@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_del, 'authenticated', 'authenticated', 'p228-del@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_sa, 'authenticated', 'authenticated', 'p228-sa@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa_admin, 'authenticated', 'authenticated', 'p228-ma@test.local', crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_a1, v_org, 'p228-a1@test.local', 'Asesor P228 Uno', 'asesor', 'interno', NULL, true),
    (v_a2, v_org, 'p228-a2@test.local', 'Asesor P228 Dos', 'asesor', 'interno', NULL, true),
    (v_del, v_org, 'p228-del@test.local', 'Delegado P228', 'asesor', 'interno', NULL, true),
    (v_sa, v_org, 'p228-sa@test.local', 'Super Admin P228', 'super_admin', NULL, NULL, true),
    (v_mesa_admin, v_org, 'p228-ma@test.local', 'Mesa Admin P228', 'mesa_admin', NULL, 'interno', true)
  ON CONFLICT (id) DO UPDATE SET
    active = true, organization_id = EXCLUDED.organization_id, app_role = EXCLUDED.app_role;

  INSERT INTO public.app_settings (key, value) VALUES
    ('fiscal_sat_gate_enabled', 'false'::jsonb),
    ('fiscal_sat_gate_pilot_asesores', '[]'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  -- ---------- I) authenticated no EXECUTE core ----------
  PERFORM public.__p228_assert(
    NOT has_function_privilege('authenticated', 'public.enviar_a_mesa_core(uuid,uuid,app_role)', 'EXECUTE'),
    'I: authenticated sin EXECUTE en core'
  );
  PERFORM public.__p228_assert(
    NOT has_function_privilege('anon', 'public.enviar_a_mesa_core(uuid,uuid,app_role)', 'EXECUTE'),
    'I: anon sin EXECUTE en core'
  );

  -- ---------- J) authenticated no modifica app_settings ----------
  PERFORM public.__p228_assert(
    NOT has_table_privilege('authenticated', 'public.app_settings', 'UPDATE'),
    'J: authenticated sin UPDATE app_settings'
  );
  PERFORM public.__p228_assert(
    NOT has_table_privilege('authenticated', 'public.app_settings', 'INSERT'),
    'J: authenticated sin INSERT app_settings'
  );

  -- Fixtures expedientes (telefono_casa + refs + direccionEmpresa: req. integridad prod)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, telefono_casa, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp1, v_org, v_a1, 'mejoravit', '92280000021', 'Fixture Fiscal Uno', '5511111121', '5592280021', 'interno', false, 1, 'pendiente', 'activo'),
    (v_exp2, v_org, v_a2, 'mejoravit', '92280000022', 'Fixture Fiscal Dos', '5511111122', '5592280022', 'interno', false, 1, 'pendiente', 'activo'),
    (v_exp_r, v_org, v_a1, 'mejoravit', '92280000023', 'Fixture Reingreso', '5511111123', '5592280023', 'interno', true, 3, 'en_proceso', 'activo')
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id, submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    telefono_casa = EXCLUDED.telefono_casa,
    fecha_envio_mesa = CASE WHEN EXCLUDED.submitted_to_mesa THEN coalesce(expedientes.fecha_envio_mesa, now()) ELSE NULL END,
    deleted_at = NULL, ciclo_estado = 'activo', updated_at = now();

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, referencias, estado, porcentaje_cobro, monto_calculado, metodo_pago
  )
  VALUES
    (
      v_exp1, v_org,
      public.__p189_infonavit_datos_completo('92280000021') || jsonb_build_object(
        'curp','GAVF850101HDFRRL09','rfc','GAVF850101ABC','nombreCliente','Fixture Fiscal Uno',
        'direccionEmpresa', jsonb_build_object('calle','Calle Fisc 1','colonia','Centro','municipio','Monterrey','cp','64000')
      ),
      jsonb_build_array(
        jsonb_build_object('nombre','Ref Uno A','celular','5582280021'),
        jsonb_build_object('nombre','Ref Uno B','celular','5582280022')
      ),
      'completo', 10, 100000, 'transferencia'
    ),
    (
      v_exp2, v_org,
      public.__p189_infonavit_datos_completo('92280000022') || jsonb_build_object(
        'curp','GAVF850101HDFRRL09','rfc','GAVF850101ABC','nombreCliente','Fixture Fiscal Dos',
        'direccionEmpresa', jsonb_build_object('calle','Calle Fisc 2','colonia','Centro','municipio','Monterrey','cp','64000')
      ),
      jsonb_build_array(
        jsonb_build_object('nombre','Ref Dos A','celular','5582280031'),
        jsonb_build_object('nombre','Ref Dos B','celular','5582280032')
      ),
      'completo', 10, 100000, 'transferencia'
    ),
    (
      v_exp_r, v_org,
      public.__p189_infonavit_datos_completo('92280000023') || jsonb_build_object(
        'curp','GAVF850101HDFRRL09','rfc','GAVF850101ABC','nombreCliente','Fixture Reingreso',
        'direccionEmpresa', jsonb_build_object('calle','Calle Fisc R','colonia','Centro','municipio','Monterrey','cp','64000')
      ),
      jsonb_build_array(
        jsonb_build_object('nombre','Ref Re A','celular','5582280041'),
        jsonb_build_object('nombre','Ref Re B','celular','5582280042')
      ),
      'completo', 10, 100000, 'transferencia'
    )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos, referencias = EXCLUDED.referencias, estado = EXCLUDED.estado,
    porcentaje_cobro = EXCLUDED.porcentaje_cobro, monto_calculado = EXCLUDED.monto_calculado, metodo_pago = EXCLUDED.metodo_pago;

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado, rfc_infonavit)
  VALUES
    (v_exp1, v_org, 'aprobado', 500000, 'GAVF850101ABC'),
    (v_exp2, v_org, 'aprobado', 500000, 'GAVF850101ABC'),
    (v_exp_r, v_org, 'aprobado', 500000, 'GAVF850101ABC')
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision, monto_aprobado = EXCLUDED.monto_aprobado, rfc_infonavit = EXCLUDED.rfc_infonavit;

  UPDATE public.expediente_documentos SET deleted_at = now()
  WHERE expediente_id IN (v_exp1, v_exp2, v_exp_r) AND deleted_at IS NULL;

  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_requeridos_para_expediente(v_exp1)
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento, storage_path,
      nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
    ) VALUES (
      v_org, v_exp1, v_tipo, v_org::text||'/'||v_exp1::text||'/'||v_tipo||'.pdf',
      v_tipo||'.pdf', 'application/pdf', 100, 1, v_a1, 'asesor'
    );
  END LOOP;
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_requeridos_para_expediente(v_exp2)
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento, storage_path,
      nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
    ) VALUES (
      v_org, v_exp2, v_tipo, v_org::text||'/'||v_exp2::text||'/'||v_tipo||'.pdf',
      v_tipo||'.pdf', 'application/pdf', 100, 1, v_a2, 'asesor'
    );
  END LOOP;

  -- EDC explícitos con ids fijos (tras docs requeridos; soft-delete previos EDC del loop)
  UPDATE public.expediente_documentos SET deleted_at = now()
  WHERE expediente_id IN (v_exp1, v_exp2)
    AND tipo_documento = 'cliente_estado_cuenta' AND deleted_at IS NULL;
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES
    (v_edc1, v_org, v_exp1, 'cliente_estado_cuenta', v_org::text||'/'||v_exp1::text||'/edc1.pdf', 'edc1.pdf', 'application/pdf', 100, 1, v_a1, 'asesor'),
    (v_edc2, v_org, v_exp2, 'cliente_estado_cuenta', v_org::text||'/'||v_exp2::text||'/edc2.pdf', 'edc2.pdf', 'application/pdf', 100, 1, v_a2, 'asesor')
  ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, version = EXCLUDED.version;

  -- ---------- A) gate OFF asesor normal: aplica false; enviar no exige fiscal ----------
  PERFORM public.__p228_assert(NOT public.fiscal_sat_gate_applies_to_expediente(v_exp1), 'A applies false');
  PERFORM public.__p228_set_auth(v_a1);
  BEGIN
    v_res := public.enviar_a_mesa(v_exp1);
    v_ok := coalesce((v_res->>'ok')::boolean, false);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_err := SQLERRM;
  END;
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(v_ok, 'A: gate OFF envía (o al menos no error fiscal): '||coalesce(v_err,''));
  PERFORM public.__p228_assert(
    coalesce(v_err,'') NOT ILIKE '%validación SAT%',
    'A: sin mensaje fiscal'
  );
  -- reset exp1 for later
  UPDATE public.expedientes SET submitted_to_mesa = false, fecha_envio_mesa = NULL, etapa_actual = 1, subestado = 'pendiente' WHERE id = v_exp1;

  -- ---------- B) gate OFF + piloto a1 → requiere SAT ----------
  UPDATE public.app_settings SET value = jsonb_build_array(v_a1::text), updated_at = now()
  WHERE key = 'fiscal_sat_gate_pilot_asesores';
  PERFORM public.__p228_assert(public.fiscal_sat_gate_applies_to_expediente(v_exp1), 'B applies piloto');
  PERFORM public.__p228_assert(NOT public.fiscal_sat_gate_applies_to_expediente(v_exp2), 'B no aplica a2');
  PERFORM public.__p228_set_auth(v_a1);
  BEGIN
    PERFORM public.enviar_a_mesa(v_exp1);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%validación SAT%' OR SQLERRM ILIKE '%huella vigente%';
  END;
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(v_ok, 'B: piloto sin VALIDADO bloquea envío');

  -- ---------- C) gate ON → todos requieren ----------
  UPDATE public.app_settings SET value = 'true'::jsonb WHERE key = 'fiscal_sat_gate_enabled';
  PERFORM public.__p228_assert(public.fiscal_sat_gate_applies_to_expediente(v_exp2), 'C applies a2');

  -- ---------- H) asesor no fabrica VALIDADO + delegado PENDIENTE ----------
  PERFORM public.__p228_set_auth(v_a2);
  BEGIN
    PERFORM public.asesor_registrar_validacion_identidad(v_exp2, 'rfc_validacion_sat', 'RFC_VALIDACION_SAT_VALIDADO', 'local');
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(v_ok, 'H: no fabricar VALIDADO');

  -- Delegado: si can_operate permite (mismo dueño no; usamos dueño a2 registrando PENDIENTE OK)
  PERFORM public.__p228_set_auth(v_a2);
  v_res := public.asesor_registrar_validacion_identidad(v_exp2, 'rfc_validacion_sat', 'RFC_VALIDACION_SAT_PENDIENTE', 'local');
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(coalesce((v_res->>'ok')::boolean, false), 'delegado/dueño PENDIENTE ok');

  -- ---------- D) VALIDADO + binding → envía ----------
  PERFORM public.__p228_set_service();
  v_res := public.server_registrar_validacion_fiscal_sat(
    v_exp1, 'RFC_VALIDACION_SAT_VALIDADO', '{"source":"test"}'::jsonb, 'GAVF850101ABC', v_edc1, 1
  );
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(public.fiscal_sat_gate_allows_envio(v_exp1), 'D allows');
  PERFORM public.__p228_set_auth(v_a1);
  v_res := public.enviar_a_mesa(v_exp1);
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(coalesce((v_res->>'ok')::boolean, false) AND coalesce((v_res->>'submitted_to_mesa')::boolean, false), 'D envía');

  -- ---------- E) INVALIDO bloquea ----------
  UPDATE public.expedientes SET submitted_to_mesa = false, fecha_envio_mesa = NULL, etapa_actual = 1, subestado = 'pendiente' WHERE id = v_exp2;
  PERFORM public.__p228_set_service();
  PERFORM public.server_registrar_validacion_fiscal_sat(
    v_exp2, 'RFC_VALIDACION_SAT_INVALIDO', '{"source":"test"}'::jsonb, 'GAVF850101ABC', v_edc2, 1
  );
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(NOT public.fiscal_sat_gate_allows_envio(v_exp2), 'E allows false');
  PERFORM public.__p228_set_auth(v_a2);
  BEGIN
    PERFORM public.enviar_a_mesa(v_exp2);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(v_ok, 'E bloquea envío');

  -- ---------- F) REVISION_MANUAL bloquea ----------
  PERFORM public.__p228_set_service();
  PERFORM public.server_registrar_validacion_fiscal_sat(
    v_exp2, 'RFC_VALIDACION_SAT_REVISION_MANUAL', '{"source":"test"}'::jsonb, 'GAVF850101ABC', v_edc2, 1
  );
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(NOT public.fiscal_sat_gate_allows_envio(v_exp2), 'F allows false');

  -- ---------- G) APROBADO_ADMIN (super_admin) envía; mesa_admin no ----------
  PERFORM public.__p228_set_auth(v_mesa_admin);
  BEGIN
    PERFORM public.admin_aprobar_envio_mesa_sin_fiscal(v_exp2, 'motivo de prueba largo suficiente');
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%super_admin%';
  END;
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(v_ok, 'mesa_admin no aprueba');

  PERFORM public.__p228_set_auth(v_sa);
  v_res := public.admin_aprobar_envio_mesa_sin_fiscal(v_exp2, 'motivo de prueba largo suficiente');
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(coalesce((v_res->>'ok')::boolean, false), 'G super_admin aprueba+envía');

  -- ---------- K/L/M binding bloquea ----------
  -- preparar exp1 de nuevo
  UPDATE public.expedientes SET submitted_to_mesa = false, fecha_envio_mesa = NULL, etapa_actual = 1, subestado = 'pendiente' WHERE id = v_exp1;
  PERFORM public.__p228_set_service();
  PERFORM public.server_registrar_validacion_fiscal_sat(
    v_exp1, 'RFC_VALIDACION_SAT_VALIDADO', '{"source":"test"}'::jsonb, 'GAVF850101ABC', v_edc1, 1
  );
  PERFORM public.__p228_reset();

  UPDATE public.cliente_datos SET datos = jsonb_set(datos, '{curp}', '"XXXX850101HDFRRL09"') WHERE expediente_id = v_exp1;
  PERFORM public.__p228_assert(NOT public.fiscal_sat_gate_allows_envio(v_exp1), 'L CURP');
  UPDATE public.cliente_datos SET datos = jsonb_set(datos, '{curp}', '"GAVF850101HDFRRL09"') WHERE expediente_id = v_exp1;

  UPDATE public.cliente_datos SET datos = jsonb_set(datos, '{rfc}', '"CAMBIO850101XXX"') WHERE expediente_id = v_exp1;
  PERFORM public.__p228_assert(NOT public.fiscal_sat_gate_allows_envio(v_exp1), 'M RFC datos');
  UPDATE public.cliente_datos SET datos = jsonb_set(datos, '{rfc}', '"GAVF850101ABC"') WHERE expediente_id = v_exp1;

  UPDATE public.expediente_documentos SET deleted_at = now() WHERE id = v_edc1;
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES (
    v_edc_new, v_org, v_exp1, 'cliente_estado_cuenta', v_org::text||'/'||v_exp1::text||'/edc1b.pdf',
    'edc1b.pdf', 'application/pdf', 100, 2, v_a1, 'asesor'
  );
  PERFORM public.__p228_assert(NOT public.fiscal_sat_gate_allows_envio(v_exp1), 'K EDC nuevo');

  -- ---------- N) concurrencia: una sola vigente ----------
  PERFORM public.__p228_set_service();
  BEGIN
    PERFORM public.server_registrar_validacion_fiscal_sat(
      v_exp1, 'RFC_VALIDACION_SAT_VALIDADO', '{"source":"n1"}'::jsonb, 'GAVF850101ABC', v_edc_new, 2
    );
    PERFORM public.server_registrar_validacion_fiscal_sat(
      v_exp1, 'RFC_VALIDACION_SAT_REVISION_MANUAL', '{"source":"n2"}'::jsonb, 'GAVF850101ABC', v_edc_new, 2
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- conflicto controlado OK
  END;
  PERFORM public.__p228_reset();
  SELECT count(*) INTO v_cnt FROM public.cliente_validaciones_identidad
  WHERE expediente_id = v_exp1 AND tipo = 'rfc_validacion_sat' AND vigente;
  PERFORM public.__p228_assert(v_cnt = 1, 'N: una sola vigente');

  -- ---------- PENDIENTE no pisa ----------
  SELECT estado INTO v_estado FROM public.cliente_validaciones_identidad
  WHERE expediente_id = v_exp1 AND tipo = 'rfc_validacion_sat' AND vigente;
  PERFORM public.__p228_set_auth(v_a1);
  v_res := public.asesor_registrar_validacion_identidad(v_exp1, 'rfc_validacion_sat', 'RFC_VALIDACION_SAT_PENDIENTE', 'local');
  PERFORM public.__p228_reset();
  PERFORM public.__p228_assert(coalesce((v_res->>'unchanged')::boolean, false) OR v_estado = 'RFC_VALIDACION_SAT_PENDIENTE', 'PENDIENTE unchanged o ya pendiente');

  -- ---------- Reingreso / retención / reactivación sin fiscal en definición ----------
  PERFORM public.__p228_assert(
    pg_get_functiondef('public.asesor_enviar_reingreso_a_mesa(uuid)'::regprocedure) NOT ILIKE '%fiscal_sat%',
    'reingreso sin gate fiscal en cuerpo'
  );
  PERFORM public.__p228_assert(
    pg_get_functiondef('public.reactivar_expediente_rechazado(uuid)'::regprocedure) NOT ILIKE '%fiscal_sat%',
    'reactivar sin gate fiscal'
  );
  PERFORM public.__p228_assert(
    NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'enviar_retencion_mesa'
        AND pg_get_functiondef(p.oid) ILIKE '%fiscal_sat%'
    ),
    'retencion sin gate fiscal'
  );
  PERFORM public.__p228_assert(
    pg_get_functiondef(
      'public.asesor_registrar_validacion_identidad(uuid,text,text,text,jsonb,uuid,integer,text,text)'::regprocedure
    ) ILIKE '%asesor_can_operate_expediente_as%',
    'asesor_registrar conserva can_operate (p208)'
  );

  -- Cleanup settings
  UPDATE public.app_settings SET value = 'false'::jsonb WHERE key = 'fiscal_sat_gate_enabled';
  UPDATE public.app_settings SET value = '[]'::jsonb WHERE key = 'fiscal_sat_gate_pilot_asesores';

  RAISE NOTICE 'P228 fiscal sat gate tests OK (A–N + extras)';
END;
$$;
