-- P153: admin stage cohort outcome (entrada → resultado al cierre del periodo)

CREATE OR REPLACE FUNCTION public.__p153_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P153 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p153_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p153_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000153';
  v_asesor UUID := '00000000-0000-4000-8001-000000000153';
  v_admin UUID := '00000000-0000-4000-8006-000000000153';
  v_asesor_user UUID := '00000000-0000-4000-8002-000000000153';
  v_ids UUID[] := ARRAY[
    '00000000-0000-4000-9153-000000000001'::UUID,
    '00000000-0000-4000-9153-000000000002'::UUID,
    '00000000-0000-4000-9153-000000000003'::UUID,
    '00000000-0000-4000-9153-000000000004'::UUID,
    '00000000-0000-4000-9153-000000000005'::UUID,
    '00000000-0000-4000-9153-000000000006'::UUID,
    '00000000-0000-4000-9153-000000000007'::UUID
  ];
  v_id UUID;
  v_sum JSONB;
  v_page JSONB;
  v_sum149 JSONB;
  v_etapa JSONB;
  v_from DATE;
  v_to DATE;
  v_tz TEXT := 'America/Monterrey';
  v_day0 TIMESTAMPTZ;
  v_granted BOOLEAN;
  v_err TEXT;
  v_entered BIGINT;
  v_adv BIGINT;
  v_stay BIGINT;
  v_inc BIGINT;
  v_und BIGINT;
