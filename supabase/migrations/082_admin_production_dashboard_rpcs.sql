-- ConCasa CRM — P082: RPCs read-only Admin producción por periodo
-- Requiere P081 (aprobado_at / monto_aprobado_al_aprobar).
-- Solo super_admin. Sin service role en frontend. No mutaciones.

-- =============================================================================
-- Helper: actor super_admin activo
-- =============================================================================
CREATE OR REPLACE FUNCTION public.__admin_require_super_admin()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_role public.app_role;
  v_active BOOLEAN;
BEGIN
  v_id := public.current_profile_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'admin_production: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active INTO v_role, v_active
  FROM public.profiles p WHERE p.id = v_id;

  IF NOT FOUND OR v_active IS NOT TRUE OR v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'admin_production: solo super_admin' USING ERRCODE = '42501';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.__admin_require_super_admin() FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- Resumen ejecutivo (4 KPIs)
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
    count(*),
    count(*) FILTER (WHERE ed.monto_aprobado_al_aprobar > 20000),
    coalesce(sum(ed.monto_aprobado_al_aprobar), 0)
  INTO v_aprobadas, v_mayor, v_monto
  FROM public.editor_decisions ed
  JOIN public.expedientes e ON e.id = ed.expediente_id
  WHERE e.deleted_at IS NULL
    AND ed.aprobado_at IS NOT NULL
    AND ed.monto_aprobado_al_aprobar IS NOT NULL
    AND ed.aprobado_at >= p_from
    AND ed.aprobado_at < p_to_exclusive
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id);

  RETURN jsonb_build_object(
    'enviados_a_mesa', v_enviados,
    'precalificaciones_aprobadas', v_aprobadas,
    'aprobadas_mayor_a_20000', v_mayor,
    'monto_aprobado_total', v_monto
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_production_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, SMALLINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_production_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, SMALLINT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_production_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, SMALLINT, TEXT) TO authenticated;

-- =============================================================================
-- Distribución por etapa actual (cohorte enviados en periodo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_mesa_cohort_by_etapa(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_asesor_id UUID DEFAULT NULL,
  p_estado TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_rows JSONB;
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  WITH cohort AS (
    SELECT e.etapa_actual
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa >= p_from
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (
        p_estado IS NULL
        OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (p_estado = 'rechazados' AND (e.subestado = 'rechazado' OR e.ciclo_estado = 'cancelado'))
      )
  )
  SELECT count(*) INTO v_total FROM cohort;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'etapa', g.etapa,
      'count', g.cnt,
      'pct', CASE WHEN v_total = 0 THEN 0 ELSE round((g.cnt::NUMERIC * 1000 / v_total) / 10.0, 1) END
    )
    ORDER BY g.etapa
  ), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT s.etapa, coalesce(c.cnt, 0) AS cnt
    FROM generate_series(1, 12) AS s(etapa)
    LEFT JOIN (
      SELECT etapa_actual AS etapa, count(*)::BIGINT AS cnt
      FROM public.expedientes e
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
        AND e.fecha_envio_mesa >= p_from
        AND e.fecha_envio_mesa < p_to_exclusive
        AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
        AND (
          p_estado IS NULL
          OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
          OR (p_estado = 'rechazados' AND (e.subestado = 'rechazado' OR e.ciclo_estado = 'cancelado'))
        )
      GROUP BY etapa_actual
    ) c ON c.etapa = s.etapa
  ) g;

  RETURN jsonb_build_object('total', v_total, 'by_etapa', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_mesa_cohort_by_etapa(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_mesa_cohort_by_etapa(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_mesa_cohort_by_etapa(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) TO authenticated;

-- =============================================================================
-- Producción por asesor
-- =============================================================================
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
             count(*)::BIGINT AS aprobadas,
             count(*) FILTER (WHERE ed.monto_aprobado_al_aprobar > 20000)::BIGINT AS mayor,
             coalesce(sum(ed.monto_aprobado_al_aprobar), 0)::NUMERIC(14,2) AS monto_total
      FROM public.editor_decisions ed
      JOIN public.expedientes e ON e.id = ed.expediente_id
      WHERE e.deleted_at IS NULL
        AND ed.aprobado_at IS NOT NULL
        AND ed.monto_aprobado_al_aprobar IS NOT NULL
        AND ed.aprobado_at >= p_from
        AND ed.aprobado_at < p_to_exclusive
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

-- =============================================================================
-- Página expedientes enviados a Mesa
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_mesa_envios_page(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_asesor_id UUID DEFAULT NULL,
  p_etapa_actual SMALLINT DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
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
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  SELECT count(*) INTO v_total
  FROM public.expedientes e
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
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
    )
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
    );

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      e.id AS expediente_id,
      e.fecha_envio_mesa,
      e.cliente_nombre,
      e.asesor_id,
      nullif(btrim(p.full_name), '') AS asesor_nombre,
      p.email AS asesor_email,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.programa::text AS programa,
      ed.monto_aprobado AS monto_aprobado_actual,
      ed.monto_aprobado_al_aprobar,
      e.updated_at
    FROM public.expedientes e
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
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
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
    ORDER BY e.fecha_envio_mesa DESC, e.id DESC
    OFFSET v_offset LIMIT v_size
  ) t;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'page', v_page,
    'page_size', v_size,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) TO authenticated;

