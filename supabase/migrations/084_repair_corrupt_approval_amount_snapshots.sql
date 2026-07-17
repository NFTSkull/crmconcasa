-- ConCasa CRM — P084: reparar snapshots monto_aprobado_al_aprobar corruptos
-- + bandera monto_aprobado_snapshot_no_recuperable para el caso sin re-aprobación.
-- Conserva aprobado_at / decisión / monto_aprobado actual / resto del expediente.
-- No modifica archivos de migraciones P081–P083 (sí redefine CHECK y, si aplica, RPCs aquí).
--
-- Universo Cloud (mejoravit, snap > 100000000, bounce <60s):
--   A) 2 filas con re-aprobación → monto_aprobado_al_aprobar = monto_nuevo reaprob
--   B) 1 fila sin re-aprobación → monto NULL + monto_aprobado_snapshot_no_recuperable = true
--      (aprobado_at se conserva; etiqueta producto: «Aprobación histórica con monto no recuperable»)
-- Total esperado: exactamente 3 (o 0 = noop idempotente).
--
-- Sin máximo oficial de monto_aprobado (169000 es tope de cobro, no de aprobación).

-- =============================================================================
-- 1) Columna de representación explícita
-- =============================================================================
ALTER TABLE public.editor_decisions
  ADD COLUMN IF NOT EXISTS monto_aprobado_snapshot_no_recuperable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.editor_decisions.monto_aprobado_snapshot_no_recuperable IS
  'P084: true = existe aprobado_at histórico pero el monto del snapshot no es recuperable (1ª aprobación corrupta sin re-aprobación confiable). monto_aprobado_al_aprobar queda NULL. Etiqueta UI: «Aprobación histórica con monto no recuperable».';

-- =============================================================================
-- 2) CHECK: permitir aprobado_at + monto NULL solo con la bandera
-- =============================================================================
ALTER TABLE public.editor_decisions
  DROP CONSTRAINT IF EXISTS editor_decisions_aprobado_snapshot_chk;

ALTER TABLE public.editor_decisions
  ADD CONSTRAINT editor_decisions_aprobado_snapshot_chk
  CHECK (
    (
      aprobado_at IS NULL
      AND monto_aprobado_al_aprobar IS NULL
      AND monto_aprobado_snapshot_no_recuperable = false
    )
    OR (
      aprobado_at IS NOT NULL
      AND monto_aprobado_al_aprobar IS NOT NULL
      AND monto_aprobado_al_aprobar > 0
      AND monto_aprobado_snapshot_no_recuperable = false
    )
    OR (
      aprobado_at IS NOT NULL
      AND monto_aprobado_al_aprobar IS NULL
      AND monto_aprobado_snapshot_no_recuperable = true
    )
  );

-- =============================================================================
-- 3) Reparación (preserva updated_at)
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
    RAISE EXCEPTION 'P084: trigger editor_decisions_set_updated_at no existe';
  END IF;
END $$;

ALTER TABLE public.editor_decisions DISABLE TRIGGER editor_decisions_set_updated_at;

DO $$
DECLARE
  v_candidates INTEGER;
  v_kind_a INTEGER;
  v_kind_b INTEGER;
  v_updated INTEGER;
