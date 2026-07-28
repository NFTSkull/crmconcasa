-- ConCasa CRM — P134: ingresos Super Admin (estático + helpers)
-- Uso: psql ... -f supabase/tests/rpc_super_admin_ingresos_p134.sql

CREATE OR REPLACE FUNCTION public.__p134_ingresos_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P134 INGRESOS FAIL: %', p_msg; END IF; END;
$$;

DO $$
DECLARE
  v_calc NUMERIC;
  v_src TEXT;
BEGIN
  PERFORM public.__p134_ingresos_assert(
    to_regclass('public.expediente_ingresos_reconocidos') IS NOT NULL,
    'tabla expediente_ingresos_reconocidos'
  );

  PERFORM public.__p134_ingresos_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'ingresos_calc_ingreso'
    ),
    'fn ingresos_calc_ingreso'
  );

  v_calc := public.ingresos_calc_ingreso(160000, 17);
  PERFORM public.__p134_ingresos_assert(v_calc = 27200, '160k × 17% = 27200');

  v_calc := public.ingresos_calc_ingreso(160000, 20);
  PERFORM public.__p134_ingresos_assert(v_calc = 32000, '160k × 20% = 32000');

  v_calc := public.ingresos_calc_ingreso(200000, 10);
  PERFORM public.__p134_ingresos_assert(v_calc = 20000, 'sin cap 169k');

  PERFORM public.__p134_ingresos_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'super_admin_get_ingresos_resumen'
    ),
    'rpc resumen'
  );
  PERFORM public.__p134_ingresos_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'super_admin_list_ingresos_page'
    ),
    'rpc list page'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '__tg_ingresos_on_11_12'
  LIMIT 1;
  PERFORM public.__p134_ingresos_assert(v_src IS NOT NULL, 'trigger fn 11_12');
  PERFORM public.__p134_ingresos_assert(
    position('ingresos_reconocer_pago_concasa' in v_src) > 0,
    'trigger llama reconocimiento'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ingresos_reconocer_pago_concasa'
  LIMIT 1;
  PERFORM public.__p134_ingresos_assert(
    position('No se puede registrar Pago a ConCasa porque faltan el monto base o el porcentaje de cobro.' in v_src) > 0,
    'mensaje bloqueo incompleto'
  );

  -- Grants: authenticated puede ejecutar RPCs resumen/list; no la de reconocer
  PERFORM public.__p134_ingresos_assert(
    has_function_privilege('authenticated', 'public.super_admin_get_ingresos_resumen(date,date,uuid[],text,numeric[],smallint[],text,text)', 'EXECUTE'),
    'grant resumen authenticated'
  );
  PERFORM public.__p134_ingresos_assert(
    NOT has_function_privilege(
      'authenticated',
      'public.ingresos_reconocer_pago_concasa(uuid,uuid,uuid,text,timestamptz,boolean,boolean)',
      'EXECUTE'
    ),
    'reconocer no expuesto a authenticated'
  );

  RAISE NOTICE 'P134 INGRESOS OK';
END $$;

DROP FUNCTION IF EXISTS public.__p134_ingresos_assert(BOOLEAN, TEXT);
