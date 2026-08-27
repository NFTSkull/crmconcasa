-- P196: causalidad primer lote P130. T1–T9 + contrato. 0 writers.
-- P202 re-aplica clasificacion con filtro de ciclo.
\set ON_ERROR_STOP on
\ir ../migrations/196_mesa_correccion_primer_lote.sql
\ir ../migrations/202_asesor_mesa_correccion_latest_episode.sql

CREATE OR REPLACE FUNCTION public.__p196_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P196 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_bandeja TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_cambio_revision_clasificacion'
  LIMIT 1;
  PERFORM public.__p196_assert(position('STABLE' in v_src) > 0, 'helper STABLE');
  PERFORM public.__p196_assert(position('UPDATE ' in v_src) = 0, 'helper sin UPDATE');
  PERFORM public.__p196_assert(position('etapa_actual' in v_src) = 0, 'sin stage gate');
  PERFORM public.__p196_assert(position('sin_asignar' in v_src) = 0, 'no toca Disponibles');
  PERFORM public.__p196_assert(
    position('primer' in v_src) > 0 OR position('lmid' in v_src) > 0,
    'consume primer lote'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_categoria_resumen'
  LIMIT 1;
  PERFORM public.__p196_assert(
    position('expediente_tiene_correccion_asesor_pendiente' in v_src) > 0,
    'P192 categoria intacta'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_bandeja
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p196_assert(
    (
    position('cl.subestado IS DISTINCT FROM ''rechazado''' in v_bandeja) > 0
    OR position('subestado IS DISTINCT FROM ''rechazado''' in v_bandeja) > 0
    OR (
      position('WHEN ''sin_asignar'' THEN' in v_bandeja) > 0
      AND position('P207: Nuevos (quick filter)' in v_bandeja) > 0
      AND position('''rechazado''' in split_part(
        split_part(v_bandeja, 'WHEN ''sin_asignar'' THEN', 2),
        'WHEN ''mi_bandeja'' THEN',
        1
      )) = 0
    )
  ),
    'P195/P207 Disponibles excluye rechazado'
  );
  PERFORM public.__p196_assert(
    position('WHEN ''sin_asignar'' THEN' in v_bandeja) > 0,
    'sin_asignar sigue en bandeja'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_marcar_asesor_cambios_revisados'
  LIMIT 1;
  PERFORM public.__p196_assert(position('pendiente_revision' in v_src) > 0, 'writer mark intacto');

  RAISE NOTICE 'P196 contrato OK';
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
  v_exp UUID;
  v_cls RECORD;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_cat TEXT;
BEGIN
  -- T1 R1 → L1 = REQUESTED
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192600001',
    'P196 T1', '5519260001', '', 'interno', 'activo',
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
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin = 'REQUESTED_CORRECTION', 'T1 origin');

  -- T2 R1 → L1 → L2 (sin R2): L1 requested, L2 advisor
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192600002',
    'P196 T2', '5519260002', '', 'interno', 'activo',
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
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin = 'REQUESTED_CORRECTION', 'T2 L1 requested');
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l2);
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin = 'ADVISOR_UPDATE', 'T2 L2 advisor');
  PERFORM public.__p196_assert(v_cls.request_type IS NULL, 'T2 L2 sin request');

  -- T3 R1 → L1 reviewed → L2 pending = ADVISOR
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192600003',
    'P196 T3', '5519260003', '', 'interno', 'activo',
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
  ) VALUES (v_org, v_exp, v_asesor, 'revisado', v_l1, v_r2, v_mesa);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l2);
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin = 'ADVISOR_UPDATE', 'T3 L2 advisor');

  -- T4 R1 L1 R2 L2: ambos requested (L2 current = requested)
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192600004',
    'P196 T4', '5519260004', '', 'interno', 'activo',
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
  ) VALUES (v_org, v_exp, v_asesor, 'revisado', v_l1, v_r2 - interval '1 hour', v_mesa);
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin IS NULL, 'T4 tras L1 revisado sin pending');
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_r2
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l2);
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin = 'REQUESTED_CORRECTION', 'T4 L2 requested');
  PERFORM public.__p196_assert(v_cls.request_at = v_r2, 'T4 usa R2 no R1');

  -- T5 L1 luego R1: L1 = ADVISOR (futuro no reclasifica)
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192600005',
    'P196 T5', '5519260005', '', 'interno', 'activo',
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
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'), v_l2
  );
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin = 'ADVISOR_UPDATE', 'T5 futuro no reclasifica');

  -- T6 solicitud ciclo anterior + lote ciclo activo
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192600006',
    'P196 T6', '5519260006', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_admin', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('expediente_id', v_exp, 'estado_nuevo', 'rechazado'),
    timestamptz '2026-06-01 12:00:00+00'
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin IS DISTINCT FROM 'REQUESTED_CORRECTION', 'T6 no requested');
  PERFORM public.__p196_assert(v_cls.origin = 'ADVISOR_UPDATE', 'T6 advisor');

  -- T7 sin solicitud
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192600007',
    'P196 T7', '5519260007', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l1);
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin = 'ADVISOR_UPDATE', 'T7 advisor');

  -- T8 etapa firmas (11) con solicitud antigua ya respondida + lote nuevo
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192600008',
    'P196 T8 firmas', '5519260008', '', 'interno', 'activo',
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
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at, reviewed_by
  ) VALUES (v_org, v_exp, v_asesor, 'revisado', v_l1, v_r2, v_mesa);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_asesor, 'pendiente_revision', v_l2);
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin = 'ADVISOR_UPDATE', 'T8 firmas advisor');
  PERFORM public.__p196_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'T8 parent P192'
  );

  -- T9 nueva solicitud real en etapa avanzada
  v_exp := gen_random_uuid();
  v_ids := array_append(v_ids, v_exp);
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192600009',
    'P196 T9 firmas nueva', '5519260009', '', 'interno', 'activo',
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
  SELECT * INTO v_cls FROM public.mesa_cambio_revision_clasificacion(v_exp);
  PERFORM public.__p196_assert(v_cls.origin = 'REQUESTED_CORRECTION', 'T9 requested en firmas');

  -- Regresión: esperando ∩ correcciones por revisar = 0 para T1 (parent enviada, no requerida)
  v_cat := public.mesa_bandeja_categoria_resumen(
    (SELECT id FROM public.expedientes WHERE nss = '99192600001' LIMIT 1),
    v_envio
  );
  PERFORM public.__p196_assert(v_cat = 'correccion_enviada', 'T1 parent enviada');
  PERFORM public.__p196_assert(v_cat IS DISTINCT FROM 'correccion_requerida', 'no overlap espera');

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

  RAISE NOTICE 'P196 OK: T1–T9 causalidad primer lote';
END;
$$;

DROP FUNCTION IF EXISTS public.__p196_assert(BOOLEAN, TEXT);
