-- ConCasa CRM — pruebas hotfix 151: primer alta cliente_datos en reingreso
-- Uso: PGPASSWORD=postgres psql ... -f supabase/tests/rpc_reingreso_cliente_datos_primer_alta.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_rcd_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC RCD TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_rcd_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_rcd_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9151-000000000001';
  v_asesor UUID := '00000000-0000-4000-9151-000000000011';
  v_asesor2 UUID := '00000000-0000-4000-9151-000000000012';
  v_editor UUID := '00000000-0000-4000-9151-000000000013';
  v_exp UUID := '00000000-0000-4000-9151-000000000021';
  v_exp_closed UUID := '00000000-0000-4000-9151-000000000022';
  v_count_before INTEGER;
  v_count_after INTEGER;
  v_result JSONB;
  v_err TEXT;
  v_rows INTEGER;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'rcd-reingreso-151-org', 'RCD Reingreso 151 Org', true)
  ON CONFLICT (slug) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'rcd151-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor2, 'authenticated', 'authenticated', 'rcd151-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'rcd151-editor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_asesor, v_org, 'rcd151-asesor@test.local', 'Asesor RCD151', 'asesor', 'interno', true),
    (v_asesor2, v_org, 'rcd151-asesor2@test.local', 'Asesor2 RCD151', 'asesor', 'interno', true),
    (v_editor, v_org, 'rcd151-editor@test.local', 'Editor RCD151', 'editor', NULL, true)
  ON CONFLICT (id) DO UPDATE SET active = true, organization_id = EXCLUDED.organization_id;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    direccion_opcional, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado,
    reingreso_manual_count, reingreso_manual_at, reingreso_manual_by
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91510000021', 'Cliente RCD151', '5511111131',
    '', 'interno', true, NOW(), 1, 'en_validacion_mesa', 'activo',
    1, NOW(), v_asesor
  ) ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    submitted_to_mesa = true,
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    ciclo_estado = 'activo',
    reingreso_manual_count = 1,
    direccion_opcional = '',
    deleted_at = NULL;

  -- Cerrado: count>0 etapa 3 (sin edición completa)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado,
    reingreso_manual_count
  ) VALUES (
    v_exp_closed, v_org, v_asesor, 'mejoravit', '91510000022', 'Cliente RCD151b', '5511111132',
    'interno', true, NOW(), 3, 'en_proceso', 'activo', 2
  ) ON CONFLICT (id) DO UPDATE SET
    etapa_actual = 3, reingreso_manual_count = 2, submitted_to_mesa = true,
    ciclo_estado = 'activo', deleted_at = NULL;

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (v_exp, v_org, 'aprobado', 56000)
  ON CONFLICT (expediente_id) DO UPDATE SET monto_aprobado = 56000, decision = 'aprobado';

  DELETE FROM public.cliente_datos WHERE expediente_id IN (v_exp, v_exp_closed);

  PERFORM public.__rpc_rcd_assert(
    public.es_reingreso_asesor_edicion_activa(v_exp),
    'reingreso activo en fixture'
  );
  PERFORM public.__rpc_rcd_assert(
    NOT EXISTS (SELECT 1 FROM public.cliente_datos WHERE expediente_id = v_exp),
    'sin cliente_datos inicial'
  );

  -- Primer alta vía correccion
  PERFORM public.__rpc_rcd_auth(v_asesor);
  v_result := public.save_cliente_datos_correccion(
    v_exp,
    NULL,
    '5511111131',
    jsonb_build_array(
      jsonb_build_object('nombre', 'Ref Uno', 'celular', '5522222231'),
      jsonb_build_object('nombre', 'Ref Dos', 'celular', '5533333331')
    ),
    NULL,
    jsonb_build_object(
      'nombreCliente', 'Cliente RCD151',
      'nss', '91510000021',
      'curp', 'PEGJ800101HDFRRN09',
      'rfc', '',
      'celular', '5511111131',
      'correo', 'rcd151@test.local',
      'empresa', 'Empresa SA',
      'registroPatronal', 'A1234567890',
      'telefonoEmpresa', '5544444431',
      'beneficiario', jsonb_build_object('nombre', 'Bene Uno', 'parentesco', 'hijo'),
      'direccionEmpresa', jsonb_build_object(
        'calle', 'Calle 1', 'colonia', 'Col', 'municipio', 'Mty', 'cp', '64000'
      ),
      'montoMejoravit', '56000',
      'plazo', '12',
      'porcentajeCobro', '10',
      'metodoPago', 'transferencia'
    ),
    10,
    'transferencia',
    'Calle Real 123',
    NULL
  );
  PERFORM public.__rpc_rcd_reset();

  PERFORM public.__rpc_rcd_assert((v_result->>'created')::boolean IS TRUE, 'created=true');
  SELECT COUNT(*) INTO v_rows FROM public.cliente_datos WHERE expediente_id = v_exp;
  PERFORM public.__rpc_rcd_assert(v_rows = 1, 'una sola fila');

  -- Segundo guardado actualiza misma fila
  PERFORM public.__rpc_rcd_auth(v_asesor);
  PERFORM public.save_cliente_datos_correccion(
    v_exp, NULL, '5511111131',
    jsonb_build_array(
      jsonb_build_object('nombre', 'Ref Uno', 'celular', '5522222231'),
      jsonb_build_object('nombre', 'Ref Dos', 'celular', '5533333331')
    ),
    NULL,
    jsonb_build_object(
      'nombreCliente', 'Cliente RCD151 Actualizado',
      'nss', '91510000021',
      'curp', 'PEGJ800101HDFRRN09',
      'rfc', '',
      'celular', '5511111131',
      'correo', 'rcd151@test.local',
      'empresa', 'Empresa SA',
      'registroPatronal', 'A1234567890',
      'telefonoEmpresa', '5544444431',
      'beneficiario', jsonb_build_object('nombre', 'Bene Uno', 'parentesco', 'hijo'),
      'direccionEmpresa', jsonb_build_object(
        'calle', 'Calle 1', 'colonia', 'Col', 'municipio', 'Mty', 'cp', '64000'
      ),
      'montoMejoravit', '56000',
      'plazo', '12',
      'porcentajeCobro', '10',
      'metodoPago', 'transferencia'
    ),
    10, 'transferencia', 'Calle Real 456', NULL
  );
  PERFORM public.__rpc_rcd_reset();
  SELECT COUNT(*) INTO v_rows FROM public.cliente_datos WHERE expediente_id = v_exp;
  PERFORM public.__rpc_rcd_assert(v_rows = 1, 'sigue una fila');
  PERFORM public.__rpc_rcd_assert(
    (SELECT e.direccion_opcional FROM public.expedientes e WHERE e.id = v_exp) = 'Calle Real 456',
    'domicilio actualizado'
  );
  PERFORM public.__rpc_rcd_assert(
    (SELECT e.etapa_actual FROM public.expedientes e WHERE e.id = v_exp) = 1,
    'etapa intacta al guardar'
  );

  SELECT reingreso_manual_count INTO v_count_before FROM public.expedientes WHERE id = v_exp;

  -- Enviar incompleto (sin docs) no incrementa
  PERFORM public.__rpc_rcd_auth(v_asesor);
  BEGIN
    PERFORM public.asesor_enviar_reingreso_a_mesa(v_exp);
    PERFORM public.__rpc_rcd_reset();
    RAISE EXCEPTION 'RPC RCD TEST FAIL: debia fallar por docs';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_rcd_reset();
    PERFORM public.__rpc_rcd_assert(position('FALTAN_DOCS' IN v_err) > 0, 'bloquea por docs');
  END;

  SELECT reingreso_manual_count INTO v_count_after FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__rpc_rcd_assert(v_count_after = v_count_before, 'contador no sube si falla');

  -- Cerrado: no permite primer alta
  PERFORM public.__rpc_rcd_auth(v_asesor);
  BEGIN
    PERFORM public.save_cliente_datos_correccion(
      v_exp_closed, NULL, '5511111132', '[]'::jsonb, NULL, '{}'::jsonb,
      10, 'transferencia', 'X', NULL
    );
    PERFORM public.__rpc_rcd_reset();
    RAISE EXCEPTION 'RPC RCD TEST FAIL: cerrado debia fallar';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_rcd_reset();
    PERFORM public.__rpc_rcd_assert(position('faltan datos del cliente' IN v_err) > 0, 'cerrado bloquea');
  END;

  -- Ajeno
  PERFORM public.__rpc_rcd_auth(v_asesor2);
  BEGIN
    PERFORM public.save_cliente_datos_correccion(
      v_exp, NULL, '5511111131',
      jsonb_build_array(
        jsonb_build_object('nombre', 'Ref Uno', 'celular', '5522222231'),
        jsonb_build_object('nombre', 'Ref Dos', 'celular', '5533333331')
      ),
      NULL,
      jsonb_build_object(
        'nombreCliente', 'Hack',
        'nss', '91510000021',
        'curp', 'PEGJ800101HDFRRN09',
        'celular', '5511111131',
        'correo', 'x@test.local',
        'empresa', 'E',
        'registroPatronal', 'A1234567890',
        'telefonoEmpresa', '5544444431',
        'beneficiario', jsonb_build_object('nombre', 'B', 'parentesco', 'hijo'),
        'direccionEmpresa', jsonb_build_object(
          'calle', 'C', 'colonia', 'C', 'municipio', 'M', 'cp', '64000'
        ),
        'montoMejoravit', '56000',
        'plazo', '12',
        'porcentajeCobro', '10',
        'metodoPago', 'transferencia'
      ),
      10, 'transferencia', 'Calle', NULL
    );
    PERFORM public.__rpc_rcd_reset();
    RAISE EXCEPTION 'RPC RCD TEST FAIL: ajeno debia fallar';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_rcd_reset();
    PERFORM public.__rpc_rcd_assert(position('dueño' IN v_err) > 0, 'ajeno bloqueado');
  END;

  RAISE NOTICE 'RPC reingreso_cliente_datos_primer_alta: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_rcd_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_rcd_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_rcd_reset();
