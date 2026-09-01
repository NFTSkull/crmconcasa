-- P207.2: colas operativas excluyen trámites finalizados Pago ConCasa (NOT_TERMINAL_PAGO).
\set ON_ERROR_STOP on
\ir ../migrations/20260901171420_mesa_disponibles_excluye_pago_concasa_finalizado.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.__p2072_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P207.2 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2072_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2072_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2072_in_queue(
  p_mesa UUID,
  p_id UUID,
  p_quick TEXT,
  p_ops TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_page JSONB;
  v_ids TEXT[];
BEGIN
  PERFORM public.__p2072_auth(p_mesa);
  v_page := public.mesa_list_bandeja_page(
    500, NULL::timestamptz, NULL::uuid, p_quick, p_ops, NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  RETURN p_id::text = ANY (v_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2072_list_count(p_mesa UUID, p_quick TEXT, p_ops TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_page JSONB;
BEGIN
  PERFORM public.__p2072_auth(p_mesa);
  v_page := public.mesa_list_bandeja_page(
    500, NULL::timestamptz, NULL::uuid, p_quick, p_ops, NULL, NULL, NULL, false,
    NULL, NULL, NULL, true
  );
  RETURN (v_page->>'total_count')::bigint;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_org UUID := '00000000-0000-4000-9207-000000000002';
  v_asesor UUID := '00000000-0000-4000-9207-000000000021';
  v_mesa UUID := '00000000-0000-4000-9207-000000000022';
  v_mesa2 UUID := '00000000-0000-4000-9207-000000000023';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-08-05 12:00:00+00';
  v_l1 TIMESTAMPTZ := timestamptz '2026-08-06 12:00:00+00';
  v_t1 UUID := '00000000-0000-4000-9207-000000000201';
  v_t2 UUID := '00000000-0000-4000-9207-000000000202';
  v_t3 UUID := '00000000-0000-4000-9207-000000000203';
  v_t4 UUID := '00000000-0000-4000-9207-000000000204';
  v_t5 UUID := '00000000-0000-4000-9207-000000000205';
  v_t6 UUID := '00000000-0000-4000-9207-000000000206';
  v_t7 UUID := '00000000-0000-4000-9207-000000000207';
  v_t8 UUID := '00000000-0000-4000-9207-000000000208';
  v_t9 UUID := '00000000-0000-4000-9207-000000000209';
  v_t10 UUID := '00000000-0000-4000-9207-000000000210';
  v_t11 UUID := '00000000-0000-4000-9207-000000000211';
  v_t12 UUID := '00000000-0000-4000-9207-000000000212';
  v_t13 UUID := '00000000-0000-4000-9207-000000000213';
  v_t14 UUID := '00000000-0000-4000-9207-000000000214';
  v_t15 UUID := '00000000-0000-4000-9207-000000000215';
  v_t16 UUID := '00000000-0000-4000-9207-000000000216';
  v_term UUID;
  v_list_count BIGINT;
  v_fast_count BIGINT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p2072_assert(position('etapa_actual < 12' in v_src) > 0, 'gate etapa<12');
  PERFORM public.__p2072_assert(position('pago_concasa_resultado IS NULL' in v_src) > 0, 'gate pago NULL');
  PERFORM public.__p2072_assert(position('UPDATE ' in v_src) = 0, 'T19 0 writers list');
  PERFORM public.__p2072_assert(
    position('WHEN ''correccion_enviada'' THEN' in v_src) > 0
      AND position('WHEN ''en_trabajo'' THEN' in v_src) > 0
      AND (length(v_src) - length(replace(v_src, 'pago_concasa_resultado IS NULL', '')))
          / length('pago_concasa_resultado IS NULL') >= 12,
    'NOT_TERMINAL_PAGO en quick/ops operativos'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_counts_fast'
  LIMIT 1;
  PERFORM public.__p2072_assert(position('etapa_actual < 12' in v_src) > 0, 'counts gate etapa');
  PERFORM public.__p2072_assert(position('UPDATE ' in v_src) = 0, 'T19 0 writers counts');
  PERFORM public.__p2072_assert(
    position('''otrasActualizaciones'', count(*) FILTER (
      WHERE ciclo_estado = ''activo''
        AND etapa_actual < 12
        AND pago_concasa_resultado IS NULL
        AND cambio_estado = ''ADVISOR_UPDATE_PENDING_REVIEW''' in v_src) > 0,
    'otrasActualizaciones con gate NOT_TERMINAL_PAGO'
  );

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p2072-org', 'P207.2 Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p2072-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p2072-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa2, 'authenticated', 'authenticated', 'p2072-mesa2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p2072-asesor@test.local', 'Asesor P207.2', 'asesor', NULL, true),
    (v_mesa, v_org, 'p2072-mesa@test.local', 'Mesa P207.2', 'mesa_interno', 'interno', true),
    (v_mesa2, v_org, 'p2072-mesa2@test.local', 'Mesa2 P207.2', 'mesa_interno', 'interno', true);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado, pago_concasa_resultado, deleted_at
  ) VALUES
    (v_t1, v_org, v_asesor, 'mejoravit', '92072000001', 'T1', '5512072001', 'interno', 'activo', true, v_envio, 1, 'pendiente', NULL, NULL),
    (v_t2, v_org, v_asesor, 'mejoravit', '92072000002', 'T2', '5512072002', 'interno', 'activo', true, v_envio, 2, 'en_proceso', NULL, NULL),
    (v_t3, v_org, v_asesor, 'mejoravit', '92072000003', 'T3 CORR3', '5512072003', 'interno', 'activo', true, v_envio, 3, 'en_proceso', NULL, NULL),
    (v_t4, v_org, v_asesor, 'mejoravit', '92072000004', 'T4 CORR11', '5512072004', 'interno', 'activo', true, v_envio, 11, 'en_proceso', NULL, NULL),
    (v_t5, v_org, v_asesor, 'mejoravit', '92072000005', 'T5 ADV1', '5512072005', 'interno', 'activo', true, v_envio, 1, 'en_validacion_mesa', NULL, NULL),
    (v_t6, v_org, v_asesor, 'mejoravit', '92072000006', 'T6 ADV4', '5512072006', 'interno', 'activo', true, v_envio, 4, 'en_proceso', NULL, NULL),
    (v_t7, v_org, v_asesor, 'mejoravit', '92072000007', 'T7 ADV9', '5512072007', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL, NULL),
    (v_t8, v_org, v_asesor, 'mejoravit', '92072000008', 'T8 ADV11', '5512072008', 'interno', 'activo', true, v_envio, 11, 'en_proceso', NULL, NULL),
    (v_t9, v_org, v_asesor, 'mejoravit', '92072000009', 'T9 E12PAG', '5512072009', 'interno', 'activo', true, v_envio, 12, 'en_proceso', 'pagado', NULL),
    (v_t10, v_org, v_asesor, 'mejoravit', '92072000010', 'T10 E12NOP', '5512072010', 'interno', 'activo', true, v_envio, 12, 'en_proceso', 'no_pagado', NULL),
    (v_t11, v_org, v_asesor, 'mejoravit', '92072000011', 'T11 E12COR', '5512072011', 'interno', 'activo', true, v_envio, 12, 'en_proceso', 'pagado', NULL),
    (v_t12, v_org, v_asesor, 'mejoravit', '92072000012', 'T12 ANOM', '5512072012', 'interno', 'activo', true, v_envio, 5, 'en_proceso', 'pagado', NULL),
    (v_t13, v_org, v_asesor, 'mejoravit', '92072000013', 'T13 WAIT', '5512072013', 'interno', 'activo', true, v_envio, 1, 'pendiente', NULL, NULL),
    (v_t14, v_org, v_asesor, 'mejoravit', '92072000014', 'T14 CLOSED', '5512072014', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL, NULL),
    (v_t15, v_org, v_asesor, 'mejoravit', '92072000015', 'T15 CANC', '5512072015', 'interno', 'cancelado', true, v_envio, 1, 'pendiente', NULL, NULL),
    (v_t16, v_org, v_asesor, 'mejoravit', '92072000016', 'T16 PLAIN5', '5512072016', 'interno', 'activo', true, v_envio, 5, 'en_proceso', NULL, NULL);

  INSERT INTO public.mesa_expediente_ops (
    expediente_id, organization_id, estado_mesa, assigned_to, assigned_at
  ) VALUES
    (v_t6, v_org, 'trabajando', v_mesa2, NOW()),
    (v_t9, v_org, 'trabajando', v_mesa, NOW());

  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES
    (v_t3, v_org, '{}'::jsonb, 'rechazado'),
    (v_t4, v_org, '{}'::jsonb, 'rechazado'),
    (v_t5, v_org, '{}'::jsonb, 'rechazado'),
    (v_t6, v_org, '{}'::jsonb, 'rechazado'),
    (v_t7, v_org, '{}'::jsonb, 'rechazado'),
    (v_t8, v_org, '{}'::jsonb, 'rechazado'),
    (v_t9, v_org, '{}'::jsonb, 'rechazado'),
    (v_t10, v_org, '{}'::jsonb, 'rechazado'),
    (v_t11, v_org, '{}'::jsonb, 'rechazado'),
    (v_t12, v_org, '{}'::jsonb, 'rechazado'),
    (v_t13, v_org, '{}'::jsonb, 'rechazado'),
    (v_t14, v_org, '{}'::jsonb, 'rechazado');

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t3,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t4,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t5,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t6,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t7,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t8,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t9,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t10,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t11,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t12,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t13,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t14,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1);

  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES
    (v_org, v_t3, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t4, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t5, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t6, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t7, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t8, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t9, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t10, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t11, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t12, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_t14, v_asesor, 'revisado', v_l1);

  UPDATE public.expediente_asesor_cambio_lotes
  SET reviewed_at = v_l1 + interval '1 hour', reviewed_by = v_mesa, status = 'revisado'
  WHERE expediente_id = v_t14;

  -- Disponibles (sin_asignar): activos sí, terminales no
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t1, 'todos', 'sin_asignar'), '1 nuevo etapa1');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t2, 'todos', 'sin_asignar'), '2 nuevo etapa2');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t3, 'todos', 'sin_asignar'), '3 CORRECTION etapa3');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t4, 'todos', 'sin_asignar'), '4 CORRECTION etapa11');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t5, 'todos', 'sin_asignar'), '5 ADVISOR etapa1 Mauricio-like');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t6, 'todos', 'sin_asignar'), '6 ADVISOR etapa4 assigned');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t7, 'todos', 'sin_asignar'), '7 ADVISOR etapa9');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t8, 'todos', 'sin_asignar'), '8 ADVISOR etapa11');
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t9, 'todos', 'sin_asignar'), '9 etapa12 pagado ADVISOR');
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t10, 'todos', 'sin_asignar'), '10 etapa12 no_pagado ADVISOR');
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t11, 'todos', 'sin_asignar'), '11 etapa12 pagado CORRECTION');
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t12, 'todos', 'sin_asignar'), '12 pago anomalo etapa5');
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t13, 'todos', 'sin_asignar'), '13 WAITING');
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t14, 'todos', 'sin_asignar'), '14 CLOSED');
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t15, 'todos', 'sin_asignar'), '15 cancelado');
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t16, 'todos', 'sin_asignar'), '16 plain etapa5');

  -- Mauricio-like: cambios / otras
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t5, 'correccion_enviada', 'todo_mesa'), 'Mauricio cambios');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t5, 'otras_actualizaciones', 'todo_mesa'), 'Mauricio otras');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t3, 'correccion_enviada', 'todo_mesa'), 'CORR etapa3 cambios');
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t8, 'otras_actualizaciones', 'todo_mesa'), 'ADV etapa11 otras');

  -- Terminales excluidos de colas operativas
  FOREACH v_term IN ARRAY ARRAY[v_t9, v_t10, v_t11, v_t12] LOOP
    PERFORM public.__p2072_assert(
      NOT public.__p2072_in_queue(v_mesa, v_term, 'correccion_enviada', 'todo_mesa'),
      'terminal NO cambios ' || v_term::text
    );
    PERFORM public.__p2072_assert(
      NOT public.__p2072_in_queue(v_mesa, v_term, 'correccion_solicitada', 'todo_mesa'),
      'terminal NO correcciones ' || v_term::text
    );
    PERFORM public.__p2072_assert(
      NOT public.__p2072_in_queue(v_mesa, v_term, 'otras_actualizaciones', 'todo_mesa'),
      'terminal NO otras ' || v_term::text
    );
    PERFORM public.__p2072_assert(
      NOT public.__p2072_in_queue(v_mesa, v_term, 'en_proceso', 'todo_mesa'),
      'terminal NO en_proceso ' || v_term::text
    );
    PERFORM public.__p2072_assert(
      NOT public.__p2072_in_queue(v_mesa, v_term, 'todos', 'en_trabajo'),
      'terminal NO en_trabajo ' || v_term::text
    );
  END LOOP;

  -- Wilfrido-like (t9): assigned pero terminal
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t9, 'todos', 'mi_bandeja'), 'Wilfrido NO mi_bandeja');
  PERFORM public.__p2072_assert(NOT public.__p2072_in_queue(v_mesa, v_t9, 'todos', 'en_trabajo'), 'Wilfrido NO en_trabajo');

  -- todo_mesa histórico: terminal sí localizable
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa, v_t9, 'todos', 'todo_mesa'), 'terminal SÍ todo_mesa');

  -- Assignment no-terminal sigue en en_trabajo
  PERFORM public.__p2072_assert(public.__p2072_in_queue(v_mesa2, v_t6, 'todos', 'en_trabajo'), 'T6 assigned en_trabajo');

  -- Paridad list/counts operativos
  v_list_count := public.__p2072_list_count(v_mesa, 'todos', 'sin_asignar');
  v_fast_count := (public.mesa_bandeja_counts_fast(NULL, NULL)->>'disponibles')::bigint;
  PERFORM public.__p2072_assert(v_list_count = v_fast_count, 'paridad disponibles');

  v_list_count := public.__p2072_list_count(v_mesa, 'correccion_enviada', 'todo_mesa');
  v_fast_count := (public.mesa_bandeja_counts_fast(NULL, NULL)->>'correccionesEnviadas')::bigint;
  PERFORM public.__p2072_assert(v_list_count = v_fast_count, 'paridad correccionesEnviadas');

  v_list_count := public.__p2072_list_count(v_mesa, 'otras_actualizaciones', 'todo_mesa');
  v_fast_count := (public.mesa_bandeja_counts_fast(NULL, NULL)->>'otrasActualizaciones')::bigint;
  PERFORM public.__p2072_assert(v_list_count = v_fast_count, 'paridad otrasActualizaciones');

  v_list_count := public.__p2072_list_count(v_mesa, 'en_proceso', 'todo_mesa');
  v_fast_count := (public.mesa_bandeja_counts_fast(NULL, NULL)->>'enProceso')::bigint;
  PERFORM public.__p2072_assert(v_list_count = v_fast_count, 'paridad enProceso');

  PERFORM public.__p2072_reset();
  RAISE NOTICE 'P207.2 SQL fixtures OK';
END;
$$;

ROLLBACK;

DROP FUNCTION IF EXISTS public.__p2072_list_count(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__p2072_in_queue(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__p2072_reset();
DROP FUNCTION IF EXISTS public.__p2072_auth(UUID);
DROP FUNCTION IF EXISTS public.__p2072_assert(BOOLEAN, TEXT);
