-- Admin snapshot: Integración solo enviados a Mesa (mig. 148; sustituye contrato 147)

CREATE OR REPLACE FUNCTION public.__p148_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P148 SNAPSHOT TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p148_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p148_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000148';
  v_asesor UUID := '00000000-0000-4000-8001-000000000148';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000149';
  v_admin UUID := '00000000-0000-4000-8006-000000000148';
  v_asesor_user UUID := '00000000-0000-4000-8002-000000000148';
  v_ids UUID[] := ARRAY[
    '00000000-0000-4000-9148-000000000001'::UUID,
    '00000000-0000-4000-9148-000000000002'::UUID,
    '00000000-0000-4000-9148-000000000003'::UUID,
    '00000000-0000-4000-9148-000000000004'::UUID,
    '00000000-0000-4000-9148-000000000005'::UUID,
    '00000000-0000-4000-9148-000000000006'::UUID,
    '00000000-0000-4000-9148-000000000007'::UUID,
    '00000000-0000-4000-9148-000000000008'::UUID,
    '00000000-0000-4000-9148-000000000009'::UUID
  ];
  v_id UUID;
  v_snap JSONB;
  v_snap2 JSONB;
  v_page JSONB;
  v_sum JSONB;
  v_from TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'America/Monterrey') AT TIME ZONE 'America/Monterrey';
  v_to TIMESTAMPTZ := v_from + interval '1 day';
  v_hoy TIMESTAMPTZ := v_from + interval '12 hours';
  v_ayer TIMESTAMPTZ := v_from - interval '1 day' + interval '12 hours';
  v_mes_atras TIMESTAMPTZ := v_from - interval '30 days';
  v_cnt BIGINT;
  v_total BIGINT;
  v_sum_etapas BIGINT;
  v_etapa2 BIGINT;
  v_etapa8 BIGINT;
  v_etapa1 BIGINT;
  v_etapa11 BIGINT;
  v_etapa4 BIGINT;
  v_paso3 BIGINT;
  v_granted BOOLEAN;
  v_err TEXT;
