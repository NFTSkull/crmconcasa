-- ConCasa CRM — P193: clasificar Cambios por revisar (origen Mesa vs asesor).
-- Cloud max conocido = 192. 193 = este bloque. Operación de citas → 194.
-- Solo read-model. Sin tablas, columnas, backfill ni UPDATE de lotes/expedientes.
-- P192 intacto: mesa_bandeja_categoria_resumen no se toca.
-- Parent correccion_enviada = P130 pending OR legacy P102 (misma membresía LIVE).

CREATE OR REPLACE FUNCTION public.mesa_cambio_revision_clasificacion(
  p_expediente_id UUID
)
RETURNS TABLE (
  origin TEXT,
  request_type TEXT,
  request_at TIMESTAMPTZ,
  batch_submitted_at TIMESTAMPTZ,
  batch_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_envio TIMESTAMPTZ;
  v_lote_id UUID;
  v_submitted TIMESTAMPTZ;
  v_prior_reviewed TIMESTAMPTZ;
  v_prior_submitted TIMESTAMPTZ;
  v_has_prior BOOLEAN;
  v_cycle_start TIMESTAMPTZ;
  v_cat TEXT;
  v_req_type TEXT;
  v_req_at TIMESTAMPTZ;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN;
  END IF;

  SELECT e.fecha_envio_mesa
  INTO v_envio
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT l.id, l.submitted_at
  INTO v_lote_id, v_submitted
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.expediente_id = p_expediente_id
    AND l.status = 'pendiente_revision'
    AND l.submitted_at IS NOT NULL
  ORDER BY l.submitted_at DESC, l.created_at DESC, l.id DESC
  LIMIT 1;

  IF v_lote_id IS NULL THEN
    v_cat := public.mesa_bandeja_categoria_resumen(p_expediente_id, v_envio);
    IF v_cat = 'correccion_enviada' THEN
      origin := 'LEGACY';
      request_type := NULL;
      request_at := NULL;
      batch_submitted_at := NULL;
      batch_id := NULL;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  SELECT l.reviewed_at, l.submitted_at
  INTO v_prior_reviewed, v_prior_submitted
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.expediente_id = p_expediente_id
    AND l.id IS DISTINCT FROM v_lote_id
    AND l.submitted_at IS NOT NULL
    AND l.submitted_at < v_submitted
  ORDER BY l.submitted_at DESC, l.created_at DESC, l.id DESC
  LIMIT 1;

  v_has_prior := (v_prior_reviewed IS NOT NULL OR v_prior_submitted IS NOT NULL);

  -- Sin lote previo utilizable y submitted_at anterior a fecha_envio_mesa → no reconstruir.
  IF (NOT v_has_prior) AND v_envio IS NOT NULL AND v_submitted < v_envio THEN
    origin := 'AMBIGUOUS';
    request_type := NULL;
    request_at := NULL;
    batch_submitted_at := v_submitted;
    batch_id := v_lote_id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_cycle_start := COALESCE(v_prior_reviewed, v_prior_submitted, v_envio);

  IF v_cycle_start IS NOT NULL THEN
    SELECT x.request_type, x.request_at
    INTO v_req_type, v_req_at
    FROM (
      SELECT
        'SOLICITUD_DATOS_GENERALES'::text AS request_type,
        al.created_at AS request_at
      FROM public.action_log al
      WHERE al.action = 'cliente_datos.revision.update'
        AND al.entity_type = 'cliente_datos'
        AND al.entity_id = p_expediente_id
        AND coalesce(al.payload->>'estado_nuevo', '') = 'rechazado'
        AND al.created_at >= v_cycle_start
        AND al.created_at < v_submitted
        AND NOT EXISTS (
          SELECT 1
          FROM public.action_log alv
          WHERE alv.action = 'cliente_datos.revision.update'
            AND alv.entity_type = 'cliente_datos'
            AND alv.entity_id = p_expediente_id
            AND coalesce(alv.payload->>'estado_nuevo', '') = 'validado'
            AND alv.created_at > al.created_at
            AND alv.created_at < v_submitted
        )
      UNION ALL
      SELECT
        'SOLICITUD_DOCUMENTAL'::text,
        dr.created_at
      FROM public.documento_revisiones dr
      INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
      WHERE dr.expediente_id = p_expediente_id
        AND dr.estatus_nuevo::text = 'rechazado'
        AND dr.created_at >= v_cycle_start
        AND dr.created_at < v_submitted
        AND NOT EXISTS (
          SELECT 1
          FROM public.documento_revisiones dr2
          INNER JOIN public.expediente_documentos d2 ON d2.id = dr2.documento_id
          WHERE dr2.expediente_id = p_expediente_id
            AND dr2.estatus_nuevo::text = 'validado'
            AND d2.tipo_documento IS NOT DISTINCT FROM d.tipo_documento
            AND dr2.created_at > dr.created_at
            AND dr2.created_at < v_submitted
        )
      UNION ALL
      SELECT
        'RECHAZO_OPERATIVO_CON_CORRECCION'::text,
        ro.created_at
      FROM public.expediente_rechazos_operativos ro
      WHERE ro.expediente_id = p_expediente_id
        AND ro.created_at >= v_cycle_start
        AND ro.created_at < v_submitted
        AND NOT EXISTS (
          SELECT 1
          FROM public.expediente_rechazo_reactivaciones x
          WHERE x.rechazo_id = ro.id
            AND x.created_at < v_submitted
        )
    ) x
    ORDER BY x.request_at DESC, x.request_type ASC
    LIMIT 1;
  END IF;

  IF v_req_at IS NOT NULL THEN
    origin := 'REQUESTED_CORRECTION';
    request_type := v_req_type;
    request_at := v_req_at;
  ELSE
    origin := 'ADVISOR_UPDATE';
    request_type := NULL;
    request_at := NULL;
  END IF;

  batch_submitted_at := v_submitted;
  batch_id := v_lote_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) IS
  'P193: origen del cambio pendiente (REQUESTED/ADVISOR/AMBIGUOUS/LEGACY). STABLE. Sin PII. Sin persistir.';

