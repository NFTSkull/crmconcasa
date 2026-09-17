-- Admin Resumen: Paso 1 (Integración) usa el envío real a Mesa como fuente de negocio.
-- No backfill, no UPDATE/DELETE de expedientes ni historial.
-- Pasos 2+ conservan el historial canónico de transiciones.

CREATE OR REPLACE FUNCTION public.admin_resumen_movimientos_etapas(
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
AS $function$
DECLARE
  v_actor UUID;
  v_estado TEXT;
  v_q TEXT;
  v_coverage TIMESTAMPTZ;
  v_by_paso JSONB;
  v_by_paso_admin JSONB;
  v_snapshot JSONB;
  v_total_expedientes BIGINT := 0;
BEGIN
  v_actor := public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_from >= p_to_exclusive THEN
    RAISE EXCEPTION 'admin_resumen_movimientos_etapas: rango inválido'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado, ''))), '');
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;
  IF v_estado IS NOT NULL
     AND v_estado NOT IN ('activos', 'finalizados', 'rechazados', 'cancelados') THEN
    RAISE EXCEPTION 'admin_resumen_movimientos_etapas: p_estado inválido'
      USING ERRCODE = '22023';
  END IF;

  v_q := NULLIF(btrim(COALESCE(p_buscar, '')), '');

  SELECT min(t.fecha_entrada)
    INTO v_coverage
  FROM public.expediente_paso_visual_transiciones t;

  -- Paso visual 1 = ingreso real a Mesa dentro del rango.
  -- Pasos 2-11 = expedientes únicos que alcanzaron el paso durante el rango.
  WITH cohort_periodo AS (
    SELECT e.id AS expediente_id, e.fecha_envio_mesa
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa >= p_from
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (
        p_asesor_id IS NULL
        OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id))
      )
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos'
            AND e.ciclo_estado = 'activo'
            AND e.subestado <> 'rechazado')
        OR (v_estado = 'finalizados'
            AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (v_estado = 'rechazados'
            AND e.subestado = 'rechazado'
            AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR COALESCE(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::TEXT ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::TEXT ILIKE '%' || v_q || '%'
      )
  ),
  cohort_stats AS (
    SELECT count(*)::BIGINT AS total FROM cohort_periodo
  ),
  moved AS (
    SELECT DISTINCT
      t.expediente_id,
      t.paso_visual_nuevo::INT AS paso_visual,
      e.fecha_envio_mesa
    FROM public.expediente_paso_visual_transiciones t
    JOIN public.expedientes e ON e.id = t.expediente_id
    WHERE t.fecha_entrada >= p_from
      AND t.fecha_entrada < p_to_exclusive
      AND t.paso_visual_nuevo BETWEEN 2 AND 11
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (
        p_asesor_id IS NULL
        OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id))
      )
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos'
            AND e.ciclo_estado = 'activo'
            AND e.subestado <> 'rechazado')
        OR (v_estado = 'finalizados'
            AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (v_estado = 'rechazados'
            AND e.subestado = 'rechazado'
            AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR COALESCE(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::TEXT ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::TEXT ILIKE '%' || v_q || '%'
      )
  ),
  por_paso AS (
    SELECT
      s.paso_visual,
      CASE
        WHEN s.paso_visual = 1 THEN cs.total
        ELSE count(m.expediente_id)::BIGINT
      END AS llegaron_count,
      CASE
        WHEN s.paso_visual = 1 THEN 0::BIGINT
        ELSE count(m.expediente_id) FILTER (
          WHERE m.fecha_envio_mesa < p_from
        )::BIGINT
      END AS venian_de_antes_count,
      CASE
        WHEN s.paso_visual = 1 THEN cs.total
        ELSE count(m.expediente_id) FILTER (
          WHERE m.fecha_envio_mesa >= p_from
            AND m.fecha_envio_mesa < p_to_exclusive
        )::BIGINT
      END AS cohorte_periodo_count
    FROM generate_series(1, 11) AS s(paso_visual)
    CROSS JOIN cohort_stats cs
    LEFT JOIN moved m ON m.paso_visual = s.paso_visual
    GROUP BY s.paso_visual, cs.total
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'paso_visual', p.paso_visual,
          'llegaron_count', p.llegaron_count,
          'venian_de_antes_count', p.venian_de_antes_count,
          'cohorte_periodo_count', p.cohorte_periodo_count
        )
        ORDER BY p.paso_visual
      ),
      '[]'::JSONB
    )
    INTO v_by_paso
  FROM por_paso p;

  -- Misma semántica en los 10 pasos visibles de Admin.
  WITH cohort_periodo AS (
    SELECT e.id AS expediente_id, e.fecha_envio_mesa
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa >= p_from
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (
        p_asesor_id IS NULL
        OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id))
      )
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos'
            AND e.ciclo_estado = 'activo'
            AND e.subestado <> 'rechazado')
        OR (v_estado = 'finalizados'
            AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (v_estado = 'rechazados'
            AND e.subestado = 'rechazado'
            AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR COALESCE(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::TEXT ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::TEXT ILIKE '%' || v_q || '%'
      )
  ),
  cohort_stats AS (
    SELECT count(*)::BIGINT AS total FROM cohort_periodo
  ),
  moved_admin AS (
    SELECT DISTINCT
      t.expediente_id,
      CASE
        WHEN t.paso_visual_nuevo BETWEEN 2 AND 7 THEN t.paso_visual_nuevo::INT
        WHEN t.paso_visual_nuevo IN (8, 9) THEN 8
        WHEN t.paso_visual_nuevo = 10 THEN 9
        WHEN t.paso_visual_nuevo = 11 THEN 10
        ELSE NULL
      END AS paso_admin,
      e.fecha_envio_mesa
    FROM public.expediente_paso_visual_transiciones t
    JOIN public.expedientes e ON e.id = t.expediente_id
    WHERE t.fecha_entrada >= p_from
      AND t.fecha_entrada < p_to_exclusive
      AND t.paso_visual_nuevo BETWEEN 2 AND 11
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (
        p_asesor_id IS NULL
        OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id))
      )
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos'
            AND e.ciclo_estado = 'activo'
            AND e.subestado <> 'rechazado')
        OR (v_estado = 'finalizados'
            AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (v_estado = 'rechazados'
            AND e.subestado = 'rechazado'
            AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR COALESCE(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::TEXT ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::TEXT ILIKE '%' || v_q || '%'
      )
  ),
  por_paso_admin AS (
    SELECT
      s.paso_admin,
      CASE
        WHEN s.paso_admin = 1 THEN cs.total
        ELSE count(m.expediente_id)::BIGINT
      END AS llegaron_count,
      CASE
        WHEN s.paso_admin = 1 THEN 0::BIGINT
        ELSE count(m.expediente_id) FILTER (
          WHERE m.fecha_envio_mesa < p_from
        )::BIGINT
      END AS venian_de_antes_count,
      CASE
        WHEN s.paso_admin = 1 THEN cs.total
        ELSE count(m.expediente_id) FILTER (
          WHERE m.fecha_envio_mesa >= p_from
            AND m.fecha_envio_mesa < p_to_exclusive
        )::BIGINT
      END AS cohorte_periodo_count
    FROM generate_series(1, 10) AS s(paso_admin)
    CROSS JOIN cohort_stats cs
    LEFT JOIN moved_admin m ON m.paso_admin = s.paso_admin
    GROUP BY s.paso_admin, cs.total
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'paso_admin', p.paso_admin,
          'llegaron_count', p.llegaron_count,
          'venian_de_antes_count', p.venian_de_antes_count,
          'cohorte_periodo_count', p.cohorte_periodo_count
        )
        ORDER BY p.paso_admin
      ),
      '[]'::JSONB
    )
    INTO v_by_paso_admin
  FROM por_paso_admin p;

  -- Actividad única del periodo = nuevos ingresos a Mesa + expedientes previos
  -- que efectivamente avanzaron durante el rango.
  WITH cohort_periodo AS (
    SELECT e.id AS expediente_id
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa >= p_from
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (
        p_asesor_id IS NULL
        OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id))
      )
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos'
            AND e.ciclo_estado = 'activo'
            AND e.subestado <> 'rechazado')
        OR (v_estado = 'finalizados'
            AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (v_estado = 'rechazados'
            AND e.subestado = 'rechazado'
            AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR COALESCE(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::TEXT ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::TEXT ILIKE '%' || v_q || '%'
      )
  ),
  moved AS (
    SELECT DISTINCT t.expediente_id
    FROM public.expediente_paso_visual_transiciones t
    JOIN public.expedientes e ON e.id = t.expediente_id
    WHERE t.fecha_entrada >= p_from
      AND t.fecha_entrada < p_to_exclusive
      AND t.paso_visual_nuevo BETWEEN 2 AND 11
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (
        p_asesor_id IS NULL
        OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id))
      )
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos'
            AND e.ciclo_estado = 'activo'
            AND e.subestado <> 'rechazado')
        OR (v_estado = 'finalizados'
            AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (v_estado = 'rechazados'
            AND e.subestado = 'rechazado'
            AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR COALESCE(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::TEXT ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::TEXT ILIKE '%' || v_q || '%'
      )
  ),
  activity AS (
    SELECT expediente_id FROM cohort_periodo
    UNION
    SELECT expediente_id FROM moved
  )
  SELECT count(*)::BIGINT
    INTO v_total_expedientes
  FROM activity;

  SELECT public.admin_expedientes_snapshot_etapas(
    p_asesor_id,
    v_estado,
    v_q
  )
  INTO v_snapshot;

  RETURN jsonb_build_object(
    'from', p_from,
    'to_exclusive', p_to_exclusive,
    'generated_at', clock_timestamp(),
    'history_coverage_from', v_coverage,
    'history_complete_for_period',
      CASE WHEN v_coverage IS NULL THEN FALSE ELSE p_from >= v_coverage END,
    'total_expedientes_movidos', v_total_expedientes,
    'by_paso_visual', COALESCE(v_by_paso, '[]'::JSONB),
    'by_paso_admin', COALESCE(v_by_paso_admin, '[]'::JSONB),
    'admin_steps', 10,
    'movement_semantics_version', 2,
    'snapshot', COALESCE(v_snapshot, '{}'::JSONB),
    'timezone', 'America/Monterrey',
    'asesor_fuente', 'actual',
    'nota', 'Paso 1 = ingreso real a Mesa por fecha_envio_mesa. Pasos 2-10 = expedientes únicos que alcanzaron la etapa dentro del periodo. Un expediente puede aparecer en varias etapas.'
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_resumen_movimientos_etapas(timestamptz, timestamptz, uuid, text, text) IS
  'Resumen Admin read-only. Paso 1 usa fecha_envio_mesa; pasos posteriores usan historial de transiciones. Sin backfill.';
