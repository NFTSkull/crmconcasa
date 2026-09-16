-- ConCasa CRM — Resumen Admin: movimientos del periodo + foto actual por paso visual.
-- Solo lectura. No toca expedientes, agenda, citas, cupos, documentos ni Sheets.
-- Fuente histórica: expediente_paso_visual_transiciones (append-only desde P114).
-- Fuente foto actual: admin_expedientes_snapshot_etapas existente.

CREATE OR REPLACE FUNCTION public.admin_resumen_movimientos_etapas(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
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
  v_actor UUID;
  v_estado TEXT;
  v_q TEXT;
  v_coverage TIMESTAMPTZ;
  v_by_paso JSONB;
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

  WITH moved AS (
    SELECT DISTINCT
      t.expediente_id,
      t.paso_visual_nuevo::INT AS paso_visual,
      e.fecha_envio_mesa
    FROM public.expediente_paso_visual_transiciones t
    JOIN public.expedientes e ON e.id = t.expediente_id
    WHERE t.fecha_entrada >= p_from
      AND t.fecha_entrada < p_to_exclusive
      -- Solo avance real o primera entrada. Un retroceso no se reporta como avance.
      AND (
        t.paso_visual_anterior IS NULL
        OR t.paso_visual_nuevo > t.paso_visual_anterior
      )
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      -- Para consultar periodos pasados, no incluir expedientes que todavía no
      -- habían sido enviados a Mesa al cierre de ese periodo.
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
      count(m.expediente_id)::BIGINT AS llegaron_count,
      count(m.expediente_id) FILTER (
        WHERE m.fecha_envio_mesa < p_from
      )::BIGINT AS venian_de_antes_count,
      count(m.expediente_id) FILTER (
        WHERE m.fecha_envio_mesa >= p_from
          AND m.fecha_envio_mesa < p_to_exclusive
      )::BIGINT AS cohorte_periodo_count
    FROM generate_series(1, 11) AS s(paso_visual)
    LEFT JOIN moved m ON m.paso_visual = s.paso_visual
    GROUP BY s.paso_visual
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

  WITH moved AS (
    SELECT DISTINCT t.expediente_id
    FROM public.expediente_paso_visual_transiciones t
    JOIN public.expedientes e ON e.id = t.expediente_id
    WHERE t.fecha_entrada >= p_from
      AND t.fecha_entrada < p_to_exclusive
      AND (
        t.paso_visual_anterior IS NULL
        OR t.paso_visual_nuevo > t.paso_visual_anterior
      )
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
  )
  SELECT count(*)::BIGINT INTO v_total_expedientes FROM moved;

  -- Reutiliza el snapshot vigente existente para no duplicar lógica de stock,
  -- búsqueda, estado ni roll-up de equipo.
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
    'snapshot', COALESCE(v_snapshot, '{}'::JSONB),
    'timezone', 'America/Monterrey',
    'asesor_fuente', 'actual',
    'nota', 'Movimientos = primera entrada o avance hacia un paso visual posterior dentro del periodo. Venían de antes = fecha_envio_mesa anterior al inicio del periodo. Foto actual = stock vigente, independiente de las fechas.'
  );
END;
$$;

COMMENT ON FUNCTION public.admin_resumen_movimientos_etapas(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT
) IS
  'Admin RO: movimientos/avances del periodo por paso visual + foto actual. Solo super_admin; sin escrituras.';

REVOKE ALL ON FUNCTION public.admin_resumen_movimientos_etapas(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resumen_movimientos_etapas(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_resumen_movimientos_etapas(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT
) TO authenticated, service_role, postgres;
