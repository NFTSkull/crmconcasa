-- P198: estado efectivo revisión Mesa. M1–M9 + M14 Disponibles. 0 writers.
\set ON_ERROR_STOP on
\ir ../migrations/198_mesa_cambio_revision_estado_efectivo.sql

CREATE OR REPLACE FUNCTION public.__p198_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P198 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p198_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p198_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_bandeja TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_cambio_revision_estado_efectivo'
  LIMIT 1;
  PERFORM public.__p198_assert(v_src IS NOT NULL, 'helper existe');
  PERFORM public.__p198_assert(position('STABLE' in v_src) > 0, 'helper STABLE');
  PERFORM public.__p198_assert(position('UPDATE ' in v_src) = 0, 'helper sin UPDATE');
  PERFORM public.__p198_assert(position('WAITING_ADVISOR' in v_src) > 0, 're-reject WAITING');
  PERFORM public.__p198_assert(position('CLOSED' in v_src) > 0, 'cierre canónico');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_cambio_tiene_cierre_canonico'
  LIMIT 1;
  PERFORM public.__p198_assert(position('SOLICITUD_DATOS_GENERALES' in v_src) > 0, 'cierre DG');
  PERFORM public.__p198_assert(position('SOLICITUD_DOCUMENTAL' in v_src) > 0, 'cierre documental');
  PERFORM public.__p198_assert(position('tipo_documento' in v_src) > 0, 'identidad documental');
  PERFORM public.__p198_assert(position('RECHAZO_OPERATIVO_CON_CORRECCION' in v_src) > 0, 'cierre operativo');
  PERFORM public.__p198_assert(position('fecha_envio_mesa' in v_src) > 0, 'ciclo actual');

  SELECT pg_get_functiondef(p.oid) INTO v_bandeja
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p198_assert(
    position('WHEN ''sin_asignar'' THEN' in v_bandeja) > 0,
    'sin_asignar sigue'
  );
  PERFORM public.__p198_assert(
    position('cl.subestado IS DISTINCT FROM ''rechazado''' in v_bandeja) > 0,
    'M14 Disponibles excluye rechazado'
  );
  PERFORM public.__p198_assert(
    position('cl.assigned_to IS NULL' in v_bandeja) > 0,
    'M14 assigned_to IS NULL'
  );
  PERFORM public.__p198_assert(
    position('cl.categoria IS DISTINCT FROM ''correccion_requerida''' in v_bandeja) > 0,
    'M14 no correccion_requerida'
  );
  PERFORM public.__p198_assert(position('mesa_take' in v_bandeja) = 0, 'no take');
  PERFORM public.__p198_assert(position('UPDATE ' in v_bandeja) = 0, 'list sin UPDATE');
  PERFORM public.__p198_assert(
    position('CORRECTION_PENDING_REVIEW' in v_bandeja) > 0,
    'filtros usan estado efectivo'
  );
  RAISE NOTICE 'P198 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_envio TIMESTAMPTZ := timestamptz '2026-07-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-07-05 12:00:00+00';
  v_l1 TIMESTAMPTZ := timestamptz '2026-07-10 12:00:00+00';
  v_r2 TIMESTAMPTZ := timestamptz '2026-07-15 12:00:00+00';
  v_l2 TIMESTAMPTZ := timestamptz '2026-07-20 12:00:00+00';
  v_close TIMESTAMPTZ := timestamptz '2026-07-12 12:00:00+00';
  v_exp UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_eff RECORD;
  v_page JSONB;
  v_hit INT;
  v_status TEXT;
