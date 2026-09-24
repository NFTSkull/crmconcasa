-- Rollback del hotfix 2026-09-24.
-- ADVERTENCIA: restaura 40001 y por tanto reabre el riesgo de retry storm.
-- Usar solo si existe una razon funcional concreta y despues de detener clientes reintentando.

DO $rollback$
DECLARE
  v_proc regprocedure := 'public.mesa_mover_etapa_operativa(uuid,smallint,smallint,text)'::regprocedure;
  v_def text;
  v_new text;
  v_from_1 text := $snippet$
  IF p_etapa_esperada IS NULL OR p_etapa_esperada NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa esperada debe estar entre 1 y 12'
      USING ERRCODE = '22023';
  END IF;$snippet$;
  v_to_1 text := $snippet$
  IF p_etapa_esperada IS NULL OR p_etapa_esperada NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa esperada debe estar entre 1 y 12'
      USING ERRCODE = '40001';
  END IF;$snippet$;
  v_from_2 text := $snippet$
  IF v_exp.etapa_actual <> p_etapa_esperada THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa actual %, esperada %',
      v_exp.etapa_actual, p_etapa_esperada
      USING ERRCODE = '22023';
  END IF;$snippet$;
  v_to_2 text := $snippet$
  IF v_exp.etapa_actual <> p_etapa_esperada THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa actual %, esperada %',
      v_exp.etapa_actual, p_etapa_esperada
      USING ERRCODE = '40001';
  END IF;$snippet$;
BEGIN
  SELECT pg_get_functiondef(v_proc) INTO v_def;

  IF strpos(v_def, v_from_1) = 0 OR strpos(v_def, v_from_2) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK_ABORT: la funcion ya no coincide con el hotfix esperado';
  END IF;

  v_new := replace(v_def, v_from_1, v_to_1);
  v_new := replace(v_new, v_from_2, v_to_2);
  EXECUTE v_new;
END;
$rollback$;

COMMENT ON FUNCTION public.mesa_mover_etapa_operativa(UUID, SMALLINT, SMALLINT, TEXT) IS
  'P074/P204/P211: movimiento manual Mesa. Override P211 (no assert). Trigger setea release sticky en destino >=9.';
