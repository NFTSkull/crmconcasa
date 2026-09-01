-- P207.3: colas de cambios excluyen Firmados (etapa >= 11); en_proceso/mi_bandeja/en_trabajo conservan etapa 11.
\set ON_ERROR_STOP on
\ir ../migrations/20260901194500_mesa_cambios_excluye_firmados.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.__p2073_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P207.3 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2073_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2073_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2073_in_queue(
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
  PERFORM public.__p2073_auth(p_mesa);
  v_page := public.mesa_list_bandeja_page(
    500, NULL::timestamptz, NULL::uuid, p_quick, p_ops, NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  RETURN p_id::text = ANY (v_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2073_list_count(p_mesa UUID, p_quick TEXT, p_ops TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_page JSONB;
BEGIN
  PERFORM public.__p2073_auth(p_mesa);
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
  v_org UUID := '00000000-0000-4000-9207-000000000003';
  v_asesor UUID := '00000000-0000-4000-9207-000000000031';
  v_mesa UUID := '00000000-0000-4000-9207-000000000032';
  v_mesa2 UUID := '00000000-0000-4000-9207-000000000033';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-08-05 12:00:00+00';
  v_l1 TIMESTAMPTZ := timestamptz '2026-08-06 12:00:00+00';
  v_t1 UUID := '00000000-0000-4000-9207-000000000301';
  v_t2 UUID := '00000000-0000-4000-9207-000000000302';
  v_t3 UUID := '00000000-0000-4000-9207-000000000303';
  v_t4 UUID := '00000000-0000-4000-9207-000000000304';
  v_t5 UUID := '00000000-0000-4000-9207-000000000305';
  v_t6 UUID := '00000000-0000-4000-9207-000000000306';
  v_t7 UUID := '00000000-0000-4000-9207-000000000307';
  v_t8 UUID := '00000000-0000-4000-9207-000000000308';
  v_t9 UUID := '00000000-0000-4000-9207-000000000309';
  v_t10 UUID := '00000000-0000-4000-9207-000000000310';
  v_t11 UUID := '00000000-0000-4000-9207-000000000311';
  v_t12 UUID := '00000000-0000-4000-9207-000000000312';
  v_t13 UUID := '00000000-0000-4000-9207-000000000313';
  v_t14 UUID := '00000000-0000-4000-9207-000000000314';
  v_t15 UUID := '00000000-0000-4000-9207-000000000315';
  v_t16 UUID := '00000000-0000-4000-9207-000000000316';
  v_t17 UUID := '00000000-0000-4000-9207-000000000317';
  v_t18 UUID := '00000000-0000-4000-9207-000000000318';
  v_term UUID;
  v_list_count BIGINT;
  v_fast_count BIGINT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p2073_assert(position('etapa_actual < 11' in v_src) > 0, 'gate etapa<11 cambios');
  PERFORM public.__p2073_assert(position('etapa_actual < 12' in v_src) > 0, 'gate etapa<12 en_proceso');
  PERFORM public.__p2073_assert(position('pago_concasa_resultado IS NULL' in v_src) > 0, 'gate pago NULL');
  PERFORM public.__p2073_assert(position('UPDATE ' in v_src) = 0, 'T17 0 writers list');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_counts_fast'
  LIMIT 1;
  PERFORM public.__p2073_assert(position('etapa_actual < 11' in v_src) > 0, 'counts gate etapa<11');
  PERFORM public.__p2073_assert(position('UPDATE ' in v_src) = 0, 'T17 0 writers counts');

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p2073-org', 'P207.3 Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p2073-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p2073-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa2, 'authenticated', 'authenticated', 'p2073-mesa2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p2073-asesor@test.local', 'Asesor P207.3', 'asesor', NULL, true),
    (v_mesa, v_org, 'p2073-mesa@test.local', 'Mesa P207.3', 'mesa_interno', 'interno', true),
    (v_mesa2, v_org, 'p2073-mesa2@test.local', 'Mesa2 P207.3', 'mesa_interno', 'interno', true);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa,
    fecha_envio_mesa, etapa_actual, subestado, pago_concasa_resultado, deleted_at
  ) VALUES
    (v_t1, v_org, v_asesor, 'mejoravit', '92073000001', 'T1', '5512073001', 'interno', 'activo', true, v_envio, 1, 'pendiente', NULL, NULL),
    (v_t2, v_org, v_asesor, 'mejoravit', '92073000002', 'T2', '5512073002', 'interno', 'activo', true, v_envio, 2, 'en_proceso', NULL, NULL),
    (v_t3, v_org, v_asesor, 'mejoravit', '92073000003', 'T3 CORR4', '5512073003', 'interno', 'activo', true, v_envio, 4, 'en_proceso', NULL, NULL),
    (v_t4, v_org, v_asesor, 'mejoravit', '92073000004', 'T4 CORR11', '5512073004', 'interno', 'activo', true, v_envio, 11, 'en_proceso', NULL, NULL),
    (v_t5, v_org, v_asesor, 'mejoravit', '92073000005', 'T5 ADV1', '5512073005', 'interno', 'activo', true, v_envio, 1, 'en_validacion_mesa', NULL, NULL),
    (v_t6, v_org, v_asesor, 'mejoravit', '92073000006', 'T6 ADV4', '5512073006', 'interno', 'activo', true, v_envio, 4, 'en_proceso', NULL, NULL),
    (v_t7, v_org, v_asesor, 'mejoravit', '92073000007', 'T7 ADV9', '5512073007', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL, NULL),
    (v_t8, v_org, v_asesor, 'mejoravit', '92073000008', 'T8 ADV11', '5512073008', 'interno', 'activo', true, v_envio, 11, 'en_proceso', NULL, NULL),
    (v_t9, v_org, v_asesor, 'mejoravit', '92073000009', 'T9 E12PAG', '5512073009', 'interno', 'activo', true, v_envio, 12, 'en_proceso', 'pagado', NULL),
    (v_t10, v_org, v_asesor, 'mejoravit', '92073000010', 'T10 E12NOP', '5512073010', 'interno', 'activo', true, v_envio, 12, 'en_proceso', 'no_pagado', NULL),
    (v_t11, v_org, v_asesor, 'mejoravit', '92073000011', 'T11 E12COR', '5512073011', 'interno', 'activo', true, v_envio, 12, 'en_proceso', 'pagado', NULL),
    (v_t12, v_org, v_asesor, 'mejoravit', '92073000012', 'T12 ANOM', '5512073012', 'interno', 'activo', true, v_envio, 5, 'en_proceso', 'pagado', NULL),
    (v_t13, v_org, v_asesor, 'mejoravit', '92073000013', 'T13 WAIT', '5512073013', 'interno', 'activo', true, v_envio, 1, 'pendiente', NULL, NULL),
    (v_t14, v_org, v_asesor, 'mejoravit', '92073000014', 'T14 CLOSED', '5512073014', 'interno', 'activo', true, v_envio, 9, 'en_proceso', NULL, NULL),
    (v_t15, v_org, v_asesor, 'mejoravit', '92073000015', 'T15 CANC', '5512073015', 'interno', 'cancelado', true, v_envio, 1, 'pendiente', NULL, NULL),
    (v_t16, v_org, v_asesor, 'mejoravit', '92073000016', 'T16 PLAIN5', '5512073016', 'interno', 'activo', true, v_envio, 5, 'en_proceso', NULL, NULL),
    (v_t17, v_org, v_asesor, 'mejoravit', '92073000017', 'T17 ADV10', '5512073017', 'interno', 'activo', true, v_envio, 10, 'en_proceso', NULL, NULL),
    (v_t18, v_org, v_asesor, 'mejoravit', '92073000018', 'T18 WAIT11', '5512073018', 'interno', 'activo', true, v_envio, 11, 'en_proceso', NULL, NULL);

  INSERT INTO public.mesa_expediente_ops (
    expediente_id, organization_id, estado_mesa, assigned_to, assigned_at
  ) VALUES
    (v_t6, v_org, 'trabajando', v_mesa2, NOW()),
    (v_t8, v_org, 'trabajando', v_mesa, NOW()),
    (v_t9, v_org, 'trabajando', v_mesa, NOW());

  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES
    (v_t3, v_org, '{}'::jsonb, 'rechazado'),
    (v_t4, v_org, '{}'::jsonb, 'rechazado'),
    (v_t5, v_org, '{}'::jsonb, 'completo'),
    (v_t6, v_org, '{}'::jsonb, 'completo'),
    (v_t7, v_org, '{}'::jsonb, 'completo'),
    (v_t8, v_org, '{}'::jsonb, 'completo'),
    (v_t9, v_org, '{}'::jsonb, 'rechazado'),
    (v_t10, v_org, '{}'::jsonb, 'rechazado'),
    (v_t11, v_org, '{}'::jsonb, 'rechazado'),
    (v_t12, v_org, '{}'::jsonb, 'rechazado'),
    (v_t13, v_org, '{}'::jsonb, 'rechazado'),
    (v_t14, v_org, '{}'::jsonb, 'rechazado'),
    (v_t17, v_org, '{}'::jsonb, 'completo'),
    (v_t18, v_org, '{}'::jsonb, 'rechazado');

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t3,
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t4,
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
     jsonb_build_object('estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_t18,
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
    (v_org, v_t14, v_asesor, 'revisado', v_l1),
    (v_org, v_t17, v_asesor, 'pendiente_revision', v_l1);

  UPDATE public.expediente_asesor_cambio_lotes
  SET reviewed_at = v_l1 + interval '1 hour', reviewed_by = v_mesa, status = 'revisado'
  WHERE expediente_id = v_t14;

  -- T1 etapa10 ADVISOR → Disponibles YES
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t17, 'todos', 'sin_asignar'), 'T1 etapa10 ADVISOR disponibles');

  -- T2 etapa11 ADVISOR → Disponibles NO
  PERFORM public.__p2073_assert(NOT public.__p2073_in_queue(v_mesa, v_t8, 'todos', 'sin_asignar'), 'T2 etapa11 ADVISOR NO disponibles');

  -- T3 etapa11 CORRECTION → Disponibles NO
  PERFORM public.__p2073_assert(NOT public.__p2073_in_queue(v_mesa, v_t4, 'todos', 'sin_asignar'), 'T3 etapa11 CORRECTION NO disponibles');

  -- T4 etapa11 ADVISOR → Cambios NO
  PERFORM public.__p2073_assert(
    NOT public.__p2073_in_queue(v_mesa, v_t8, 'correccion_enviada', 'todo_mesa'),
    'T4 etapa11 ADVISOR NO cambios'
  );

  -- T5 etapa11 ADVISOR → Otras NO
  PERFORM public.__p2073_assert(
    NOT public.__p2073_in_queue(v_mesa, v_t8, 'otras_actualizaciones', 'todo_mesa'),
    'T5 etapa11 ADVISOR NO otras'
  );

  -- T6 etapa11 CORRECTION → Correcciones NO
  PERFORM public.__p2073_assert(
    NOT public.__p2073_in_queue(v_mesa, v_t4, 'correccion_solicitada', 'todo_mesa'),
    'T6 etapa11 CORRECTION NO correcciones'
  );

  -- T7 etapa11 WAITING → Esperando asesor NO
  PERFORM public.__p2073_assert(
    NOT public.__p2073_in_queue(v_mesa, v_t18, 'todos', 'en_espera_asesor'),
    'T7 etapa11 WAITING NO en_espera_asesor'
  );

  -- T8 etapa11 assigned → En trabajo YES
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t8, 'todos', 'en_trabajo'), 'T8 etapa11 en_trabajo');

  -- T9 etapa11 assigned actor → Mi bandeja YES
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t8, 'todos', 'mi_bandeja'), 'T9 etapa11 mi_bandeja');

  -- T10 etapa11 en_proceso → En proceso YES
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t8, 'en_proceso', 'todo_mesa'), 'T10 etapa11 en_proceso');

  -- T11 etapa11 → Todo Mesa YES
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t8, 'todos', 'todo_mesa'), 'T11 etapa11 todo_mesa');

  -- Operativos pre-etapa11 siguen accionables
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t1, 'todos', 'sin_asignar'), 'nuevo etapa1');
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t3, 'todos', 'sin_asignar'), 'T14 CORR etapa4');
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t5, 'todos', 'sin_asignar'), 'T13 Mauricio ADV1');
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t7, 'todos', 'sin_asignar'), 'T15 ADV etapa9');
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t5, 'correccion_enviada', 'todo_mesa'), 'Mauricio cambios');
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t5, 'otras_actualizaciones', 'todo_mesa'), 'Mauricio otras');

  -- T12 etapa12 pagado → fuera de colas operativas P207.2
  FOREACH v_term IN ARRAY ARRAY[v_t9, v_t10, v_t11, v_t12] LOOP
    PERFORM public.__p2073_assert(
      NOT public.__p2073_in_queue(v_mesa, v_term, 'correccion_enviada', 'todo_mesa'),
      'T12 terminal NO cambios ' || v_term::text
    );
    PERFORM public.__p2073_assert(
      NOT public.__p2073_in_queue(v_mesa, v_term, 'otras_actualizaciones', 'todo_mesa'),
      'T12 terminal NO otras ' || v_term::text
    );
    PERFORM public.__p2073_assert(
      NOT public.__p2073_in_queue(v_mesa, v_term, 'todos', 'sin_asignar'),
      'T12 terminal NO disponibles ' || v_term::text
    );
  END LOOP;

  PERFORM public.__p2073_assert(NOT public.__p2073_in_queue(v_mesa, v_t9, 'todos', 'mi_bandeja'), 'terminal NO mi_bandeja');
  PERFORM public.__p2073_assert(public.__p2073_in_queue(v_mesa, v_t9, 'todos', 'todo_mesa'), 'terminal SÍ todo_mesa');

  -- T16 paridad list/counts
  v_list_count := public.__p2073_list_count(v_mesa, 'todos', 'sin_asignar');
  v_fast_count := (public.mesa_bandeja_counts_fast(NULL, NULL)->>'disponibles')::bigint;
  PERFORM public.__p2073_assert(v_list_count = v_fast_count, 'T16 paridad disponibles');

  v_list_count := public.__p2073_list_count(v_mesa, 'correccion_enviada', 'todo_mesa');
  v_fast_count := (public.mesa_bandeja_counts_fast(NULL, NULL)->>'correccionesEnviadas')::bigint;
  PERFORM public.__p2073_assert(v_list_count = v_fast_count, 'T16 paridad correccionesEnviadas');

  v_list_count := public.__p2073_list_count(v_mesa, 'otras_actualizaciones', 'todo_mesa');
  v_fast_count := (public.mesa_bandeja_counts_fast(NULL, NULL)->>'otrasActualizaciones')::bigint;
  PERFORM public.__p2073_assert(v_list_count = v_fast_count, 'T16 paridad otrasActualizaciones');

  v_list_count := public.__p2073_list_count(v_mesa, 'en_proceso', 'todo_mesa');
  v_fast_count := (public.mesa_bandeja_counts_fast(NULL, NULL)->>'enProceso')::bigint;
  PERFORM public.__p2073_assert(v_list_count = v_fast_count, 'T16 paridad enProceso');

  PERFORM public.__p2073_reset();
  RAISE NOTICE 'P207.3 SQL fixtures OK';
END;
$$;

ROLLBACK;

DROP FUNCTION IF EXISTS public.__p2073_list_count(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__p2073_in_queue(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__p2073_reset();
DROP FUNCTION IF EXISTS public.__p2073_auth(UUID);
DROP FUNCTION IF EXISTS public.__p2073_assert(BOOLEAN, TEXT);