BEGIN
  -- M1 R1→L1 pending, sin acción Mesa
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800001',
    'P198 M1 activa', '5519280001', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'M1 estado');

  -- M2 mark reviewed
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800002',
    'P198 M2 reviewed', '5519280002', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_exp, v_asesor, 'revisado', v_l1, v_close, v_mesa);
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CLOSED', 'M2 closed');

  -- M3 stale: L1 pending + DG validado posterior
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800003',
    'P198 M3 stale', '5519280003', '', 'interno', 'activo',
    true, v_envio, 11, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'validado'), v_close
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CLOSED', 'M3 stale closed');
  SELECT status::text INTO v_status FROM public.expediente_asesor_cambio_lotes
  WHERE expediente_id = v_exp LIMIT 1;
  PERFORM public.__p198_assert(v_status = 'pendiente_revision', 'M3 raw intacto');

  -- M4 re-reject R1 L1 R2
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800004',
    'P198 M4 rereject', '5519280004', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r2
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'WAITING_ADVISOR', 'M4 waiting');

  -- M5 R1 L1 R2 L2
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800005',
    'P198 M5 segunda', '5519280005', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES
    (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1),
    (v_org, v_exp, v_asesor, 'pendiente_revision', v_l2);
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'M5 L2 pending');

  -- M6 advisor update
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800006',
    'P198 M6 update', '5519280006', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'ADVISOR_UPDATE_PENDING_REVIEW', 'M6 update');

  -- M7 update + close DG
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800007',
    'P198 M7 update closed', '5519280007', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'validado'), v_close
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CLOSED', 'M7 update closed');

  -- M8 etapa avanzada stale (alias M3 etapa 11)
  -- M9 etapa avanzada REAL
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800009',
    'P198 M9 avanzada real', '5519280009', '', 'interno', 'activo',
    true, v_envio, 11, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r2
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l2);
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'M9 avanzada real');

  PERFORM public.__p198_set_auth(v_mesa);

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_solicitada', 'todo_mesa',
    'P198 M1 activa', NULL, NULL, false, NULL, 'rechazados', NULL, true
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M1 activa';
  PERFORM public.__p198_assert(v_hit = 1, 'M1 en Correcciones');
  PERFORM public.__p198_assert(
    (
      SELECT x->>'cambio_revision_estado'
      FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
      WHERE x->>'cliente_nombre' = 'P198 M1 activa' LIMIT 1
    ) = 'CORRECTION_PENDING_REVIEW',
    'M1 item estado'
  );

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_enviada', 'todo_mesa',
    'P198 M2 reviewed', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M2 reviewed';
  PERFORM public.__p198_assert(v_hit = 0, 'M2 fuera parent');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_solicitada', 'todo_mesa',
    'P198 M3 stale', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M3 stale';
  PERFORM public.__p198_assert(v_hit = 0, 'M3/M8 fuera correcciones');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_solicitada', 'todo_mesa',
    'P198 M4 rereject', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M4 rereject';
  PERFORM public.__p198_assert(v_hit = 0, 'M4 no correcciones');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'todos', 'en_espera_asesor',
    'P198 M4 rereject', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M4 rereject';
  PERFORM public.__p198_assert(v_hit = 1, 'M4 en espera');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_solicitada', 'todo_mesa',
    'P198 M5 segunda', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M5 segunda';
  PERFORM public.__p198_assert(v_hit = 1, 'M5 correcciones L2');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'todos', 'en_espera_asesor',
    'P198 M5 segunda', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M5 segunda';
  PERFORM public.__p198_assert(v_hit = 0, 'M5 no espera');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'otras_actualizaciones', 'todo_mesa',
    'P198 M6 update', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M6 update';
  PERFORM public.__p198_assert(v_hit = 1, 'M6 actualizaciones');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_solicitada', 'todo_mesa',
    'P198 M6 update', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M6 update';
  PERFORM public.__p198_assert(v_hit = 0, 'M6 no correcciones');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'otras_actualizaciones', 'todo_mesa',
    'P198 M7 update closed', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M7 update closed';
  PERFORM public.__p198_assert(v_hit = 0, 'M7 fuera actualizaciones');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_solicitada', 'todo_mesa',
    'P198 M9 avanzada real', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P198 M9 avanzada real';
  PERFORM public.__p198_assert(v_hit = 1, 'M9 sí en correcciones etapa 11');

  PERFORM public.__p198_reset_auth();

  DELETE FROM public.expediente_asesor_cambios
  WHERE lote_id IN (
    SELECT id FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids)
  );
  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY(v_ids);
  DELETE FROM public.cliente_datos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.mesa_expediente_ops WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expedientes WHERE id = ANY(v_ids);

  RAISE NOTICE 'P198 OK: M1–M9 + M14 contrato';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_envio TIMESTAMPTZ := timestamptz '2026-07-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-07-05 12:00:00+00';
  v_l1 TIMESTAMPTZ := timestamptz '2026-07-10 12:00:00+00';
  v_close TIMESTAMPTZ := timestamptz '2026-07-12 12:00:00+00';
  v_r2 TIMESTAMPTZ := timestamptz '2026-07-15 12:00:00+00';
  v_new_envio TIMESTAMPTZ := timestamptz '2026-07-25 10:00:00+00';
  v_exp UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_eff RECORD;
  v_doc UUID;
  v_doc2 UUID;
  v_doc_new UUID;
  v_lote UUID;
  v_rechazo UUID;
