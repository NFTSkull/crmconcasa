-- P116: admin_report_expedientes_asesores_etapas_v3 (tipo fecha)
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p116_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P116 FAIL: %', p_msg; END IF; END;
$$;

CREATE OR REPLACE FUNCTION public.__p116_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p116_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8116-000000000001';
  v_admin UUID := '00000000-0000-4000-8006-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_exp_hist UUID := '00000000-0000-4000-9116-000000000001';
  v_exp_rango UUID := '00000000-0000-4000-9116-000000000002';
  v_out JSONB;
  v_n INT;
BEGIN
  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES (
    v_asesor, v_org, 'asesor-p116@test.local', 'Asesor P116', 'asesor', true
  ) ON CONFLICT (id) DO UPDATE SET active = true, organization_id = v_org;

  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (v_exp_hist, v_exp_rango);
  DELETE FROM public.expedientes WHERE id IN (v_exp_hist, v_exp_rango);

  -- Histórico: fecha_envio_mesa conocida, paso visual NULL (simula pre-099)
  ALTER TABLE public.expedientes DISABLE TRIGGER expedientes_paso_visual_fecha;
  ALTER TABLE public.expedientes DISABLE TRIGGER expedientes_paso_visual_historial;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado, fecha_entrada_paso_visual_actual
  ) VALUES (
    v_exp_hist, v_org, v_asesor, 'mejoravit', '11600000001', 'Cliente Hist P116',
    '5511600001', 'interno', true,
    TIMESTAMPTZ '2026-06-15 15:00:00+00',
    7, 'en_proceso', 'activo', NULL
  );
  ALTER TABLE public.expedientes ENABLE TRIGGER expedientes_paso_visual_fecha;
  ALTER TABLE public.expedientes ENABLE TRIGGER expedientes_paso_visual_historial;

  -- Con envío en julio y fecha de paso conocida
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_rango, v_org, v_asesor, 'mejoravit', '11600000002', 'Cliente Rango P116',
    '5511600002', 'interno', true,
    TIMESTAMPTZ '2026-07-10 18:00:00+00',
    6, 'en_proceso', 'activo'
  );

  PERFORM public.__p116_auth(v_admin);

  -- 1) sin rango: incluye histórico NULL de paso
  v_out := public.admin_report_expedientes_asesores_etapas_v3(
    ARRAY[v_asesor], ARRAY[5,6]::SMALLINT[], 'vigentes',
    'envio_mesa', NULL, NULL
  );
  PERFORM public.__p116_assert(
    (v_out->'meta'->>'tipo_fecha') = 'envio_mesa', '1 tipo default envio'
  );
  PERFORM public.__p116_assert(
    (v_out->'meta'->>'expedientes')::int = 2, '1 sin rango ambos'
  );
  PERFORM public.__p116_assert(
    (v_out->'meta'->>'excluidos_por_fecha_desconocida')::int = 0, '1 sin excluidos'
  );

  -- 2) envio_mesa + rango junio: solo histórico
  v_out := public.admin_report_expedientes_asesores_etapas_v3(
    ARRAY[v_asesor], ARRAY[5,6]::SMALLINT[], 'vigentes',
    'envio_mesa', '2026-06-01'::date, '2026-06-30'::date
  );
  PERFORM public.__p116_assert(
    (v_out->'meta'->>'expedientes')::int = 1, '2 envio junio = 1'
  );
  PERFORM public.__p116_assert(
    (v_out->'meta'->>'excluidos_por_fecha_desconocida')::int = 0, '2 envio sin excl'
  );
  PERFORM public.__p116_assert(
    jsonb_array_length(v_out->'detalle') = 1
    AND (v_out->'detalle'->0->>'nss') = '11600000001',
    '2 detalle histórico por envio'
  );

  -- 3) entrada_paso_actual + rango: excluye histórico NULL
  v_out := public.admin_report_expedientes_asesores_etapas_v3(
    ARRAY[v_asesor], ARRAY[5,6]::SMALLINT[], 'vigentes',
    'entrada_paso_actual', '2026-01-01'::date, '2026-12-31'::date
  );
  PERFORM public.__p116_assert(
    (v_out->'meta'->>'tipo_fecha') = 'entrada_paso_actual', '3 tipo entrada'
  );
  PERFORM public.__p116_assert(
    (v_out->'meta'->>'sin_fecha_canonica')::int = 1, '3 sin fecha paso'
  );
  PERFORM public.__p116_assert(
    (v_out->'meta'->>'excluidos_por_fecha_desconocida')::int = 1, '3 excluidos'
  );
  PERFORM public.__p116_assert(
    (v_out->'meta'->>'expedientes')::int = 1, '3 solo con fecha paso'
  );

  -- 4) desde > hasta
  BEGIN
    PERFORM public.admin_report_expedientes_asesores_etapas_v3(
      NULL, NULL, 'vigentes', 'envio_mesa', '2026-07-20'::date, '2026-07-01'::date
    );
    PERFORM public.__p116_assert(false, '4 debió fallar rango');
  EXCEPTION WHEN others THEN
    PERFORM public.__p116_assert(
      SQLERRM ILIKE '%p_fecha_desde%', '4 mensaje rango'
    );
  END;

  -- 5) tipo inválido
  BEGIN
    PERFORM public.admin_report_expedientes_asesores_etapas_v3(
      NULL, NULL, 'vigentes', 'updated_at', NULL, NULL
    );
    PERFORM public.__p116_assert(false, '5 debió fallar tipo');
  EXCEPTION WHEN others THEN
    PERFORM public.__p116_assert(
      SQLERRM ILIKE '%p_tipo_fecha%', '5 mensaje tipo'
    );
  END;

  -- 6) mesa no puede
  PERFORM public.__p116_auth(v_mesa);
  BEGIN
    PERFORM public.admin_report_expedientes_asesores_etapas_v3(
      NULL, NULL, 'vigentes', 'envio_mesa', NULL, NULL
    );
    PERFORM public.__p116_assert(false, '6 mesa bloqueada');
  EXCEPTION WHEN others THEN
    PERFORM public.__p116_assert(true, '6 mesa ok');
  END;

  -- 7) P112/P114 siguen existiendo
  PERFORM public.__p116_reset();
  SELECT COUNT(*)::int INTO v_n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'admin_report_expedientes_asesores_etapas',
      'admin_report_expedientes_asesores_etapas_v2',
      'admin_report_expedientes_asesores_etapas_v3'
    );
  PERFORM public.__p116_assert(v_n = 3, '7 tres RPCs coexisten');

  -- cleanup
  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (v_exp_hist, v_exp_rango);
  DELETE FROM public.expedientes WHERE id IN (v_exp_hist, v_exp_rango);
  DELETE FROM public.profiles WHERE id = v_asesor;

  RAISE NOTICE 'P116 admin_report v3: OK';
END;
$$;

DROP FUNCTION public.__p116_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p116_auth(UUID);
DROP FUNCTION public.__p116_reset();
