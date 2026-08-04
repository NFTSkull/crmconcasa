-- ConCasa CRM — P155 re-precalificar NSS propio en Mesa
-- Uso: psql -f supabase/tests/rpc_asesor_reprecalificar_nss_propio_mesa.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p155_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P155 TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p155_set_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p155_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p155_cleanup(p_nss TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_nss TEXT := public.normalize_nss_mexico(p_nss);
BEGIN
  DELETE FROM public.expediente_precalificacion_intentos i
  USING public.expedientes e
  WHERE i.expediente_id = e.id AND e.nss = v_nss;
  UPDATE public.expedientes e
  SET reprecalificacion_pendiente_id = NULL
  WHERE e.nss = v_nss;
  DELETE FROM public.cliente_datos cd
  USING public.expedientes e
  WHERE cd.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.editor_decisions ed
  USING public.expedientes e
  WHERE ed.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expediente_documentos d
  USING public.expedientes e
  WHERE d.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.action_log a
  USING public.expedientes e
  WHERE a.entity_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expedientes e WHERE e.nss = v_nss;
END; $$;

DO $$
DECLARE
  v_org UUID;
  v_asesor_a UUID;
  v_asesor_b UUID;
  v_editor UUID;
  v_nss TEXT := '99115500001';
  v_nss2 TEXT := '99115500002';
  v_exp UUID;
  v_exp2 UUID;
  v_gate JSONB;
  v_ini JSONB;
  v_ini2 JSONB;
  v_res JSONB;
  v_intento UUID;
  v_prev_monto NUMERIC;
  v_etapa INT;
  v_count_exp INT;
  v_count_intentos INT;
  v_count_vigente INT;
  v_ed_decision public.editor_decision;
  v_ed_monto NUMERIC;
  v_anon_ok BOOLEAN;
BEGIN
  -- Preferir seed local; si no, perfiles reales activos
  SELECT p.id, p.organization_id INTO v_asesor_a, v_org
  FROM public.profiles p
  WHERE p.active AND (p.id = '00000000-0000-4000-8001-000000000001' OR p.app_role = 'asesor')
  ORDER BY CASE WHEN p.id = '00000000-0000-4000-8001-000000000001' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT p.id INTO v_asesor_b
  FROM public.profiles p
  WHERE p.active
    AND p.id IS DISTINCT FROM v_asesor_a
    AND (p.id = '00000000-0000-4000-8001-000000000002' OR p.app_role = 'asesor')
  ORDER BY CASE WHEN p.id = '00000000-0000-4000-8001-000000000002' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT p.id INTO v_editor
  FROM public.profiles p
  WHERE p.active
    AND (p.id = '00000000-0000-4000-8002-000000000001' OR p.app_role IN ('editor', 'super_admin'))
  ORDER BY CASE
    WHEN p.id = '00000000-0000-4000-8002-000000000001' THEN 0
    WHEN p.app_role = 'editor' THEN 1
    ELSE 2
  END
  LIMIT 1;

  PERFORM public.__p155_assert(
    v_asesor_a IS NOT NULL AND v_asesor_b IS NOT NULL AND v_editor IS NOT NULL AND v_org IS NOT NULL,
    'faltan perfiles asesor/editor para P155'
  );

  PERFORM public.__p155_cleanup(v_nss);
  PERFORM public.__p155_cleanup(v_nss2);

  -- Grants estructurales
  PERFORM public.__p155_assert(
    has_function_privilege('anon', 'public.asesor_lookup_nss_precal_gate(text, public.programa)', 'EXECUTE') = false,
    'anon sin lookup'
  );
  PERFORM public.__p155_assert(
    has_function_privilege('anon', 'public.asesor_iniciar_reprecalificacion(text, public.programa, text, text, text, text)', 'EXECUTE') = false,
    'anon sin iniciar'
  );
  PERFORM public.__p155_assert(
    has_function_privilege('authenticated', 'public.asesor_lookup_nss_precal_gate(text, public.programa)', 'EXECUTE'),
    'authenticated con lookup'
  );

  -- Crear expediente A + mesa
  PERFORM public.__p155_set_auth(v_asesor_a);
  SELECT public.create_expediente('mejoravit', v_nss, 'Cliente P155', '5512345678', '') INTO v_res;
  v_exp := (v_res->>'id')::UUID;
  PERFORM public.__p155_reset_auth();

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar)
  VALUES (v_exp, v_org, 'aprobado', 20000, now(), 20000)
  ON CONFLICT (expediente_id) DO UPDATE
  SET decision = 'aprobado', monto_aprobado = 20000, aprobado_at = now(), monto_aprobado_al_aprobar = 20000;

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    v_exp, v_org, '{"nombreCliente":"Cliente P155"}'::jsonb, 'completo', 10, 2000, 'transferencia'
  ) ON CONFLICT (expediente_id) DO NOTHING;

  UPDATE public.expedientes
  SET submitted_to_mesa = true, fecha_envio_mesa = now(), subestado = 'en_validacion_mesa', etapa_actual = 1
  WHERE id = v_exp;

  SELECT etapa_actual, monto_aprobado INTO v_etapa, v_prev_monto
  FROM public.expedientes e
  JOIN public.editor_decisions ed ON ed.expediente_id = e.id
  WHERE e.id = v_exp;

  -- 1) mismo asesor → reprecal_own_mesa
  PERFORM public.__p155_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p155_assert(v_gate->>'status' = 'reprecal_own_mesa', 'gate own mesa');
  PERFORM public.__p155_assert((v_gate->>'expediente_id')::UUID = v_exp, 'mismo expediente_id');

  -- 2) otro asesor → blocked
  PERFORM public.__p155_set_auth(v_asesor_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p155_assert(v_gate->>'status' = 'blocked_other_asesor', 'gate other asesor');
  BEGIN
    PERFORM public.asesor_iniciar_reprecalificacion(v_nss, 'mejoravit', 'X', '5511111111', '', 'k-b');
    PERFORM public.__p155_assert(false, 'asesor B no debe iniciar');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p155_assert(position('otro asesor' IN SQLERRM) > 0, 'error otro asesor');
  END;

  -- 10) programa distinto
  PERFORM public.__p155_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'compro_tu_casa');
  PERFORM public.__p155_assert(v_gate->>'status' = 'blocked_programa_mismatch', 'programa mismatch');

  -- 3-5) iniciar reprecal: mismo id, nuevo intento, sin segundo expediente
  v_ini := public.asesor_iniciar_reprecalificacion(
    v_nss, 'mejoravit', 'Cliente P155 Re', '5512345678', 'Calle 1', 'idem-p155-1'
  );
  PERFORM public.__p155_assert((v_ini->>'expediente_id')::UUID = v_exp, 'iniciar mismo exp');
  v_intento := (v_ini->>'intento_id')::UUID;
  PERFORM public.__p155_assert(v_ini->>'status' = 'reprecal_pending', 'status pending');

  -- 13) idempotencia misma key
  v_ini2 := public.asesor_iniciar_reprecalificacion(
    v_nss, 'mejoravit', 'Cliente P155 Re', '5512345678', 'Calle 1', 'idem-p155-1'
  );
  PERFORM public.__p155_assert((v_ini2->>'intento_id')::UUID = v_intento, 'idempotent intento');
  PERFORM public.__p155_assert(COALESCE((v_ini2->>'idempotent')::BOOLEAN, false) = true, 'idempotent flag');

  SELECT count(*) INTO v_count_exp FROM public.expedientes WHERE nss = v_nss AND deleted_at IS NULL;
  PERFORM public.__p155_assert(v_count_exp = 1, 'un solo expediente NSS');

  SELECT count(*) INTO v_count_intentos
  FROM public.expediente_precalificacion_intentos WHERE expediente_id = v_exp;
  PERFORM public.__p155_assert(v_count_intentos >= 1, 'hay intentos');

  -- etapa intacta
  PERFORM public.__p155_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp) = v_etapa,
    'etapa no cambia al iniciar'
  );
  PERFORM public.__p155_assert(
    (SELECT decision FROM public.editor_decisions WHERE expediente_id = v_exp) = 'aprobado',
    'decision vigente intacta al iniciar'
  );

  -- 6-8) editor aprueba → vigente nueva; anterior en historial
  PERFORM public.__p155_set_auth(v_editor);
  v_res := public.upsert_editor_decision(v_exp, 'aprobado', 25000, 'reprecal ok');
  PERFORM public.__p155_assert(v_res->>'decision' = 'aprobado' OR v_res->>'ok' = 'true', 'resolver ok');

  SELECT decision, monto_aprobado INTO v_ed_decision, v_ed_monto
  FROM public.editor_decisions WHERE expediente_id = v_exp;
  PERFORM public.__p155_assert(v_ed_decision = 'aprobado', 'ed aprobado');
  PERFORM public.__p155_assert(v_ed_monto = 25000, 'monto actualizado');
  PERFORM public.__p155_assert(
    (SELECT reprecalificacion_pendiente_id FROM public.expedientes WHERE id = v_exp) IS NULL,
    'pendiente limpio'
  );
  SELECT count(*) INTO v_count_vigente
  FROM public.expediente_precalificacion_intentos
  WHERE expediente_id = v_exp AND es_vigente = true;
  PERFORM public.__p155_assert(v_count_vigente = 1, 'una vigente');
  PERFORM public.__p155_assert(
    (SELECT decision FROM public.expediente_precalificacion_intentos WHERE id = v_intento) = 'aprobado',
    'intento aprobado'
  );
  PERFORM public.__p155_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp) = v_etapa,
    'etapa intacta post-aprobacion'
  );

  -- 9) no_cumple no destruye vigente
  PERFORM public.__p155_set_auth(v_asesor_a);
  v_ini := public.asesor_iniciar_reprecalificacion(
    v_nss, 'mejoravit', 'Cliente P155 Re2', '5512345678', '', 'idem-p155-2'
  );
  v_intento := (v_ini->>'intento_id')::UUID;
  PERFORM public.__p155_set_auth(v_editor);
  v_res := public.upsert_editor_decision(v_exp, 'no_cumple', NULL, 'no pasa');
  SELECT decision, monto_aprobado INTO v_ed_decision, v_ed_monto
  FROM public.editor_decisions WHERE expediente_id = v_exp;
  PERFORM public.__p155_assert(v_ed_decision = 'aprobado', 'vigente se conserva');
  PERFORM public.__p155_assert(v_ed_monto = 25000, 'monto previo se conserva');
  PERFORM public.__p155_assert(
    (SELECT decision FROM public.expediente_precalificacion_intentos WHERE id = v_intento) = 'no_cumple',
    'intento no_cumple en historial'
  );

  -- 11) ambiguo: segundo expediente en Mesa mismo NSS (otro programa)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor_a, 'compro_tu_casa', v_nss, 'Dup', '5599999999',
    true, now(), 1, 'en_validacion_mesa', 'activo'
  ) RETURNING id INTO v_exp2;

  PERFORM public.__p155_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p155_assert(v_gate->>'status' = 'blocked_ambiguous', 'ambiguous');

  -- limpiar dup
  DELETE FROM public.expedientes WHERE id = v_exp2;

  -- 12) eliminado no se reutiliza
  UPDATE public.expedientes SET deleted_at = now() WHERE id = v_exp;
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p155_assert(v_gate->>'status' = 'ok_create', 'deleted → ok_create');
  UPDATE public.expedientes SET deleted_at = NULL WHERE id = v_exp;

  -- 17) anon
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_anon_ok := false;
  BEGIN
    PERFORM public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
    v_anon_ok := true;
  EXCEPTION WHEN OTHERS THEN
    v_anon_ok := false;
  END;
  PERFORM public.__p155_assert(v_anon_ok = false, 'anon bloqueado');
  PERFORM public.__p155_reset_auth();

  PERFORM public.__p155_cleanup(v_nss);
  PERFORM public.__p155_cleanup(v_nss2);

  RAISE NOTICE 'P155 OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p155_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p155_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p155_reset_auth();
DROP FUNCTION IF EXISTS public.__p155_cleanup(TEXT);
