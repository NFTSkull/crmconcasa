-- ConCasa CRM — P201: inbox asesor alinea chips con episodio P198.
-- Cloud max = 200. 201 = este read-model. NO modifica mig 197.
-- READ-MODEL only. 0 writers / 0 UPDATE negocio / 0 Disponibles / 0 P198 Mesa.
-- categoria_correccion (columna Documentación) intacta; no gobierna chips/filters.

CREATE OR REPLACE FUNCTION public.asesor_inbox_retencion_correccion_abierta(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.retencion_envios re
    WHERE re.expediente_id = p_expediente_id
      AND re.estado = 'correccion_requerida'::public.retencion_envio_estado
  );
$$;

COMMENT ON FUNCTION public.asesor_inbox_retencion_correccion_abierta(UUID) IS
  'P201: retención propia solicitada sin respuesta (fuera del episodio DG/doc/op P198).';

REVOKE ALL ON FUNCTION public.asesor_inbox_retencion_correccion_abierta(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_inbox_retencion_correccion_abierta(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_retencion_correccion_abierta(UUID) TO authenticated;

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

  -- P198 manda para DG / documentos / rechazo operativo.
  SELECT s.estado
  INTO v_p198
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  IF v_p198 = 'CORRECTION_PENDING_REVIEW' THEN
    -- Asesor ya respondió la solicitud vigente → Mesa revisa.
    RETURN 'correccion_enviada';
  END IF;

  IF v_p198 = 'WAITING_ADVISOR' THEN
    -- Solicitud vigente sin respuesta (o re-reject posterior al lote).
    RETURN 'correccion_requerida';
  END IF;

  -- Retención: ciclo propio fuera de P198. Solo abierta sin respuesta.
  IF public.asesor_inbox_retencion_correccion_abierta(p_expediente_id) THEN
    RETURN 'correccion_requerida';
  END IF;

  -- CLOSED / ADVISOR_UPDATE / sin episodio: no reabrir por categoria_correccion.
  IF v_resultado = 'rechazado_mesa' THEN
    -- Episodio ya respondido (lote P130 del ciclo o flags.responded):
    -- subestado 'rechazado' no gobierna el chip (P198 CLOSED no trae batch si el lote ya está revisado).
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
  'P201: chip/cola asesor. cancelado → P198 PENDING_REVIEW=enviada / WAITING=necesita → retención abierta → CLOSED/UPDATE+resultado (sin OR categoria_correccion).';

REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) TO authenticated;
