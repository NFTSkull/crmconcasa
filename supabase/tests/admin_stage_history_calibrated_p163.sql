-- P163: calibración reporte histórico de etapas
-- Casos: entrada/avance/estuvieron, reingreso, retroceso≠avance, TZ Monterrey día final, estado_actual, paginación=total

CREATE OR REPLACE FUNCTION public.__p163_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P163 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p163_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p163_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000163';
  v_asesor UUID := '00000000-0000-4000-8001-000000000163';
  v_admin UUID := '00000000-0000-4000-8006-000000000163';
  v_ids UUID[] := ARRAY[
    '00000000-0000-4000-9163-000000000001'::UUID,
    '00000000-0000-4000-9163-000000000002'::UUID,
    '00000000-0000-4000-9163-000000000003'::UUID,
    '00000000-0000-4000-9163-000000000004'::UUID,
    '00000000-0000-4000-9163-000000000005'::UUID
  ];
  v_id UUID;
  v_sum JSONB;
  v_page JSONB;
  v_page2 JSONB;
  v_from DATE := DATE '2026-08-01';
  v_to DATE := DATE '2026-08-05';
  v_bounds_from TIMESTAMPTZ;
  v_bounds_to TIMESTAMPTZ;
  v_cnt BIGINT;
BEGIN
  PERFORM public.__p163_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_stage_history_report_summary'
    ),
    'RPC summary existe'
  );

  SELECT * INTO v_bounds_from, v_bounds_to
  FROM public.__admin_stage_history_bounds(v_from, v_to);
  PERFORM public.__p163_assert(
    v_bounds_from = TIMESTAMPTZ '2026-08-01 00:00:00 America/Monterrey',
    'bounds from medianoche Monterrey'
  );
  PERFORM public.__p163_assert(
    v_bounds_to = TIMESTAMPTZ '2026-08-06 00:00:00 America/Monterrey',
    'bounds toExclusive = hasta+1 Monterrey (día final incluido)'
  );

  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'Org P163', 'org-p163')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor.p163@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin.p163@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES
    (v_asesor, v_org, 'asesor.p163@test.local', 'Asesor P163', 'asesor', true),
    (v_admin, v_org, 'admin.p163@test.local', 'Admin P163', 'super_admin', true)
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      app_role = EXCLUDED.app_role,
      active = true,
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name;

  -- Exp1: entra Paso4 el 2 ago, avanza a 5 el 6 ago (fuera) → Entraron sí; Avanzaron no; hoy paso 9
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[1], v_org, v_asesor, 'mejoravit', '16300000001', 'P163 Entró Paso4', '8111630001',
    'interno', true, TIMESTAMPTZ '2026-07-20 12:00:00 America/Monterrey', 10, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[1];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[1], NULL, 1, NULL, 1, TIMESTAMPTZ '2026-07-20 10:00:00 America/Monterrey', v_asesor),
    (v_ids[1], 1, 5, 1, 4, TIMESTAMPTZ '2026-08-02 11:00:00 America/Monterrey', v_admin),
    (v_ids[1], 5, 6, 4, 5, TIMESTAMPTZ '2026-08-06 09:00:00 America/Monterrey', v_admin),
    (v_ids[1], 6, 10, 5, 9, TIMESTAMPTZ '2026-08-08 09:00:00 America/Monterrey', v_admin);

  -- Exp2: estancia cruza inicio (entró 30 jul, salió 3 ago) → Estuvieron sí; Entraron no
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[2], v_org, v_asesor, 'mejoravit', '16300000002', 'P163 Estuvo Cruzando', '8111630002',
    'interno', true, TIMESTAMPTZ '2026-07-15 12:00:00 America/Monterrey', 5, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[2];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[2], NULL, 5, NULL, 4, TIMESTAMPTZ '2026-07-30 08:00:00 America/Monterrey', v_asesor),
    (v_ids[2], 5, 6, 4, 5, TIMESTAMPTZ '2026-08-03 16:00:00 America/Monterrey', v_admin);

  -- Exp3: reingreso Paso4 dos veces en rango + un retroceso (no cuenta avance)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[3], v_org, v_asesor, 'mejoravit', '16300000003', 'P163 Reingreso Paso4', '8111630003',
    'interno', true, TIMESTAMPTZ '2026-07-10 12:00:00 America/Monterrey', 4, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[3];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[3], NULL, 5, NULL, 4, TIMESTAMPTZ '2026-08-01 09:00:00 America/Monterrey', v_asesor),
    (v_ids[3], 5, 3, 4, 3, TIMESTAMPTZ '2026-08-02 09:00:00 America/Monterrey', v_admin), -- retroceso
    (v_ids[3], 3, 5, 3, 4, TIMESTAMPTZ '2026-08-04 09:00:00 America/Monterrey', v_asesor),
    (v_ids[3], 5, 6, 4, 5, TIMESTAMPTZ '2026-08-05 20:00:00 America/Monterrey', v_admin); -- avance último día

  -- Exp4: entra 5 ago 23:30 Monterrey (día final incluido)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[4], v_org, v_asesor, 'mejoravit', '16300000004', 'P163 Dia Final', '8111630004',
    'interno', true, TIMESTAMPTZ '2026-08-01 12:00:00 America/Monterrey', 5, 'en_proceso', 'activo'
  );
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_ids[4];
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    (v_ids[4], NULL, 5, NULL, 4, TIMESTAMPTZ '2026-08-05 23:30:00 America/Monterrey', v_asesor);

  PERFORM public.__p163_auth(v_admin);

  -- Entraron Paso 4: exp1, exp3 (×2), exp4 → 4 movimientos / 3 unicos; exp2 NO
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[4]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p163_assert((v_sum->>'timezone') = 'America/Monterrey', 'timezone en summary');
  PERFORM public.__p163_assert((v_sum->>'asesor_fuente') = 'actual', 'asesor_fuente actual');
  PERFORM public.__p163_assert((v_sum->'totales'->>'total_visitas')::BIGINT = 4, 'entraron movimientos=4');
  PERFORM public.__p163_assert((v_sum->'totales'->>'total_expedientes_unicos')::BIGINT = 3, 'entraron unicos=3');
  PERFORM public.__p163_assert((v_sum->'totales'->>'entered_count')::BIGINT = 4, 'entered_count calibrado=4');

  v_page := public.admin_stage_history_report_page(
    1, 50, NULL, ARRAY[4]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p163_assert(
    (v_page->>'total')::BIGINT = (v_sum->'totales'->>'total_visitas')::BIGINT,
    'page total = summary movimientos'
  );
  PERFORM public.__p163_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[1]::text
        AND (it->>'paso_actual')::INT = 9
        AND it ? 'asesor_fuente'
    ),
    'exp1 entró a 4 aunque hoy paso 9'
  );
  PERFORM public.__p163_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[2]::text
    ),
    'exp2 no en Entraron (entró antes del rango)'
  );
  PERFORM public.__p163_assert(
    (SELECT count(*) FROM jsonb_array_elements(v_page->'items') it
     WHERE it->>'expediente_id' = v_ids[3]::text) = 2,
    'reingreso: 2 entradas mismo expediente'
  );
  PERFORM public.__p163_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[4]::text
    ),
    'día final 23:30 Monterrey incluido'
  );

  -- Avanzaron Paso 4: solo salida forward en rango → exp2 (3 ago) + exp3 (5 ago); NO retroceso; NO exp1 (avance 6 ago)
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[4]::SMALLINT[], 'avance', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p163_assert((v_sum->'totales'->>'total_visitas')::BIGINT = 2, 'avanzaron movimientos=2');
  PERFORM public.__p163_assert(
    (v_sum->'totales'->>'total_visitas')::BIGINT
      = (v_sum->'totales'->>'advanced_count')::BIGINT,
    'avance: movimientos == advanced_count (sin outcome eventual)'
  );
  v_page := public.admin_stage_history_report_page(
    1, 50, NULL, ARRAY[4]::SMALLINT[], 'avance', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p163_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[2]::text
        AND (it->>'etapa_siguiente_paso')::INT = 5
    ),
    'exp2 avanzó 4→5 en rango'
  );
  PERFORM public.__p163_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[3]::text
        AND (it->>'etapa_siguiente_paso')::INT = 5
    ),
    'exp3 avance forward cuenta; retroceso no'
  );
  PERFORM public.__p163_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[1]::text
    ),
    'exp1 avance fuera de rango no aparece'
  );

  -- Estuvieron: exp1,2,3,4
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[4]::SMALLINT[], 'estuvieron', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p163_assert((v_sum->'totales'->>'total_visitas')::BIGINT >= 4, 'estuvieron >=4');
  PERFORM public.__p163_assert(
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        public.admin_stage_history_report_page(
          1, 50, NULL, ARRAY[4]::SMALLINT[], 'estuvieron', v_from, v_to, NULL, NULL
        )->'items'
      ) it
      WHERE it->>'expediente_id' = v_ids[2]::text
        AND (it->>'still_in_stage_at_range_end')::BOOLEAN = false
    ),
    'exp2 no seguía en etapa al cierre del rango'
  );

  -- Paso visual 3 agrupa internas 3+4 (entrada por mapper visual)
  PERFORM public.__p163_reset();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    '00000000-0000-4000-9163-000000000005'::UUID, v_org, v_asesor, 'mejoravit', '16300000005',
    'P163 Paso3 Legacy4', '8111630005', 'interno', true,
    TIMESTAMPTZ '2026-08-01 12:00:00 America/Monterrey', 4, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO NOTHING;
  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id = '00000000-0000-4000-9163-000000000005'::UUID;
  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva, paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES
    ('00000000-0000-4000-9163-000000000005'::UUID, 2, 4, 2, 3,
     TIMESTAMPTZ '2026-08-02 10:00:00 America/Monterrey', v_asesor);

  PERFORM public.__p163_auth(v_admin);
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[3]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p163_assert(
    (v_sum->'totales'->>'total_visitas')::BIGINT >= 1,
    'Paso 3 incluye transición visual 3 (interna 4 legacy)'
  );
  PERFORM public.__p163_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        public.admin_stage_history_report_page(
          1, 50, NULL, ARRAY[3]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
        )->'items'
      ) it
      WHERE it->>'expediente_id' = '00000000-0000-4000-9163-000000000005'
        AND (it->>'paso_visual')::INT = 3
    ),
    'detalle Paso 3 lista visita legacy interna 4'
  );

  -- Paginación: total de movimientos estable entre páginas
  v_page := public.admin_stage_history_report_page(
    1, 2, NULL, ARRAY[4]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  v_page2 := public.admin_stage_history_report_page(
    2, 2, NULL, ARRAY[4]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p163_assert((v_page->>'total')::BIGINT = 4, 'page1 total=4');
  PERFORM public.__p163_assert((v_page2->>'total')::BIGINT = 4, 'page2 total=4');
  PERFORM public.__p163_assert((v_page->>'total')::BIGINT = (v_page2->>'total')::BIGINT, 'paginación: total estable');
  PERFORM public.__p163_assert(jsonb_array_length(v_page->'items') = 2, 'page1 size=2');
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[4]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p163_assert(
    (v_sum->'totales'->>'total_expedientes_unicos')::BIGINT = 3,
    'paginación: unicos summary estable (=3)'
  );

  -- Estado actual: fechas ignoradas; schema completo
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[9]::SMALLINT[], 'estado_actual', NULL, NULL, NULL, NULL
  );
  PERFORM public.__p163_assert((v_sum->>'movimiento') = 'estado_actual', 'modo estado_actual');
  v_page := public.admin_stage_history_report_page(
    1, 50, NULL, ARRAY[9]::SMALLINT[], 'estado_actual', NULL, NULL, NULL, NULL
  );
  PERFORM public.__p163_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') it
      WHERE it->>'expediente_id' = v_ids[1]::text
        AND it ? 'visita_id'
        AND it ? 'paso_visual'
        AND it ? 'paso_nombre'
    ),
    'estado_actual page emite campos requeridos (bug P149 corregido)'
  );

  -- Filtro asesor AND
  v_sum := public.admin_stage_history_report_summary(
    ARRAY[v_asesor]::UUID[], ARRAY[4]::SMALLINT[], 'entrada', v_from, v_to, NULL, NULL
  );
  PERFORM public.__p163_assert((v_sum->'totales'->>'total_visitas')::BIGINT = 4, 'filtro asesor ok');

  -- Búsqueda
  v_sum := public.admin_stage_history_report_summary(
    NULL, ARRAY[4]::SMALLINT[], 'entrada', v_from, v_to, NULL, 'Dia Final'
  );
  PERFORM public.__p163_assert((v_sum->'totales'->>'total_visitas')::BIGINT = 1, 'buscar cliente');

  PERFORM public.__p163_reset();
  RAISE NOTICE 'P163 ALL PASSED';
END;
$$;
