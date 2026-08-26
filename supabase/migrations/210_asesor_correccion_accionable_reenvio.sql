-- ConCasa CRM — P210: corrección accionable asesor (motivo causal + reenvío explícito).
-- Cloud max = 209. 210 = read-model + RPC reenvío + lote respuesta P130.
-- NO modifica asesor_cambio_ensure_open_lote (P130 histórico intacto).

-- Tipo explícito para respuesta ACK (no reutilizar campo_actualizado).
DO $$ BEGIN
  ALTER TYPE public.asesor_cambio_tipo ADD VALUE IF NOT EXISTS 'correccion_respuesta';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- Helpers internos: actividad post-solicitud (evidencia auditable, NO action_log)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_correccion_has_dg_activity_after(
  p_expediente_id UUID,
  p_request_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT TRUE
    FROM public.expediente_asesor_cambios c
    INNER JOIN public.expediente_asesor_cambio_lotes l ON l.id = c.lote_id
    WHERE l.expediente_id = p_expediente_id
      AND c.created_at > p_request_at
      AND (
        c.entidad IN ('cliente_datos', 'expediente')
        OR c.tipo IN (
          'documento_reemplazado'::public.asesor_cambio_tipo,
          'documento_agregado'::public.asesor_cambio_tipo
        )
      )
    LIMIT 1
  ), FALSE)
  OR COALESCE((
    SELECT TRUE
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND d.deleted_at IS NULL
      AND d.created_at > p_request_at
    LIMIT 1
  ), FALSE);
$$;

COMMENT ON FUNCTION public.asesor_correccion_has_dg_activity_after(UUID, TIMESTAMPTZ) IS
  'P210: actividad DG post-request = cambio P130 auditable o documento nuevo/reemplazado. NO action_log.';

CREATE OR REPLACE FUNCTION public.asesor_correccion_doc_atendido_after(
  p_expediente_id UUID,
  p_document_kind TEXT,
  p_request_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT TRUE
    FROM public.expediente_asesor_cambios c
    INNER JOIN public.expediente_asesor_cambio_lotes l ON l.id = c.lote_id
    WHERE l.expediente_id = p_expediente_id
      AND c.document_kind IS NOT DISTINCT FROM p_document_kind
      AND c.tipo IN (
        'documento_reemplazado'::public.asesor_cambio_tipo,
        'documento_agregado'::public.asesor_cambio_tipo
      )
      AND c.created_at > p_request_at
    LIMIT 1
  ), FALSE)
  OR COALESCE((
    SELECT TRUE
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND d.tipo_documento IS NOT DISTINCT FROM p_document_kind
      AND d.deleted_at IS NULL
      AND d.created_at > p_request_at
    LIMIT 1
  ), FALSE);
$$;

COMMENT ON FUNCTION public.asesor_correccion_doc_atendido_after(UUID, TEXT, TIMESTAMPTZ) IS
  'P210: reemplazo/agregado estructurado del document_kind post-request.';

