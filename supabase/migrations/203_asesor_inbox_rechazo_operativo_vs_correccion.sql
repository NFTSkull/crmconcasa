-- ConCasa CRM — P204-A: inbox Asesor distingue rechazo operativo de corrección.
-- Cloud max = 202. 203 = este read-model. NO modifica mig 201/202 históricos.
-- READ-MODEL only. 0 writers / 0 UPDATE negocio / 0 Mesa bandeja / 0 P198 Mesa writers.
--
-- Causa Cloud (audit RO): WAITING_ADVISOR + RECHAZO_OPERATIVO_CON_CORRECCION
-- se presentaba como correccion_requerida → chip «Rechazados por mesa» = 0.
--
-- Regla Asesor:
--   cancelado
--   P198 PENDING_REVIEW → correccion_enviada
--   P198 WAITING + request_type OP → rechazado_mesa
--   P198 WAITING (DG/doc) → correccion_requerida
--   retención abierta → correccion_requerida
--   resto → resultado_real (con gate P201 de rechazo respondido)

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

  -- P198: estado + request_type (sin cambiar semántica Mesa).
  SELECT s.estado, s.request_type
  INTO v_p198, v_p198_request_type
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  IF v_p198 = 'CORRECTION_PENDING_REVIEW' THEN
    -- Asesor ya respondió (lote P130) → Mesa revisa.
    RETURN 'correccion_enviada';
  END IF;

  IF v_p198 = 'WAITING_ADVISOR'
     AND v_p198_request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION' THEN
    -- Rechazo operativo vigente esperando asesor ≠ corrección documental/DG.
    RETURN 'rechazado_mesa';
  END IF;

  IF v_p198 = 'WAITING_ADVISOR' THEN
    -- DG / documentos (y demás solicitudes no-operativas).
    RETURN 'correccion_requerida';
  END IF;

  -- Retención: ciclo propio fuera de P198. Solo abierta sin respuesta.
  IF public.asesor_inbox_retencion_correccion_abierta(p_expediente_id) THEN
    RETURN 'correccion_requerida';
  END IF;

  -- CLOSED / ADVISOR_UPDATE / sin episodio: no reabrir por categoria_correccion.
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
  'P204-A/P201: chip asesor. cancelado → PENDING=enviada → WAITING+OP=rechazado_mesa → WAITING DG/doc=necesita → retención → CLOSED/UPDATE+resultado. Sin OR categoria_correccion. P198 Mesa intacto.';

REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_estado_efectivo(UUID) TO authenticated;
