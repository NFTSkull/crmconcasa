-- ConCasa CRM — P183: inbox asesor ordena por actividad de re-precal REAL
-- READ MODEL ONLY. No muta iniciar/resolver. Filtro de fechas sigue en created_at.
-- Discriminador REAL: decision_previa IS NOT NULL OR idempotency_key
--   (Cloud: 8 reales vs 5 snapshots históricos de 1ª aprobación sin decision_previa).

CREATE OR REPLACE FUNCTION public.asesor_list_expedientes_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_buscar TEXT DEFAULT NULL,
  p_decision TEXT DEFAULT NULL,
  p_estatus_operativo TEXT DEFAULT NULL,
  p_resultado_real TEXT DEFAULT NULL,
  p_programa TEXT DEFAULT NULL,
  p_etapa_exacta INTEGER DEFAULT NULL,
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_quick_filter TEXT DEFAULT 'todos'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_active BOOLEAN;
  v_page INTEGER;
  v_size INTEGER;
  v_from INTEGER;
  v_quick TEXT;
  v_total BIGINT;
  v_items JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_list_expedientes_page: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active
  INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_list_expedientes_page: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_from := (v_page - 1) * v_size;
  v_quick := lower(trim(coalesce(nullif(p_quick_filter, ''), 'todos')));

  WITH base AS (
    SELECT
      e.id,
      e.programa,
      public.asesor_inbox_programa_ui(e.programa) AS programa_ui,
      e.nss::text AS nss,
      e.cliente_nombre,
      e.telefono_cliente::text AS telefono_cliente,
      e.direccion_opcional,
      e.asesor_id,
      e.origen_mesa::text AS origen_mesa,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.motivo_rechazo,
      e.comentario_rechazo,
      e.fecha_cita,
      e.firma_agendable_desde,
      e.pago_concasa_resultado,
      e.pago_concasa_at,
      e.created_at,
      e.updated_at,
      e.expediente_anterior_id,
      e.reingreso_rechazo_id,
      e.reingreso_manual_count,
      e.reingreso_manual_at,
      e.reingreso_manual_by,
      e.reprecalificacion_pendiente_id,
      coalesce(ed.decision::text, 'pendiente') AS decision,
      ed.monto_aprobado,
      coalesce(ed.notas_revision, '') AS notas_revision,
      ed.aprobado_at,
      ed.monto_aprobado_al_aprobar,
      ed.no_cumple_at,
      public.asesor_inbox_resultado_real(
        e.submitted_to_mesa,
        e.subestado::text,
        e.ciclo_estado::text,
        ed.decision::text
      ) AS resultado_real,
      public.asesor_inbox_categoria_correccion(e.id) AS categoria_correccion,
      public.asesor_inbox_pendiente_agendar_biometricos(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_biometricos,
      public.asesor_inbox_pendiente_agendar_firma(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_firma,
      public.asesor_inbox_pendiente_subir_acuse(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_subir_acuse,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN 'pending'
        WHEN last_real.decision = 'aprobado' THEN 'approved'
        WHEN last_real.decision = 'no_cumple' THEN 'no_cumple'
        ELSE NULL
      END AS reprecal_estado,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
        ELSE NULL
      END AS reprecal_solicitada_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
        ELSE last_real.decided_at
      END AS reprecal_resuelta_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
        ELSE last_real.decided_at
      END AS reprecal_activity_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.monto_aprobado_previo
        ELSE last_real.monto_aprobado_previo
      END AS reprecal_monto_previo,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
        WHEN last_real.decision = 'aprobado' THEN last_real.monto_aprobado
        ELSE NULL
      END AS reprecal_monto_resultado,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.programa_solicitado::text
        ELSE last_real.programa_solicitado::text
      END AS reprecal_programa_solicitado,
      coalesce(
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
          ELSE last_real.decided_at
        END,
        e.created_at
      ) AS inbox_sort_at
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    LEFT JOIN public.expediente_precalificacion_intentos pend
      ON pend.id = e.reprecalificacion_pendiente_id
    LEFT JOIN LATERAL (
      SELECT
        i.decision,
        i.created_at,
        i.decided_at,
        i.monto_aprobado,
        i.monto_aprobado_previo,
        i.programa_solicitado
      FROM public.expediente_precalificacion_intentos i
      WHERE e.reprecalificacion_pendiente_id IS NULL
        AND i.expediente_id = e.id
        AND i.decision IN (
          'aprobado'::public.editor_decision,
          'no_cumple'::public.editor_decision
        )
        AND (
          i.decision_previa IS NOT NULL
          OR nullif(btrim(coalesce(i.idempotency_key, '')), '') IS NOT NULL
        )
      ORDER BY i.decided_at DESC NULLS LAST, i.created_at DESC, i.id DESC
      LIMIT 1
    ) last_real ON TRUE
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_actor
  ),
  filtered AS (
    SELECT b.*
    FROM base b
    WHERE public.asesor_inbox_matches_buscar(
        b.cliente_nombre, b.nss, b.telefono_cliente, b.programa_ui, p_buscar
      )
      AND (
        p_decision IS NULL OR trim(p_decision) = ''
        OR b.decision = trim(p_decision)
      )
      AND (
        p_estatus_operativo IS NULL OR trim(p_estatus_operativo) = ''
        OR coalesce(b.subestado, 'pendiente') = trim(p_estatus_operativo)
      )
      AND (
        p_resultado_real IS NULL OR trim(p_resultado_real) = ''
        OR b.resultado_real = trim(p_resultado_real)
      )
      AND (
        p_programa IS NULL OR trim(p_programa) = ''
        OR b.programa_ui = trim(p_programa)
      )
      AND (
        p_etapa_exacta IS NULL
        OR b.etapa_actual = p_etapa_exacta::smallint
      )
      AND (
        p_fecha_desde IS NULL
        OR b.created_at >= (p_fecha_desde::timestamp AT TIME ZONE 'America/Monterrey')
      )
      AND (
        p_fecha_hasta IS NULL
        OR b.created_at <= (
          (p_fecha_hasta::timestamp + interval '1 day' - interval '1 millisecond')
            AT TIME ZONE 'America/Monterrey'
        )
      )
      AND (
        v_quick = 'todos'
        OR coalesce(b.ciclo_estado, '') IS DISTINCT FROM 'cerrado'
      )
      AND CASE v_quick
        WHEN 'todos' THEN TRUE
        WHEN 'en_tramite' THEN
          b.resultado_real = 'en_tramite'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_requerida'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_enviada'
        WHEN 'correccion_requerida' THEN b.categoria_correccion = 'correccion_requerida'
        WHEN 'correccion_enviada' THEN b.categoria_correccion = 'correccion_enviada'
        WHEN 'rechazados_mesa' THEN b.resultado_real = 'rechazado_mesa'
        WHEN 'cancelados' THEN b.resultado_real = 'cancelado'
        WHEN 'agendar_biometricos' THEN b.pendiente_agendar_biometricos
        WHEN 'agendar_firma' THEN b.pendiente_agendar_firma
        WHEN 'subir_acuse' THEN b.pendiente_subir_acuse
        ELSE TRUE
      END
  ),
  counted AS (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  page AS (
    SELECT
      f.id,
      f.programa_ui AS programa,
      f.programa::text AS programa_db,
      f.nss,
      f.cliente_nombre,
      f.telefono_cliente,
      f.direccion_opcional,
      f.asesor_id,
      f.origen_mesa,
      f.submitted_to_mesa,
      f.fecha_envio_mesa,
      f.etapa_actual,
      f.subestado,
      f.ciclo_estado,
      f.motivo_rechazo,
      f.comentario_rechazo,
      f.fecha_cita,
      f.firma_agendable_desde,
      f.pago_concasa_resultado,
      f.pago_concasa_at,
      f.created_at,
      f.updated_at,
      f.expediente_anterior_id,
      f.reingreso_rechazo_id,
      f.reingreso_manual_count,
      f.reingreso_manual_at,
      f.reingreso_manual_by,
      f.reprecalificacion_pendiente_id,
      f.decision,
      f.monto_aprobado,
      f.notas_revision,
      f.aprobado_at,
      f.monto_aprobado_al_aprobar,
      f.no_cumple_at,
      f.resultado_real,
      f.categoria_correccion,
      f.reprecal_estado,
      f.reprecal_solicitada_at,
      f.reprecal_resuelta_at,
      f.reprecal_activity_at,
      f.reprecal_monto_previo,
      f.reprecal_monto_resultado,
      f.reprecal_programa_solicitado,
      f.inbox_sort_at
    FROM filtered f
    ORDER BY f.inbox_sort_at DESC, f.id DESC
    OFFSET v_from
    LIMIT v_size
  )
  SELECT
    c.total,
    coalesce(
      (SELECT jsonb_agg((to_jsonb(p) - 'inbox_sort_at') ORDER BY p.inbox_sort_at DESC, p.id DESC) FROM page p),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM counted c;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', v_total,
    'page', v_page,
    'page_size', v_size,
    'has_more', (v_from + v_size) < v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT
) IS
  'P161/P166/P183: listado inbox asesor. Orden COALESCE(reprecal_activity_at, created_at) DESC. Fechas filtran created_at.';
