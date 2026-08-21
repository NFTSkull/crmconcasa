-- ConCasa CRM — P206: Disponibles = TODO trabajo accionable (assignment no oculta)
\set ON_ERROR_STOP on
\ir ../migrations/206_mesa_disponibles_todo_trabajo_accionable.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.__p206_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P206 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p206_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p206_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_take TEXT;
  v_rel TEXT;
  v_counts TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p206_assert(v_src IS NOT NULL, 'mesa_list_bandeja_page existe');
  PERFORM public.__p206_assert(
    position('mesa_es_trabajo_accionable_mesa' in v_src) > 0,
    'list usa helper P199'
  );
  PERFORM public.__p206_assert(
    position('P206: Disponibles = TODO trabajo accionable' in v_src) > 0,
    'rama sin_asignar P206 presente'
  );
  -- No gate de assignment en el predicado Disponibles (comentario P206 inmediato).
  PERFORM public.__p206_assert(
    position('UPDATE ' in v_src) = 0,
    'list sin UPDATE'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_take
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_take_expediente'
  LIMIT 1;
  PERFORM public.__p206_assert(position('P206' in coalesce(v_take, '')) = 0, 'D21 take intacto');

  SELECT pg_get_functiondef(p.oid) INTO v_rel
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_release_expediente'
  LIMIT 1;
  PERFORM public.__p206_assert(position('P206' in coalesce(v_rel, '')) = 0, 'D22 release intacto');

  SELECT pg_get_functiondef(p.oid) INTO v_counts
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_counts_fast'
  LIMIT 1;
  PERFORM public.__p206_assert(v_counts IS NOT NULL, 'D24 counts fast existe');
  PERFORM public.__p206_assert(position('P206' in coalesce(v_counts, '')) = 0, 'D24 counts no tocado');

  RAISE NOTICE 'P206 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9206-000000000001';
  v_asesor UUID := '00000000-0000-4000-9206-000000000011';
  v_mesa UUID := '00000000-0000-4000-9206-000000000012';
  v_mesa2 UUID := '00000000-0000-4000-9206-000000000013';
  v_exp_free UUID := '00000000-0000-4000-9206-000000000101';
  v_exp_mine UUID := '00000000-0000-4000-9206-000000000102';
  v_exp_other UUID := '00000000-0000-4000-9206-000000000103';
  v_exp_wait UUID := '00000000-0000-4000-9206-000000000104';
  v_page JSONB;
  v_ids TEXT[];
  v_row JSONB;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p206-org', 'P206 Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p206-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p206-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa2, 'authenticated', 'authenticated', 'p206-mesa2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p206-asesor@test.local', 'Asesor P206', 'asesor', NULL, true),
    (v_mesa, v_org, 'p206-mesa@test.local', 'Mesa P206', 'mesa_interno', 'interno', true),
    (v_mesa2, v_org, 'p206-mesa2@test.local', 'Mesa2 P206', 'mesa_interno', 'interno', true);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado
  ) VALUES
    (v_exp_free, v_org, v_asesor, 'mejoravit', '92060000001',
     'Fixture P206 Free', '5512060001', 'interno', 'activo', true, NOW(), 2, 'en_proceso'),
    (v_exp_mine, v_org, v_asesor, 'mejoravit', '92060000002',
     'Fixture P206 Mine', '5512060002', 'interno', 'activo', true, NOW(), 2, 'en_proceso'),
    (v_exp_other, v_org, v_asesor, 'mejoravit', '92060000003',
     'Fixture P206 Other', '5512060003', 'interno', 'activo', true, NOW(), 2, 'en_proceso'),
    (v_exp_wait, v_org, v_asesor, 'mejoravit', '92060000004',
     'Fixture P206 Wait', '5512060004', 'interno', 'activo', true, NOW(), 2, 'en_proceso');

  INSERT INTO public.mesa_expediente_ops (
    expediente_id, organization_id, estado_mesa, assigned_to, assigned_at
  ) VALUES
    (v_exp_mine, v_org, 'trabajando', v_mesa, NOW()),
    (v_exp_other, v_org, 'trabajando', v_mesa2, NOW());

  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior,
    motivo, comentario, decidido_por, decidido_por_rol
  ) VALUES (
    '00000000-0000-4000-9206-000000000201', v_org, v_exp_wait, 2, 'en_proceso',
    'Docs', 'espera asesor', v_mesa, 'mesa_interno'
  );

  UPDATE public.expedientes
  SET subestado = 'rechazado'
  WHERE id = v_exp_wait;

  PERFORM public.__p206_auth(v_mesa);
  v_page := public.mesa_list_bandeja_page(
    25, NULL::timestamptz, NULL::uuid, 'todos', 'sin_asignar', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[])
  INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;

  PERFORM public.__p206_assert(
    v_exp_free::text = ANY (v_ids),
    'D1 free debe estar en Disponibles'
  );
  PERFORM public.__p206_assert(
    v_exp_mine::text = ANY (v_ids),
    'D2 assigned a mí debe estar en Disponibles'
  );
  PERFORM public.__p206_assert(
    v_exp_other::text = ANY (v_ids),
    'D3 assigned a otro debe estar en Disponibles'
  );
  PERFORM public.__p206_assert(
    NOT (v_exp_wait::text = ANY (v_ids)),
    'D9/D12 rechazo raw / WAITING NO Disponible'
  );

  -- Badges: assignment sigue en payload (D15/D16).
  SELECT x INTO v_row
  FROM jsonb_array_elements(v_page->'items') x
  WHERE x->>'id' = v_exp_other::text
  LIMIT 1;
  PERFORM public.__p206_assert(v_row IS NOT NULL, 'otro visible');
  PERFORM public.__p206_assert(
    (v_row->>'assigned_to')::uuid = v_mesa2,
    'D15 assigned_to otro en payload'
  );

  SELECT x INTO v_row
  FROM jsonb_array_elements(v_page->'items') x
  WHERE x->>'id' = v_exp_mine::text
  LIMIT 1;
  PERFORM public.__p206_assert(
    (v_row->>'assigned_to')::uuid = v_mesa,
    'D16 assigned_to current en payload'
  );

  -- D17–D20: otros ops filters sin cambio de predicado.
  v_page := public.mesa_list_bandeja_page(
    25, NULL::timestamptz, NULL::uuid, 'todos', 'mi_bandeja', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p206_assert(v_exp_mine::text = ANY (v_ids), 'D17 mi_bandeja incluye mine');
  PERFORM public.__p206_assert(NOT (v_exp_other::text = ANY (v_ids)), 'D17 mi_bandeja excluye other');

  v_page := public.mesa_list_bandeja_page(
    25, NULL::timestamptz, NULL::uuid, 'todos', 'en_trabajo', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p206_assert(v_exp_mine::text = ANY (v_ids), 'D18 en_trabajo mine');
  PERFORM public.__p206_assert(v_exp_other::text = ANY (v_ids), 'D18 en_trabajo other');

  v_page := public.mesa_list_bandeja_page(
    25, NULL::timestamptz, NULL::uuid, 'todos', 'en_espera_asesor', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p206_assert(
    v_exp_wait::text = ANY (v_ids),
    'D19 en_espera_asesor incluye wait (WAITING / correccion_requerida)'
  );

  v_page := public.mesa_list_bandeja_page(
    25, NULL::timestamptz, NULL::uuid, 'todos', 'todo_mesa', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p206_assert(v_exp_free::text = ANY (v_ids), 'D20 todo_mesa free');
  PERFORM public.__p206_assert(v_exp_wait::text = ANY (v_ids), 'D20 todo_mesa wait');

  PERFORM public.__p206_reset();
  RAISE NOTICE 'P206 SQL fixtures OK';
END;
$$;

ROLLBACK;
