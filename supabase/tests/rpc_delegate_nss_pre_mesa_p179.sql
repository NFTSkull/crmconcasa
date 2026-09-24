-- Test read-only de contrato P179 para alta delegada NSS-only.
DO $test$
DECLARE
  v_create text;
  v_delegate text;
  v_gate text;
  v_index text;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_expediente_for_asesor(uuid,public.programa,text,text,text,text)'::regprocedure
  ) INTO v_create;

  SELECT pg_get_functiondef(
    'public.asesor_preparar_precalificacion_nss_only_para_asesor(uuid,text,text)'::regprocedure
  ) INTO v_delegate;

  SELECT pg_get_functiondef(
    'public.asesor_lookup_nss_precal_gate(text,public.programa)'::regprocedure
  ) INTO v_gate;

  SELECT indexdef INTO v_index
  FROM pg_indexes
  WHERE schemaname='public'
    AND tablename='expedientes'
    AND indexname='expedientes_nss_programa_mesa_enviado_unique';

  IF strpos(v_create, 'AND e.asesor_id = p_asesor_id') = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: create_expediente_for_asesor no limita duplicado al target';
  END IF;

  IF strpos(v_create, 'ya existe un expediente activo con ese NSS y programa') > 0 THEN
    RAISE EXCEPTION 'TEST FAIL: sigue bloqueo global pre-Mesa en create_expediente_for_asesor';
  END IF;

  IF strpos(v_create, 'nss_bloqueado_en_mesa') = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: se perdió bloqueo post-Mesa';
  END IF;

  IF strpos(v_delegate, 'e.asesor_id = p_target_asesor_id') = 0
     OR strpos(v_delegate, 'e.submitted_to_mesa = true') = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: wrapper delegado no distingue target/post-Mesa';
  END IF;

  IF strpos(v_gate, 'AND e.submitted_to_mesa = true') = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: gate canónico P179 ya no bloquea sólo post-Mesa';
  END IF;

  IF v_index IS NULL
     OR position('submitted_to_mesa = true' in lower(v_index)) = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: índice único post-Mesa no coincide';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.create_expediente_for_asesor(uuid,public.programa,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: authenticated perdió create_expediente_for_asesor';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.asesor_preparar_precalificacion_nss_only_para_asesor(uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: authenticated perdió wrapper delegado';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.asesor_preparar_precalificacion_nss_only_para_asesor(uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: anon obtuvo wrapper delegado';
  END IF;
END;
$test$;
