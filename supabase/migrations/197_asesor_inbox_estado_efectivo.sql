-- ConCasa CRM — P197: estado efectivo del inbox asesor (chips = episodio actual).
-- Cloud max conocido = 195. 196 = causalidad P196 (local). 197 = este bloque.
-- Operación de citas → 198.
-- READ-MODEL only. 0 writers, 0 Disponibles, 0 /asesor page.tsx.
-- categoria_correccion (documentación) intacta. resultado_real (columna) intacto.

CREATE OR REPLACE FUNCTION public.mesa_correccion_episodio_flags(
  p_expediente_id UUID
)
RETURNS TABLE (
  unanswered BOOLEAN,
  responded BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_envio TIMESTAMPTZ;
  v_unanswered BOOLEAN := FALSE;
  v_responded BOOLEAN := FALSE;
BEGIN
  IF p_expediente_id IS NULL THEN
    unanswered := FALSE;
    responded := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT e.fecha_envio_mesa INTO v_envio
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    unanswered := FALSE;
    responded := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    bool_or(NOT x.has_lote_after),
    bool_or(x.has_lote_after)
  INTO v_unanswered, v_responded
  FROM (
    SELECT EXISTS (
      SELECT 1
      FROM public.expediente_asesor_cambio_lotes lmid
      WHERE lmid.expediente_id = p_expediente_id
        AND lmid.submitted_at IS NOT NULL
        AND lmid.submitted_at > r.request_at
    ) AS has_lote_after
    FROM (
      SELECT al.created_at AS request_at
      FROM public.action_log al
      WHERE al.action = 'cliente_datos.revision.update'
        AND al.entity_type = 'cliente_datos'
        AND al.entity_id = p_expediente_id
        AND coalesce(al.payload->>'estado_nuevo', '') = 'rechazado'
        AND (v_envio IS NULL OR al.created_at >= v_envio)
        AND NOT EXISTS (
          SELECT 1
          FROM public.action_log alv
          WHERE alv.action = 'cliente_datos.revision.update'
            AND alv.entity_type = 'cliente_datos'
            AND alv.entity_id = p_expediente_id
            AND coalesce(alv.payload->>'estado_nuevo', '') = 'validado'
            AND alv.created_at > al.created_at
        )
      UNION ALL
      SELECT dr.created_at
      FROM public.documento_revisiones dr
      INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
      WHERE dr.expediente_id = p_expediente_id
        AND dr.estatus_nuevo::text = 'rechazado'
        AND (v_envio IS NULL OR dr.created_at >= v_envio)
        AND NOT EXISTS (
          SELECT 1
          FROM public.documento_revisiones dr2
          INNER JOIN public.expediente_documentos d2 ON d2.id = dr2.documento_id
          WHERE dr2.expediente_id = p_expediente_id
            AND dr2.estatus_nuevo::text = 'validado'
            AND d2.tipo_documento IS NOT DISTINCT FROM d.tipo_documento
            AND dr2.created_at > dr.created_at
        )
      UNION ALL
      SELECT ro.created_at
      FROM public.expediente_rechazos_operativos ro
      WHERE ro.expediente_id = p_expediente_id
        AND (v_envio IS NULL OR ro.created_at >= v_envio)
        AND NOT EXISTS (
          SELECT 1
          FROM public.expediente_rechazo_reactivaciones x
          WHERE x.rechazo_id = ro.id
        )
    ) r
  ) x;

  unanswered := coalesce(v_unanswered, FALSE);
  responded := coalesce(v_responded, FALSE);
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.mesa_correccion_episodio_flags(UUID) IS
  'P197: unanswered = solicitud Mesa abierta del ciclo sin lote P130 posterior; responded = ya hubo primer lote.';

REVOKE ALL ON FUNCTION public.mesa_correccion_episodio_flags(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_correccion_episodio_flags(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_correccion_episodio_flags(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.asesor_inbox_estado_efectivo(
  p_expediente_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ciclo TEXT;
  v_submitted BOOLEAN;
  v_subestado TEXT;
  v_decision TEXT;
  v_envio TIMESTAMPTZ;
  v_resultado TEXT;
  v_origin TEXT;
  v_unanswered BOOLEAN;
  v_responded BOOLEAN;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    e.ciclo_estado::text,
    e.submitted_to_mesa,
    e.subestado::text,
    ed.decision::text,
    e.fecha_envio_mesa
  INTO v_ciclo, v_submitted, v_subestado, v_decision, v_envio
  FROM public.expedientes e
  LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_resultado := public.asesor_inbox_resultado_real(
    v_submitted, v_subestado, v_ciclo, v_decision
  );

  IF v_resultado = 'cancelado' THEN
    RETURN 'cancelado';
  END IF;

  SELECT c.origin
  INTO v_origin
  FROM public.mesa_cambio_revision_clasificacion(p_expediente_id) c
  WHERE c.origin = 'REQUESTED_CORRECTION'
  LIMIT 1;

  IF v_origin = 'REQUESTED_CORRECTION' THEN
    RETURN 'correccion_enviada';
  END IF;

  SELECT f.unanswered, f.responded
  INTO v_unanswered, v_responded
  FROM public.mesa_correccion_episodio_flags(p_expediente_id) f;

  IF coalesce(v_unanswered, FALSE)
     OR public.asesor_inbox_categoria_correccion(p_expediente_id) = 'correccion_requerida' THEN
    RETURN 'correccion_requerida';
  END IF;

  IF v_resultado = 'rechazado_mesa' THEN
    -- Rechazo ya respondido (lote P130 posterior a alguna solicitud del ciclo),
    -- incluso si subestado sigue 'rechazado': no gobierna el chip.
    IF coalesce(v_responded, FALSE)
       OR EXISTS (
         SELECT 1
         FROM public.expediente_asesor_cambio_lotes lhist
         WHERE lhist.expediente_id = p_expediente_id
           AND lhist.submitted_at IS NOT NULL
           AND lhist.submitted_at > (
             SELECT max(r.request_at)
             FROM (
               SELECT al.created_at AS request_at
               FROM public.action_log al
               WHERE al.action = 'cliente_datos.revision.update'
                 AND al.entity_type = 'cliente_datos'
                 AND al.entity_id = p_expediente_id
                 AND coalesce(al.payload->>'estado_nuevo', '') = 'rechazado'
                 AND (v_envio IS NULL OR al.created_at >= v_envio)
               UNION ALL
               SELECT dr.created_at
               FROM public.documento_revisiones dr
               INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
               WHERE dr.expediente_id = p_expediente_id
                 AND dr.estatus_nuevo::text = 'rechazado'
                 AND (v_envio IS NULL OR dr.created_at >= v_envio)
               UNION ALL
               SELECT ro.created_at
               FROM public.expediente_rechazos_operativos ro
               WHERE ro.expediente_id = p_expediente_id
                 AND (v_envio IS NULL OR ro.created_at >= v_envio)
             ) r
           )
       )
    THEN
      RETURN public.asesor_inbox_resultado_real(
        v_submitted, 'en_proceso', v_ciclo, v_decision
      );
    END IF;
    RETURN 'rechazado_mesa';
  END IF;

  RETURN v_resultado;
END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) IS
  'P197: chip/cola. cancelado → REQUESTED P196 → solicitud/categoria sin respuesta → rechazo no respondido (subestado stale ignorado si hubo lote) → resultado_real. Sin persistir.';

REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) TO authenticated;


-- Listado (misma firma P183) — quick filter = estado_efectivo
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
      public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo,
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
        WHEN 'en_tramite' THEN b.estado_efectivo = 'en_tramite'
        WHEN 'correccion_requerida' THEN b.estado_efectivo = 'correccion_requerida'
        WHEN 'correccion_enviada' THEN b.estado_efectivo = 'correccion_enviada'
        WHEN 'rechazados_mesa' THEN b.estado_efectivo = 'rechazado_mesa'
        WHEN 'cancelados' THEN b.estado_efectivo = 'cancelado'
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
      f.estado_efectivo,
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
  'P161/P166/P183/P197: listado inbox. Quick filters usan estado_efectivo. Orden reprecal_activity/created_at.';


-- Summary counts = misma clasificación
CREATE OR REPLACE FUNCTION public.asesor_inbox_summary(
  p_notif_limit INTEGER DEFAULT 50
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
  v_limit INTEGER;
  v_today TEXT;
  v_counts JSONB;
  v_programas JSONB;
  v_notifs JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_inbox_summary: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active
  INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_inbox_summary: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  v_limit := LEAST(100, GREATEST(1, coalesce(p_notif_limit, 50)));
  v_today := to_char(
    (now() AT TIME ZONE 'America/Monterrey')::date,
    'YYYY-MM-DD'
  );

  WITH base AS (
    SELECT
      e.id,
      e.cliente_nombre,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.fecha_cita,
      e.updated_at,
      public.asesor_inbox_programa_ui(e.programa) AS programa_ui,
      public.asesor_inbox_resultado_real(
        e.submitted_to_mesa,
        e.subestado::text,
        e.ciclo_estado::text,
        ed.decision::text
      ) AS resultado_real,
      public.asesor_inbox_categoria_correccion(e.id) AS categoria_correccion,
      public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo,
      public.asesor_inbox_pendiente_agendar_biometricos(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_biometricos,
      public.asesor_inbox_pendiente_agendar_firma(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_firma,
      public.asesor_inbox_pendiente_subir_acuse(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_subir_acuse,
      (SELECT cd.estado::text FROM public.cliente_datos cd WHERE cd.expediente_id = e.id LIMIT 1)
        AS cliente_datos_estado
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_actor
  ),
  agg AS (
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE resultado_real = 'aprobado_editor')::bigint AS aprobados_editor,
      count(*) FILTER (WHERE resultado_real = 'no_cumple_editor')::bigint AS no_cumple,
      count(*) FILTER (WHERE estado_efectivo = 'en_tramite')::bigint AS en_tramite,
      count(*) FILTER (WHERE estado_efectivo = 'rechazado_mesa')::bigint AS rechazados_mesa,
      count(*) FILTER (WHERE estado_efectivo = 'cancelado')::bigint AS cancelados,
      count(*) FILTER (WHERE estado_efectivo = 'correccion_requerida')::bigint
        AS correccion_requerida,
      count(*) FILTER (WHERE estado_efectivo = 'correccion_enviada')::bigint
        AS correccion_enviada,
      count(*) FILTER (WHERE pendiente_agendar_biometricos)::bigint AS agendar_biometricos,
      count(*) FILTER (WHERE pendiente_agendar_firma)::bigint AS agendar_firma,
      count(*) FILTER (WHERE pendiente_subir_acuse)::bigint AS subir_acuse
    FROM base
  ),
  programas AS (
    SELECT coalesce(
      jsonb_agg(DISTINCT programa_ui ORDER BY programa_ui),
      '[]'::jsonb
    ) AS arr
    FROM base
    WHERE trim(coalesce(programa_ui, '')) <> ''
  ),
  notif_raw AS (
    -- Espejo buildCandidates(audience=asesor) + pickBest (menor prioridad).
    SELECT
      b.id AS expediente_id,
      b.cliente_nombre,
      cand.kind,
      cand.tipo_label,
      cand.mensaje,
      cand.fecha,
      cand.prioridad,
      '/asesor/expediente/' || b.id::text AS href
    FROM base b
    CROSS JOIN LATERAL (
      SELECT kind, tipo_label, mensaje, fecha, prioridad
      FROM (
        SELECT
          'cancelado'::text AS kind,
          'Expediente cancelado'::text AS tipo_label,
          'Expediente cancelado (terminal) — solo lectura'::text AS mensaje,
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita) AS fecha,
          1 AS prioridad
        WHERE b.ciclo_estado = 'cancelado'

        UNION ALL
        SELECT
          'correccion_requerida',
          'Corrección requerida',
          CASE
            WHEN b.cliente_datos_estado = 'rechazado'
                 AND b.categoria_correccion = 'correccion_requerida'
              THEN 'Datos generales y documentos requieren corrección'
            WHEN b.cliente_datos_estado = 'rechazado'
              THEN 'Datos generales requieren corrección'
            ELSE 'Documentos requieren corrección'
          END,
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita),
          1
        WHERE b.estado_efectivo = 'correccion_requerida'

        UNION ALL
        SELECT
          'rechazado_mesa',
          'Rechazado por Mesa',
          'Expediente rechazado o bloqueado por Mesa',
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita),
          2
        WHERE b.estado_efectivo = 'rechazado_mesa'

        UNION ALL
        SELECT
          'correccion_enviada',
          'Corrección enviada',
          'Corrección enviada — Mesa debe revisar',
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita),
          3
        WHERE b.estado_efectivo = 'correccion_enviada'

        UNION ALL
        SELECT
          'enviado_mesa',
          'En validación Mesa',
          'Expediente enviado a Mesa — en validación',
          coalesce(b.fecha_envio_mesa, b.updated_at, b.fecha_cita),
          5
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.submitted_to_mesa
          AND coalesce(b.subestado, '') = 'en_validacion_mesa'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_requerida'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_enviada'
          AND coalesce(b.cliente_datos_estado, '') IS DISTINCT FROM 'rechazado'

        UNION ALL
        SELECT
          'cita_hoy',
          'Cita hoy',
          'Cita programada para hoy',
          coalesce(b.fecha_cita, b.updated_at),
          6
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.fecha_cita IS NOT NULL
          AND to_char((b.fecha_cita AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD') = v_today

        UNION ALL
        SELECT
          'cita_cambio',
          'Cambio en cita',
          'Cita cancelada o pendiente de reagendar',
          coalesce(b.updated_at, b.fecha_envio_mesa),
          6
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.submitted_to_mesa
          AND b.etapa_actual IN (4, 5, 9, 10)
          AND b.fecha_cita IS NULL

        UNION ALL
        SELECT
          'cita_programada',
          'Cita agendada',
          'Cita agendada (' || to_char((b.fecha_cita AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD') || ')',
          coalesce(b.fecha_cita, b.updated_at),
          7
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.fecha_cita IS NOT NULL
          AND b.etapa_actual IN (4, 5, 9, 10)
          AND to_char((b.fecha_cita AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD')
            IS DISTINCT FROM v_today
      ) cands
      ORDER BY prioridad ASC, fecha DESC NULLS LAST
      LIMIT 1
    ) cand
  ),
  notif_page AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.expediente_id::text || ':' || n.kind,
          'expediente_id', n.expediente_id,
          'cliente_nombre', coalesce(nullif(trim(n.cliente_nombre), ''), '—'),
          'kind', n.kind,
          'tipo_label', n.tipo_label,
          'mensaje', n.mensaje,
          'fecha', n.fecha,
          'prioridad', n.prioridad,
          'href', n.href
        )
        ORDER BY n.prioridad ASC, n.fecha DESC NULLS LAST
      ),
      '[]'::jsonb
    ) AS arr
    FROM (
      SELECT *
      FROM notif_raw
      ORDER BY prioridad ASC, fecha DESC NULLS LAST
      LIMIT v_limit
    ) n
  )
  SELECT
    jsonb_build_object(
      'total', a.total,
      'aprobados_editor', a.aprobados_editor,
      'no_cumple', a.no_cumple,
      'en_tramite', a.en_tramite,
      'rechazados_mesa', a.rechazados_mesa,
      'cancelados', a.cancelados,
      'correccion_requerida', a.correccion_requerida,
      'correccion_enviada', a.correccion_enviada,
      'agendar_biometricos', a.agendar_biometricos,
      'agendar_firma', a.agendar_firma,
      'subir_acuse', a.subir_acuse
    ),
    p.arr,
    np.arr
  INTO v_counts, v_programas, v_notifs
  FROM agg a, programas p, notif_page np;

  RETURN jsonb_build_object(
    'counts', coalesce(v_counts, '{}'::jsonb),
    'programas_unicos', coalesce(v_programas, '[]'::jsonb),
    'notifications', coalesce(v_notifs, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_inbox_summary(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_summary(INTEGER) TO authenticated;

COMMENT ON FUNCTION public.asesor_inbox_summary(INTEGER) IS
  'P161/P197: KPIs/chips por estado_efectivo + notifs alineadas. Solo dueño.';
