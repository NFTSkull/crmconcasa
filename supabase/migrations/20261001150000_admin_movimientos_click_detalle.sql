-- ConCasa CRM — detalle read-only de expedientes con movimiento para Admin.
-- Permite que el KPI "Expedientes con movimiento" se abra y muestre exactamente
-- qué expedientes componen el total, dónde están hoy y qué pasos tocaron en el periodo.
-- Sin escrituras ni cambios al flujo operativo.

CREATE OR REPLACE FUNCTION public.admin_movimientos_expedientes_detalle(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_asesor_id UUID DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_buscar TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 250
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
  v_limit INTEGER;
  v_total BIGINT := 0;
  v_items JSONB := '[]'::JSONB;
  v_by_current JSONB := '[]'::JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_from >= p_to_exclusive THEN
    RAISE EXCEPTION 'admin_movimientos_expedientes_detalle: rango inválido'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado, ''))), '');
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;
  IF v_estado IS NOT NULL
     AND v_estado NOT IN ('activos', 'finalizados', 'rechazados', 'cancelados') THEN
    RAISE EXCEPTION 'admin_movimientos_expedientes_detalle: p_estado inválido'
      USING ERRCODE = '22023';
  END IF;

  v_q := NULLIF(btrim(COALESCE(p_buscar, '')), '');
  v_limit := LEAST(500, GREATEST(1, COALESCE(p_limit, 250)));

  WITH moved_events AS (
    SELECT
      t.expediente_id,
      t.fecha_entrada,
      CASE
        WHEN t.paso_visual_nuevo BETWEEN 1 AND 7 THEN t.paso_visual_nuevo::INT
        WHEN t.paso_visual_nuevo IN (8, 9) THEN 8
        WHEN t.paso_visual_nuevo = 10 THEN 9
        WHEN t.paso_visual_nuevo = 11 THEN 10
        ELSE NULL
      END AS paso_admin_movido
    FROM public.expediente_paso_visual_transiciones t
    JOIN public.expedientes e ON e.id = t.expediente_id
    WHERE t.fecha_entrada >= p_from
      AND t.fecha_entrada < p_to_exclusive
      AND t.paso_visual_nuevo BETWEEN 1 AND 11
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
  moved AS (
    SELECT
      me.expediente_id,
      min(me.fecha_entrada) AS primer_movimiento_at,
      max(me.fecha_entrada) AS ultimo_movimiento_at,
      count(*)::INT AS movimientos_count,
      count(DISTINCT me.paso_admin_movido)::INT AS pasos_movidos_count,
      array_agg(DISTINCT me.paso_admin_movido ORDER BY me.paso_admin_movido)
        FILTER (WHERE me.paso_admin_movido IS NOT NULL) AS pasos_admin
    FROM moved_events me
    GROUP BY me.expediente_id
  )
  SELECT count(*)::BIGINT
  INTO v_total
  FROM moved;

  WITH moved_events AS (
    SELECT
      t.expediente_id,
      t.fecha_entrada,
      CASE
        WHEN t.paso_visual_nuevo BETWEEN 1 AND 7 THEN t.paso_visual_nuevo::INT
        WHEN t.paso_visual_nuevo IN (8, 9) THEN 8
        WHEN t.paso_visual_nuevo = 10 THEN 9
        WHEN t.paso_visual_nuevo = 11 THEN 10
        ELSE NULL
      END AS paso_admin_movido
    FROM public.expediente_paso_visual_transiciones t
    JOIN public.expedientes e ON e.id = t.expediente_id
    WHERE t.fecha_entrada >= p_from
      AND t.fecha_entrada < p_to_exclusive
      AND t.paso_visual_nuevo BETWEEN 1 AND 11
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
  moved AS (
    SELECT
      me.expediente_id,
      min(me.fecha_entrada) AS primer_movimiento_at,
      max(me.fecha_entrada) AS ultimo_movimiento_at,
      count(*)::INT AS movimientos_count,
      count(DISTINCT me.paso_admin_movido)::INT AS pasos_movidos_count,
      array_agg(DISTINCT me.paso_admin_movido ORDER BY me.paso_admin_movido)
        FILTER (WHERE me.paso_admin_movido IS NOT NULL) AS pasos_admin
    FROM moved_events me
    GROUP BY me.expediente_id
  ),
  rows AS (
    SELECT
      e.id AS expediente_id,
      e.cliente_nombre,
      btrim(COALESCE(e.nss, '')) AS nss,
      e.programa::TEXT AS programa,
      e.asesor_id,
      COALESCE(NULLIF(btrim(p.full_name), ''), p.email, e.asesor_id::TEXT) AS asesor_nombre,
      e.fecha_envio_mesa,
      e.etapa_actual::INT AS etapa_actual,
      CASE
        WHEN e.etapa_actual = 1 THEN 1
        WHEN e.etapa_actual = 2 THEN 2
        WHEN e.etapa_actual IN (3, 4) THEN 3
        WHEN e.etapa_actual = 5 THEN 4
        WHEN e.etapa_actual = 6 THEN 5
        WHEN e.etapa_actual = 7 THEN 6
        WHEN e.etapa_actual = 8 THEN 7
        WHEN e.etapa_actual IN (9, 10) THEN 8
        WHEN e.etapa_actual = 11 THEN 9
        WHEN e.etapa_actual = 12 THEN 10
        ELSE NULL
      END AS paso_admin_actual,
      m.primer_movimiento_at,
      m.ultimo_movimiento_at,
      m.movimientos_count,
      m.pasos_movidos_count,
      COALESCE(m.pasos_admin, ARRAY[]::INT[]) AS pasos_admin,
      (e.fecha_envio_mesa >= p_from AND e.fecha_envio_mesa < p_to_exclusive) AS ingreso_en_periodo
    FROM moved m
    JOIN public.expedientes e ON e.id = m.expediente_id
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
  ),
  limited AS (
    SELECT *
    FROM rows
    ORDER BY ultimo_movimiento_at DESC, cliente_nombre ASC, expediente_id
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'expediente_id', r.expediente_id,
        'cliente_nombre', r.cliente_nombre,
        'nss', r.nss,
        'programa', r.programa,
        'asesor_id', r.asesor_id,
        'asesor_nombre', r.asesor_nombre,
        'fecha_envio_mesa', r.fecha_envio_mesa,
        'etapa_actual', r.etapa_actual,
        'paso_admin_actual', r.paso_admin_actual,
        'primer_movimiento_at', r.primer_movimiento_at,
        'ultimo_movimiento_at', r.ultimo_movimiento_at,
        'movimientos_count', r.movimientos_count,
        'pasos_movidos_count', r.pasos_movidos_count,
        'pasos_admin', to_jsonb(r.pasos_admin),
        'ingreso_en_periodo', r.ingreso_en_periodo
      )
      ORDER BY r.ultimo_movimiento_at DESC, r.cliente_nombre ASC, r.expediente_id
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM limited r;

  WITH moved_ids AS (
    SELECT DISTINCT t.expediente_id
    FROM public.expediente_paso_visual_transiciones t
    JOIN public.expedientes e ON e.id = t.expediente_id
    WHERE t.fecha_entrada >= p_from
      AND t.fecha_entrada < p_to_exclusive
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
  current_steps AS (
    SELECT
      CASE
        WHEN e.etapa_actual = 1 THEN 1
        WHEN e.etapa_actual = 2 THEN 2
        WHEN e.etapa_actual IN (3, 4) THEN 3
        WHEN e.etapa_actual = 5 THEN 4
        WHEN e.etapa_actual = 6 THEN 5
        WHEN e.etapa_actual = 7 THEN 6
        WHEN e.etapa_actual = 8 THEN 7
        WHEN e.etapa_actual IN (9, 10) THEN 8
        WHEN e.etapa_actual = 11 THEN 9
        WHEN e.etapa_actual = 12 THEN 10
        ELSE NULL
      END AS paso_admin_actual
    FROM moved_ids m
    JOIN public.expedientes e ON e.id = m.expediente_id
  ),
  counts AS (
    SELECT
      s.paso_admin,
      count(c.paso_admin_actual)::BIGINT AS count
    FROM generate_series(1, 10) AS s(paso_admin)
    LEFT JOIN current_steps c ON c.paso_admin_actual = s.paso_admin
    GROUP BY s.paso_admin
    ORDER BY s.paso_admin
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'paso_admin', c.paso_admin,
        'count', c.count
      )
      ORDER BY c.paso_admin
    ),
    '[]'::JSONB
  )
  INTO v_by_current
  FROM counts c;

  RETURN jsonb_build_object(
    'from', p_from,
    'to_exclusive', p_to_exclusive,
    'total_count', v_total,
    'limit', v_limit,
    'truncated', v_total > v_limit,
    'items', COALESCE(v_items, '[]'::JSONB),
    'by_current_paso_admin', COALESCE(v_by_current, '[]'::JSONB),
    'generated_at', clock_timestamp(),
    'timezone', 'America/Monterrey',
    'nota', 'Cada expediente aparece una vez. movimientos_count = transiciones registradas en el periodo; pasos_admin = pasos visibles que tocó; by_current_paso_admin = dónde están hoy esos expedientes.'
  );
END;
$$;

COMMENT ON FUNCTION public.admin_movimientos_expedientes_detalle(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, INTEGER
) IS
  'Super Admin RO: detalle de expedientes únicos con movimiento en el periodo, pasos tocados y distribución por etapa actual. Sin escrituras.';

REVOKE ALL ON FUNCTION public.admin_movimientos_expedientes_detalle(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_movimientos_expedientes_detalle(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, INTEGER
) TO authenticated, service_role, postgres;
