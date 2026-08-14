-- P182: admin_search_cliente_expedientes — SQL local / rollback al final.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p182_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P182 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p182_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p182_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000182';
  v_org2 UUID := '00000000-0000-4000-8000-000000000183';
  v_asesor UUID := '00000000-0000-4000-8001-000000000182';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000183';
  v_admin UUID := '00000000-0000-4000-8006-000000000182';
  v_admin2 UUID := '00000000-0000-4000-8006-000000000183';
  v_asesor_user UUID := '00000000-0000-4000-8002-000000000182';
  v_mesa UUID := '00000000-0000-4000-8003-000000000182';
  v_ids UUID[] := ARRAY[
    '00000000-0000-4000-9182-000000000001'::UUID,
    '00000000-0000-4000-9182-000000000002'::UUID,
    '00000000-0000-4000-9182-000000000003'::UUID,
    '00000000-0000-4000-9182-000000000004'::UUID,
    '00000000-0000-4000-9182-000000000005'::UUID,
    '00000000-0000-4000-9182-000000000006'::UUID,
    '00000000-0000-4000-9182-000000000007'::UUID,
    '00000000-0000-4000-9182-000000000008'::UUID,
    '00000000-0000-4000-9182-000000000009'::UUID,
    '00000000-0000-4000-9182-000000000010'::UUID,
    '00000000-0000-4000-9182-000000000011'::UUID
  ];
  v_intento UUID := '00000000-0000-4000-9182-000000000101'::UUID;
  v_intento2 UUID := '00000000-0000-4000-9182-000000000102'::UUID;
  v_id UUID;
  v_res JSONB;
  v_cnt INT;
  v_err TEXT;
  v_granted BOOLEAN;
