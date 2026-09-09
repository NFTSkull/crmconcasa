-- P225: Mesa externos conserva filtros, fuerza únicamente origen externo.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p225_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P225 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_external_block TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mesa_list_bandeja_page'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_limit integer, p_cursor_sort_ts timestamp with time zone, p_cursor_id uuid, p_quick_filter text, p_ops_filter text, p_buscar text, p_etapa integer, p_subestado text, p_solo_citas_hoy boolean, p_today_ymd text, p_rechazos_sub text, p_origen text, p_include_counts boolean'
  LIMIT 1;

  PERFORM public.__p225_assert(v_src IS NOT NULL, 'wrapper mesa_list_bandeja_page existe');
  PERFORM public.__p225_assert(position('ver_externos_mesa' in v_src) > 0, 'detecta capability externa');
  PERFORM public.__p225_assert(position('mesa_list_bandeja_page_base' in v_src) > 0, 'delega a base');

  v_external_block := split_part(split_part(v_src, 'IF v_external_scope THEN', 2), 'END IF;', 1);

  PERFORM public.__p225_assert(position('p_quick_filter => p_quick_filter' in v_external_block) > 0, 'preserva quick_filter');
  PERFORM public.__p225_assert(position('p_ops_filter => p_ops_filter' in v_external_block) > 0, 'preserva ops_filter');
  PERFORM public.__p225_assert(position('p_buscar => p_buscar' in v_external_block) > 0, 'preserva buscar');
  PERFORM public.__p225_assert(position('p_etapa => p_etapa' in v_external_block) > 0, 'preserva etapa');
  PERFORM public.__p225_assert(position('p_subestado => p_subestado' in v_external_block) > 0, 'preserva subestado');
  PERFORM public.__p225_assert(position('p_solo_citas_hoy => p_solo_citas_hoy' in v_external_block) > 0, 'preserva solo citas hoy');
  PERFORM public.__p225_assert(position('p_rechazos_sub => p_rechazos_sub' in v_external_block) > 0, 'preserva subfiltro rechazos');
  PERFORM public.__p225_assert(position('p_include_counts => p_include_counts' in v_external_block) > 0, 'preserva include_counts');

  PERFORM public.__p225_assert(position('p_origen => ''externo''' in v_external_block) > 0, 'fuerza origen externo');
  PERFORM public.__p225_assert(position('p_origen => p_origen' in v_external_block) = 0, 'no confía origen del cliente en external_scope');
  PERFORM public.__p225_assert(position('p_etapa => NULL' in v_external_block) = 0, 'no anula etapa');
  PERFORM public.__p225_assert(position('p_subestado => NULL' in v_external_block) = 0, 'no anula subestado');
  PERFORM public.__p225_assert(position('p_quick_filter => ''todos''' in v_external_block) = 0, 'no fuerza quick todos');
  PERFORM public.__p225_assert(position('p_ops_filter => ''todo_mesa''' in v_external_block) = 0, 'no fuerza ops todo_mesa');

  RAISE NOTICE 'P225 OK: external_scope preserva filtros y fuerza solo origen externo';
END;
$$;

DROP FUNCTION IF EXISTS public.__p225_assert(BOOLEAN, TEXT);
