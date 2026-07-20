-- ConCasa CRM — P087: tope $169,000 por expediente en agregados Admin
-- No modifica tablas ni snapshots. Solo redefine 3 RPC Admin RO.
-- Base: 083 (summary + precal page) y 085 (producción por asesor).
-- Regla: aportación = LEAST(COALESCE(monto_aprobado_al_aprobar,0), 169000) antes de SUM/AVG.
-- El total agregado puede superar 169000. Filas individuales sin tope.
-- Rollback: restaurar cuerpos 083/085 con sum/avg sin LEAST (ver comentarios finales).


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
      sum(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)) FILTER (
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
  'P082/P083/P087 Admin RO: KPIs; monto_aprobado_total = SUM(LEAST(snapshot,169000)) por expediente Mejoravit; total puede superar 169000.';

DROP FUNCTION IF EXISTS public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.admin_list_production_by_asesor(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_estado TEXT DEFAULT NULL,
  p_asesor_id UUID DEFAULT NULL
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
        AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
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
               sum(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)) FILTER (
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
        AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
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

REVOKE ALL ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) IS
  'P085/P087 Admin RO: producción por asesor; monto_aprobado_total = SUM(LEAST(snapshot,169000)) por expediente; p_asesor_id opcional.';

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
      sum(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)) FILTER (
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
        avg(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)) FILTER (
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
  'P082/P083/P087 Admin RO: montos Mejoravit con LEAST(snapshot,169000) por expediente en total/promedio; filas individuales sin tope.';

-- Rollback (no ejecutar en apply normal):
--   Reaplicar cuerpos de 083 (admin_get_production_summary + admin_list_precalificaciones_page)
--   y 085 (admin_list_production_by_asesor) con sum(ed.monto_aprobado_al_aprobar) /
--   avg(ed.monto_aprobado_al_aprobar) sin LEAST.
