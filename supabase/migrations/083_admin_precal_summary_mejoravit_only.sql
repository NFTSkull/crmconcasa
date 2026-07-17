-- ConCasa CRM — P083: no_cumple_at canónico + Admin Precal diarias (Mejoravit)
-- Extiende P081/P082 sin modificar esos archivos.
-- - columna editor_decisions.no_cumple_at (1ª transición a no_cumple, inmutable)
-- - backfill desde action_log
-- - upsert_editor_decision(_pre_reingreso) fijan no_cumple_at
-- - RPCs Admin: KPIs No cumple + listado por aprobado_at / no_cumple_at (sin updated_at)
-- NO aplicar a Cloud sin autorización explícita.

-- =============================================================================
-- 1) Columna + índice
-- =============================================================================
ALTER TABLE public.editor_decisions
  ADD COLUMN IF NOT EXISTS no_cumple_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.editor_decisions.no_cumple_at IS
  'P083: timestamp de la primera transición a decision=no_cumple. Inmutable. Métricas Admin de rechazo usan este campo (no updated_at).';

CREATE INDEX IF NOT EXISTS editor_decisions_no_cumple_at_idx
  ON public.editor_decisions (no_cumple_at DESC)
  WHERE no_cumple_at IS NOT NULL;

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
  v_no_cumple_at TIMESTAMPTZ;
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

  -- Primera transición a no_cumple: fija no_cumple_at inmutable.
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
    expediente_id,
    organization_id,
    decision,
    monto_aprobado,
    notas_revision,
    decided_by,
    aprobado_at,
    monto_aprobado_al_aprobar,
    no_cumple_at
  ) VALUES (
    p_expediente_id,
    v_exp.organization_id,
    p_decision,
    v_monto_final,
    v_notas_final,
    v_actor_id,
    v_aprobado_at,
    v_monto_al_aprobar,
    v_no_cumple_at
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
    END,
    no_cumple_at = CASE
      WHEN public.editor_decisions.no_cumple_at IS NULL
           AND EXCLUDED.decision = 'no_cumple'::public.editor_decision
           AND public.editor_decisions.decision IS DISTINCT FROM 'no_cumple'::public.editor_decision
      THEN NOW()
      ELSE public.editor_decisions.no_cumple_at
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
  'P081/P083: editor pre-Mesa. Snapshot aprobado_at/monto_aprobado_al_aprobar (1ª aprobado) y no_cumple_at (1ª no_cumple). Interna: no EXECUTE a authenticated.';

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
  v_no_cumple_at TIMESTAMPTZ;
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

  -- Primera transición a no_cumple: fija no_cumple_at inmutable.
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
  'P081/P083: editor (pre-Mesa o reingreso). Snapshots aprobado_at/monto_aprobado_al_aprobar y no_cumple_at en 1ª transición respectiva.';

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
-- 5) Backfill no_cumple_at (preserva updated_at: DISABLE/ENABLE trigger puntual)
-- DISABLE/ENABLE TRIGGER es transaccional en PostgreSQL: si la migración falla,
-- el rollback restaura el estado previo del trigger.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'editor_decisions'
      AND t.tgname = 'editor_decisions_set_updated_at'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'P083: trigger editor_decisions_set_updated_at no existe';
  END IF;
END $$;

ALTER TABLE public.editor_decisions DISABLE TRIGGER editor_decisions_set_updated_at;

WITH first_no_cumple AS (
  SELECT DISTINCT ON (al.entity_id)
    al.entity_id AS expediente_id,
    al.created_at AS no_cumple_at
  FROM public.action_log al
  WHERE al.action = 'editor.decision.upsert'
    AND al.entity_type = 'editor_decision'
    AND al.payload->>'decision_nueva' = 'no_cumple'
    AND (
      al.payload->>'decision_anterior' IS DISTINCT FROM 'no_cumple'
      OR al.payload->>'decision_anterior' IS NULL
    )
  ORDER BY al.entity_id, al.created_at ASC
)
UPDATE public.editor_decisions ed
SET no_cumple_at = f.no_cumple_at
FROM first_no_cumple f
WHERE ed.expediente_id = f.expediente_id
  AND ed.no_cumple_at IS NULL;

ALTER TABLE public.editor_decisions ENABLE TRIGGER editor_decisions_set_updated_at;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'editor_decisions'
      AND t.tgname = 'editor_decisions_set_updated_at'
      AND t.tgenabled = 'O'  -- Origin / enabled
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'P083: trigger editor_decisions_set_updated_at no quedó habilitado';
  END IF;
END $$;


