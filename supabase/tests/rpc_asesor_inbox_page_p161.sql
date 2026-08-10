-- B1.5 P161: asesor_list_expedientes_page + asesor_inbox_summary
-- Contrato + aislamiento + paginación >1000 + orden estable.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p161_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P161 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p161_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p161_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_oid OID;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_list_expedientes_page'
  LIMIT 1;
  PERFORM public.__p161_assert(v_oid IS NOT NULL, 'list RPC existe');
  PERFORM public.__p161_assert(position('SECURITY DEFINER' in v_src) > 0, 'list DEFINER');
  PERFORM public.__p161_assert(position('e.asesor_id = v_actor' in v_src) > 0, 'list aislamiento');
  PERFORM public.__p161_assert(position('created_at DESC, f.id DESC' in v_src) > 0, 'orden estable');
  PERFORM public.__p161_assert(position('total_count' in v_src) > 0, 'total_count');
  PERFORM public.__p161_assert(position('p_quick_filter' in v_src) > 0, 'quick filter');
  PERFORM public.__p161_assert(position('asesor_inbox_matches_buscar' in v_src) > 0, 'buscar');

  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_summary'
  LIMIT 1;
  PERFORM public.__p161_assert(v_oid IS NOT NULL, 'summary RPC existe');
  PERFORM public.__p161_assert(position('agendar_biometricos' in v_src) > 0, 'count bio');
  PERFORM public.__p161_assert(position('programas_unicos' in v_src) > 0, 'programas');
  PERFORM public.__p161_assert(position('notifications' in v_src) > 0, 'notifications');
  PERFORM public.__p161_assert(position('e.asesor_id = v_actor' in v_src) > 0, 'summary aislamiento');

  PERFORM public.__p161_assert(EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='asesor_inbox_resultado_real'
  ), 'helper resultado');
  PERFORM public.__p161_assert(EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='asesor_inbox_categoria_correccion'
  ), 'helper categoria');

  -- Grants: authenticated EXECUTE; no PUBLIC
  PERFORM public.__p161_assert(EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema='public'
      AND routine_name='asesor_list_expedientes_page'
      AND grantee='authenticated'
      AND privilege_type='EXECUTE'
  ), 'list grant authenticated');
  PERFORM public.__p161_assert(NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema='public'
      AND routine_name='asesor_list_expedientes_page'
      AND grantee='PUBLIC'
      AND privilege_type='EXECUTE'
  ), 'list sin PUBLIC');

  RAISE NOTICE 'P161 OK: contrato RPC';
END;
$$;

-- Helpers resultado / categoría (unitarios SQL)
DO $$
BEGIN
  PERFORM public.__p161_assert(
    public.asesor_inbox_resultado_real(false, 'pendiente', 'activo', 'aprobado')
      = 'aprobado_editor',
    'resultado aprobado editor'
  );
  PERFORM public.__p161_assert(
    public.asesor_inbox_resultado_real(true, 'en_proceso', 'activo', 'aprobado')
      = 'en_tramite',
    'resultado mesa en tramite'
  );
  PERFORM public.__p161_assert(
    public.asesor_inbox_resultado_real(true, 'rechazado', 'activo', 'aprobado')
      = 'rechazado_mesa',
    'resultado rechazado mesa'
  );
  PERFORM public.__p161_assert(
    public.asesor_inbox_resultado_real(true, 'en_proceso', 'cancelado', 'aprobado')
      = 'cancelado',
    'resultado cancelado'
  );
  PERFORM public.__p161_assert(
    public.asesor_inbox_programa_ui('mejoravit') = 'Mejoravit',
    'programa ui'
  );
END;
$$;

-- Fixtures: aislamiento + paginación >1000 + filtros + counts
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_i INT;
  v_id UUID;
  v_page JSONB;
  v_sum JSONB;
  v_ids TEXT[];
  v_prev TEXT;
  v_cur TEXT;
  v_fail BOOLEAN;
