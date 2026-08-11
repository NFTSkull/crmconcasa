-- ConCasa CRM — P167: pendientes asesor calibrados (correcciones + booking vigente)
-- Espejo TS: deriveResumenExpedienteCorreccion + isAsesorPendienteAgendarBiometricos
-- Sin cambio de etapas/avance/agenda capacity/Sheets/Bernardo/Pago ConCasa.

-- Estado vigente del booking (último por created_at/id), no “existe algún cancelled”.
CREATE OR REPLACE FUNCTION public.asesor_inbox_latest_booking_status(
  p_expediente_id UUID,
  p_kind TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT b.status::text
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind::text = p_kind
  ORDER BY b.created_at DESC NULLS LAST, b.id DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.asesor_inbox_latest_booking_status(UUID, TEXT) IS
  'P167: status del booking más reciente por kind (estado vigente).';

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
BEGIN
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

  -- Docs corregibles asesor: cliente_* integración/complementarios + legado + acuse.
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

  -- Pack legado (paridad deriveResumenDocumental) para faltantes / subido / validado.
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
  'P167: espejo deriveResumenExpedienteCorreccion (cliente_* + legado + acuse/retención).';

CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_agendar_biometricos(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- Estado vigente: último booking bio/notif. Booked vigente gana sobre cancelled histórico.
  SELECT CASE
    WHEN NOT coalesce(p_submitted_to_mesa, false) THEN false
    WHEN public.asesor_inbox_latest_booking_status(p_expediente_id, 'notificacion') = 'booked'
      THEN false
    WHEN public.asesor_inbox_latest_booking_status(p_expediente_id, 'biometricos') = 'booked'
      THEN false
    WHEN p_etapa_actual = 3 THEN true
    WHEN p_etapa_actual IN (4, 5) THEN
      public.asesor_inbox_latest_booking_status(p_expediente_id, 'biometricos') = 'cancelled'
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_pendiente_agendar_biometricos(BOOLEAN, SMALLINT, UUID) IS
  'P167: etapa 3 sin booked vigente; 4/5 solo si el último bio es cancelled (reagendar).';

CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_agendar_firma(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- Paridad canShowAsesorFirmasSupabaseCard + !booked vigente.
  SELECT CASE
    WHEN NOT coalesce(p_submitted_to_mesa, false) THEN false
    WHEN p_etapa_actual = 9 THEN
      public.asesor_inbox_latest_booking_status(p_expediente_id, 'firmas') IS DISTINCT FROM 'booked'
    WHEN p_etapa_actual = 10 THEN
      public.asesor_inbox_latest_booking_status(p_expediente_id, 'firmas') = 'cancelled'
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_pendiente_agendar_firma(BOOLEAN, SMALLINT, UUID) IS
  'P167: etapa 9 sin firmas booked vigente; etapa 10 solo si el último firmas es cancelled.';