CREATE OR REPLACE FUNCTION public.asesor_correccion_has_activity_after(
  p_expediente_id UUID,
  p_request_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.asesor_correccion_has_dg_activity_after(p_expediente_id, p_request_at)
  OR COALESCE((
    SELECT TRUE
    FROM public.expediente_asesor_cambios c
    INNER JOIN public.expediente_asesor_cambio_lotes l ON l.id = c.lote_id
    WHERE l.expediente_id = p_expediente_id
      AND c.created_at > p_request_at
    LIMIT 1
  ), FALSE);
$$;

-- =============================================================================
-- Items causales abiertos (episodio actual)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_correccion_items_abiertos(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_envio TIMESTAMPTZ;
  v_p198_estado TEXT;
  v_p198_request_type TEXT;
  v_request_at TIMESTAMPTZ;
  v_items JSONB := '[]'::jsonb;
  v_doc RECORD;
  v_dg_at TIMESTAMPTZ;
  v_dg_motivo TEXT;
  v_ret_motivo TEXT;
  v_local TEXT;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT e.fecha_envio_mesa INTO v_envio
  FROM public.expedientes e WHERE e.id = p_expediente_id;

  SELECT s.estado, s.request_type, s.request_at
  INTO v_p198_estado, v_p198_request_type, v_request_at
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  IF v_request_at IS NULL THEN
    SELECT t.latest_request_at, t.latest_request_type
    INTO v_request_at, v_p198_request_type
    FROM public.mesa_cambio_episodio_latest(p_expediente_id) t
    LIMIT 1;
  END IF;

  -- DG abierto (misma autoridad P209 + comentario causal)
  IF v_p198_estado = 'WAITING_ADVISOR'
     AND v_p198_request_type IS DISTINCT FROM 'RECHAZO_OPERATIVO_CON_CORRECCION' THEN

    SELECT al.created_at,
           NULLIF(btrim(coalesce(al.payload->>'comentario_rechazo', '')), '')
    INTO v_dg_at, v_dg_motivo
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
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT 1;

    IF v_dg_at IS NOT NULL THEN
      v_local := CASE
        WHEN v_request_at IS NOT NULL
          AND public.asesor_correccion_has_dg_activity_after(p_expediente_id, v_request_at)
        THEN 'corregido_guardado'
        ELSE 'pendiente'
      END;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'type', 'datos_generales',
        'key', 'datos_generales',
        'label', 'Datos generales',
        'motivo', coalesce(
          v_dg_motivo,
          'Motivo específico no disponible. Revisa la sección indicada o contacta a Mesa.'
        ),
        'requested_at', v_dg_at,
        'action_target', 'datos_generales',
        'local_status', v_local
      ));
    END IF;

    FOR v_doc IN
      SELECT x.tipo_documento, x.comentario_mesa, x.rej_at
      FROM (
        SELECT DISTINCT ON (d.tipo_documento)
          d.tipo_documento,
          NULLIF(btrim(coalesce(dr.comentario_mesa, '')), '') AS comentario_mesa,
          dr.created_at AS rej_at
        FROM public.documento_revisiones dr
        INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
        WHERE dr.expediente_id = p_expediente_id
          AND dr.estatus_nuevo::text = 'rechazado'
          AND (v_envio IS NULL OR dr.created_at >= v_envio)
          AND d.deleted_at IS NULL
        ORDER BY d.tipo_documento, dr.created_at DESC, dr.id DESC
      ) x
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.documento_revisiones dr2
        INNER JOIN public.expediente_documentos d2 ON d2.id = dr2.documento_id
        WHERE dr2.expediente_id = p_expediente_id
          AND dr2.estatus_nuevo::text = 'validado'
          AND d2.tipo_documento IS NOT DISTINCT FROM x.tipo_documento
          AND dr2.created_at > x.rej_at
      )
      ORDER BY x.tipo_documento
    LOOP
      v_local := CASE
        WHEN v_request_at IS NOT NULL
          AND public.asesor_correccion_doc_atendido_after(
            p_expediente_id, v_doc.tipo_documento, v_request_at
          )
        THEN 'reemplazado'
        ELSE 'pendiente'
      END;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'type', CASE
          WHEN v_doc.tipo_documento LIKE 'retencion_%' THEN 'retencion'
          ELSE 'documento'
        END,
        'key', v_doc.tipo_documento,
        'label', public.asesor_cambio_doc_label(v_doc.tipo_documento),
        'motivo', coalesce(
          v_doc.comentario_mesa,
          'Motivo específico no disponible. Revisa la sección indicada o contacta a Mesa.'
        ),
        'requested_at', v_doc.rej_at,
        'action_target', v_doc.tipo_documento,
        'local_status', v_local
      ));
    END LOOP;
  END IF;

  IF jsonb_array_length(v_items) = 0
     AND public.asesor_inbox_retencion_correccion_abierta(p_expediente_id) THEN
    SELECT NULLIF(btrim(coalesce(dr.comentario_mesa, '')), '')
    INTO v_ret_motivo
    FROM public.documento_revisiones dr
    INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
    WHERE dr.expediente_id = p_expediente_id
      AND d.tipo_documento LIKE 'retencion_%'
      AND dr.estatus_nuevo::text = 'rechazado'
      AND d.deleted_at IS NULL
    ORDER BY dr.created_at DESC, dr.id DESC
    LIMIT 1;

    v_local := CASE
      WHEN v_request_at IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.expediente_asesor_cambios c
          INNER JOIN public.expediente_asesor_cambio_lotes l ON l.id = c.lote_id
          WHERE l.expediente_id = p_expediente_id
            AND c.document_kind LIKE 'retencion_%'
            AND c.created_at > v_request_at
        )
      THEN 'reemplazado'
      ELSE 'pendiente'
    END;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'type', 'retencion',
      'key', 'retencion',
      'label', 'Retención',
      'motivo', coalesce(
        v_ret_motivo,
        'Motivo específico no disponible. Revisa la sección indicada o contacta a Mesa.'
      ),
      'requested_at', v_request_at,
      'action_target', 'retencion',
      'local_status', v_local
    ));
  END IF;

  RETURN v_items;
