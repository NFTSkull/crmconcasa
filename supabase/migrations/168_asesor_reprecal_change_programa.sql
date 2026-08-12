-- ConCasa CRM — P164: reprecalificación con cambio de programa (extiende P155)
-- Sin nuevo expediente. programa vigente en expedientes; solicitud en intentos.programa_solicitado.
-- Aplica cambio de programa SOLO en editor_resolver_reprecalificacion al aprobar.

-- =============================================================================
-- B1.1 — Columna programa_solicitado (compatibilidad con historial P155)
-- =============================================================================
ALTER TABLE public.expediente_precalificacion_intentos
  ADD COLUMN IF NOT EXISTS programa_solicitado public.programa;

-- Filas históricas P155: solicitud = programa del intento (siempre mismo programa)
UPDATE public.expediente_precalificacion_intentos
SET programa_solicitado = programa
WHERE programa_solicitado IS NULL;

ALTER TABLE public.expediente_precalificacion_intentos
  ALTER COLUMN programa_solicitado SET NOT NULL;

COMMENT ON COLUMN public.expediente_precalificacion_intentos.programa IS
  'P155/P164: programa vigente del expediente al iniciar el intento (no se muta al solicitar cambio).';
COMMENT ON COLUMN public.expediente_precalificacion_intentos.programa_solicitado IS
  'P164: programa pedido por el asesor. Puede diferir de programa. Se aplica a expedientes.programa solo al aprobar.';

-- Sin UNIQUE parcial adicional de "un pendiente": P155 ya serializa con FOR UPDATE
-- sobre el expediente y reutiliza reprecalificacion_pendiente_id. Un UNIQUE sobre
-- decision=pendiente rompería filas históricas si quedara algún estado inconsistente
-- y no aporta más que el lock transaccional existente.

-- =============================================================================
-- B1.2 — Gate: reprecal_change_programa (reemplaza blocked_programa_mismatch propio)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.asesor_lookup_nss_precal_gate(
  p_nss TEXT,
  p_programa public.programa
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_nss TEXT;
  v_mesa_mismo INT;
  v_mesa_cualquier INT;
  v_exp_id UUID;
  v_exp_asesor UUID;
  v_exp_programa public.programa;
  v_pendiente UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_lookup_nss_precal_gate: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_lookup_nss_precal_gate: solo asesor'
      USING ERRCODE = '42501';
  END IF;

  IF p_programa IS NULL THEN
    RAISE EXCEPTION 'asesor_lookup_nss_precal_gate: programa obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_nss := public.normalize_nss_mexico(p_nss);
  IF v_nss IS NULL OR v_nss !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'asesor_lookup_nss_precal_gate: NSS inválido'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_mesa_cualquier
  FROM public.expedientes e
  WHERE e.organization_id = v_org
    AND e.nss = v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo'
    AND e.submitted_to_mesa = true;

  SELECT count(*) INTO v_mesa_mismo
  FROM public.expedientes e
  WHERE e.organization_id = v_org
    AND e.nss = v_nss
    AND e.programa = p_programa
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo'
    AND e.submitted_to_mesa = true;

  IF v_mesa_cualquier > 1 OR v_mesa_mismo > 1 THEN
    RETURN jsonb_build_object(
      'status', 'blocked_ambiguous',
      'message', 'Este NSS requiere revisión administrativa porque tiene más de un expediente vigente.',
      'nss', v_nss,
      'programa', p_programa
    );
  END IF;

  IF v_mesa_mismo = 1 THEN
    SELECT e.id, e.asesor_id, e.programa, e.reprecalificacion_pendiente_id
    INTO v_exp_id, v_exp_asesor, v_exp_programa, v_pendiente
    FROM public.expedientes e
    WHERE e.organization_id = v_org
      AND e.nss = v_nss
      AND e.programa = p_programa
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa = true;

    IF v_exp_asesor IS DISTINCT FROM v_actor THEN
      RETURN jsonb_build_object(
        'status', 'blocked_other_asesor',
        'message', 'Este NSS ya tiene un expediente en Mesa asignado a otro asesor.',
        'nss', v_nss,
        'programa', p_programa
      );
    END IF;

    RETURN jsonb_build_object(
      'status', 'reprecal_own_mesa',
      'message', 'Este NSS ya tiene un expediente en Mesa asignado a ti. Puedes volver a precalificarlo; el resultado se actualizará en el mismo expediente.',
      'expediente_id', v_exp_id,
      'programa', v_exp_programa,
      'programa_actual', v_exp_programa,
      'programa_solicitado', p_programa,
      'cambio_programa', false,
      'nss', v_nss,
      'reprecalificacion_pendiente_id', v_pendiente
    );
  END IF;

  -- Mesa en otro programa (propio) → P164: permitir cambio de programa (mismo expediente)
  IF v_mesa_cualquier = 1 THEN
    SELECT e.id, e.asesor_id, e.programa, e.reprecalificacion_pendiente_id
    INTO v_exp_id, v_exp_asesor, v_exp_programa, v_pendiente
    FROM public.expedientes e
    WHERE e.organization_id = v_org
      AND e.nss = v_nss
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa = true;

    IF v_exp_asesor IS DISTINCT FROM v_actor THEN
      RETURN jsonb_build_object(
        'status', 'blocked_other_asesor',
        'message', 'Este NSS ya tiene un expediente en Mesa asignado a otro asesor.',
        'nss', v_nss,
        'programa', p_programa
      );
    END IF;

    RETURN jsonb_build_object(
      'status', 'reprecal_change_programa',
      'message', 'Puedes solicitar cambio de programa sobre el mismo expediente. El programa y monto vigentes no cambian hasta que el Editor apruebe.',
      'expediente_id', v_exp_id,
      'programa', v_exp_programa,
      'programa_actual', v_exp_programa,
      'programa_solicitado', p_programa,
      'cambio_programa', true,
      'nss', v_nss,
      'reprecalificacion_pendiente_id', v_pendiente
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok_create',
    'message', 'Puedes crear una nueva precalificación.',
    'nss', v_nss,
    'programa', p_programa,
    'programa_solicitado', p_programa,
    'cambio_programa', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) TO authenticated;

COMMENT ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) IS
  'P155/P164: gate RO alta/re-precal/cambio programa por NSS. Solo asesor. Ownership + mesa intactos.';

