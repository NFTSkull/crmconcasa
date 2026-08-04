-- P149: admin stage history report

CREATE OR REPLACE FUNCTION public.__p149_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P149 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p149_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p149_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000149';
  v_asesor UUID := '00000000-0000-4000-8001-000000000149';
  v_admin UUID := '00000000-0000-4000-8006-000000000149';
  v_asesor_user UUID := '00000000-0000-4000-8002-000000000149';
  v_ids UUID[] := ARRAY[
    '00000000-0000-4000-9149-000000000001'::UUID,
    '00000000-0000-4000-9149-000000000002'::UUID,
    '00000000-0000-4000-9149-000000000003'::UUID
  ];
  v_id UUID;
  v_sum JSONB;
  v_page JSONB;
  v_from DATE := (now() AT TIME ZONE 'America/Monterrey')::date - 14;
  v_to DATE := (now() AT TIME ZONE 'America/Monterrey')::date;
  v_cnt BIGINT;
  v_err TEXT;
  v_granted BOOLEAN;
BEGIN
  PERFORM public.__p149_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_stage_history_report_summary'
    ),
    'RPC summary existe'
  );

  SELECT has_function_privilege(
    'authenticated',
    'public.admin_stage_history_report_summary(uuid[],smallint[],text,date,date,text,text)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p149_assert(v_granted, 'authenticated EXECUTE summary');

  SELECT has_function_privilege(
    'anon',
    'public.admin_stage_history_report_summary(uuid[],smallint[],text,date,date,text,text)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p149_assert(NOT coalesce(v_granted, false), 'anon sin EXECUTE');

  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'Org P149', 'org-p149')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor.p149@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin.p149@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_asesor_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesoruser.p149@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES
    (v_asesor, v_org, 'asesor.p149@test.local', 'Asesor P149', 'asesor', true),
    (v_admin, v_org, 'admin.p149@test.local', 'Admin P149', 'super_admin', true),
    (v_asesor_user, v_org, 'asesoruser.p149@test.local', 'Asesor User P149', 'asesor', true)
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      app_role = EXCLUDED.app_role,
      active = true,
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name;

  -- Exp 1: entra Registro (2) hace 3 días, avanza a bio (3) ayer; hoy etapa 11
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[1], v_org, v_asesor, 'mejoravit', '14900000001', 'P149 Hist Registro', '8111490001',
    'interno', true, now() - interval '10 days', 11, 'en_proceso', 'activo'
  );
  -- Trigger creates initial transition at etapa 11; replace with controlled history
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[1];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[1], NULL, 1, NULL, 1, now() - interval '10 days', v_asesor),
    (v_ids[1], 1, 2, 1, 2, now() - interval '3 days', v_admin),
    (v_ids[1], 2, 3, 2, 3, now() - interval '1 day', v_admin),
    (v_ids[1], 3, 11, 3, 10, now() - interval '12 hours', v_admin);

  -- Exp 2: sigue en Registro (entrada hace 2 días)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[2], v_org, v_asesor, 'mejoravit', '14900000002', 'P149 Permanece Registro', '8111490002',
    'interno', true, now() - interval '5 days', 2, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[2];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[2], NULL, 1, NULL, 1, now() - interval '5 days', v_asesor),
    (v_ids[2], 1, 2, 1, 2, now() - interval '2 days', v_admin);

  -- Exp 3: reingreso a Registro (dos visitas)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado,
    reingreso_manual_count
  ) VALUES (
    v_ids[3], v_org, v_asesor, 'mejoravit', '14900000003', 'P149 Reingreso Registro', '8111490003',
    'interno', true, now() - interval '8 days', 2, 'en_validacion_mesa', 'activo', 1
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[3];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[3], NULL, 2, NULL, 2, now() - interval '4 days', v_asesor),
    (v_ids[3], 2, 3, 2, 3, now() - interval '3 days', v_admin),
    (v_ids[3], 3, 2, 3, 2, now() - interval '1 day', v_asesor);

  PERFORM public.__p149_auth(v_admin);

  -- 1/2: entrada a Registro en periodo → incluye exp1 aunque hoy esté en Firmado
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[2]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p149_assert(v_sum ? 'history_coverage_from', 'coverage presente');
  PERFORM public.__p149_assert((v_sum->'totales'->>'total_visitas')::BIGINT >= 3, 'visitas Registro >=3');
  PERFORM public.__p149_assert(
    (v_sum->'totales'->>'total_expedientes_unicos')::BIGINT >= 3,
    'unicos >=3 (reingreso cuenta 1)'
  );

  v_page := public.admin_stage_history_report_page(
    1, 50, NULL, ARRAY[2]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p149_assert((v_page->>'total')::BIGINT = (v_sum->'totales'->>'total_visitas')::BIGINT, 'page total = summary visitas');
  PERFORM public.__p149_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[1]::text
        AND (it->>'etapa_actual')::INT = 11
    ),
    'exp1 aparece en Registro con etapa_actual 11'
  );
  PERFORM public.__p149_assert(
    (SELECT count(*) FROM jsonb_array_elements(v_page->'items') it
     WHERE it->>'expediente_id' = v_ids[3]::text) = 2,
    'reingreso: 2 visitas mismo expediente'
  );

  -- 3: estuvieron (exp2 permaneció)
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[2]::SMALLINT[], 'estuvieron', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p149_assert(
    (v_sum->'totales'->>'current_count')::BIGINT >= 1,
    'estuvieron: al menos 1 continua'
  );

  -- 4: avance desde Registro
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[2]::SMALLINT[], 'avance', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p149_assert(
    (v_sum->'totales'->>'advanced_count')::BIGINT >= 1,
    'avance desde Registro >=1'
  );

  -- 5: dos pasos → unicos sin duplicar visita-count > unicos
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[2,3]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p149_assert(
    (v_sum->'totales'->>'total_visitas')::BIGINT >= (v_sum->'totales'->>'total_expedientes_unicos')::BIGINT,
    'visitas >= unicos multi-etapa'
  );

  -- 6: paginación total estable
  v_page := public.admin_stage_history_report_page(
    1, 1, NULL, ARRAY[2]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  v_cnt := (v_page->>'total')::BIGINT;
  PERFORM public.__p149_assert(jsonb_array_length(v_page->'items') = 1, 'page size 1');
  v_page := public.admin_stage_history_report_page(
    2, 1, NULL, ARRAY[2]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p149_assert((v_page->>'total')::BIGINT = v_cnt, 'total no depende de página');

  -- 7: filtro asesor vacío
  v_sum := public.admin_stage_history_report_summary(
    ARRAY['00000000-0000-4000-8001-999999999999'::UUID],
    ARRAY[2]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p149_assert((v_sum->'totales'->>'total_visitas')::BIGINT = 0, 'asesor inexistente = 0');

  -- 8: timezone bounds no fallan
  PERFORM public.__admin_stage_history_bounds(v_from, v_to);

  -- 9: no autorizado
  PERFORM public.__p149_auth(v_asesor_user);
  BEGIN
    PERFORM public.admin_stage_history_report_summary(
      NULL, ARRAY[2]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
    );
    PERFORM public.__p149_assert(false, 'asesor debió fallar');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM public.__p149_assert(
      position('solo super_admin' in v_err) > 0 OR position('admin_production' in v_err) > 0,
      format('asesor bloqueado: %s', v_err)
    );
  END;

  -- 10: snapshot RPCs intactos
  PERFORM public.__p149_auth(v_admin);
  PERFORM public.__p149_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_expedientes_snapshot_etapas'
    ),
    'snapshot RPC intacto'
  );

  PERFORM public.__p149_reset();

  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  RAISE NOTICE 'P149 stage history: OK';
END;
$$;

DROP FUNCTION public.__p149_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p149_auth(UUID);
DROP FUNCTION public.__p149_reset();
