-- ConCasa CRM — P130 fix: lotes vacíos + hook register_expediente_documento
-- Contratos estructurales (sin fixtures destructivos en Cloud).

CREATE OR REPLACE FUNCTION public.__p130e_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P130-empty FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_freeze TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_freeze
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_cambio_freeze_lote'
  LIMIT 1;
  PERFORM public.__p130e_assert(v_freeze IS NOT NULL, 'freeze_lote existe');
  PERFORM public.__p130e_assert(
    position('expediente_asesor_cambios' in v_freeze) > 0
    AND position('borrador' in v_freeze) > 0,
    'freeze_lote no congela vacío / borra borrador'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'register_expediente_documento_pre_reingreso'
  LIMIT 1;
  PERFORM public.__p130e_assert(v_src IS NOT NULL, 'pre_reingreso existe');
  PERFORM public.__p130e_assert(
    position('asesor_cambio_record_doc_reemplazo' in v_src) > 0,
    'pre_reingreso hook P130 doc_reemplazo'
  );
  PERFORM public.__p130e_assert(
    position('submitted_to_mesa' in v_src) > 0,
    'pre_reingreso condiciona post-Mesa'
  );

  -- Wrapper sigue delegando a pre_reingreso (ruta normal)
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'register_expediente_documento'
  LIMIT 1;
  PERFORM public.__p130e_assert(v_src IS NOT NULL, 'register wrapper existe');
  PERFORM public.__p130e_assert(
    position('register_expediente_documento_pre_reingreso' in v_src) > 0,
    'wrapper llama pre_reingreso'
  );

  -- Regresión: correccion documental sigue con helper
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'register_expediente_documento_correccion'
  LIMIT 1;
  PERFORM public.__p130e_assert(
    position('asesor_cambio_record_doc_reemplazo' in v_src) > 0,
    'correccion sigue registrando lote'
  );

  RAISE NOTICE 'P130-empty OK: freeze vacío + hook register_documento';
END;
$$;

DROP FUNCTION IF EXISTS public.__p130e_assert(BOOLEAN, TEXT);
