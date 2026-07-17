-- P085: admin_list_production_by_asesor + admin_list_mesa_envios_page seguimiento
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p085_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P085 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_sig_ok BOOLEAN;
  v_src TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'admin_list_production_by_asesor'
      AND pg_get_function_identity_arguments(p.oid) =
        'p_from timestamp with time zone, p_to_exclusive timestamp with time zone, p_estado text, p_asesor_id uuid'
  ) INTO v_sig_ok;

  PERFORM public.__p085_assert(v_sig_ok, 'firma 4 args con p_asesor_id uuid');

  PERFORM public.__p085_assert(
    NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'admin_list_production_by_asesor'
        AND pg_get_function_identity_arguments(p.oid) =
          'p_from timestamp with time zone, p_to_exclusive timestamp with time zone, p_estado text'
    ),
    'firma antigua de 3 args eliminada'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_list_mesa_envios_page'
  LIMIT 1;

  PERFORM public.__p085_assert(v_src IS NOT NULL, 'admin_list_mesa_envios_page existe');
  PERFORM public.__p085_assert(
    position('ultima_actividad_mesa_at' in v_src) > 0,
    'incluye ultima_actividad_mesa_at'
  );
  PERFORM public.__p085_assert(
    position('siguiente_accion_label' in v_src) > 0,
    'incluye siguiente_accion_label'
  );
  PERFORM public.__p085_assert(
    position('pago_a_concasa' in v_src) > 0,
    'incluye situación pago_a_concasa'
  );
  PERFORM public.__p085_assert(
    position('situacion_code' in v_src) > 0,
    'incluye situacion_code'
  );
  PERFORM public.__p085_assert(
    position('correcciones_abiertas_count' in v_src) > 0,
    'incluye correcciones_abiertas_count'
  );
  PERFORM public.__p085_assert(
    position('actor_role IN' in v_src) = 0,
    'última actividad no filtra por actor_role'
  );
  -- El listado NO debe embeber timeline detallado
  PERFORM public.__p085_assert(
    position('tl.timeline' in v_src) = 0
      AND position('jsonb_agg(ev ORDER BY at ASC)' in v_src) = 0,
    'listado sin timeline embebido'
  );
  PERFORM public.__p085_assert(
    position('v_page_ids' in v_src) > 0
      AND position('unnest(v_page_ids)' in v_src) > 0,
    'arquitectura cohorte→page_ids→seguimiento de página'
  );
  PERFORM public.__p085_assert(
    position('''asesor_email''' in v_src) = 0,
    'listado Mesa sin asesor_email en respuesta'
  );

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'admin_get_expediente_mesa_timeline'
      AND pg_get_function_identity_arguments(p.oid) =
        'p_expediente_id uuid, p_limit integer, p_offset integer'
  ) INTO v_sig_ok;

  PERFORM public.__p085_assert(v_sig_ok, 'RPC admin_get_expediente_mesa_timeline presente');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_get_expediente_mesa_timeline'
  LIMIT 1;

  PERFORM public.__p085_assert(
    position('LEAST(100, GREATEST(1, coalesce(p_limit, 10)))' in v_src) > 0,
    'timeline clamp limit documentado'
  );
  PERFORM public.__p085_assert(
    position('''asesor_email''' in v_src) = 0,
    'timeline sin asesor_email'
  );
END;
$$;

DROP FUNCTION IF EXISTS public.__p085_assert(BOOLEAN, TEXT);
