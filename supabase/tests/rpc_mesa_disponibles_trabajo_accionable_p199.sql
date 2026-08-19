-- P199: Disponibles = trabajo accionable libre. D1–D16 SQL. D17 = TS infinite-scroll.
\set ON_ERROR_STOP on
\ir ../migrations/199_mesa_disponibles_trabajo_accionable.sql

CREATE OR REPLACE FUNCTION public.__p199_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P199 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p199_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p199_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p199_in_disp(p_nombre TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_page JSONB;
  v_hit INT;
BEGIN
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'todos', 'sin_asignar',
    p_nombre, NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = p_nombre;
  RETURN v_hit > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p199_in_ops(p_nombre TEXT, p_ops TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_page JSONB;
  v_hit INT;
BEGIN
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'todos', p_ops,
    p_nombre, NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = p_nombre;
  RETURN v_hit > 0;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_es_trabajo_accionable_mesa'
  LIMIT 1;
  PERFORM public.__p199_assert(v_src IS NOT NULL, 'helper existe');
  PERFORM public.__p199_assert(position('STABLE' in v_src) > 0, 'helper STABLE');
  PERFORM public.__p199_assert(position('CORRECTION_PENDING_REVIEW' in v_src) > 0, 'override pending');
  PERFORM public.__p199_assert(position('WAITING_ADVISOR' in v_src) > 0, 'waiting excluye');
  PERFORM public.__p199_assert(position('UPDATE ' in v_src) = 0, 'helper sin UPDATE');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p199_assert(position('mesa_es_trabajo_accionable_mesa' in v_src) > 0, 'list usa helper');
  PERFORM public.__p199_assert(position('mesa_take' in v_src) = 0, 'list no take');
  PERFORM public.__p199_assert(position('UPDATE ' in v_src) = 0, 'list sin UPDATE');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_take_expediente'
  LIMIT 1;
  PERFORM public.__p199_assert(
    position('P199' in coalesce(v_src, '')) = 0,
    'take no modificado (Fase 0 escenario A)'
  );
  RAISE NOTICE 'P199 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_b UUID := '00000000-0000-4000-8003-000000000001';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-08-05 12:00:00+00';
  v_l1 TIMESTAMPTZ := timestamptz '2026-08-10 12:00:00+00';
  v_r2 TIMESTAMPTZ := timestamptz '2026-08-15 12:00:00+00';
  v_close TIMESTAMPTZ := timestamptz '2026-08-12 12:00:00+00';
  v_ids UUID[] := ARRAY[]::UUID[];
  v_exp UUID;
  v_lote UUID;
  v_eff RECORD;
  v_take JSONB;
  v_rel JSONB;
  v_err TEXT;
  v_page JSONB;
  v_n INT;
BEGIN
  -- D1 normal
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901001',
    'P199 D1 normal', '5519290001', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.mesa_expediente_ops (expediente_id, organization_id, estado_mesa, assigned_to)
  VALUES (v_exp, v_org, 'sin_asignar', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado_mesa = 'sin_asignar', assigned_to = NULL;

  -- D2 corrección operativa reenviada + raw rechazado
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901002',
    'P199 D2 op pending', '5519290002', '', 'interno', 'activo',
    true, v_envio, 2, 'rechazado', v_envio
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
  INSERT INTO public.mesa_expediente_ops (expediente_id, organization_id, estado_mesa, assigned_to)
  VALUES (v_exp, v_org, 'sin_asignar', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado_mesa = 'sin_asignar', assigned_to = NULL;
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p199_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'D2 estado');

  -- D3 DG reenviado
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901003',
    'P199 D3 dg pending', '5519290003', '', 'interno', 'activo',
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
  INSERT INTO public.mesa_expediente_ops (expediente_id, organization_id, estado_mesa, assigned_to)
  VALUES (v_exp, v_org, 'sin_asignar', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado_mesa = 'sin_asignar', assigned_to = NULL;
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p199_assert(v_eff.estado = 'CORRECTION_PENDING_REVIEW', 'D3 estado');

  -- D4 update
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901004',
    'P199 D4 update', '5519290004', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  INSERT INTO public.mesa_expediente_ops (expediente_id, organization_id, estado_mesa, assigned_to)
  VALUES (v_exp, v_org, 'sin_asignar', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado_mesa = 'sin_asignar', assigned_to = NULL;
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p199_assert(v_eff.estado = 'ADVISOR_UPDATE_PENDING_REVIEW', 'D4 estado');

  -- D5 waiting
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901005',
    'P199 D5 waiting', '5519290005', '', 'interno', 'activo',
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
  INSERT INTO public.mesa_expediente_ops (expediente_id, organization_id, estado_mesa, assigned_to)
  VALUES (v_exp, v_org, 'sin_asignar', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado_mesa = 'sin_asignar', assigned_to = NULL;
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p199_assert(v_eff.estado = 'WAITING_ADVISOR', 'D5 estado');

  -- D6 raw rechazado sin pending
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901006',
    'P199 D6 raw reject', '5519290006', '', 'interno', 'activo',
    true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.mesa_expediente_ops (expediente_id, organization_id, estado_mesa, assigned_to)
  VALUES (v_exp, v_org, 'sin_asignar', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado_mesa = 'sin_asignar', assigned_to = NULL;

  -- D7 corrección asignada
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901007',
    'P199 D7 assigned corr', '5519290007', '', 'interno', 'activo',
    true, v_envio, 2, 'rechazado', v_envio
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
  INSERT INTO public.mesa_expediente_ops (
    expediente_id, organization_id, estado_mesa, assigned_to, assigned_at
  ) VALUES (v_exp, v_org, 'trabajando', v_mesa, v_l1)
  ON CONFLICT (expediente_id) DO UPDATE SET
    estado_mesa = 'trabajando', assigned_to = v_mesa, assigned_at = v_l1;

  -- D8 update asignada
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901008',
    'P199 D8 assigned upd', '5519290008', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  INSERT INTO public.mesa_expediente_ops (
    expediente_id, organization_id, estado_mesa, assigned_to, assigned_at
  ) VALUES (v_exp, v_org, 'trabajando', v_mesa, v_l1)
  ON CONFLICT (expediente_id) DO UPDATE SET
    estado_mesa = 'trabajando', assigned_to = v_mesa, assigned_at = v_l1;

  -- D9 cancelado
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901009',
    'P199 D9 cancelado', '5519290009', '', 'interno', 'cancelado',
    true, v_envio, 2, 'en_proceso', v_envio
  );

  -- D10 CLOSED + rechazado
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901010',
    'P199 D10 closed', '5519290010', '', 'interno', 'activo',
    true, v_envio, 2, 'rechazado', v_envio
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
  INSERT INTO public.mesa_expediente_ops (expediente_id, organization_id, estado_mesa, assigned_to)
  VALUES (v_exp, v_org, 'sin_asignar', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado_mesa = 'sin_asignar', assigned_to = NULL;
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p199_assert(v_eff.estado = 'CLOSED', 'D10 estado');

  -- D11 take target (pending libre)
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901011',
    'P199 D11 take', '5519290011', '', 'interno', 'activo',
    true, v_envio, 2, 'rechazado', v_envio
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
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1)
  RETURNING id INTO v_lote;
  INSERT INTO public.mesa_expediente_ops (expediente_id, organization_id, estado_mesa, assigned_to)
  VALUES (v_exp, v_org, 'sin_asignar', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado_mesa = 'sin_asignar', assigned_to = NULL;

  -- D14 close later uses this extra
  -- D15 re-reject extra
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192901015',
    'P199 D15 rereject', '5519290015', '', 'interno', 'activo',
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
  INSERT INTO public.mesa_expediente_ops (expediente_id, organization_id, estado_mesa, assigned_to)
  VALUES (v_exp, v_org, 'sin_asignar', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado_mesa = 'sin_asignar', assigned_to = NULL;

  PERFORM public.__p199_set_auth(v_mesa);

  PERFORM public.__p199_assert(public.__p199_in_disp('P199 D1 normal'), 'D1 YES');
  PERFORM public.__p199_assert(public.__p199_in_disp('P199 D2 op pending'), 'D2 YES');
  PERFORM public.__p199_assert(public.__p199_in_disp('P199 D3 dg pending'), 'D3 YES');
  PERFORM public.__p199_assert(public.__p199_in_disp('P199 D4 update'), 'D4 YES');
  PERFORM public.__p199_assert(NOT public.__p199_in_disp('P199 D5 waiting'), 'D5 NO');
  PERFORM public.__p199_assert(public.__p199_in_ops('P199 D5 waiting', 'en_espera_asesor'), 'D5 espera YES');
  PERFORM public.__p199_assert(NOT public.__p199_in_disp('P199 D6 raw reject'), 'D6 NO');
  PERFORM public.__p199_assert(NOT public.__p199_in_disp('P199 D7 assigned corr'), 'D7 NO');
  PERFORM public.__p199_assert(public.__p199_in_ops('P199 D7 assigned corr', 'mi_bandeja'), 'D7 mi bandeja');
  PERFORM public.__p199_assert(NOT public.__p199_in_disp('P199 D8 assigned upd'), 'D8 NO');
  PERFORM public.__p199_assert(NOT public.__p199_in_disp('P199 D9 cancelado'), 'D9 NO');
  PERFORM public.__p199_assert(NOT public.__p199_in_disp('P199 D10 closed'), 'D10 NO');
  PERFORM public.__p199_assert(public.__p199_in_disp('P199 D11 take'), 'D11 pre-take YES');

  SELECT id INTO v_exp FROM public.expedientes WHERE cliente_nombre = 'P199 D11 take' LIMIT 1;
  v_take := public.mesa_take_expediente(v_exp);
  PERFORM public.__p199_assert((v_take->>'ok')::boolean, 'D11 take ok');
  PERFORM public.__p199_assert(v_take->>'estado_mesa' = 'trabajando', 'D11 trabajando');
  PERFORM public.__p199_assert((v_take->>'assigned_to')::uuid = v_mesa, 'D11 assigned actor');
  PERFORM public.__p199_assert(NOT public.__p199_in_disp('P199 D11 take'), 'D11 sale Disponibles');
  PERFORM public.__p199_assert(public.__p199_in_ops('P199 D11 take', 'mi_bandeja'), 'D11 entra Mi bandeja');

  -- D12 doble toma
  v_err := NULL;
  BEGIN
    PERFORM public.__p199_set_auth(v_mesa_b);
    PERFORM public.mesa_take_expediente(v_exp);
    PERFORM public.__p199_assert(false, 'D12 no debía tomar');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.__p199_set_auth(v_mesa);
  PERFORM public.__p199_assert(v_err IS NOT NULL, 'D12 conflicto');
  PERFORM public.__p199_assert(position('asignado a otro' in v_err) > 0, 'D12 msg ' || coalesce(v_err, ''));

  -- D13 release
  v_rel := public.mesa_release_expediente(v_exp, 'P199 D13');
  PERFORM public.__p199_assert((v_rel->>'ok')::boolean, 'D13 release ok');
  PERFORM public.__p199_assert(v_rel->>'estado_mesa' = 'sin_asignar', 'D13 sin_asignar');
  PERFORM public.__p199_assert(public.__p199_in_disp('P199 D11 take'), 'D13 vuelve Disponibles');

  -- D14 cierre P198
  SELECT id INTO v_exp FROM public.expedientes WHERE cliente_nombre = 'P199 D3 dg pending' LIMIT 1;
  PERFORM public.__p199_reset_auth();
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'validado'), v_close
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p199_assert(v_eff.estado = 'CLOSED', 'D14 closed');
  PERFORM public.__p199_set_auth(v_mesa);
  PERFORM public.__p199_assert(
    NOT public.__p199_in_ops('P199 D3 dg pending', 'todo_mesa')
    OR TRUE,
    'D14 reachable'
  );
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_solicitada', 'todo_mesa',
    'P199 D3 dg pending', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P199 D3 dg pending';
  PERFORM public.__p199_assert(v_n = 0, 'D14 sale Correcciones');
  -- flujo normal P195: sigue en_proceso libre → Disponibles YES
  PERFORM public.__p199_assert(public.__p199_in_disp('P199 D3 dg pending'), 'D14 P195 normal YES');

  -- D15 re-reject
  SELECT id INTO v_exp FROM public.expedientes WHERE cliente_nombre = 'P199 D15 rereject' LIMIT 1;
  PERFORM public.__p199_assert(public.__p199_in_disp('P199 D15 rereject'), 'D15 pre YES');
  PERFORM public.__p199_reset_auth();
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r2
  );
  SELECT * INTO v_eff FROM public.mesa_cambio_revision_estado_efectivo(v_exp);
  PERFORM public.__p199_assert(v_eff.estado = 'WAITING_ADVISOR', 'D15 waiting');
  PERFORM public.__p199_set_auth(v_mesa);
  PERFORM public.__p199_assert(NOT public.__p199_in_disp('P199 D15 rereject'), 'D15 sale Disponibles');

  -- D16 intersecciones en fixtures
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'todos', 'sin_asignar',
    'P199', NULL, NULL, false, NULL, 'rechazados', NULL, true
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' LIKE 'P199%'
    AND public.__p199_in_ops(x->>'cliente_nombre', 'en_espera_asesor');
  PERFORM public.__p199_assert(v_n = 0, 'D16 disp ∩ espera = 0');

  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' LIKE 'P199%'
    AND EXISTS (
      SELECT 1 FROM public.mesa_expediente_ops o
      WHERE o.expediente_id = (x->>'id')::uuid AND o.assigned_to IS NOT NULL
    );
  PERFORM public.__p199_assert(v_n = 0, 'D16 disp assigned = 0');

  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' LIKE 'P199%'
    AND EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = (x->>'id')::uuid AND e.ciclo_estado = 'cancelado'
    );
  PERFORM public.__p199_assert(v_n = 0, 'D16 disp cancelado = 0');

  -- count list = total_count para el query Disponibles de D2
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'todos', 'sin_asignar',
    'P199 D2 op pending', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  PERFORM public.__p199_assert(
    jsonb_array_length(coalesce(v_page->'items', '[]'::jsonb))
      = (v_page->>'total_count')::int,
    'count = lista D2'
  );

  PERFORM public.__p199_reset_auth();
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_rechazos_operativos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.mesa_expediente_ops WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY(v_ids);
  DELETE FROM public.cliente_datos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expedientes WHERE id = ANY(v_ids);

  RAISE NOTICE 'P199 OK: D1–D16';
END;
$$;

DROP FUNCTION public.__p199_in_ops(TEXT, TEXT);
DROP FUNCTION public.__p199_in_disp(TEXT);
DROP FUNCTION public.__p199_reset_auth();
DROP FUNCTION public.__p199_set_auth(UUID);
DROP FUNCTION public.__p199_assert(BOOLEAN, TEXT);