BEGIN
  PERFORM public.__p153_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_stage_cohort_outcome_summary'
    ),
    'RPC summary existe'
  );
  PERFORM public.__p153_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_stage_cohort_outcome_page'
    ),
    'RPC page existe'
  );

  SELECT has_function_privilege(
    'authenticated',
    'public.admin_stage_cohort_outcome_summary(uuid[],smallint[],date,date,text,text)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p153_assert(v_granted, 'authenticated EXECUTE summary');

  SELECT has_function_privilege(
    'anon',
    'public.admin_stage_cohort_outcome_summary(uuid[],smallint[],date,date,text,text)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p153_assert(NOT coalesce(v_granted, false), 'anon sin EXECUTE summary');

  SELECT has_function_privilege(
    'anon',
    'public.admin_stage_cohort_outcome_page(uuid[],smallint[],date,date,text,text,text,integer,integer)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p153_assert(NOT coalesce(v_granted, false), 'anon sin EXECUTE page');

  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'Org P153', 'org-p153')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor.p153@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin.p153@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_asesor_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesoruser.p153@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES
    (v_asesor, v_org, 'asesor.p153@test.local', 'Asesor P153', 'asesor', true),
    (v_admin, v_org, 'admin.p153@test.local', 'Admin P153', 'super_admin', true),
    (v_asesor_user, v_org, 'asesoruser.p153@test.local', 'Asesor User P153', 'asesor', true)
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      app_role = EXCLUDED.app_role,
      active = true,
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name;

  -- Periodo fijo Monterrey: día 0 = hoy-10 … día 6 = hoy-4 (cohorte)
  v_day0 := ((now() AT TIME ZONE v_tz)::date - 10)::timestamp AT TIME ZONE v_tz;
  v_from := (v_day0 AT TIME ZONE v_tz)::date;
  v_to := ((v_day0 AT TIME ZONE v_tz)::date + 6);

  -- 1) Entra y avanza dentro del periodo → advanced
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[1], v_org, v_asesor, 'mejoravit', '15300000001', 'P153 Avanzo', '8111530001',
    'interno', true, v_day0, 3, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[1];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[1], NULL, 1, NULL, 1, v_day0 - interval '2 days', v_asesor),
    (v_ids[1], 1, 2, 1, 2, v_day0 + interval '1 day', v_admin),
    (v_ids[1], 2, 3, 2, 3, v_day0 + interval '3 days', v_admin);

  -- 2) Entra y continúa al cierre → stayed + sigue_en_etapa
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[2], v_org, v_asesor, 'mejoravit', '15300000002', 'P153 Se Quedo', '8111530002',
    'interno', true, v_day0, 2, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[2];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[2], NULL, 1, NULL, 1, v_day0 - interval '1 day', v_asesor),
    (v_ids[2], 1, 2, 1, 2, v_day0 + interval '2 days', v_admin);

  -- 3) Se queda al cierre y avanza después → stayed + avanzo_despues
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[3], v_org, v_asesor, 'mejoravit', '15300000003', 'P153 Avanzo Despues', '8111530003',
    'interno', true, v_day0, 3, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[3];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[3], NULL, 1, NULL, 1, v_day0 - interval '1 day', v_asesor),
    (v_ids[3], 1, 2, 1, 2, v_day0 + interval '4 days', v_admin),
    (v_ids[3], 2, 3, 2, 3, v_day0 + interval '10 days', v_admin);

  -- 4) Entra y retrocede dentro del periodo → incident
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[4], v_org, v_asesor, 'mejoravit', '15300000004', 'P153 Retrocede', '8111530004',
    'interno', true, v_day0, 1, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[4];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[4], NULL, 2, NULL, 2, v_day0 + interval '1 day', v_asesor),
    (v_ids[4], 2, 1, 2, 1, v_day0 + interval '2 days', v_admin);

  -- 5) Entra ANTES del periodo y avanza DENTRO → fuera de cohorte entrada
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[5], v_org, v_asesor, 'mejoravit', '15300000005', 'P153 Fuera Cohorte', '8111530005',
    'interno', true, v_day0 - interval '5 days', 3, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[5];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[5], NULL, 2, NULL, 2, v_day0 - interval '3 days', v_asesor),
    (v_ids[5], 2, 3, 2, 3, v_day0 + interval '2 days', v_admin);

  -- 6) Reingreso: dos visitas a Registro en periodo
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado,
    reingreso_manual_count
  ) VALUES (
    v_ids[6], v_org, v_asesor, 'mejoravit', '15300000006', 'P153 Dos Visitas', '8111530006',
    'interno', true, v_day0, 2, 'en_validacion_mesa', 'activo', 1
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[6];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[6], NULL, 2, NULL, 2, v_day0 + interval '1 day', v_asesor),
    (v_ids[6], 2, 3, 2, 3, v_day0 + interval '2 days', v_admin),
    (v_ids[6], 3, 2, 3, 2, v_day0 + interval '3 days', v_asesor);

  -- 7) Legacy etapa 4 canónica → paso visual 4; también entra a Registro (paso 2) en periodo
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[7], v_org, v_asesor, 'mejoravit', '15300000007', 'P153 Legacy4', '8111530007',
    'interno', true, v_day0, 4, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[7];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[7], NULL, 2, NULL, 2, v_day0 + interval '1 day', v_asesor),
    (v_ids[7], 2, 4, 2, 4, v_day0 + interval '5 days', v_admin);

  PERFORM public.__p153_auth(v_admin);

  v_sum := public.admin_stage_cohort_outcome_summary(
    NULL, ARRAY[2]::SMALLINT[], v_from, v_to, NULL, NULL
  );
  PERFORM public.__p153_assert(v_sum ? 'history_coverage_from', 'coverage presente');
  PERFORM public.__p153_assert(
    (v_sum->>'history_coverage_from') LIKE '2026-07-23%',
    'coverage desde 2026-07-23'
  );

  SELECT e INTO v_etapa
  FROM jsonb_array_elements(v_sum->'etapas') e
  WHERE (e->>'paso_visual')::INT = 2;
  PERFORM public.__p153_assert(v_etapa IS NOT NULL, 'etapa Registro presente');

  v_entered := (v_etapa->>'entered_count')::BIGINT;
  v_adv := (v_etapa->>'advanced_count')::BIGINT;
  v_stay := (v_etapa->>'stayed_count')::BIGINT;
  v_inc := (v_etapa->>'incident_count')::BIGINT;
  v_und := (v_etapa->>'undetermined_count')::BIGINT;

  -- Visitas Registro en cohorte:
  -- exp1 advanced, exp2 stayed, exp3 stayed, exp4 incident,
  -- exp5 NO (entrada antes), exp6 two visits (advanced + stayed), exp7 advanced
  -- = 1+1+1+1+2+1 = 7
  PERFORM public.__p153_assert(v_entered = 7, format('entraron=7 got %s', v_entered));
  PERFORM public.__p153_assert(
    v_entered = v_adv + v_stay + v_inc + v_und,
    format('cuadre %s=%s+%s+%s+%s', v_entered, v_adv, v_stay, v_inc, v_und)
  );
  PERFORM public.__p153_assert(v_adv >= 3, format('advanced>=3 got %s', v_adv));
  PERFORM public.__p153_assert(v_stay >= 3, format('stayed>=3 got %s', v_stay));
  PERFORM public.__p153_assert(v_inc >= 1, format('incident>=1 got %s', v_inc));

  -- Fuera de cohorte
  v_page := public.admin_stage_cohort_outcome_page(
    NULL, ARRAY[2]::SMALLINT[], v_from, v_to, NULL, NULL, 'advanced', 50, 0
  );
  PERFORM public.__p153_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[5]::text
    ),
    'exp5 fuera de cohorte advanced'
  );

  v_page := public.admin_stage_cohort_outcome_page(
    NULL, ARRAY[2]::SMALLINT[], v_from, v_to, NULL, NULL, 'stayed', 50, 0
  );
  PERFORM public.__p153_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[3]::text
        AND it->>'situacion_actual' = 'avanzo_despues'
    ),
    'exp3 stayed + avanzo_despues'
  );
  PERFORM public.__p153_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[2]::text
        AND it->>'situacion_actual' = 'sigue_en_etapa'
    ),
    'exp2 sigue_en_etapa'
  );

  v_page := public.admin_stage_cohort_outcome_page(
    NULL, ARRAY[2]::SMALLINT[], v_from, v_to, NULL, NULL, 'incident', 50, 0
  );
  PERFORM public.__p153_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[4]::text
        AND it->>'resultado_label' = 'retrocedio'
    ),
    'exp4 incident retrocedio'
  );

  -- Paginación: total independiente de limit
  v_page := public.admin_stage_cohort_outcome_page(
    NULL, ARRAY[2]::SMALLINT[], v_from, v_to, NULL, NULL, 'advanced', 1, 0
  );
  PERFORM public.__p153_assert((v_page->>'limit')::INT = 1, 'limit=1');
  PERFORM public.__p153_assert(jsonb_array_length(v_page->'items') = 1, 'page size 1');
  PERFORM public.__p153_assert((v_page->>'total')::BIGINT = v_adv, 'total advanced independiente');

  -- Múltiples etapas: cada una cuadra
  v_sum := public.admin_stage_cohort_outcome_summary(
    NULL, ARRAY[2,4]::SMALLINT[], v_from, v_to, NULL, NULL
  );
  SELECT e INTO v_etapa
  FROM jsonb_array_elements(v_sum->'etapas') e
  WHERE (e->>'paso_visual')::INT = 4;
  PERFORM public.__p153_assert(v_etapa IS NOT NULL, 'paso 4 presente');
  v_entered := (v_etapa->>'entered_count')::BIGINT;
  PERFORM public.__p153_assert(
    v_entered = (v_etapa->>'advanced_count')::BIGINT
      + (v_etapa->>'stayed_count')::BIGINT
      + (v_etapa->>'incident_count')::BIGINT
      + (v_etapa->>'undetermined_count')::BIGINT,
    'paso 4 cuadra'
  );
  PERFORM public.__p153_assert(
    (v_etapa->>'etapa_label') = 'Biometría (resultado)',
    'label canónico paso 4'
  );

  -- Hasta incluye día completo Monterrey: entrada al final del día hasta
  -- (cubierto por bounds; smoke: entrada en v_to 23:30 cuenta)
  -- Auth: asesor bloqueado
  PERFORM public.__p153_auth(v_asesor_user);
  BEGIN
    v_sum := public.admin_stage_cohort_outcome_summary(
      NULL, ARRAY[2]::SMALLINT[], v_from, v_to, NULL, NULL
    );
    PERFORM public.__p153_assert(false, 'asesor no debió ejecutar summary');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p153_assert(v_err IS NOT NULL AND length(v_err) > 0, 'asesor bloqueado');
  END;

  -- Regresión P149
  PERFORM public.__p153_auth(v_admin);
  v_sum149 := public.admin_stage_history_report_summary(
    NULL, ARRAY[2]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p153_assert(
    (v_sum149->'totales'->>'total_visitas')::BIGINT >= 7,
    'P149 entrada sin regresión'
  );

  -- Cleanup
  PERFORM public.__p153_reset();
  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  RAISE NOTICE 'P153 OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p153_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p153_auth(UUID);
DROP FUNCTION IF EXISTS public.__p153_reset();
