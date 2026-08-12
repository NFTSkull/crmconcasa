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
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nss TEXT := public.normalize_nss_mexico(p_nss);
BEGIN
  UPDATE public.expedientes e
  SET reprecalificacion_pendiente_id = NULL
  WHERE e.nss = v_nss;
  DELETE FROM public.expediente_precalificacion_intentos i
  USING public.expedientes e
  WHERE i.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.cliente_datos cd
  USING public.expedientes e
  WHERE cd.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.editor_decisions ed
  USING public.expedientes e
  WHERE ed.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expediente_documentos d
  USING public.expedientes e
  WHERE d.expediente_id = e.id AND e.nss = v_nss;
  IF to_regclass('public.expediente_paso_visual_transiciones') IS NOT NULL THEN
    DELETE FROM public.expediente_paso_visual_transiciones t
    USING public.expedientes e
    WHERE t.expediente_id = e.id AND e.nss = v_nss;
  END IF;
  DELETE FROM public.action_log a
  USING public.expedientes e
  WHERE a.entity_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expedientes e WHERE e.nss = v_nss;
END; $$;

CREATE OR REPLACE FUNCTION public.__p155_insert_mesa_dup(
  p_org UUID, p_asesor UUID, p_nss TEXT, p_programa public.programa
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    gen_random_uuid(), p_org, p_asesor, p_programa, public.normalize_nss_mexico(p_nss),
    'Dup P155', '5599999999',
    'interno', true, now(), 1, 'en_validacion_mesa', 'activo'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.__p155_mark_deleted(p_exp UUID, p_deleted BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_deleted THEN
    UPDATE public.expedientes SET deleted_at = now() WHERE id = p_exp;
  ELSE
    UPDATE public.expedientes SET deleted_at = NULL WHERE id = p_exp;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p155_hard_delete_exp(p_exp UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.expedientes SET reprecalificacion_pendiente_id = NULL WHERE id = p_exp;
  DELETE FROM public.expediente_precalificacion_intentos WHERE expediente_id = p_exp;
  DELETE FROM public.cliente_datos WHERE expediente_id = p_exp;
  DELETE FROM public.editor_decisions WHERE expediente_id = p_exp;
  DELETE FROM public.expediente_documentos WHERE expediente_id = p_exp;
  DELETE FROM public.action_log WHERE entity_id = p_exp;
  DELETE FROM public.expedientes WHERE id = p_exp;
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

  -- 10) programa distinto → P164: reprecal_change_programa (mismo expediente)
  PERFORM public.__p155_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'compro_tu_casa');
  PERFORM public.__p155_assert(v_gate->>'status' = 'reprecal_change_programa', 'change programa gate');
  PERFORM public.__p155_assert((v_gate->>'expediente_id')::UUID = v_exp, 'change mismo expediente_id');
  PERFORM public.__p155_assert(v_gate->>'programa_actual' = 'mejoravit', 'programa_actual vigente');
  PERFORM public.__p155_assert(v_gate->>'programa_solicitado' = 'compro_tu_casa', 'programa_solicitado');
  PERFORM public.__p155_assert(COALESCE((v_gate->>'cambio_programa')::BOOLEAN, false) = true, 'cambio_programa true');

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
  v_exp2 := public.__p155_insert_mesa_dup(v_org, v_asesor_a, v_nss, 'compro_tu_casa');

  PERFORM public.__p155_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p155_assert(v_gate->>'status' = 'blocked_ambiguous', 'ambiguous');

  -- limpiar dup (soft-delete: evita FK de transiciones/agenda)
  PERFORM public.__p155_mark_deleted(v_exp2, true);

  -- 12) eliminado no se reutiliza
  PERFORM public.__p155_mark_deleted(v_exp, true);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p155_assert(v_gate->>'status' = 'ok_create', 'deleted → ok_create');
  PERFORM public.__p155_mark_deleted(v_exp, false);

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

  -- =========================================================================
  -- P164 — cambio de programa (mismo flujo / mismo expediente)
  -- =========================================================================
  DECLARE
    v_nss3 TEXT := '99115500003';
    v_nss4 TEXT := '99115500004';
    v_nss5 TEXT := '99115500005';
    v_exp3 UUID;
    v_exp4 UUID;
    v_exp5 UUID;
    v_intento_chg UUID;
    v_intento_reuse UUID;
    v_count_pend INT;
    v_kpi_monto NUMERIC;
    v_kpi_at TIMESTAMPTZ;
    v_prog public.programa;
    v_log_count INT;
    v_etapa3 INT;
  BEGIN
    PERFORM public.__p155_cleanup(v_nss3);
    PERFORM public.__p155_cleanup(v_nss4);
    PERFORM public.__p155_cleanup(v_nss5);

    -- Setup Mejoravit aprobado 150000 en Mesa
    PERFORM public.__p155_set_auth(v_asesor_a);
    SELECT public.create_expediente('mejoravit', v_nss3, 'Cliente P164', '5512345678', '') INTO v_res;
    v_exp3 := (v_res->>'id')::UUID;
    PERFORM public.__p155_reset_auth();

    INSERT INTO public.editor_decisions (
      expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar
    ) VALUES (v_exp3, v_org, 'aprobado', 150000, now() - interval '1 day', 150000)
    ON CONFLICT (expediente_id) DO UPDATE
    SET decision = 'aprobado',
        monto_aprobado = 150000,
        aprobado_at = EXCLUDED.aprobado_at,
        monto_aprobado_al_aprobar = 150000;

    UPDATE public.expedientes
    SET submitted_to_mesa = true, fecha_envio_mesa = now(),
        subestado = 'en_validacion_mesa', etapa_actual = 3
    WHERE id = v_exp3;

    SELECT etapa_actual INTO v_etapa3
    FROM public.expedientes WHERE id = v_exp3;
    SELECT monto_aprobado_al_aprobar, aprobado_at
    INTO v_kpi_monto, v_kpi_at
    FROM public.editor_decisions WHERE expediente_id = v_exp3;

    -- 1 SAME PROGRAM regression gate
    PERFORM public.__p155_set_auth(v_asesor_a);
    v_gate := public.asesor_lookup_nss_precal_gate(v_nss3, 'mejoravit');
    PERFORM public.__p155_assert(v_gate->>'status' = 'reprecal_own_mesa', 'P164 same program gate');

    -- 2–3 CHANGE PROGRAM GATE + NO SECOND EXPEDIENTE
    v_gate := public.asesor_lookup_nss_precal_gate(v_nss3, 'compro_tu_casa');
    PERFORM public.__p155_assert(v_gate->>'status' = 'reprecal_change_programa', 'P164 change gate');
    PERFORM public.__p155_assert((v_gate->>'expediente_id')::UUID = v_exp3, 'P164 same exp id');

    SELECT count(*) INTO v_count_exp FROM public.expedientes WHERE nss = v_nss3 AND deleted_at IS NULL;
    v_ini := public.asesor_iniciar_reprecalificacion(
      v_nss3, 'compro_tu_casa', 'Cliente P164 Chg', '5512345678', '', 'idem-p164-1'
    );
    v_intento_chg := (v_ini->>'intento_id')::UUID;
    PERFORM public.__p155_assert(COALESCE((v_ini->>'cambio_programa')::BOOLEAN, false) = true, 'P164 iniciar cambio');
    SELECT count(*) INTO v_count_exp FROM public.expedientes WHERE nss = v_nss3 AND deleted_at IS NULL;
    PERFORM public.__p155_assert(v_count_exp = 1, 'P164 no second expediente');

    -- 4–6 PENDING no muta vigentes; intento guarda solicitado
    SELECT programa INTO v_prog FROM public.expedientes WHERE id = v_exp3;
    PERFORM public.__p155_assert(v_prog = 'mejoravit', 'P164 pending programa intacto');
    SELECT monto_aprobado INTO v_ed_monto FROM public.editor_decisions WHERE expediente_id = v_exp3;
    PERFORM public.__p155_assert(v_ed_monto = 150000, 'P164 pending monto intacto');
    PERFORM public.__p155_assert(
      (SELECT programa FROM public.expediente_precalificacion_intentos WHERE id = v_intento_chg) = 'mejoravit',
      'P164 intento.programa = vigente'
    );
    PERFORM public.__p155_assert(
      (SELECT programa_solicitado FROM public.expediente_precalificacion_intentos WHERE id = v_intento_chg)
        = 'compro_tu_casa',
      'P164 intento.programa_solicitado'
    );
    PERFORM public.__p155_assert(
      (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp3) = v_etapa3,
      'P164 etapa inmutable al iniciar'
    );

    -- 7 IDEMPOTENCY misma key
    v_ini2 := public.asesor_iniciar_reprecalificacion(
      v_nss3, 'compro_tu_casa', 'Cliente P164 Chg', '5512345678', '', 'idem-p164-1'
    );
    PERFORM public.__p155_assert((v_ini2->>'intento_id')::UUID = v_intento_chg, 'P164 idempotent intento');

    -- 8 EXISTING PENDING + CHANGE REQUEST (otra key) → mismo intento, actualiza solicitado
    -- primero pendiente con mejoravit via nueva key tras limpiar? Ya hay pendiente compro.
    -- Solicitar de nuevo con key distinta pero mismo pending pointer → reusa
    v_ini2 := public.asesor_iniciar_reprecalificacion(
      v_nss3, 'mejoravit', 'Cliente P164 Flip', '5512345678', '', 'idem-p164-flip'
    );
    v_intento_reuse := (v_ini2->>'intento_id')::UUID;
    PERFORM public.__p155_assert(v_intento_reuse = v_intento_chg, 'P164 reuse same intento_id');
    PERFORM public.__p155_assert(
      (SELECT programa_solicitado FROM public.expediente_precalificacion_intentos WHERE id = v_intento_chg)
        = 'mejoravit',
      'P164 pending programa_solicitado updated'
    );
    SELECT count(*) INTO v_count_pend
    FROM public.expediente_precalificacion_intentos
    WHERE expediente_id = v_exp3 AND decision = 'pendiente';
    PERFORM public.__p155_assert(v_count_pend = 1, 'P164 one pending after flip');

    -- Volver a solicitar compro sobre el mismo pendiente
    v_ini2 := public.asesor_iniciar_reprecalificacion(
      v_nss3, 'compro_tu_casa', 'Cliente P164 Chg2', '5512345678', '', 'idem-p164-2'
    );
    PERFORM public.__p155_assert((v_ini2->>'intento_id')::UUID = v_intento_chg, 'P164 still same intento');
    PERFORM public.__p155_assert(
      (SELECT programa_solicitado FROM public.expediente_precalificacion_intentos WHERE id = v_intento_chg)
        = 'compro_tu_casa',
      'P164 solicitado restaurado a compro'
    );

    -- 20 CONCURRENCY/ONE PENDING: segunda key distinta no crea 2º pendiente
    SELECT count(*) INTO v_count_pend
    FROM public.expediente_precalificacion_intentos
    WHERE expediente_id = v_exp3 AND decision = 'pendiente';
    PERFORM public.__p155_assert(v_count_pend = 1, 'P164 concurrency one pending');
    PERFORM public.__p155_assert(
      (SELECT reprecalificacion_pendiente_id FROM public.expedientes WHERE id = v_exp3) = v_intento_chg,
      'P164 pointer estable'
    );

    -- 19 ACTION LOG iniciar (lectura como postgres: RLS action_log restringe asesores)
    PERFORM public.__p155_reset_auth();
    SELECT count(*) INTO v_log_count
    FROM public.action_log
    WHERE entity_id = v_exp3 AND action = 'asesor.reprecalificacion.iniciar';
    PERFORM public.__p155_assert(v_log_count >= 1, 'P164 action_log iniciar');

    -- 9 APPROVE CHANGE PROGRAM
    PERFORM public.__p155_set_auth(v_editor);
    v_res := public.upsert_editor_decision(v_exp3, 'aprobado', 180000, 'cambio ok');
    SELECT programa INTO v_prog FROM public.expedientes WHERE id = v_exp3;
    PERFORM public.__p155_assert(v_prog = 'compro_tu_casa', 'P164 programa aplicado');
    SELECT decision, monto_aprobado
    INTO v_ed_decision, v_ed_monto
    FROM public.editor_decisions WHERE expediente_id = v_exp3;
    PERFORM public.__p155_assert(v_ed_decision = 'aprobado', 'P164 ed aprobado');
    PERFORM public.__p155_assert(v_ed_monto = 180000, 'P164 monto nuevo');
    -- 18 SNAPSHOTS KPI: conserva primera aprobación
    PERFORM public.__p155_assert(
      (SELECT monto_aprobado_al_aprobar FROM public.editor_decisions WHERE expediente_id = v_exp3) = v_kpi_monto,
      'P164 KPI monto_al_aprobar intacto'
    );
    PERFORM public.__p155_assert(
      (SELECT aprobado_at FROM public.editor_decisions WHERE expediente_id = v_exp3) = v_kpi_at,
      'P164 KPI aprobado_at intacto'
    );
    PERFORM public.__p155_assert(
      (SELECT reprecalificacion_pendiente_id FROM public.expedientes WHERE id = v_exp3) IS NULL,
      'P164 pending null post approve'
    );
    PERFORM public.__p155_assert(
      (SELECT decision FROM public.expediente_precalificacion_intentos WHERE id = v_intento_chg) = 'aprobado',
      'P164 intento aprobado'
    );
    PERFORM public.__p155_assert(
      (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp3) = v_etapa3,
      'P164 etapa inmutable post approve'
    );
    PERFORM public.__p155_reset_auth();
    SELECT count(*) INTO v_log_count
    FROM public.action_log
    WHERE entity_id = v_exp3 AND action = 'editor.reprecalificacion.aprobar';
    PERFORM public.__p155_assert(v_log_count >= 1, 'P164 action_log aprobar');

    -- 10 NO_CUMPLE CHANGE PROGRAM
    PERFORM public.__p155_set_auth(v_asesor_a);
    v_ini := public.asesor_iniciar_reprecalificacion(
      v_nss3, 'mejoravit', 'Cliente P164 NC', '5512345678', '', 'idem-p164-nc'
    );
    v_intento_chg := (v_ini->>'intento_id')::UUID;
    PERFORM public.__p155_assert(
      (SELECT programa FROM public.expedientes WHERE id = v_exp3) = 'compro_tu_casa',
      'P164 NC pending no muta programa'
    );
    PERFORM public.__p155_set_auth(v_editor);
    v_res := public.upsert_editor_decision(v_exp3, 'no_cumple', NULL, 'no pasa cambio');
    PERFORM public.__p155_assert(
      (SELECT programa FROM public.expedientes WHERE id = v_exp3) = 'compro_tu_casa',
      'P164 NC programa intacto'
    );
    SELECT monto_aprobado INTO v_ed_monto FROM public.editor_decisions WHERE expediente_id = v_exp3;
    PERFORM public.__p155_assert(v_ed_monto = 180000, 'P164 NC monto intacto');
    PERFORM public.__p155_assert(
      (SELECT reprecalificacion_pendiente_id FROM public.expedientes WHERE id = v_exp3) IS NULL,
      'P164 NC pending null'
    );

    -- 16 REPRECAL NORMAL REGRESSION (mismo programa tras cambio)
    PERFORM public.__p155_set_auth(v_asesor_a);
    v_ini := public.asesor_iniciar_reprecalificacion(
      v_nss3, 'compro_tu_casa', 'Cliente P164 Same', '5512345678', '', 'idem-p164-same'
    );
    PERFORM public.__p155_assert(COALESCE((v_ini->>'cambio_programa')::BOOLEAN, true) = false, 'P164 same no cambio');
    PERFORM public.__p155_set_auth(v_editor);
    v_res := public.upsert_editor_decision(v_exp3, 'aprobado', 190000, 'same ok');
    PERFORM public.__p155_assert(
      (SELECT programa FROM public.expedientes WHERE id = v_exp3) = 'compro_tu_casa',
      'P164 same programa'
    );
    PERFORM public.__p155_assert(
      (SELECT monto_aprobado FROM public.editor_decisions WHERE expediente_id = v_exp3) = 190000,
      'P164 same monto'
    );

    -- 13 NOT SUBMITTED TO MESA → P169: propio activo pre-Mesa = reprecal_own_mesa (no ok_create)
    PERFORM public.__p155_set_auth(v_asesor_a);
    SELECT public.create_expediente('mejoravit', v_nss4, 'Cliente NoMesa', '5512345678', '') INTO v_res;
    v_exp4 := (v_res->>'id')::UUID;
    v_gate := public.asesor_lookup_nss_precal_gate(v_nss4, 'mejoravit');
    PERFORM public.__p155_assert(v_gate->>'status' = 'reprecal_own_mesa', 'P169 pre-mesa → reprecal_own_mesa');
    PERFORM public.__p155_assert((v_gate->>'expediente_id')::UUID = v_exp4, 'P169 pre-mesa mismo expediente');
    v_gate := public.asesor_lookup_nss_precal_gate(v_nss4, 'compro_tu_casa');
    PERFORM public.__p155_assert(v_gate->>'status' = 'reprecal_change_programa', 'P169 pre-mesa change');

    -- 14–15 SUBCUENTA intacta + cambio desde subcuenta
    SELECT public.create_expediente('subcuenta', v_nss5, 'Cliente Sub', '5512345678', '') INTO v_res;
    v_exp5 := (v_res->>'id')::UUID;
    PERFORM public.__p155_reset_auth();
    INSERT INTO public.editor_decisions (
      expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar
    ) VALUES (v_exp5, v_org, 'aprobado', 50000, now(), 50000)
    ON CONFLICT (expediente_id) DO UPDATE
    SET decision = 'aprobado', monto_aprobado = 50000, aprobado_at = now(), monto_aprobado_al_aprobar = 50000;
    UPDATE public.expedientes
    SET submitted_to_mesa = true, fecha_envio_mesa = now(),
        subestado = 'en_validacion_mesa', etapa_actual = 2
    WHERE id = v_exp5;

    PERFORM public.__p155_set_auth(v_asesor_a);
    v_gate := public.asesor_lookup_nss_precal_gate(v_nss5, 'subcuenta');
    PERFORM public.__p155_assert(v_gate->>'status' = 'reprecal_own_mesa', 'P164 subcuenta own');
    v_gate := public.asesor_lookup_nss_precal_gate(v_nss5, 'mejoravit');
    PERFORM public.__p155_assert(v_gate->>'status' = 'reprecal_change_programa', 'P164 sub→mejoravit gate');
    v_ini := public.asesor_iniciar_reprecalificacion(
      v_nss5, 'mejoravit', 'Cliente Sub Chg', '5512345678', '', 'idem-p164-sub'
    );
    PERFORM public.__p155_assert(
      (SELECT programa FROM public.expedientes WHERE id = v_exp5) = 'subcuenta',
      'P164 sub pending no muta'
    );
    PERFORM public.__p155_set_auth(v_editor);
    PERFORM public.upsert_editor_decision(v_exp5, 'aprobado', 60000, 'sub ok');
    PERFORM public.__p155_assert(
      (SELECT programa FROM public.expedientes WHERE id = v_exp5) = 'mejoravit',
      'P164 sub→mejoravit aplicado'
    );

    -- 11 OTHER ASESOR (sobre nss3 ahora compro)
    PERFORM public.__p155_set_auth(v_asesor_b);
    v_gate := public.asesor_lookup_nss_precal_gate(v_nss3, 'compro_tu_casa');
    PERFORM public.__p155_assert(v_gate->>'status' = 'blocked_other_asesor', 'P164 other asesor');

    PERFORM public.__p155_cleanup(v_nss3);
    PERFORM public.__p155_cleanup(v_nss4);
    PERFORM public.__p155_cleanup(v_nss5);
  END;

  PERFORM public.__p155_cleanup(v_nss);
  PERFORM public.__p155_cleanup(v_nss2);

  RAISE NOTICE 'P155/P164 OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p155_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p155_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p155_reset_auth();
DROP FUNCTION IF EXISTS public.__p155_cleanup(TEXT);
DROP FUNCTION IF EXISTS public.__p155_insert_mesa_dup(UUID, UUID, TEXT, public.programa);
DROP FUNCTION IF EXISTS public.__p155_mark_deleted(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.__p155_hard_delete_exp(UUID);