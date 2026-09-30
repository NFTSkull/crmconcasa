-- ConCasa CRM — Admin: ajuste de montos del panel de precalificaciones (Mejoravit).
-- Solo lectura. No modifica expedientes, decisiones ni historial.
--
-- Semántica:
-- * Una precalificación = evento canónico del historial P155/P169. Si un expediente
--   nunca generó historial, su editor_decision actual representa su precalificación inicial.
-- * El periodo se asigna al momento de captura/inicio de la precalificación.
-- * "A Mesa / en trámite" = el expediente asociado ya tiene submitted_to_mesa=true.
-- * Para Mejoravit, monto operativo y promedio se topan en $169,000 para evitar
--   que valores históricos por encima del tope distorsionen el rendimiento.
-- * El monto original NO se altera; solo se normaliza dentro de este read-model.

BEGIN;

CREATE INDEX IF NOT EXISTS expediente_precal_intentos_org_created_perf_idx
  ON public.expediente_precalificacion_intentos (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_precal_performance(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_asesor_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_segmento TEXT DEFAULT 'todos',
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_page INTEGER;
  v_page_size INTEGER;
  v_offset INTEGER;
  v_search TEXT;
  v_segmento TEXT;
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
  v_segmento := lower(btrim(coalesce(p_segmento, 'todos')));

  IF v_segmento NOT IN (
    'todos', 'aprobadas', 'no_cumple', 'pendientes',
    'repetidos', 'topados', 'mesa'
  ) THEN
    RAISE EXCEPTION 'admin_precal_performance: segmento inválido'
      USING ERRCODE = '22023';
  END IF;

  WITH
  history_expedientes AS MATERIALIZED (
    SELECT DISTINCT i.expediente_id
    FROM public.expediente_precalificacion_intentos i
    WHERE i.organization_id = v_org
  ),
  all_events AS MATERIALIZED (
    SELECT
      i.id::TEXT AS event_id,
      i.expediente_id,
      i.asesor_id,
      trim(i.nss::TEXT) AS nss,
      i.cliente_nombre,
      coalesce(i.programa_solicitado, i.programa)::TEXT AS programa,
      i.decision::TEXT AS decision,
      i.monto_aprobado::NUMERIC AS monto_original,
      CASE
        WHEN i.decision_previa IS NULL AND i.intento_previo_id IS NULL
          THEN coalesce(i.decided_at, i.created_at)
        ELSE i.created_at
      END AS event_at,
      CASE
        WHEN i.decision_previa IS NULL AND i.intento_previo_id IS NULL
          THEN 'inicial'
        ELSE 'reprecalificacion'
      END AS tipo_evento
    FROM public.expediente_precalificacion_intentos i
    WHERE i.organization_id = v_org

    UNION ALL

    SELECT
      e.id::TEXT AS event_id,
      e.id AS expediente_id,
      e.asesor_id,
      trim(e.nss::TEXT) AS nss,
      e.cliente_nombre,
      e.programa::TEXT AS programa,
      ed.decision::TEXT AS decision,
      coalesce(ed.monto_aprobado_al_aprobar, ed.monto_aprobado)::NUMERIC AS monto_original,
      e.created_at AS event_at,
      'inicial'::TEXT AS tipo_evento
    FROM public.expedientes e
    JOIN public.editor_decisions ed
      ON ed.expediente_id = e.id
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM history_expedientes h
        WHERE h.expediente_id = e.id
      )
  ),
  historic_nss AS MATERIALIZED (
    SELECT ev.nss, count(*)::INTEGER AS total_historico
    FROM all_events ev
    WHERE nullif(ev.nss, '') IS NOT NULL
    GROUP BY ev.nss
  ),
  base AS MATERIALIZED (
    SELECT
      ev.*,
      p.full_name AS asesor_nombre,
      p.email AS asesor_email,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.ciclo_estado::TEXT AS ciclo_estado,
      e.subestado,
      coalesce(hn.total_historico, 1) AS nss_precalificaciones_historicas,
      CASE
        WHEN ev.decision = 'aprobado' AND ev.monto_original > 0
          THEN CASE
            WHEN lower(ev.programa) = 'mejoravit'
              THEN least(ev.monto_original, 169000::NUMERIC)
            ELSE ev.monto_original
          END
        ELSE NULL
      END AS monto_operativo,
      (
        ev.decision = 'aprobado'
        AND lower(ev.programa) = 'mejoravit'
        AND coalesce(ev.monto_original, 0) >= 169000
      ) AS topado_169k
    FROM all_events ev
    JOIN public.expedientes e
      ON e.id = ev.expediente_id
     AND e.organization_id = v_org
     AND e.deleted_at IS NULL
    LEFT JOIN public.profiles p ON p.id = ev.asesor_id
    LEFT JOIN historic_nss hn ON hn.nss = ev.nss
    WHERE ev.event_at >= p_from
      AND ev.event_at < p_to_exclusive
      AND (p_asesor_id IS NULL OR ev.asesor_id = p_asesor_id)
      AND (
        v_search IS NULL
        OR lower(coalesce(ev.cliente_nombre, '')) LIKE '%' || v_search || '%'
        OR lower(coalesce(ev.nss, '')) LIKE '%' || v_search || '%'
        OR lower(coalesce(p.full_name, '')) LIKE '%' || v_search || '%'
        OR lower(coalesce(p.email, '')) LIKE '%' || v_search || '%'
      )
  ),
  period_nss AS MATERIALIZED (
    SELECT nss, count(*)::INTEGER AS cnt
    FROM base
    WHERE nullif(nss, '') IS NOT NULL
    GROUP BY nss
  ),
  summary AS (
    SELECT jsonb_build_object(
      'total_precalificaciones', count(*)::BIGINT,
      'nss_unicos', count(DISTINCT b.nss)::BIGINT,
      'repeticiones_extra',
        greatest(count(*) - count(DISTINCT b.nss), 0)::BIGINT,
      'nss_repetidos_periodo',
        coalesce((SELECT count(*) FROM period_nss pn WHERE pn.cnt > 1), 0)::BIGINT,
      'nss_con_historial_repetido',
        count(DISTINCT b.nss) FILTER (WHERE b.nss_precalificaciones_historicas > 1)::BIGINT,
      'aprobadas', count(*) FILTER (WHERE b.decision = 'aprobado')::BIGINT,
      'no_cumple', count(*) FILTER (WHERE b.decision = 'no_cumple')::BIGINT,
      'pendientes', count(*) FILTER (WHERE b.decision = 'pendiente')::BIGINT,
      'tasa_aprobacion',
        round(
          100.0 * count(*) FILTER (WHERE b.decision = 'aprobado')
          / nullif(
              count(*) FILTER (WHERE b.decision IN ('aprobado','no_cumple')),
              0
            ),
          1
        ),
      'monto_promedio_aprobado',
        round(
          avg(b.monto_operativo) FILTER (
            WHERE b.decision = 'aprobado' AND lower(b.programa) = 'mejoravit'
          ),
          2
        ),
      'monto_total_aprobado',
        round(
          coalesce(
            sum(b.monto_operativo) FILTER (
              WHERE b.decision = 'aprobado' AND lower(b.programa) = 'mejoravit'
            ),
            0
          ),
          2
        ),
      'topados_169k', count(*) FILTER (WHERE b.topado_169k)::BIGINT,
      'topados_169k_a_mesa',
        count(*) FILTER (WHERE b.topado_169k AND b.submitted_to_mesa)::BIGINT,
      'conversion_topados_mesa',
        round(
          100.0 * count(*) FILTER (WHERE b.topado_169k AND b.submitted_to_mesa)
          / nullif(count(*) FILTER (WHERE b.topado_169k), 0),
          1
        ),
      'expedientes_unicos', count(DISTINCT b.expediente_id)::BIGINT,
      'expedientes_a_mesa',
        count(DISTINCT b.expediente_id) FILTER (WHERE b.submitted_to_mesa)::BIGINT,
      'conversion_mesa',
        round(
          100.0 * count(DISTINCT b.expediente_id) FILTER (WHERE b.submitted_to_mesa)
          / nullif(count(DISTINCT b.expediente_id), 0),
          1
        )
    ) AS payload
    FROM base b
  ),
  advisors AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'asesor_id', x.asesor_id,
          'asesor_nombre', x.asesor_nombre,
          'asesor_email', x.asesor_email,
          'precalificaciones', x.precalificaciones,
          'nss_unicos', x.nss_unicos,
          'repeticiones_extra', x.repeticiones_extra,
          'aprobadas', x.aprobadas,
          'no_cumple', x.no_cumple,
          'pendientes', x.pendientes,
          'tasa_aprobacion', x.tasa_aprobacion,
          'monto_promedio_aprobado', x.monto_promedio_aprobado,
          'monto_total_aprobado', x.monto_total_aprobado,
          'topados_169k', x.topados_169k,
          'topados_169k_a_mesa', x.topados_169k_a_mesa,
          'expedientes_unicos', x.expedientes_unicos,
          'expedientes_a_mesa', x.expedientes_a_mesa,
          'conversion_mesa', x.conversion_mesa
        )
        ORDER BY x.precalificaciones DESC, x.monto_total_aprobado DESC, x.asesor_nombre
      ),
      '[]'::JSONB
    ) AS payload
    FROM (
      SELECT
        b.asesor_id,
        nullif(btrim(max(b.asesor_nombre)), '') AS asesor_nombre,
        nullif(btrim(max(b.asesor_email)), '') AS asesor_email,
        count(*)::BIGINT AS precalificaciones,
        count(DISTINCT b.nss)::BIGINT AS nss_unicos,
        greatest(count(*) - count(DISTINCT b.nss), 0)::BIGINT AS repeticiones_extra,
        count(*) FILTER (WHERE b.decision = 'aprobado')::BIGINT AS aprobadas,
        count(*) FILTER (WHERE b.decision = 'no_cumple')::BIGINT AS no_cumple,
        count(*) FILTER (WHERE b.decision = 'pendiente')::BIGINT AS pendientes,
        round(
          100.0 * count(*) FILTER (WHERE b.decision = 'aprobado')
          / nullif(
              count(*) FILTER (WHERE b.decision IN ('aprobado','no_cumple')),
              0
            ),
          1
        ) AS tasa_aprobacion,
        round(
          avg(b.monto_operativo) FILTER (
            WHERE b.decision = 'aprobado' AND lower(b.programa) = 'mejoravit'
          ),
          2
        ) AS monto_promedio_aprobado,
        round(
          coalesce(
            sum(b.monto_operativo) FILTER (
              WHERE b.decision = 'aprobado' AND lower(b.programa) = 'mejoravit'
            ),
            0
          ),
          2
        ) AS monto_total_aprobado,
        count(*) FILTER (WHERE b.topado_169k)::BIGINT AS topados_169k,
        count(*) FILTER (WHERE b.topado_169k AND b.submitted_to_mesa)::BIGINT
          AS topados_169k_a_mesa,
        count(DISTINCT b.expediente_id)::BIGINT AS expedientes_unicos,
        count(DISTINCT b.expediente_id) FILTER (WHERE b.submitted_to_mesa)::BIGINT
          AS expedientes_a_mesa,
        round(
          100.0 * count(DISTINCT b.expediente_id) FILTER (WHERE b.submitted_to_mesa)
          / nullif(count(DISTINCT b.expediente_id), 0),
          1
        ) AS conversion_mesa
      FROM base b
      GROUP BY b.asesor_id
    ) x
  ),
  item_source AS MATERIALIZED (
    SELECT b.*
    FROM base b
    WHERE
      v_segmento = 'todos'
      OR (v_segmento = 'aprobadas' AND b.decision = 'aprobado')
      OR (v_segmento = 'no_cumple' AND b.decision = 'no_cumple')
      OR (v_segmento = 'pendientes' AND b.decision = 'pendiente')
      OR (v_segmento = 'repetidos' AND b.nss_precalificaciones_historicas > 1)
      OR (v_segmento = 'topados' AND b.topado_169k)
      OR (v_segmento = 'mesa' AND b.submitted_to_mesa)
  ),
  items AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', x.event_id,
          'expediente_id', x.expediente_id,
          'event_at', x.event_at,
          'tipo_evento', x.tipo_evento,
          'nss', x.nss,
          'nss_precalificaciones_historicas', x.nss_precalificaciones_historicas,
          'cliente_nombre', x.cliente_nombre,
          'asesor_id', x.asesor_id,
          'asesor_nombre', x.asesor_nombre,
          'asesor_email', x.asesor_email,
          'programa', x.programa,
          'decision', x.decision,
          'monto_original', x.monto_original,
          'monto_operativo', x.monto_operativo,
          'topado_169k', x.topado_169k,
          'submitted_to_mesa', x.submitted_to_mesa,
          'fecha_envio_mesa', x.fecha_envio_mesa,
          'etapa_actual', x.etapa_actual,
          'ciclo_estado', x.ciclo_estado,
          'subestado', x.subestado
        )
        ORDER BY x.event_at DESC, x.event_id DESC
      ),
      '[]'::JSONB
    ) AS payload
    FROM (
      SELECT *
      FROM item_source
      ORDER BY event_at DESC, event_id DESC
      LIMIT v_page_size
      OFFSET v_offset
    ) x
  )
  SELECT jsonb_build_object(
    'summary', coalesce((SELECT payload FROM summary), '{}'::JSONB),
    'asesores', coalesce((SELECT payload FROM advisors), '[]'::JSONB),
    'items', coalesce((SELECT payload FROM items), '[]'::JSONB),
    'total_count', (SELECT count(*)::BIGINT FROM item_source),
    'page', v_page,
    'page_size', v_page_size,
    'segmento', v_segmento,
    'amount_cap_mejoravit', 169000
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_precal_performance(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_precal_performance(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, INTEGER, INTEGER
) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_precal_performance(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, INTEGER, INTEGER
) IS
  'Super Admin RO: rendimiento integral de precalificaciones por periodo/asesor, repetición NSS, promedio/total Mejoravit con tope operativo 169k y conversión a Mesa.';

COMMIT;