-- =============================================================================
-- 6) Admin RPCs: KPIs + precal page (aprobado_at / no_cumple_at; sin updated_at)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_production_summary(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_asesor_id UUID DEFAULT NULL,
  p_etapa_actual SMALLINT DEFAULT NULL,
  p_estado TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enviados BIGINT;
  v_aprobadas BIGINT;
  v_no_cumple BIGINT;
  v_mayor BIGINT;
  v_monto NUMERIC(14, 2);
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_enviados
  FROM public.expedientes e
  WHERE e.deleted_at IS NULL
    AND e.submitted_to_mesa = TRUE
    AND e.fecha_envio_mesa IS NOT NULL
    AND e.fecha_envio_mesa >= p_from
    AND e.fecha_envio_mesa < p_to_exclusive
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
    AND (
      p_estado IS NULL
      OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
      OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
      OR (p_estado = 'rechazados' AND (e.subestado = 'rechazado' OR e.ciclo_estado = 'cancelado'))
    );

  SELECT
    count(*) FILTER (
      WHERE ed.decision = 'aprobado'
        AND ed.aprobado_at IS NOT NULL
        AND ed.aprobado_at >= p_from
        AND ed.aprobado_at < p_to_exclusive
    ),
    count(*) FILTER (
      WHERE ed.decision = 'no_cumple'
        AND ed.no_cumple_at IS NOT NULL
        AND ed.no_cumple_at >= p_from
        AND ed.no_cumple_at < p_to_exclusive
    ),
    count(*) FILTER (
      WHERE ed.decision = 'aprobado'
        AND ed.aprobado_at IS NOT NULL
        AND ed.aprobado_at >= p_from
        AND ed.aprobado_at < p_to_exclusive
        AND ed.monto_aprobado_al_aprobar IS NOT NULL
        AND ed.monto_aprobado_al_aprobar > 20000
    ),
    coalesce(
      sum(ed.monto_aprobado_al_aprobar) FILTER (
        WHERE ed.decision = 'aprobado'
          AND ed.aprobado_at IS NOT NULL
          AND ed.aprobado_at >= p_from
          AND ed.aprobado_at < p_to_exclusive
          AND lower(btrim(e.programa::text)) = 'mejoravit'
          AND ed.monto_aprobado_al_aprobar IS NOT NULL
          AND ed.monto_aprobado_al_aprobar > 0
      ),
      0
    )
  INTO v_aprobadas, v_no_cumple, v_mayor, v_monto
  FROM public.editor_decisions ed
  JOIN public.expedientes e ON e.id = ed.expediente_id
  WHERE e.deleted_at IS NULL
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id);

  RETURN jsonb_build_object(
    'enviados_a_mesa', v_enviados,
    'precalificaciones_aprobadas', v_aprobadas,
    'precalificaciones_no_cumple', v_no_cumple,
    'aprobadas_mayor_a_20000', v_mayor,
    'monto_aprobado_total', v_monto
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_production_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, SMALLINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_production_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, SMALLINT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_production_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, SMALLINT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_get_production_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, SMALLINT, TEXT) IS
  'P082/P083 Admin RO: KPIs; aprobadas por aprobado_at; no_cumple por no_cumple_at; monto solo Mejoravit aprobado.';

