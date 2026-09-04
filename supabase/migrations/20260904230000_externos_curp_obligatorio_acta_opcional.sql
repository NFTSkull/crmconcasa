-- ConCasa CRM — Externos: CURP obligatorio (8) + Acta digital opcional (upload)
-- Incremental sobre Parte A (20260904120000). NO modifica esa mig histórica (7).
-- Autoridad membresía: asesor_paquete_documental_externos (Silvia|Orlando).
-- Internos: integration_doc_tipos_asesor_envio() / upload() intactos.
-- NO backfill / NO UPDATE de expedientes.
-- Grants: misma política que Parte A (REVOKE PUBLIC/anon; EXECUTE authenticated).

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_envio_para(
  p_asesor_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.asesor_paquete_documental_externos(p_asesor_id) THEN
    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta',
      'cliente_constancia_curp',
      'cliente_solicitud_credito',
      'cliente_lista_nominal',
      'cliente_bajo_protesta',
      'cliente_presupuesto'
    ]::TEXT[];
  END IF;

  RETURN public.integration_doc_tipos_asesor_envio();
END;
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) IS
  'Docs de envío por asesor: 8 (sin ine_reverso, + CURP) si Silvia/Orlando; si no, exactamente integration_doc_tipos_asesor_envio().';

REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) TO authenticated;

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
    -- Externos: obligatorios de envío (8) + Acta digital opcional (no bloquea envío).
    v_envio := public.integration_doc_tipos_asesor_envio_para(p_asesor_id);
    RETURN v_envio || ARRAY['cliente_acta_nacimiento_digital']::TEXT[];
  END IF;

  RETURN public.integration_doc_tipos_asesor_upload();
END;
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) IS
  'Upload por asesor: externos = envio_para(8) + acta digital opcional; internos = upload() completo.';

REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) TO authenticated;