REVOKE ALL ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) TO authenticated;

-- Misma firma. Nuevos valores de p_quick_filter; counts e items con metadata de origen.
-- No menciona expediente_asesor_cambio_lotes (P192: lista no duplica predicado P130).
CREATE OR REPLACE FUNCTION public.mesa_list_bandeja_page(
  p_limit INTEGER DEFAULT 25,
  p_cursor_sort_ts TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_quick_filter TEXT DEFAULT 'todos',
  p_ops_filter TEXT DEFAULT 'todo_mesa',
  p_buscar TEXT DEFAULT NULL,
  p_etapa INTEGER DEFAULT NULL,
  p_subestado TEXT DEFAULT NULL,
  p_solo_citas_hoy BOOLEAN DEFAULT FALSE,
  p_today_ymd TEXT DEFAULT NULL,
  p_rechazos_sub TEXT DEFAULT 'rechazados',
  p_origen TEXT DEFAULT NULL,
  p_include_counts BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_q TEXT;
  v_q_digits TEXT;
  v_role public.app_role;
  v_uid UUID;
  v_total BIGINT;
  v_items JSONB;
  v_counts JSONB := NULL;
  v_last_sort TIMESTAMPTZ;
  v_last_id UUID;
  v_page_len INTEGER;
  v_has_more BOOLEAN;
  v_quick TEXT;
  v_ops TEXT;
  v_rech TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mesa_bandeja: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_bandeja: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  v_limit := LEAST(100, GREATEST(1, coalesce(p_limit, 25)));
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');
  v_q_digits := nullif(regexp_replace(coalesce(v_q, ''), '\D', '', 'g'), '');
  v_quick := coalesce(nullif(btrim(p_quick_filter), ''), 'todos');
  v_ops := coalesce(nullif(btrim(p_ops_filter), ''), 'todo_mesa');
  v_rech := coalesce(nullif(btrim(p_rechazos_sub), ''), 'rechazados');

  WITH enriched AS (
    SELECT
      e.id,
      public.mesa_bandeja_sort_ts(e.id, e.fecha_envio_mesa, e.created_at) AS sort_ts,
      public.mesa_bandeja_categoria_resumen(e.id, e.fecha_envio_mesa) AS categoria,
      ops.assigned_to,
      ops.assigned_at,
      ops.estado_mesa::text AS estado_mesa,
      ops.last_activity_at,
      act.last_viewed_at,
      act.last_updated_at,
      nullif(btrim(pv.full_name), '') AS last_viewed_by_name,
      nullif(btrim(pu.full_name), '') AS last_updated_by_name,
      e.programa::text AS programa,
      e.nss::text AS nss,
      e.cliente_nombre,
      e.telefono_cliente,
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
      e.created_at,
      e.updated_at,
      e.expediente_anterior_id,
      e.reingreso_rechazo_id,
      e.reingreso_manual_count,
      e.reingreso_manual_at,
      e.reingreso_manual_by,
      e.pago_concasa_resultado
    FROM public.expedientes e
    LEFT JOIN public.mesa_expediente_ops ops ON ops.expediente_id = e.id
    LEFT JOIN public.expediente_mesa_actividad act
      ON act.expediente_id = e.id
     AND act.organization_id = e.organization_id
    LEFT JOIN public.profiles pv ON pv.id = act.last_viewed_by
    LEFT JOIN public.profiles pu ON pu.id = act.last_updated_by
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.ciclo_estado IN ('activo', 'cancelado')
      AND public.can_see_expediente(e.id)
      AND (
        p_origen IS NULL OR p_origen = '' OR p_origen = 'todos'
        OR (p_origen = 'interno' AND coalesce(e.origen_mesa::text, 'interno') = 'interno')
        OR (p_origen = 'externo' AND e.origen_mesa::text = 'externo')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR (
          v_q_digits IS NOT NULL
          AND regexp_replace(coalesce(e.telefono_cliente, ''), '\D', '', 'g')
            LIKE '%' || v_q_digits || '%'
        )
        OR (
          v_q_digits IS NOT NULL
          AND regexp_replace(coalesce(e.nss::text, ''), '\D', '', 'g')
            LIKE '%' || v_q_digits || '%'
        )
        OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      )
      AND (p_etapa IS NULL OR e.etapa_actual = p_etapa::smallint)
      AND (
        p_subestado IS NULL OR p_subestado = '' OR p_subestado = 'todas'
        OR e.subestado::text = p_subestado
      )
      AND (
        NOT coalesce(p_solo_citas_hoy, false)
        OR (
          p_today_ymd IS NOT NULL
          AND to_char(
            (e.fecha_cita AT TIME ZONE 'America/Monterrey'),
            'YYYY-MM-DD'
          ) = p_today_ymd
        )
      )
  ),
  classified AS (
    SELECT
      en.*,
      CASE
        WHEN en.categoria = 'correccion_enviada' THEN (
          SELECT to_jsonb(t)
          FROM public.mesa_cambio_revision_clasificacion(en.id) t
          LIMIT 1
        )
        ELSE NULL
      END AS cambio_cls
    FROM enriched en
  ),
  filtered AS (
    SELECT cl.*
    FROM classified cl
    WHERE
      CASE v_quick
        WHEN 'todos' THEN cl.ciclo_estado = 'activo'
        WHEN 'correccion_enviada' THEN
          cl.ciclo_estado = 'activo' AND cl.categoria = 'correccion_enviada'
        WHEN 'correccion_solicitada' THEN
          cl.ciclo_estado = 'activo'
          AND cl.categoria = 'correccion_enviada'
          AND cl.cambio_cls->>'origin' = 'REQUESTED_CORRECTION'
        WHEN 'otras_actualizaciones' THEN
          cl.ciclo_estado = 'activo'
          AND cl.categoria = 'correccion_enviada'
          AND cl.cambio_cls->>'origin' IN ('ADVISOR_UPDATE', 'AMBIGUOUS', 'LEGACY')
        WHEN 'nuevos' THEN
          cl.ciclo_estado = 'activo'
          AND cl.etapa_actual IN (1, 2)
          AND cl.subestado IN ('pendiente', 'en_validacion_mesa', 'en_proceso')
        WHEN 'en_proceso' THEN
          cl.ciclo_estado = 'activo' AND cl.subestado = 'en_proceso'
        WHEN 'rechazos_cancelaciones' THEN
          CASE v_rech
            WHEN 'cancelados' THEN cl.ciclo_estado = 'cancelado'
            ELSE cl.subestado = 'rechazado' AND cl.ciclo_estado = 'activo'
          END
        ELSE cl.ciclo_estado = 'activo'
      END
      AND CASE v_ops
        WHEN 'todo_mesa' THEN TRUE
        WHEN 'en_espera_asesor' THEN cl.categoria = 'correccion_requerida'
        WHEN 'sin_asignar' THEN
          cl.assigned_to IS NULL
          AND (cl.estado_mesa IS NULL OR cl.estado_mesa = 'sin_asignar')
          AND cl.categoria IS DISTINCT FROM 'correccion_requerida'
        WHEN 'mi_bandeja' THEN
          cl.assigned_to = v_uid AND cl.categoria IS DISTINCT FROM 'correccion_requerida'
        WHEN 'en_trabajo' THEN
          cl.assigned_to IS NOT NULL AND cl.categoria IS DISTINCT FROM 'correccion_requerida'
        ELSE TRUE
      END
  ),
  counted AS (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  page AS (
    SELECT f.*
    FROM filtered f
    WHERE
      p_cursor_sort_ts IS NULL
      OR (f.sort_ts, f.id) > (p_cursor_sort_ts, p_cursor_id)
    ORDER BY f.sort_ts ASC, f.id ASC
    LIMIT (v_limit + 1)
  ),
  page_trim AS (
    SELECT * FROM (
      SELECT p.*, row_number() OVER (ORDER BY p.sort_ts ASC, p.id ASC) AS rn
      FROM page p
    ) x
    WHERE x.rn <= v_limit
  )
  SELECT
    c.total,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'programa', p.programa,
            'nss', p.nss,
            'cliente_nombre', p.cliente_nombre,
            'telefono_cliente', p.telefono_cliente,
            'direccion_opcional', p.direccion_opcional,
            'asesor_id', p.asesor_id,
            'origen_mesa', p.origen_mesa,
            'submitted_to_mesa', p.submitted_to_mesa,
            'fecha_envio_mesa', p.fecha_envio_mesa,
            'etapa_actual', p.etapa_actual,
            'subestado', p.subestado,
            'ciclo_estado', p.ciclo_estado,
            'motivo_rechazo', p.motivo_rechazo,
            'comentario_rechazo', p.comentario_rechazo,
            'fecha_cita', p.fecha_cita,
            'created_at', p.created_at,
            'updated_at', p.updated_at,
            'expediente_anterior_id', p.expediente_anterior_id,
            'reingreso_rechazo_id', p.reingreso_rechazo_id,
            'reingreso_manual_count', p.reingreso_manual_count,
            'reingreso_manual_at', p.reingreso_manual_at,
            'reingreso_manual_by', p.reingreso_manual_by,
            'pago_concasa_resultado', p.pago_concasa_resultado,
            'sort_ts', p.sort_ts,
            'categoria_resumen', p.categoria,
            'ops_assigned_to', p.assigned_to,
            'ops_assigned_at', p.assigned_at,
            'ops_estado_mesa', p.estado_mesa,
            'ops_last_activity_at', p.last_activity_at,
            'last_viewed_by_name', p.last_viewed_by_name,
            'last_viewed_at', p.last_viewed_at,
            'last_updated_by_name', p.last_updated_by_name,
            'last_updated_at', p.last_updated_at,
            'cambio_revision_origen', p.cambio_cls->>'origin',
            'cambio_request_type', p.cambio_cls->>'request_type',
            'cambio_request_at', p.cambio_cls->>'request_at'
          )
          ORDER BY p.sort_ts ASC, p.id ASC
        )
        FROM page_trim p
      ),
      '[]'::jsonb
    ),
    (SELECT p.sort_ts FROM page_trim p ORDER BY p.sort_ts DESC, p.id DESC LIMIT 1),
    (SELECT p.id FROM page_trim p ORDER BY p.sort_ts DESC, p.id DESC LIMIT 1),
    (SELECT count(*)::int FROM page)
  INTO v_total, v_items, v_last_sort, v_last_id, v_page_len
  FROM counted c;

  v_has_more := coalesce(v_page_len, 0) > v_limit;
  IF NOT v_has_more THEN
    v_last_sort := NULL;
    v_last_id := NULL;
  END IF;

  IF coalesce(p_include_counts, true) THEN
    SELECT jsonb_build_object(
      'correccionesEnviadas', count(*) FILTER (
        WHERE ciclo_estado = 'activo' AND categoria = 'correccion_enviada'
      ),
      'correccionesSolicitadas', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND categoria = 'correccion_enviada'
          AND cambio_origin = 'REQUESTED_CORRECTION'
      ),
      'otrasActualizaciones', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND categoria = 'correccion_enviada'
          AND cambio_origin IN ('ADVISOR_UPDATE', 'AMBIGUOUS', 'LEGACY')
      ),
      'nuevos', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND etapa_actual IN (1, 2)
          AND subestado IN ('pendiente', 'en_validacion_mesa', 'en_proceso')
      ),
      'enProceso', count(*) FILTER (
        WHERE ciclo_estado = 'activo' AND subestado = 'en_proceso'
      ),
      'citasHoy', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND p_today_ymd IS NOT NULL
          AND to_char(
            (fecha_cita AT TIME ZONE 'America/Monterrey'),
            'YYYY-MM-DD'
          ) = p_today_ymd
      ),
      'rechazosCancelaciones', count(*) FILTER (
        WHERE (subestado = 'rechazado' AND ciclo_estado = 'activo')
           OR ciclo_estado = 'cancelado'
      ),
      'rechazados', count(*) FILTER (
        WHERE subestado = 'rechazado' AND ciclo_estado = 'activo'
      ),
      'cancelados', count(*) FILTER (WHERE ciclo_estado = 'cancelado'),
      'bloqueadosRechazados', count(*) FILTER (
        WHERE (subestado = 'rechazado' AND ciclo_estado = 'activo')
           OR (ciclo_estado = 'activo' AND categoria = 'correccion_requerida')
      ),
      'enValidacionMesa', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND subestado = 'en_validacion_mesa'
          AND categoria IS DISTINCT FROM 'correccion_enviada'
          AND categoria IS DISTINCT FROM 'correccion_requerida'
      ),
      'enEsperaAsesor', count(*) FILTER (
        WHERE ciclo_estado = 'activo' AND categoria = 'correccion_requerida'
      ),
      'totalBandeja', count(*) FILTER (WHERE ciclo_estado = 'activo')
    )
    INTO v_counts
    FROM (
      SELECT
        c0.etapa_actual,
        c0.subestado,
        c0.ciclo_estado,
        c0.fecha_cita,
        c0.categoria,
        CASE
          WHEN c0.categoria = 'correccion_enviada' THEN (
            SELECT t.origin
            FROM public.mesa_cambio_revision_clasificacion(c0.id) t
            LIMIT 1
          )
          ELSE NULL
        END AS cambio_origin
      FROM (
        SELECT
          e.id,
          e.etapa_actual,
          e.subestado::text AS subestado,
          e.ciclo_estado::text AS ciclo_estado,
          e.fecha_cita,
          public.mesa_bandeja_categoria_resumen(e.id, e.fecha_envio_mesa) AS categoria
        FROM public.expedientes e
        WHERE e.deleted_at IS NULL
          AND e.submitted_to_mesa = TRUE
          AND e.ciclo_estado IN ('activo', 'cancelado')
          AND public.can_see_expediente(e.id)
          AND (
            p_origen IS NULL OR p_origen = '' OR p_origen = 'todos'
            OR (p_origen = 'interno' AND coalesce(e.origen_mesa::text, 'interno') = 'interno')
            OR (p_origen = 'externo' AND e.origen_mesa::text = 'externo')
          )
      ) c0
    ) c;
  END IF;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', coalesce(v_total, 0),
    'has_more', v_has_more,
    'next_cursor', CASE
      WHEN v_has_more AND v_last_id IS NOT NULL THEN
        jsonb_build_object('sort_ts', v_last_sort, 'id', v_last_id)
      ELSE NULL
    END,
    'counts', v_counts
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_list_bandeja_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN
) IS
  'P102/P166 + P193: misma firma; subfiltros correccion_solicitada / otras_actualizaciones sobre parent correccion_enviada.';

REVOKE ALL ON FUNCTION public.mesa_list_bandeja_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesa_list_bandeja_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;
