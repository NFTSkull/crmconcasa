-- ConCasa CRM — P081: fecha/monto canónicos de primera aprobación (Admin producción)
-- Agrega editor_decisions.aprobado_at + monto_aprobado_al_aprobar (inmutables tras 1ª transición).
-- Actualiza escritura canónica en upsert_editor_decision(_pre_reingreso).
-- Backfill desde action_log (primer editor.decision.upsert con transición a aprobado).
-- NO modifica migraciones 001–080. NO aplicar a Cloud sin autorización explícita.

-- =============================================================================
-- 1) Columnas + contrato
-- =============================================================================
ALTER TABLE public.editor_decisions
  ADD COLUMN IF NOT EXISTS aprobado_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS monto_aprobado_al_aprobar NUMERIC(14, 2) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'editor_decisions_aprobado_snapshot_chk'
      AND conrelid = 'public.editor_decisions'::regclass
  ) THEN
    ALTER TABLE public.editor_decisions
      ADD CONSTRAINT editor_decisions_aprobado_snapshot_chk
      CHECK (
        (aprobado_at IS NULL AND monto_aprobado_al_aprobar IS NULL)
        OR (
          aprobado_at IS NOT NULL
          AND monto_aprobado_al_aprobar IS NOT NULL
          AND monto_aprobado_al_aprobar > 0
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.editor_decisions.aprobado_at IS
  'P081: timestamp de la primera transición a decision=aprobado. Inmutable. Métricas Admin por periodo usan este campo (no updated_at).';

COMMENT ON COLUMN public.editor_decisions.monto_aprobado_al_aprobar IS
  'P081: snapshot de monto_aprobado en la misma transición que fija aprobado_at. Inmutable. KPI >20000 usa este campo. monto_aprobado sigue siendo el monto actual.';

COMMENT ON COLUMN public.editor_decisions.monto_aprobado IS
  'Monto aprobado actual (mutable). Distinto de monto_aprobado_al_aprobar (histórico de primera aprobación).';

-- =============================================================================
-- 2) Índices para consultas por periodo
-- =============================================================================
CREATE INDEX IF NOT EXISTS editor_decisions_aprobado_at_idx
  ON public.editor_decisions (aprobado_at DESC)
  WHERE aprobado_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS expedientes_fecha_envio_mesa_admin_idx
  ON public.expedientes (fecha_envio_mesa DESC)
  WHERE deleted_at IS NULL
    AND submitted_to_mesa = TRUE
    AND fecha_envio_mesa IS NOT NULL;

-- =============================================================================
-- 3) Escritura canónica — pre-reingreso (ACL: solo postgres; llamada vía wrapper)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_editor_decision_pre_reingreso(
  p_expediente_id UUID,
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
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_prev public.editor_decisions%ROWTYPE;
  v_motivo TEXT;
  v_monto_final NUMERIC(14, 2);
  v_notas_final TEXT;
  v_updated_at TIMESTAMPTZ;
  v_aprobado_at TIMESTAMPTZ;
  v_monto_al_aprobar NUMERIC(14, 2);
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_editor_decision: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'editor' THEN
    RAISE EXCEPTION 'upsert_editor_decision: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision IS NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: decision es obligatoria'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_editor_decision: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'upsert_editor_decision: expediente fuera de la organización del editor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'upsert_editor_decision: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS TRUE THEN
    RAISE EXCEPTION 'upsert_editor_decision: no se puede editar decisión tras enviar a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'aprobado' THEN
    IF p_monto_aprobado IS NULL THEN
      RAISE EXCEPTION 'upsert_editor_decision: monto_aprobado es obligatorio cuando decision = aprobado'
        USING ERRCODE = '22023';
    END IF;
    IF p_monto_aprobado <= 0 THEN
      RAISE EXCEPTION 'upsert_editor_decision: monto_aprobado debe ser mayor a 0'
        USING ERRCODE = '22023';
    END IF;
    v_monto_final := round(p_monto_aprobado::NUMERIC, 2);
  ELSE
    v_monto_final := NULL;
  END IF;

  SELECT ed.*
  INTO v_prev
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  v_notas_final := COALESCE(v_motivo, CASE WHEN FOUND THEN v_prev.notas_revision ELSE '' END, '');

  -- Primera transición a aprobado: fija snapshot inmutable.
  IF p_decision = 'aprobado'
     AND (NOT FOUND OR v_prev.aprobado_at IS NULL)
     AND (NOT FOUND OR v_prev.decision IS DISTINCT FROM 'aprobado'::public.editor_decision)
  THEN
    v_aprobado_at := NOW();
    v_monto_al_aprobar := v_monto_final;
  ELSIF FOUND THEN
    v_aprobado_at := v_prev.aprobado_at;
    v_monto_al_aprobar := v_prev.monto_aprobado_al_aprobar;
  ELSE
    v_aprobado_at := NULL;
    v_monto_al_aprobar := NULL;
  END IF;

  INSERT INTO public.editor_decisions (
    expediente_id,
    organization_id,
    decision,
    monto_aprobado,
    notas_revision,
    decided_by,
    aprobado_at,
    monto_aprobado_al_aprobar
  ) VALUES (
    p_expediente_id,
    v_exp.organization_id,
    p_decision,
    v_monto_final,
    v_notas_final,
    v_actor_id,
    v_aprobado_at,
    v_monto_al_aprobar
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    notas_revision = CASE
      WHEN v_motivo IS NOT NULL THEN EXCLUDED.notas_revision
      ELSE public.editor_decisions.notas_revision
    END,
    decided_by = EXCLUDED.decided_by,
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
    END;

  SELECT ed.updated_at
  INTO v_updated_at
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'editor.decision.upsert',
    'editor_decision',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'decision_anterior', CASE WHEN v_prev.expediente_id IS NULL THEN NULL ELSE v_prev.decision END,
      'decision_nueva', p_decision,
      'monto_anterior', v_prev.monto_aprobado,
      'monto_nuevo', v_monto_final,
      'motivo', v_motivo,
      'editor_id', v_actor_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'decision', p_decision,
    'monto_aprobado', v_monto_final,
    'editor_id', v_actor_id,
    'updated_at', v_updated_at
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_editor_decision_pre_reingreso(UUID, public.editor_decision, NUMERIC, TEXT) IS
  'P081: editor guarda decisión pre-Mesa. Fija aprobado_at/monto_aprobado_al_aprobar solo en la 1ª transición a aprobado. Interna: no EXECUTE a authenticated.';

REVOKE ALL ON FUNCTION public.upsert_editor_decision_pre_reingreso(
  UUID, public.editor_decision, NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- 4) Escritura canónica — wrapper reingreso (ACL: authenticated + service_role)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_editor_decision(
  p_expediente_id UUID,
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
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_prev public.editor_decisions%ROWTYPE;
  v_monto NUMERIC(14, 2);
  v_motivo TEXT;
  v_base NUMERIC(12, 2);
  v_aprobado_at TIMESTAMPTZ;
  v_monto_al_aprobar NUMERIC(14, 2);
BEGIN
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

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision, decided_by,
    aprobado_at, monto_aprobado_al_aprobar
  ) VALUES (
    p_expediente_id, v_exp.organization_id, p_decision, v_monto,
    COALESCE(v_motivo, ''), v_actor_id,
    v_aprobado_at, v_monto_al_aprobar
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
    END;

  IF p_decision = 'aprobado' THEN
    v_base := CASE WHEN v_exp.programa = 'mejoravit'
      THEN least(round(v_monto * 0.89, 2), 169000)
      ELSE v_monto END;
    UPDATE public.cliente_datos
    SET monto_calculado = CASE
          WHEN porcentaje_cobro IS NULL THEN NULL
          ELSE round(v_base * porcentaje_cobro / 100 + 3000, 2)
        END,
        updated_at = NOW()
    WHERE expediente_id = p_expediente_id;
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
$$;

COMMENT ON FUNCTION public.upsert_editor_decision(UUID, public.editor_decision, NUMERIC, TEXT) IS
  'P081: editor guarda decisión (pre-Mesa o reingreso). Snapshot aprobado_at/monto_aprobado_al_aprobar solo en 1ª transición a aprobado.';

REVOKE ALL ON FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) TO authenticated, service_role, postgres;

-- =============================================================================
-- 5) Backfill seguro desde action_log
-- Semántica: primera transición a aprobado (decision_anterior IS DISTINCT FROM aprobado).
-- Incluye filas con evento confiable aunque hoy no estén en decision=aprobado
-- (exactitud histórica; evita re-aprobar con NOW() erroneo).
-- NO usa updated_at / created_at / monto_aprobado actual.
-- =============================================================================
WITH first_approval AS (
  SELECT DISTINCT ON (al.entity_id)
    al.entity_id AS expediente_id,
    al.created_at AS aprobado_at,
    round((al.payload->>'monto_nuevo')::NUMERIC, 2) AS monto_aprobado_al_aprobar
  FROM public.action_log al
  WHERE al.action = 'editor.decision.upsert'
    AND al.entity_type = 'editor_decision'
    AND al.payload->>'decision_nueva' = 'aprobado'
    AND (
      al.payload->>'decision_anterior' IS DISTINCT FROM 'aprobado'
      OR al.payload->>'decision_anterior' IS NULL
    )
    AND (al.payload->>'monto_nuevo') ~ '^[0-9]+(\.[0-9]+)?$'
    AND (al.payload->>'monto_nuevo')::NUMERIC > 0
  ORDER BY al.entity_id, al.created_at ASC
)
UPDATE public.editor_decisions ed
SET
  aprobado_at = fa.aprobado_at,
  monto_aprobado_al_aprobar = fa.monto_aprobado_al_aprobar
FROM first_approval fa
WHERE ed.expediente_id = fa.expediente_id
  AND ed.aprobado_at IS NULL
  AND ed.monto_aprobado_al_aprobar IS NULL;

-- =============================================================================
-- 6) Nota de contrato: asesor_update_monto_aprobado NO toca el snapshot
-- (solo muta monto_aprobado actual; sin cambios de cuerpo requeridos).
-- =============================================================================
COMMENT ON FUNCTION public.asesor_update_monto_aprobado(UUID, NUMERIC) IS
  'Asesor dueño registra monto_aprobado actual sin modificar decision ni snapshot P081 (aprobado_at / monto_aprobado_al_aprobar).';
