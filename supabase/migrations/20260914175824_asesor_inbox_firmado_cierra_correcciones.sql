-- ConCasa CRM — Inbox asesor: Firmado/Pago cierra correcciones históricas.
-- READ-MODEL ONLY. CREATE OR REPLACE FUNCTION. 0 UPDATE / 0 backfill / 0 writers.
--
-- Regla canónica alineada con Mesa (P207.3):
--   - etapa_actual >= 11 (Firmado o posterior), o
--   - pago_concasa_resultado IS NOT NULL
-- ya no puede presentarse como correccion_requerida / correccion_enviada / rechazado_mesa.
-- El histórico P198/documental se conserva; únicamente deja de dominar el estado vigente del asesor.

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
  v_etapa SMALLINT;
  v_pago_resultado TEXT;
  v_resultado TEXT;
  v_p198 TEXT;
  v_p198_request_type TEXT;
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
    e.fecha_envio_mesa,
    e.etapa_actual,
    e.pago_concasa_resultado::text
  INTO
    v_ciclo,
    v_submitted,
    v_subestado,
    v_decision,
    v_envio,
    v_etapa,
    v_pago_resultado
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

  -- Firmado/Pago es posterior y autoritativo: una corrección histórica ya no
  -- debe reaparecer en el inbox, contadores, filtros ni notificaciones del asesor.
  IF coalesce(v_etapa, 0) >= 11 OR v_pago_resultado IS NOT NULL THEN
    RETURN v_resultado;
  END IF;

  -- P198: estado + request_type (sin cambiar semántica Mesa).
  SELECT s.estado, s.request_type
  INTO v_p198, v_p198_request_type
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  IF v_p198 = 'CORRECTION_PENDING_REVIEW' THEN
    RETURN 'correccion_enviada';
  END IF;

  IF v_p198 = 'WAITING_ADVISOR'
     AND v_p198_request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION' THEN
    RETURN 'rechazado_mesa';
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
  'P220: estado asesor; cancelado terminal y Firmado/Pago (etapa>=11 o pago_resultado) cierran correcciones históricas antes de evaluar P198/retención.';

REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.asesor_inbox_categoria_correccion(p_expediente_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_etapa SMALLINT;
  v_pago_resultado TEXT;
  v_cd_estado TEXT;
  v_retencion_estado TEXT;
  v_ine TEXT;
  v_ec TEXT;
  v_nss TEXT;
  v_dir TEXT;
  v_doc TEXT;
  v_has_rechazado BOOLEAN;
  v_has_resubido BOOLEAN;
  v_p198 TEXT;
  v_p198_type TEXT;
  v_latest_request_at TIMESTAMPTZ;
  v_latest_response_at TIMESTAMPTZ;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT e.etapa_actual, e.pago_concasa_resultado::text
  INTO v_etapa, v_pago_resultado
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  -- La categoría ya no debe exponer una corrección histórica una vez que el
  -- expediente alcanzó Firmado/Pago. `documentos_validados` es el estado neutro
  -- no accionable admitido por el contrato actual del inbox.
  IF FOUND AND (coalesce(v_etapa, 0) >= 11 OR v_pago_resultado IS NOT NULL) THEN
    RETURN 'documentos_validados';
  END IF;

  SELECT s.estado, s.request_type
  INTO v_p198, v_p198_type
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  IF v_p198 = 'WAITING_ADVISOR'
     AND v_p198_type IS DISTINCT FROM 'RECHAZO_OPERATIVO_CON_CORRECCION' THEN
    RETURN 'correccion_requerida';
  END IF;

  IF v_p198 = 'CORRECTION_PENDING_REVIEW' THEN
    RETURN 'correccion_enviada';
  END IF;

  SELECT t.latest_request_at, t.latest_response_at
  INTO v_latest_request_at, v_latest_response_at
  FROM public.mesa_cambio_episodio_latest(p_expediente_id) t
  LIMIT 1;

  IF public.expediente_tiene_correccion_asesor_pendiente(p_expediente_id) THEN
    IF v_latest_request_at IS NULL
       OR (
         v_latest_response_at IS NOT NULL
         AND v_latest_response_at > v_latest_request_at
       )
    THEN
      RETURN 'correccion_enviada';
    END IF;
  END IF;

  SELECT cd.estado::text INTO v_cd_estado
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id
  LIMIT 1;

  IF v_cd_estado = 'rechazado' THEN
    RETURN 'correccion_requerida';
  END IF;

  SELECT re.estado::text INTO v_retencion_estado
  FROM public.retencion_envios re
  WHERE re.expediente_id = p_expediente_id
  ORDER BY re.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_retencion_estado = 'correccion_requerida' THEN
    RETURN 'correccion_requerida';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT ON (d.tipo_documento)
          d.estatus_revision::text AS estatus
        FROM public.expediente_documentos d
        WHERE d.expediente_id = p_expediente_id
          AND d.deleted_at IS NULL
          AND d.tipo_documento IN (
            'cliente_ine_frente',
            'cliente_ine_reverso',
            'cliente_comprobante_domicilio',
            'cliente_estado_cuenta',
            'cliente_semanas_cotizadas',
            'cliente_acta_nacimiento',
            'cliente_constancia_sat',
            'retencion_acuse_con_sello',
            'retencion_carta_sin_sello',
            'ine',
            'estado_cuenta',
            'nss',
            'direccion'
          )
        ORDER BY d.tipo_documento, d.created_at DESC NULLS LAST, d.id DESC
      ) latest
      WHERE latest.estatus = 'rechazado'
    ),
    EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT ON (d.tipo_documento)
          d.estatus_revision::text AS estatus
        FROM public.expediente_documentos d
        WHERE d.expediente_id = p_expediente_id
          AND d.deleted_at IS NULL
          AND d.tipo_documento IN (
            'cliente_ine_frente',
            'cliente_ine_reverso',
            'cliente_comprobante_domicilio',
            'cliente_estado_cuenta',
            'cliente_semanas_cotizadas',
            'cliente_acta_nacimiento',
            'cliente_constancia_sat',
            'retencion_acuse_con_sello',
            'retencion_carta_sin_sello',
            'ine',
            'estado_cuenta',
            'nss',
            'direccion'
          )
        ORDER BY d.tipo_documento, d.created_at DESC NULLS LAST, d.id DESC
      ) latest
      WHERE latest.estatus = 'resubido'
    )
  INTO v_has_rechazado, v_has_resubido;

  IF v_has_rechazado THEN
    RETURN 'correccion_requerida';
  END IF;

  IF v_has_resubido THEN
    RETURN 'correccion_enviada';
  END IF;

  v_ine := public.asesor_inbox_doc_pack_estatus(p_expediente_id, 'ine');
  v_ec := public.asesor_inbox_doc_pack_estatus(p_expediente_id, 'estado_cuenta');
  v_nss := public.asesor_inbox_doc_pack_estatus(p_expediente_id, 'nss');
  v_dir := public.asesor_inbox_doc_pack_estatus(p_expediente_id, 'direccion');

  IF v_ine IS NULL OR v_ec IS NULL OR v_nss IS NULL OR v_dir IS NULL
     OR v_ine = 'faltante' OR v_ec = 'faltante' OR v_nss = 'faltante' OR v_dir = 'faltante' THEN
    v_doc := 'faltantes';
  ELSIF v_ine = 'rechazado' OR v_ec = 'rechazado' OR v_nss = 'rechazado' OR v_dir = 'rechazado' THEN
    v_doc := 'correccion_requerida';
  ELSIF v_ine = 'resubido' OR v_ec = 'resubido' OR v_nss = 'resubido' OR v_dir = 'resubido' THEN
    v_doc := 'correccion_enviada';
  ELSIF v_ine = 'subido' OR v_ec = 'subido' OR v_nss = 'subido' OR v_dir = 'subido' THEN
    v_doc := 'pendiente_revision_documental';
  ELSIF v_ine = 'validado' AND v_ec = 'validado' AND v_nss = 'validado' AND v_dir = 'validado' THEN
    v_doc := 'documentos_validados';
  ELSE
    v_doc := 'pendiente_revision_documental';
  END IF;

  RETURN v_doc;
END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_categoria_correccion(UUID) IS
  'P220/P219: Firmado/Pago cierra categoría de corrección; antes de etapa 11 conserva episodio latest P198/P202 y fallback documental.';

REVOKE ALL ON FUNCTION public.asesor_inbox_categoria_correccion(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_inbox_categoria_correccion(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_categoria_correccion(UUID) TO authenticated;