BEGIN
  PERFORM public.__p148_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_expedientes_snapshot_etapas'
    ),
    'RPC snapshot existe'
  );

  SELECT has_function_privilege('authenticated', 'public.admin_expedientes_snapshot_etapas(uuid,text,text)', 'EXECUTE')
  INTO v_granted;
  PERFORM public.__p148_assert(v_granted, 'authenticated EXECUTE snapshot');

  SELECT has_function_privilege('anon', 'public.admin_expedientes_snapshot_etapas(uuid,text,text)', 'EXECUTE')
  INTO v_granted;
  PERFORM public.__p148_assert(NOT coalesce(v_granted, false), 'anon sin EXECUTE snapshot');

  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'Org P148', 'org-p148')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor.p148@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_asesor2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor2.p148@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin.p148@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_asesor_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesoruser.p148@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES
    (v_asesor, v_org, 'asesor.p148@test.local', 'Asesor P148', 'asesor', true),
    (v_asesor2, v_org, 'asesor2.p148@test.local', 'Asesor2 P148', 'asesor', true),
    (v_admin, v_org, 'admin.p148@test.local', 'Admin P148', 'super_admin', true),
    (v_asesor_user, v_org, 'asesoruser.p148@test.local', 'Asesor User P148', 'asesor', true)
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      app_role = EXCLUDED.app_role,
      active = true,
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name;

  -- 1: enviado hoy etapa 2 (Registro)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[1], v_org, v_asesor, 'mejoravit', '14800000001', 'P148 Hoy Etapa2', '8111480001',
    'interno', true, v_hoy, 2, 'en_proceso', 'activo'
  );
  -- 2: enviado hace un mes etapa 8
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[2], v_org, v_asesor, 'mejoravit', '14800000002', 'P148 Mes Etapa8', '8111480002',
    'interno', true, v_mes_atras, 8, 'en_proceso', 'activo'
  );
  -- 3: NO enviado a Mesa etapa 1 (pre-Mesa — NO debe contar)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[3], v_org, v_asesor, 'mejoravit', '14800000003', 'P148 SinMesa Etapa1', '8111480003',
    'interno', false, NULL, 1, 'en_proceso', 'activo'
  );
  -- 4: antiguo etapa 11
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[4], v_org, v_asesor, 'mejoravit', '14800000004', 'P148 Antiguo Etapa11', '8111480004',
    'interno', true, v_mes_atras - interval '60 days', 11, 'en_proceso', 'activo'
  );
  -- 5: soft-deleted (excluido)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado, deleted_at
  ) VALUES (
    v_ids[5], v_org, v_asesor, 'mejoravit', '14800000005', 'P148 Deleted', '8111480005',
    'interno', true, v_hoy, 3, 'en_proceso', 'activo', now()
  );
  -- 6: otro asesor etapa 2
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[6], v_org, v_asesor2, 'mejoravit', '14800000006', 'P148 OtroAsesor', '8111480006',
    'interno', true, v_hoy, 2, 'en_proceso', 'activo'
  );
  -- 7: legacy etapa 4
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[7], v_org, v_asesor, 'mejoravit', '14800000007', 'P148 Legacy4', '8111480007',
    'interno', true, v_mes_atras, 4, 'en_proceso', 'activo'
  );
  -- 8: Integración enviada ayer
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[8], v_org, v_asesor, 'mejoravit', '14800000008', 'P148 IntegAyer', '8111480008',
    'interno', true, v_ayer, 1, 'en_validacion_mesa', 'activo'
  );
  -- 9: Integración enviada hace meses
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[9], v_org, v_asesor, 'mejoravit', '14800000009', 'P148 IntegMeses', '8111480009',
    'interno', true, v_mes_atras, 1, 'en_validacion_mesa', 'activo'
  );

  PERFORM public.__p148_set_auth(v_admin);

  v_snap := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
  v_total := (v_snap->>'total_actual')::BIGINT;
  -- Contados del fixture: 1,2,4,6,7,8,9 = 7 (excluye 3 pre-Mesa y 5 deleted)
  PERFORM public.__p148_assert(v_total >= 7, format('snapshot total>=7 got %s', v_total));

  SELECT coalesce(sum((x->>'count')::BIGINT), 0) INTO v_sum_etapas
  FROM jsonb_array_elements(v_snap->'by_etapa') x;
  PERFORM public.__p148_assert(v_sum_etapas = v_total, format('suma etapas=%s total=%s', v_sum_etapas, v_total));

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

  PERFORM public.__p148_assert(v_etapa2 >= 2, 'etapa 2 incluye hoy + otro asesor');
  PERFORM public.__p148_assert(v_etapa8 >= 1, 'etapa 8 incluye mes atras');
  PERFORM public.__p148_assert(v_etapa1 >= 2, 'etapa 1 solo enviados (ayer+meses)');
  PERFORM public.__p148_assert(v_etapa11 >= 1, 'etapa 11 incluye antiguo');
  PERFORM public.__p148_assert(v_etapa4 >= 1, 'etapa 4 legacy en by_etapa');
  PERFORM public.__p148_assert(v_paso3 >= 1, 'paso visual 3 absorbe legacy 4');

  -- Pre-Mesa no en tarjeta ni drilldown
  v_page := public.admin_list_expedientes_snapshot_page(
    1, 100, NULL::uuid, 1::smallint, NULL::text, NULL::text
  );
  PERFORM public.__p148_assert(
    (v_page->>'total_count')::BIGINT = v_etapa1,
    'drilldown Integración = tarjeta'
  );
  PERFORM public.__p148_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[3]::text
    ),
    'pre-Mesa no en drilldown Integración'
  );
  PERFORM public.__p148_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[8]::text
    ),
    'Integración enviada ayer en drilldown'
  );
  PERFORM public.__p148_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[9]::text
    ),
    'Integración enviada hace meses en drilldown'
  );

  -- Buscar pre-Mesa = 0
  v_snap2 := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, 'SinMesa');
  PERFORM public.__p148_assert((v_snap2->>'total_actual')::BIGINT = 0, 'buscar SinMesa = 0');

  -- KPI periodo intacto
  v_sum := public.admin_get_production_summary(v_from, v_to, NULL, NULL, NULL);
  v_cnt := (v_sum->>'enviados_a_mesa')::BIGINT;
  PERFORM public.__p148_assert(v_cnt >= 2, format('KPI hoy enviados>=2 got %s', v_cnt));

  -- Snapshot estable (periodo no aplica)
  v_snap2 := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
  PERFORM public.__p148_assert(
    (v_snap2->>'total_actual')::BIGINT = v_total,
    'snapshot estable entre llamadas'
  );
  SELECT (x->>'count')::BIGINT INTO v_cnt
  FROM jsonb_array_elements(v_snap2->'by_etapa') x WHERE (x->>'etapa')::INT = 1;
  PERFORM public.__p148_assert(v_cnt = v_etapa1, 'Integración estable (Hoy vs Este mes N/A en RPC)');

  -- Mover etapa 8→5: total estable; Registro intacto
  PERFORM public.__p148_reset_auth();
  UPDATE public.expedientes SET etapa_actual = 5 WHERE id = v_ids[2];
  PERFORM public.__p148_set_auth(v_admin);
  v_snap2 := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
  PERFORM public.__p148_assert(
    (v_snap2->>'total_actual')::BIGINT = v_total,
    'total estable al cambiar etapa'
  );
  SELECT coalesce((x->>'count')::BIGINT, 0) INTO v_cnt
  FROM jsonb_array_elements(v_snap2->'by_etapa') x WHERE (x->>'etapa')::INT = 2;
  PERFORM public.__p148_assert(v_cnt = v_etapa2, 'Registro conserva conteo al mover otra etapa');
  PERFORM public.__p148_reset_auth();
  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_ids[2];
  PERFORM public.__p148_set_auth(v_admin);

  -- Soft-deleted no cuenta
  PERFORM public.__p148_assert(
    NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        (public.admin_list_expedientes_snapshot_page(1, 100, NULL::uuid, NULL::smallint, NULL::text, 'P148 Deleted'))->'items'
      ) it
      WHERE it->>'expediente_id' = v_ids[5]::text
    ),
    'deleted no en listado'
  );

  -- Filtro asesor
  v_snap2 := public.admin_expedientes_snapshot_etapas(v_asesor2, NULL::text, NULL::text);
  PERFORM public.__p148_assert((v_snap2->>'total_actual')::BIGINT = 1, 'filtro asesor2 = 1');

  -- Reingreso manual: mismo id, count 1
  PERFORM public.__p148_reset_auth();
  UPDATE public.expedientes
  SET reingreso_manual_count = 1, reingreso_manual_at = now()
  WHERE id = v_ids[1];
  PERFORM public.__p148_set_auth(v_admin);
  v_snap2 := public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, 'Hoy Etapa2');
  PERFORM public.__p148_assert((v_snap2->>'total_actual')::BIGINT = 1, 'reingreso manual cuenta 1');

  -- No autorizado
  PERFORM public.__p148_set_auth(v_asesor_user);
  BEGIN
    PERFORM public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
    PERFORM public.__p148_assert(false, 'asesor debió fallar');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      PERFORM public.__p148_assert(
        position('solo super_admin' in v_err) > 0 OR position('admin_production' in v_err) > 0,
        format('asesor bloqueado: %s', v_err)
      );
  END;

  PERFORM public.__p148_reset_auth();
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.admin_expedientes_snapshot_etapas(NULL::uuid, NULL::text, NULL::text);
    PERFORM public.__p148_assert(false, 'anon debió fallar');
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  PERFORM public.__p148_reset_auth();

  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  RAISE NOTICE 'P148 snapshot Integración solo enviados a Mesa: OK';
END;
$$;

DROP FUNCTION public.__p148_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p148_set_auth(UUID);
DROP FUNCTION public.__p148_reset_auth();
