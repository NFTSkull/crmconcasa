-- Test read-only de contrato del hotfix. No mueve expedientes ni requiere datos fixture.
DO $test$
DECLARE
  v_proc regprocedure := 'public.mesa_mover_etapa_operativa(uuid,smallint,smallint,text)'::regprocedure;
  v_def text;
  v_new_invalid_expected text := $snippet$
  IF p_etapa_esperada IS NULL OR p_etapa_esperada NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa esperada debe estar entre 1 y 12'
      USING ERRCODE = '22023';
  END IF;$snippet$;
  v_new_stage_mismatch text := $snippet$
  IF v_exp.etapa_actual <> p_etapa_esperada THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa actual %, esperada %',
      v_exp.etapa_actual, p_etapa_esperada
      USING ERRCODE = '22023';
  END IF;$snippet$;
  v_old_invalid_expected text := $snippet$
  IF p_etapa_esperada IS NULL OR p_etapa_esperada NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa esperada debe estar entre 1 y 12'
      USING ERRCODE = '40001';
  END IF;$snippet$;
  v_old_stage_mismatch text := $snippet$
  IF v_exp.etapa_actual <> p_etapa_esperada THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa actual %, esperada %',
      v_exp.etapa_actual, p_etapa_esperada
      USING ERRCODE = '40001';
  END IF;$snippet$;
BEGIN
  SELECT pg_get_functiondef(v_proc) INTO v_def;

  IF strpos(v_def, v_old_invalid_expected) > 0 OR strpos(v_def, v_old_stage_mismatch) > 0 THEN
    RAISE EXCEPTION 'TEST FAIL: MESA_MOVE_STAGE_CONFLICT aun usa 40001';
  END IF;

  IF strpos(v_def, v_new_invalid_expected) = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: etapa esperada no usa 22023';
  END IF;

  IF strpos(v_def, v_new_stage_mismatch) = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: mismatch de etapa no usa 22023';
  END IF;

  IF NOT has_function_privilege('authenticated', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: authenticated sin EXECUTE';
  END IF;

  IF NOT has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: service_role sin EXECUTE';
  END IF;

  IF has_function_privilege('anon', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon tiene EXECUTE';
  END IF;

  RAISE NOTICE 'PASS: mesa_mover_etapa_operativa conflict hotfix contract OK';
END;
$test$;
