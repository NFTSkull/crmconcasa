-- P154: desglose por asesor + NSS completo + resultado entered

CREATE OR REPLACE FUNCTION public.__p154_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P154 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p154_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p154_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000154';
  v_asesor UUID := '00000000-0000-4000-8001-000000000154';
  v_admin UUID := '00000000-0000-4000-8006-000000000154';
  v_asesor_user UUID := '00000000-0000-4000-8002-000000000154';
  v_ids UUID[] := ARRAY[
    '00000000-0000-4000-9154-000000000001'::UUID,
    '00000000-0000-4000-9154-000000000002'::UUID,
    '00000000-0000-4000-9154-000000000003'::UUID
  ];
  v_id UUID;
  v_sum JSONB;
  v_page JSONB;
  v_etapa JSONB;
  v_asesor_row JSONB;
  v_from DATE;
  v_to DATE;
  v_tz TEXT := 'America/Monterrey';
  v_day0 TIMESTAMPTZ;
  v_nss TEXT;
  v_err TEXT;
  v_entered BIGINT;
  v_sum_asesor BIGINT;
BEGIN
  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id OR entity_id = v_admin;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'Org P154', 'org-p154')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor.p154@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin.p154@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_asesor_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesoruser.p154@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES
    (v_asesor, v_org, 'asesor.p154@test.local', 'Adriana Alcocer P154', 'asesor', true),
    (v_admin, v_org, 'admin.p154@test.local', 'Admin P154', 'super_admin', true),
    (v_asesor_user, v_org, 'asesoruser.p154@test.local', 'Asesor User P154', 'asesor', true)
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      app_role = EXCLUDED.app_role,
      active = true,
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name;

  v_day0 := ((now() AT TIME ZONE v_tz)::date - 10)::timestamp AT TIME ZONE v_tz;
  v_from := (v_day0 AT TIME ZONE v_tz)::date;
  v_to := ((v_day0 AT TIME ZONE v_tz)::date + 6);

  -- 1) Avanza en periodo — NSS con ceros iniciales
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[1], v_org, v_asesor, 'mejoravit', '02189008168', 'P154 Avanzo', '8111540001',
    'interno', true, v_day0, 3, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[1];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[1], NULL, 1, NULL, 1, v_day0 - interval '1 day', v_asesor),
    (v_ids[1], 1, 2, 1, 2, v_day0 + interval '1 day', v_admin),
    (v_ids[1], 2, 3, 2, 3, v_day0 + interval '2 days', v_admin);

  -- 2) Se queda + avanza después
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[2], v_org, v_asesor, 'mejoravit', '02189008169', 'P154 Se Quedo', '8111540002',
    'interno', true, v_day0, 3, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[2];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[2], NULL, 1, NULL, 1, v_day0 - interval '1 day', v_asesor),
    (v_ids[2], 1, 2, 1, 2, v_day0 + interval '2 days', v_admin),
    (v_ids[2], 2, 3, 2, 3, v_day0 + interval '10 days', v_admin);

  -- 3) Incidencia (retroceso)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[3], v_org, v_asesor, 'mejoravit', '02189008170', 'P154 Incidencia', '8111540003',
    'interno', true, v_day0, 1, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[3];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[3], NULL, 2, NULL, 2, v_day0 + interval '1 day', v_asesor),
    (v_ids[3], 2, 1, 2, 1, v_day0 + interval '2 days', v_admin);

  PERFORM public.__p154_auth(v_admin);

  v_sum := public.admin_stage_cohort_outcome_summary(
    ARRAY[v_asesor]::UUID[], ARRAY[2]::SMALLINT[], v_from, v_to, NULL, 'P154'
  );
  SELECT e INTO v_etapa
  FROM jsonb_array_elements(v_sum->'etapas') e
  WHERE (e->>'paso_visual')::INT = 2;

  v_entered := (v_etapa->>'entered_count')::BIGINT;
  PERFORM public.__p154_assert(v_entered = 3, format('entraron=3 got %s', v_entered));

  SELECT a INTO v_asesor_row
  FROM jsonb_array_elements(v_etapa->'por_asesor') a
  WHERE a->>'asesor_id' = v_asesor::text;
  PERFORM public.__p154_assert(v_asesor_row IS NOT NULL, 'por_asesor presente');
  PERFORM public.__p154_assert(
    (v_asesor_row->>'entered_count')::BIGINT = 3
      AND (v_asesor_row->>'advanced_count')::BIGINT = 1
      AND (v_asesor_row->>'stayed_count')::BIGINT = 1
      AND (v_asesor_row->>'incident_count')::BIGINT = 1,
    'conteos asesor Adriana'
  );

  v_sum_asesor := coalesce((
    SELECT sum((a->>'entered_count')::BIGINT)
    FROM jsonb_array_elements(v_etapa->'por_asesor') a
  ), 0);
  PERFORM public.__p154_assert(v_sum_asesor = v_entered, 'suma asesor = total etapa');

  -- Pulsar Entraron → total 3, NSS completo
  v_page := public.admin_stage_cohort_outcome_page(
    ARRAY[v_asesor]::UUID[], ARRAY[2]::SMALLINT[], v_from, v_to, NULL, 'P154',
    'entered', 50, 0
  );
  PERFORM public.__p154_assert((v_page->>'total')::BIGINT = 3, 'entered total=3');
  PERFORM public.__p154_assert(coalesce((v_page->>'nss_completo')::BOOLEAN, false), 'nss_completo flag');
  SELECT it->>'nss' INTO v_nss
  FROM jsonb_array_elements(v_page->'items') it
  WHERE it->>'expediente_id' = v_ids[1]::text;
  PERFORM public.__p154_assert(v_nss = '02189008168', format('NSS completo got %s', v_nss));
  PERFORM public.__p154_assert(left(v_nss, 1) = '0', 'conserva cero inicial');
  PERFORM public.__p154_assert(position('*' in coalesce(v_nss, '')) = 0, 'sin mascara');

  -- Pulsar Avanzaron → 1
  v_page := public.admin_stage_cohort_outcome_page(
    ARRAY[v_asesor]::UUID[], ARRAY[2]::SMALLINT[], v_from, v_to, NULL, 'P154',
    'advanced', 50, 0
  );
  PERFORM public.__p154_assert((v_page->>'total')::BIGINT = 1, 'advanced total=1');
  PERFORM public.__p154_assert(
    (v_page->'items'->0->>'expediente_id') = v_ids[1]::text,
    'advanced es exp1'
  );

  -- Se quedaron + avanzo_despues
  v_page := public.admin_stage_cohort_outcome_page(
    ARRAY[v_asesor]::UUID[], ARRAY[2]::SMALLINT[], v_from, v_to, NULL, 'P154',
    'stayed', 50, 0
  );
  PERFORM public.__p154_assert((v_page->>'total')::BIGINT = 1, 'stayed total=1');
  PERFORM public.__p154_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[2]::text
        AND it->>'situacion_actual' = 'avanzo_despues'
        AND it->>'period_outcome' = 'stayed'
    ),
    'stayed + avanzo_despues'
  );

  -- Incidencias
  v_page := public.admin_stage_cohort_outcome_page(
    ARRAY[v_asesor]::UUID[], ARRAY[2]::SMALLINT[], v_from, v_to, NULL, 'P154',
    'incident', 50, 0
  );
  PERFORM public.__p154_assert((v_page->>'total')::BIGINT = 1, 'incident total=1');

  -- Auditoría
  PERFORM public.__p154_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.actor_id = v_admin
        AND al.action = 'admin.stage_cohort_outcome_detail'
        AND (al.payload->>'nss_completo')::BOOLEAN = true
    ),
    'action_log nss_completo'
  );

  -- Otro rol bloqueado
  PERFORM public.__p154_auth(v_asesor_user);
  BEGIN
    v_page := public.admin_stage_cohort_outcome_page(
      ARRAY[v_asesor]::UUID[], ARRAY[2]::SMALLINT[], v_from, v_to, NULL, 'P154',
      'entered', 10, 0
    );
    PERFORM public.__p154_assert(false, 'asesor no debió ver NSS');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p154_assert(length(coalesce(v_err, '')) > 0, 'asesor bloqueado');
  END;

  PERFORM public.__p154_reset();
  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;
  DELETE FROM public.action_log WHERE actor_id = v_admin AND action = 'admin.stage_cohort_outcome_detail';

  RAISE NOTICE 'P154 OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p154_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p154_auth(UUID);
DROP FUNCTION IF EXISTS public.__p154_reset();