BEGIN
  WITH first_ap AS (
    SELECT DISTINCT ON (al.entity_id)
      al.entity_id AS expediente_id,
      al.created_at AS first_at,
      round((al.payload->>'monto_nuevo')::NUMERIC, 2) AS first_monto
    FROM public.action_log al
    JOIN public.expedientes e ON e.id = al.entity_id
    WHERE al.action = 'editor.decision.upsert'
      AND al.entity_type = 'editor_decision'
      AND al.payload->>'decision_nueva' = 'aprobado'
      AND (
        al.payload->>'decision_anterior' IS DISTINCT FROM 'aprobado'
        OR al.payload->>'decision_anterior' IS NULL
      )
      AND (al.payload->>'monto_nuevo') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (al.payload->>'monto_nuevo')::NUMERIC > 100000000
      AND lower(btrim(e.programa::text)) = 'mejoravit'
      AND e.deleted_at IS NULL
    ORDER BY al.entity_id, al.created_at ASC
  ),
  bounce AS (
    SELECT DISTINCT ON (f.expediente_id)
      f.expediente_id,
      f.first_at,
      f.first_monto,
      al.created_at AS pendiente_at
    FROM first_ap f
    JOIN public.action_log al ON al.entity_id = f.expediente_id
    WHERE al.action = 'editor.decision.upsert'
      AND al.entity_type = 'editor_decision'
      AND al.payload->>'decision_nueva' = 'pendiente'
      AND al.created_at > f.first_at
      AND al.created_at < f.first_at + interval '60 seconds'
    ORDER BY f.expediente_id, al.created_at ASC
  ),
  reaprob AS (
    SELECT DISTINCT ON (b.expediente_id)
      b.expediente_id,
      round((al.payload->>'monto_nuevo')::NUMERIC, 2) AS reaprob_monto
    FROM bounce b
    JOIN public.action_log al ON al.entity_id = b.expediente_id
    WHERE al.action = 'editor.decision.upsert'
      AND al.entity_type = 'editor_decision'
      AND al.payload->>'decision_nueva' = 'aprobado'
      AND (
        al.payload->>'decision_anterior' IS DISTINCT FROM 'aprobado'
        OR al.payload->>'decision_anterior' IS NULL
      )
      AND al.created_at > b.pendiente_at
      AND (al.payload->>'monto_nuevo') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (al.payload->>'monto_nuevo')::NUMERIC > 0
      AND (al.payload->>'monto_nuevo')::NUMERIC <= 100000000
    ORDER BY b.expediente_id, al.created_at ASC
  ),
  repair_candidates AS (
    SELECT
      b.expediente_id,
      r.reaprob_monto AS new_monto,
      false AS no_recuperable,
      'reaprob'::TEXT AS repair_kind
    FROM bounce b
    JOIN reaprob r ON r.expediente_id = b.expediente_id
    JOIN public.editor_decisions ed ON ed.expediente_id = b.expediente_id
    WHERE ed.monto_aprobado_al_aprobar IS NOT DISTINCT FROM b.first_monto
      AND ed.monto_aprobado_al_aprobar > 100000000
      AND ed.monto_aprobado_snapshot_no_recuperable = false

    UNION ALL

    SELECT
      b.expediente_id,
      NULL::NUMERIC AS new_monto,
      true AS no_recuperable,
      'no_recuperable'::TEXT AS repair_kind
    FROM bounce b
    LEFT JOIN reaprob r ON r.expediente_id = b.expediente_id
    JOIN public.editor_decisions ed ON ed.expediente_id = b.expediente_id
    WHERE r.expediente_id IS NULL
      AND ed.monto_aprobado_al_aprobar IS NOT DISTINCT FROM b.first_monto
      AND ed.monto_aprobado_al_aprobar > 100000000
      AND ed.monto_aprobado_snapshot_no_recuperable = false
  )
  SELECT
    count(*)::INTEGER,
    count(*) FILTER (WHERE repair_kind = 'reaprob')::INTEGER,
    count(*) FILTER (WHERE repair_kind = 'no_recuperable')::INTEGER
  INTO v_candidates, v_kind_a, v_kind_b
  FROM repair_candidates;

  IF v_candidates = 0 THEN
    RAISE NOTICE 'P084: sin candidatos de reparación (noop idempotente)';
    RETURN;
  END IF;

  IF v_candidates <> 3 THEN
    RAISE EXCEPTION 'P084 expected 3 repair candidates, found %', v_candidates;
  END IF;
  IF v_kind_a <> 2 OR v_kind_b <> 1 THEN
    RAISE EXCEPTION
      'P084 expected 2 reaprob + 1 no_recuperable, found reaprob=% no_recuperable=%',
      v_kind_a, v_kind_b;
  END IF;

  WITH first_ap AS (
    SELECT DISTINCT ON (al.entity_id)
      al.entity_id AS expediente_id,
      al.created_at AS first_at,
      round((al.payload->>'monto_nuevo')::NUMERIC, 2) AS first_monto
    FROM public.action_log al
    JOIN public.expedientes e ON e.id = al.entity_id
    WHERE al.action = 'editor.decision.upsert'
      AND al.entity_type = 'editor_decision'
      AND al.payload->>'decision_nueva' = 'aprobado'
      AND (
        al.payload->>'decision_anterior' IS DISTINCT FROM 'aprobado'
        OR al.payload->>'decision_anterior' IS NULL
      )
      AND (al.payload->>'monto_nuevo') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (al.payload->>'monto_nuevo')::NUMERIC > 100000000
      AND lower(btrim(e.programa::text)) = 'mejoravit'
      AND e.deleted_at IS NULL
    ORDER BY al.entity_id, al.created_at ASC
  ),
  bounce AS (
    SELECT DISTINCT ON (f.expediente_id)
      f.expediente_id,
      f.first_at,
      f.first_monto,
      al.created_at AS pendiente_at
    FROM first_ap f
    JOIN public.action_log al ON al.entity_id = f.expediente_id
    WHERE al.action = 'editor.decision.upsert'
      AND al.entity_type = 'editor_decision'
      AND al.payload->>'decision_nueva' = 'pendiente'
      AND al.created_at > f.first_at
      AND al.created_at < f.first_at + interval '60 seconds'
    ORDER BY f.expediente_id, al.created_at ASC
  ),
  reaprob AS (
    SELECT DISTINCT ON (b.expediente_id)
      b.expediente_id,
      round((al.payload->>'monto_nuevo')::NUMERIC, 2) AS reaprob_monto
    FROM bounce b
    JOIN public.action_log al ON al.entity_id = b.expediente_id
    WHERE al.action = 'editor.decision.upsert'
      AND al.entity_type = 'editor_decision'
      AND al.payload->>'decision_nueva' = 'aprobado'
      AND (
        al.payload->>'decision_anterior' IS DISTINCT FROM 'aprobado'
        OR al.payload->>'decision_anterior' IS NULL
      )
      AND al.created_at > b.pendiente_at
      AND (al.payload->>'monto_nuevo') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (al.payload->>'monto_nuevo')::NUMERIC > 0
      AND (al.payload->>'monto_nuevo')::NUMERIC <= 100000000
    ORDER BY b.expediente_id, al.created_at ASC
  ),
  repair_candidates AS (
    SELECT
      b.expediente_id,
      r.reaprob_monto AS new_monto,
      false AS no_recuperable
    FROM bounce b
    JOIN reaprob r ON r.expediente_id = b.expediente_id
    JOIN public.editor_decisions ed ON ed.expediente_id = b.expediente_id
    WHERE ed.monto_aprobado_al_aprobar IS NOT DISTINCT FROM b.first_monto
      AND ed.monto_aprobado_al_aprobar > 100000000
      AND ed.monto_aprobado_snapshot_no_recuperable = false

    UNION ALL

    SELECT
      b.expediente_id,
      NULL::NUMERIC AS new_monto,
      true AS no_recuperable
    FROM bounce b
    LEFT JOIN reaprob r ON r.expediente_id = b.expediente_id
    JOIN public.editor_decisions ed ON ed.expediente_id = b.expediente_id
    WHERE r.expediente_id IS NULL
      AND ed.monto_aprobado_al_aprobar IS NOT DISTINCT FROM b.first_monto
      AND ed.monto_aprobado_al_aprobar > 100000000
      AND ed.monto_aprobado_snapshot_no_recuperable = false
  )
  UPDATE public.editor_decisions ed
  SET
    monto_aprobado_al_aprobar = rc.new_monto,
    monto_aprobado_snapshot_no_recuperable = rc.no_recuperable
  FROM repair_candidates rc
  WHERE ed.expediente_id = rc.expediente_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 3 THEN
    RAISE EXCEPTION 'P084 expected to update 3 rows, updated %', v_updated;
  END IF;
