-- ConCasa CRM — Admin: conversión a Mesa sobre cohorte aprobada > $20,000.
--
-- Regla:
-- * "NSS compartido" = el mismo NSS fue precalificado por 2+ asesores distintos
--   dentro del periodo seleccionado.
-- * Una re-precalificación hecha por el mismo asesor NO cuenta como NSS compartido.
-- * Las re-precalificaciones siguen contando dentro de "Precalificaciones" y se
--   muestran por separado como métrica/control operativo.
-- * La búsqueda puede encontrar al "otro asesor" que comparte el NSS. Ejemplo:
--   filtrar ANETTE + buscar MARCE RAMIREZ devuelve solo los NSS que ambas tocaron.
-- * Solo lectura. No modifica expedientes, decisiones ni historial.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_precal_performance(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_asesor_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_detail_filter TEXT DEFAULT 'todos'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_page INTEGER;
  v_page_size INTEGER;
  v_offset INTEGER;
  v_search TEXT;
  v_detail_filter TEXT;
  v_result JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  SELECT p.organization_id
  INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.active = true;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_precal_performance: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_precal_performance: rango inválido'
      USING ERRCODE = '22023';
  END IF;

  v_page := greatest(coalesce(p_page, 1), 1);
  v_page_size := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_offset := (v_page - 1) * v_page_size;
  v_search := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_detail_filter := lower(btrim(coalesce(p_detail_filter, 'todos')));

  IF v_detail_filter NOT IN (
    'todos',
    'compartidos',
    'reprecalificaciones',
    'mayor_20k',
    'topados',
    'mesa',
    'no_mesa'
  ) THEN
    RAISE EXCEPTION 'admin_precal_performance: filtro de detalle inválido'
      USING ERRCODE = '22023';
  END IF;

  WITH org_exp AS MATERIALIZED (
    SELECT
      e.id AS expediente_id,
      e.asesor_id,
      e.precalificador_origen_id,
      e.nss::TEXT AS nss,
      e.cliente_nombre,
      e.programa::TEXT AS programa_actual,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.ciclo_estado::TEXT AS ciclo_estado,
      e.subestado::TEXT AS subestado,
      e.created_at,
      owner.full_name AS asesor_nombre,
      owner.email AS asesor_email,
      origin.full_name AS precalificador_nombre,
      origin.email AS precalificador_email
    FROM public.expedientes e
    LEFT JOIN public.profiles owner ON owner.id = e.asesor_id
    LEFT JOIN public.profiles origin ON origin.id = e.precalificador_origen_id
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
  ),
  all_attempts AS MATERIALIZED (
    SELECT
      ('hist:' || i.id::TEXT) AS attempt_key,
      i.id AS intento_id,
      e.expediente_id,
      e.asesor_id,
      e.asesor_nombre,
      e.asesor_email,
      e.precalificador_origen_id,
      e.precalificador_nombre,
      e.precalificador_email,
      trim(i.nss::TEXT) AS nss,
      i.cliente_nombre,
      coalesce(i.programa_solicitado::TEXT, i.programa::TEXT, e.programa_actual) AS programa,
      i.decision::TEXT AS decision,
      CASE WHEN i.decision = 'aprobado' THEN i.monto_aprobado ELSE NULL END AS monto_aprobado,
      coalesce(i.decided_at, i.created_at) AS attempt_at,
      (
        i.decision_previa IS NOT NULL
        OR i.intento_previo_id IS NOT NULL
      ) AS is_reprecalificacion,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.ciclo_estado,
      e.subestado
    FROM org_exp e
    JOIN public.expediente_precalificacion_intentos i
      ON i.expediente_id = e.expediente_id

    UNION ALL

    SELECT
      ('current:' || e.expediente_id::TEXT) AS attempt_key,
      NULL::UUID AS intento_id,
      e.expediente_id,
      e.asesor_id,
      e.asesor_nombre,
      e.asesor_email,
      e.precalificador_origen_id,
      e.precalificador_nombre,
      e.precalificador_email,
      trim(e.nss) AS nss,
      e.cliente_nombre,
      e.programa_actual AS programa,
      coalesce(ed.decision::TEXT, 'pendiente') AS decision,
      CASE
        WHEN ed.decision = 'aprobado'
          THEN coalesce(ed.monto_aprobado_al_aprobar, ed.monto_aprobado)
        ELSE NULL
      END AS monto_aprobado,
      CASE
        WHEN ed.decision = 'aprobado' THEN coalesce(ed.aprobado_at, e.created_at)
        WHEN ed.decision = 'no_cumple' THEN coalesce(ed.no_cumple_at, e.created_at)
        ELSE e.created_at
      END AS attempt_at,
      false AS is_reprecalificacion,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.ciclo_estado,
      e.subestado
    FROM org_exp e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.expediente_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.expediente_precalificacion_intentos i
      WHERE i.expediente_id = e.expediente_id
    )
  ),
  historical_nss_counts AS MATERIALIZED (
    SELECT
      a.nss,
      count(*)::INTEGER AS total_historico
    FROM all_attempts a
    WHERE nullif(a.nss, '') IS NOT NULL
    GROUP BY a.nss
  ),
  period_all AS MATERIALIZED (
    SELECT
      a.*,
      coalesce(h.total_historico, 1)::INTEGER AS nss_precal_historicas,
      (
        a.decision = 'aprobado'
        AND coalesce(a.monto_aprobado, 0) > 20000
      ) AS aprobado_mayor_20k,
      (
        lower(a.programa) = 'mejoravit'
        AND a.decision = 'aprobado'
        AND coalesce(a.monto_aprobado, 0) >= 169000
      ) AS topado_169k
    FROM all_attempts a
    LEFT JOIN historical_nss_counts h ON h.nss = a.nss
    WHERE a.attempt_at >= p_from
      AND a.attempt_at < p_to_exclusive
  ),
  nss_advisor_rows AS MATERIALIZED (
    SELECT
      p.nss,
      p.asesor_id,
      max(p.asesor_nombre) AS asesor_nombre,
      max(p.asesor_email) AS asesor_email,
      count(*)::INTEGER AS precalificaciones,
      count(*) FILTER (WHERE p.is_reprecalificacion)::INTEGER AS reprecalificaciones,
      count(*) FILTER (WHERE p.decision = 'aprobado')::INTEGER AS aprobadas,
      count(*) FILTER (WHERE p.decision = 'no_cumple')::INTEGER AS no_cumple,
      count(*) FILTER (WHERE p.decision = 'pendiente')::INTEGER AS pendientes,
      count(DISTINCT p.expediente_id)::INTEGER AS expedientes,
      count(DISTINCT p.expediente_id) FILTER (WHERE p.submitted_to_mesa)::INTEGER AS expedientes_en_mesa,
      coalesce(
        avg(least(p.monto_aprobado, 169000)) FILTER (
          WHERE p.decision = 'aprobado'
            AND lower(p.programa) = 'mejoravit'
            AND p.monto_aprobado > 0
        ),
        0
      )::NUMERIC(14,2) AS monto_promedio
    FROM period_all p
    WHERE nullif(p.nss, '') IS NOT NULL
    GROUP BY p.nss, p.asesor_id
  ),
  nss_meta AS MATERIALIZED (
    SELECT
      r.nss,
      count(*)::INTEGER AS asesores_count,
      sum(r.precalificaciones)::INTEGER AS precalificaciones_periodo,
      jsonb_agg(
        jsonb_build_object(
          'asesor_id', r.asesor_id,
          'asesor_nombre', r.asesor_nombre,
          'asesor_email', r.asesor_email,
          'precalificaciones', r.precalificaciones,
          'reprecalificaciones', r.reprecalificaciones,
          'aprobadas', r.aprobadas,
          'no_cumple', r.no_cumple,
          'pendientes', r.pendientes,
          'expedientes', r.expedientes,
          'expedientes_en_mesa', r.expedientes_en_mesa,
          'monto_promedio', r.monto_promedio
        )
        ORDER BY r.precalificaciones DESC,
                 coalesce(r.asesor_nombre, r.asesor_email, r.asesor_id::TEXT)
      ) AS asesores,
      lower(string_agg(
        coalesce(r.asesor_nombre, '') || ' ' || coalesce(r.asesor_email, ''),
        ' | '
        ORDER BY coalesce(r.asesor_nombre, r.asesor_email, r.asesor_id::TEXT)
      )) AS asesores_search
    FROM nss_advisor_rows r
    GROUP BY r.nss
  ),
  period_base AS MATERIALIZED (
    SELECT
      p.*,
      coalesce(m.asesores_count, 1)::INTEGER AS asesores_nss_count,
      coalesce(m.precalificaciones_periodo, 1)::INTEGER AS nss_precal_periodo,
      coalesce(m.asesores, '[]'::JSONB) AS asesores_nss,
      coalesce(m.asesores_search, '') AS asesores_nss_search,
      coalesce(m.asesores_count, 1) > 1 AS compartido_entre_asesores
    FROM period_all p
    LEFT JOIN nss_meta m ON m.nss = p.nss
    WHERE
      (
        p_asesor_id IS NULL
        OR p.asesor_id = ANY(public.admin_expand_asesor_ids(p_asesor_id))
      )
      AND (
        v_search IS NULL
        OR lower(coalesce(p.cliente_nombre, '')) LIKE '%' || v_search || '%'
        OR lower(coalesce(p.nss, '')) LIKE '%' || v_search || '%'
        OR lower(coalesce(p.asesor_nombre, '')) LIKE '%' || v_search || '%'
        OR lower(coalesce(p.asesor_email, '')) LIKE '%' || v_search || '%'
        OR lower(coalesce(p.precalificador_nombre, '')) LIKE '%' || v_search || '%'
        OR lower(coalesce(p.precalificador_email, '')) LIKE '%' || v_search || '%'
        OR lower(coalesce(p.programa, '')) LIKE '%' || v_search || '%'
        OR coalesce(m.asesores_search, '') LIKE '%' || v_search || '%'
      )
  ),
  summary AS (
    SELECT
      count(*)::INTEGER AS total_precalificaciones,
      count(DISTINCT nss)::INTEGER AS nss_unicos,
      count(*) FILTER (WHERE is_reprecalificacion)::INTEGER AS reprecalificaciones,
      count(DISTINCT nss) FILTER (WHERE compartido_entre_asesores)::INTEGER AS nss_compartidos,
      count(*) FILTER (WHERE decision = 'aprobado')::INTEGER AS aprobadas,
      count(*) FILTER (WHERE decision = 'no_cumple')::INTEGER AS no_cumple,
      count(*) FILTER (WHERE decision = 'pendiente')::INTEGER AS pendientes,
      count(*) FILTER (WHERE decision IN ('aprobado', 'no_cumple'))::INTEGER AS resueltas,
      coalesce(avg(
        least(monto_aprobado, 169000)
      ) FILTER (
        WHERE decision = 'aprobado'
          AND lower(programa) = 'mejoravit'
          AND monto_aprobado > 0
      ), 0)::NUMERIC(14,2) AS monto_promedio,
      coalesce(sum(
        least(monto_aprobado, 169000)
      ) FILTER (
        WHERE decision = 'aprobado'
          AND lower(programa) = 'mejoravit'
          AND monto_aprobado > 0
      ), 0)::NUMERIC(16,2) AS monto_total_admin,
      count(DISTINCT expediente_id)::INTEGER AS expedientes_generados,
      count(DISTINCT expediente_id) FILTER (WHERE submitted_to_mesa)::INTEGER AS expedientes_en_mesa,
      count(DISTINCT expediente_id) FILTER (WHERE aprobado_mayor_20k)::INTEGER AS casos_mayor_20k,
      count(DISTINCT expediente_id) FILTER (
        WHERE aprobado_mayor_20k AND submitted_to_mesa
      )::INTEGER AS casos_mayor_20k_en_mesa,
      count(DISTINCT nss) FILTER (WHERE topado_169k)::INTEGER AS topados_nss,
      count(DISTINCT nss) FILTER (WHERE topado_169k AND submitted_to_mesa)::INTEGER AS topados_nss_en_mesa
    FROM period_base
  ),
  advisor_rows AS (
    SELECT
      p.asesor_id,
      max(p.asesor_nombre) AS asesor_nombre,
      max(p.asesor_email) AS asesor_email,
      count(*)::INTEGER AS total_precalificaciones,
      count(DISTINCT p.nss)::INTEGER AS nss_unicos,
      count(*) FILTER (WHERE p.is_reprecalificacion)::INTEGER AS reprecalificaciones,
      count(DISTINCT p.nss) FILTER (WHERE p.compartido_entre_asesores)::INTEGER AS nss_compartidos,
      count(DISTINCT p.expediente_id)::INTEGER AS expedientes_generados,
      count(DISTINCT p.expediente_id) FILTER (WHERE p.submitted_to_mesa)::INTEGER AS expedientes_en_mesa,
      count(DISTINCT p.expediente_id) FILTER (
        WHERE p.aprobado_mayor_20k
      )::INTEGER AS casos_mayor_20k,
      count(DISTINCT p.expediente_id) FILTER (
        WHERE p.aprobado_mayor_20k AND p.submitted_to_mesa
      )::INTEGER AS casos_mayor_20k_en_mesa,
      count(*) FILTER (WHERE p.decision = 'aprobado')::INTEGER AS aprobadas,
      count(*) FILTER (WHERE p.decision = 'no_cumple')::INTEGER AS no_cumple,
      count(*) FILTER (WHERE p.decision = 'pendiente')::INTEGER AS pendientes,
      coalesce(avg(
        least(p.monto_aprobado, 169000)
      ) FILTER (
        WHERE p.decision = 'aprobado'
          AND lower(p.programa) = 'mejoravit'
          AND p.monto_aprobado > 0
      ), 0)::NUMERIC(14,2) AS monto_promedio,
      count(DISTINCT p.nss) FILTER (WHERE p.topado_169k)::INTEGER AS topados_nss,
      count(DISTINCT p.nss) FILTER (WHERE p.topado_169k AND p.submitted_to_mesa)::INTEGER AS topados_nss_en_mesa
    FROM period_base p
    GROUP BY p.asesor_id
  ),
  advisors_json AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'asesor_id', r.asesor_id,
          'asesor_nombre', r.asesor_nombre,
          'asesor_email', r.asesor_email,
          'total_precalificaciones', r.total_precalificaciones,
          'nss_unicos', r.nss_unicos,
          'reprecalificaciones', r.reprecalificaciones,
          'nss_compartidos', r.nss_compartidos,
          'expedientes_generados', r.expedientes_generados,
          'expedientes_en_mesa', r.expedientes_en_mesa,
          'aprobadas', r.aprobadas,
          'no_cumple', r.no_cumple,
          'pendientes', r.pendientes,
          'tasa_aprobacion_pct',
            CASE
              WHEN (r.aprobadas + r.no_cumple) > 0
                THEN round((100.0 * r.aprobadas / (r.aprobadas + r.no_cumple))::NUMERIC, 1)
              ELSE 0
            END,
          'monto_promedio', r.monto_promedio,
          'casos_mayor_20k', r.casos_mayor_20k,
          'casos_mayor_20k_en_mesa', r.casos_mayor_20k_en_mesa,
          'conversion_mayor_20k_pct',
            CASE
              WHEN r.casos_mayor_20k > 0
                THEN round((100.0 * r.casos_mayor_20k_en_mesa / r.casos_mayor_20k)::NUMERIC, 1)
              ELSE 0
            END,
          'topados_nss', r.topados_nss,
          'topados_nss_en_mesa', r.topados_nss_en_mesa,
          'conversion_mesa_pct',
            CASE
              WHEN r.expedientes_generados > 0
                THEN round((100.0 * r.expedientes_en_mesa / r.expedientes_generados)::NUMERIC, 1)
              ELSE 0
            END
        )
        ORDER BY r.total_precalificaciones DESC,
                 r.expedientes_en_mesa DESC,
                 coalesce(r.asesor_nombre, r.asesor_email, r.asesor_id::TEXT)
      ),
      '[]'::JSONB
    ) AS items
    FROM advisor_rows r
  ),
  detail_filtered AS MATERIALIZED (
    SELECT *
    FROM period_base p
    WHERE
      v_detail_filter = 'todos'
      OR (v_detail_filter = 'compartidos' AND p.compartido_entre_asesores)
      OR (v_detail_filter = 'reprecalificaciones' AND p.is_reprecalificacion)
      OR (v_detail_filter = 'mayor_20k' AND p.aprobado_mayor_20k)
      OR (v_detail_filter = 'topados' AND p.topado_169k)
      OR (v_detail_filter = 'mesa' AND p.submitted_to_mesa)
      OR (v_detail_filter = 'no_mesa' AND NOT p.submitted_to_mesa)
  ),
  detail_count AS (
    SELECT count(*)::INTEGER AS total_count FROM detail_filtered
  ),
  detail_page AS (
    SELECT *
    FROM detail_filtered
    ORDER BY attempt_at DESC, attempt_key DESC
    LIMIT v_page_size OFFSET v_offset
  ),
  detail_json AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'attempt_key', d.attempt_key,
          'intento_id', d.intento_id,
          'expediente_id', d.expediente_id,
          'fecha', d.attempt_at,
          'nss', d.nss,
          'nss_precal_historicas', d.nss_precal_historicas,
          'nss_precal_periodo', d.nss_precal_periodo,
          'is_reprecalificacion', d.is_reprecalificacion,
          'compartido_entre_asesores', d.compartido_entre_asesores,
          'asesores_nss_count', d.asesores_nss_count,
          'asesores_nss', d.asesores_nss,
          'cliente_nombre', d.cliente_nombre,
          'asesor_id', d.asesor_id,
          'asesor_nombre', d.asesor_nombre,
          'asesor_email', d.asesor_email,
          'precalificador_origen_id', d.precalificador_origen_id,
          'precalificador_nombre', d.precalificador_nombre,
          'precalificador_email', d.precalificador_email,
          'programa', d.programa,
          'decision', d.decision,
          'monto_aprobado', d.monto_aprobado,
          'aprobado_mayor_20k', d.aprobado_mayor_20k,
          'topado_169k', d.topado_169k,
          'submitted_to_mesa', d.submitted_to_mesa,
          'fecha_envio_mesa', d.fecha_envio_mesa,
          'etapa_actual', d.etapa_actual,
          'ciclo_estado', d.ciclo_estado,
          'subestado', d.subestado
        )
        ORDER BY d.attempt_at DESC, d.attempt_key DESC
      ),
      '[]'::JSONB
    ) AS items
    FROM detail_page d
  )
  SELECT jsonb_build_object(
    'summary',
      jsonb_build_object(
        'total_precalificaciones', s.total_precalificaciones,
        'nss_unicos', s.nss_unicos,
        'reprecalificaciones', s.reprecalificaciones,
        'nss_compartidos', s.nss_compartidos,
        'aprobadas', s.aprobadas,
        'no_cumple', s.no_cumple,
        'pendientes', s.pendientes,
        'resueltas', s.resueltas,
        'tasa_aprobacion_pct',
          CASE
            WHEN s.resueltas > 0
              THEN round((100.0 * s.aprobadas / s.resueltas)::NUMERIC, 1)
            ELSE 0
          END,
        'monto_promedio', s.monto_promedio,
        'monto_total_admin', s.monto_total_admin,
        'expedientes_generados', s.expedientes_generados,
        'expedientes_en_mesa', s.expedientes_en_mesa,
        'conversion_mesa_pct',
          CASE
            WHEN s.expedientes_generados > 0
              THEN round((100.0 * s.expedientes_en_mesa / s.expedientes_generados)::NUMERIC, 1)
            ELSE 0
          END,
        'casos_mayor_20k', s.casos_mayor_20k,
        'casos_mayor_20k_en_mesa', s.casos_mayor_20k_en_mesa,
        'conversion_mayor_20k_pct',
          CASE
            WHEN s.casos_mayor_20k > 0
              THEN round((100.0 * s.casos_mayor_20k_en_mesa / s.casos_mayor_20k)::NUMERIC, 1)
            ELSE 0
          END,
        'topados_nss', s.topados_nss,
        'topados_nss_en_mesa', s.topados_nss_en_mesa,
        'topados_conversion_pct',
          CASE
            WHEN s.topados_nss > 0
              THEN round((100.0 * s.topados_nss_en_mesa / s.topados_nss)::NUMERIC, 1)
            ELSE 0
          END
      ),
    'asesores', a.items,
    'items', d.items,
    'total_count', c.total_count,
    'page', v_page,
    'page_size', v_page_size,
    'detail_filter', v_detail_filter,
    'generated_at', now()
  )
  INTO v_result
  FROM summary s
  CROSS JOIN advisors_json a
  CROSS JOIN detail_json d
  CROSS JOIN detail_count c;

  RETURN coalesce(v_result, jsonb_build_object(
    'summary', '{}'::JSONB,
    'asesores', '[]'::JSONB,
    'items', '[]'::JSONB,
    'total_count', 0,
    'page', v_page,
    'page_size', v_page_size,
    'detail_filter', v_detail_filter,
    'generated_at', now()
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_precal_performance(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, INTEGER, INTEGER, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_precal_performance(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, INTEGER, INTEGER, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.admin_precal_performance(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, INTEGER, INTEGER, TEXT
) IS
  'Super Admin RO: rendimiento de precalificaciones. Conversión operativa principal = casos aprobados con monto > $20,000 que llegaron a Mesa / casos aprobados > $20,000. NSS compartido = mismo NSS por 2+ asesores distintos; re-precalificaciones se reportan aparte.';

COMMIT;
