-- ConCasa CRM — P198: estado efectivo de revisión Mesa (colas de cambios).
-- Cloud max = 197. 198 = este read-model. Citas → 199.
-- RAW lote.status intacto. 0 UPDATE de lotes. 0 writers. 0 Disponibles.

CREATE OR REPLACE FUNCTION public.mesa_cambio_tiene_solicitud_posterior(
  p_expediente_id UUID,
  p_after TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT TRUE
    FROM public.action_log al
    WHERE al.action = 'cliente_datos.revision.update'
      AND al.entity_type = 'cliente_datos'
      AND al.entity_id = p_expediente_id
      AND coalesce(al.payload->>'estado_nuevo', '') = 'rechazado'
      AND al.created_at > p_after
    LIMIT 1
  ), FALSE)
  OR COALESCE((
    SELECT TRUE
    FROM public.documento_revisiones dr
    WHERE dr.expediente_id = p_expediente_id
      AND dr.estatus_nuevo::text = 'rechazado'
      AND dr.created_at > p_after
    LIMIT 1
  ), FALSE)
  OR COALESCE((
    SELECT TRUE
    FROM public.expediente_rechazos_operativos ro
    WHERE ro.expediente_id = p_expediente_id
      AND ro.created_at > p_after
    LIMIT 1
  ), FALSE);
$$;