END $$;

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
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'P084: trigger editor_decisions_set_updated_at no quedó habilitado';
  END IF;
END $$;

COMMENT ON COLUMN public.editor_decisions.monto_aprobado_al_aprobar IS
  'P081/P084: snapshot de monto en la 1ª transición a aprobado. NULL + monto_aprobado_snapshot_no_recuperable=true = monto histórico no recuperable (P084).';

-- =============================================================================
-- 4) Auto-limpiar bandera si aparece un monto snapshot válido
-- =============================================================================
CREATE OR REPLACE FUNCTION public.editor_decisions_clear_no_recuperable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Solo true → false; nunca inventa montos ni pone la bandera en true.
  IF NEW.monto_aprobado_snapshot_no_recuperable IS TRUE
     AND NEW.monto_aprobado_al_aprobar IS NOT NULL
     AND NEW.monto_aprobado_al_aprobar > 0 THEN
    NEW.monto_aprobado_snapshot_no_recuperable := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS editor_decisions_clear_no_recuperable ON public.editor_decisions;
CREATE TRIGGER editor_decisions_clear_no_recuperable
  BEFORE INSERT OR UPDATE OF monto_aprobado_al_aprobar
  ON public.editor_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public.editor_decisions_clear_no_recuperable();

COMMENT ON FUNCTION public.editor_decisions_clear_no_recuperable() IS
  'P084: si se fija un monto_aprobado_al_aprobar válido, limpia monto_aprobado_snapshot_no_recuperable.';

-- =============================================================================
-- 5) Admin list: exponer bandera (sin cambiar firma RPC)
-- =============================================================================
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
      ed.monto_aprobado_snapshot_no_recuperable,
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
  'P082/P083/P084 Admin RO: incluye monto_aprobado_snapshot_no_recuperable; montos Mejoravit excluyen snaps NULL.';
