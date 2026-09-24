-- ConCasa CRM - hotfix mesa_mover_etapa_operativa conflict storm
-- Objetivo: MESA_MOVE_STAGE_CONFLICT es conflicto funcional, no serialization failure.
-- Cambio quirurgico: solo ERRCODE 40001 -> 22023 en los dos RAISE de stage conflict.
-- No cambia firma, ACL, SECURITY DEFINER, search_path, validaciones, UPDATEs ni auditoria.

DO $hotfix$
DECLARE
  v_proc regprocedure := 'public.mesa_mover_etapa_operativa(uuid,smallint,smallint,text)'::regprocedure;
  v_def text;
  v_new text;
  v_old_invalid_expected text := $snippet$
  IF p_etapa_esperada IS NULL OR p_etapa_esperada NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa esperada debe estar entre 1 y 12'
      USING ERRCODE = '40001';
  END IF;$snippet$;
  v_new_invalid_expected text := $snippet$
  IF p_etapa_esperada IS NULL OR p_etapa_esperada NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa esperada debe estar entre 1 y 12'
      USING ERRCODE = '22023';
  END IF;$snippet$;
  v_old_stage_mismatch text := $snippet$
  IF v_exp.etapa_actual <> p_etapa_esperada THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa actual %, esperada %',
      v_exp.etapa_actual, p_etapa_esperada
      USING ERRCODE = '40001';
  END IF;$snippet$;
  v_new_stage_mismatch text := $snippet$
  IF v_exp.etapa_actual <> p_etapa_esperada THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa actual %, esperada %',
      v_exp.etapa_actual, p_etapa_esperada
      USING ERRCODE = '22023';
  END IF;$snippet$;
BEGIN
  SELECT pg_get_functiondef(v_proc) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: mesa_mover_etapa_operativa no existe';
  END IF;

  IF strpos(v_def, v_old_invalid_expected) = 0 THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: bloque etapa_esperada invalida no coincide con baseline esperado';
  END IF;

  IF strpos(v_def, v_old_stage_mismatch) = 0 THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: bloque etapa actual vs esperada no coincide con baseline esperado';
  END IF;

  IF strpos(v_def, v_new_invalid_expected) > 0 OR strpos(v_def, v_new_stage_mismatch) > 0 THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: funcion parcialmente corregida; requiere auditoria manual';
  END IF;

  v_new := replace(v_def, v_old_invalid_expected, v_new_invalid_expected);
  v_new := replace(v_new, v_old_stage_mismatch, v_new_stage_mismatch);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: no se produjo ningun cambio';
  END IF;

  IF strpos(v_new, v_old_invalid_expected) > 0 OR strpos(v_new, v_old_stage_mismatch) > 0 THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: quedaron bloques 40001 sin reemplazar';
  END IF;

  EXECUTE v_new;

  SELECT pg_get_functiondef(v_proc) INTO v_def;

  IF strpos(v_def, v_new_invalid_expected) = 0 OR strpos(v_def, v_new_stage_mismatch) = 0 THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: postcondicion de ERRCODE no cumplida';
  END IF;

  IF NOT has_function_privilege('authenticated', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: authenticated perdio EXECUTE';
  END IF;

  IF NOT has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: service_role perdio EXECUTE';
  END IF;

  IF has_function_privilege('anon', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'HOTFIX_ABORT: anon obtuvo EXECUTE inesperadamente';
  END IF;
END;
$hotfix$;

COMMENT ON FUNCTION public.mesa_mover_etapa_operativa(UUID, SMALLINT, SMALLINT, TEXT) IS
  'P074/P204/P211 + hotfix 2026-09-24: movimiento manual Mesa; MESA_MOVE_STAGE_CONFLICT usa 22023 no-retryable en vez de 40001 serialization failure.';
