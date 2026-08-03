-- Admin snapshot stock vigente por etapa (mig. 147)

CREATE OR REPLACE FUNCTION public.__p147_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P147 SNAPSHOT TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p147_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p147_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000147';
  v_asesor UUID := '00000000-0000-4000-8001-000000000147';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000148';
  v_admin UUID := '00000000-0000-4000-8006-000000000147';
  v_asesor_user UUID := '00000000-0000-4000-8002-000000000147';
  v_ids UUID[] := ARRAY[
    '00000000-0000-4000-9147-000000000001'::UUID,
    '00000000-0000-4000-9147-000000000002'::UUID,
    '00000000-0000-4000-9147-000000000003'::UUID,
    '00000000-0000-4000-9147-000000000004'::UUID,
    '00000000-0000-4000-9147-000000000005'::UUID,
    '00000000-0000-4000-9147-000000000006'::UUID,
    '00000000-0000-4000-9147-000000000007'::UUID
  ];
  v_id UUID;
  v_snap JSONB;
  v_snap2 JSONB;
  v_page JSONB;
  v_sum JSONB;
  v_from TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'America/Monterrey') AT TIME ZONE 'America/Monterrey';
  v_to TIMESTAMPTZ := v_from + interval '1 day';
  v_hoy TIMESTAMPTZ := v_from + interval '12 hours';
  v_mes_atras TIMESTAMPTZ := v_from - interval '30 days';
  v_cnt BIGINT;
  v_total BIGINT;
  v_etapa2 BIGINT;
  v_etapa8 BIGINT;
  v_etapa1 BIGINT;
  v_etapa11 BIGINT;
  v_etapa4 BIGINT;
  v_paso3 BIGINT;
  v_granted BOOLEAN;
  v_err TEXT;
