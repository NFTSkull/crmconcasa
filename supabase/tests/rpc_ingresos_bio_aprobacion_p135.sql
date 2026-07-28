-- ConCasa CRM — P135: bio_aprobacion_at reconoce mesa.mover_etapa 3|4|5→>=6
-- Uso Cloud: npx supabase db query --linked -f supabase/tests/rpc_ingresos_bio_aprobacion_p135.sql
-- Solo SELECT / asserts estructurales + evaluación del helper (sin mutar operativos).

CREATE OR REPLACE FUNCTION public.__p135_ingresos_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P135 INGRESOS FAIL: %', p_msg; END IF; END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_bio TIMESTAMPTZ;
  -- Casos auditados Paty (solo lectura)
  v_leo UUID := '47e826ac-d2a2-4c22-993b-f52c2fb1dbf4';
  v_mil UUID := '53b70e1a-c091-483f-a300-112314df0c01';
  v_oma UUID := '26403e63-41e4-4177-906f-5240601556bc';
  v_nat UUID := '8543860a-085f-40cb-a163-fc26050b3494';
  v_flor UUID := '86f21d4f-4432-4385-ba48-eaeb4650b587'; -- 5_6 canónico
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ingresos_bio_aprobacion_at'
  LIMIT 1;

  PERFORM public.__p135_ingresos_assert(v_src IS NOT NULL, 'fn ingresos_bio_aprobacion_at');
  PERFORM public.__p135_ingresos_assert(
    position('5_8' in v_src) > 0 AND position('5_6' in v_src) > 0 AND position('5_7' in v_src) > 0,
    'conserva evidencias 5_8/5_6/5_7'
  );
  PERFORM public.__p135_ingresos_assert(
    position('expediente_paso_visual_transiciones' in v_src) > 0,
    'conserva P114'
  );
  PERFORM public.__p135_ingresos_assert(
    position('mesa.expediente.mover_etapa' in v_src) > 0,
    'reconoce mesa.expediente.mover_etapa'
  );
  PERFORM public.__p135_ingresos_assert(
    position('IN (3, 4, 5)' in v_src) > 0 OR position('IN (3,4,5)' in v_src) > 0,
    'etapa_anterior 3|4|5'
  );
  PERFORM public.__p135_ingresos_assert(
    position('>= 6' in v_src) > 0,
    'etapa_nueva >= 6'
  );

  -- mesa.expediente.mover_etapa operativa intacta (no reemplazada por P135)
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_mover_etapa_operativa'
  LIMIT 1;
  PERFORM public.__p135_ingresos_assert(
    v_src IS NOT NULL AND position('mesa.expediente.mover_etapa' in v_src) > 0,
    'RPC operativa mesa_mover_etapa_operativa intacta'
  );

  -- Fórmula económica intacta
  PERFORM public.__p135_ingresos_assert(
    public.ingresos_calc_ingreso(160000, 17) = 27200,
    'fórmula 160k×17%'
  );
  PERFORM public.__p135_ingresos_assert(
    public.ingresos_calc_ingreso(200000, 10) = 20000,
    'sin tope 169k'
  );

  -- Casos canónicos / Mesa auditados (Cloud)
  IF EXISTS (SELECT 1 FROM public.expedientes WHERE id = v_flor) THEN
    v_bio := public.ingresos_bio_aprobacion_at(v_flor);
    PERFORM public.__p135_ingresos_assert(v_bio IS NOT NULL, 'Flor 5_6 sigue entrando');
  END IF;

  IF EXISTS (SELECT 1 FROM public.expedientes WHERE id = v_leo) THEN
    v_bio := public.ingresos_bio_aprobacion_at(v_leo);
    PERFORM public.__p135_ingresos_assert(v_bio IS NOT NULL, 'LEOBARDO 3→8 reconocido');
  END IF;
  IF EXISTS (SELECT 1 FROM public.expedientes WHERE id = v_mil) THEN
    v_bio := public.ingresos_bio_aprobacion_at(v_mil);
    PERFORM public.__p135_ingresos_assert(v_bio IS NOT NULL, 'MILTON 3→8 reconocido');
  END IF;
  IF EXISTS (SELECT 1 FROM public.expedientes WHERE id = v_oma) THEN
    v_bio := public.ingresos_bio_aprobacion_at(v_oma);
    PERFORM public.__p135_ingresos_assert(v_bio IS NOT NULL, 'OMAR 4→8 reconocido');
  END IF;
  IF EXISTS (SELECT 1 FROM public.expedientes WHERE id = v_nat) THEN
    v_bio := public.ingresos_bio_aprobacion_at(v_nat);
    PERFORM public.__p135_ingresos_assert(v_bio IS NOT NULL, 'NATIVIDAD 4→8 reconocido');
  END IF;

  RAISE NOTICE 'P135 INGRESOS BIO OK';
END $$;

DROP FUNCTION IF EXISTS public.__p135_ingresos_assert(BOOLEAN, TEXT);