BEGIN
  -- Limpieza de fixtures previas del test
  DELETE FROM public.agenda_bookings
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '99161%'
       OR cliente_nombre LIKE 'P161%'
       OR cliente_nombre LIKE 'ISOASESORX%'
  );
  DELETE FROM public.cliente_datos
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '99161%'
       OR cliente_nombre LIKE 'P161%'
       OR cliente_nombre LIKE 'ISOASESORX%'
  );
  DELETE FROM public.editor_decisions
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '99161%'
       OR cliente_nombre LIKE 'P161%'
       OR cliente_nombre LIKE 'ISOASESORX%'
  );
  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '99161%'
       OR cliente_nombre LIKE 'P161%'
       OR cliente_nombre LIKE 'ISOASESORX%'
  );
  DELETE FROM public.expedientes
  WHERE nss LIKE '99161%'
     OR cliente_nombre LIKE 'P161%'
     OR cliente_nombre LIKE 'ISOASESORX%';

  -- 1005 expedientes del asesor1 + 3 del asesor2
  FOR v_i IN 1..1005 LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
      submitted_to_mesa, etapa_actual, subestado, created_at
    ) VALUES (
      v_id, v_org, v_asesor, 'mejoravit',
      lpad((99161000000 + v_i)::text, 11, '0'),
      'P161 Cliente ' || lpad(v_i::text, 4, '0'),
      '5500000000', '', 'interno', 'activo',
      false, 1, 'pendiente',
      timestamptz '2026-01-01 00:00:00+00' + (v_i || ' seconds')::interval
    );
    INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
    VALUES (v_id, v_org, 'pendiente');
  END LOOP;

  -- Tres del otro asesor (no deben aparecer)
  FOR v_i IN 1..3 LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre,
      telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
      submitted_to_mesa, etapa_actual, subestado, created_at
    ) VALUES (
      v_id, v_org, v_asesor2, 'subcuenta',
      lpad((99161990000 + v_i)::text, 11, '0'),
      'ISOASESORX Cliente ' || v_i,
      '5511111111', '', 'externo', 'activo',
      true, 2, 'en_proceso',
      now()
    );
    INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
    VALUES (v_id, v_org, 'aprobado');
  END LOOP;

  -- Caso especial: enviado a mesa + cliente_datos rechazado → correccion_requerida
  v_id := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_id, v_org, v_asesor, 'mejoravit', '99161999901',
    'P161 Correccion Req', '5522222222', '', 'interno', 'activo',
    true, now(), 2, 'en_proceso', now() + interval '2 hours'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_id, v_org, 'aprobado');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_id, v_org, '{}'::jsonb, 'rechazado');

  -- Caso etapa 3 pendiente bio
  v_id := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_id, v_org, v_asesor, 'mejoravit', '99161999902',
    'P161 Bio Pendiente', '5533333333', '', 'interno', 'activo',
    true, now(), 3, 'en_proceso', now() + interval '3 hours'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_id, v_org, 'aprobado');

  PERFORM public.__p161_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p161_assert((v_page->>'total_count')::int >= 1007, 'total > 1000');
  PERFORM public.__p161_assert(jsonb_array_length(v_page->'items') = 25, 'page1 size 25');
  PERFORM public.__p161_assert((v_page->>'has_more')::boolean = true, 'has_more');

  -- Sin duplicados en página 1
  SELECT array_agg(x->>'id') INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p161_assert(
    (SELECT count(*) FROM unnest(v_ids) u) = (SELECT count(DISTINCT u) FROM unnest(v_ids) u),
    'sin duplicados page1'
  );

  -- Orden estable created_at DESC
  v_prev := NULL;
  FOR v_cur IN
    SELECT x->>'created_at' FROM jsonb_array_elements(v_page->'items') x
  LOOP
    IF v_prev IS NOT NULL THEN
      PERFORM public.__p161_assert(v_prev >= v_cur, 'orden created_at desc');
    END IF;
    v_prev := v_cur;
  END LOOP;

  v_page := public.asesor_list_expedientes_page(2, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p161_assert(jsonb_array_length(v_page->'items') = 25, 'page2 size 25');
  PERFORM public.__p161_assert((v_page->>'page')::int = 2, 'page=2');

  -- Filtro buscar
  v_page := public.asesor_list_expedientes_page(
    1, 25, 'Correccion Req', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos'
  );
  PERFORM public.__p161_assert((v_page->>'total_count')::int = 1, 'buscar nombre');
  PERFORM public.__p161_assert(
    v_page->'items'->0->>'cliente_nombre' = 'P161 Correccion Req',
    'buscar item'
  );

  -- Quick correccion_requerida
  v_page := public.asesor_list_expedientes_page(
    1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida'
  );
  PERFORM public.__p161_assert((v_page->>'total_count')::int >= 1, 'quick correccion');

  -- Quick agendar_biometricos
  v_page := public.asesor_list_expedientes_page(
    1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'agendar_biometricos'
  );
  PERFORM public.__p161_assert((v_page->>'total_count')::int >= 1, 'quick bio');

  -- Summary counts
  v_sum := public.asesor_inbox_summary(50);
  PERFORM public.__p161_assert((v_sum->'counts'->>'total')::int >= 1007, 'summary total');
  PERFORM public.__p161_assert(
    (v_sum->'counts'->>'correccion_requerida')::int >= 1,
    'summary correccion'
  );
  PERFORM public.__p161_assert(
    (v_sum->'counts'->>'agendar_biometricos')::int >= 1,
    'summary bio'
  );
  PERFORM public.__p161_assert(
    jsonb_typeof(v_sum->'programas_unicos') = 'array',
    'programas array'
  );
  PERFORM public.__p161_assert(
    jsonb_typeof(v_sum->'notifications') = 'array',
    'notifications array'
  );

  -- Aislamiento: asesor2 no ve filas de asesor1 (seed puede tener más del propio asesor2)
  PERFORM public.__p161_set_auth(v_asesor2);
  v_page := public.asesor_list_expedientes_page(1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p161_assert((v_page->>'total_count')::int >= 3, 'aislamiento asesor2 total>=3');
  PERFORM public.__p161_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') x
      WHERE x->>'cliente_nombre' LIKE 'P161 Cliente%'
         OR x->>'cliente_nombre' = 'P161 Correccion Req'
         OR x->>'cliente_nombre' = 'P161 Bio Pendiente'
    ),
    'asesor2 sin filas ajenas'
  );
  -- Buscar sin dígitos: matches_buscar extrae \d y haría match falso en NSS
  v_page := public.asesor_list_expedientes_page(
    1, 25, 'ISOASESORX', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos'
  );
  PERFORM public.__p161_assert((v_page->>'total_count')::int = 3, 'asesor2 fixtures propias');
  PERFORM public.__p161_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(
    1, 25, 'ISOASESORX', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos'
  );
  PERFORM public.__p161_assert((v_page->>'total_count')::int = 0, 'asesor1 sin ISOASESORX');

  -- Editor no autorizado
  PERFORM public.__p161_set_auth(v_editor);
  BEGIN
    PERFORM public.asesor_list_expedientes_page(1, 25);
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__p161_assert(v_fail, 'editor bloqueado en list');

  BEGIN
    PERFORM public.asesor_inbox_summary(10);
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__p161_assert(v_fail, 'editor bloqueado en summary');

  PERFORM public.__p161_reset_auth();

  -- Cleanup
  DELETE FROM public.agenda_bookings
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '99161%'
       OR cliente_nombre LIKE 'P161%'
       OR cliente_nombre LIKE 'ISOASESORX%'
  );
  DELETE FROM public.cliente_datos
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '99161%'
       OR cliente_nombre LIKE 'P161%'
       OR cliente_nombre LIKE 'ISOASESORX%'
  );
  DELETE FROM public.editor_decisions
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '99161%'
       OR cliente_nombre LIKE 'P161%'
       OR cliente_nombre LIKE 'ISOASESORX%'
  );
  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '99161%'
       OR cliente_nombre LIKE 'P161%'
       OR cliente_nombre LIKE 'ISOASESORX%'
  );
  DELETE FROM public.expedientes
  WHERE nss LIKE '99161%'
     OR cliente_nombre LIKE 'P161%'
     OR cliente_nombre LIKE 'ISOASESORX%';

  RAISE NOTICE 'P161 OK: aislamiento + paginación + filtros + counts';
END;
$$;

DROP FUNCTION IF EXISTS public.__p161_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p161_reset_auth();
DROP FUNCTION IF EXISTS public.__p161_assert(BOOLEAN, TEXT);