DROP FUNCTION IF EXISTS public.mesa_cambio_tiene_cierre_canonico(UUID, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.mesa_cambio_request_document_kind(
  p_expediente_id UUID,
  p_request_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT d.tipo_documento::text
  FROM public.documento_revisiones dr
  INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
  WHERE dr.expediente_id = p_expediente_id
    AND dr.estatus_nuevo::text = 'rechazado'
    AND p_request_at IS NOT NULL
    AND dr.created_at = p_request_at
  ORDER BY d.tipo_documento::text
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.mesa_cambio_tiene_cierre_canonico(
  p_expediente_id UUID,
  p_after TIMESTAMPTZ,
  p_request_type TEXT,
  p_request_at TIMESTAMPTZ DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_envio TIMESTAMPTZ;
  v_kind TEXT;
  v_type TEXT := coalesce(p_request_type, '');
BEGIN
  IF p_after IS NULL OR p_expediente_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT e.fecha_envio_mesa INTO v_envio
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  -- Cierre de ciclo anterior no cierra el episodio actual.
  IF v_type = 'RECHAZO_OPERATIVO_CON_CORRECCION' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.expediente_rechazo_reactivaciones r
      INNER JOIN public.expediente_rechazos_operativos ro ON ro.id = r.rechazo_id
      WHERE r.expediente_id = p_expediente_id
        AND r.created_at > p_after
        AND (v_envio IS NULL OR r.created_at >= v_envio)
        AND (v_envio IS NULL OR ro.created_at >= v_envio)
    );
  END IF;

  IF v_type = 'SOLICITUD_DATOS_GENERALES' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.action_log al
      WHERE al.action = 'cliente_datos.revision.update'
        AND al.entity_type = 'cliente_datos'
        AND al.entity_id = p_expediente_id
        AND coalesce(al.payload->>'estado_nuevo', '') = 'validado'
        AND al.created_at > p_after
        AND (v_envio IS NULL OR al.created_at >= v_envio)
    );
  END IF;

  IF v_type = 'SOLICITUD_DOCUMENTAL' THEN
    v_kind := public.mesa_cambio_request_document_kind(p_expediente_id, p_request_at);
    IF v_kind IS NULL THEN
      RETURN FALSE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.documento_revisiones dr
      INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
      WHERE dr.expediente_id = p_expediente_id
        AND dr.estatus_nuevo::text = 'validado'
        AND dr.created_at > p_after
        AND (v_envio IS NULL OR dr.created_at >= v_envio)
        AND d.tipo_documento::text IS NOT DISTINCT FROM v_kind
    );
  END IF;

  -- ADVISOR_UPDATE / sin request: DG del ciclo, o el document_kind del lote P130.
  -- No cierra por un documento ajeno al lote.
  RETURN EXISTS (
    SELECT 1
    FROM public.action_log al
    WHERE al.action = 'cliente_datos.revision.update'
      AND al.entity_type = 'cliente_datos'
      AND al.entity_id = p_expediente_id
      AND coalesce(al.payload->>'estado_nuevo', '') = 'validado'
      AND al.created_at > p_after
      AND (v_envio IS NULL OR al.created_at >= v_envio)
  ) OR EXISTS (
    SELECT 1
    FROM public.documento_revisiones dr
    INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
    INNER JOIN public.expediente_asesor_cambios ch ON ch.lote_id = p_batch_id
    WHERE p_batch_id IS NOT NULL
      AND dr.expediente_id = p_expediente_id
      AND dr.estatus_nuevo::text = 'validado'
      AND dr.created_at > p_after
      AND (v_envio IS NULL OR dr.created_at >= v_envio)
      AND ch.document_kind IS NOT NULL
      AND d.tipo_documento::text IS NOT DISTINCT FROM ch.document_kind
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mesa_cambio_revision_estado_efectivo(
  p_expediente_id UUID
)
RETURNS TABLE (
  estado TEXT,
  origin TEXT,
  request_type TEXT,
  request_at TIMESTAMPTZ,
  batch_id UUID,
  batch_submitted_at TIMESTAMPTZ,
  actionable_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cls RECORD;
  v_flags RECORD;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.origin, c.request_type, c.request_at, c.batch_submitted_at, c.batch_id
  INTO v_cls
  FROM public.mesa_cambio_revision_clasificacion(p_expediente_id) c
  LIMIT 1;

  IF v_cls.batch_id IS NOT NULL AND v_cls.batch_submitted_at IS NOT NULL THEN
    IF public.mesa_cambio_tiene_solicitud_posterior(
      p_expediente_id, v_cls.batch_submitted_at
    ) THEN
      estado := 'WAITING_ADVISOR';
      origin := v_cls.origin;
      request_type := v_cls.request_type;
      request_at := v_cls.request_at;
      batch_id := v_cls.batch_id;
      batch_submitted_at := v_cls.batch_submitted_at;
      actionable_at := COALESCE(
        (
          SELECT max(x.ts)
          FROM (
            SELECT max(al.created_at) AS ts
            FROM public.action_log al
            WHERE al.action = 'cliente_datos.revision.update'
              AND al.entity_type = 'cliente_datos'
              AND al.entity_id = p_expediente_id
              AND coalesce(al.payload->>'estado_nuevo', '') = 'rechazado'
              AND al.created_at > v_cls.batch_submitted_at
            UNION ALL
            SELECT max(dr.created_at)
            FROM public.documento_revisiones dr
            WHERE dr.expediente_id = p_expediente_id
              AND dr.estatus_nuevo::text = 'rechazado'
              AND dr.created_at > v_cls.batch_submitted_at
            UNION ALL
            SELECT max(ro.created_at)
            FROM public.expediente_rechazos_operativos ro
            WHERE ro.expediente_id = p_expediente_id
              AND ro.created_at > v_cls.batch_submitted_at
          ) x
        ),
        v_cls.batch_submitted_at
      );
      RETURN NEXT;
      RETURN;
    END IF;

    IF public.mesa_cambio_tiene_cierre_canonico(
      p_expediente_id,
      v_cls.batch_submitted_at,
      v_cls.request_type,
      v_cls.request_at,
      v_cls.batch_id
    ) THEN
      estado := 'CLOSED';
      origin := v_cls.origin;
      request_type := v_cls.request_type;
      request_at := v_cls.request_at;
      batch_id := v_cls.batch_id;
      batch_submitted_at := v_cls.batch_submitted_at;
      actionable_at := v_cls.batch_submitted_at;
      RETURN NEXT;
      RETURN;
    END IF;

    IF v_cls.origin = 'REQUESTED_CORRECTION' THEN
      estado := 'CORRECTION_PENDING_REVIEW';
    ELSE
      estado := 'ADVISOR_UPDATE_PENDING_REVIEW';
    END IF;
    origin := v_cls.origin;
    request_type := v_cls.request_type;
    request_at := v_cls.request_at;
    batch_id := v_cls.batch_id;
    batch_submitted_at := v_cls.batch_submitted_at;
    actionable_at := v_cls.batch_submitted_at;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT f.unanswered
  INTO v_flags
  FROM public.mesa_correccion_episodio_flags(p_expediente_id) f
  LIMIT 1;

  IF coalesce(v_flags.unanswered, FALSE) THEN
    estado := 'WAITING_ADVISOR';
    origin := NULL;
    request_type := NULL;
    request_at := NULL;
    batch_id := NULL;
    batch_submitted_at := NULL;
    actionable_at := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Fallback histórico P193: LEGACY/AMBIGUOUS reportable, no es cierre canónico.
  IF v_cls.origin IN ('LEGACY', 'AMBIGUOUS') THEN
    estado := 'ADVISOR_UPDATE_PENDING_REVIEW';
    origin := v_cls.origin;
    request_type := v_cls.request_type;
    request_at := v_cls.request_at;
    batch_id := v_cls.batch_id;
    batch_submitted_at := v_cls.batch_submitted_at;
    actionable_at := v_cls.batch_submitted_at;
    RETURN NEXT;
    RETURN;
  END IF;

  estado := 'CLOSED';
  origin := v_cls.origin;
  request_type := v_cls.request_type;
  request_at := v_cls.request_at;
  batch_id := NULL;
  batch_submitted_at := NULL;
  actionable_at := NULL;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.mesa_cambio_revision_estado_efectivo(UUID) IS
  'P198: cola Mesa de cambios = episodio actual. RAW lote pendiente no implica trabajo pendiente. STABLE. Sin PII.';

REVOKE ALL ON FUNCTION public.mesa_cambio_tiene_solicitud_posterior(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_tiene_solicitud_posterior(UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_tiene_solicitud_posterior(UUID, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.mesa_cambio_request_document_kind(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_request_document_kind(UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_request_document_kind(UUID, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.mesa_cambio_tiene_cierre_canonico(UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_tiene_cierre_canonico(UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_tiene_cierre_canonico(UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.mesa_cambio_revision_estado_efectivo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_revision_estado_efectivo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_revision_estado_efectivo(UUID) TO authenticated;


-- ConCasa CRM — P198 (cont): mesa_list_bandeja_page consume estado efectivo.
-- Predicado Disponibles (sin_asignar) IDÉNTICO a P195.

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
      (
        SELECT to_jsonb(t)
        FROM public.mesa_cambio_revision_clasificacion(en.id) t
        LIMIT 1
      ) AS cambio_cls,
      (
        SELECT to_jsonb(t)
        FROM public.mesa_cambio_revision_estado_efectivo(en.id) t
        LIMIT 1
      ) AS cambio_eff
    FROM enriched en
  ),
  filtered AS (
    SELECT cl.*
    FROM classified cl
    WHERE
      CASE v_quick
        WHEN 'todos' THEN cl.ciclo_estado = 'activo'
        WHEN 'correccion_enviada' THEN
          cl.ciclo_estado = 'activo'
          AND cl.cambio_eff->>'estado' IN (
            'CORRECTION_PENDING_REVIEW', 'ADVISOR_UPDATE_PENDING_REVIEW'
          )
        WHEN 'correccion_solicitada' THEN
          cl.ciclo_estado = 'activo'
          AND cl.cambio_eff->>'estado' = 'CORRECTION_PENDING_REVIEW'
        WHEN 'otras_actualizaciones' THEN
          cl.ciclo_estado = 'activo'
          AND cl.cambio_eff->>'estado' = 'ADVISOR_UPDATE_PENDING_REVIEW'
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
        WHEN 'en_espera_asesor' THEN
          cl.categoria = 'correccion_requerida'
          OR cl.cambio_eff->>'estado' = 'WAITING_ADVISOR'
        WHEN 'sin_asignar' THEN
          cl.ciclo_estado = 'activo'
          AND cl.subestado IS DISTINCT FROM 'rechazado'
          AND cl.assigned_to IS NULL
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
            'cambio_revision_origen', coalesce(p.cambio_eff->>'origin', p.cambio_cls->>'origin'),
            'cambio_request_type', coalesce(p.cambio_eff->>'request_type', p.cambio_cls->>'request_type'),
            'cambio_request_at', coalesce(p.cambio_eff->>'request_at', p.cambio_cls->>'request_at'),
            'cambio_revision_estado', p.cambio_eff->>'estado',
            'cambio_actionable_at', p.cambio_eff->>'actionable_at',
            'cambio_batch_id', p.cambio_eff->>'batch_id'
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
        WHERE ciclo_estado = 'activo'
          AND cambio_estado IN ('CORRECTION_PENDING_REVIEW', 'ADVISOR_UPDATE_PENDING_REVIEW')
      ),
      'correccionesSolicitadas', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND cambio_estado = 'CORRECTION_PENDING_REVIEW'
      ),
      'otrasActualizaciones', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND cambio_estado = 'ADVISOR_UPDATE_PENDING_REVIEW'
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
        WHERE ciclo_estado = 'activo'
          AND (
            categoria = 'correccion_requerida'
            OR cambio_estado = 'WAITING_ADVISOR'
          )
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
        (
          SELECT t.estado
          FROM public.mesa_cambio_revision_estado_efectivo(c0.id) t
          LIMIT 1
        ) AS cambio_estado
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
  'P198: filtros de cambios usan estado efectivo. Disponibles P195 intacto. Sin writers.';

REVOKE ALL ON FUNCTION public.mesa_list_bandeja_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesa_list_bandeja_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;
