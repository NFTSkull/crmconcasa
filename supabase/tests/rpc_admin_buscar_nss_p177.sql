-- Admin /admin: p_buscar incluye NSS (mig 177)
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p177_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P177 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_def TEXT;
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'admin_list_mesa_envios_page',
    'admin_list_precalificaciones_page',
    'admin_expedientes_snapshot_etapas',
    'admin_list_expedientes_snapshot_page'
  ]
  LOOP
    SELECT pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = v_name
    ORDER BY p.oid DESC
    LIMIT 1;

    PERFORM public.__p177_assert(v_def IS NOT NULL, v_name || ' existe');
    PERFORM public.__p177_assert(v_def ILIKE '%e.nss%', v_name || ' busca NSS');
  END LOOP;

  RAISE NOTICE 'P177 PASS';
END;
$$;
