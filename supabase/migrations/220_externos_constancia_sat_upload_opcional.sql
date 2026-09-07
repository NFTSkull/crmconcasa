-- ConCasa CRM — Externos: Constancia SAT (`cliente_constancia_situacion_fiscal`) opcional en upload.
-- Incremental. NO modifica 20260904230000 (histórico).
-- Solo CREATE OR REPLACE de integration_doc_tipos_asesor_upload_para.
-- envio_para intacto (obligatorios externos = 8).
-- 0 UPDATE / 0 backfill / 0 datos de expedientes.
-- Tipo Mesa complementario `cliente_constancia_sat` NO se abre.

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
    -- Externos: obligatorios de envío (8) + Acta digital + Constancia SAT (ambos opcionales).
    v_envio := public.integration_doc_tipos_asesor_envio_para(p_asesor_id);
    RETURN v_envio || ARRAY[
      'cliente_acta_nacimiento_digital',
      'cliente_constancia_situacion_fiscal'
    ]::TEXT[];
  END IF;

  RETURN public.integration_doc_tipos_asesor_upload();
END;
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) IS
  'Upload por asesor: externos = envio_para(8) + acta digital + constancia situacion fiscal (opcionales); internos = upload() completo. Sin cliente_constancia_sat (Mesa).';

REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) TO authenticated;
