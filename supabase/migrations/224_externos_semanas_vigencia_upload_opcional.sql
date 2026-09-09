-- ConCasa CRM — Externos: Semanas cotizadas + Vigencia de derechos opcionales en upload.
-- Incremental. NO modifica 220 / 20260904230000 (históricos).
-- Solo CREATE OR REPLACE de integration_doc_tipos_asesor_upload_para.
-- envio_para intacto (obligatorios externos = 8).
-- 0 UPDATE / 0 DELETE / 0 backfill / 0 datos de expedientes.
-- Evidencia (`asesor_evidencia`) NO se abre para externos.

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload_para(
  p_asesor_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_envio TEXT[];
BEGIN
  IF public.asesor_paquete_documental_externos(p_asesor_id) THEN
    -- Externos: obligatorios de envío (8) + opcionales de upload:
    -- Acta digital, Constancia SAT asesor, Semanas cotizadas, Vigencia de derechos.
    v_envio := public.integration_doc_tipos_asesor_envio_para(p_asesor_id);
    RETURN v_envio || ARRAY[
      'cliente_acta_nacimiento_digital',
      'cliente_constancia_situacion_fiscal',
      'cliente_semanas_cotizadas',
      'cliente_vigencia_derechos'
    ]::TEXT[];
  END IF;

  RETURN public.integration_doc_tipos_asesor_upload();
END;
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) IS
  'Upload por asesor: externos = envio_para(8) + acta + constancia situacion fiscal + semanas + vigencia (opcionales); internos = upload() completo. Sin asesor_evidencia ni cliente_constancia_sat (Mesa) para externos.';

REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) TO authenticated;