CREATE OR REPLACE FUNCTION public.admin_list_production_by_asesor(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_estado TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  RETURN coalesce((
    WITH envios AS (
      SELECT e.asesor_id, e.etapa_actual, count(*)::BIGINT AS cnt
      FROM public.expedientes e
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
        AND e.fecha_envio_mesa >= p_from
        AND e.fecha_envio_mesa < p_to_exclusive
        AND (
          p_estado IS NULL
          OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
          OR (p_estado = 'rechazados' AND (e.subestado = 'rechazado' OR e.ciclo_estado = 'cancelado'))
        )
      GROUP BY e.asesor_id, e.etapa_actual
    ),
    envios_tot AS (
      SELECT asesor_id, sum(cnt)::BIGINT AS enviados
      FROM envios GROUP BY asesor_id
    ),
    aprob AS (
      SELECT e.asesor_id,
             count(*) FILTER (
               WHERE ed.decision = 'aprobado'
                 AND ed.aprobado_at IS NOT NULL
                 AND ed.aprobado_at >= p_from
                 AND ed.aprobado_at < p_to_exclusive
             )::BIGINT AS aprobadas,
             count(*) FILTER (
               WHERE ed.decision = 'no_cumple'
                 AND ed.no_cumple_at IS NOT NULL
                 AND ed.no_cumple_at >= p_from
                 AND ed.no_cumple_at < p_to_exclusive
             )::BIGINT AS no_cumple,
             count(*) FILTER (
               WHERE ed.decision = 'aprobado'
                 AND ed.aprobado_at IS NOT NULL
                 AND ed.aprobado_at >= p_from
                 AND ed.aprobado_at < p_to_exclusive
                 AND ed.monto_aprobado_al_aprobar > 20000
             )::BIGINT AS mayor,
             coalesce(
               sum(ed.monto_aprobado_al_aprobar) FILTER (
                 WHERE ed.decision = 'aprobado'
                   AND ed.aprobado_at IS NOT NULL
                   AND ed.aprobado_at >= p_from
                   AND ed.aprobado_at < p_to_exclusive
                   AND lower(btrim(e.programa::text)) = 'mejoravit'
                   AND ed.monto_aprobado_al_aprobar IS NOT NULL
                   AND ed.monto_aprobado_al_aprobar > 0
               ),
               0
             )::NUMERIC(14,2) AS monto_total
      FROM public.editor_decisions ed
      JOIN public.expedientes e ON e.id = ed.expediente_id
      WHERE e.deleted_at IS NULL
      GROUP BY e.asesor_id
    ),
    asesores AS (
      SELECT DISTINCT asesor_id FROM envios_tot
      UNION
      SELECT DISTINCT asesor_id FROM aprob
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'asesor_id', a.asesor_id,
        'asesor_nombre', nullif(btrim(p.full_name), ''),
        'asesor_email', p.email,
        'enviados_a_mesa', coalesce(et.enviados, 0),
        'precalificaciones_aprobadas', coalesce(ap.aprobadas, 0),
        'precalificaciones_no_cumple', coalesce(ap.no_cumple, 0),
        'aprobadas_mayor_a_20000', coalesce(ap.mayor, 0),
        'monto_aprobado_total', coalesce(ap.monto_total, 0),
        'etapas', coalesce((
          SELECT jsonb_object_agg(en.etapa_actual::text, en.cnt)
          FROM envios en WHERE en.asesor_id = a.asesor_id
        ), '{}'::jsonb)
      )
      ORDER BY coalesce(et.enviados, 0) DESC, coalesce(ap.monto_total, 0) DESC
    )
    FROM asesores a
    LEFT JOIN envios_tot et ON et.asesor_id = a.asesor_id
    LEFT JOIN aprob ap ON ap.asesor_id = a.asesor_id
    LEFT JOIN public.profiles p ON p.id = a.asesor_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_precalificaciones_page(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_asesor_id UUID DEFAULT NULL,
  p_decision_filter TEXT DEFAULT NULL,
  p_buscar TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page INTEGER;
  v_size INTEGER;
  v_offset INTEGER;
  v_total BIGINT;
  v_q TEXT;
  v_items JSONB;
  v_sum JSONB;
  v_filter TEXT;
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');
  v_filter := coalesce(nullif(btrim(p_decision_filter), ''), 'resueltas');

  SELECT count(*) INTO v_total
  FROM public.editor_decisions ed
  JOIN public.expedientes e ON e.id = ed.expediente_id
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
    )
    AND (
      (
        v_filter IN ('resueltas', 'todas', 'aprobadas')
        AND ed.decision = 'aprobado'
        AND ed.aprobado_at IS NOT NULL
        AND ed.aprobado_at >= p_from
        AND ed.aprobado_at < p_to_exclusive
      )
      OR (
        v_filter IN ('resueltas', 'todas', 'no_cumple')
        AND ed.decision = 'no_cumple'
        AND ed.no_cumple_at IS NOT NULL
        AND ed.no_cumple_at >= p_from
        AND ed.no_cumple_at < p_to_exclusive
      )
      OR (
        v_filter IN ('todas', 'pendientes')
        AND ed.decision = 'pendiente'
      )
    );

  SELECT jsonb_build_object(
    'resueltas_count', count(*) FILTER (
      WHERE ed.decision IN ('aprobado', 'no_cumple')
    ),
    'aprobadas_count', count(*) FILTER (WHERE ed.decision = 'aprobado'),
    'no_cumple_count', count(*) FILTER (WHERE ed.decision = 'no_cumple'),
    'pendientes_actuales_count', count(*) FILTER (WHERE ed.decision = 'pendiente'),
    'mayores_20000_count', count(*) FILTER (
      WHERE ed.decision = 'aprobado'
        AND ed.monto_aprobado_al_aprobar IS NOT NULL
        AND ed.monto_aprobado_al_aprobar > 20000
    ),
    'mejoravit_aprobadas_count', count(*) FILTER (
      WHERE ed.decision = 'aprobado'
        AND lower(btrim(e.programa::text)) = 'mejoravit'
        AND ed.monto_aprobado_al_aprobar IS NOT NULL
        AND ed.monto_aprobado_al_aprobar > 0
    ),
    'monto_mejoravit_total', coalesce(
      sum(ed.monto_aprobado_al_aprobar) FILTER (
        WHERE ed.decision = 'aprobado'
          AND lower(btrim(e.programa::text)) = 'mejoravit'
          AND ed.monto_aprobado_al_aprobar IS NOT NULL
          AND ed.monto_aprobado_al_aprobar > 0
      ),
      0
    ),
    'monto_mejoravit_promedio', CASE
      WHEN count(*) FILTER (
        WHERE ed.decision = 'aprobado'
          AND lower(btrim(e.programa::text)) = 'mejoravit'
          AND ed.monto_aprobado_al_aprobar IS NOT NULL
          AND ed.monto_aprobado_al_aprobar > 0
      ) = 0 THEN 0
      ELSE round(
        avg(ed.monto_aprobado_al_aprobar) FILTER (
          WHERE ed.decision = 'aprobado'
            AND lower(btrim(e.programa::text)) = 'mejoravit'
            AND ed.monto_aprobado_al_aprobar IS NOT NULL
            AND ed.monto_aprobado_al_aprobar > 0
        ),
        2
      )
    END
  )
  INTO v_sum
  FROM public.editor_decisions ed
  JOIN public.expedientes e ON e.id = ed.expediente_id
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
    )
    AND (
      (
        v_filter IN ('resueltas', 'todas', 'aprobadas')
        AND ed.decision = 'aprobado'
        AND ed.aprobado_at IS NOT NULL
        AND ed.aprobado_at >= p_from
        AND ed.aprobado_at < p_to_exclusive
      )
      OR (
        v_filter IN ('resueltas', 'todas', 'no_cumple')
        AND ed.decision = 'no_cumple'
        AND ed.no_cumple_at IS NOT NULL
        AND ed.no_cumple_at >= p_from
        AND ed.no_cumple_at < p_to_exclusive
      )
      OR (
        v_filter IN ('todas', 'pendientes')
        AND ed.decision = 'pendiente'
      )
    );

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ed.expediente_id,
      CASE
        WHEN ed.decision = 'aprobado' THEN ed.aprobado_at
        WHEN ed.decision = 'no_cumple' THEN ed.no_cumple_at
        ELSE NULL
      END AS fecha,
      ed.aprobado_at,
      ed.no_cumple_at,
      e.cliente_nombre,
      e.asesor_id,
      nullif(btrim(p.full_name), '') AS asesor_nombre,
      p.email AS asesor_email,
      ed.decision::text AS decision,
      ed.monto_aprobado_al_aprobar,
      ed.monto_aprobado AS monto_aprobado_actual,
      e.programa::text AS programa
    FROM public.editor_decisions ed
    JOIN public.expedientes e ON e.id = ed.expediente_id
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
      AND (
        (
          v_filter IN ('resueltas', 'todas', 'aprobadas')
          AND ed.decision = 'aprobado'
          AND ed.aprobado_at IS NOT NULL
          AND ed.aprobado_at >= p_from
          AND ed.aprobado_at < p_to_exclusive
        )
        OR (
          v_filter IN ('resueltas', 'todas', 'no_cumple')
          AND ed.decision = 'no_cumple'
          AND ed.no_cumple_at IS NOT NULL
          AND ed.no_cumple_at >= p_from
          AND ed.no_cumple_at < p_to_exclusive
        )
        OR (
          v_filter IN ('todas', 'pendientes')
          AND ed.decision = 'pendiente'
        )
      )
    ORDER BY
      CASE
        WHEN ed.decision = 'aprobado' THEN ed.aprobado_at
        WHEN ed.decision = 'no_cumple' THEN ed.no_cumple_at
        ELSE NULL
      END DESC NULLS LAST,
      ed.expediente_id DESC
    OFFSET v_offset LIMIT v_size
  ) t;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'page', v_page,
    'page_size', v_size,
    'summary', v_sum,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_precalificaciones_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_precalificaciones_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_precalificaciones_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_list_precalificaciones_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, TEXT, TEXT) IS
  'P082/P083 Admin RO: resueltas por aprobado_at/no_cumple_at; pendientes actuales sin updated_at; montos Mejoravit.';

COMMENT ON FUNCTION public.asesor_update_monto_aprobado(UUID, NUMERIC) IS
  'Asesor dueño registra monto_aprobado actual sin modificar decision ni snapshots P081/P083 (aprobado_at / monto_aprobado_al_aprobar / no_cumple_at).';
