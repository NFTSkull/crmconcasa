-- P087: tope $169,000 por expediente en agregados Admin (migración 086)
-- Uso local: aplicar 086 y ejecutar este archivo contra DB de test.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p087_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P087 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p087_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p087_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_admin UUID := '00000000-0000-4000-8006-000000000001';
  v_from TIMESTAMPTZ := '2026-07-10T00:00:00-06:00';
  v_to TIMESTAMPTZ := '2026-07-11T00:00:00-06:00';
  v_ids UUID[] := ARRAY[
    '00000000-0000-4000-9087-000000000001'::UUID,
    '00000000-0000-4000-9087-000000000002'::UUID,
    '00000000-0000-4000-9087-000000000003'::UUID,
    '00000000-0000-4000-9087-000000000004'::UUID,
    '00000000-0000-4000-9087-000000000005'::UUID,
    '00000000-0000-4000-9087-000000000006'::UUID,
    '00000000-0000-4000-9087-000000000007'::UUID
  ];
  v_id UUID;
  v_sum JSONB;
  v_asesores JSONB;
  v_precal JSONB;
  v_item JSONB;
  v_monto NUMERIC;
  v_prom NUMERIC;
  v_mayor BIGINT;
  v_aprob BIGINT;
  v_row JSONB;
BEGIN
  -- --- Estructura: expresiones LEAST antes de SUM/AVG ---
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_get_production_summary'
  LIMIT 1;
  PERFORM public.__p087_assert(v_src IS NOT NULL, 'admin_get_production_summary existe');
  PERFORM public.__p087_assert(
    position('sum(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000))' in lower(v_src)) > 0,
    'summary: SUM(LEAST(...169000)) presente'
  );
  PERFORM public.__p087_assert(
    position('least(sum(' in lower(v_src)) = 0,
    'summary: no limita el total con LEAST(SUM(...))'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_list_production_by_asesor'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_from timestamp with time zone, p_to_exclusive timestamp with time zone, p_estado text, p_asesor_id uuid'
  LIMIT 1;
  PERFORM public.__p087_assert(v_src IS NOT NULL, 'admin_list_production_by_asesor firma 085');
  PERFORM public.__p087_assert(
    position('sum(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000))' in lower(v_src)) > 0,
    'by_asesor: SUM(LEAST(...169000)) presente'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_list_precalificaciones_page'
  LIMIT 1;
  PERFORM public.__p087_assert(
    position('sum(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000))' in lower(v_src)) > 0,
    'precal: SUM(LEAST(...169000)) presente'
  );
  PERFORM public.__p087_assert(
    position('avg(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000))' in lower(v_src)) > 0,
    'precal: AVG(LEAST(...169000)) presente'
  );

  -- --- Fixtures ---
  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.editor_decisions WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;

  -- A: 50000 Mejoravit asesor1
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[1], v_org, v_asesor1, 'mejoravit', '98700000001', 'P087 A', '8111111101',
    'interno', false, 1, 'pendiente', 'activo'
  );
  -- B: 200000 Mejoravit asesor1
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[2], v_org, v_asesor1, 'mejoravit', '98700000002', 'P087 B', '8111111102',
    'interno', false, 1, 'pendiente', 'activo'
  );
  -- C: 300000 Mejoravit asesor2
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[3], v_org, v_asesor2, 'mejoravit', '98700000003', 'P087 C', '8111111103',
    'interno', false, 1, 'pendiente', 'activo'
  );
  -- D: 100000 Mejoravit asesor2
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[4], v_org, v_asesor2, 'mejoravit', '98700000004', 'P087 D', '8111111104',
    'interno', false, 1, 'pendiente', 'activo'
  );
  -- E: 250000 Mejoravit (snapshot individual intacto)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[5], v_org, v_asesor1, 'mejoravit', '98700000005', 'P087 E', '8111111105',
    'interno', false, 1, 'pendiente', 'activo'
  );
  -- F: 500000 subcuenta (no entra en monto Mejoravit)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[6], v_org, v_asesor1, 'subcuenta', '98700000006', 'P087 F', '8111111106',
    'interno', false, 1, 'pendiente', 'activo'
  );
  -- G: 80000 Mejoravit fuera de periodo
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_ids[7], v_org, v_asesor1, 'mejoravit', '98700000007', 'P087 G', '8111111107',
    'interno', false, 1, 'pendiente', 'activo'
  );

  PERFORM public.__p087_set_auth(v_editor);
  PERFORM public.upsert_editor_decision(v_ids[1], 'aprobado', 50000, 'a');
  PERFORM public.upsert_editor_decision(v_ids[2], 'aprobado', 200000, 'b');
  PERFORM public.upsert_editor_decision(v_ids[3], 'aprobado', 300000, 'c');
  PERFORM public.upsert_editor_decision(v_ids[4], 'aprobado', 100000, 'd');
  PERFORM public.upsert_editor_decision(v_ids[5], 'aprobado', 250000, 'e');
  PERFORM public.upsert_editor_decision(v_ids[6], 'aprobado', 500000, 'f');
  PERFORM public.upsert_editor_decision(v_ids[7], 'aprobado', 80000, 'g');
  PERFORM public.__p087_reset_auth();

  -- Forzar aprobado_at en rango (excepto G fuera)
  UPDATE public.editor_decisions
  SET aprobado_at = '2026-07-10T12:00:00-06:00'
  WHERE expediente_id = ANY (v_ids[1:6]);

  UPDATE public.editor_decisions
  SET aprobado_at = '2026-07-01T12:00:00-06:00'
  WHERE expediente_id = v_ids[7];

  -- Snapshot E permanece 250000
  SELECT monto_aprobado_al_aprobar INTO v_monto
  FROM public.editor_decisions WHERE expediente_id = v_ids[5];
  PERFORM public.__p087_assert(v_monto = 250000, 'snapshot E permanece 250000');

  PERFORM public.__p087_set_auth(v_admin);

  -- 1-3,14: KPI general
  -- Aportaciones periodo: 50k + 169k + 169k + 100k + 169k (+ subcuenta excluida) = 657000
  v_sum := public.admin_get_production_summary(v_from, v_to, NULL, NULL, NULL);
  v_monto := (v_sum->>'monto_aprobado_total')::NUMERIC;
  v_aprob := (v_sum->>'precalificaciones_aprobadas')::BIGINT;
  v_mayor := (v_sum->>'aprobadas_mayor_a_20000')::BIGINT;

  PERFORM public.__p087_assert(v_monto = 657000, format('KPI total esperado 657000, got %s', v_monto));
  PERFORM public.__p087_assert(v_monto > 169000, 'total puede superar 169000');
  PERFORM public.__p087_assert(v_aprob = 6, 'conteo aprobadas periodo = 6 (incluye subcuenta)');
  PERFORM public.__p087_assert(v_mayor = 6, 'aprobadas_mayor_a_20000 = 6 (sin tope en conteo)');

  -- Valores bajo tope solos
  v_sum := public.admin_get_production_summary(v_from, v_to, v_asesor2, NULL, NULL);
  -- C 169k + D 100k = 269000
  PERFORM public.__p087_assert(
    (v_sum->>'monto_aprobado_total')::NUMERIC = 269000,
    'filtro asesor2: total 269000'
  );

  -- 4-6: Producción por asesor
  v_asesores := public.admin_list_production_by_asesor(v_from, v_to, NULL, NULL);
  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_asesores) elem
  WHERE elem->>'asesor_id' = v_asesor1::text;
  -- A 50 + B 169 + E 169 = 388000 (subcuenta no suma monto)
  PERFORM public.__p087_assert(
    (v_row->>'monto_aprobado_total')::NUMERIC = 388000,
    'asesor1 monto 388000'
  );

  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_asesores) elem
  WHERE elem->>'asesor_id' = v_asesor2::text;
  PERFORM public.__p087_assert(
    (v_row->>'monto_aprobado_total')::NUMERIC = 269000,
    'asesor2 monto 269000'
  );

  v_asesores := public.admin_list_production_by_asesor(v_from, v_to, NULL, v_asesor2);
  PERFORM public.__p087_assert(jsonb_array_length(v_asesores) = 1, 'filtro asesor2: 1 fila');
  PERFORM public.__p087_assert(
    (v_asesores->0->>'monto_aprobado_total')::NUMERIC = 269000,
    'filtro asesor2 RPC: 269000'
  );

  -- 7-9: Precal page total/promedio + fila individual
  v_precal := public.admin_list_precalificaciones_page(
    v_from, v_to, 1, 100, NULL, 'aprobadas', NULL
  );
  v_monto := (v_precal->'summary'->>'monto_mejoravit_total')::NUMERIC;
  v_prom := (v_precal->'summary'->>'monto_mejoravit_promedio')::NUMERIC;
  -- 5 Mejoravit en periodo: 50+169+169+100+169 = 657000; avg = 131400
  PERFORM public.__p087_assert(v_monto = 657000, 'precal total 657000');
  PERFORM public.__p087_assert(v_prom = 131400, format('precal promedio 131400, got %s', v_prom));

  SELECT elem INTO v_item
  FROM jsonb_array_elements(v_precal->'items') elem
  WHERE elem->>'expediente_id' = v_ids[5]::text;
  PERFORM public.__p087_assert(
    (v_item->>'monto_aprobado_al_aprobar')::NUMERIC = 250000,
    'fila individual E sigue en 250000'
  );

  -- 12: fuera de periodo excluido
  v_sum := public.admin_get_production_summary(
    '2026-07-01T00:00:00-06:00'::TIMESTAMPTZ,
    '2026-07-02T00:00:00-06:00'::TIMESTAMPTZ,
    NULL, NULL, NULL
  );
  PERFORM public.__p087_assert(
    (v_sum->>'monto_aprobado_total')::NUMERIC = 80000,
    'periodo 1-jul solo G=80000'
  );

  -- 13: subcuenta no aporta (ya cubierto en total 657k sin 500k)

  PERFORM public.__p087_reset_auth();

  -- Limpieza
  FOREACH v_id IN ARRAY v_ids LOOP
    DELETE FROM public.action_log WHERE entity_id = v_id;
    DELETE FROM public.editor_decisions WHERE expediente_id = v_id;
    DELETE FROM public.expedientes WHERE id = v_id;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.__p087_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p087_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p087_reset_auth();
