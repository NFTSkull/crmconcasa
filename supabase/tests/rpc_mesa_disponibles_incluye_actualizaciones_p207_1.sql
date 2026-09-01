-- P207.1: Disponibles = Nuevos ∪ CORRECTION_PENDING ∪ ADVISOR_UPDATE pending
\set ON_ERROR_STOP on
\ir ../migrations/20260901164142_mesa_disponibles_incluye_actualizaciones_asesor.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.__p2071_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P207.1 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2071_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2071_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2071_in_disponibles(p_mesa UUID, p_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_page JSONB;
  v_ids TEXT[];
BEGIN
  PERFORM public.__p2071_auth(p_mesa);
  v_page := public.mesa_list_bandeja_page(
    200, NULL::timestamptz, NULL::uuid, 'todos', 'sin_asignar', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  RETURN p_id::text = ANY (v_ids);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_org UUID := '00000000-0000-4000-9207-000000000001';
  v_asesor UUID := '00000000-0000-4000-9207-000000000011';
  v_mesa UUID := '00000000-0000-4000-9207-000000000012';
  v_mesa2 UUID := '00000000-0000-4000-9207-000000000013';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-08-05 12:00:00+00';
  v_l1 TIMESTAMPTZ := timestamptz '2026-08-06 12:00:00+00';
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
  v_t16 UUID := '00000000-0000-4000-9207-000000000116';
  v_t17 UUID := '00000000-0000-4000-9207-000000000117';
  v_t18 UUID := '00000000-0000-4000-9207-000000000118';
  v_page JSONB;
  v_ids TEXT[];
  v_nuevos INT;
  v_eff TEXT;
  v_list_count BIGINT;
  v_fast_count BIGINT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p2071_assert(
    position('ADVISOR_UPDATE_PENDING_REVIEW' in v_src) > 0, 'ADVISOR_UPDATE en list'
  );
  PERFORM public.__p2071_assert(
    position('IS DISTINCT FROM ''ADVISOR_UPDATE_PENDING_REVIEW''' in v_src) = 0,
    'sin exclusion ADVISOR_UPDATE en rama nuevos'
  );
  PERFORM public.__p2071_assert(position('UPDATE ' in v_src) = 0, 'T30 0 writers list');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_counts_fast'
  LIMIT 1;
  PERFORM public.__p2071_assert(position('''disponibles''' in v_src) > 0, 'counts disponibles field');
  PERFORM public.__p2071_assert(position('UPDATE ' in v_src) = 0, 'T30 0 writers counts');

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p2071-org', 'P207.1 Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p2071-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p2071-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa2, 'authenticated', 'authenticated', 'p2071-mesa2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p2071-asesor@test.local', 'Asesor P207.1', 'asesor', NULL, true),
    (v_mesa, v_org, 'p2071-mesa@test.local', 'Mesa P207.1', 'mesa_interno', 'interno', true),
    (v_mesa2, v_org, 'p2071-mesa2@test.local', 'Mesa2 P207.1', 'mesa_interno', 'interno', true);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado, pago_concasa_resultado, deleted_at
  ) VALUES
    (v_t1, v_org, v_asesor, 'mejoravit', '92071000001', 'T1', '5512071001', 'interno', 'activo', true, v_envio, 1, 'pendiente', NULL, NULL),
    (v_t2, v_org, v_asesor, 'mejoravit', '92071000002', 'T2', '5512071002', 'interno', 'activo', true, v_envio, 1, 'en_validacion_mesa', NULL, NULL),
    (v_t3, v_org, v_asesor, 'mejoravit', '92071000003', 'T3', '5512071003', 'interno', 'activo', true, v_envio, 2, 'en_proceso', NULL, NULL),
    (v_t4, v_org, v_asesor, 'mejoravit', '92071000004', 'T4', '5512071004', 'interno', 'activo', true, v_envio, 1, 'en_proceso', NULL, NULL),
    (v_t5, v_org, v_asesor, 'mejoravit', '92071000005', 'T5', '5512071005', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL, NULL),
    (v_t6, v_org, v_asesor, 'mejoravit', '92071000006', 'T6', '5512071006', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL, NULL),
    (v_t7, v_org, v_asesor, 'mejoravit', '92071000007', 'T7', '5512071007', 'interno', 'activo', true, v_envio, 1, 'en_proceso', NULL, NULL),
    (v_t8, v_org, v_asesor, 'mejoravit', '92071000008', 'T8', '5512071008', 'interno', 'activo', true, v_envio, 2, 'en_proceso', NULL, NULL),
    (v_t9, v_org, v_asesor, 'mejoravit', '92071000009', 'T9', '5512071009', 'interno', 'activo', true, v_envio, 3, 'en_proceso', NULL, NULL),
    (v_t10, v_org, v_asesor, 'mejoravit', '92071000010', 'T10', '5512071010', 'interno', 'activo', true, v_envio, 4, 'en_proceso', NULL, NULL),
    (v_t11, v_org, v_asesor, 'mejoravit', '92071000011', 'T11', '5512071011', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL, NULL),
    (v_t12, v_org, v_asesor, 'mejoravit', '92071000012', 'T12', '5512071012', 'interno', 'activo', true, v_envio, 12, 'en_proceso', 'pagado', NULL),
    (v_t13, v_org, v_asesor, 'mejoravit', '92071000013', 'T13', '5512071013', 'interno', 'activo', true, v_envio, 1, 'pendiente', NULL, NULL),
    (v_t14, v_org, v_asesor, 'mejoravit', '92071000014', 'T14', '5512071014', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL, NULL),
    (v_t15, v_org, v_asesor, 'mejoravit', '92071000015', 'T15', '5512071015', 'interno', 'activo', true, v_envio, 3, 'en_proceso', NULL, NULL),
    (v_t16, v_org, v_asesor, 'mejoravit', '92071000016', 'T16', '5512071016', 'interno', 'activo', true, v_envio, 5, 'en_proceso', NULL, NULL),
    (v_t17, v_org, v_asesor, 'mejoravit', '92071000017', 'T17', '5512071017', 'interno', 'activo', false, NULL, 1, 'pendiente', NULL, NULL),
    (v_t18, v_org, v_asesor, 'mejoravit', '92071000018', 'T18', '5512071018', 'interno', 'activo', true, v_envio, 1, 'pendiente', NULL, NOW());

  UPDATE public.expedientes SET ciclo_estado = 'cancelado' WHERE id = v_t13;

  INSERT INTO public.mesa_expediente_ops (
    expediente_id, organization_id, estado_mesa, assigned_to, assigned_at
  ) VALUES
    (v_t6, v_org, 'trabajando', v_mesa2, NOW()),
    (v_t8, v_org, 'trabajando', v_mesa2, NOW());

  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES
    (v_t4, v_org, '{}'::jsonb, 'rechazado'),
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
    (v_org, v_t9, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t10, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t11, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t12, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t14, v_asesor, 'revisado', v_l1),
    (v_org, v_t15, v_asesor, 'pendiente_revision', v_l1);

  UPDATE public.expediente_asesor_cambio_lotes
  SET reviewed_at = v_l1 + interval '1 hour', reviewed_by = v_mesa, status = 'revisado'
  WHERE expediente_id = v_t14;

  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t1), 'T1');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t2), 'T2');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t3), 'T3');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t4), 'T4 CORRECTION etapa1');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t5), 'T5 CORRECTION etapa9');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t6), 'T6 CORRECTION assigned');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t8), 'T7/T8 ADVISOR etapa2 assigned');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t9), 'T9 ADVISOR etapa3');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t10), 'T10 ADVISOR etapa4');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t11), 'T11 ADVISOR etapa9');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t12), 'T12 ADVISOR etapa12');
  PERFORM public.__p2071_assert(NOT public.__p2071_in_disponibles(v_mesa, v_t7), 'T13 WAITING etapa1');
  PERFORM public.__p2071_assert(NOT public.__p2071_in_disponibles(v_mesa, v_t14), 'T15 CLOSED');
  PERFORM public.__p2071_assert(NOT public.__p2071_in_disponibles(v_mesa, v_t13), 'T16 cancelado');
  PERFORM public.__p2071_assert(NOT public.__p2071_in_disponibles(v_mesa, v_t16), 'T20 etapa5 plain');
  PERFORM public.__p2071_assert(NOT public.__p2071_in_disponibles(v_mesa, v_t17), 'T18 no submitted');
  PERFORM public.__p2071_assert(NOT public.__p2071_in_disponibles(v_mesa, v_t18), 'T19 deleted');
  PERFORM public.__p2071_assert(public.__p2071_in_disponibles(v_mesa, v_t15), 'T3 CORRECTION etapa3');

  PERFORM public.__p2071_auth(v_mesa);
  v_page := public.mesa_list_bandeja_page(
    200, NULL::timestamptz, NULL::uuid, 'correccion_enviada', 'todo_mesa', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p2071_assert(v_t4::text = ANY (v_ids), 'T22 correccion_enviada CORRECTION');
  PERFORM public.__p2071_assert(v_t8::text = ANY (v_ids), 'T22 correccion_enviada ADVISOR');

  v_page := public.mesa_list_bandeja_page(
    200, NULL::timestamptz, NULL::uuid, 'otras_actualizaciones', 'todo_mesa', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p2071_assert(v_t8::text = ANY (v_ids), 'T23 otras ADVISOR');
  PERFORM public.__p2071_assert(NOT (v_t4::text = ANY (v_ids)), 'T23 otras solo ADVISOR');

  v_page := public.mesa_list_bandeja_page(
    200, NULL::timestamptz, NULL::uuid, 'correccion_solicitada', 'todo_mesa', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p2071_assert(v_t4::text = ANY (v_ids), 'T24 solicitud CORRECTION');
  PERFORM public.__p2071_assert(NOT (v_t8::text = ANY (v_ids)), 'T24 solicitud no ADVISOR');

  v_page := public.mesa_list_bandeja_page(
    200, NULL::timestamptz, NULL::uuid, 'nuevos', 'todo_mesa', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT count(*)::int INTO v_nuevos
  FROM jsonb_array_elements(v_page->'items') x
  WHERE (x->>'id') IN (v_t1::text, v_t2::text, v_t3::text);
  PERFORM public.__p2071_assert(v_nuevos = 3, 'T25 nuevos T1-T3');

  v_page := public.mesa_list_bandeja_page(
    1, NULL::timestamptz, NULL::uuid, 'todos', 'mi_bandeja', NULL, NULL, NULL, false,
    NULL, NULL, NULL, true
  );
  PERFORM public.__p2071_assert((v_page->'total_count')::bigint >= 0, 'T26 mi_bandeja ok');

  v_page := public.mesa_list_bandeja_page(
    1, NULL::timestamptz, NULL::uuid, 'todos', 'en_trabajo', NULL, NULL, NULL, false,
    NULL, NULL, NULL, true
  );
  PERFORM public.__p2071_assert((v_page->'total_count')::bigint >= 0, 'T27 en_trabajo ok');

  v_page := public.mesa_list_bandeja_page(
    1, NULL::timestamptz, NULL::uuid, 'todos', 'en_espera_asesor', NULL, NULL, NULL, false,
    NULL, NULL, NULL, true
  );
  PERFORM public.__p2071_assert((v_page->'total_count')::bigint >= 0, 'T28 en_espera ok');

  v_page := public.mesa_list_bandeja_page(
    500, NULL::timestamptz, NULL::uuid, 'todos', 'sin_asignar', NULL, NULL, NULL, false,
    NULL, NULL, NULL, true
  );
  v_list_count := (v_page->>'total_count')::bigint;
  v_fast_count := (public.mesa_bandeja_counts_fast(NULL, NULL)->>'disponibles')::bigint;
  PERFORM public.__p2071_assert(v_list_count = v_fast_count, 'T29 list=counts disponibles');

  PERFORM public.__p2071_reset();
  RAISE NOTICE 'P207.1 SQL fixtures OK';
END;
$$;

ROLLBACK;

DROP FUNCTION IF EXISTS public.__p2071_in_disponibles(UUID, UUID);
DROP FUNCTION IF EXISTS public.__p2071_reset();
DROP FUNCTION IF EXISTS public.__p2071_auth(UUID);
DROP FUNCTION IF EXISTS public.__p2071_assert(BOOLEAN, TEXT);