-- =============================================================================
-- Página precalificaciones (eventos de primera aprobación)
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
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  SELECT count(*) INTO v_total
  FROM public.editor_decisions ed
  JOIN public.expedientes e ON e.id = ed.expediente_id
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND ed.aprobado_at IS NOT NULL
    AND ed.monto_aprobado_al_aprobar IS NOT NULL
    AND ed.aprobado_at >= p_from
    AND ed.aprobado_at < p_to_exclusive
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
    )
    AND (
      p_decision_filter IS NULL
      OR p_decision_filter = 'todas'
      OR p_decision_filter = 'aprobadas'
      OR (p_decision_filter = 'aprobadas_mayor_20000' AND ed.monto_aprobado_al_aprobar > 20000)
      OR (p_decision_filter = 'no_cumple' AND ed.decision = 'no_cumple')
      OR (p_decision_filter = 'pendientes' AND ed.decision = 'pendiente')
    );

  SELECT jsonb_build_object(
    'total', count(*),
    'aprobadas', count(*),
    'aprobadas_mayor_a_20000', count(*) FILTER (WHERE ed.monto_aprobado_al_aprobar > 20000),
    'no_cumple', count(*) FILTER (WHERE ed.decision = 'no_cumple'),
    'pendientes', count(*) FILTER (WHERE ed.decision = 'pendiente'),
    'monto_aprobado_total', coalesce(sum(ed.monto_aprobado_al_aprobar), 0),
    'monto_promedio_aprobado', CASE WHEN count(*) = 0 THEN 0
      ELSE round(avg(ed.monto_aprobado_al_aprobar), 2) END
  )
  INTO v_sum
  FROM public.editor_decisions ed
  JOIN public.expedientes e ON e.id = ed.expediente_id
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND ed.aprobado_at IS NOT NULL
    AND ed.monto_aprobado_al_aprobar IS NOT NULL
    AND ed.aprobado_at >= p_from
    AND ed.aprobado_at < p_to_exclusive
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
    )
    AND (
      p_decision_filter IS NULL
      OR p_decision_filter = 'todas'
      OR p_decision_filter = 'aprobadas'
      OR (p_decision_filter = 'aprobadas_mayor_20000' AND ed.monto_aprobado_al_aprobar > 20000)
      OR (p_decision_filter = 'no_cumple' AND ed.decision = 'no_cumple')
      OR (p_decision_filter = 'pendientes' AND ed.decision = 'pendiente')
    );

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ed.expediente_id,
      ed.aprobado_at,
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
      AND ed.aprobado_at IS NOT NULL
      AND ed.monto_aprobado_al_aprobar IS NOT NULL
      AND ed.aprobado_at >= p_from
      AND ed.aprobado_at < p_to_exclusive
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
      AND (
        p_decision_filter IS NULL
        OR p_decision_filter = 'todas'
        OR p_decision_filter = 'aprobadas'
        OR (p_decision_filter = 'aprobadas_mayor_20000' AND ed.monto_aprobado_al_aprobar > 20000)
        OR (p_decision_filter = 'no_cumple' AND ed.decision = 'no_cumple')
        OR (p_decision_filter = 'pendientes' AND ed.decision = 'pendiente')
      )
    ORDER BY ed.aprobado_at DESC, ed.expediente_id DESC
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

COMMENT ON FUNCTION public.admin_get_production_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, SMALLINT, TEXT) IS
  'P082 Admin RO: 4 KPIs de producción por periodo (fecha_envio_mesa / aprobado_at + monto_aprobado_al_aprobar).';
COMMENT ON FUNCTION public.admin_get_mesa_cohort_by_etapa(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) IS
  'P082 Admin RO: estado actual por etapa de cohorte enviada a Mesa en el periodo.';
COMMENT ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) IS
  'P082 Admin RO: producción agregada por asesor_id (full_name prioritario).';
COMMENT ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) IS
  'P082 Admin RO: página de enviados a Mesa (count exacto, sin dump completo).';
COMMENT ON FUNCTION public.admin_list_precalificaciones_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, TEXT, TEXT) IS
  'P082 Admin RO: página de primeras aprobaciones del periodo (monto_aprobado_al_aprobar).';
