-- ConCasa CRM — P154: desglose por asesor + detalle interactivo + NSS completo SA
-- Extiende RPCs P153 (CREATE OR REPLACE). Fuente: expediente_paso_visual_transiciones.
-- No altera P149. NSS completo solo vía __admin_require_super_admin (sin máscara).

-- =============================================================================
-- admin_stage_cohort_outcome_summary
-- Cohorte = visitas con fecha_entrada en [desde, hasta] (America/Monterrey).
-- Clasificación al cierre del periodo (mutuamente excluyente):
--   advanced      = exited_at < to_excl AND next_paso > paso
--   stayed        = exited_at IS NULL OR exited_at >= to_excl
--   incident      = salió en periodo sin avance normal
--   undetermined  = residual (no clasificable con seguridad)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_stage_cohort_outcome_summary(
  p_asesor_ids UUID[] DEFAULT NULL,
  p_pasos_visuales SMALLINT[] DEFAULT NULL,
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
  v_estado TEXT;
  v_q TEXT;
  v_from TIMESTAMPTZ;
  v_to_excl TIMESTAMPTZ;
  v_coverage TIMESTAMPTZ;
  v_etapas JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_pasos_visuales es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_pasos := (
    SELECT array_agg(DISTINCT p ORDER BY p)
    FROM unnest(p_pasos_visuales) AS p
  );
  IF EXISTS (SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11) THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_pasos_visuales debe estar entre 1 y 11'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado_actual, ''))), '');
  IF v_estado IS NOT NULL AND v_estado NOT IN ('activos', 'rechazados', 'cancelados', 'todos') THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_estado_actual inválido'
      USING ERRCODE = '22023';
  END IF;
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  SELECT * INTO v_from, v_to_excl
  FROM public.__admin_stage_history_bounds(p_fecha_desde, p_fecha_hasta);

  v_coverage := (DATE '2026-07-23'::timestamp AT TIME ZONE 'America/Monterrey');

  WITH ordered AS (
    SELECT
      t.id AS visita_id,
      t.expediente_id,
      t.paso_visual_nuevo AS paso,
      t.etapa_nueva,
      t.fecha_entrada AS entered_at,
      lead(t.fecha_entrada) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS exited_at,
      lead(t.paso_visual_nuevo) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_paso
    FROM public.expediente_paso_visual_transiciones t
  ),
  cohort AS (
    SELECT
      o.*,
      e.asesor_id,
      e.ciclo_estado,
      e.subestado,
      public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso_actual,
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
      EXTRACT(EPOCH FROM (o.exited_at - o.entered_at))::BIGINT AS advance_duration_seconds
    FROM ordered o
    JOIN public.expedientes e ON e.id = o.expediente_id
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND o.paso = ANY (v_pasos)
      AND o.entered_at >= v_from
      AND o.entered_at < v_to_excl
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
  ),
  classified AS (
    SELECT
      c.*,
      CASE
        WHEN c.exited_at IS NOT NULL
             AND c.exited_at < v_to_excl
             AND c.next_paso IS NOT NULL
             AND c.next_paso > c.paso
          THEN 'advanced'
        WHEN c.exited_at IS NULL OR c.exited_at >= v_to_excl
          THEN 'stayed'
        WHEN c.exited_at IS NOT NULL AND c.exited_at < v_to_excl
          THEN 'incident'
        ELSE 'undetermined'
      END AS period_outcome
    FROM cohort c
  ),
  por_paso AS (
    SELECT
      s.paso,
      count(c.visita_id)::BIGINT AS entered_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'advanced')::BIGINT AS advanced_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'stayed')::BIGINT AS stayed_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'incident')::BIGINT AS incident_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'undetermined')::BIGINT AS undetermined_count,
      avg(c.advance_duration_seconds) FILTER (
        WHERE c.period_outcome = 'advanced' AND c.advance_duration_seconds IS NOT NULL
      )::BIGINT AS avg_advance_duration_seconds,
      (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY a.advance_duration_seconds)::BIGINT
        FROM classified a
        WHERE a.paso = s.paso
          AND a.period_outcome = 'advanced'
          AND a.advance_duration_seconds IS NOT NULL
      ) AS median_advance_duration_seconds
    FROM unnest(v_pasos) AS s(paso)
    LEFT JOIN classified c ON c.paso = s.paso
    GROUP BY s.paso
  ),
  por_asesor AS (
    SELECT
      c.paso,
      c.asesor_id,
      coalesce(max(pr.full_name), max(pr.email), 'Asesor sin nombre') AS asesor_nombre,
      max(pr.email) AS asesor_email,
      count(c.visita_id)::BIGINT AS entered_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'advanced')::BIGINT AS advanced_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'stayed')::BIGINT AS stayed_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'incident')::BIGINT AS incident_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'undetermined')::BIGINT AS undetermined_count
    FROM classified c
    LEFT JOIN public.profiles pr ON pr.id = c.asesor_id
    GROUP BY c.paso, c.asesor_id
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'paso_visual', p.paso,
      'etapa_label', CASE p.paso
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
      'entered_count', coalesce(p.entered_count, 0),
      'advanced_count', coalesce(p.advanced_count, 0),
      'stayed_count', coalesce(p.stayed_count, 0),
      'incident_count', coalesce(p.incident_count, 0),
      'undetermined_count', coalesce(p.undetermined_count, 0),
      'advance_rate', CASE WHEN coalesce(p.entered_count, 0) = 0 THEN NULL
        ELSE round((p.advanced_count::NUMERIC * 1000 / NULLIF(p.entered_count, 0)) / 10.0, 1) END,
      'stayed_rate', CASE WHEN coalesce(p.entered_count, 0) = 0 THEN NULL
        ELSE round((p.stayed_count::NUMERIC * 1000 / NULLIF(p.entered_count, 0)) / 10.0, 1) END,
      'avg_advance_duration_seconds', p.avg_advance_duration_seconds,
      'median_advance_duration_seconds', p.median_advance_duration_seconds,
      'por_asesor', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'asesor_id', pa.asesor_id,
            'asesor_nombre', pa.asesor_nombre,
            'asesor_email', pa.asesor_email,
            'entered_count', pa.entered_count,
            'advanced_count', pa.advanced_count,
            'stayed_count', pa.stayed_count,
            'incident_count', pa.incident_count,
            'undetermined_count', pa.undetermined_count
          )
          ORDER BY pa.asesor_nombre NULLS LAST, pa.asesor_id
        )
        FROM por_asesor pa
        WHERE pa.paso = p.paso
      ), '[]'::jsonb)
    )
    ORDER BY p.paso
  ), '[]'::jsonb)
  INTO v_etapas
  FROM por_paso p;

  RETURN jsonb_build_object(
    'etapas', coalesce(v_etapas, '[]'::jsonb),
    'generated_at', clock_timestamp(),
    'history_coverage_from', v_coverage,
    'fecha_desde', p_fecha_desde,
    'fecha_hasta', p_fecha_hasta,
    'nota', 'Resultados sobre quienes entraron a la etapa durante el periodo seleccionado.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_stage_cohort_outcome_summary(UUID[], SMALLINT[], DATE, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_stage_cohort_outcome_summary(UUID[], SMALLINT[], DATE, DATE, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_stage_cohort_outcome_summary(UUID[], SMALLINT[], DATE, DATE, TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.admin_stage_cohort_outcome_summary(UUID[], SMALLINT[], DATE, DATE, TEXT, TEXT) IS
  'P154/P153 Admin RO: resumen cohorte + por_asesor. Solo super_admin. NSS no aplica en summary.';

-- =============================================================================
-- admin_stage_cohort_outcome_page
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_stage_cohort_outcome_page(
  p_asesor_ids UUID[] DEFAULT NULL,
  p_pasos_visuales SMALLINT[] DEFAULT NULL,
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_estado_actual TEXT DEFAULT NULL,
  p_buscar TEXT DEFAULT NULL,
  p_resultado TEXT DEFAULT 'advanced',
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_pasos SMALLINT[];
  v_estado TEXT;
  v_q TEXT;
  v_from TIMESTAMPTZ;
  v_to_excl TIMESTAMPTZ;
  v_coverage TIMESTAMPTZ;
  v_resultado TEXT;
  v_limit INT;
  v_offset INT;
  v_total BIGINT;
  v_items JSONB;
  v_org UUID;
BEGIN
  v_actor := public.__admin_require_super_admin();

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_pasos_visuales es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_pasos := (
    SELECT array_agg(DISTINCT p ORDER BY p)
    FROM unnest(p_pasos_visuales) AS p
  );
  IF EXISTS (SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11) THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_pasos_visuales debe estar entre 1 y 11'
      USING ERRCODE = '22023';
  END IF;

  v_resultado := lower(btrim(COALESCE(p_resultado, 'advanced')));
  IF v_resultado NOT IN ('entered', 'advanced', 'stayed', 'incident', 'undetermined') THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_resultado inválido (entered|advanced|stayed|incident|undetermined)'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado_actual, ''))), '');
  IF v_estado IS NOT NULL AND v_estado NOT IN ('activos', 'rechazados', 'cancelados', 'todos') THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_estado_actual inválido'
      USING ERRCODE = '22023';
  END IF;
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  SELECT * INTO v_from, v_to_excl
  FROM public.__admin_stage_history_bounds(p_fecha_desde, p_fecha_hasta);

  v_coverage := (DATE '2026-07-23'::timestamp AT TIME ZONE 'America/Monterrey');

  WITH ordered AS (
    SELECT
      t.id AS visita_id,
      t.expediente_id,
      t.paso_visual_nuevo AS paso,
      t.etapa_nueva AS etapa_entrada,
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
  cohort AS (
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
      coalesce(pr.full_name, pr.email) AS asesor_nombre,
      pr.email AS asesor_email,
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
      (
        SELECT nullif(btrim(coalesce(al.payload->>'motivo', al.payload->>'motivo_rechazo', '')), '')
        FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action = 'expediente.rechazo_operativo'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
        ORDER BY al.created_at DESC
        LIMIT 1
      ) AS motivo_rechazo,
      EXTRACT(EPOCH FROM (
        CASE
          WHEN o.exited_at IS NOT NULL AND o.exited_at < v_to_excl THEN o.exited_at - o.entered_at
          ELSE v_to_excl - o.entered_at
        END
      ))::BIGINT AS duration_seconds_period
    FROM ordered o
    JOIN public.expedientes e ON e.id = o.expediente_id
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND o.paso = ANY (v_pasos)
      AND o.entered_at >= v_from
      AND o.entered_at < v_to_excl
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
  ),
  classified AS (
    SELECT
      c.*,
      CASE
        WHEN c.exited_at IS NOT NULL
             AND c.exited_at < v_to_excl
             AND c.next_paso IS NOT NULL
             AND c.next_paso > c.paso
          THEN 'advanced'
        WHEN c.exited_at IS NULL OR c.exited_at >= v_to_excl
          THEN 'stayed'
        WHEN c.exited_at IS NOT NULL AND c.exited_at < v_to_excl
          THEN 'incident'
        ELSE 'undetermined'
      END AS period_outcome,
      CASE
        WHEN c.tuvo_cancel OR c.ciclo_estado = 'cancelado' THEN 'cancelado'
        WHEN c.tuvo_rechazo THEN 'rechazado'
        WHEN c.next_paso IS NOT NULL AND c.next_paso < c.paso THEN 'retrocedio'
        WHEN c.next_paso IS NOT NULL AND c.next_paso > c.paso THEN 'avanzo'
        WHEN c.exited_at IS NULL THEN 'continua'
        ELSE 'salio'
      END AS resultado_label,
      CASE
        WHEN c.ciclo_estado = 'cancelado' THEN 'cerrado_inactivo'
        WHEN c.exited_at IS NULL AND c.paso_actual = c.paso THEN 'sigue_en_etapa'
        WHEN c.exited_at IS NULL AND c.paso_actual IS DISTINCT FROM c.paso THEN 'cerrado_inactivo'
        WHEN c.exited_at IS NOT NULL AND c.exited_at >= v_to_excl AND c.next_paso IS NOT NULL AND c.next_paso > c.paso
          THEN 'avanzo_despues'
        WHEN c.exited_at IS NOT NULL AND c.exited_at >= v_to_excl AND c.next_paso IS NOT NULL AND c.next_paso < c.paso
          THEN 'retrocedio_despues'
        WHEN c.exited_at IS NOT NULL AND c.exited_at >= v_to_excl THEN 'salio_despues'
        WHEN c.exited_at IS NOT NULL AND c.exited_at < v_to_excl AND c.next_paso IS NOT NULL AND c.next_paso > c.paso
          THEN 'avanzo_en_periodo'
        WHEN c.exited_at IS NOT NULL AND c.exited_at < v_to_excl THEN 'incidencia_en_periodo'
        ELSE 'no_determinado'
      END AS situacion_actual,
      CASE c.paso
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
        ELSE 'Paso ' || c.paso::text
      END AS etapa_label,
      CASE c.next_paso
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
        ELSE CASE WHEN c.next_paso IS NULL THEN NULL ELSE 'Paso ' || c.next_paso::text END
      END AS etapa_siguiente_label
    FROM cohort c
  ),
  filtered AS (
    SELECT * FROM classified x
    WHERE v_resultado = 'entered' OR x.period_outcome = v_resultado
  ),
  counted AS (
    SELECT count(*)::BIGINT AS total FROM filtered
  ),
  page_rows AS (
    SELECT
      f.visita_id,
      f.expediente_id,
      f.cliente_nombre,
      coalesce(f.nss, '') AS nss,
      f.asesor_id,
      f.asesor_nombre,
      f.asesor_email,
      f.programa,
      f.paso AS paso_visual,
      f.etapa_label,
      f.etapa_entrada,
      f.entered_at,
      f.exited_at,
      f.duration_seconds_period AS duration_seconds,
      f.period_outcome,
      f.resultado_label,
      f.next_paso AS etapa_siguiente_paso,
      f.next_etapa AS etapa_siguiente,
      f.etapa_siguiente_label,
      f.etapa_actual,
      f.paso_actual,
      f.situacion_actual,
      f.motivo_rechazo AS motivo,
      f.fecha_envio_mesa
    FROM filtered f
    ORDER BY f.entered_at DESC, f.visita_id DESC
    OFFSET v_offset LIMIT v_limit
  )
  SELECT
    (SELECT total FROM counted),
    coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entered_at DESC, x.visita_id DESC), '[]'::jsonb)
  INTO v_total, v_items
  FROM page_rows x;

  -- Auditoría: acceso a detalle con NSS completo (solo Super Admin llega aquí)
  SELECT organization_id INTO v_org FROM public.profiles WHERE id = v_actor;
  IF v_org IS NOT NULL THEN
    PERFORM public.log_action(
      v_org,
      v_actor,
      'super_admin'::public.app_role,
      'admin.stage_cohort_outcome_detail',
      'admin_report',
      v_actor,
      jsonb_build_object(
        'nss_completo', true,
        'resultado', v_resultado,
        'pasos_visuales', to_jsonb(v_pasos),
        'asesor_ids', to_jsonb(p_asesor_ids),
        'fecha_desde', p_fecha_desde,
        'fecha_hasta', p_fecha_hasta,
        'total', coalesce(v_total, 0),
        'limit', v_limit,
        'offset', v_offset
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total', coalesce(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'resultado', v_resultado,
    'nss_completo', true,
    'history_coverage_from', v_coverage,
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

REVOKE ALL ON FUNCTION public.admin_stage_cohort_outcome_page(UUID[], SMALLINT[], DATE, DATE, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_stage_cohort_outcome_page(UUID[], SMALLINT[], DATE, DATE, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_stage_cohort_outcome_page(UUID[], SMALLINT[], DATE, DATE, TEXT, TEXT, TEXT, INTEGER, INTEGER)
  TO authenticated;

COMMENT ON FUNCTION public.admin_stage_cohort_outcome_page(UUID[], SMALLINT[], DATE, DATE, TEXT, TEXT, TEXT, INTEGER, INTEGER) IS
  'P154 Admin RO: detalle cohorte (entered|advanced|stayed|incident|undetermined) con NSS completo. Solo super_admin; audita en action_log.';
