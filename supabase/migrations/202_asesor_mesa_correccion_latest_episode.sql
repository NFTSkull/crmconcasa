-- ConCasa CRM — P202: episodio actual = latest request vs latest response (ciclo).
-- Cloud max = 201. 202 = este read-model. NO modifica 196/198/201 históricos.
-- READ-MODEL only. 0 writers / 0 UPDATE lotes / 0 Disponibles writers / 0 agenda.

-- 1) Solicitud posterior solo dentro del ciclo actual (fecha_envio_mesa).
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
  WITH env AS (
    SELECT e.fecha_envio_mesa AS envio
    FROM public.expedientes e
    WHERE e.id = p_expediente_id
  )
  SELECT COALESCE((
    SELECT TRUE
    FROM public.action_log al, env
    WHERE al.action = 'cliente_datos.revision.update'
      AND al.entity_type = 'cliente_datos'
      AND al.entity_id = p_expediente_id
      AND coalesce(al.payload->>'estado_nuevo', '') = 'rechazado'
      AND al.created_at > p_after
      AND (env.envio IS NULL OR al.created_at >= env.envio)
    LIMIT 1
  ), FALSE)
  OR COALESCE((
    SELECT TRUE
    FROM public.documento_revisiones dr, env
    WHERE dr.expediente_id = p_expediente_id
      AND dr.estatus_nuevo::text = 'rechazado'
      AND dr.created_at > p_after
      AND (env.envio IS NULL OR dr.created_at >= env.envio)
    LIMIT 1
  ), FALSE)
  OR COALESCE((
    SELECT TRUE
    FROM public.expediente_rechazos_operativos ro, env
    WHERE ro.expediente_id = p_expediente_id
      AND ro.created_at > p_after
      AND (env.envio IS NULL OR ro.created_at >= env.envio)
    LIMIT 1
  ), FALSE);
$$;

COMMENT ON FUNCTION public.mesa_cambio_tiene_solicitud_posterior(UUID, TIMESTAMPTZ) IS
  'P198/P202: hay solicitud Mesa del ciclo actual después de p_after. Sin PII.';

-- 2) Clasificación: solo lotes P130 del ciclo actual (no pre-fecha_envio_mesa).
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
    AND (v_envio IS NULL OR l.submitted_at >= v_envio)
  ORDER BY l.submitted_at DESC, l.created_at DESC, l.id DESC
  LIMIT 1;

  -- Sin lote pendiente del ciclo: no inventar LEGACY/AMBIGUOUS con lotes pre-envio
  -- ni categoria_resumen histórica (P202: el episodio actual no cruza ciclos).
  IF v_lote_id IS NULL THEN
    RETURN;
  END IF;

  SELECT l.submitted_at
  INTO v_prior_submitted
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.expediente_id = p_expediente_id
    AND l.id IS DISTINCT FROM v_lote_id
    AND l.submitted_at IS NOT NULL
    AND l.submitted_at < v_submitted
    AND (v_envio IS NULL OR l.submitted_at >= v_envio)
  ORDER BY l.submitted_at DESC, l.created_at DESC, l.id DESC
  LIMIT 1;

  v_has_prior := (v_prior_submitted IS NOT NULL);

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
  'P196/P202: REQUESTED solo si L del ciclo es el primer lote P130 posterior a solicitud abierta. Ignora lotes pre-fecha_envio_mesa.';

