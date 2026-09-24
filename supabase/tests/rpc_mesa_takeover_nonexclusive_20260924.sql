-- Test de contrato P: mesa_take_expediente no exclusivo.
-- Read-only: sólo inspecciona definición y permisos.
DO $test$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.mesa_take_expediente(uuid)'::regprocedure)
  INTO v_def;

  IF strpos(v_def, 'shared_account_nonexclusive') = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: falta regla mesa98 compartida';
  END IF;

  IF strpos(v_def, 'takeover') = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: falta auditoría de takeover';
  END IF;

  IF strpos(v_def, 'expediente asignado a otro operador') > 0 THEN
    RAISE EXCEPTION 'TEST FAIL: sigue presente bloqueo exclusivo anterior';
  END IF;

  IF strpos(v_def, 'ensure_mesa_expediente_ops_row') = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: se perdió lock de ownership';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.mesa_take_expediente(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: authenticated perdió EXECUTE';
  END IF;

  IF has_function_privilege('anon', 'public.mesa_take_expediente(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon obtuvo EXECUTE';
  END IF;
END;
$test$;
