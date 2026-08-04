-- ConCasa CRM — P155: re-precalificar NSS propio ya enviado a Mesa
-- Sin crear otro expediente. Historial en expediente_precalificacion_intentos.

CREATE TABLE IF NOT EXISTS public.expediente_precalificacion_intentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id),
  asesor_id UUID NOT NULL REFERENCES public.profiles(id),
  programa public.programa NOT NULL,
  nss CHAR(11) NOT NULL,
  cliente_nombre TEXT NOT NULL,
  telefono_cliente TEXT NOT NULL,
  direccion_opcional TEXT NOT NULL DEFAULT '',
  decision public.editor_decision NOT NULL DEFAULT 'pendiente',
  monto_aprobado NUMERIC(14, 2),
  notas_revision TEXT NOT NULL DEFAULT '',
  es_vigente BOOLEAN NOT NULL DEFAULT false,
  decision_previa public.editor_decision,
  monto_aprobado_previo NUMERIC(14, 2),
  intento_previo_id UUID REFERENCES public.expediente_precalificacion_intentos(id),
  idempotency_key TEXT,
  created_by UUID REFERENCES public.profiles(id),
  decided_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  CONSTRAINT expediente_precalificacion_intentos_nss_chk
    CHECK (nss ~ '^[0-9]{11}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS expediente_precalificacion_intentos_idem_uidx
  ON public.expediente_precalificacion_intentos (expediente_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS expediente_precalificacion_intentos_exp_created_idx
  ON public.expediente_precalificacion_intentos (expediente_id, created_at DESC);

CREATE INDEX IF NOT EXISTS expediente_precalificacion_intentos_pendiente_idx
  ON public.expediente_precalificacion_intentos (organization_id)
  WHERE decision = 'pendiente';

COMMENT ON TABLE public.expediente_precalificacion_intentos IS
  'P155: intentos de precalificación por expediente. es_vigente marca la última aprobada aplicada.';

ALTER TABLE public.expediente_precalificacion_intentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expediente_precalificacion_intentos_select ON public.expediente_precalificacion_intentos;
CREATE POLICY expediente_precalificacion_intentos_select
  ON public.expediente_precalificacion_intentos
  FOR SELECT TO authenticated
  USING (
    public.can_see_expediente(expediente_id)
    OR asesor_id = public.current_profile_id()
  );

REVOKE ALL ON TABLE public.expediente_precalificacion_intentos FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_precalificacion_intentos FROM anon;
GRANT SELECT ON TABLE public.expediente_precalificacion_intentos TO authenticated;

ALTER TABLE public.expedientes
  ADD COLUMN IF NOT EXISTS reprecalificacion_pendiente_id UUID
    REFERENCES public.expediente_precalificacion_intentos(id);

COMMENT ON COLUMN public.expedientes.reprecalificacion_pendiente_id IS
  'P155: intento de re-precalificación pendiente de decisión editorial.';

-- =============================================================================
-- asesor_lookup_nss_precal_gate
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
      'nss', v_nss,
      'reprecalificacion_pendiente_id', v_pendiente
    );
  END IF;

  -- Mesa en otro programa (propio)
  IF v_mesa_cualquier = 1 THEN
    SELECT e.id, e.asesor_id, e.programa
    INTO v_exp_id, v_exp_asesor, v_exp_programa
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
      'status', 'blocked_programa_mismatch',
      'message', 'Este NSS ya tiene un expediente en Mesa con otro programa. Usa el flujo de «Cambiar programa»; no se creará otro expediente.',
      'expediente_id', v_exp_id,
      'programa_actual', v_exp_programa,
      'programa_solicitado', p_programa,
      'nss', v_nss
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok_create',
    'message', 'Puedes crear una nueva precalificación.',
    'nss', v_nss,
    'programa', p_programa
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) TO authenticated;

COMMENT ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) IS
  'P155: gate RO para alta/re-precalificación por NSS. Solo asesor.';