-- 3) Helper temporal del episodio (ciclo actual).
-- latest_request = solicitud Mesa VIGENTE (abierta) más reciente del ciclo.
-- No cuenta rechazos ya cerrados por Mesa (DG/doc validado, ops reactivado) sin lote.
CREATE OR REPLACE FUNCTION public.mesa_cambio_episodio_latest(
  p_expediente_id UUID
)
RETURNS TABLE (
  latest_request_at TIMESTAMPTZ,
  latest_request_type TEXT,
  latest_response_at TIMESTAMPTZ,
  latest_batch_id UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH env AS (
    SELECT e.fecha_envio_mesa AS envio
    FROM public.expedientes e
    WHERE e.id = p_expediente_id
  ),
  req AS (
    SELECT x.request_at, x.request_type
    FROM (
      SELECT al.created_at AS request_at, 'SOLICITUD_DATOS_GENERALES'::text AS request_type
      FROM public.action_log al, env
      WHERE al.action = 'cliente_datos.revision.update'
        AND al.entity_type = 'cliente_datos'
        AND al.entity_id = p_expediente_id
        AND coalesce(al.payload->>'estado_nuevo', '') = 'rechazado'
        AND (env.envio IS NULL OR al.created_at >= env.envio)
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
      SELECT dr.created_at, 'SOLICITUD_DOCUMENTAL'::text
      FROM public.documento_revisiones dr
      INNER JOIN public.expediente_documentos d ON d.id = dr.documento_id
      , env
      WHERE dr.expediente_id = p_expediente_id
        AND dr.estatus_nuevo::text = 'rechazado'
        AND (env.envio IS NULL OR dr.created_at >= env.envio)
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
      SELECT ro.created_at, 'RECHAZO_OPERATIVO_CON_CORRECCION'::text
      FROM public.expediente_rechazos_operativos ro, env
      WHERE ro.expediente_id = p_expediente_id
        AND (env.envio IS NULL OR ro.created_at >= env.envio)
        AND NOT EXISTS (
          SELECT 1
          FROM public.expediente_rechazo_reactivaciones x
          WHERE x.rechazo_id = ro.id
        )
    ) x
    ORDER BY x.request_at DESC
    LIMIT 1
  ),
  resp AS (
    SELECT l.submitted_at, l.id
    FROM public.expediente_asesor_cambio_lotes l, env
    WHERE l.expediente_id = p_expediente_id
      AND l.submitted_at IS NOT NULL
      AND (env.envio IS NULL OR l.submitted_at >= env.envio)
    ORDER BY l.submitted_at DESC, l.created_at DESC, l.id DESC
    LIMIT 1
  )
  SELECT
    (SELECT request_at FROM req),
    (SELECT request_type FROM req),
    (SELECT submitted_at FROM resp),
    (SELECT id FROM resp);
$$;

COMMENT ON FUNCTION public.mesa_cambio_episodio_latest(UUID) IS
  'P202: latest_request vigente (abierta) vs latest_response P130 del ciclo. Ignora solicitudes ya cerradas por Mesa. Sin PII.';
REVOKE ALL ON FUNCTION public.mesa_cambio_episodio_latest(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_episodio_latest(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_episodio_latest(UUID) TO authenticated;

-- 4) P198 estado efectivo: WAITING solo si latest request > latest response (ciclo).
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
  v_latest RECORD;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN;
  END IF;

  SELECT t.latest_request_at, t.latest_request_type, t.latest_response_at, t.latest_batch_id
  INTO v_latest
  FROM public.mesa_cambio_episodio_latest(p_expediente_id) t
  LIMIT 1;

  -- Regla temporal canónica (ciclo): request vigente sin respuesta posterior.
  IF v_latest.latest_request_at IS NOT NULL
     AND (
       v_latest.latest_response_at IS NULL
       OR v_latest.latest_request_at > v_latest.latest_response_at
     )
  THEN
    estado := 'WAITING_ADVISOR';
    origin := NULL;
    request_type := v_latest.latest_request_type;
    request_at := v_latest.latest_request_at;
    batch_id := NULL;
    batch_submitted_at := v_latest.latest_response_at;
    actionable_at := v_latest.latest_request_at;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT c.origin, c.request_type, c.request_at, c.batch_submitted_at, c.batch_id
  INTO v_cls
  FROM public.mesa_cambio_revision_clasificacion(p_expediente_id) c
  LIMIT 1;

  IF v_cls.batch_id IS NOT NULL AND v_cls.batch_submitted_at IS NOT NULL THEN
    -- latest response > latest request: si hay lote pendiente del ciclo, revisar cierre.
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

  -- Sin lote pendiente del ciclo: flags solo si aún hay unanswered (defensa).
  SELECT f.unanswered
  INTO v_flags
  FROM public.mesa_correccion_episodio_flags(p_expediente_id) f
  LIMIT 1;

  IF coalesce(v_flags.unanswered, FALSE) THEN
    estado := 'WAITING_ADVISOR';
    origin := NULL;
    request_type := v_latest.latest_request_type;
    request_at := v_latest.latest_request_at;
    batch_id := NULL;
    batch_submitted_at := NULL;
    actionable_at := v_latest.latest_request_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_cls.origin IN ('LEGACY', 'AMBIGUOUS') THEN
    -- Ramas históricas P196; con filtro de ciclo P202 casi no aplican.
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
  request_type := coalesce(v_cls.request_type, v_latest.latest_request_type);
  request_at := coalesce(v_cls.request_at, v_latest.latest_request_at);
  batch_id := NULL;
  batch_submitted_at := v_latest.latest_response_at;
  actionable_at := NULL;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.mesa_cambio_revision_estado_efectivo(UUID) IS
  'P198/P202: WAITING solo si latest_request_at > latest_response_at del ciclo. PENDING si respuesta vigente sin cierre. Sin PII.';

-- 5) Asesor chips: misma regla temporal (nunca Necesita si ya respondió lo vigente).
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
  v_p198 TEXT;
  v_latest RECORD;
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

  SELECT t.latest_request_at, t.latest_response_at
  INTO v_latest
  FROM public.mesa_cambio_episodio_latest(p_expediente_id) t
  LIMIT 1;

  -- Temporal: request vigente sin respuesta → Necesita.
  IF v_latest.latest_request_at IS NOT NULL
     AND (
       v_latest.latest_response_at IS NULL
       OR v_latest.latest_request_at > v_latest.latest_response_at
     )
  THEN
    RETURN 'correccion_requerida';
  END IF;

  SELECT s.estado
  INTO v_p198
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  -- Temporal: respuesta posterior a request y aún pendiente Mesa → Enviada.
  IF v_latest.latest_request_at IS NOT NULL
     AND v_latest.latest_response_at IS NOT NULL
     AND v_latest.latest_response_at > v_latest.latest_request_at
  THEN
    IF v_p198 = 'CLOSED' THEN
      NULL; -- flujo normal abajo
    ELSE
      -- Incluye operativo respondido sin reactivación (PENDING_REVIEW).
      RETURN 'correccion_enviada';
    END IF;
  END IF;

  IF v_p198 = 'CORRECTION_PENDING_REVIEW' THEN
    RETURN 'correccion_enviada';
  END IF;

  IF v_p198 = 'WAITING_ADVISOR' THEN
    RETURN 'correccion_requerida';
  END IF;

  IF public.asesor_inbox_retencion_correccion_abierta(p_expediente_id) THEN
    RETURN 'correccion_requerida';
  END IF;

  IF v_resultado = 'rechazado_mesa' THEN
    SELECT f.responded INTO v_responded
    FROM public.mesa_correccion_episodio_flags(p_expediente_id) f
    LIMIT 1;

    IF coalesce(v_responded, FALSE)
       OR EXISTS (
         SELECT 1
         FROM public.expediente_asesor_cambio_lotes l
         WHERE l.expediente_id = p_expediente_id
           AND l.submitted_at IS NOT NULL
           AND (v_envio IS NULL OR l.submitted_at >= v_envio)
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
  'P202: chips asesor. Necesita solo si latest_request > latest_response (ciclo). Enviada si ya respondió y Mesa no cerró. Sin OR categoria.';

REVOKE ALL ON FUNCTION public.mesa_cambio_tiene_solicitud_posterior(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_tiene_solicitud_posterior(UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_tiene_solicitud_posterior(UUID, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_revision_clasificacion(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.mesa_cambio_revision_estado_efectivo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cambio_revision_estado_efectivo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cambio_revision_estado_efectivo(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) TO authenticated;
