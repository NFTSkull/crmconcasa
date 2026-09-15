-- ConCasa CRM — Admin: rollup líder + equipo (mig 225)
-- Silvia (u otro líder) + miembros activos cuentan como un solo asesor en Super Admin.
-- Helpers + patch snapshot (148), production (091), reporte v3 (101).

CREATE OR REPLACE FUNCTION public.admin_expand_asesor_ids(p_asesor_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_team_ids UUID[];
  v_team UUID;
  v_ids UUID[];
BEGIN
  IF p_asesor_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = p_asesor_id;

  IF v_org IS NULL THEN
    RETURN ARRAY[p_asesor_id];
  END IF;

  SELECT array_agg(t.id ORDER BY t.created_at, t.id)
  INTO v_team_ids
  FROM public.asesor_equipos t
  WHERE t.leader_id = p_asesor_id
    AND t.organization_id = v_org
    AND t.active IS TRUE;

  IF coalesce(cardinality(v_team_ids), 0) <> 1 THEN
    -- No líder de un único equipo activo → no expandir.
    RETURN ARRAY[p_asesor_id];
  END IF;

  v_team := v_team_ids[1];
  SELECT array_agg(DISTINCT x ORDER BY x)
  INTO v_ids
  FROM (
    SELECT p_asesor_id AS x
    UNION
    SELECT m.asesor_id
    FROM public.asesor_equipo_miembros m
    WHERE m.team_id = v_team
      AND m.active IS TRUE
  ) s;

  RETURN coalesce(v_ids, ARRAY[p_asesor_id]);
END;
$$;

COMMENT ON FUNCTION public.admin_expand_asesor_ids(UUID) IS
  'Admin: si p_asesor_id es líder de exactamente 1 equipo activo en su org, retorna líder+miembros; si no, ARRAY[self]. NULL→NULL.';

REVOKE ALL ON FUNCTION public.admin_expand_asesor_ids(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_expand_asesor_ids(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reporting_asesor_id(p_asesor_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_leaders UUID[];
BEGIN
  IF p_asesor_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = p_asesor_id;

  IF v_org IS NULL THEN
    RETURN p_asesor_id;
  END IF;

  SELECT array_agg(DISTINCT t.leader_id ORDER BY t.leader_id)
  INTO v_leaders
  FROM public.asesor_equipo_miembros m
  JOIN public.asesor_equipos t ON t.id = m.team_id
  WHERE m.asesor_id = p_asesor_id
    AND m.active IS TRUE
    AND t.active IS TRUE
    AND t.organization_id = v_org;

  IF coalesce(cardinality(v_leaders), 0) = 1 THEN
    RETURN v_leaders[1];
  END IF;

  RETURN p_asesor_id;
END;
$$;

COMMENT ON FUNCTION public.admin_reporting_asesor_id(UUID) IS
  'Admin: si el asesor es miembro activo de exactamente 1 equipo, retorna leader_id; si no, self (líder queda self).';

REVOKE ALL ON FUNCTION public.admin_reporting_asesor_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reporting_asesor_id(UUID) TO authenticated;


-- ===== Snapshot (base 148) =====
-- ConCasa CRM — Admin snapshot: Integración solo si ya enviado a Mesa
-- Misma definición KPI «Expedientes enviados a Mesa» sin rango de fechas:
--   submitted_to_mesa = TRUE AND fecha_envio_mesa IS NOT NULL
-- Pre-Mesa (etapa 1 sin envío) fuera de tarjetas, total_actual y drilldown.
-- Etapas ≥2: sin filtro adicional. SECURITY DEFINER / grants intactos.

-- =============================================================================
-- admin_expedientes_snapshot_etapas
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_expedientes_snapshot_etapas(
  p_asesor_id UUID DEFAULT NULL,
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
  v_total BIGINT;
  v_by_etapa JSONB;
  v_by_paso JSONB;
  v_q TEXT;
  v_generated_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM public.__admin_require_super_admin();

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  WITH base AS (
    SELECT
      e.id,
      e.etapa_actual,
      CASE
        WHEN e.etapa_actual <= 3 THEN e.etapa_actual
        WHEN e.etapa_actual = 4 THEN 3
        ELSE e.etapa_actual - 1
      END AS paso_visual
    FROM public.expedientes e
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND (
        e.etapa_actual IS DISTINCT FROM 1
        OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
      )
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
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
  )
  SELECT count(*) INTO v_total FROM base;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'etapa', g.etapa,
      'count', g.cnt,
      'pct', CASE WHEN v_total = 0 THEN 0 ELSE round((g.cnt::NUMERIC * 1000 / v_total) / 10.0, 1) END
    )
    ORDER BY g.etapa
  ), '[]'::jsonb)
  INTO v_by_etapa
  FROM (
    SELECT s.etapa, coalesce(c.cnt, 0)::BIGINT AS cnt
    FROM generate_series(1, 12) AS s(etapa)
    LEFT JOIN (
      SELECT b.etapa_actual AS etapa, count(*)::BIGINT AS cnt
      FROM (
        SELECT
          e.etapa_actual
        FROM public.expedientes e
        LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
        WHERE e.deleted_at IS NULL
          AND (
            e.etapa_actual IS DISTINCT FROM 1
            OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
          )
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
            OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
            OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
            OR e.programa::text ILIKE '%' || v_q || '%'
          )
      ) b
      GROUP BY b.etapa_actual
    ) c ON c.etapa = s.etapa
  ) g;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'paso_visual', g.paso,
      'count', g.cnt,
      'pct', CASE WHEN v_total = 0 THEN 0 ELSE round((g.cnt::NUMERIC * 1000 / v_total) / 10.0, 1) END
    )
    ORDER BY g.paso
  ), '[]'::jsonb)
  INTO v_by_paso
  FROM (
    SELECT s.paso, coalesce(c.cnt, 0)::BIGINT AS cnt
    FROM generate_series(1, 11) AS s(paso)
    LEFT JOIN (
      SELECT
        CASE
          WHEN e.etapa_actual <= 3 THEN e.etapa_actual
          WHEN e.etapa_actual = 4 THEN 3
          ELSE e.etapa_actual - 1
        END AS paso,
        count(*)::BIGINT AS cnt
      FROM public.expedientes e
      LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
      WHERE e.deleted_at IS NULL
        AND (
          e.etapa_actual IS DISTINCT FROM 1
          OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
        )
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
          OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
          OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
          OR e.programa::text ILIKE '%' || v_q || '%'
        )
      GROUP BY 1
    ) c ON c.paso = s.paso
  ) g;

  RETURN jsonb_build_object(
    'total_actual', coalesce(v_total, 0),
    'by_etapa', coalesce(v_by_etapa, '[]'::jsonb),
    'by_paso_visual', coalesce(v_by_paso, '[]'::jsonb),
    'generated_at', v_generated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expedientes_snapshot_etapas(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_expedientes_snapshot_etapas(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_expedientes_snapshot_etapas(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_expedientes_snapshot_etapas(UUID, TEXT, TEXT) IS
  'Admin RO: stock vigente por etapa (sin fechas). Integración (1) solo enviados a Mesa. p_asesor_id líder expande a equipo (admin_expand_asesor_ids).';

-- =============================================================================
-- admin_list_expedientes_snapshot_page
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_expedientes_snapshot_page(
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

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  SELECT count(*) INTO v_total
  FROM public.expedientes e
  LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND (
      e.etapa_actual IS DISTINCT FROM 1
      OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
    )
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
    AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
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
      OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
    );

  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.sort_at DESC, t.expediente_id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      e.id AS expediente_id,
      e.fecha_envio_mesa,
      e.cliente_nombre,
      e.asesor_id,
      nullif(btrim(pr.full_name), '') AS asesor_nombre,
      e.programa::text AS programa,
      e.etapa_actual,
      CASE e.etapa_actual
        WHEN 1 THEN 'Integración'
        WHEN 2 THEN 'Registro'
        WHEN 3 THEN 'Listo para cita de biométrico'
        WHEN 4 THEN 'Cita agendada (biométricos)'
        WHEN 5 THEN 'Biometría (resultado)'
        WHEN 6 THEN 'Inscripción'
        WHEN 7 THEN 'Notificación'
        WHEN 8 THEN 'Acuse / Aviso de retención'
        WHEN 9 THEN 'Listo para agendar firma'
        WHEN 10 THEN 'Cita para firma'
        WHEN 11 THEN 'Firmado'
        WHEN 12 THEN 'Pago a ConCasa'
        ELSE 'Etapa ' || e.etapa_actual::text
      END AS etapa_label,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      NULL::text AS ultima_actividad_mesa_code,
      NULL::text AS ultima_actividad_mesa_label,
      NULL::timestamptz AS ultima_actividad_mesa_at,
      0::bigint AS correcciones_abiertas_count,
      NULL::timestamptz AS correccion_abierta_desde,
      0::bigint AS correcciones_reenviadas_count,
      NULL::timestamptz AS correccion_reenviada_desde,
      (e.subestado = 'rechazado') AS rechazo_operativo,
      NULL::timestamptz AS rechazo_at,
      NULL::text AS rechazo_clasificacion,
      CASE WHEN e.subestado = 'rechazado' THEN 'Sin motivo registrado' ELSE NULL END AS rechazo_motivo,
      (e.reingreso_rechazo_id IS NOT NULL) AS reingreso_activo,
      'continuar_etapa'::text AS situacion_code,
      'Continuar etapa actual'::text AS situacion_label,
      NULL::text AS espera_tipo,
      NULL::text AS espera_label,
      NULL::timestamptz AS espera_desde,
      'Continuar etapa actual'::text AS siguiente_accion_label,
      'Mesa'::text AS siguiente_accion_actor,
      coalesce(e.fecha_envio_mesa, e.updated_at, e.created_at) AS sort_at
    FROM public.expedientes e
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND (
        e.etapa_actual IS DISTINCT FROM 1
        OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
      )
      AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
      AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
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
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
    ORDER BY coalesce(e.fecha_envio_mesa, e.updated_at, e.created_at) DESC, e.id DESC
    OFFSET v_offset LIMIT v_size
  ) t;

  RETURN jsonb_build_object(
    'total_count', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_size,
    'items', coalesce(v_items, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_expedientes_snapshot_page(INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_expedientes_snapshot_page(INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_expedientes_snapshot_page(INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_list_expedientes_snapshot_page(INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) IS
  'Admin RO: listado paginado alineado con snapshot; p_asesor_id líder expande a equipo.';

-- ===== Production dashboard (base 091) =====
-- ConCasa CRM — P094 B4: Admin p_estado Rechazados ≠ Cancelados (server-side)
-- Predicados canónicos:
--   rechazados = subestado = 'rechazado' AND ciclo_estado = 'activo'
--   cancelados = ciclo_estado = 'cancelado'
-- Firmas, SECURITY DEFINER, search_path, REVOKE/GRANT y agregados P087 intactos.
-- Base vigente: 086 (summary + by_asesor), 085 (mesa_envios_page), 082 (cohort).
-- Sin Cloud. Sin cambios de tablas.


-- =============================================================================
-- admin_get_production_summary
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
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
    AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
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
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)));

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
  'P082/P083/P087/P094 Admin RO: KPIs; p_estado rechazados=activo+rechazado, cancelados=ciclo cancelado; monto LEAST(snapshot,169000).';

-- =============================================================================
-- admin_list_production_by_asesor
-- =============================================================================
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
      SELECT public.admin_reporting_asesor_id(e.asesor_id) AS asesor_id,
             e.etapa_actual, count(*)::BIGINT AS cnt
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
      GROUP BY 1, e.etapa_actual
    ),
    envios_tot AS (
      SELECT asesor_id, sum(cnt)::BIGINT AS enviados
      FROM envios GROUP BY asesor_id
    ),
    aprob AS (
      SELECT public.admin_reporting_asesor_id(e.asesor_id) AS asesor_id,
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
        AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
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
  'P082/P085/P087/P094 Admin RO: producción por asesor; p_estado rechazados/cancelados disjuntos.';

-- =============================================================================
-- admin_get_mesa_cohort_by_etapa
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
      AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
      AND (
        p_estado IS NULL
        OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
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
        AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
        AND (
          p_estado IS NULL
          OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
          OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
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

COMMENT ON FUNCTION public.admin_get_mesa_cohort_by_etapa(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) IS
  'P082/P094 Admin RO: cohorte por etapa; p_estado rechazados/cancelados disjuntos.';

-- =============================================================================
-- admin_list_mesa_envios_page
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
  v_page_ids UUID[];
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  -- 1) total_count de cohorte (sin seguimiento pesado)
  SELECT count(*) INTO v_total
  FROM public.expedientes e
  LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND e.submitted_to_mesa = TRUE
    AND e.fecha_envio_mesa IS NOT NULL
    AND e.fecha_envio_mesa >= p_from
    AND e.fecha_envio_mesa < p_to_exclusive
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
    AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
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
      OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
    );

  -- 2) IDs de la página
  SELECT coalesce(array_agg(x.id), '{}'::UUID[])
  INTO v_page_ids
  FROM (
    SELECT e.id
    FROM public.expedientes e
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa >= p_from
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
      AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
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
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
    ORDER BY e.fecha_envio_mesa DESC, e.id DESC
    OFFSET v_offset LIMIT v_size
  ) x;

  -- 3) Seguimiento pesado solo para IDs de la página
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.fecha_envio_mesa DESC, t.expediente_id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      base.expediente_id,
      base.fecha_envio_mesa,
      base.cliente_nombre,
      base.asesor_id,
      base.asesor_nombre,
      base.programa,
      base.etapa_actual,
      base.etapa_label,
      base.subestado,
      base.ciclo_estado,
      base.ultima_actividad_mesa_code,
      base.ultima_actividad_mesa_label,
      base.ultima_actividad_mesa_at,
      base.correcciones_abiertas_count,
      sit.correccion_abierta_desde,
      base.correcciones_reenviadas_count,
      sit.correccion_reenviada_desde,
      base.rechazo_operativo,
      base.rechazo_at,
      base.rechazo_clasificacion,
      base.rechazo_motivo,
      base.reingreso_activo,
      sit.situacion_code,
      sit.situacion_label,
      sit.espera_tipo,
      sit.espera_label,
      sit.espera_desde,
      actn.siguiente_accion_label,
      actn.siguiente_accion_actor
    FROM (
      SELECT
        e.id AS expediente_id,
        e.fecha_envio_mesa,
        e.cliente_nombre,
        e.asesor_id,
        nullif(btrim(pr.full_name), '') AS asesor_nombre,
        e.programa::text AS programa,
        e.etapa_actual,
        CASE e.etapa_actual
          WHEN 1 THEN 'Integración'
          WHEN 2 THEN 'Registro'
          WHEN 3 THEN 'Listo para cita de biométrico'
          WHEN 4 THEN 'Cita agendada (biométricos)'
          WHEN 5 THEN 'Biometría (resultado)'
          WHEN 6 THEN 'Inscripción'
          WHEN 7 THEN 'Notificación'
          WHEN 8 THEN 'Acuse / Aviso de retención'
          WHEN 9 THEN 'Listo para agendar firma'
          WHEN 10 THEN 'Cita para firma'
          WHEN 11 THEN 'Firmado'
          WHEN 12 THEN 'Pago a ConCasa'
          ELSE 'Etapa ' || e.etapa_actual::text
        END AS etapa_label,
        e.subestado::text AS subestado,
        e.ciclo_estado::text AS ciclo_estado,
        act.ultima_actividad_mesa_code,
        CASE act.ultima_actividad_mesa_code
          WHEN 'documento.revision.update' THEN 'Revisión documental Mesa'
          WHEN 'cliente_datos.revision.update' THEN 'Revisión de datos generales Mesa'
          WHEN 'expediente.avanzar_etapa_operativa' THEN 'Avance de etapa'
          WHEN 'mesa.expediente.mover_etapa' THEN 'Movimiento manual de etapa'
          WHEN 'mesa.expediente.take' THEN 'Mesa tomó el expediente'
          WHEN 'mesa.expediente.release' THEN 'Mesa liberó el expediente'
          WHEN 'expediente.documento.mesa_register' THEN 'Mesa registró documento'
          WHEN 'expediente.rechazo_operativo' THEN 'Rechazo operativo'
          WHEN 'agenda.biometricos.mesa_reagendar' THEN 'Mesa reagendó biométricos'
          WHEN 'agenda.notificacion.mesa_reagendar' THEN 'Mesa reagendó notificación'
          WHEN 'agenda.firmas.mesa_book' THEN 'Mesa agendó firma'
          WHEN 'agenda.firmas.mesa_reagendar' THEN 'Mesa reagendó firma'
          WHEN 'agenda.firmas.mesa_cancel' THEN 'Mesa canceló firma'
          WHEN 'agenda.drive_validation.set' THEN 'Validado en Drive'
          WHEN 'agenda.drive_validation.clear' THEN 'Validación Drive quitada'
          ELSE NULL
        END AS ultima_actividad_mesa_label,
        act.ultima_actividad_mesa_at,
        corr.correcciones_abiertas_count,
        corr.correccion_abierta_desde_raw,
        corr.correcciones_reenviadas_count,
        corr.correccion_reenviada_desde_raw,
        (e.subestado = 'rechazado' OR ro.id IS NOT NULL) AS rechazo_operativo,
        ro.created_at AS rechazo_at,
        ro.biometricos_condicion::text AS rechazo_clasificacion,
        coalesce(nullif(left(btrim(ro.motivo), 500), ''), 'Sin motivo registrado') AS rechazo_motivo,
        (e.reingreso_rechazo_id IS NOT NULL) AS reingreso_activo,
        bk.bio_booked,
        bk.bio_cancelled_sin_booked,
        bk.firma_booked,
        bk.firma_cancelled_sin_booked
      FROM unnest(v_page_ids) AS pid(id)
      JOIN public.expedientes e ON e.id = pid.id
      LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
      LEFT JOIN LATERAL (
        SELECT r.id, r.created_at, r.motivo, r.biometricos_condicion
        FROM public.expediente_rechazos_operativos r
        WHERE r.expediente_id = e.id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      ) ro ON TRUE
      LEFT JOIN LATERAL (
        SELECT al.action AS ultima_actividad_mesa_code, al.created_at AS ultima_actividad_mesa_at
        FROM public.action_log al
        WHERE (
          (al.entity_type = 'expediente' AND al.entity_id = e.id)
          OR (al.payload->>'expediente_id') = e.id::text
        )
        AND al.action IN (
          'documento.revision.update',
          'cliente_datos.revision.update',
          'expediente.avanzar_etapa_operativa',
          'mesa.expediente.mover_etapa',
          'mesa.expediente.take',
          'mesa.expediente.release',
          'expediente.documento.mesa_register',
          'expediente.rechazo_operativo',
          'agenda.biometricos.mesa_reagendar',
          'agenda.notificacion.mesa_reagendar',
          'agenda.firmas.mesa_book',
          'agenda.firmas.mesa_reagendar',
          'agenda.firmas.mesa_cancel',
          'agenda.drive_validation.set',
          'agenda.drive_validation.clear'
        )
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT 1
      ) act ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          (
            (SELECT count(*)::INTEGER FROM public.expediente_documentos d
             WHERE d.expediente_id = e.id AND d.deleted_at IS NULL AND d.estatus_revision = 'rechazado')
            + CASE WHEN cd.estado = 'rechazado' THEN 1 ELSE 0 END
            + CASE WHEN re.estado = 'correccion_requerida' THEN 1 ELSE 0 END
          ) AS correcciones_abiertas_count,
          (
            SELECT LEAST(
              coalesce((
                SELECT min(dr.created_at)
                FROM public.documento_revisiones dr
                JOIN public.expediente_documentos d ON d.id = dr.documento_id
                WHERE d.expediente_id = e.id AND d.deleted_at IS NULL
                  AND d.estatus_revision = 'rechazado' AND dr.estatus_nuevo = 'rechazado'
              ), 'infinity'::timestamptz),
              coalesce(CASE WHEN cd.estado = 'rechazado' THEN cd.rejected_at END, 'infinity'::timestamptz),
              coalesce(CASE WHEN re.estado = 'correccion_requerida' THEN re.updated_at END, 'infinity'::timestamptz)
            )
          ) AS correccion_abierta_desde_raw,
          (
            (SELECT count(*)::INTEGER FROM public.expediente_documentos d
             WHERE d.expediente_id = e.id AND d.deleted_at IS NULL AND d.estatus_revision = 'resubido')
            + CASE
                WHEN cd.estado = 'completo' AND cd.validated_at IS NULL
                  AND cd.updated_at IS NOT NULL AND e.fecha_envio_mesa IS NOT NULL
                  AND cd.updated_at > e.fecha_envio_mesa
                THEN 1 ELSE 0
              END
            + CASE
                WHEN re.estado = 'enviado'
                  AND EXISTS (
                    SELECT 1 FROM public.expediente_documentos d
                    WHERE d.expediente_id = e.id AND d.deleted_at IS NULL
                      AND d.tipo_documento LIKE 'retencion_%' AND d.estatus_revision = 'resubido'
                  )
                THEN 1 ELSE 0
              END
          ) AS correcciones_reenviadas_count,
          (
            SELECT GREATEST(
              coalesce((
                SELECT max(d.created_at) FROM public.expediente_documentos d
                WHERE d.expediente_id = e.id AND d.deleted_at IS NULL AND d.estatus_revision = 'resubido'
              ), '-infinity'::timestamptz),
              coalesce(
                CASE
                  WHEN cd.estado = 'completo' AND cd.validated_at IS NULL
                    AND cd.updated_at IS NOT NULL AND e.fecha_envio_mesa IS NOT NULL
                    AND cd.updated_at > e.fecha_envio_mesa
                  THEN cd.updated_at
                END,
                '-infinity'::timestamptz
              ),
              coalesce((
                SELECT max(al.created_at) FROM public.action_log al
                WHERE al.action = 'expediente.enviar_retencion_mesa'
                  AND (
                    (al.entity_type = 'expediente' AND al.entity_id = e.id)
                    OR (al.payload->>'expediente_id') = e.id::text
                  )
                  AND coalesce((al.payload->>'is_resend')::boolean, false) = true
              ), '-infinity'::timestamptz)
            )
          ) AS correccion_reenviada_desde_raw
        FROM (SELECT 1) _
        LEFT JOIN public.cliente_datos cd ON cd.expediente_id = e.id
        LEFT JOIN public.retencion_envios re ON re.expediente_id = e.id
      ) corr ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          EXISTS (
            SELECT 1 FROM public.agenda_bookings b
            WHERE b.expediente_id = e.id AND b.kind = 'biometricos' AND b.status = 'booked'
          ) AS bio_booked,
          (
            EXISTS (
              SELECT 1 FROM public.agenda_bookings b
              WHERE b.expediente_id = e.id AND b.kind = 'biometricos' AND b.status = 'cancelled'
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.agenda_bookings b
              WHERE b.expediente_id = e.id AND b.kind = 'biometricos' AND b.status = 'booked'
            )
          ) AS bio_cancelled_sin_booked,
          EXISTS (
            SELECT 1 FROM public.agenda_bookings b
            WHERE b.expediente_id = e.id AND b.kind = 'firmas' AND b.status = 'booked'
          ) AS firma_booked,
          (
            EXISTS (
              SELECT 1 FROM public.agenda_bookings b
              WHERE b.expediente_id = e.id AND b.kind = 'firmas' AND b.status = 'cancelled'
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.agenda_bookings b
              WHERE b.expediente_id = e.id AND b.kind = 'firmas' AND b.status = 'booked'
            )
          ) AS firma_cancelled_sin_booked
      ) bk ON TRUE
    ) base
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN base.rechazo_operativo AND base.ciclo_estado = 'activo' AND base.subestado = 'rechazado'
          THEN 'rechazo_operativo'
        WHEN base.reingreso_activo THEN 'en_reingreso'
        WHEN base.correcciones_abiertas_count > 0 THEN 'correccion_pendiente_asesor'
        WHEN base.correcciones_reenviadas_count > 0 THEN 'correccion_reenviada_esperando_mesa'
        WHEN base.bio_cancelled_sin_booked AND base.etapa_actual IN (3, 4, 5)
          THEN 'cita_biometrica_cancelada_reagenda'
        WHEN base.firma_cancelled_sin_booked AND base.etapa_actual IN (9, 10)
          THEN 'firma_cancelada_reagenda'
        WHEN base.ciclo_estado IN ('cerrado', 'cancelado') THEN 'cerrado'
        WHEN base.etapa_actual = 12 THEN 'pago_a_concasa'
        WHEN base.etapa_actual = 11 THEN 'firmado'
        WHEN base.etapa_actual = 10 AND base.firma_booked THEN 'firma_agendada'
        WHEN base.etapa_actual = 9 THEN 'listo_agendar_firma'
        WHEN base.etapa_actual = 8 THEN 'pendiente_acuse'
        WHEN base.etapa_actual = 7 THEN 'notificacion'
        WHEN base.etapa_actual = 6 THEN 'inscripcion'
        WHEN base.etapa_actual = 5 THEN 'resultado_biometrico_pendiente'
        WHEN base.etapa_actual IN (3, 4) AND base.bio_booked THEN 'cita_biometrica_agendada'
        WHEN base.etapa_actual = 3 THEN 'listo_cita_biometrico'
        WHEN base.etapa_actual = 1 AND base.subestado = 'en_validacion_mesa' THEN 'en_revision_mesa'
        WHEN base.subestado = 'en_validacion_mesa' THEN 'en_revision_mesa'
        ELSE 'continuar_etapa'
      END AS situacion_code
    ) sit0
    CROSS JOIN LATERAL (
      SELECT
        sit0.situacion_code,
        CASE sit0.situacion_code
          WHEN 'rechazo_operativo' THEN 'Rechazado operativamente'
          WHEN 'en_reingreso' THEN 'En reingreso'
          WHEN 'correccion_pendiente_asesor' THEN 'Corrección pendiente del asesor'
          WHEN 'correccion_reenviada_esperando_mesa' THEN 'Corrección reenviada; esperando Mesa'
          WHEN 'cita_biometrica_cancelada_reagenda' THEN 'Cita biométrica cancelada; requiere reagenda'
          WHEN 'firma_cancelada_reagenda' THEN 'Firma cancelada; requiere reagenda'
          WHEN 'en_revision_mesa' THEN 'En revisión de Mesa'
          WHEN 'listo_cita_biometrico' THEN 'Listo para cita de biométrico'
          WHEN 'cita_biometrica_agendada' THEN 'Cita biométrica agendada'
          WHEN 'resultado_biometrico_pendiente' THEN 'Resultado biométrico pendiente'
          WHEN 'inscripcion' THEN 'Inscripción'
          WHEN 'notificacion' THEN 'Notificación'
          WHEN 'pendiente_acuse' THEN 'Pendiente de Acuse'
          WHEN 'listo_agendar_firma' THEN 'Listo para agendar firma'
          WHEN 'firma_agendada' THEN 'Firma agendada'
          WHEN 'firmado' THEN 'Firmado'
          WHEN 'pago_a_concasa' THEN 'Pago a ConCasa'
          WHEN 'cerrado' THEN 'Cerrado'
          ELSE 'Continuar etapa actual'
        END AS situacion_label,
        CASE
          WHEN sit0.situacion_code = 'correccion_pendiente_asesor' THEN 'correccion_asesor'
          WHEN sit0.situacion_code = 'correccion_reenviada_esperando_mesa' THEN 'correccion_mesa'
          WHEN sit0.situacion_code = 'en_revision_mesa' THEN 'mesa_revision'
          ELSE NULL
        END AS espera_tipo,
        CASE
          WHEN sit0.situacion_code = 'correccion_pendiente_asesor' THEN 'Espera corrección del asesor'
          WHEN sit0.situacion_code = 'correccion_reenviada_esperando_mesa' THEN 'Espera revisión de Mesa'
          WHEN sit0.situacion_code = 'en_revision_mesa' THEN 'En revisión de Mesa'
          ELSE NULL
        END AS espera_label,
        CASE
          WHEN sit0.situacion_code = 'correccion_pendiente_asesor'
            AND base.correccion_abierta_desde_raw < 'infinity'::timestamptz
            THEN base.correccion_abierta_desde_raw
          WHEN sit0.situacion_code = 'correccion_reenviada_esperando_mesa'
            AND base.correccion_reenviada_desde_raw > '-infinity'::timestamptz
            THEN base.correccion_reenviada_desde_raw
          WHEN sit0.situacion_code = 'en_revision_mesa' THEN base.fecha_envio_mesa
          ELSE NULL
        END AS espera_desde,
        CASE
          WHEN base.correccion_abierta_desde_raw < 'infinity'::timestamptz
            THEN base.correccion_abierta_desde_raw
          ELSE NULL
        END AS correccion_abierta_desde,
        CASE
          WHEN base.correccion_reenviada_desde_raw > '-infinity'::timestamptz
            THEN base.correccion_reenviada_desde_raw
          ELSE NULL
        END AS correccion_reenviada_desde
    ) sit
    CROSS JOIN LATERAL (
      SELECT
        CASE sit.situacion_code
          WHEN 'correccion_pendiente_asesor' THEN 'Corregir y reenviar'
          WHEN 'correccion_reenviada_esperando_mesa' THEN 'Revisar corrección'
          WHEN 'rechazo_operativo' THEN 'Revisar reingreso'
          WHEN 'en_reingreso' THEN 'Continuar reingreso'
          WHEN 'listo_cita_biometrico' THEN 'Agendar biométricos'
          WHEN 'cita_biometrica_cancelada_reagenda' THEN 'Reagendar biométricos'
          WHEN 'cita_biometrica_agendada' THEN 'Continuar etapa actual'
          WHEN 'resultado_biometrico_pendiente' THEN 'Continuar etapa actual'
          WHEN 'pendiente_acuse' THEN 'Cargar y enviar Acuse'
          WHEN 'listo_agendar_firma' THEN 'Agendar firma'
          WHEN 'firma_cancelada_reagenda' THEN 'Reagendar firma'
          WHEN 'firma_agendada' THEN 'Realizar o registrar firma'
          WHEN 'en_revision_mesa' THEN 'Validar integración'
          WHEN 'pago_a_concasa' THEN 'Continuar etapa actual'
          WHEN 'cerrado' THEN 'Sin acción'
          WHEN 'firmado' THEN 'Continuar etapa actual'
          WHEN 'inscripcion' THEN 'Continuar etapa actual'
          WHEN 'notificacion' THEN 'Continuar etapa actual'
          ELSE 'Continuar etapa actual'
        END AS siguiente_accion_label,
        CASE sit.situacion_code
          WHEN 'correccion_pendiente_asesor' THEN 'Asesor'
          WHEN 'correccion_reenviada_esperando_mesa' THEN 'Mesa'
          WHEN 'rechazo_operativo' THEN 'Asesor'
          WHEN 'en_reingreso' THEN 'Asesor'
          WHEN 'listo_cita_biometrico' THEN 'Asesor'
          WHEN 'cita_biometrica_cancelada_reagenda' THEN 'Asesor'
          WHEN 'pendiente_acuse' THEN 'Asesor'
          WHEN 'listo_agendar_firma' THEN 'Mesa'
          WHEN 'firma_cancelada_reagenda' THEN 'Asesor'
          WHEN 'firma_agendada' THEN 'Mesa'
          WHEN 'en_revision_mesa' THEN 'Mesa'
          WHEN 'cita_biometrica_agendada' THEN 'Mesa'
          WHEN 'resultado_biometrico_pendiente' THEN 'Mesa'
          WHEN 'pago_a_concasa' THEN 'Mesa'
          WHEN 'inscripcion' THEN 'Mesa'
          WHEN 'notificacion' THEN 'Mesa'
          WHEN 'firmado' THEN 'Mesa'
          ELSE 'Mesa'
        END AS siguiente_accion_actor
    ) actn
  ) t;

  RETURN jsonb_build_object(
    'total_count', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_size,
    'items', coalesce(v_items, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) IS
  'P082/P085/P094 Admin RO: página enviados Mesa; p_estado rechazados/cancelados disjuntos.';

-- ===== Reporte asesores×etapas v3 (base 101) =====
-- ConCasa CRM — P116: reporte Admin v3 con tipo de fecha (envio_mesa | entrada_paso_actual)
-- No modifica admin_report_expedientes_asesores_etapas (P112) ni …_v2 (P114).

CREATE OR REPLACE FUNCTION public.admin_report_expedientes_asesores_etapas_v3(
  p_asesor_ids UUID[] DEFAULT NULL,
  p_pasos_visuales SMALLINT[] DEFAULT NULL,
  p_estado TEXT DEFAULT 'vigentes',
  p_tipo_fecha TEXT DEFAULT 'envio_mesa',
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_estado TEXT;
  v_tipo TEXT;
  v_pasos SMALLINT[];
  v_etapas SMALLINT[];
  v_paso SMALLINT;
  v_resumen JSONB;
  v_detalle JSONB;
  v_meta JSONB;
  v_tz TEXT := 'America/Monterrey';
  v_filtro_fecha BOOLEAN;
BEGIN
  v_actor := public.__admin_require_super_admin();

  SELECT p.organization_id
  INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_report: organización del actor no disponible'
      USING ERRCODE = '22023';
  END IF;

  v_estado := lower(btrim(COALESCE(p_estado, 'vigentes')));
  IF v_estado NOT IN ('vigentes', 'activos', 'rechazados') THEN
    RAISE EXCEPTION 'admin_report: p_estado inválido (vigentes|activos|rechazados)'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := lower(btrim(COALESCE(p_tipo_fecha, 'envio_mesa')));
  IF v_tipo NOT IN ('envio_mesa', 'entrada_paso_actual') THEN
    RAISE EXCEPTION 'admin_report: p_tipo_fecha inválido (envio_mesa|entrada_paso_actual)'
      USING ERRCODE = '22023';
  END IF;

  IF p_fecha_desde IS NOT NULL AND p_fecha_hasta IS NOT NULL
     AND p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'admin_report: p_fecha_desde no puede ser posterior a p_fecha_hasta'
      USING ERRCODE = '22023';
  END IF;

  v_filtro_fecha := (p_fecha_desde IS NOT NULL OR p_fecha_hasta IS NOT NULL);

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    v_pasos := ARRAY[1,2,3,4,5,6,7,8,9,10,11]::SMALLINT[];
  ELSE
    v_pasos := (
      SELECT array_agg(DISTINCT p ORDER BY p)
      FROM unnest(p_pasos_visuales) AS p
    );
    IF EXISTS (
      SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11
    ) THEN
      RAISE EXCEPTION 'admin_report: p_pasos_visuales debe estar entre 1 y 11'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_etapas := ARRAY[]::SMALLINT[];
  FOREACH v_paso IN ARRAY v_pasos
  LOOP
    IF v_paso = 3 THEN
      v_etapas := v_etapas || ARRAY[3, 4]::SMALLINT[];
    ELSIF v_paso <= 2 THEN
      v_etapas := v_etapas || ARRAY[v_paso]::SMALLINT[];
    ELSE
      v_etapas := v_etapas || ARRAY[(v_paso + 1)::SMALLINT];
    END IF;
  END LOOP;

  v_etapas := (
    SELECT array_agg(DISTINCT e ORDER BY e)
    FROM unnest(v_etapas) AS e
  );

  WITH universe AS (
    SELECT
      e.id AS expediente_id,
      public.admin_reporting_asesor_id(e.asesor_id) AS asesor_id,
      COALESCE(NULLIF(btrim(pl.full_name), ''), 'Asesor sin nombre registrado') AS asesor_nombre,
      NULLIF(btrim(pl.email), '') AS asesor_email,
      COALESCE(NULLIF(btrim(e.cliente_nombre), ''), '—') AS cliente_nombre,
      COALESCE(e.nss, '') AS nss,
      e.etapa_actual::INT AS etapa_actual,
      public.__map_etapa_interna_a_paso_visual(e.etapa_actual)::INT AS paso_visual,
      CASE
        WHEN e.subestado = 'rechazado' AND e.ciclo_estado = 'activo' THEN 'rechazado'
        ELSE 'activo'
      END AS estado,
      e.fecha_envio_mesa,
      e.fecha_entrada_paso_visual_actual,
      CASE
        WHEN e.fecha_envio_mesa IS NULL THEN NULL
        ELSE (e.fecha_envio_mesa AT TIME ZONE v_tz)::date
      END AS fecha_envio_mesa_ymd,
      CASE
        WHEN e.fecha_entrada_paso_visual_actual IS NULL THEN NULL
        ELSE (e.fecha_entrada_paso_visual_actual AT TIME ZONE v_tz)::date
      END AS fecha_entrada_paso_ymd
    FROM public.expedientes e
    LEFT JOIN public.profiles pl ON pl.id = public.admin_reporting_asesor_id(e.asesor_id)
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa IS TRUE
      AND e.ciclo_estado = 'activo'
      AND e.etapa_actual = ANY (v_etapas)
      AND (
        p_asesor_ids IS NULL
        OR cardinality(p_asesor_ids) IS NULL
        OR cardinality(p_asesor_ids) = 0
        OR e.asesor_id = ANY (
          SELECT DISTINCT x
          FROM unnest(p_asesor_ids) AS aid,
               LATERAL unnest(public.admin_expand_asesor_ids(aid)) AS x
        )
      )
      AND (
        (v_estado = 'vigentes')
        OR (v_estado = 'activos' AND e.subestado IS DISTINCT FROM 'rechazado')
        OR (
          v_estado = 'rechazados'
          AND e.subestado = 'rechazado'
        )
      )
  ),
  stats AS (
    SELECT
      COUNT(*) FILTER (
        WHERE CASE
          WHEN v_tipo = 'envio_mesa' THEN fecha_envio_mesa IS NULL
          ELSE fecha_entrada_paso_visual_actual IS NULL
        END
      )::INT AS sin_fecha
    FROM universe
  ),
  filtered AS (
    SELECT u.*
    FROM universe u
    WHERE
      CASE
        WHEN NOT v_filtro_fecha THEN TRUE
        WHEN v_tipo = 'envio_mesa' THEN
          CASE
            WHEN u.fecha_envio_mesa IS NULL THEN FALSE
            ELSE
              (p_fecha_desde IS NULL OR u.fecha_envio_mesa_ymd >= p_fecha_desde)
              AND (p_fecha_hasta IS NULL OR u.fecha_envio_mesa_ymd <= p_fecha_hasta)
          END
        ELSE
          CASE
            WHEN u.fecha_entrada_paso_visual_actual IS NULL THEN FALSE
            ELSE
              (p_fecha_desde IS NULL OR u.fecha_entrada_paso_ymd >= p_fecha_desde)
              AND (p_fecha_hasta IS NULL OR u.fecha_entrada_paso_ymd <= p_fecha_hasta)
          END
      END
  ),
  named AS (
    SELECT
      f.*,
      CASE f.paso_visual
        WHEN 1 THEN 'Integración'
        WHEN 2 THEN 'Registro'
        WHEN 3 THEN 'Listo para cita de biométrico'
        WHEN 4 THEN 'Biometría (resultado)'
        WHEN 5 THEN 'Inscripción'
        WHEN 6 THEN 'Notificación'
        WHEN 7 THEN 'Acuse / Aviso de retención'
        WHEN 8 THEN 'Listo para agendar firma'
        WHEN 9 THEN 'Cita para firma'
        WHEN 10 THEN 'Firmado'
        WHEN 11 THEN 'Pago a ConCasa'
        ELSE 'Paso ' || f.paso_visual::text
      END AS paso_nombre
    FROM filtered f
  ),
  resumen_rows AS (
    SELECT
      n.asesor_id,
      n.asesor_nombre,
      n.asesor_email,
      n.paso_visual,
      n.paso_nombre,
      COUNT(*) FILTER (WHERE n.estado = 'activo')::INT AS activos,
      COUNT(*) FILTER (WHERE n.estado = 'rechazado')::INT AS rechazados,
      COUNT(*)::INT AS total
    FROM named n
    GROUP BY n.asesor_id, n.asesor_nombre, n.asesor_email, n.paso_visual, n.paso_nombre
  ),
  detalle_rows AS (
    SELECT
      n.asesor_id,
      n.asesor_nombre,
      n.asesor_email,
      n.cliente_nombre,
      n.nss,
      n.etapa_actual,
      n.paso_visual,
      n.paso_nombre,
      n.estado,
      CASE
        WHEN n.fecha_entrada_paso_ymd IS NULL THEN NULL
        ELSE to_char(n.fecha_entrada_paso_ymd, 'YYYY-MM-DD')
      END AS fecha_entrada_paso_actual,
      CASE
        WHEN n.fecha_envio_mesa_ymd IS NULL THEN NULL
        ELSE to_char(n.fecha_envio_mesa_ymd, 'YYYY-MM-DD')
      END AS fecha_envio_mesa
    FROM named n
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'asesor_id', r.asesor_id,
            'asesor_nombre', r.asesor_nombre,
            'asesor_email', r.asesor_email,
            'paso_visual', r.paso_visual,
            'paso_nombre', r.paso_nombre,
            'activos', r.activos,
            'rechazados', r.rechazados,
            'total', r.total
          )
          ORDER BY lower(r.asesor_nombre), r.paso_visual
        )
        FROM resumen_rows r
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'asesor_id', d.asesor_id,
            'asesor_nombre', d.asesor_nombre,
            'asesor_email', d.asesor_email,
            'cliente_nombre', d.cliente_nombre,
            'nss', d.nss,
            'etapa_actual', d.etapa_actual,
            'paso_visual', d.paso_visual,
            'paso_nombre', d.paso_nombre,
            'estado', d.estado,
            'fecha_entrada_paso_actual', d.fecha_entrada_paso_actual,
            'fecha_envio_mesa', d.fecha_envio_mesa
          )
          ORDER BY lower(d.asesor_nombre), d.paso_visual, lower(d.cliente_nombre)
        )
        FROM detalle_rows d
      ),
      '[]'::jsonb
    ),
    jsonb_build_object(
      'asesores', (SELECT COUNT(DISTINCT asesor_id)::INT FROM named),
      'pasos', (SELECT COUNT(DISTINCT paso_visual)::INT FROM named),
      'activos', (SELECT COUNT(*) FILTER (WHERE estado = 'activo')::INT FROM named),
      'rechazados', (SELECT COUNT(*) FILTER (WHERE estado = 'rechazado')::INT FROM named),
      'expedientes', (SELECT COUNT(*)::INT FROM named),
      'tipo_fecha', v_tipo,
      'sin_fecha_canonica', (SELECT sin_fecha FROM stats),
      'excluidos_por_fecha_desconocida',
        CASE WHEN v_filtro_fecha THEN (SELECT sin_fecha FROM stats) ELSE 0 END
    )
  INTO v_resumen, v_detalle, v_meta;

  RETURN jsonb_build_object(
    'resumen', COALESCE(v_resumen, '[]'::jsonb),
    'detalle', COALESCE(v_detalle, '[]'::jsonb),
    'meta', COALESCE(v_meta, jsonb_build_object(
      'asesores', 0, 'pasos', 0, 'activos', 0, 'rechazados', 0, 'expedientes', 0,
      'tipo_fecha', v_tipo,
      'sin_fecha_canonica', 0, 'excluidos_por_fecha_desconocida', 0
    ))
  );
END;
$$;

COMMENT ON FUNCTION public.admin_report_expedientes_asesores_etapas_v3(UUID[], SMALLINT[], TEXT, TEXT, DATE, DATE) IS
  'P116: reporte Super Admin v3 — tipo fecha envio_mesa (default) o entrada_paso_actual; fechas America/Monterrey. P112/P114 intactas.';

REVOKE ALL ON FUNCTION public.admin_report_expedientes_asesores_etapas_v3(UUID[], SMALLINT[], TEXT, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_report_expedientes_asesores_etapas_v3(UUID[], SMALLINT[], TEXT, TEXT, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_report_expedientes_asesores_etapas_v3(UUID[], SMALLINT[], TEXT, TEXT, DATE, DATE) TO authenticated;