BEGIN
  PERFORM public.__p182_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_search_cliente_expedientes'
    ),
    'RPC existe'
  );

  SELECT has_function_privilege(
    'authenticated',
    'public.admin_search_cliente_expedientes(text,integer,uuid)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p182_assert(v_granted, 'authenticated EXECUTE');

  SELECT has_function_privilege(
    'anon',
    'public.admin_search_cliente_expedientes(text,integer,uuid)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p182_assert(NOT coalesce(v_granted, false), 'anon sin EXECUTE');

  PERFORM public.__p182_reset_auth();

  UPDATE public.expedientes SET reprecalificacion_pendiente_id = NULL
  WHERE id = ANY (v_ids);
  DELETE FROM public.expediente_precalificacion_intentos WHERE id IN (v_intento, v_intento2)
    OR expediente_id = ANY (v_ids);
  DELETE FROM public.editor_decisions WHERE expediente_id = ANY (v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY (v_ids);
  IF to_regclass('public.expediente_paso_visual_transiciones') IS NOT NULL THEN
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY (v_ids);
  END IF;
  DELETE FROM public.expedientes WHERE id = ANY (v_ids);

  INSERT INTO public.organizations (id, name, slug)
  VALUES
    (v_org, 'Org P182', 'org-p182'),
    (v_org2, 'Org P182 B', 'org-p182-b')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'naty.p182@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_asesor2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'paty.p182@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin.p182@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin2.p182@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_asesor_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesoruser.p182@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_mesa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'mesa.p182@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, tipo_mesa, active)
  VALUES
    (v_asesor, v_org, 'naty.p182@test.local', 'Naty P182', 'asesor', NULL, true),
    (v_asesor2, v_org, 'paty.p182@test.local', 'Paty Gutierrez', 'asesor', NULL, true),
    (v_admin, v_org, 'admin.p182@test.local', 'Admin P182', 'super_admin', NULL, true),
    (v_admin2, v_org2, 'admin2.p182@test.local', 'Admin2 P182', 'super_admin', NULL, true),
    (v_asesor_user, v_org, 'asesoruser.p182@test.local', 'Asesor User P182', 'asesor', NULL, true),
    (v_mesa, v_org, 'mesa.p182@test.local', 'Mesa P182', 'mesa_interno', 'interno', true)
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      app_role = EXCLUDED.app_role,
      tipo_mesa = EXCLUDED.tipo_mesa,
      active = true,
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name;

  -- 1+2 mismo NSS pre-Mesa (P179): Naty + Paty
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_ids[1], v_org, v_asesor, 'mejoravit', '18239742449', 'Patricia P182 Naty', '8111820001',
     'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_ids[2], v_org, v_asesor2, 'mejoravit', '18239742449', 'Patricia P182 Paty', '8111820002',
     'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_ids[3], v_org, v_asesor, 'mejoravit', '18200000003', 'Cliente Mesa P182', '8111820003',
     'interno', true, now() - interval '3 weeks', 2, 'en_validacion_mesa', 'activo'),
    (v_ids[4], v_org, v_asesor, 'mejoravit', '18200000004', 'No Cumple P182', '8111820004',
     'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_ids[5], v_org, v_asesor, 'mejoravit', '18200000005', 'Reprecal P182', '8111820005',
     'interno', true, now() - interval '10 days', 2, 'en_proceso', 'activo'),
    (v_ids[6], v_org, v_asesor, 'mejoravit', '18200000006', 'Cambio Prog P182', '8111820006',
     'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_ids[7], v_org2, v_admin2, 'mejoravit', '18200000007', 'Patricia OtraOrg', '8111820007',
     'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_ids[8], v_org, v_asesor, 'mejoravit', '18200000008', 'Deleted P182', '8111820008',
     'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_ids[9], v_org, v_asesor, 'mejoravit', '18200000009', 'P182LimitAlpha', '8111820009',
     'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_ids[10], v_org, v_asesor, 'mejoravit', '18200000010', 'P182LimitBeta', '8111820010',
     'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_ids[11], v_org, v_asesor, 'mejoravit', '18200000011', 'P182LimitGamma', '8111820011',
     'interno', false, NULL, 1, 'pendiente', 'activo');

  UPDATE public.expedientes SET deleted_at = now() WHERE id = v_ids[8];

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar, no_cumple_at
  ) VALUES
    (v_ids[3], v_org, 'aprobado', 80000, now() - interval '3 weeks', 80000, NULL),
    (v_ids[4], v_org, 'no_cumple', NULL, NULL, NULL, now() - interval '2 days'),
    (v_ids[5], v_org, 'aprobado', 50000, now() - interval '10 days', 50000, NULL);

  INSERT INTO public.expediente_precalificacion_intentos (
    id, organization_id, expediente_id, asesor_id, programa, programa_solicitado,
    nss, cliente_nombre, telefono_cliente, decision
  ) VALUES
    (v_intento, v_org, v_ids[5], v_asesor, 'mejoravit', 'mejoravit',
     '18200000005', 'Reprecal P182', '8111820005', 'pendiente'),
    (v_intento2, v_org, v_ids[6], v_asesor, 'mejoravit', 'compro_tu_casa',
     '18200000006', 'Cambio Prog P182', '8111820006', 'pendiente');

  UPDATE public.expedientes SET reprecalificacion_pendiente_id = v_intento WHERE id = v_ids[5];
  UPDATE public.expedientes SET reprecalificacion_pendiente_id = v_intento2 WHERE id = v_ids[6];

  PERFORM public.__p182_set_auth(v_admin);

  -- vacío
  v_res := public.admin_search_cliente_expedientes('', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 0, 'A vacío');

  -- A/B nombre
  v_res := public.admin_search_cliente_expedientes('Patricia P182 Naty', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 1, 'A exacto');
  v_res := public.admin_search_cliente_expedientes('Patricia', 20, NULL);
  v_cnt := jsonb_array_length(v_res->'items');
  PERFORM public.__p182_assert(v_cnt >= 2, format('B parcial >=2 got %s', v_cnt));

  -- C/D NSS
  v_res := public.admin_search_cliente_expedientes('18239742449', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 2, 'C NSS completo 2 filas');
  v_res := public.admin_search_cliente_expedientes('42449', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 2, 'D NSS parcial');
  v_res := public.admin_search_cliente_expedientes('182-397-42449', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 2, 'D NSS con guiones');

  -- E asesor
  v_res := public.admin_search_cliente_expedientes('18239742449', 20, v_asesor);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 1, 'E filtro asesor Naty');
  PERFORM public.__p182_assert(
    v_res->'items'->0->>'asesor_id' = v_asesor::text,
    'E asesor_id'
  );

  -- F 0
  v_res := public.admin_search_cliente_expedientes('zzz-no-hit-p182', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 0, 'F 0 resultados');

  -- G/H multi pre-Mesa mismo NSS, identidad expediente
  v_res := public.admin_search_cliente_expedientes('18239742449', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 2, 'G 2 expedientes');
  PERFORM public.__p182_assert(
    (SELECT COUNT(DISTINCT x->>'expediente_id') FROM jsonb_array_elements(v_res->'items') x) = 2,
    'G ids distintos'
  );
  PERFORM public.__p182_assert(
    (SELECT bool_and((x->>'submitted_to_mesa')::boolean = false)
     FROM jsonb_array_elements(v_res->'items') x),
    'H pre-Mesa aparece'
  );

  -- I post-Mesa
  v_res := public.admin_search_cliente_expedientes('Cliente Mesa P182', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 1, 'I post-Mesa');
  PERFORM public.__p182_assert(
    (v_res->'items'->0->>'submitted_to_mesa')::boolean = true,
    'I enviado'
  );

  -- J pendiente (sin editor_decisions → pendiente)
  v_res := public.admin_search_cliente_expedientes('Patricia P182 Naty', 20, NULL);
  PERFORM public.__p182_assert(v_res->'items'->0->>'editor_decision' = 'pendiente', 'J pendiente');

  -- K aprobado + monto
  v_res := public.admin_search_cliente_expedientes('Cliente Mesa P182', 20, NULL);
  PERFORM public.__p182_assert(v_res->'items'->0->>'editor_decision' = 'aprobado', 'K aprobado');
  PERFORM public.__p182_assert((v_res->'items'->0->>'monto_aprobado')::numeric = 80000, 'K monto');

  -- L no_cumple
  v_res := public.admin_search_cliente_expedientes('No Cumple P182', 20, NULL);
  PERFORM public.__p182_assert(v_res->'items'->0->>'editor_decision' = 'no_cumple', 'L no_cumple');

  -- M re-precal
  v_res := public.admin_search_cliente_expedientes('Reprecal P182', 20, NULL);
  PERFORM public.__p182_assert(
    (v_res->'items'->0->>'precal_pending')::boolean = true,
    'M pending'
  );
  PERFORM public.__p182_assert(v_res->'items'->0->>'editor_decision' = 'aprobado', 'M vigente aprobado');

  -- N cambio programa
  v_res := public.admin_search_cliente_expedientes('Cambio Prog P182', 20, NULL);
  PERFORM public.__p182_assert(v_res->'items'->0->>'programa' = 'mejoravit', 'N vigente');
  PERFORM public.__p182_assert(
    v_res->'items'->0->>'programa_solicitado' = 'compro_tu_casa',
    'N solicitado'
  );

  -- deleted no aparece
  v_res := public.admin_search_cliente_expedientes('Deleted P182', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 0, 'deleted oculto');

  -- O otra org
  v_res := public.admin_search_cliente_expedientes('Patricia OtraOrg', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 0, 'O org1 no ve org2');
  PERFORM public.__p182_set_auth(v_admin2);
  v_res := public.admin_search_cliente_expedientes('Patricia OtraOrg', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 1, 'O admin2 ve su org');
  v_res := public.admin_search_cliente_expedientes('18239742449', 20, NULL);
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 0, 'O admin2 no ve org1');

  PERFORM public.__p182_set_auth(v_admin);

  -- Q limit clamp
  v_res := public.admin_search_cliente_expedientes('P182Limit', 0, NULL);
  PERFORM public.__p182_assert((v_res->>'limit')::int = 1, 'Q clamp 0→1');
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 1, 'Q 1 item');
  v_res := public.admin_search_cliente_expedientes('P182Limit', 999, NULL);
  PERFORM public.__p182_assert((v_res->>'limit')::int = 50, 'Q clamp 999→50');
  PERFORM public.__p182_assert(jsonb_array_length(v_res->'items') = 3, 'Q 3 items');

  -- P rol no admin
  PERFORM public.__p182_set_auth(v_asesor_user);
  BEGIN
    PERFORM public.admin_search_cliente_expedientes('Patricia', 20, NULL);
    PERFORM public.__p182_assert(false, 'asesor debió fallar');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      PERFORM public.__p182_assert(
        position('solo super_admin' in v_err) > 0 OR position('admin_production' in v_err) > 0,
        format('P asesor deny: %s', v_err)
      );
  END;

  PERFORM public.__p182_set_auth(v_mesa);
  BEGIN
    PERFORM public.admin_search_cliente_expedientes('Patricia', 20, NULL);
    PERFORM public.__p182_assert(false, 'mesa debió fallar');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      PERFORM public.__p182_assert(
        position('solo super_admin' in v_err) > 0 OR position('admin_production' in v_err) > 0,
        format('P mesa deny: %s', v_err)
      );
  END;

  PERFORM public.__p182_reset_auth();
  PERFORM set_config('role', 'anon', true);
  BEGIN
    PERFORM public.admin_search_cliente_expedientes('Patricia', 20, NULL);
    PERFORM public.__p182_assert(false, 'anon debió fallar');
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  PERFORM public.__p182_reset_auth();

  UPDATE public.expedientes SET reprecalificacion_pendiente_id = NULL
  WHERE id = ANY (v_ids);
  DELETE FROM public.expediente_precalificacion_intentos WHERE id IN (v_intento, v_intento2)
    OR expediente_id = ANY (v_ids);
  DELETE FROM public.editor_decisions WHERE expediente_id = ANY (v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY (v_ids);
  IF to_regclass('public.expediente_paso_visual_transiciones') IS NOT NULL THEN
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY (v_ids);
  END IF;
  DELETE FROM public.expedientes WHERE id = ANY (v_ids);

  RAISE NOTICE 'P182 PASS';
END;
$$;

DROP FUNCTION public.__p182_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p182_set_auth(UUID);
DROP FUNCTION public.__p182_reset_auth();
