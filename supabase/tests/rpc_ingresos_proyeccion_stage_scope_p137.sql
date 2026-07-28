-- ConCasa CRM — P137: universo por envío a Mesa + stage_scope
-- Uso: psql ... -f supabase/tests/rpc_ingresos_proyeccion_stage_scope_p137.sql

CREATE OR REPLACE FUNCTION public.__p137_ingresos_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P137 INGRESOS FAIL: %', p_msg; END IF; END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_etapas SMALLINT[];
  v_sig TEXT;
BEGIN
  PERFORM public.__p137_ingresos_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'ingresos_etapas_internas_from_paso_visual'
    ),
    'helper etapas desde paso visual'
  );

  PERFORM public.__p137_ingresos_assert(
    public.ingresos_etapas_internas_from_paso_visual(3::SMALLINT) = ARRAY[3, 4]::SMALLINT[],
    'paso 3 → 3,4'
  );
  PERFORM public.__p137_ingresos_assert(
    public.ingresos_etapas_internas_from_paso_visual(4::SMALLINT) = ARRAY[5]::SMALLINT[],
    'paso 4 → 5'
  );
  PERFORM public.__p137_ingresos_assert(
    public.ingresos_etapas_internas_from_paso_visual(7::SMALLINT) = ARRAY[8]::SMALLINT[],
    'paso 7 → 8'
  );
  PERFORM public.__p137_ingresos_assert(
    public.ingresos_etapas_internas_from_paso_visual(11::SMALLINT) = ARRAY[12]::SMALLINT[],
    'paso 11 → 12'
  );

  v_etapas := public.ingresos_resolve_etapas_filtro('all_submitted', NULL::SMALLINT);
  PERFORM public.__p137_ingresos_assert(
    v_etapas = ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::SMALLINT[],
    'all_submitted → 1..12'
  );

  v_etapas := public.ingresos_resolve_etapas_filtro('from_step', 1::SMALLINT);
  PERFORM public.__p137_ingresos_assert(
    v_etapas = ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::SMALLINT[],
    'from_step 1 ≡ all'
  );

  v_etapas := public.ingresos_resolve_etapas_filtro('from_step', 3::SMALLINT);
  PERFORM public.__p137_ingresos_assert(
    3 = ANY (v_etapas) AND 4 = ANY (v_etapas) AND 12 = ANY (v_etapas)
    AND NOT (1 = ANY (v_etapas)) AND NOT (2 = ANY (v_etapas)),
    'from_step 3 incluye 3/4+ posteriores'
  );

  v_etapas := public.ingresos_resolve_etapas_filtro('from_step', 4::SMALLINT);
  PERFORM public.__p137_ingresos_assert(
    5 = ANY (v_etapas) AND 12 = ANY (v_etapas)
    AND NOT (1 = ANY (v_etapas)) AND NOT (4 = ANY (v_etapas)),
    'from_step 4 excluye pasos 1–3'
  );

  v_etapas := public.ingresos_resolve_etapas_filtro('from_step', 8::SMALLINT);
  PERFORM public.__p137_ingresos_assert(
    v_etapas = ARRAY[9,10,11,12]::SMALLINT[],
    'from_step 8 → 9..12'
  );

  v_etapas := public.ingresos_resolve_etapas_filtro('from_step', 11::SMALLINT);
  PERFORM public.__p137_ingresos_assert(
    v_etapas = ARRAY[12]::SMALLINT[],
    'from_step 11 → solo 12'
  );

  v_etapas := public.ingresos_resolve_etapas_filtro('exact_step', 3::SMALLINT);
  PERFORM public.__p137_ingresos_assert(v_etapas = ARRAY[3,4]::SMALLINT[], 'exact 3');
  v_etapas := public.ingresos_resolve_etapas_filtro('exact_step', 4::SMALLINT);
  PERFORM public.__p137_ingresos_assert(v_etapas = ARRAY[5]::SMALLINT[], 'exact 4');
  v_etapas := public.ingresos_resolve_etapas_filtro('exact_step', 7::SMALLINT);
  PERFORM public.__p137_ingresos_assert(v_etapas = ARRAY[8]::SMALLINT[], 'exact 7');
  v_etapas := public.ingresos_resolve_etapas_filtro('exact_step', 11::SMALLINT);
  PERFORM public.__p137_ingresos_assert(v_etapas = ARRAY[12]::SMALLINT[], 'exact 11');

  -- Universo: sin gate bio; fecha_envio_mesa
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '__ingresos_universe_rows'
  LIMIT 1;
  PERFORM public.__p137_ingresos_assert(v_src IS NOT NULL, 'universe rows');
  PERFORM public.__p137_ingresos_assert(
    position('submitted_to_mesa IS TRUE' in v_src) > 0
    AND position('fecha_envio_mesa IS NOT NULL' in v_src) > 0,
    'universo por envío a Mesa'
  );
  PERFORM public.__p137_ingresos_assert(
    position('ingresos_bio_aprobacion_at IS NOT NULL' in v_src) = 0,
    'sin gate bio en universo'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'super_admin_get_ingresos_resumen'
  LIMIT 1;
  PERFORM public.__p137_ingresos_assert(
    position('fecha_envio_mesa' in v_src) > 0
    AND position('p_stage_scope' in v_src) > 0
    AND position('p_visible_step' in v_src) > 0,
    'resumen usa fecha_envio_mesa + stage_scope'
  );
  PERFORM public.__p137_ingresos_assert(
    position('bio_aprobacion_at AT TIME ZONE' in v_src) = 0,
    'resumen no filtra proyectado por bio_aprobacion_at'
  );

  -- Trigger 11→12 intacto
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '__tg_ingresos_on_11_12'
  LIMIT 1;
  PERFORM public.__p137_ingresos_assert(
    position('ingresos_reconocer_pago_concasa' in v_src) > 0,
    'trigger 11→12 intacto'
  );

  -- Grants nueva firma
  v_sig := 'public.super_admin_get_ingresos_resumen(date,date,uuid[],text,numeric[],text,smallint,text,text)';
  PERFORM public.__p137_ingresos_assert(
    has_function_privilege('authenticated', v_sig, 'EXECUTE'),
    'grant resumen authenticated (firma P137)'
  );
  v_sig := 'public.super_admin_list_ingresos_page(date,date,uuid[],text,numeric[],text,smallint,text,text,int,int)';
  PERFORM public.__p137_ingresos_assert(
    has_function_privilege('authenticated', v_sig, 'EXECUTE'),
    'grant list authenticated (firma P137)'
  );

  -- Helper bio sigue existiendo (P135)
  PERFORM public.__p137_ingresos_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'ingresos_bio_aprobacion_at'
    ),
    'helper bio conservado'
  );

  RAISE NOTICE 'P137 INGRESOS OK';
END $$;

DROP FUNCTION IF EXISTS public.__p137_ingresos_assert(BOOLEAN, TEXT);
