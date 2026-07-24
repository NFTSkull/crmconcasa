-- ConCasa CRM — P130: lotes de cambios asesor
-- Estructura + contratos RPC (sin fixtures destructivos en Cloud).

CREATE OR REPLACE FUNCTION public.__p130_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P130 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  PERFORM public.__p130_assert(
    to_regclass('public.expediente_asesor_cambio_lotes') IS NOT NULL, 'tabla lotes'
  );
  PERFORM public.__p130_assert(
    to_regclass('public.expediente_asesor_cambios') IS NOT NULL, 'tabla cambios'
  );

  PERFORM public.__p130_assert(EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='mesa_list_asesor_cambios_summary'
  ), 'summary RPC');
  PERFORM public.__p130_assert(EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='mesa_get_asesor_cambio_lote'
  ), 'get lote RPC');
  PERFORM public.__p130_assert(EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='mesa_marcar_asesor_cambios_revisados'
  ), 'marcar RPC');
  PERFORM public.__p130_assert(EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='asesor_cambio_record_doc_reemplazo'
  ), 'helper doc');
  PERFORM public.__p130_assert(EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='asesor_cambio_record_cliente_datos_diff'
  ), 'helper datos');

  -- Sin write authenticated
  PERFORM public.__p130_assert(NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g
    WHERE g.table_schema='public'
      AND g.table_name IN ('expediente_asesor_cambio_lotes','expediente_asesor_cambios')
      AND g.grantee='authenticated'
      AND g.privilege_type IN ('INSERT','UPDATE','DELETE')
  ), 'sin write authenticated');

  -- RPCs de corrección invocan helpers
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='register_expediente_documento_correccion'
  LIMIT 1;
  PERFORM public.__p130_assert(v_src IS NOT NULL, 'doc correccion existe');
  PERFORM public.__p130_assert(
    position('asesor_cambio_record_doc_reemplazo' in v_src) > 0,
    'doc correccion registra lote'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='save_cliente_datos_correccion'
  LIMIT 1;
  PERFORM public.__p130_assert(v_src IS NOT NULL, 'datos correccion existe');
  PERFORM public.__p130_assert(
    position('asesor_cambio_record_cliente_datos_diff' in v_src) > 0,
    'datos correccion registra lote'
  );

  -- Upsert: original→final + revert elimina
  PERFORM public.__p130_assert(
    position('valor_anterior' in pg_get_functiondef(
      (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='asesor_cambio_upsert' LIMIT 1)
    )) > 0,
    'upsert conserva anterior'
  );

  RAISE NOTICE 'P130 OK: estructura + contratos RPC';
END;
$$;

DROP FUNCTION IF EXISTS public.__p130_assert(BOOLEAN, TEXT);
