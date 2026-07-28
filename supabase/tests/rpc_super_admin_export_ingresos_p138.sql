-- ConCasa CRM — P138: export ingresos
CREATE OR REPLACE FUNCTION public.__p138_ingresos_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P138 INGRESOS FAIL: %', p_msg; END IF; END;
$$;

DO $$
DECLARE
  v_sig TEXT;
  v_src TEXT;
BEGIN
  PERFORM public.__p138_ingresos_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'super_admin_export_ingresos'
    ),
    'rpc export existe'
  );

  v_sig := 'public.super_admin_export_ingresos(date,date,uuid[],text,numeric[],text,smallint,text,text,int)';
  PERFORM public.__p138_ingresos_assert(
    has_function_privilege('authenticated', v_sig, 'EXECUTE'),
    'grant authenticated'
  );
  PERFORM public.__p138_ingresos_assert(
    NOT has_function_privilege('anon', v_sig, 'EXECUTE'),
    'anon sin execute'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'super_admin_export_ingresos'
  LIMIT 1;
  PERFORM public.__p138_ingresos_assert(
    position('export_limit_exceeded' in v_src) > 0, 'límite 10k'
  );
  PERFORM public.__p138_ingresos_assert(
    position('__admin_require_super_admin' in v_src) > 0, 'solo super_admin'
  );
  PERFORM public.__p138_ingresos_assert(
    position('ingresos_resolve_etapas_filtro' in v_src) > 0, 'mismos filtros etapa'
  );
  PERFORM public.__p138_ingresos_assert(
    position('programa' in v_src) > 0, 'incluye programa'
  );

  -- Regresión: resumen/list y trigger intactos
  PERFORM public.__p138_ingresos_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='super_admin_get_ingresos_resumen'
    ),
    'resumen intacto'
  );
  PERFORM public.__p138_ingresos_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='__tg_ingresos_on_11_12'
    ),
    'trigger 11→12 intacto'
  );

  RAISE NOTICE 'P138 INGRESOS EXPORT OK';
END $$;

DROP FUNCTION IF EXISTS public.__p138_ingresos_assert(BOOLEAN, TEXT);
