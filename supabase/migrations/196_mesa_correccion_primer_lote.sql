-- ConCasa CRM — P196: una solicitud Mesa pertenece al primer lote P130 posterior.
-- Cloud max conocido = 195. 196 = este read-model. Operación de citas → 197.
-- REPLACE de mesa_cambio_revision_clasificacion. Sin tablas, writers, backfill.
-- NO toca mesa_list_bandeja_page / Disponibles / categoria P192 / mark-revisado.

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
  v_prior_submitted TIMESTAMPTZ;
  v_has_prior BOOLEAN;
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

  SELECT l.submitted_at
  INTO v_prior_submitted
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.expediente_id = p_expediente_id
    AND l.id IS DISTINCT FROM v_lote_id
    AND l.submitted_at IS NOT NULL
    AND l.submitted_at < v_submitted
  ORDER BY l.submitted_at DESC, l.created_at DESC, l.id DESC
  LIMIT 1;

  v_has_prior := (v_prior_submitted IS NOT NULL);

  IF (NOT v_has_prior) AND v_envio IS NOT NULL AND v_submitted < v_envio THEN
    origin := 'AMBIGUOUS';
    request_type := NULL;
    request_at := NULL;
    batch_submitted_at := v_submitted;
    batch_id := v_lote_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Solicitud vigente no consumida: más reciente del ciclo actual,
  -- anterior al lote L, y L es el primer envío P130 posterior a ella.
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
      AND (v_envio IS NULL OR al.created_at >= v_envio)
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.expediente_asesor_cambio_lotes lmid
        WHERE lmid.expediente_id = p_expediente_id
          AND lmid.id IS DISTINCT FROM v_lote_id
          AND lmid.submitted_at IS NOT NULL
          AND lmid.submitted_at > al.created_at
          AND lmid.submitted_at < v_submitted
      )
    UNION ALL
    SELECT
      'SOLICITUD_DOCUMENTAL'::text,
      dr.created_at
    FROM public.documento_revisiones dr
    INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
    WHERE dr.expediente_id = p_expediente_id
      AND dr.estatus_nuevo::text = 'rechazado'
      AND (v_envio IS NULL OR dr.created_at >= v_envio)
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.expediente_asesor_cambio_lotes lmid
        WHERE lmid.expediente_id = p_expediente_id
          AND lmid.id IS DISTINCT FROM v_lote_id
          AND lmid.submitted_at IS NOT NULL
          AND lmid.submitted_at > dr.created_at
          AND lmid.submitted_at < v_submitted
      )
    UNION ALL
    SELECT
      'RECHAZO_OPERATIVO_CON_CORRECCION'::text,
      ro.created_at
    FROM public.expediente_rechazos_operativos ro
    WHERE ro.expediente_id = p_expediente_id
      AND (v_envio IS NULL OR ro.created_at >= v_envio)
      AND ro.created_at < v_submitted
      AND NOT EXISTS (
        SELECT 1
        FROM public.expediente_rechazo_reactivaciones x
        WHERE x.rechazo_id = ro.id
          AND x.created_at < v_submitted
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.expediente_asesor_cambio_lotes lmid
        WHERE lmid.expediente_id = p_expediente_id
          AND lmid.id IS DISTINCT FROM v_lote_id
          AND lmid.submitted_at IS NOT NULL
          AND lmid.submitted_at > ro.created_at
          AND lmid.submitted_at < v_submitted
      )
  ) x
  ORDER BY x.request_at DESC, x.request_type ASC
  LIMIT 1;

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
  'P196: REQUESTED_CORRECTION solo si L es el primer lote P130 posterior a una solicitud Mesa abierta del ciclo actual. STABLE. Sin PII. Sin persistir.';

REVOKE ALL ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) TO authenticated;
