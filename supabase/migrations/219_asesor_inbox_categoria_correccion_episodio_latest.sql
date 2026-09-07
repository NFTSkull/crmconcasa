-- ConCasa CRM — P219: alinear asesor_inbox_categoria_correccion al episodio latest.
-- READ-MODEL ONLY. CREATE OR REPLACE FUNCTION. 0 UPDATE / 0 backfill / 0 data fixes.
--
-- Causa: hotfix P192 hacía shortcut expediente_tiene_correccion_asesor_pendiente
-- → correccion_enviada sin comprobar que el submitted_at responda al ÚLTIMO request.
-- Caso Nicolas: lote viejo + R2 > S1 → estado_efectivo=correccion_requerida pero
-- categoria_correccion=correccion_enviada (stale).
--
-- Autoridad temporal: mesa_cambio_episodio_latest + mesa_cambio_revision_estado_efectivo
-- (P198/P202). Sin recursión: asesor_inbox_estado_efectivo NO llama categoria_correccion
-- (confirmado en mig 203+).

CREATE OR REPLACE FUNCTION public.asesor_inbox_categoria_correccion(p_expediente_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
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

  -- P198/P202 primero (episodio vigente).
  SELECT s.estado, s.request_type
  INTO v_p198, v_p198_type
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  -- WAITING DG/documental → correccion_requerida (nunca enviada por lote anterior).
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

  -- P192 shortcut solo si el lote responde al episodio vigente
  -- (response > request). Nunca si request > response.
  IF public.expediente_tiene_correccion_asesor_pendiente(p_expediente_id) THEN
    IF v_latest_request_at IS NULL
       OR (
         v_latest_response_at IS NOT NULL
         AND v_latest_response_at > v_latest_request_at
       )
    THEN
      RETURN 'correccion_enviada';
    END IF;
    -- Unanswered latest request: no devolver enviada; continuar fallback documental.
  END IF;

  -- Fallback P167/P192 documental / retención (no causal de episodio DG).
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
  'P219: P198/P202 episodio latest gobierna correccion_*; P192 lote solo si responde al request vigente; fallback documental P167.';

REVOKE ALL ON FUNCTION public.asesor_inbox_categoria_correccion(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_inbox_categoria_correccion(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_categoria_correccion(UUID) TO authenticated;