END;
$$;

COMMENT ON FUNCTION public.asesor_correccion_items_abiertos(UUID) IS
  'P210: items causales abiertos con motivo histórico (action_log / documento_revisiones).';

REVOKE ALL ON FUNCTION public.asesor_correccion_items_abiertos(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_correccion_items_abiertos(UUID) TO authenticated;

-- =============================================================================
-- Readiness / UX state
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_correccion_compute_readiness(
  p_expediente_id UUID,
  p_items JSONB,
  p_request_at TIMESTAMPTZ,
  p_p198_estado TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_activity BOOLEAN := FALSE;
  v_has_response BOOLEAN := FALSE;
  v_needs_resubmit BOOLEAN := FALSE;
  v_can BOOLEAN := FALSE;
  v_ux TEXT;
  v_blocking JSONB := '[]'::jsonb;
  v_item JSONB;
  v_latest RECORD;
BEGIN
  IF p_request_at IS NOT NULL THEN
    v_has_activity := public.asesor_correccion_has_activity_after(
      p_expediente_id, p_request_at
    );
    SELECT t.latest_response_at INTO v_latest
    FROM public.mesa_cambio_episodio_latest(p_expediente_id) t
    LIMIT 1;
    v_has_response := (
      v_latest.latest_response_at IS NOT NULL
      AND v_latest.latest_response_at > p_request_at
    );
  END IF;

  IF p_p198_estado = 'CORRECTION_PENDING_REVIEW'
     OR (
       v_has_response
       AND p_p198_estado IS DISTINCT FROM 'WAITING_ADVISOR'
     ) THEN
    v_ux := 'CORRECCION_ENVIADA';
    v_needs_resubmit := FALSE;
    v_can := FALSE;
  ELSIF p_p198_estado = 'WAITING_ADVISOR' THEN
    v_needs_resubmit := NOT v_has_response;
    IF v_has_activity AND NOT v_has_response THEN
      v_ux := 'CAMBIOS_GUARDADOS_SIN_ENVIAR';
    ELSE
      v_ux := 'PENDIENTE_DE_CORREGIR';
    END IF;

    IF NOT v_has_activity THEN
      v_blocking := v_blocking || jsonb_build_array(
        'Primero realiza y guarda la corrección solicitada.'
      );
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    LOOP
      IF (v_item->>'type') IN ('documento', 'retencion')
         AND coalesce(v_item->>'local_status', '') <> 'reemplazado' THEN
        v_blocking := v_blocking || jsonb_build_array(
          'Primero reemplaza: ' || coalesce(v_item->>'label', 'documento') || '.'
        );
      END IF;
    END LOOP;

    v_can := v_needs_resubmit
      AND v_has_activity
      AND jsonb_array_length(v_blocking) = 0;
  ELSE
    v_ux := NULL;
    v_can := FALSE;
  END IF;

  RETURN jsonb_build_object(
    'has_correction_activity_after_request', v_has_activity,
    'has_response_after_request', v_has_response,
    'needs_resubmit', v_needs_resubmit,
    'can_resubmit', v_can,
    'ux_state', v_ux,
    'blocking_reasons', v_blocking
  );
END;
$$;

-- =============================================================================
-- Detalle causal (detalle expediente)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_correccion_detalle(
  p_expediente_id UUID
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
  v_asesor_id UUID;
  v_items JSONB;
  v_p198 RECORD;
  v_readiness JSONB;
  v_eff TEXT;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_correccion_detalle: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active INTO v_role, v_active
  FROM public.profiles p WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'asesor_correccion_detalle: perfil inactivo'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.asesor_id INTO v_asesor_id
  FROM public.expedientes e
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL;

  IF NOT FOUND OR NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_correccion_detalle: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'asesor' AND v_asesor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'asesor_correccion_detalle: solo asesor dueño'
      USING ERRCODE = '42501';
  END IF;

  v_eff := public.asesor_inbox_estado_efectivo(p_expediente_id);
  IF v_eff NOT IN ('correccion_requerida', 'correccion_enviada') THEN
    RETURN NULL;
  END IF;

  SELECT s.estado, s.request_type, s.request_at
  INTO v_p198
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  v_items := public.asesor_correccion_items_abiertos(p_expediente_id);
  v_readiness := public.asesor_correccion_compute_readiness(
    p_expediente_id, v_items, v_p198.request_at, v_p198.estado
  );

  RETURN jsonb_build_object(
    'estado', coalesce(v_p198.estado, 'WAITING_ADVISOR'),
    'request_type', v_p198.request_type,
    'request_at', v_p198.request_at,
    'items', coalesce(v_items, '[]'::jsonb),
    'has_correction_activity_after_request',
      coalesce((v_readiness->>'has_correction_activity_after_request')::boolean, false),
    'has_response_after_request',
      coalesce((v_readiness->>'has_response_after_request')::boolean, false),
    'needs_resubmit',
      coalesce((v_readiness->>'needs_resubmit')::boolean, false),
    'can_resubmit',
      coalesce((v_readiness->>'can_resubmit')::boolean, false),
    'ux_state', v_readiness->>'ux_state',
    'blocking_reasons', coalesce(v_readiness->'blocking_reasons', '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_correccion_detalle(UUID) IS
  'P210: read-model causal detalle asesor (motivo exacto + readiness reenvío).';

REVOKE ALL ON FUNCTION public.asesor_correccion_detalle(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_correccion_detalle(UUID) TO authenticated;

-- =============================================================================
-- Resumen inbox (first paint, compatible P209)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_inbox_correccion_resumen(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
  v_labels TEXT[] := ARRAY[]::TEXT[];
  v_first_motivo TEXT;
  v_item JSONB;
  v_p198 RECORD;
  v_readiness JSONB;
  v_n INT;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF public.asesor_inbox_estado_efectivo(p_expediente_id) IS DISTINCT FROM 'correccion_requerida' THEN
    RETURN NULL;
  END IF;

  v_items := public.asesor_correccion_items_abiertos(p_expediente_id);
  v_n := coalesce(jsonb_array_length(v_items), 0);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_labels := array_append(v_labels, v_item->>'label');
    IF v_first_motivo IS NULL AND NULLIF(btrim(v_item->>'motivo'), '') IS NOT NULL THEN
      v_first_motivo := v_item->>'motivo';
    END IF;
  END LOOP;

  SELECT s.estado, s.request_at INTO v_p198
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  v_readiness := public.asesor_correccion_compute_readiness(
    p_expediente_id, v_items, v_p198.request_at, v_p198.estado
  );

  RETURN jsonb_build_object(
    'count', v_n,
    'labels', to_jsonb(v_labels),
    'first_motivo', v_first_motivo,
    'ux_state', v_readiness->>'ux_state'
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_correccion_resumen(UUID) IS
  'P210: resumen compacto inbox (labels + primer motivo + ux_state).';

REVOKE ALL ON FUNCTION public.asesor_inbox_correccion_resumen(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_correccion_resumen(UUID) TO authenticated;

-- =============================================================================
-- P130: lote de respuesta NUEVO (NO toca ensure_open_lote)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_cambio_create_response_lote(
  p_organization_id UUID,
  p_expediente_id UUID,
  p_asesor_id UUID,
  p_request_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_lote_id UUID;
BEGIN
  IF p_organization_id IS NULL OR p_expediente_id IS NULL OR p_asesor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_cambio_create_response_lote: parámetros obligatorios'
      USING ERRCODE = '22023';
  END IF;

  IF p_request_at IS NULL THEN
    RAISE EXCEPTION 'asesor_cambio_create_response_lote: request_at obligatorio'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotencia: respuesta pendiente ya posterior al request.
  SELECT l.id INTO v_existing
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.expediente_id = p_expediente_id
    AND l.status = 'pendiente_revision'
    AND l.submitted_at IS NOT NULL
    AND l.submitted_at > p_request_at
  ORDER BY l.submitted_at DESC, l.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Nunca reutilizar lote pre-request.
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id,
    expediente_id,
    asesor_id,
    correccion_ciclo_key,
    status
  ) VALUES (
    p_organization_id,
    p_expediente_id,
    p_asesor_id,
    'post_mesa',
    'borrador'
  )
  RETURNING id INTO v_lote_id;

  RETURN v_lote_id;
END;
$$;

COMMENT ON FUNCTION public.asesor_cambio_create_response_lote(UUID, UUID, UUID, TIMESTAMPTZ) IS
  'P210: lote NUEVO para respuesta Mesa vigente. NO reutiliza pending pre-request.';

REVOKE ALL ON FUNCTION public.asesor_cambio_create_response_lote(UUID, UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.asesor_cambio_submit_response_lote(
  p_lote_id UUID,
  p_request_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submitted TIMESTAMPTZ;
  v_n INT;
BEGIN
  IF p_lote_id IS NULL THEN
    RAISE EXCEPTION 'asesor_cambio_submit_response_lote: lote_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::int INTO v_n
  FROM public.expediente_asesor_cambios c
  WHERE c.lote_id = p_lote_id;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'asesor_cambio_submit_response_lote: lote vacío (sin evidencia auditable)'
      USING ERRCODE = '22023';
  END IF;

  v_submitted := NOW();

  IF p_request_at IS NOT NULL AND v_submitted <= p_request_at THEN
    v_submitted := p_request_at + interval '1 millisecond';
  END IF;

  UPDATE public.expediente_asesor_cambio_lotes
  SET
    status = 'pendiente_revision',
    submitted_at = v_submitted,
    reviewed_by = NULL,
    reviewed_at = NULL,
    updated_at = NOW()
  WHERE id = p_lote_id
    AND status IN ('borrador', 'pendiente_revision');

  RETURN v_submitted;
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_cambio_submit_response_lote(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.asesor_cambio_copy_post_request_cambios(
  p_expediente_id UUID,
  p_target_lote_id UUID,
  p_request_at TIMESTAMPTZ
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INT := 0;
  v_c RECORD;
BEGIN
  FOR v_c IN
    SELECT c.*
    FROM public.expediente_asesor_cambios c
    INNER JOIN public.expediente_asesor_cambio_lotes l ON l.id = c.lote_id
    WHERE l.expediente_id = p_expediente_id
      AND c.lote_id IS DISTINCT FROM p_target_lote_id
      AND c.created_at > p_request_at
    ORDER BY c.created_at ASC, c.id ASC
  LOOP
    INSERT INTO public.expediente_asesor_cambios (
      lote_id,
      change_key,
      tipo,
      entidad,
      campo,
      document_kind,
      label,
      valor_anterior,
      valor_nuevo,
      documento_anterior_id,
      documento_nuevo_id
    ) VALUES (
      p_target_lote_id,
      v_c.change_key,
      v_c.tipo,
      v_c.entidad,
      v_c.campo,
      v_c.document_kind,
      v_c.label,
      v_c.valor_anterior,
      v_c.valor_nuevo,
      v_c.documento_anterior_id,
      v_c.documento_nuevo_id
    )
    ON CONFLICT (lote_id, change_key) DO UPDATE SET
      tipo = EXCLUDED.tipo,
      valor_nuevo = EXCLUDED.valor_nuevo,
      documento_nuevo_id = EXCLUDED.documento_nuevo_id,
      label = EXCLUDED.label;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_cambio_copy_post_request_cambios(UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.asesor_cambio_record_correccion_ack(
  p_lote_id UUID,
  p_request_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.asesor_cambio_upsert(
    p_lote_id,
    'response:ack:' || coalesce(p_request_at::text, 'unknown'),
    'correccion_respuesta'::public.asesor_cambio_tipo,
    'asesor_correccion_respuesta',
    'acknowledgement',
    NULL,
    'Asesor confirmó corrección solicitada por Mesa',
    NULL,
    jsonb_build_object(
      'request_at', p_request_at,
      'source', 'asesor_reenviar_correccion_a_mesa',
      'kind', 'correccion_respuesta'
    ),
    NULL,
    NULL
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_cambio_record_correccion_ack(UUID, TIMESTAMPTZ) IS
  'P210: ACK explícito (tipo correccion_respuesta). Sin valor_anterior ni campo DG fingido.';

REVOKE ALL ON FUNCTION public.asesor_cambio_record_correccion_ack(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- RPC reenvío explícito
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_reenviar_correccion_a_mesa(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_active BOOLEAN;
  v_exp RECORD;
  v_p198 RECORD;
  v_p198_post TEXT;
  v_detalle JSONB;
  v_lote_id UUID;
  v_copied INT;
  v_submitted TIMESTAMPTZ;
  v_latest RECORD;
BEGIN
  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: expediente_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active INTO v_role, v_active
  FROM public.profiles p WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('asesor_reenviar_correccion:' || p_expediente_id::text)
  );

  SELECT e.id, e.organization_id, e.asesor_id, e.submitted_to_mesa, e.ciclo_estado::text
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: solo asesor dueño'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: expediente no activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.estado, s.request_type, s.request_at
  INTO v_p198
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  IF v_p198.estado IS DISTINCT FROM 'WAITING_ADVISOR' THEN
    SELECT t.latest_response_at, t.latest_batch_id
    INTO v_latest
    FROM public.mesa_cambio_episodio_latest(p_expediente_id) t
    LIMIT 1;

    IF v_p198.estado = 'CORRECTION_PENDING_REVIEW'
       OR (
         v_p198.request_at IS NOT NULL
         AND v_latest.latest_response_at IS NOT NULL
         AND v_latest.latest_response_at > v_p198.request_at
       ) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'already_submitted', true,
        'lote_id', v_latest.latest_batch_id,
        'submitted_at', v_latest.latest_response_at
      );
    END IF;

    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: no hay solicitud Mesa vigente (estado=%)',
      coalesce(v_p198.estado, 'null')
      USING ERRCODE = '22023';
  END IF;

  IF v_p198.request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION' THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: rechazo operativo usa otro flujo'
      USING ERRCODE = '22023';
  END IF;

  IF v_p198.request_at IS NULL THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: request_at ausente'
      USING ERRCODE = '22023';
  END IF;

  v_detalle := public.asesor_correccion_detalle(p_expediente_id);
  IF coalesce((v_detalle->>'can_resubmit')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: no listo para reenviar (%).',
      coalesce(v_detalle->'blocking_reasons', '[]'::jsonb)::text
      USING ERRCODE = '22023';
  END IF;

  v_lote_id := public.asesor_cambio_create_response_lote(
    v_exp.organization_id,
    p_expediente_id,
    v_actor,
    v_p198.request_at
  );

  v_copied := public.asesor_cambio_copy_post_request_cambios(
    p_expediente_id,
    v_lote_id,
    v_p198.request_at
  );

  IF v_copied = 0 THEN
    RAISE EXCEPTION
      'asesor_reenviar_correccion_a_mesa: sin evidencia auditable post-request para el lote de respuesta'
      USING ERRCODE = '22023';
  END IF;

  v_submitted := public.asesor_cambio_submit_response_lote(v_lote_id, v_p198.request_at);

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload
  ) VALUES (
    v_exp.organization_id,
    v_actor,
    v_role,
    'asesor.correccion.reenviada_a_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'lote_id', v_lote_id,
      'request_at', v_p198.request_at,
      'request_type', v_p198.request_type,
      'submitted_at', v_submitted,
      'copied_cambios', v_copied
    )
  );

  -- P198 debe pasar a CORRECTION_PENDING_REVIEW sin UPDATE directo.
  SELECT s.estado INTO v_p198_post
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  IF v_p198_post IS DISTINCT FROM 'CORRECTION_PENDING_REVIEW' THEN
    RAISE EXCEPTION
      'asesor_reenviar_correccion_a_mesa: P198 no transicionó a CORRECTION_PENDING_REVIEW (=%)',
      coalesce(v_p198_post, 'null')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_submitted', false,
    'lote_id', v_lote_id,
    'submitted_at', v_submitted,
    'copied_cambios', v_copied
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_reenviar_correccion_a_mesa(UUID) IS
  'P210: reenvío canónico asesor → Mesa. Lote NUEVO con submitted_at > request_at. Sin UPDATE P198.';

REVOKE ALL ON FUNCTION public.asesor_reenviar_correccion_a_mesa(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_reenviar_correccion_a_mesa(UUID) TO authenticated;

-- =============================================================================
-- Listado inbox: correccion_resumen (P209 correccion_explicacion intacto)
-- =============================================================================

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
      eff.estado_efectivo,
      CASE
        WHEN eff.estado_efectivo = 'correccion_requerida'
        THEN public.asesor_inbox_format_correccion_explicacion(
          public.asesor_inbox_correccion_labels_vigentes(e.id)
        )
        ELSE NULL
      END AS correccion_explicacion,
      CASE
        WHEN eff.estado_efectivo = 'correccion_requerida'
        THEN public.asesor_inbox_correccion_resumen(e.id)
        ELSE NULL
      END AS correccion_resumen,
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
    LEFT JOIN LATERAL (
      SELECT public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo
    ) eff ON TRUE
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
      f.correccion_explicacion,
      f.correccion_resumen,
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
  'P161/P197/P209/P210: listado inbox. correccion_explicacion + correccion_resumen en first paint.';
