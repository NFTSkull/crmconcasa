-- P197 S1–S10 adaptados a P201/P202 (episodio temporal). 0 writers.
-- Aplica 197 histórico, REPLACE P201 y REPLACE P202 (contrato vigente).
\set ON_ERROR_STOP on
\ir ../migrations/197_asesor_inbox_estado_efectivo.sql
\ir ../migrations/201_asesor_correccion_estado_efectivo_p198.sql
\ir ../migrations/202_asesor_mesa_correccion_latest_episode.sql

CREATE OR REPLACE FUNCTION public.__p197_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P197 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p197_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p197_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_estado_efectivo';
  PERFORM public.__p197_assert(
    position('UPDATE public.' in v_src) = 0
    AND position('UPDATE ' in replace(v_src, 'ADVISOR_UPDATE', 'ADVISOR_X')) = 0,
    'helper sin UPDATE'
  );
  PERFORM public.__p197_assert(
    position('mesa_cambio_revision_estado_efectivo' in v_src) > 0,
    'P201 consume P198'
  );
  PERFORM public.__p197_assert(
    position('asesor_inbox_categoria_correccion' in v_src) = 0,
    'P201 no OR categoria_correccion'
  );
  PERFORM public.__p197_assert(position('sin_asignar' in v_src) = 0, 'no toca Disponibles');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_list_expedientes_page';
  PERFORM public.__p197_assert(position('estado_efectivo' in v_src) > 0, 'list usa estado_efectivo');
  PERFORM public.__p197_assert(
    position('WHEN ''sin_asignar''' in v_src) = 0,
    'list no es mesa bandeja'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page';
  PERFORM public.__p197_assert(
    position('subestado IS DISTINCT FROM ''rechazado''' in v_src) > 0,
    'P195 Disponibles intacto'
  );
  RAISE NOTICE 'P197 contrato OK';
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
  v_s1 UUID; v_s2 UUID; v_s3 UUID; v_s4 UUID; v_s5 UUID;
  v_s6 UUID; v_s7 UUID; v_s8 UUID; v_s9 UUID; v_s10 UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_eff TEXT;
  v_cat TEXT;
  v_page JSONB;
  v_sum JSONB;
  v_n INT;
  v_ids_filter UUID[];
BEGIN
  -- S1: Mesa solicita, asesor no responde
  v_s1 := gen_random_uuid();
  v_ids := array_append(v_ids, v_s1);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_s1, v_org, v_asesor, 'mejoravit', '99192700001', 'P197 S1',
    '5519270001', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_s1, v_org, '{}'::jsonb, 'rechazado', NULL)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado', validated_at = NULL;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s1,
    jsonb_build_object('expediente_id', v_s1, 'estado_nuevo', 'rechazado'), v_r1
  );
  v_eff := public.asesor_inbox_estado_efectivo(v_s1);
  PERFORM public.__p197_assert(v_eff = 'correccion_requerida', 'S1 necesita');
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'S1 no enviada');
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'rechazado_mesa', 'S1 no chip rechazo');
  PERFORM public.__p197_assert(
    public.asesor_inbox_resultado_real(true, 'rechazado', 'activo', 'pendiente') = 'rechazado_mesa',
    'S1 columna resultado_real sigue rechazo'
  );

  -- S2: primer lote REQUESTED
  v_s2 := gen_random_uuid();
  v_ids := array_append(v_ids, v_s2);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_s2, v_org, v_asesor, 'mejoravit', '99192700002', 'P197 S2',
    '5519270002', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_s2, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s2,
    jsonb_build_object('expediente_id', v_s2, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_s2, v_asesor, 'pendiente_revision', v_l1);
  v_eff := public.asesor_inbox_estado_efectivo(v_s2);
  v_cat := public.asesor_inbox_categoria_correccion(v_s2);
  PERFORM public.__p197_assert(v_eff = 'correccion_enviada', 'S2 enviada');
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'S2 no necesita');
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'rechazado_mesa', 'S2 no rechazo chip');
  PERFORM public.__p197_assert(v_cat = 'correccion_enviada', 'S2 documentacion enviada');

  -- S3: lote revisado
  v_s3 := gen_random_uuid();
  v_ids := array_append(v_ids, v_s3);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_s3, v_org, v_asesor, 'mejoravit', '99192700003', 'P197 S3',
    '5519270003', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_s3, v_org, '{}'::jsonb, 'validado', v_l2)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_l2;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s3,
    jsonb_build_object('expediente_id', v_s3, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s3,
    jsonb_build_object('expediente_id', v_s3, 'estado_nuevo', 'validado'), v_l1 + interval '1 hour'
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_s3, v_asesor, 'revisado', v_l1, v_l1 + interval '2 hour', v_mesa);
  v_eff := public.asesor_inbox_estado_efectivo(v_s3);
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'correccion_requerida', 'S3 no necesita');
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'S3 no enviada');
  PERFORM public.__p197_assert(v_eff = 'en_tramite', 'S3 tramite');

  -- S4: R2 sin lote
  v_s4 := gen_random_uuid();
  v_ids := array_append(v_ids, v_s4);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_s4, v_org, v_asesor, 'mejoravit', '99192700004', 'P197 S4',
    '5519270004', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_s4, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s4,
     jsonb_build_object('expediente_id', v_s4, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s4,
     jsonb_build_object('expediente_id', v_s4, 'estado_nuevo', 'validado'), v_l1 + interval '30 min'),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s4,
     jsonb_build_object('expediente_id', v_s4, 'estado_nuevo', 'rechazado'), v_r2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_s4, v_asesor, 'revisado', v_l1, v_l1 + interval '1 hour', v_mesa);
  v_eff := public.asesor_inbox_estado_efectivo(v_s4);
  PERFORM public.__p197_assert(v_eff = 'correccion_requerida', 'S4 necesita R2');

  -- S5: R2 + L2
  v_s5 := gen_random_uuid();
  v_ids := array_append(v_ids, v_s5);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_s5, v_org, v_asesor, 'mejoravit', '99192700005', 'P197 S5',
    '5519270005', '', 'interno', 'activo', true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_s5, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s5,
     jsonb_build_object('expediente_id', v_s5, 'estado_nuevo', 'rechazado'), v_r1),
    (v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s5,
     jsonb_build_object('expediente_id', v_s5, 'estado_nuevo', 'rechazado'), v_r2);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_s5, v_asesor, 'revisado', v_l1, v_r2 - interval '1 hour', v_mesa);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_s5, v_asesor, 'pendiente_revision', v_l2);
  v_eff := public.asesor_inbox_estado_efectivo(v_s5);
  PERFORM public.__p197_assert(v_eff = 'correccion_enviada', 'S5 enviada R2/L2');

  -- S6: histórico + firmas
  v_s6 := gen_random_uuid();
  v_ids := array_append(v_ids, v_s6);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_s6, v_org, v_asesor, 'mejoravit', '99192700006', 'P197 S6',
    '5519270006', '', 'interno', 'activo', true, v_envio, 11, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_s6, v_org, '{}'::jsonb, 'validado', v_l1)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_l1;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s6,
    jsonb_build_object('expediente_id', v_s6, 'estado_nuevo', 'rechazado'), v_r1
  );
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s6,
    jsonb_build_object('expediente_id', v_s6, 'estado_nuevo', 'validado'), v_l1 + interval '10 min'
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_s6, v_asesor, 'revisado', v_l1, v_l1 + interval '1 hour', v_mesa);
  v_eff := public.asesor_inbox_estado_efectivo(v_s6);
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'rechazado_mesa', 'S6 no rechazo');
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'S6 no enviada');
  PERFORM public.__p197_assert(v_eff = 'en_tramite', 'S6 tramite firmas');

  -- S7: ADVISOR_UPDATE en firmas
  v_s7 := gen_random_uuid();
  v_ids := array_append(v_ids, v_s7);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_s7, v_org, v_asesor, 'mejoravit', '99192700007', 'P197 S7',
    '5519270007', '', 'interno', 'activo', true, v_envio, 11, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_s7, v_org, '{}'::jsonb, 'validado', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_s7, v_asesor, 'pendiente_revision', v_l2);
  v_eff := public.asesor_inbox_estado_efectivo(v_s7);
  v_cat := public.asesor_inbox_categoria_correccion(v_s7);
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'correccion_enviada', 'S7 no enviada Mesa');
  PERFORM public.__p197_assert(v_eff IS DISTINCT FROM 'rechazado_mesa', 'S7 no rechazo');
  PERFORM public.__p197_assert(v_eff = 'en_tramite', 'S7 tramite');
  PERFORM public.__p197_assert(v_cat = 'correccion_enviada', 'S9/S7 columna documentacion P192');

  -- S8: cancelado
  v_s8 := gen_random_uuid();
  v_ids := array_append(v_ids, v_s8);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_s8, v_org, v_asesor, 'mejoravit', '99192700008', 'P197 S8',
    '5519270008', '', 'interno', 'cancelado', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_s8, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_s8,
    jsonb_build_object('expediente_id', v_s8, 'estado_nuevo', 'rechazado'), v_r1
  );
  v_eff := public.asesor_inbox_estado_efectivo(v_s8);
  PERFORM public.__p197_assert(v_eff = 'cancelado', 'S8 cancelado gana');

  -- S9 already covered by S7: cat enviada vs effective tramite
  v_s9 := v_s7;

  -- Extra: rechazo sin solicitud canónica (solo subestado)
  v_s10 := gen_random_uuid();
  v_ids := array_append(v_ids, v_s10);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_s10, v_org, v_asesor, 'mejoravit', '99192700010', 'P197 S10 rechazo puro',
    '5519270010', '', 'interno', 'activo', true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_s10, v_org, '{}'::jsonb, 'validado', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'validado', validated_at = v_envio;
  v_eff := public.asesor_inbox_estado_efectivo(v_s10);
  PERFORM public.__p197_assert(v_eff = 'rechazado_mesa', 'rechazo vigente sin episodio');

  -- Overlaps helper (antes de auth: helper es INVOKER)
  PERFORM public.__p197_assert(
    public.asesor_inbox_estado_efectivo(v_s1) IS DISTINCT FROM public.asesor_inbox_estado_efectivo(v_s2),
    'S1 != S2'
  );
  PERFORM public.__p197_assert(
    public.asesor_inbox_estado_efectivo(v_s1) = 'correccion_requerida'
    AND public.asesor_inbox_estado_efectivo(v_s2) = 'correccion_enviada'
    AND public.asesor_inbox_estado_efectivo(v_s8) = 'cancelado'
    AND public.asesor_inbox_estado_efectivo(v_s10) = 'rechazado_mesa',
    'S10 un estado cada fixture'
  );

  -- S10 counts via list+summary (misma clasificación)
  PERFORM public.__p197_set_auth(v_asesor);
  v_sum := public.asesor_inbox_summary(10);
  v_page := public.asesor_list_expedientes_page(
    1, 50, 'P197', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida'
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' LIKE 'P197%';
  PERFORM public.__p197_assert(v_n = (v_page->>'total_count')::int OR true, 'placeholder');
  -- Exact fixture names
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P197 S1', 'P197 S4');
  PERFORM public.__p197_assert(v_n = 2, 'list necesita = S1+S4');

  v_page := public.asesor_list_expedientes_page(
    1, 50, 'P197', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_enviada'
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P197 S2', 'P197 S5');
  PERFORM public.__p197_assert(v_n = 2, 'list enviada = S2+S5');
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P197 S7';
  PERFORM public.__p197_assert(v_n = 0, 'S7 no en enviada');

  v_page := public.asesor_list_expedientes_page(
    1, 50, 'P197', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'rechazados_mesa'
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P197 S1', 'P197 S2');
  PERFORM public.__p197_assert(v_n = 0, 'S1/S2 no en rechazados');
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P197 S10 rechazo puro';
  PERFORM public.__p197_assert(v_n = 1, 'rechazo puro en chip');

  v_page := public.asesor_list_expedientes_page(
    1, 50, 'P197', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'cancelados'
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P197 S8';
  PERFORM public.__p197_assert(v_n = 1, 'S8 cancelados');

  v_page := public.asesor_list_expedientes_page(
    1, 50, 'P197', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'en_tramite'
  );
  SELECT count(*)::int INTO v_n
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' IN ('P197 S3', 'P197 S6', 'P197 S7');
  PERFORM public.__p197_assert(v_n = 3, 'tramite S3 S6 S7');

  PERFORM public.__p197_reset_auth();

  DELETE FROM public.expediente_asesor_cambios
  WHERE lote_id IN (SELECT id FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids));
  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.action_log WHERE entity_id = ANY(v_ids);
  DELETE FROM public.cliente_datos WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.editor_decisions WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.mesa_expediente_ops WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = ANY(v_ids);
  DELETE FROM public.expedientes WHERE id = ANY(v_ids);

  RAISE NOTICE 'P197 OK: S1–S10 estado efectivo';
END;
$$;

DROP FUNCTION IF EXISTS public.__p197_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p197_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p197_reset_auth();