BEGIN
  -- M15 DG + validar documento ajeno
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800015',
    'P198 M15 dg vs doc', '5519280015', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_estado_cuenta',
    v_org::text || '/' || v_exp::text || '/edc/m15.pdf',
    'edc.pdf', 'application/pdf', 100, 1, 'validado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc, v_exp, 'subido', 'validado', NULL, v_mesa, v_close
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'M15 DG no cierra por doc');

  -- M16 DG sí cierra por DG
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800016',
    'P198 M16 dg cierra', '5519280016', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'validado'), v_close);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CLOSED', 'M16 DG cierra por DG');

  -- M17 rechazo INE, valida estado de cuenta
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800017',
    'P198 M17 ine vs edc', '5519280017', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_ine_frente',
    v_org::text || '/' || v_exp::text || '/ine/m17.pdf',
    'ine.pdf', 'application/pdf', 100, 1, 'rechazado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc, v_exp, 'subido', 'rechazado', 'ilegible', v_mesa, v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, document_kind, label)
  VALUES (v_lote, 'doc:ine', 'documento_reemplazado', 'documento', 'cliente_ine_frente', 'INE');
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_estado_cuenta',
    v_org::text || '/' || v_exp::text || '/edc/m17.pdf',
    'edc.pdf', 'application/pdf', 100, 1, 'validado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc2;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc2, v_exp, 'subido', 'validado', NULL, v_mesa, v_close
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'M17 INE no cierra por EDC');
  PERFORM public.__p198_assert(v_eff.request_type = 'SOLICITUD_DOCUMENTAL', 'M17 request documental');

  -- M18 mismo INE sí cierra
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800018',
    'P198 M18 ine cierra', '5519280018', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role, deleted_at
  ) VALUES (
    v_org, v_exp, 'cliente_ine_frente',
    v_org::text || '/' || v_exp::text || '/ine/m18v1.pdf',
    'ine1.pdf', 'application/pdf', 100, 1, 'rechazado', v_asesor, 'asesor', now()
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc, v_exp, 'subido', 'rechazado', 'ilegible', v_mesa, v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, document_kind, label)
  VALUES (v_lote, 'doc:ine', 'documento_reemplazado', 'documento', 'cliente_ine_frente', 'INE');
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_ine_frente',
    v_org::text || '/' || v_exp::text || '/ine/m18v2.pdf',
    'ine2.pdf', 'application/pdf', 100, 2, 'validado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc_new;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc_new, v_exp, 'resubido', 'validado', NULL, v_mesa, v_close
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CLOSED', 'M18 mismo INE cierra');

  -- M19 INE + otro doc: valida otro → no; luego INE → sí
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800019',
    'P198 M19 multi', '5519280019', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_ine_frente',
    v_org::text || '/' || v_exp::text || '/ine/m19.pdf',
    'ine.pdf', 'application/pdf', 100, 1, 'rechazado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc, v_exp, 'subido', 'rechazado', 'ilegible', v_mesa, v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, document_kind, label)
  VALUES
    (v_lote, 'doc:ine', 'documento_reemplazado', 'documento', 'cliente_ine_frente', 'INE'),
    (v_lote, 'doc:edc', 'documento_reemplazado', 'documento', 'cliente_estado_cuenta', 'EDC');
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_estado_cuenta',
    v_org::text || '/' || v_exp::text || '/edc/m19.pdf',
    'edc.pdf', 'application/pdf', 100, 1, 'validado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc2;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc2, v_exp, 'subido', 'validado', NULL, v_mesa, v_close
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'M19 otro doc no cierra INE');
  UPDATE public.expediente_documentos
  SET deleted_at = now()
  WHERE id = v_doc;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_ine_frente',
    v_org::text || '/' || v_exp::text || '/ine/m19b.pdf',
    'ine2.pdf', 'application/pdf', 100, 2, 'validado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc_new;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc_new, v_exp, 'resubido', 'validado', NULL, v_mesa, v_close + interval '1 hour'
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CLOSED', 'M19 INE posterior cierra');

  -- M20 operativo no cierra por DG/doc
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800020',
    'P198 M20 op vs dg', '5519280020', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    gen_random_uuid(), v_org, v_exp, 2, 'en_proceso', 'revision operativa',
    'desconocida', v_mesa, 'mesa_admin', v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'validado'), v_close
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'M20 op no cierra por DG');
  PERFORM public.__p198_assert(v_eff.request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION', 'M20 tipo op');

  -- M21 operativo sí cierra por reactivación
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800021',
    'P198 M21 op reactiva', '5519280021', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  v_rechazo := gen_random_uuid();
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    v_rechazo, v_org, v_exp, 2, 'en_proceso', 'revision operativa',
    'desconocida', v_mesa, 'mesa_admin', v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  INSERT INTO public.expediente_rechazo_reactivaciones (
    organization_id, expediente_id, rechazo_id, etapa,
    subestado_anterior, subestado_nuevo, reactivado_por, reactivado_por_rol, created_at
  ) VALUES (
    v_org, v_exp, v_rechazo, 2, 'rechazado', 'en_proceso', v_mesa, 'mesa_admin', v_close
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CLOSED', 'M21 reactivación cierra');

  -- M22 validación anterior al lote
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800022',
    'P198 M22 before lote', '5519280022', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'validado'), v_r1 - interval '1 day'),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'M22 validación previa no cierra');

  -- M23 cierre de ciclo anterior
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800023',
    'P198 M23 ciclo', '5519280023', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
     jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'validado'), v_close);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'CLOSED', 'M23 pre-corte sí cerrado');
  UPDATE public.expedientes SET fecha_envio_mesa = v_new_envio WHERE id = v_exp;
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado IS DISTINCT FROM 'CLOSED', 'M23 ciclo nuevo no hereda cierre');

  -- M24 re-reject gana sobre validación ajena
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192800024',
    'P198 M24 rereject', '5519280024', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_estado_cuenta',
    v_org::text || '/' || v_exp::text || '/edc/m24.pdf',
    'edc.pdf', 'application/pdf', 100, 1, 'validado', v_asesor, 'asesor'
  ) RETURNING id INTO v_doc;
  INSERT INTO public.documento_revisiones (
    organization_id, documento_id, expediente_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_doc, v_exp, 'subido', 'validado', NULL, v_mesa, v_close
  );
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r2
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p198_assert(v_eff.estado = 'WAITING_ADVISOR', 'M24 R2 gana');

  DELETE FROM public.expediente_asesor_cambios
  WHERE lote_id IN (
    SELECT id FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids)
  );
  DELETE FROM public.documento_revisiones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_documentos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazo_reactivaciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY(v_ids);
  DELETE FROM public.cliente_datos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expedientes WHERE id = ANY(v_ids);

  RAISE NOTICE 'P198 OK: M15–M24 causalidad estricta';
END;
$$;

DROP FUNCTION IF EXISTS public.__p198_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p198_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p198_reset_auth();
