-- ConCasa CRM — Admin: reporte histórico de flujo por etapas (pasos visuales)
-- Fuente: expediente_paso_visual_transiciones (P114). Sin inventar historial.
-- No modifica snapshot (147/148) ni admin_report_* v1/v2/v3.

CREATE INDEX IF NOT EXISTS expediente_paso_visual_transiciones_paso_fecha_idx
  ON public.expediente_paso_visual_transiciones (paso_visual_nuevo, fecha_entrada);

COMMENT ON INDEX public.expediente_paso_visual_transiciones_paso_fecha_idx IS
  'P149: filtro por entrada a paso visual + rango temporal (reporte histórico Admin).';

-- =============================================================================
-- Helper: bounds TZ Monterrey [desde, hasta] inclusive → timestamptz half-open
-- =============================================================================
CREATE OR REPLACE FUNCTION public.__admin_stage_history_bounds(
  p_fecha_desde DATE,
  p_fecha_hasta DATE,
  OUT o_from TIMESTAMPTZ,
  OUT o_to_exclusive TIMESTAMPTZ
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tz TEXT := 'America/Monterrey';
BEGIN
  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL THEN
    RAISE EXCEPTION 'admin_stage_history: p_fecha_desde y p_fecha_hasta son obligatorios'
      USING ERRCODE = '22023';
  END IF;
  IF p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'admin_stage_history: p_fecha_desde no puede ser posterior a p_fecha_hasta'
      USING ERRCODE = '22023';
  END IF;
  o_from := (p_fecha_desde::timestamp AT TIME ZONE v_tz);
  o_to_exclusive := ((p_fecha_hasta + 1)::timestamp AT TIME ZONE v_tz);
END;
$$;

REVOKE ALL ON FUNCTION public.__admin_stage_history_bounds(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.__admin_stage_history_bounds(DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.__admin_stage_history_bounds(DATE, DATE)
  TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.__admin_stage_history_bounds(DATE, DATE) IS
  'P149: convierte rango DATE inclusivo (America/Monterrey) a [from, to_exclusive) timestamptz.';

-- =============================================================================
-- admin_stage_history_report_summary
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_stage_history_report_summary(
  p_asesor_ids UUID[] DEFAULT NULL,
  p_pasos_visuales SMALLINT[] DEFAULT NULL,
  p_movimiento TEXT DEFAULT 'entrada',
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_estado_actual TEXT DEFAULT NULL,
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
  v_pasos SMALLINT[];
  v_mov TEXT;
  v_estado TEXT;
  v_q TEXT;
  v_from TIMESTAMPTZ;
  v_to_excl TIMESTAMPTZ;
  v_coverage TIMESTAMPTZ;
  v_resumen JSONB;
  v_totales JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  v_mov := lower(btrim(COALESCE(p_movimiento, 'entrada')));
  IF v_mov NOT IN ('entrada', 'avance', 'estuvieron', 'estado_actual') THEN
    RAISE EXCEPTION 'admin_stage_history: p_movimiento inválido (entrada|avance|estuvieron|estado_actual)'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado_actual, ''))), '');
  IF v_estado IS NOT NULL AND v_estado NOT IN ('activos', 'rechazados', 'cancelados', 'todos') THEN
    RAISE EXCEPTION 'admin_stage_history: p_estado_actual inválido'
      USING ERRCODE = '22023';
  END IF;
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    v_pasos := ARRAY[1,2,3,4,5,6,7,8,9,10,11]::SMALLINT[];
  ELSE
    v_pasos := (
      SELECT array_agg(DISTINCT p ORDER BY p)
      FROM unnest(p_pasos_visuales) AS p
    );
    IF EXISTS (SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11) THEN
      RAISE EXCEPTION 'admin_stage_history: p_pasos_visuales debe estar entre 1 y 11'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  IF v_mov = 'estado_actual' THEN
    -- Referencia snapshot por etapa_actual (no histórico). Fechas opcionales no aplican a visitas.
    SELECT coalesce(min(t.fecha_entrada), NULL) INTO v_coverage
    FROM public.expediente_paso_visual_transiciones t;

    WITH base AS (
      SELECT
        e.id AS expediente_id,
        public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso,
        e.ciclo_estado,
        e.subestado
      FROM public.expedientes e
      LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
        AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
             OR e.asesor_id = ANY (p_asesor_ids))
        AND public.__map_etapa_interna_a_paso_visual(e.etapa_actual) = ANY (v_pasos)
        AND (
          v_estado IS NULL
          OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
        )
        AND (
          v_q IS NULL
          OR e.cliente_nombre ILIKE '%' || v_q || '%'
          OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
          OR e.id::text ILIKE '%' || v_q || '%'
          OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
          OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
          OR e.programa::text ILIKE '%' || v_q || '%'
        )
    ),
    por_paso AS (
      SELECT
        s.paso,
        count(b.expediente_id)::BIGINT AS entered_count,
        0::BIGINT AS advanced_count,
        count(b.expediente_id)::BIGINT AS current_count,
        count(b.expediente_id) FILTER (WHERE b.subestado = 'rechazado')::BIGINT AS rejected_count,
        0::BIGINT AS returned_count,
        count(b.expediente_id)::BIGINT AS visitas,
        count(DISTINCT b.expediente_id)::BIGINT AS unicos
      FROM generate_series(1, 11) AS s(paso)
      LEFT JOIN base b ON b.paso = s.paso
      WHERE s.paso = ANY (v_pasos)
      GROUP BY s.paso
    ),
    snap_agg AS (
      SELECT
        coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'paso_visual', p.paso,
              'paso_nombre', CASE p.paso
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
                ELSE 'Paso ' || p.paso::text
              END,
              'entered_count', p.entered_count,
              'advanced_count', p.advanced_count,
              'current_count', p.current_count,
              'rejected_count', p.rejected_count,
              'returned_count', p.returned_count,
              'visitas', p.visitas,
              'expedientes_unicos', p.unicos,
              'avg_duration_seconds', NULL,
              'median_duration_seconds', NULL,
              'tasa_avance', NULL,
              'tasa_pendiente', CASE WHEN p.entered_count = 0 THEN NULL
                ELSE round((p.current_count::NUMERIC * 1000 / p.entered_count) / 10.0, 1) END
            )
            ORDER BY p.paso
          )
          FROM por_paso p
        ), '[]'::jsonb) AS resumen,
        jsonb_build_object(
          'total_expedientes_unicos', coalesce((SELECT count(DISTINCT expediente_id) FROM base), 0),
          'total_visitas', coalesce((SELECT count(*) FROM base), 0),
          'entered_count', coalesce((SELECT count(*) FROM base), 0),
          'advanced_count', 0,
          'current_count', coalesce((SELECT count(*) FROM base), 0),
          'rejected_count', coalesce((SELECT count(*) FROM base WHERE subestado = 'rechazado'), 0),
          'returned_count', 0,
          'avg_duration_seconds', NULL,
          'median_duration_seconds', NULL
        ) AS totales
    )
    SELECT snap_agg.resumen, snap_agg.totales INTO v_resumen, v_totales FROM snap_agg;

    RETURN jsonb_build_object(
      'totales', v_totales,
      'resumen_por_etapa', coalesce(v_resumen, '[]'::jsonb),
      'generated_at', clock_timestamp(),
      'history_coverage_from', v_coverage,
      'movimiento', v_mov,
      'nota', 'Modo referencia: estado actual (etapa_actual). No es historial de visitas.'
    );
  END IF;

  SELECT * INTO v_from, v_to_excl
  FROM public.__admin_stage_history_bounds(p_fecha_desde, p_fecha_hasta);

  SELECT min(t.fecha_entrada) INTO v_coverage
  FROM public.expediente_paso_visual_transiciones t;

  WITH ordered AS (
    SELECT
      t.id AS visita_id,
      t.expediente_id,
      t.paso_visual_nuevo AS paso,
      t.etapa_nueva,
      t.etapa_anterior,
      t.paso_visual_anterior,
      t.fecha_entrada AS entered_at,
      t.actor_user_id,
      lead(t.fecha_entrada) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS exited_at,
      lead(t.paso_visual_nuevo) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_paso,
      lead(t.etapa_nueva) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_etapa
    FROM public.expediente_paso_visual_transiciones t
  ),
  visits AS (
    SELECT
      o.*,
      e.asesor_id,
      e.cliente_nombre,
      e.nss,
      e.programa::text AS programa,
      e.etapa_actual,
      e.subestado,
      e.ciclo_estado,
      e.fecha_envio_mesa,
      public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso_actual,
      CASE
        WHEN o.exited_at IS NULL THEN 'continua'
        WHEN o.next_paso IS NOT NULL AND o.next_paso > o.paso THEN 'avanzo'
        WHEN o.next_paso IS NOT NULL AND o.next_paso < o.paso THEN 'retrocedio'
        ELSE 'salio'
      END AS resultado_flujo,
      EXISTS (
        SELECT 1 FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action = 'expediente.rechazo_operativo'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
      ) AS tuvo_rechazo,
      EXISTS (
        SELECT 1 FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action ILIKE '%cancel%'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
      ) AS tuvo_cancel,
      EXTRACT(EPOCH FROM (
        coalesce(o.exited_at, clock_timestamp()) - o.entered_at
      ))::BIGINT AS duration_seconds
    FROM ordered o
    JOIN public.expedientes e ON e.id = o.expediente_id
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND o.paso = ANY (v_pasos)
      AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
           OR e.asesor_id = ANY (p_asesor_ids))
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::text ILIKE '%' || v_q || '%'
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
      AND (
        (v_mov = 'entrada' AND o.entered_at >= v_from AND o.entered_at < v_to_excl)
        OR (v_mov = 'avance' AND o.exited_at IS NOT NULL
            AND o.exited_at >= v_from AND o.exited_at < v_to_excl
            AND o.next_paso IS NOT NULL AND o.next_paso > o.paso)
        OR (v_mov = 'estuvieron'
            AND o.entered_at < v_to_excl
            AND (o.exited_at IS NULL OR o.exited_at >= v_from))
      )
  ),
  classified AS (
    SELECT
      v.*,
      CASE
        WHEN v.tuvo_cancel OR v.ciclo_estado = 'cancelado' THEN 'cancelado'
        WHEN v.tuvo_rechazo OR (v.resultado_flujo = 'continua' AND v.subestado = 'rechazado') THEN 'rechazado'
        WHEN v.resultado_flujo = 'retrocedio' THEN 'retrocedio'
        WHEN v.resultado_flujo = 'avanzo' THEN 'avanzo'
        WHEN v.resultado_flujo = 'continua' THEN 'continua'
        ELSE 'salio'
      END AS resultado
    FROM visits v
  ),
  por_paso AS (
    SELECT
      s.paso,
      count(c.expediente_id)::BIGINT AS visitas,
      count(DISTINCT c.expediente_id)::BIGINT AS unicos,
      count(c.expediente_id) FILTER (
        WHERE c.entered_at >= v_from AND c.entered_at < v_to_excl
      )::BIGINT AS entered_count,
      count(c.expediente_id) FILTER (WHERE c.resultado = 'avanzo')::BIGINT AS advanced_count,
      count(c.expediente_id) FILTER (WHERE c.resultado = 'continua')::BIGINT AS current_count,
      count(c.expediente_id) FILTER (WHERE c.resultado IN ('rechazado', 'cancelado'))::BIGINT AS rejected_count,
      count(c.expediente_id) FILTER (WHERE c.resultado = 'retrocedio')::BIGINT AS returned_count,
      avg(c.duration_seconds)::BIGINT AS avg_duration_seconds,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY c.duration_seconds)::BIGINT AS median_duration_seconds
    FROM generate_series(1, 11) AS s(paso)
    LEFT JOIN classified c ON c.paso = s.paso
    WHERE s.paso = ANY (v_pasos)
    GROUP BY s.paso
  ),
  agg AS (
    SELECT
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'paso_visual', p.paso,
            'paso_nombre', CASE p.paso
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
              ELSE 'Paso ' || p.paso::text
            END,
            'entered_count', p.entered_count,
            'advanced_count', p.advanced_count,
            'current_count', p.current_count,
            'rejected_count', p.rejected_count,
            'returned_count', p.returned_count,
            'visitas', coalesce(p.visitas, 0),
            'expedientes_unicos', coalesce(p.unicos, 0),
            'avg_duration_seconds', p.avg_duration_seconds,
            'median_duration_seconds', p.median_duration_seconds,
            'tasa_avance', CASE WHEN coalesce(p.entered_count, 0) = 0 THEN NULL
              ELSE round((p.advanced_count::NUMERIC * 1000 / NULLIF(p.entered_count, 0)) / 10.0, 1) END,
            'tasa_pendiente', CASE WHEN coalesce(p.entered_count, 0) = 0 THEN NULL
              ELSE round((p.current_count::NUMERIC * 1000 / NULLIF(p.entered_count, 0)) / 10.0, 1) END
          )
          ORDER BY p.paso
        )
        FROM por_paso p
      ), '[]'::jsonb) AS resumen,
      jsonb_build_object(
        'total_expedientes_unicos', coalesce((SELECT count(DISTINCT expediente_id) FROM classified), 0),
        'total_visitas', coalesce((SELECT count(*) FROM classified), 0),
        'entered_count', coalesce((
          SELECT count(*) FROM classified c
          WHERE c.entered_at >= v_from AND c.entered_at < v_to_excl
        ), 0),
        'advanced_count', coalesce((SELECT count(*) FROM classified WHERE resultado = 'avanzo'), 0),
        'current_count', coalesce((SELECT count(*) FROM classified WHERE resultado = 'continua'), 0),
        'rejected_count', coalesce((SELECT count(*) FROM classified WHERE resultado IN ('rechazado', 'cancelado')), 0),
        'returned_count', coalesce((SELECT count(*) FROM classified WHERE resultado = 'retrocedio'), 0),
        'avg_duration_seconds', (SELECT avg(duration_seconds)::BIGINT FROM classified),
        'median_duration_seconds', (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_seconds)::BIGINT FROM classified
        )
      ) AS totales
  )
  SELECT agg.resumen, agg.totales INTO v_resumen, v_totales FROM agg;

  RETURN jsonb_build_object(
    'totales', coalesce(v_totales, '{}'::jsonb),
    'resumen_por_etapa', coalesce(v_resumen, '[]'::jsonb),
    'generated_at', clock_timestamp(),
    'history_coverage_from', v_coverage,
    'movimiento', v_mov,
    'nota', 'Historial exacto desde expediente_paso_visual_transiciones; sin backfill pre-cobertura.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_stage_history_report_summary(UUID[], SMALLINT[], TEXT, DATE, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_stage_history_report_summary(UUID[], SMALLINT[], TEXT, DATE, DATE, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_stage_history_report_summary(UUID[], SMALLINT[], TEXT, DATE, DATE, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_stage_history_report_summary(UUID[], SMALLINT[], TEXT, DATE, DATE, TEXT, TEXT) IS
  'P149 Admin RO: resumen histórico de visitas a pasos visuales. Solo super_admin.';

-- =============================================================================
-- admin_stage_history_report_page
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_stage_history_report_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_asesor_ids UUID[] DEFAULT NULL,
  p_pasos_visuales SMALLINT[] DEFAULT NULL,
  p_movimiento TEXT DEFAULT 'entrada',
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_estado_actual TEXT DEFAULT NULL,
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
  v_pasos SMALLINT[];
  v_mov TEXT;
  v_estado TEXT;
  v_q TEXT;
  v_from TIMESTAMPTZ;
  v_to_excl TIMESTAMPTZ;
  v_page INTEGER;
  v_size INTEGER;
  v_offset INTEGER;
  v_total BIGINT;
  v_items JSONB;
  v_coverage TIMESTAMPTZ;
BEGIN
  v_actor := public.__admin_require_super_admin();

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;

  v_mov := lower(btrim(COALESCE(p_movimiento, 'entrada')));
  IF v_mov NOT IN ('entrada', 'avance', 'estuvieron', 'estado_actual') THEN
    RAISE EXCEPTION 'admin_stage_history: p_movimiento inválido'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado_actual, ''))), '');
  IF v_estado IS NOT NULL AND v_estado NOT IN ('activos', 'rechazados', 'cancelados', 'todos') THEN
    RAISE EXCEPTION 'admin_stage_history: p_estado_actual inválido'
      USING ERRCODE = '22023';
  END IF;
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    v_pasos := ARRAY[1,2,3,4,5,6,7,8,9,10,11]::SMALLINT[];
  ELSE
    v_pasos := (
      SELECT array_agg(DISTINCT p ORDER BY p)
      FROM unnest(p_pasos_visuales) AS p
    );
    IF EXISTS (SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11) THEN
      RAISE EXCEPTION 'admin_stage_history: p_pasos_visuales debe estar entre 1 y 11'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');
  SELECT min(t.fecha_entrada) INTO v_coverage
  FROM public.expediente_paso_visual_transiciones t;

  IF v_mov = 'estado_actual' THEN
    WITH base AS (
      SELECT
        e.id AS expediente_id,
        e.cliente_nombre,
        e.nss,
        e.asesor_id,
        nullif(btrim(pr.full_name), '') AS asesor_nombre,
        e.programa::text AS programa,
        public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso,
        e.etapa_actual,
        e.fecha_entrada_paso_visual_actual AS entered_at,
        NULL::timestamptz AS exited_at,
        'continua'::text AS resultado,
        NULL::smallint AS next_paso,
        NULL::smallint AS next_etapa,
        e.fecha_envio_mesa,
        NULL::uuid AS actor_user_id,
        NULL::text AS actor_nombre,
        NULL::text AS motivo
      FROM public.expedientes e
      LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
        AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
             OR e.asesor_id = ANY (p_asesor_ids))
        AND public.__map_etapa_interna_a_paso_visual(e.etapa_actual) = ANY (v_pasos)
        AND (
          v_estado IS NULL
          OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
        )
        AND (
          v_q IS NULL
          OR e.cliente_nombre ILIKE '%' || v_q || '%'
          OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
          OR e.id::text ILIKE '%' || v_q || '%'
          OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
          OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
          OR e.programa::text ILIKE '%' || v_q || '%'
        )
    )
    SELECT count(*) INTO v_total FROM base;

    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.entered_at DESC NULLS LAST, t.expediente_id DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT * FROM base
      ORDER BY entered_at DESC NULLS LAST, expediente_id DESC
      OFFSET v_offset LIMIT v_size
    ) t;

    RETURN jsonb_build_object(
      'items', coalesce(v_items, '[]'::jsonb),
      'total', coalesce(v_total, 0),
      'page', v_page,
      'page_size', v_size,
      'history_coverage_from', v_coverage,
      'movimiento', v_mov,
      'filters', jsonb_build_object(
        'pasos_visuales', to_jsonb(v_pasos),
        'estado_actual', coalesce(p_estado_actual, 'todos'),
        'buscar', v_q
      )
    );
  END IF;

  SELECT * INTO v_from, v_to_excl
  FROM public.__admin_stage_history_bounds(p_fecha_desde, p_fecha_hasta);

  WITH ordered AS (
    SELECT
      t.id AS visita_id,
      t.expediente_id,
      t.paso_visual_nuevo AS paso,
      t.etapa_nueva,
      t.fecha_entrada AS entered_at,
      t.actor_user_id,
      lead(t.fecha_entrada) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS exited_at,
      lead(t.paso_visual_nuevo) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_paso,
      lead(t.etapa_nueva) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_etapa
    FROM public.expediente_paso_visual_transiciones t
  ),
  visits AS (
    SELECT
      o.visita_id,
      o.expediente_id,
      e.cliente_nombre,
      e.nss,
      e.asesor_id,
      nullif(btrim(pr.full_name), '') AS asesor_nombre,
      e.programa::text AS programa,
      o.paso AS paso_consultado,
      o.etapa_nueva AS etapa_entrada,
      o.entered_at,
      o.exited_at,
      o.next_paso,
      o.next_etapa,
      e.etapa_actual,
      public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso_actual,
      e.fecha_envio_mesa,
      o.actor_user_id,
      nullif(btrim(act.full_name), '') AS actor_nombre,
      EXTRACT(EPOCH FROM (
        coalesce(o.exited_at, clock_timestamp()) - o.entered_at
      ))::BIGINT AS duration_seconds,
      CASE
        WHEN o.exited_at IS NULL THEN 'continua'
        WHEN o.next_paso IS NOT NULL AND o.next_paso > o.paso THEN 'avanzo'
        WHEN o.next_paso IS NOT NULL AND o.next_paso < o.paso THEN 'retrocedio'
        ELSE 'salio'
      END AS resultado_flujo,
      EXISTS (
        SELECT 1 FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action = 'expediente.rechazo_operativo'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
      ) AS tuvo_rechazo,
      (e.ciclo_estado = 'cancelado') AS cancelado
    FROM ordered o
    JOIN public.expedientes e ON e.id = o.expediente_id
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    LEFT JOIN public.profiles act ON act.id = o.actor_user_id
    WHERE e.deleted_at IS NULL
      AND o.paso = ANY (v_pasos)
      AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
           OR e.asesor_id = ANY (p_asesor_ids))
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::text ILIKE '%' || v_q || '%'
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
      AND (
        (v_mov = 'entrada' AND o.entered_at >= v_from AND o.entered_at < v_to_excl)
        OR (v_mov = 'avance' AND o.exited_at IS NOT NULL
            AND o.exited_at >= v_from AND o.exited_at < v_to_excl
            AND o.next_paso IS NOT NULL AND o.next_paso > o.paso)
        OR (v_mov = 'estuvieron'
            AND o.entered_at < v_to_excl
            AND (o.exited_at IS NULL OR o.exited_at >= v_from))
      )
  ),
  classified AS (
    SELECT
      v.*,
      CASE
        WHEN v.cancelado THEN 'cancelado'
        WHEN v.tuvo_rechazo THEN 'rechazado'
        WHEN v.resultado_flujo = 'retrocedio' THEN 'retrocedio'
        WHEN v.resultado_flujo = 'avanzo' THEN 'avanzo'
        WHEN v.resultado_flujo = 'continua' THEN 'continua'
        ELSE 'salio'
      END AS resultado,
      CASE v.paso_consultado
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
        ELSE 'Paso ' || v.paso_consultado::text
      END AS paso_nombre
    FROM visits v
  ),
  counted AS (
    SELECT count(*)::BIGINT AS total FROM classified
  ),
  page_rows AS (
    SELECT
      c.visita_id,
      c.expediente_id,
      c.cliente_nombre,
      CASE
        WHEN length(coalesce(c.nss, '')) >= 5 THEN
          repeat('*', greatest(length(c.nss) - 4, 0)) || right(c.nss, 4)
        ELSE coalesce(c.nss, '')
      END AS nss,
      c.asesor_id,
      c.asesor_nombre,
      c.programa,
      c.paso_consultado AS paso_visual,
      c.paso_nombre,
      c.etapa_entrada,
      c.entered_at,
      c.exited_at,
      c.duration_seconds,
      c.resultado,
      c.next_paso AS etapa_siguiente_paso,
      c.next_etapa AS etapa_siguiente,
      c.etapa_actual,
      c.paso_actual,
      c.fecha_envio_mesa,
      c.actor_user_id,
      c.actor_nombre,
      NULL::text AS motivo
    FROM classified c
    ORDER BY c.entered_at DESC, c.visita_id DESC
    OFFSET v_offset LIMIT v_size
  )
  SELECT
    (SELECT total FROM counted),
    coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entered_at DESC, x.visita_id DESC), '[]'::jsonb)
  INTO v_total, v_items
  FROM page_rows x;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_size,
    'history_coverage_from', v_coverage,
    'movimiento', v_mov,
    'filters', jsonb_build_object(
      'fecha_desde', p_fecha_desde,
      'fecha_hasta', p_fecha_hasta,
      'pasos_visuales', to_jsonb(v_pasos),
      'estado_actual', coalesce(p_estado_actual, 'todos'),
      'buscar', v_q
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_stage_history_report_page(INTEGER, INTEGER, UUID[], SMALLINT[], TEXT, DATE, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_stage_history_report_page(INTEGER, INTEGER, UUID[], SMALLINT[], TEXT, DATE, DATE, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_stage_history_report_page(INTEGER, INTEGER, UUID[], SMALLINT[], TEXT, DATE, DATE, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_stage_history_report_page(INTEGER, INTEGER, UUID[], SMALLINT[], TEXT, DATE, DATE, TEXT, TEXT) IS
  'P149 Admin RO: listado paginado de visitas históricas a pasos visuales. Solo super_admin.';