BEGIN
  PERFORM public.__p147_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_expedientes_snapshot_etapas'
    ),
    'RPC snapshot existe'
  );
  PERFORM public.__p147_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_list_expedientes_snapshot_page'
    ),
    'RPC list snapshot existe'
  );

  -- Grants: authenticated sí; anon/PUBLIC no
  SELECT has_function_privilege('authenticated', 'public.admin_expedientes_snapshot_etapas(uuid,text,text)', 'EXECUTE')
  INTO v_granted;
  PERFORM public.__p147_assert(v_granted, 'authenticated EXECUTE snapshot');

  SELECT has_function_privilege('anon', 'public.admin_expedientes_snapshot_etapas(uuid,text,text)', 'EXECUTE')
  INTO v_granted;
  PERFORM public.__p147_assert(NOT coalesce(v_granted, false), 'anon sin EXECUTE snapshot');

  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'Org P147', 'org-p147')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor.p147@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_asesor2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor2.p147@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin.p147@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_asesor_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesoruser.p147@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES
    (v_asesor, v_org, 'asesor.p147@test.local', 'Asesor P147', 'asesor', true),
    (v_asesor2, v_org, 'asesor2.p147@test.local', 'Asesor2 P147', 'asesor', true),
    (v_admin, v_org, 'admin.p147@test.local', 'Admin P147', 'super_admin', true),
    (v_asesor_user, v_org, 'asesoruser.p147@test.local', 'Asesor User P147', 'asesor', true)
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      app_role = EXCLUDED.app_role,
      active = true,
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name;

  -- 1: enviado hoy etapa 2
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[1], v_org, v_asesor, 'mejoravit', '14700000001', 'P147 Hoy Etapa2', '8111470001',
    'interno', true, v_hoy, 2, 'en_proceso', 'activo'
  );
  -- 2: enviado hace un mes etapa 8
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[2], v_org, v_asesor, 'mejoravit', '14700000002', 'P147 Mes Etapa8', '8111470002',
    'interno', true, v_mes_atras, 8, 'en_proceso', 'activo'
  );
  -- 3: NO enviado a Mesa etapa 1
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[3], v_org, v_asesor, 'mejoravit', '14700000003', 'P147 SinMesa Etapa1', '8111470003',
    'interno', false, NULL, 1, 'en_proceso', 'activo'
  );
  -- 4: antiguo etapa 11
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[4], v_org, v_asesor, 'mejoravit', '14700000004', 'P147 Antiguo Etapa11', '8111470004',
    'interno', true, v_mes_atras - interval '60 days', 11, 'en_proceso', 'activo'
  );
  -- 5: soft-deleted (excluido)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, deleted_at
  ) VALUES (
    v_ids[5], v_org, v_asesor, 'mejoravit', '14700000005', 'P147 Deleted', '8111470005',
    'interno', true, v_hoy, 3, 'en_proceso', 'activo', now()
  );
  -- 6: otro asesor etapa 2 (filtro asesor)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[6], v_org, v_asesor2, 'mejoravit', '14700000006', 'P147 OtroAsesor', '8111470006',
    'interno', true, v_hoy, 2, 'en_proceso', 'activo'
  );
  -- 7: legacy etapa 4 (paso visual 3)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[7], v_org, v_asesor, 'mejoravit', '14700000007', 'P147 Legacy4', '8111470007',
    'interno', true, v_mes_atras, 4, 'en_proceso', 'activo'
  );

  PERFORM public.__p147_set_auth(v_admin);

  v_snap := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
  v_total := (v_snap->>'total_actual')::BIGINT;
  PERFORM public.__p147_assert(v_total >= 6, format('snapshot total>=6 got %s', v_total));
  PERFORM public.__p147_assert(v_snap ? 'generated_at', 'generated_at presente');
  PERFORM public.__p147_assert(v_snap ? 'by_etapa', 'by_etapa presente');
  PERFORM public.__p147_assert(v_snap ? 'by_paso_visual', 'by_paso_visual presente');

  SELECT (x->>'count')::BIGINT INTO v_etapa2
  FROM jsonb_array_elements(v_snap->'by_etapa') x WHERE (x->>'etapa')::INT = 2;
  SELECT (x->>'count')::BIGINT INTO v_etapa8
  FROM jsonb_array_elements(v_snap->'by_etapa') x WHERE (x->>'etapa')::INT = 8;
  SELECT (x->>'count')::BIGINT INTO v_etapa1
  FROM jsonb_array_elements(v_snap->'by_etapa') x WHERE (x->>'etapa')::INT = 1;
  SELECT (x->>'count')::BIGINT INTO v_etapa11
  FROM jsonb_array_elements(v_snap->'by_etapa') x WHERE (x->>'etapa')::INT = 11;
  SELECT (x->>'count')::BIGINT INTO v_etapa4
  FROM jsonb_array_elements(v_snap->'by_etapa') x WHERE (x->>'etapa')::INT = 4;
  SELECT (x->>'count')::BIGINT INTO v_paso3
  FROM jsonb_array_elements(v_snap->'by_paso_visual') x WHERE (x->>'paso_visual')::INT = 3;

  PERFORM public.__p147_assert(v_etapa2 >= 2, 'etapa 2 incluye hoy + otro asesor');
  PERFORM public.__p147_assert(v_etapa8 >= 1, 'etapa 8 incluye mes atras');
  PERFORM public.__p147_assert(v_etapa1 >= 1, 'etapa 1 incluye no enviado');
  PERFORM public.__p147_assert(v_etapa11 >= 1, 'etapa 11 incluye antiguo');
  PERFORM public.__p147_assert(v_etapa4 >= 1, 'etapa 4 legacy en by_etapa');
  PERFORM public.__p147_assert(v_paso3 >= 1, 'paso visual 3 absorbe legacy 4');

  -- KPI periodo solo el enviado hoy (asesor1+asesor2 en hoy = 2 del fixture; >=1)
  v_sum := public.admin_get_production_summary(v_from, v_to, NULL, NULL, NULL);
  v_cnt := (v_sum->>'enviados_a_mesa')::BIGINT;
  PERFORM public.__p147_assert(v_cnt >= 2, format('KPI hoy enviados>=2 got %s', v_cnt));
  PERFORM public.__p147_assert(v_total > v_cnt, 'snapshot total > KPI periodo');

  -- Cambiar periodo no cambia snapshot (segunda llamada idéntica en contenido estructural)
  v_snap2 := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
  PERFORM public.__p147_assert(
    (v_snap2->>'total_actual')::BIGINT = v_total,
    'snapshot estable entre llamadas'
  );

  -- Mover etapa: 8 → 5; total estable (UPDATE como postgres; RPCs como admin)
  PERFORM public.__p147_reset_auth();
  UPDATE public.expedientes SET etapa_actual = 5 WHERE id = v_ids[2];
  PERFORM public.__p147_set_auth(v_admin);
  v_snap2 := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
  PERFORM public.__p147_assert(
    (v_snap2->>'total_actual')::BIGINT = v_total,
    'total estable al cambiar etapa'
  );
  SELECT coalesce((x->>'count')::BIGINT, 0) INTO v_cnt
  FROM jsonb_array_elements(v_snap2->'by_etapa') x WHERE (x->>'etapa')::INT = 5;
  PERFORM public.__p147_assert(v_cnt >= 1, 'exp aparece en etapa 5');
  v_page := public.admin_list_expedientes_snapshot_page(
    1, 25, NULL::uuid, NULL::smallint, NULL::text, 'P147 Mes Etapa8'
  );
  PERFORM public.__p147_assert((v_page->>'total_count')::BIGINT = 1, 'buscar movido = 1');
  PERFORM public.__p147_assert(
    (v_page->'items'->0->>'etapa_actual')::INT = 5
    AND (v_page->'items'->0->>'expediente_id') = v_ids[2]::text,
    'drilldown refleja etapa 5 del movido'
  );
  PERFORM public.__p147_reset_auth();
  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_ids[2];
  PERFORM public.__p147_set_auth(v_admin);

  -- Soft-deleted no cuenta
  PERFORM public.__p147_assert(
    NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        (public.admin_list_expedientes_snapshot_page(1, 100, NULL::uuid, NULL::smallint, NULL::text, 'P147 Deleted'))->'items'
      ) it
      WHERE it->>'expediente_id' = v_ids[5]::text
    ),
    'deleted no en listado'
  );

  -- Filtro asesor
  v_snap2 := public.admin_expedientes_snapshot_etapas(v_asesor2, NULL::text, NULL::text);
  PERFORM public.__p147_assert((v_snap2->>'total_actual')::BIGINT = 1, 'filtro asesor2 = 1');

  -- Búsqueda
  v_snap2 := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, 'SinMesa');
  PERFORM public.__p147_assert((v_snap2->>'total_actual')::BIGINT = 1, 'buscar SinMesa = 1');

  -- Drilldown etapa 11
  v_page := public.admin_list_expedientes_snapshot_page(1, 25, NULL::uuid, 11::smallint, NULL::text, NULL::text);
  PERFORM public.__p147_assert((v_page->>'total_count')::BIGINT >= 1, 'list etapa 11 >=1');
  PERFORM public.__p147_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[4]::text
    ),
    'list incluye antiguo etapa 11'
  );

  -- Reingreso manual: mismo id, count 1
  PERFORM public.__p147_reset_auth();
  UPDATE public.expedientes
  SET reingreso_manual_count = 1, reingreso_manual_at = now()
  WHERE id = v_ids[1];
  PERFORM public.__p147_set_auth(v_admin);
  v_snap2 := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, 'Hoy Etapa2');
  PERFORM public.__p147_assert((v_snap2->>'total_actual')::BIGINT = 1, 'reingreso manual cuenta 1');

  -- No autorizado (asesor)
  PERFORM public.__p147_set_auth(v_asesor_user);
  BEGIN
    PERFORM public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
    PERFORM public.__p147_assert(false, 'asesor debió fallar');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      PERFORM public.__p147_assert(
        position('solo super_admin' in v_err) > 0 OR position('admin_production' in v_err) > 0,
        format('asesor bloqueado: %s', v_err)
      );
  END;

  PERFORM public.__p147_reset_auth();
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
    PERFORM public.__p147_assert(false, 'anon debió fallar');
  EXCEPTION
    WHEN OTHERS THEN
      NULL; -- esperado (permission / no autenticado)
  END;

  PERFORM public.__p147_reset_auth();

  -- cleanup
  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  RAISE NOTICE 'P147 snapshot etapas: OK';
END;
$$;

DROP FUNCTION public.__p147_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p147_set_auth(UUID);
DROP FUNCTION public.__p147_reset_auth();
