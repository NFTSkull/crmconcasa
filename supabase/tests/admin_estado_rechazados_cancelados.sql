-- P094 B4: Admin p_estado rechazados ≠ cancelados (migración 091)
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p094_b4_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P094 B4 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p094_b4_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p094_b4_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_name TEXT;
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_admin UUID := '00000000-0000-4000-8006-000000000001';
  v_from TIMESTAMPTZ := '2026-07-20T00:00:00-06:00';
  v_to TIMESTAMPTZ := '2026-07-21T00:00:00-06:00';
  v_envio TIMESTAMPTZ := '2026-07-20T12:00:00-06:00';
  v_ids UUID[] := ARRAY[
    '00000000-0000-4000-9094-000000000001'::UUID,
    '00000000-0000-4000-9094-000000000002'::UUID,
    '00000000-0000-4000-9094-000000000003'::UUID,
    '00000000-0000-4000-9094-000000000004'::UUID
  ];
  v_id UUID;
  v_sum JSONB;
  v_cohort JSONB;
  v_page JSONB;
  v_cnt BIGINT;
BEGIN
  -- --- Estructura: predicados disjuntos en las 4 RPC ---
  FOREACH v_name IN ARRAY ARRAY[
    'admin_get_production_summary',
    'admin_list_production_by_asesor',
    'admin_get_mesa_cohort_by_etapa',
    'admin_list_mesa_envios_page'
  ]
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name
    ORDER BY p.oid DESC
    LIMIT 1;

    PERFORM public.__p094_b4_assert(v_src IS NOT NULL, format('%s existe', v_name));
    PERFORM public.__p094_b4_assert(
      position('p_estado = ''rechazados'' AND e.subestado = ''rechazado'' AND e.ciclo_estado = ''activo''' in v_src) > 0,
      format('%s: predicado rechazados activo', v_name)
    );
    PERFORM public.__p094_b4_assert(
      position('p_estado = ''cancelados'' AND e.ciclo_estado = ''cancelado''' in v_src) > 0,
      format('%s: predicado cancelados', v_name)
    );
    PERFORM public.__p094_b4_assert(
      position('subestado = ''rechazado'' OR e.ciclo_estado = ''cancelado''' in v_src) = 0,
      format('%s: sin mezcla legado rechazado OR cancelado', v_name)
    );
  END LOOP;

  -- Firma by_asesor 4 args intacta
  PERFORM public.__p094_b4_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'admin_list_production_by_asesor'
        AND pg_get_function_identity_arguments(p.oid) =
          'p_from timestamp with time zone, p_to_exclusive timestamp with time zone, p_estado text, p_asesor_id uuid'
    ),
    'firma by_asesor 4 args'
  );

  -- --- Fixtures operativos ---
  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'Org P094B4', 'org-p094-b4')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor.p094b4@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin.p094b4@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES
    (v_asesor, v_org, 'asesor.p094b4@test.local', 'Asesor P094B4', 'asesor', true),
    (v_admin, v_org, 'admin.p094b4@test.local', 'Admin P094B4', 'super_admin', true)
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      app_role = EXCLUDED.app_role,
      active = true,
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name;

  -- 1: rechazado activo (recuperable)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[1], v_org, v_asesor, 'mejoravit', '99400000001', 'P094B4 Rechazado', '8119940001',
    'interno', true, v_envio, 5, 'rechazado', 'activo'
  );
  -- 2: cancelado (subestado en_proceso)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[2], v_org, v_asesor, 'mejoravit', '99400000002', 'P094B4 Cancelado', '8119940002',
    'interno', true, v_envio, 3, 'en_proceso', 'cancelado'
  );
  -- 3: cancelado con subestado rechazado (no debe entrar en rechazados)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[3], v_org, v_asesor, 'mejoravit', '99400000003', 'P094B4 Canc+Rech', '8119940003',
    'interno', true, v_envio, 5, 'rechazado', 'cancelado'
  );
  -- 4: en proceso activo (control)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[4], v_org, v_asesor, 'mejoravit', '99400000004', 'P094B4 Activo', '8119940004',
    'interno', true, v_envio, 2, 'en_proceso', 'activo'
  );

  PERFORM public.__p094_b4_set_auth(v_admin);

  v_sum := public.admin_get_production_summary(v_from, v_to, NULL, NULL, 'rechazados');
  v_cnt := (v_sum->>'enviados_a_mesa')::BIGINT;
  PERFORM public.__p094_b4_assert(v_cnt = 1, format('summary rechazados=1, got %s', v_cnt));

  v_sum := public.admin_get_production_summary(v_from, v_to, NULL, NULL, 'cancelados');
  v_cnt := (v_sum->>'enviados_a_mesa')::BIGINT;
  PERFORM public.__p094_b4_assert(v_cnt = 2, format('summary cancelados=2, got %s', v_cnt));

  v_cohort := public.admin_get_mesa_cohort_by_etapa(v_from, v_to, NULL, 'rechazados');
  PERFORM public.__p094_b4_assert((v_cohort->>'total')::BIGINT = 1, 'cohort rechazados total=1');

  v_cohort := public.admin_get_mesa_cohort_by_etapa(v_from, v_to, NULL, 'cancelados');
  PERFORM public.__p094_b4_assert((v_cohort->>'total')::BIGINT = 2, 'cohort cancelados total=2');

  v_page := public.admin_list_mesa_envios_page(
    v_from, v_to, 1, 25, NULL, NULL, 'rechazados', NULL
  );
  PERFORM public.__p094_b4_assert((v_page->>'total_count')::BIGINT = 1, 'page rechazados=1');
  PERFORM public.__p094_b4_assert(
    (v_page->'items'->0->>'expediente_id') = v_ids[1]::text,
    'page rechazados = id1'
  );

  v_page := public.admin_list_mesa_envios_page(
    v_from, v_to, 1, 25, NULL, NULL, 'cancelados', NULL
  );
  PERFORM public.__p094_b4_assert((v_page->>'total_count')::BIGINT = 2, 'page cancelados=2');
  PERFORM public.__p094_b4_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') elem
      WHERE elem->>'expediente_id' = v_ids[1]::text
    ),
    'page cancelados no incluye rechazado activo'
  );

  PERFORM public.__p094_b4_reset_auth();

  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  RAISE NOTICE 'P094 B4 admin estado rechazados/cancelados: OK';
END;
$$;

DROP FUNCTION public.__p094_b4_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p094_b4_set_auth(UUID);
DROP FUNCTION public.__p094_b4_reset_auth();
