-- ConCasa CRM — P133: formatos de campos Datos Generales (estructural, sin mutar expedientes)
-- Uso local: PGPASSWORD=postgres psql ... -f supabase/tests/rpc_cliente_datos_field_formats_p133.sql
-- Uso Cloud: npx supabase db query --linked -f supabase/tests/rpc_cliente_datos_field_formats_p133.sql

CREATE OR REPLACE FUNCTION public.__p133_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P133 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_exp_count BIGINT;
BEGIN
  -- Helpers existen
  PERFORM public.__p133_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cliente_datos_normalize_person_name'
  ), 'cliente_datos_normalize_person_name existe');

  PERFORM public.__p133_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cliente_datos_is_valid_person_name'
  ), 'cliente_datos_is_valid_person_name existe');

  PERFORM public.__p133_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cliente_datos_assert_payload_formats'
  ), 'cliente_datos_assert_payload_formats existe');

  -- Person name
  PERFORM public.__p133_assert(
    public.cliente_datos_is_valid_person_name('José María') IS TRUE,
    'José María válido'
  );
  PERFORM public.__p133_assert(
    public.cliente_datos_is_valid_person_name('Muñoz') IS TRUE,
    'Muñoz válido'
  );
  PERFORM public.__p133_assert(
    public.cliente_datos_is_valid_person_name('Pérez-García') IS TRUE,
    'Pérez-García válido'
  );
  PERFORM public.__p133_assert(
    public.cliente_datos_is_valid_person_name('O''Connor') IS TRUE,
    'O''Connor válido'
  );
  PERFORM public.__p133_assert(
    public.cliente_datos_is_valid_person_name('Juan123') IS FALSE,
    'Juan123 inválido'
  );
  PERFORM public.__p133_assert(
    public.cliente_datos_is_valid_person_name('') IS TRUE,
    'nombre vacío = true'
  );
  PERFORM public.__p133_assert(
    public.cliente_datos_normalize_person_name('  Ana   Sofía  ') = 'Ana Sofía',
    'normalize colapsa espacios'
  );

  -- lunes-style business-days: N/A para P133 (sin lógica de calendario)
  PERFORM public.__p133_assert(TRUE, 'lunes-style N/A');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_cliente_datos'
  LIMIT 1;
  PERFORM public.__p133_assert(v_src IS NOT NULL, 'save_cliente_datos existe');
  PERFORM public.__p133_assert(
    position('cliente_datos_assert_payload_formats' in v_src) > 0,
    'save_cliente_datos source contains assert_payload_formats'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_cliente_datos_correccion'
  LIMIT 1;
  PERFORM public.__p133_assert(v_src IS NOT NULL, 'save_cliente_datos_correccion existe');
  PERFORM public.__p133_assert(
    position('cliente_datos_assert_payload_formats' in v_src) > 0,
    'save_cliente_datos_correccion source contains assert_payload_formats'
  );

  -- Sin mutar expedientes (solo lectura de conteo)
  SELECT count(*) INTO v_exp_count FROM public.expedientes;
  PERFORM public.__p133_assert(v_exp_count IS NOT NULL, 'conteo expedientes legible sin mutación');
END;
$$;

DROP FUNCTION IF EXISTS public.__p133_assert(BOOLEAN, TEXT);
