-- P044: documentos obligatorios por rol — sin archivo NSS; acta/SAT solo Mesa

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_envio TEXT[];
  v_upload TEXT[];
  v_oblig TEXT[];
  v_mesa TEXT[];
BEGIN
  v_envio := public.integration_doc_tipos_asesor_envio();
  v_upload := public.integration_doc_tipos_asesor_upload();
  v_oblig := public.integration_doc_tipos_obligatorios();
  v_mesa := public.integration_doc_tipos_mesa_upload();

  IF cardinality(v_envio) <> 4 THEN
    RAISE EXCEPTION 'documentos_obligatorios_roles: se esperaban 4 asesor_envio, hay %', cardinality(v_envio);
  END IF;

  IF NOT (v_envio @> ARRAY[
    'cliente_ine_frente',
    'cliente_ine_reverso',
    'cliente_comprobante_domicilio',
    'cliente_estado_cuenta'
  ]::TEXT[]) THEN
    RAISE EXCEPTION 'documentos_obligatorios_roles: asesor_envio incompleto';
  END IF;

  IF 'nss' = ANY(v_envio) OR 'nss' = ANY(v_upload) OR 'nss' = ANY(v_oblig) THEN
    RAISE EXCEPTION 'documentos_obligatorios_roles: nss no debe estar en listas asesor/obligatorios';
  END IF;

  IF 'cliente_acta_nacimiento' = ANY(v_envio)
     OR 'cliente_constancia_sat' = ANY(v_envio)
     OR 'cliente_acta_nacimiento' = ANY(v_upload)
     OR 'cliente_constancia_sat' = ANY(v_upload) THEN
    RAISE EXCEPTION 'documentos_obligatorios_roles: acta/SAT no deben estar en listas asesor';
  END IF;

  IF v_oblig <> v_envio THEN
    RAISE EXCEPTION 'documentos_obligatorios_roles: obligatorios debe igualar asesor_envio';
  END IF;

  IF NOT ('cliente_acta_nacimiento' = ANY(v_mesa) AND 'cliente_constancia_sat' = ANY(v_mesa)) THEN
    RAISE EXCEPTION 'documentos_obligatorios_roles: mesa_upload debe incluir acta y SAT';
  END IF;

  RAISE NOTICE 'documentos_obligatorios_roles: catálogos OK';
END;
$$;