-- =============================================================================
-- asesor_iniciar_reprecalificacion
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
  v_exp public.expedientes%ROWTYPE;
  v_ed public.editor_decisions%ROWTYPE;
  v_prev_intento UUID;
  v_intento_id UUID;
  v_key TEXT;
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
  IF (v_gate->>'status') IS DISTINCT FROM 'reprecal_own_mesa' THEN
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

  SELECT * INTO v_exp
  FROM public.expedientes e
  WHERE e.id = (v_gate->>'expediente_id')::UUID
    AND e.asesor_id = v_actor
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_iniciar_reprecalificacion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

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
        'message', 'Precalificación actualizada (idempotente).'
      );
    END IF;
  END IF;

  -- Si ya hay pendiente, reutilizar (no duplicar)
  IF v_exp.reprecalificacion_pendiente_id IS NOT NULL THEN
    UPDATE public.expediente_precalificacion_intentos i
    SET cliente_nombre = v_nombre,
        telefono_cliente = v_tel,
        direccion_opcional = v_dir,
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

      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'expediente_id', v_exp.id,
        'intento_id', v_intento_id,
        'status', 'reprecal_pending',
        'message', 'Ya había una re-precalificación pendiente; se actualizaron los datos.'
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
      organization_id, expediente_id, asesor_id, programa, nss,
      cliente_nombre, telefono_cliente, direccion_opcional,
      decision, monto_aprobado, notas_revision, es_vigente,
      created_by, decided_by, decided_at
    ) VALUES (
      v_exp.organization_id, v_exp.id, v_exp.asesor_id, v_exp.programa, v_exp.nss,
      v_exp.cliente_nombre, v_exp.telefono_cliente, coalesce(v_exp.direccion_opcional, ''),
      v_ed.decision, v_ed.monto_aprobado, coalesce(v_ed.notas_revision, ''), true,
      v_actor, v_actor, coalesce(v_ed.aprobado_at, now())
    )
    RETURNING id INTO v_prev_intento;
  END IF;

  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, nss,
    cliente_nombre, telefono_cliente, direccion_opcional,
    decision, monto_aprobado, es_vigente,
    decision_previa, monto_aprobado_previo, intento_previo_id,
    idempotency_key, created_by
  ) VALUES (
    v_exp.organization_id, v_exp.id, v_actor, v_exp.programa, v_nss,
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

  -- No tocar etapa_actual / submitted / editor_decisions (Mesa sigue viendo aprobación vigente)

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
    'message', 'Se guardó una nueva precalificación en el expediente existente. No se creó otro expediente.',
    'programa', v_exp.programa,
    'cliente_nombre', v_nombre
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_iniciar_reprecalificacion(TEXT, public.programa, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_iniciar_reprecalificacion(TEXT, public.programa, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_iniciar_reprecalificacion(TEXT, public.programa, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.asesor_iniciar_reprecalificacion(TEXT, public.programa, TEXT, TEXT, TEXT, TEXT) IS
  'P155: inicia re-precalificación en expediente propio ya en Mesa. Sin nuevo expediente.';

-- =============================================================================
-- editor_resolver_reprecalificacion
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
    -- Idempotente si ya resuelto igual
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'intento_id', v_intento.id,
      'expediente_id', v_intento.expediente_id,
      'decision', v_intento.decision,
      'monto_aprobado', v_intento.monto_aprobado
    );
  END IF;

  SELECT * INTO v_exp FROM public.expedientes e WHERE e.id = v_intento.expediente_id FOR UPDATE;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL OR v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'editor_resolver_reprecalificacion: expediente no disponible'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := COALESCE(NULLIF(btrim(COALESCE(p_motivo, '')), ''), '');

  IF p_decision = 'aprobado' THEN
    IF p_monto_aprobado IS NULL OR p_monto_aprobado <= 0 THEN
      RAISE EXCEPTION 'editor_resolver_reprecalificacion: monto_aprobado > 0 requerido'
        USING ERRCODE = '22023';
    END IF;
    v_monto := round(p_monto_aprobado::NUMERIC, 2);

    SELECT * INTO v_ed FROM public.editor_decisions ed WHERE ed.expediente_id = v_exp.id;

    -- Desmarcar vigentes previos
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
        -- Conserva snapshot 1ª aprobación KPI
        aprobado_at = public.editor_decisions.aprobado_at,
        monto_aprobado_al_aprobar = public.editor_decisions.monto_aprobado_al_aprobar,
        updated_at = now();

    UPDATE public.expedientes
    SET reprecalificacion_pendiente_id = NULL,
        updated_at = now()
    WHERE id = v_exp.id;

    PERFORM public.log_action(
      v_org, v_actor, v_role,
      'editor.reprecalificacion.aprobar',
      'expediente', v_exp.id,
      jsonb_build_object(
        'intento_id', v_intento.id,
        'monto_aprobado', v_monto,
        'intento_previo_id', v_intento.intento_previo_id
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', v_exp.id,
      'intento_id', v_intento.id,
      'decision', 'aprobado',
      'monto_aprobado', v_monto,
      'message', 'Precalificación actualizada en el mismo expediente.'
    );
  END IF;

  -- no_cumple: historial sí; NO tocar editor_decisions ni etapa
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
      'intento_previo_id', v_intento.intento_previo_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', v_exp.id,
    'intento_id', v_intento.id,
    'decision', 'no_cumple',
    'message', 'Intento no aprobado. Se conservó la precalificación vigente anterior y el expediente.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.editor_resolver_reprecalificacion(UUID, public.editor_decision, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editor_resolver_reprecalificacion(UUID, public.editor_decision, NUMERIC, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.editor_resolver_reprecalificacion(UUID, public.editor_decision, NUMERIC, TEXT) TO authenticated;

COMMENT ON FUNCTION public.editor_resolver_reprecalificacion(UUID, public.editor_decision, NUMERIC, TEXT) IS
  'P155: editor resuelve re-precalificación. Aprobado actualiza editor_decisions; no_cumple conserva vigente.';
-- =============================================================================
-- upsert_editor_decision: ruteo P155 a editor_resolver_reprecalificacion
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_editor_decision(p_expediente_id uuid, p_decision editor_decision, p_monto_aprobado numeric DEFAULT NULL::numeric, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_prev public.editor_decisions%ROWTYPE;
  v_monto NUMERIC(14, 2);
  v_motivo TEXT;
  v_base NUMERIC(12, 2);
  v_aprobado_at TIMESTAMPTZ;
  v_monto_al_aprobar NUMERIC(14, 2);
  v_no_cumple_at TIMESTAMPTZ;
  v_override NUMERIC(12, 2);
  v_datos JSONB;
  v_pct NUMERIC(5, 2);
  v_reprecal_pendiente UUID;
BEGIN
  -- P155: re-precalificación pendiente del dueño → resolver dedicado (no tocar etapa)
  SELECT e.reprecalificacion_pendiente_id
  INTO v_reprecal_pendiente
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF v_reprecal_pendiente IS NOT NULL THEN
    RETURN public.editor_resolver_reprecalificacion(
      v_reprecal_pendiente, p_decision, p_monto_aprobado, p_motivo
    );
  END IF;

  IF NOT public.es_reingreso_post_biometricos_valido(p_expediente_id) THEN
    RETURN public.upsert_editor_decision_pre_reingreso(
      p_expediente_id, p_decision, p_monto_aprobado, p_motivo
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'editor' THEN
    RAISE EXCEPTION 'upsert_editor_decision: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  JOIN public.expediente_rechazos_operativos r
    ON r.id = e.reingreso_rechazo_id
   AND r.expediente_id = e.expediente_anterior_id
  WHERE e.id = p_expediente_id
    AND e.organization_id = v_actor.organization_id
    AND e.etapa_actual = 6
    AND e.ciclo_estado = 'activo'
    AND e.subestado = 'en_proceso'
    AND e.submitted_to_mesa = true
    AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_editor_decision: reingreso no válido'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision IS NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: decision es obligatoria'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'aprobado' AND (p_monto_aprobado IS NULL OR p_monto_aprobado <= 0) THEN
    RAISE EXCEPTION 'REENTRY_AMOUNT_PENDING: monto aprobado debe ser mayor a cero'
      USING ERRCODE = '22023';
  END IF;

  v_monto := CASE WHEN p_decision = 'aprobado'
    THEN round(p_monto_aprobado::NUMERIC, 2) ELSE NULL END;
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  SELECT ed.* INTO v_prev
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF p_decision = 'aprobado'
     AND (NOT FOUND OR v_prev.aprobado_at IS NULL)
     AND (NOT FOUND OR v_prev.decision IS DISTINCT FROM 'aprobado'::public.editor_decision)
  THEN
    v_aprobado_at := NOW();
    v_monto_al_aprobar := v_monto;
  ELSIF FOUND THEN
    v_aprobado_at := v_prev.aprobado_at;
    v_monto_al_aprobar := v_prev.monto_aprobado_al_aprobar;
  ELSE
    v_aprobado_at := NULL;
    v_monto_al_aprobar := NULL;
  END IF;

  IF p_decision = 'no_cumple'
     AND (NOT FOUND OR v_prev.no_cumple_at IS NULL)
     AND (NOT FOUND OR v_prev.decision IS DISTINCT FROM 'no_cumple'::public.editor_decision)
  THEN
    v_no_cumple_at := NOW();
  ELSIF FOUND THEN
    v_no_cumple_at := v_prev.no_cumple_at;
  ELSE
    v_no_cumple_at := NULL;
  END IF;

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision, decided_by,
    aprobado_at, monto_aprobado_al_aprobar, no_cumple_at
  ) VALUES (
    p_expediente_id, v_exp.organization_id, p_decision, v_monto,
    COALESCE(v_motivo, ''), v_actor_id,
    v_aprobado_at, v_monto_al_aprobar, v_no_cumple_at
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    notas_revision = CASE WHEN v_motivo IS NOT NULL
      THEN EXCLUDED.notas_revision ELSE public.editor_decisions.notas_revision END,
    decided_by = EXCLUDED.decided_by,
    updated_at = NOW(),
    aprobado_at = CASE
      WHEN public.editor_decisions.aprobado_at IS NULL
           AND EXCLUDED.decision = 'aprobado'::public.editor_decision
           AND public.editor_decisions.decision IS DISTINCT FROM 'aprobado'::public.editor_decision
      THEN NOW()
      ELSE public.editor_decisions.aprobado_at
    END,
    monto_aprobado_al_aprobar = CASE
      WHEN public.editor_decisions.aprobado_at IS NULL
           AND EXCLUDED.decision = 'aprobado'::public.editor_decision
           AND public.editor_decisions.decision IS DISTINCT FROM 'aprobado'::public.editor_decision
      THEN EXCLUDED.monto_aprobado
      ELSE public.editor_decisions.monto_aprobado_al_aprobar
    END,
    no_cumple_at = CASE
      WHEN public.editor_decisions.no_cumple_at IS NULL
           AND EXCLUDED.decision = 'no_cumple'::public.editor_decision
           AND public.editor_decisions.decision IS DISTINCT FROM 'no_cumple'::public.editor_decision
      THEN NOW()
      ELSE public.editor_decisions.no_cumple_at
    END;

  IF p_decision = 'aprobado' THEN
    SELECT cd.monto_mejoravit_actualizado, cd.datos, cd.porcentaje_cobro
    INTO v_override, v_datos, v_pct
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;

    IF v_exp.programa = 'mejoravit' THEN
      v_base := public.resolve_monto_operativo_mejoravit(v_override, v_datos, v_monto);
    ELSE
      v_base := v_monto;
    END IF;

    UPDATE public.cliente_datos
    SET monto_calculado = CASE
          WHEN porcentaje_cobro IS NULL THEN NULL
          WHEN v_base IS NULL THEN NULL
          ELSE round(v_base * porcentaje_cobro / 100 + 3000, 2)
        END,
        updated_at = NOW()
    WHERE expediente_id = p_expediente_id;
    -- No toca monto_mejoravit_actualizado / at / by / motivo
  ELSE
    UPDATE public.cliente_datos
    SET monto_calculado = NULL, updated_at = NOW()
    WHERE expediente_id = p_expediente_id;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'editor.decision.upsert',
    'editor_decision',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'decision_anterior', v_prev.decision,
      'decision_nueva', p_decision,
      'monto_anterior', v_prev.monto_aprobado,
      'monto_nuevo', v_monto,
      'motivo', v_motivo,
      'reingreso', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'decision', p_decision,
    'monto_aprobado', v_monto,
    'editor_id', v_actor_id
  );
END;
$$

