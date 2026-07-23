-- P102: RPC mesa_list_bandeja_page — paginación keyset + total + counts
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p102_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P102 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_oid OID;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
  INTO v_oid, v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;

  PERFORM public.__p102_assert(v_oid IS NOT NULL, 'mesa_list_bandeja_page existe');
  PERFORM public.__p102_assert(position('can_see_expediente' in v_src) > 0, 'usa can_see_expediente');
  PERFORM public.__p102_assert(position('p_cursor_sort_ts' in v_src) > 0, 'cursor sort_ts');
  PERFORM public.__p102_assert(position('p_cursor_id' in v_src) > 0, 'cursor id');
  PERFORM public.__p102_assert(position('total_count' in v_src) > 0, 'total_count');
  PERFORM public.__p102_assert(position('has_more' in v_src) > 0, 'has_more');
  PERFORM public.__p102_assert(position('next_cursor' in v_src) > 0, 'next_cursor');
  PERFORM public.__p102_assert(position('mesa_bandeja_sort_ts' in v_src) > 0, 'sort helper');
  PERFORM public.__p102_assert(position('mesa_bandeja_categoria_resumen' in v_src) > 0, 'categoria helper');
  PERFORM public.__p102_assert(position('v_limit + 1' in v_src) > 0 OR position('(v_limit + 1)' in v_src) > 0, 'limit+1 has_more');
  PERFORM public.__p102_assert(position('SECURITY DEFINER' in v_src) > 0, 'security definer');
  PERFORM public.__p102_assert(position('correccion_enviada' in v_src) > 0, 'quick correccion');
  PERFORM public.__p102_assert(position('sin_asignar' in v_src) > 0, 'ops sin_asignar');
  PERFORM public.__p102_assert(position('mi_bandeja' in v_src) > 0, 'ops mi_bandeja');
  PERFORM public.__p102_assert(position('rechazados' in v_src) > 0, 'subfiltro rechazados');
  -- P127: actividad Mesa en batch
  PERFORM public.__p102_assert(position('last_viewed_by_name' in v_src) > 0, 'P127 viewed name');
  PERFORM public.__p102_assert(position('last_updated_by_name' in v_src) > 0, 'P127 updated name');
  PERFORM public.__p102_assert(
    position('expediente_mesa_actividad' in v_src) > 0, 'P127 JOIN actividad'
  );

  -- Helpers existen
  PERFORM public.__p102_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_categoria_resumen'
    ),
    'mesa_bandeja_categoria_resumen'
  );
  PERFORM public.__p102_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_sort_ts'
    ),
    'mesa_bandeja_sort_ts'
  );

  RAISE NOTICE 'P102 OK: mesa_list_bandeja_page contract';
END;
$$;

DROP FUNCTION IF EXISTS public.__p102_assert(BOOLEAN, TEXT);
