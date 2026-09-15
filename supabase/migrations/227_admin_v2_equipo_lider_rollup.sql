-- ConCasa CRM — Admin v2: líder + equipo en todo el read model.
-- READ-MODEL ONLY. Sin UPDATE / DELETE / backfill / cambios de expedientes.
-- Alinea las RPC v2 usadas por el panel con admin_expand_asesor_ids,
-- admin_reporting_asesor_id y admin_asesor_ids_matching_buscar (migs. 225/226).

CREATE OR REPLACE FUNCTION public.admin_get_production_summary_v2(
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_asesor_id uuid DEFAULT NULL,
  p_etapas smallint[] DEFAULT NULL,
  p_estado text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enviados bigint;
  v_aprobadas bigint;
  v_no_cumple bigint;
  v_mayor bigint;
  v_monto numeric(14,2);
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
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
    AND (p_etapas IS NULL OR cardinality(p_etapas) = 0 OR e.etapa_actual = ANY(p_etapas))
    AND (
      p_estado IS NULL
      OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
      OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
      OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
      OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
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
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
    AND (p_etapas IS NULL OR cardinality(p_etapas) = 0 OR e.etapa_actual = ANY(p_etapas))
    AND (
      p_estado IS NULL
      OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
      OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
      OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
      OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
    );

  RETURN jsonb_build_object(
    'enviados_a_mesa', v_enviados,
    'precalificaciones_aprobadas', v_aprobadas,
    'precalificaciones_no_cumple', v_no_cumple,
    'aprobadas_mayor_a_20000', v_mayor,
    'monto_aprobado_total', v_monto
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_production_summary_v2(timestamptz,timestamptz,uuid,smallint[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_production_summary_v2(timestamptz,timestamptz,uuid,smallint[],text) TO authenticated;
COMMENT ON FUNCTION public.admin_get_production_summary_v2(timestamptz,timestamptz,uuid,smallint[],text) IS
  'Admin read model v2: periodo + líder/equipo + estado + etapas actuales aplican al mismo universo de KPIs.';

CREATE OR REPLACE FUNCTION public.admin_list_production_by_asesor_v2(
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_estado text DEFAULT NULL,
  p_asesor_id uuid DEFAULT NULL,
  p_etapas smallint[] DEFAULT NULL
)
RETURNS jsonb
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
      SELECT
        public.admin_reporting_asesor_id(e.asesor_id) AS asesor_id,
        e.etapa_actual,
        count(*)::bigint AS cnt
      FROM public.expedientes e
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
        AND e.fecha_envio_mesa >= p_from
        AND e.fecha_envio_mesa < p_to_exclusive
        AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
        AND (p_etapas IS NULL OR cardinality(p_etapas) = 0 OR e.etapa_actual = ANY(p_etapas))
        AND (
          p_estado IS NULL
          OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
          OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
        )
      GROUP BY 1, e.etapa_actual
    ),
    envios_tot AS (
      SELECT asesor_id, sum(cnt)::bigint AS enviados
      FROM envios
      GROUP BY asesor_id
    ),
    aprob AS (
      SELECT
        public.admin_reporting_asesor_id(e.asesor_id) AS asesor_id,
        count(*) FILTER (
          WHERE ed.decision = 'aprobado'
            AND ed.aprobado_at IS NOT NULL
            AND ed.aprobado_at >= p_from
            AND ed.aprobado_at < p_to_exclusive
        )::bigint AS aprobadas,
        count(*) FILTER (
          WHERE ed.decision = 'no_cumple'
            AND ed.no_cumple_at IS NOT NULL
            AND ed.no_cumple_at >= p_from
            AND ed.no_cumple_at < p_to_exclusive
        )::bigint AS no_cumple,
        count(*) FILTER (
          WHERE ed.decision = 'aprobado'
            AND ed.aprobado_at IS NOT NULL
            AND ed.aprobado_at >= p_from
            AND ed.aprobado_at < p_to_exclusive
            AND ed.monto_aprobado_al_aprobar > 20000
        )::bigint AS mayor,
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
        )::numeric(14,2) AS monto_total
      FROM public.editor_decisions ed
      JOIN public.expedientes e ON e.id = ed.expediente_id
      WHERE e.deleted_at IS NULL
        AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
        AND (p_etapas IS NULL OR cardinality(p_etapas) = 0 OR e.etapa_actual = ANY(p_etapas))
        AND (
          p_estado IS NULL
          OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
          OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
        )
      GROUP BY 1
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
          FROM envios en
          WHERE en.asesor_id = a.asesor_id
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

REVOKE ALL ON FUNCTION public.admin_list_production_by_asesor_v2(timestamptz,timestamptz,text,uuid,smallint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_production_by_asesor_v2(timestamptz,timestamptz,text,uuid,smallint[]) TO authenticated;
COMMENT ON FUNCTION public.admin_list_production_by_asesor_v2(timestamptz,timestamptz,text,uuid,smallint[]) IS
  'Admin read model v2: producción por asesor; líderes agregan miembros activos y miembros reportan bajo leader_id.';

CREATE OR REPLACE FUNCTION public.admin_list_precalificaciones_page_v2(
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_asesor_id uuid DEFAULT NULL,
  p_decision_filter text DEFAULT NULL,
  p_buscar text DEFAULT NULL,
  p_etapas smallint[] DEFAULT NULL,
  p_estado text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page integer;
  v_size integer;
  v_offset integer;
  v_total bigint;
  v_q text;
  v_items jsonb;
  v_sum jsonb;
  v_filter text;
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
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
    AND (p_etapas IS NULL OR cardinality(p_etapas) = 0 OR e.etapa_actual = ANY(p_etapas))
    AND (
      p_estado IS NULL
      OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
      OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
      OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
      OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
    )
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
      OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
    )
    AND (
      (v_filter IN ('resueltas', 'todas', 'aprobadas') AND ed.decision = 'aprobado'
        AND ed.aprobado_at IS NOT NULL AND ed.aprobado_at >= p_from AND ed.aprobado_at < p_to_exclusive)
      OR (v_filter IN ('resueltas', 'todas', 'no_cumple') AND ed.decision = 'no_cumple'
        AND ed.no_cumple_at IS NOT NULL AND ed.no_cumple_at >= p_from AND ed.no_cumple_at < p_to_exclusive)
      OR (v_filter IN ('todas', 'pendientes') AND ed.decision = 'pendiente')
    );

  SELECT jsonb_build_object(
    'resueltas_count', count(*) FILTER (WHERE ed.decision IN ('aprobado', 'no_cumple')),
    'aprobadas_count', count(*) FILTER (WHERE ed.decision = 'aprobado'),
    'no_cumple_count', count(*) FILTER (WHERE ed.decision = 'no_cumple'),
    'pendientes_actuales_count', count(*) FILTER (WHERE ed.decision = 'pendiente'),
    'mayores_20000_count', count(*) FILTER (
      WHERE ed.decision = 'aprobado' AND ed.monto_aprobado_al_aprobar IS NOT NULL AND ed.monto_aprobado_al_aprobar > 20000
    ),
    'mejoravit_aprobadas_count', count(*) FILTER (
      WHERE ed.decision = 'aprobado' AND lower(btrim(e.programa::text)) = 'mejoravit'
        AND ed.monto_aprobado_al_aprobar IS NOT NULL AND ed.monto_aprobado_al_aprobar > 0
    ),
    'monto_mejoravit_total', coalesce(
      sum(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)) FILTER (
        WHERE ed.decision = 'aprobado' AND lower(btrim(e.programa::text)) = 'mejoravit'
          AND ed.monto_aprobado_al_aprobar IS NOT NULL AND ed.monto_aprobado_al_aprobar > 0
      ), 0
    ),
    'monto_mejoravit_promedio', CASE
      WHEN count(*) FILTER (
        WHERE ed.decision = 'aprobado' AND lower(btrim(e.programa::text)) = 'mejoravit'
          AND ed.monto_aprobado_al_aprobar IS NOT NULL AND ed.monto_aprobado_al_aprobar > 0
      ) = 0 THEN 0
      ELSE round(
        avg(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)) FILTER (
          WHERE ed.decision = 'aprobado' AND lower(btrim(e.programa::text)) = 'mejoravit'
            AND ed.monto_aprobado_al_aprobar IS NOT NULL AND ed.monto_aprobado_al_aprobar > 0
        ), 2
      )
    END
  ) INTO v_sum
  FROM public.editor_decisions ed
  JOIN public.expedientes e ON e.id = ed.expediente_id
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
    AND (p_etapas IS NULL OR cardinality(p_etapas) = 0 OR e.etapa_actual = ANY(p_etapas))
    AND (
      p_estado IS NULL
      OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
      OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
      OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
      OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
    )
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
      OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
    )
    AND (
      (v_filter IN ('resueltas', 'todas', 'aprobadas') AND ed.decision = 'aprobado'
        AND ed.aprobado_at IS NOT NULL AND ed.aprobado_at >= p_from AND ed.aprobado_at < p_to_exclusive)
      OR (v_filter IN ('resueltas', 'todas', 'no_cumple') AND ed.decision = 'no_cumple'
        AND ed.no_cumple_at IS NOT NULL AND ed.no_cumple_at >= p_from AND ed.no_cumple_at < p_to_exclusive)
      OR (v_filter IN ('todas', 'pendientes') AND ed.decision = 'pendiente')
    );

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ed.expediente_id,
      CASE WHEN ed.decision = 'aprobado' THEN ed.aprobado_at
           WHEN ed.decision = 'no_cumple' THEN ed.no_cumple_at
           ELSE NULL END AS fecha,
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
      AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
      AND (p_etapas IS NULL OR cardinality(p_etapas) = 0 OR e.etapa_actual = ANY(p_etapas))
      AND (
        p_estado IS NULL
        OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::text ILIKE '%' || v_q || '%'
        OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      )
      AND (
        (v_filter IN ('resueltas', 'todas', 'aprobadas') AND ed.decision = 'aprobado'
          AND ed.aprobado_at IS NOT NULL AND ed.aprobado_at >= p_from AND ed.aprobado_at < p_to_exclusive)
        OR (v_filter IN ('resueltas', 'todas', 'no_cumple') AND ed.decision = 'no_cumple'
          AND ed.no_cumple_at IS NOT NULL AND ed.no_cumple_at >= p_from AND ed.no_cumple_at < p_to_exclusive)
        OR (v_filter IN ('todas', 'pendientes') AND ed.decision = 'pendiente')
      )
    ORDER BY
      CASE WHEN ed.decision = 'aprobado' THEN ed.aprobado_at
           WHEN ed.decision = 'no_cumple' THEN ed.no_cumple_at
           ELSE NULL END DESC NULLS LAST,
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

REVOKE ALL ON FUNCTION public.admin_list_precalificaciones_page_v2(timestamptz,timestamptz,integer,integer,uuid,text,text,smallint[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_precalificaciones_page_v2(timestamptz,timestamptz,integer,integer,uuid,text,text,smallint[],text) TO authenticated;
COMMENT ON FUNCTION public.admin_list_precalificaciones_page_v2(timestamptz,timestamptz,integer,integer,uuid,text,text,smallint[],text) IS
  'Admin read model v2: tabla/resumen de precalificaciones respetan líder/equipo, etapa, estado y búsqueda.';

CREATE OR REPLACE FUNCTION public.admin_get_mesa_period_by_etapa_v2(
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_asesor_id uuid DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_buscar text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
  v_q text;
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  WITH cohort AS (
    SELECT e.etapa_actual
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa >= p_from
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
      AND (
        p_estado IS NULL
        OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::text ILIKE '%' || v_q || '%'
        OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      )
  ), counts AS (
    SELECT etapa_actual::int AS etapa, count(*)::bigint AS cnt
    FROM cohort
    GROUP BY etapa_actual
  ), totals AS (
    SELECT count(*)::bigint AS total FROM cohort
  )
  SELECT t.total, coalesce(jsonb_agg(
    jsonb_build_object(
      'etapa', s.etapa,
      'count', coalesce(c.cnt, 0),
      'pct', CASE WHEN t.total = 0 THEN 0
        ELSE round((coalesce(c.cnt, 0)::numeric * 1000 / t.total) / 10.0, 1) END
    ) ORDER BY s.etapa
  ), '[]'::jsonb)
  INTO v_total, v_rows
  FROM totals t
  CROSS JOIN generate_series(1, 12) AS s(etapa)
  LEFT JOIN counts c ON c.etapa = s.etapa
  GROUP BY t.total;

  RETURN jsonb_build_object(
    'total', coalesce(v_total, 0),
    'by_etapa', coalesce(v_rows, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_mesa_period_by_etapa_v2(timestamptz,timestamptz,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_mesa_period_by_etapa_v2(timestamptz,timestamptz,uuid,text,text) TO authenticated;
COMMENT ON FUNCTION public.admin_get_mesa_period_by_etapa_v2(timestamptz,timestamptz,uuid,text,text) IS
  'Admin RO v2: distribución por etapa del periodo; respeta líder/equipo, estado y búsqueda; etapa activa no recorta el desglose.';
