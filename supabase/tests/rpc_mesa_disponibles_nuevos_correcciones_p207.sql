-- P207: Disponibles = Nuevos en Mesa ∪ CORRECTION_PENDING_REVIEW
\set ON_ERROR_STOP on
\ir ../migrations/207_mesa_disponibles_nuevos_y_correcciones.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.__p207_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P207 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p207_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p207_reset()
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
  v_counts TEXT;
  v_p199 TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p207_assert(
    position('CORRECTION_PENDING_REVIEW' in v_src) > 0, 'pending en list'
  );
  PERFORM public.__p207_assert(
    position('WHEN ''sin_asignar'' THEN' in v_src) > 0, 'rama sin_asignar'
  );
  PERFORM public.__p207_assert(
    position('mesa_es_trabajo_accionable_mesa' in v_src) = 0,
    'P199 NO es autoridad de Disponibles'
  );
  PERFORM public.__p207_assert(position('UPDATE ' in v_src) = 0, '0 writers');
  PERFORM public.__p207_assert(
    position('WHEN ''nuevos'' THEN' in v_src) > 0
    AND position('etapa_actual IN (1, 2)' in v_src) > 0,
    'T19 quick nuevos intacto'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_take
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_take_expediente'
  LIMIT 1;
  PERFORM public.__p207_assert(position('P207' in coalesce(v_take, '')) = 0, 'take intacto');

  SELECT pg_get_functiondef(p.oid) INTO v_counts
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_counts_fast'
  LIMIT 1;
  PERFORM public.__p207_assert(position('P207' in coalesce(v_counts, '')) = 0, 'T20 counts intacto');

  SELECT pg_get_functiondef(p.oid) INTO v_p199
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_es_trabajo_accionable_mesa'
  LIMIT 1;
  PERFORM public.__p207_assert(v_p199 IS NOT NULL, 'P199 helper existe');
  PERFORM public.__p207_assert(position('P207' in coalesce(v_p199, '')) = 0, 'P199 no tocado');
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9207-000000000001';
  v_asesor UUID := '00000000-0000-4000-9207-000000000011';
  v_mesa UUID := '00000000-0000-4000-9207-000000000012';
  v_mesa2 UUID := '00000000-0000-4000-9207-000000000013';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-08-05 12:00:00+00';
  v_l1 TIMESTAMPTZ := timestamptz '2026-08-06 12:00:00+00';
  v_r2 TIMESTAMPTZ := timestamptz '2026-08-08 12:00:00+00';
  v_l2 TIMESTAMPTZ := timestamptz '2026-08-09 12:00:00+00';
  v_t1 UUID := '00000000-0000-4000-9207-000000000101';
  v_t2 UUID := '00000000-0000-4000-9207-000000000102';
  v_t3 UUID := '00000000-0000-4000-9207-000000000103';
  v_t4 UUID := '00000000-0000-4000-9207-000000000104';
  v_t5 UUID := '00000000-0000-4000-9207-000000000105';
  v_t6 UUID := '00000000-0000-4000-9207-000000000106';
  v_t7 UUID := '00000000-0000-4000-9207-000000000107';
  v_t8 UUID := '00000000-0000-4000-9207-000000000108';
  v_t9 UUID := '00000000-0000-4000-9207-000000000109';
  v_t10 UUID := '00000000-0000-4000-9207-000000000110';
  v_t11 UUID := '00000000-0000-4000-9207-000000000111';
  v_t12 UUID := '00000000-0000-4000-9207-000000000112';
  v_t13 UUID := '00000000-0000-4000-9207-000000000113';
  v_t14 UUID := '00000000-0000-4000-9207-000000000114';
  v_t15 UUID := '00000000-0000-4000-9207-000000000115';
  v_page JSONB;
  v_ids TEXT[];
  v_nuevos INT;
  v_eff TEXT;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p207-org', 'P207 Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p207-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p207-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa2, 'authenticated', 'authenticated', 'p207-mesa2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p207-asesor@test.local', 'Asesor P207', 'asesor', NULL, true),
    (v_mesa, v_org, 'p207-mesa@test.local', 'Mesa P207', 'mesa_interno', 'interno', true),
    (v_mesa2, v_org, 'p207-mesa2@test.local', 'Mesa2 P207', 'mesa_interno', 'interno', true);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado, pago_concasa_resultado
  ) VALUES
    (v_t1, v_org, v_asesor, 'mejoravit', '92070000001', 'T1', '5512070001', 'interno', 'activo', true, v_envio, 1, 'pendiente', NULL),
    (v_t2, v_org, v_asesor, 'mejoravit', '92070000002', 'T2', '5512070002', 'interno', 'activo', true, v_envio, 1, 'en_validacion_mesa', NULL),
    (v_t3, v_org, v_asesor, 'mejoravit', '92070000003', 'T3', '5512070003', 'interno', 'activo', true, v_envio, 2, 'en_proceso', NULL),
    (v_t4, v_org, v_asesor, 'mejoravit', '92070000004', 'T4', '5512070004', 'interno', 'activo', true, v_envio, 1, 'en_proceso', NULL),
    (v_t5, v_org, v_asesor, 'mejoravit', '92070000005', 'T5', '5512070005', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL),
    (v_t6, v_org, v_asesor, 'mejoravit', '92070000006', 'T6', '5512070006', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL),
    (v_t7, v_org, v_asesor, 'mejoravit', '92070000007', 'T7', '5512070007', 'interno', 'activo', true, v_envio, 1, 'en_proceso', NULL),
    (v_t8, v_org, v_asesor, 'mejoravit', '92070000008', 'T8', '5512070008', 'interno', 'activo', true, v_envio, 1, 'en_proceso', NULL),
    (v_t9, v_org, v_asesor, 'mejoravit', '92070000009', 'T9', '5512070009', 'interno', 'activo', true, v_envio, 5, 'en_proceso', NULL),
    (v_t10, v_org, v_asesor, 'mejoravit', '92070000010', 'T10', '5512070010', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL),
    (v_t11, v_org, v_asesor, 'mejoravit', '92070000011', 'T11', '5512070011', 'interno', 'activo', true, v_envio, 12, 'en_proceso', 'pagado'),
    (v_t12, v_org, v_asesor, 'mejoravit', '92070000012', 'T12', '5512070012', 'interno', 'activo', true, v_envio, 12, 'en_proceso', 'no_pagado'),
    (v_t13, v_org, v_asesor, 'mejoravit', '92070000013', 'T13', '5512070013', 'interno', 'activo', true, v_envio, 1, 'pendiente', NULL),
    (v_t14, v_org, v_asesor, 'mejoravit', '92070000014', 'T14', '5512070014', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL),
    (v_t15, v_org, v_asesor, 'mejoravit', '92070000015', 'T15', '5512070015', 'interno', 'activo', true, v_envio, 3, 'en_proceso', NULL);

  UPDATE public.expedientes SET ciclo_estado = 'cancelado' WHERE id = v_t13;

  INSERT INTO public.mesa_expediente_ops (
    expediente_id, organization_id, estado_mesa, assigned_to, assigned_at
  ) VALUES
    (v_t6, v_org, 'trabajando', v_mesa2, NOW());

  -- T4/T5/T6 PENDING: request + lote
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_t4, v_org, '{}'::jsonb, 'rechazado'),
         (v_t5, v_org, '{}'::jsonb, 'rechazado'),
         (v_t6, v_org, '{}'::jsonb, 'rechazado'),
         (v_t7, v_org, '{}'::jsonb, 'rechazado'),
         (v_t14, v_org, '{}'::jsonb, 'completo'),
         (v_t15, v_org, '{}'::jsonb, 'rechazado');

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t4,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t5,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t6,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t7,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t14,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t15,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1);

  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES
    (v_org, v_t4, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t5, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t6, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t8, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t14, v_asesor, 'revisado', v_l1),
    (v_org, v_t15, v_asesor, 'pendiente_revision', v_l1);

  UPDATE public.expediente_asesor_cambio_lotes
  SET reviewed_at = v_l1 + interval '1 hour', reviewed_by = v_mesa, status = 'revisado'
  WHERE expediente_id = v_t14;

  PERFORM public.__p207_auth(v_mesa);
  v_page := public.mesa_list_bandeja_page(
    100, NULL::timestamptz, NULL::uuid, 'todos', 'sin_asignar', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;

  PERFORM public.__p207_assert(v_t1::text = ANY (v_ids), 'T1');
  PERFORM public.__p207_assert(v_t2::text = ANY (v_ids), 'T2');
  PERFORM public.__p207_assert(v_t3::text = ANY (v_ids), 'T3');
  PERFORM public.__p207_assert(v_t4::text = ANY (v_ids), 'T4');
  PERFORM public.__p207_assert(v_t5::text = ANY (v_ids), 'T5');
  PERFORM public.__p207_assert(v_t6::text = ANY (v_ids), 'T6 assigned otro');
  PERFORM public.__p207_assert(NOT (v_t7::text = ANY (v_ids)), 'T7 WAITING');
  PERFORM public.__p207_assert(NOT (v_t8::text = ANY (v_ids)), 'T8 ADVISOR_UPDATE');
  PERFORM public.__p207_assert(NOT (v_t9::text = ANY (v_ids)), 'T9 etapa5');
  PERFORM public.__p207_assert(NOT (v_t10::text = ANY (v_ids)), 'T10 etapa9');
  PERFORM public.__p207_assert(NOT (v_t11::text = ANY (v_ids)), 'T11 pagado');
  PERFORM public.__p207_assert(NOT (v_t12::text = ANY (v_ids)), 'T12 no_pagado');
  PERFORM public.__p207_assert(NOT (v_t13::text = ANY (v_ids)), 'T13 cancelado');
  PERFORM public.__p207_assert(NOT (v_t14::text = ANY (v_ids)), 'T14 CLOSED');
  PERFORM public.__p207_assert(v_t15::text = ANY (v_ids), 'T15 R1 L1 PENDING');

  PERFORM public.__p207_reset();
  SELECT estado INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_t15);
  PERFORM public.__p207_assert(v_eff = 'CORRECTION_PENDING_REVIEW', 'T15 P198 pending');

  -- T16: Mesa pide R2
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t15,
    jsonb_build_object('estado_nuevo', 'rechazado'), v_r2
  );
  SELECT estado INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_t15);
  PERFORM public.__p207_assert(v_eff = 'WAITING_ADVISOR', 'T16 P198 WAITING');
  PERFORM public.__p207_auth(v_mesa);
  v_page := public.mesa_list_bandeja_page(
    100, NULL::timestamptz, NULL::uuid, 'todos', 'sin_asignar', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p207_assert(NOT (v_t15::text = ANY (v_ids)), 'T16 sale');

  -- T17: L2
  PERFORM public.__p207_reset();
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_t15, v_asesor, 'pendiente_revision', v_l2);
  SELECT estado INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_t15);
  PERFORM public.__p207_assert(v_eff = 'CORRECTION_PENDING_REVIEW', 'T17 pending otra vez');
  PERFORM public.__p207_auth(v_mesa);
  v_page := public.mesa_list_bandeja_page(
    100, NULL::timestamptz, NULL::uuid, 'todos', 'sin_asignar', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p207_assert(v_t15::text = ANY (v_ids), 'T17 vuelve');

  -- T18 assignment: T3 still in after take-like ops
  PERFORM public.__p207_reset();
  INSERT INTO public.mesa_expediente_ops (
    expediente_id, organization_id, estado_mesa, assigned_to, assigned_at
  ) VALUES (v_t3, v_org, 'trabajando', v_mesa, NOW());
  PERFORM public.__p207_auth(v_mesa);
  v_page := public.mesa_list_bandeja_page(
    100, NULL::timestamptz, NULL::uuid, 'todos', 'sin_asignar', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p207_assert(v_t3::text = ANY (v_ids), 'T18 assignment no saca');

  -- T19: quick nuevos still counts T1-T3
  v_page := public.mesa_list_bandeja_page(
    100, NULL::timestamptz, NULL::uuid, 'nuevos', 'todo_mesa', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT count(*)::int INTO v_nuevos
  FROM jsonb_array_elements(v_page->'items') x
  WHERE (x->>'id') IN (v_t1::text, v_t2::text, v_t3::text);
  PERFORM public.__p207_assert(v_nuevos = 3, 'T19 T1-T3 en chip Nuevos');

  PERFORM public.__p207_reset();
  RAISE NOTICE 'P207 SQL fixtures OK';
END;
$$;

ROLLBACK;