-- =============================================================================
-- B1.3–B1.5 — Misma RPC iniciar: mismo programa o cambio diferido
-- =============================================================================
CREATE OR REPLACE FUNCTION public.asesor_iniciar_reprecalificacion(
  p_nss TEXT,
  p_programa public.programa,
  p_cliente_nombre TEXT,
  p_telefono_cliente TEXT,
  p_direccion_opcional TEXT DEFAULT '',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_nss TEXT;
  v_tel TEXT;
  v_nombre TEXT;
  v_dir TEXT;
  v_gate JSONB;
  v_gate_status TEXT;
  v_exp public.expedientes%ROWTYPE;
  v_ed public.editor_decisions%ROWTYPE;
  v_prev_intento UUID;
  v_intento_id UUID;
  v_key TEXT;
  v_cambio BOOLEAN;
  v_programa_solicitado public.programa;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_iniciar_reprecalificacion: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_iniciar_reprecalificacion: solo asesor'
      USING ERRCODE = '42501';
  END IF;

  v_gate := public.asesor_lookup_nss_precal_gate(p_nss, p_programa);
  v_gate_status := v_gate->>'status';
  IF v_gate_status IS DISTINCT FROM 'reprecal_own_mesa'
     AND v_gate_status IS DISTINCT FROM 'reprecal_change_programa' THEN
    RAISE EXCEPTION 'asesor_iniciar_reprecalificacion: %', coalesce(v_gate->>'message', 'no permitido')
      USING ERRCODE = '22023';
  END IF;

  v_nss := v_gate->>'nss';
  v_nombre := btrim(COALESCE(p_cliente_nombre, ''));
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'asesor_iniciar_reprecalificacion: nombre obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tel := regexp_replace(btrim(COALESCE(p_telefono_cliente, '')), '[^0-9]', '', 'g');
  IF v_tel !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'asesor_iniciar_reprecalificacion: teléfono inválido'
      USING ERRCODE = '22023';
  END IF;

  v_dir := COALESCE(btrim(COALESCE(p_direccion_opcional, '')), '');
  v_key := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_programa_solicitado := p_programa;

  SELECT * INTO v_exp
  FROM public.expedientes e
  WHERE e.id = (v_gate->>'expediente_id')::UUID
    AND e.asesor_id = v_actor
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_iniciar_reprecalificacion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  v_cambio := (v_exp.programa IS DISTINCT FROM v_programa_solicitado);

  -- Idempotencia: misma key → devolver intento existente
  IF v_key IS NOT NULL THEN
    SELECT i.id INTO v_intento_id
    FROM public.expediente_precalificacion_intentos i
    WHERE i.expediente_id = v_exp.id
      AND i.idempotency_key = v_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'expediente_id', v_exp.id,
        'intento_id', v_intento_id,
        'status', 'reprecal_pending',
        'message', 'Precalificación actualizada (idempotente).',
        'programa', v_exp.programa,
        'programa_solicitado', v_programa_solicitado,
        'cambio_programa', v_cambio
      );
    END IF;
  END IF;

  -- Si ya hay pendiente, reutilizar (no duplicar); actualizar solicitud vigente
  IF v_exp.reprecalificacion_pendiente_id IS NOT NULL THEN
    UPDATE public.expediente_precalificacion_intentos i
    SET cliente_nombre = v_nombre,
        telefono_cliente = v_tel,
        direccion_opcional = v_dir,
        programa_solicitado = v_programa_solicitado,
        created_at = now()
    WHERE i.id = v_exp.reprecalificacion_pendiente_id
      AND i.decision = 'pendiente'
    RETURNING i.id INTO v_intento_id;

    IF v_intento_id IS NOT NULL THEN
      UPDATE public.expedientes e
      SET cliente_nombre = v_nombre,
          telefono_cliente = v_tel,
          direccion_opcional = v_dir,
          updated_at = now()
      WHERE e.id = v_exp.id;
      -- NO tocar e.programa ni editor_decisions

      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'expediente_id', v_exp.id,
        'intento_id', v_intento_id,
        'status', 'reprecal_pending',
        'message', 'Ya había una re-precalificación pendiente; se actualizaron los datos.',
        'programa', v_exp.programa,
        'programa_solicitado', v_programa_solicitado,
        'cambio_programa', v_cambio
      );
    END IF;
  END IF;

  SELECT * INTO v_ed FROM public.editor_decisions ed WHERE ed.expediente_id = v_exp.id;

  SELECT i.id INTO v_prev_intento
  FROM public.expediente_precalificacion_intentos i
  WHERE i.expediente_id = v_exp.id
    AND i.es_vigente = true
  ORDER BY i.decided_at DESC NULLS LAST
  LIMIT 1;

  -- Archivar estado vigente actual como histórico si no hay fila vigente aún
  IF v_ed.expediente_id IS NOT NULL AND v_prev_intento IS NULL AND v_ed.decision = 'aprobado' THEN
    INSERT INTO public.expediente_precalificacion_intentos (
      organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
      cliente_nombre, telefono_cliente, direccion_opcional,
      decision, monto_aprobado, notas_revision, es_vigente,
      created_by, decided_by, decided_at
    ) VALUES (
      v_exp.organization_id, v_exp.id, v_exp.asesor_id, v_exp.programa, v_exp.programa, v_exp.nss,
      v_exp.cliente_nombre, v_exp.telefono_cliente, coalesce(v_exp.direccion_opcional, ''),
      v_ed.decision, v_ed.monto_aprobado, coalesce(v_ed.notas_revision, ''), true,
      v_actor, v_actor, coalesce(v_ed.aprobado_at, now())
    )
    RETURNING id INTO v_prev_intento;
  END IF;

  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, direccion_opcional,
    decision, monto_aprobado, es_vigente,
    decision_previa, monto_aprobado_previo, intento_previo_id,
    idempotency_key, created_by
  ) VALUES (
    v_exp.organization_id, v_exp.id, v_actor, v_exp.programa, v_programa_solicitado, v_nss,
    v_nombre, v_tel, v_dir,
    'pendiente', NULL, false,
    v_ed.decision, v_ed.monto_aprobado, v_prev_intento,
    v_key, v_actor
  )
  RETURNING id INTO v_intento_id;

  UPDATE public.expedientes e
  SET cliente_nombre = v_nombre,
      telefono_cliente = v_tel,
      direccion_opcional = v_dir,
      reprecalificacion_pendiente_id = v_intento_id,
      updated_at = now()
  WHERE e.id = v_exp.id;
  -- NO tocar etapa_actual / submitted / programa / editor_decisions

  PERFORM public.log_action(
    v_org,
    v_actor,
    'asesor'::public.app_role,
    'asesor.reprecalificacion.iniciar',
    'expediente',
    v_exp.id,
    jsonb_build_object(
      'intento_id', v_intento_id,
      'intento_previo_id', v_prev_intento,
      'programa', v_exp.programa,
      'programa_vigente', v_exp.programa,
      'programa_solicitado', v_programa_solicitado,
      'cambio_programa', v_cambio,
      'decision_previa', v_ed.decision,
      'monto_previo', v_ed.monto_aprobado
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'expediente_id', v_exp.id,
    'intento_id', v_intento_id,
    'status', 'reprecal_pending',
    'message', CASE
      WHEN v_cambio THEN
        'Se solicitó cambio de programa en el expediente existente. El programa y monto vigentes no cambian hasta que el Editor apruebe.'
      ELSE
        'Se guardó una nueva precalificación en el expediente existente. No se creó otro expediente.'
    END,
    'programa', v_exp.programa,
    'programa_solicitado', v_programa_solicitado,
    'cambio_programa', v_cambio,
    'cliente_nombre', v_nombre
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_iniciar_reprecalificacion(TEXT, public.programa, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_iniciar_reprecalificacion(TEXT, public.programa, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_iniciar_reprecalificacion(TEXT, public.programa, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.asesor_iniciar_reprecalificacion(TEXT, public.programa, TEXT, TEXT, TEXT, TEXT) IS
  'P155/P164: inicia re-precal o cambio de programa diferido. Sin nuevo expediente. No muta programa/monto vigentes.';

-- =============================================================================
-- B1.6 — Resolver: aplica programa_solicitado solo al aprobar (atómico)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.editor_resolver_reprecalificacion(
  p_intento_id UUID,
  p_decision public.editor_decision,
  p_monto_aprobado NUMERIC DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_intento public.expediente_precalificacion_intentos%ROWTYPE;
  v_exp public.expedientes%ROWTYPE;
  v_ed public.editor_decisions%ROWTYPE;
  v_monto NUMERIC(14, 2);
  v_motivo TEXT;
  v_cambio BOOLEAN;
  v_programa_anterior public.programa;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'editor_resolver_reprecalificacion: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN ('editor', 'super_admin') THEN
    RAISE EXCEPTION 'editor_resolver_reprecalificacion: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_intento_id IS NULL OR p_decision IS NULL THEN
    RAISE EXCEPTION 'editor_resolver_reprecalificacion: intento y decision obligatorios'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision NOT IN ('aprobado', 'no_cumple') THEN
    RAISE EXCEPTION 'editor_resolver_reprecalificacion: decision debe ser aprobado o no_cumple'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_intento
  FROM public.expediente_precalificacion_intentos i
  WHERE i.id = p_intento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'editor_resolver_reprecalificacion: intento no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_intento.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'editor_resolver_reprecalificacion: fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_intento.decision IS DISTINCT FROM 'pendiente' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'intento_id', v_intento.id,
      'expediente_id', v_intento.expediente_id,
      'decision', v_intento.decision,
      'monto_aprobado', v_intento.monto_aprobado,
      'programa', v_intento.programa,
      'programa_solicitado', v_intento.programa_solicitado
    );
  END IF;

  SELECT * INTO v_exp FROM public.expedientes e WHERE e.id = v_intento.expediente_id FOR UPDATE;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL OR v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'editor_resolver_reprecalificacion: expediente no disponible'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := COALESCE(NULLIF(btrim(COALESCE(p_motivo, '')), ''), '');
  v_programa_anterior := v_exp.programa;
  v_cambio := (v_intento.programa_solicitado IS DISTINCT FROM v_exp.programa);

  IF p_decision = 'aprobado' THEN
    IF p_monto_aprobado IS NULL OR p_monto_aprobado <= 0 THEN
      RAISE EXCEPTION 'editor_resolver_reprecalificacion: monto_aprobado > 0 requerido'
        USING ERRCODE = '22023';
    END IF;
    v_monto := round(p_monto_aprobado::NUMERIC, 2);

    SELECT * INTO v_ed FROM public.editor_decisions ed WHERE ed.expediente_id = v_exp.id;

    UPDATE public.expediente_precalificacion_intentos
    SET es_vigente = false
    WHERE expediente_id = v_exp.id AND es_vigente = true;

    UPDATE public.expediente_precalificacion_intentos
    SET decision = 'aprobado',
        monto_aprobado = v_monto,
        notas_revision = v_motivo,
        es_vigente = true,
        decided_by = v_actor,
        decided_at = now()
    WHERE id = v_intento.id;

    INSERT INTO public.editor_decisions (
      expediente_id, organization_id, decision, monto_aprobado, notas_revision,
      decided_by, aprobado_at, monto_aprobado_al_aprobar
    ) VALUES (
      v_exp.id, v_org, 'aprobado', v_monto, v_motivo,
      v_actor,
      coalesce(v_ed.aprobado_at, now()),
      coalesce(v_ed.monto_aprobado_al_aprobar, v_monto)
    )
    ON CONFLICT (expediente_id) DO UPDATE
    SET decision = 'aprobado',
        monto_aprobado = EXCLUDED.monto_aprobado,
        notas_revision = EXCLUDED.notas_revision,
        decided_by = EXCLUDED.decided_by,
        aprobado_at = public.editor_decisions.aprobado_at,
        monto_aprobado_al_aprobar = public.editor_decisions.monto_aprobado_al_aprobar,
        updated_at = now();

    -- P164: aplicar programa solicitado en la misma transacción (atómico con monto)
    UPDATE public.expedientes
    SET reprecalificacion_pendiente_id = NULL,
        programa = COALESCE(v_intento.programa_solicitado, v_exp.programa),
        updated_at = now()
    WHERE id = v_exp.id;

    PERFORM public.log_action(
      v_org, v_actor, v_role,
      'editor.reprecalificacion.aprobar',
      'expediente', v_exp.id,
      jsonb_build_object(
        'intento_id', v_intento.id,
        'monto_aprobado', v_monto,
        'intento_previo_id', v_intento.intento_previo_id,
        'programa_anterior', v_programa_anterior,
        'programa_solicitado', v_intento.programa_solicitado,
        'cambio_programa', v_cambio
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', v_exp.id,
      'intento_id', v_intento.id,
      'decision', 'aprobado',
      'monto_aprobado', v_monto,
      'programa', COALESCE(v_intento.programa_solicitado, v_programa_anterior),
      'programa_anterior', v_programa_anterior,
      'programa_solicitado', v_intento.programa_solicitado,
      'cambio_programa', v_cambio,
      'message', 'Precalificación actualizada en el mismo expediente.'
    );
  END IF;

  -- no_cumple: historial sí; NO tocar editor_decisions ni programa ni etapa
  UPDATE public.expediente_precalificacion_intentos
  SET decision = 'no_cumple',
      monto_aprobado = NULL,
      notas_revision = v_motivo,
      es_vigente = false,
      decided_by = v_actor,
      decided_at = now()
  WHERE id = v_intento.id;

  UPDATE public.expedientes
  SET reprecalificacion_pendiente_id = NULL,
      updated_at = now()
  WHERE id = v_exp.id;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'editor.reprecalificacion.no_cumple',
    'expediente', v_exp.id,
    jsonb_build_object(
      'intento_id', v_intento.id,
      'intento_previo_id', v_intento.intento_previo_id,
      'programa_anterior', v_programa_anterior,
      'programa_solicitado', v_intento.programa_solicitado,
      'cambio_programa', v_cambio
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', v_exp.id,
    'intento_id', v_intento.id,
    'decision', 'no_cumple',
    'programa', v_programa_anterior,
    'programa_solicitado', v_intento.programa_solicitado,
    'cambio_programa', v_cambio,
    'message', 'Intento no aprobado. Se conservó la precalificación vigente anterior y el expediente.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.editor_resolver_reprecalificacion(UUID, public.editor_decision, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editor_resolver_reprecalificacion(UUID, public.editor_decision, NUMERIC, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.editor_resolver_reprecalificacion(UUID, public.editor_decision, NUMERIC, TEXT) TO authenticated;

COMMENT ON FUNCTION public.editor_resolver_reprecalificacion(UUID, public.editor_decision, NUMERIC, TEXT) IS
  'P155/P164: resuelve re-precal. Aprobado actualiza monto y, si aplica, programa; no_cumple conserva vigentes.';
