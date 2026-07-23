-- P114: expediente paso visual tracking + admin_report v2
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p114_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P114 FAIL: %', p_msg; END IF; END;
$$;

CREATE OR REPLACE FUNCTION public.__p114_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p114_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8114-000000000001';
  v_admin UUID := '00000000-0000-4000-8006-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_exp_new UUID := '00000000-0000-4000-9114-000000000001';
  v_exp_hist UUID := '00000000-0000-4000-9114-000000000002';
  v_exp_p3 UUID := '00000000-0000-4000-9114-000000000003';
  v_fecha TIMESTAMPTZ;
  v_fecha2 TIMESTAMPTZ;
  v_n INT;
  v_out JSONB;
  v_ymd TEXT;
BEGIN
  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES (
    v_asesor, v_org, 'asesor-p114@test.local', 'Asesor P114', 'asesor', true
  ) ON CONFLICT (id) DO UPDATE SET active = true, organization_id = v_org;

  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (v_exp_new, v_exp_hist, v_exp_p3);
  DELETE FROM public.expedientes WHERE id IN (v_exp_new, v_exp_hist, v_exp_p3);

  -- Mapper
  PERFORM public.__p114_assert(
    public.__map_etapa_interna_a_paso_visual(4) = 3, 'map 4→3'
  );
  PERFORM public.__p114_assert(
    public.__map_etapa_interna_a_paso_visual(7) = 6, 'map 7→6'
  );
  PERFORM public.__p114_assert(
    public.__map_etapa_interna_a_paso_visual(12) = 11, 'map 12→11'
  );

  -- 1) INSERT nuevo → fecha + transición
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_new, v_org, v_asesor, 'mejoravit', '11400000001', 'Cliente Nuevo P114',
    '5511400001', 'interno', true, NOW(), 2, 'en_proceso', 'activo'
  );

  SELECT fecha_entrada_paso_visual_actual INTO v_fecha
  FROM public.expedientes WHERE id = v_exp_new;
  PERFORM public.__p114_assert(v_fecha IS NOT NULL, '1 nuevo tiene fecha');

  SELECT COUNT(*)::int INTO v_n
  FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id = v_exp_new AND etapa_anterior IS NULL AND etapa_nueva = 2;
  PERFORM public.__p114_assert(v_n = 1, '1 transición creación');

  -- 2) intento de mutar fecha directo → se ignora
  UPDATE public.expedientes
  SET fecha_entrada_paso_visual_actual = NOW() - INTERVAL '10 days'
  WHERE id = v_exp_new;
  SELECT fecha_entrada_paso_visual_actual INTO v_fecha2
  FROM public.expedientes WHERE id = v_exp_new;
  PERFORM public.__p114_assert(v_fecha2 = v_fecha, '2 fecha no mutable directo');

  -- 3) cruce visual 2→3 → nueva fecha + historial
  UPDATE public.expedientes SET etapa_actual = 3 WHERE id = v_exp_new;
  SELECT fecha_entrada_paso_visual_actual INTO v_fecha2
  FROM public.expedientes WHERE id = v_exp_new;
  PERFORM public.__p114_assert(v_fecha2 > v_fecha, '3 fecha avanza en cruce');
  SELECT COUNT(*)::int INTO v_n
  FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id = v_exp_new AND etapa_anterior = 2 AND etapa_nueva = 3;
  PERFORM public.__p114_assert(v_n = 1, '3 transición 2→3');

  v_fecha := v_fecha2;

  -- 4) 3→4 mismo paso visual → conserva fecha, sin transición
  UPDATE public.expedientes SET etapa_actual = 4 WHERE id = v_exp_new;
  SELECT fecha_entrada_paso_visual_actual INTO v_fecha2
  FROM public.expedientes WHERE id = v_exp_new;
  PERFORM public.__p114_assert(v_fecha2 = v_fecha, '4 3→4 conserva fecha');
  SELECT COUNT(*)::int INTO v_n
  FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id = v_exp_new AND etapa_anterior = 3 AND etapa_nueva = 4;
  PERFORM public.__p114_assert(v_n = 0, '4 sin transición 3→4');

  -- 5) rechazo sin cambio etapa → conserva
  UPDATE public.expedientes SET subestado = 'rechazado' WHERE id = v_exp_new;
  SELECT fecha_entrada_paso_visual_actual INTO v_fecha2
  FROM public.expedientes WHERE id = v_exp_new;
  PERFORM public.__p114_assert(v_fecha2 = v_fecha, '5 rechazo conserva fecha');

  -- 6) histórico: insertar con triggers deshabilitados (simula pre-migración)
  ALTER TABLE public.expedientes DISABLE TRIGGER expedientes_paso_visual_fecha;
  ALTER TABLE public.expedientes DISABLE TRIGGER expedientes_paso_visual_historial;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado, fecha_entrada_paso_visual_actual
  ) VALUES (
    v_exp_hist, v_org, v_asesor, 'mejoravit', '11400000002', 'Cliente Hist P114',
    '5511400002', 'interno', true, NOW(), 7, 'en_proceso', 'activo', NULL
  );
  ALTER TABLE public.expedientes ENABLE TRIGGER expedientes_paso_visual_fecha;
  ALTER TABLE public.expedientes ENABLE TRIGGER expedientes_paso_visual_historial;

  SELECT fecha_entrada_paso_visual_actual INTO v_fecha
  FROM public.expedientes WHERE id = v_exp_hist;
  PERFORM public.__p114_assert(v_fecha IS NULL, '6 histórico NULL');

  -- 7) grants: authenticated no INSERT en transiciones
  SELECT COUNT(*)::int INTO v_n
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'expediente_paso_visual_transiciones'
    AND grantee = 'authenticated'
    AND privilege_type = 'INSERT';
  PERFORM public.__p114_assert(v_n = 0, '7 authenticated sin INSERT');

  -- 8) RPC v2 sin rango = incluye histórico NULL; con rango lo excluye
  PERFORM public.__p114_auth(v_admin);
  SELECT public.admin_report_expedientes_asesores_etapas_v2(
    ARRAY[v_asesor]::UUID[],
    ARRAY[3, 6]::SMALLINT[],
    'vigentes',
    NULL,
    NULL
  ) INTO v_out;
  PERFORM public.__p114_reset();

  PERFORM public.__p114_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_out->'detalle') d
      WHERE d->>'cliente_nombre' = 'Cliente Hist P114'
    ),
    '8 sin rango incluye histórico'
  );
  PERFORM public.__p114_assert(
    (v_out->'meta'->>'sin_fecha_canonica')::int >= 1,
    '8 meta sin_fecha >= 1'
  );
  PERFORM public.__p114_assert(
    (v_out->'meta'->>'excluidos_por_fecha_desconocida')::int = 0,
    '8 sin rango excluidos=0'
  );

  -- Detalle nuevo en paso 3 tiene fecha YYYY-MM-DD
  SELECT d->>'fecha_entrada_paso_actual' INTO v_ymd
  FROM jsonb_array_elements(v_out->'detalle') d
  WHERE d->>'cliente_nombre' = 'Cliente Nuevo P114'
  LIMIT 1;
  PERFORM public.__p114_assert(v_ymd ~ '^\d{4}-\d{2}-\d{2}$', '8 fecha ymd');

  -- Con rango hoy: excluye histórico
  PERFORM public.__p114_auth(v_admin);
  SELECT public.admin_report_expedientes_asesores_etapas_v2(
    ARRAY[v_asesor]::UUID[],
    ARRAY[3, 6]::SMALLINT[],
    'vigentes',
    (NOW() AT TIME ZONE 'America/Monterrey')::date,
    (NOW() AT TIME ZONE 'America/Monterrey')::date
  ) INTO v_out;
  PERFORM public.__p114_reset();

  PERFORM public.__p114_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_out->'detalle') d
      WHERE d->>'cliente_nombre' = 'Cliente Hist P114'
    ),
    '9 rango excluye histórico NULL'
  );
  PERFORM public.__p114_assert(
    (v_out->'meta'->>'excluidos_por_fecha_desconocida')::int >= 1,
    '9 excluidos reportados'
  );

  -- 10) desde > hasta error
  BEGIN
    PERFORM public.__p114_auth(v_admin);
    PERFORM public.admin_report_expedientes_asesores_etapas_v2(
      NULL, NULL, 'vigentes', '2026-07-20'::date, '2026-07-10'::date
    );
    PERFORM public.__p114_reset();
    RAISE EXCEPTION 'P114 FAIL: desde>hasta debió fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p114_reset();
    IF SQLERRM LIKE 'P114 FAIL:%' THEN RAISE; END IF;
    PERFORM public.__p114_assert(SQLERRM ILIKE '%desde%hasta%', '10 desde>hasta');
  END;

  -- 11) mesa no autorizado
  BEGIN
    PERFORM public.__p114_auth(v_mesa);
    PERFORM public.admin_report_expedientes_asesores_etapas_v2(NULL, NULL, 'vigentes', NULL, NULL);
    PERFORM public.__p114_reset();
    RAISE EXCEPTION 'P114 FAIL: mesa debió fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p114_reset();
    IF SQLERRM LIKE 'P114 FAIL:%' THEN RAISE; END IF;
    PERFORM public.__p114_assert(SQLERRM ILIKE '%super_admin%', '11 solo super_admin');
  END;

  -- 12) P112 intacta (firma vieja)
  PERFORM public.__p114_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'admin_report_expedientes_asesores_etapas'
        AND pg_get_function_identity_arguments(p.oid) = 'p_asesor_ids uuid[], p_pasos_visuales smallint[], p_estado text'
    ),
    '12 P112 RPC intacta'
  );

  RAISE NOTICE 'P114 tracking + report v2: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p114_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p114_auth(UUID);
DROP FUNCTION IF EXISTS public.__p114_reset();
