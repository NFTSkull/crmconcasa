-- P062: acta nacimiento digital opcional asesor — no obligatorio, no en complementarios Mesa

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_opc TEXT[];
  v_upload TEXT[];
  v_envio TEXT[];
BEGIN
  v_opc := public.integration_doc_tipos_asesor_opcionales();
  v_upload := public.integration_doc_tipos_asesor_upload();
  v_envio := public.integration_doc_tipos_asesor_envio();

  IF NOT ('cliente_acta_nacimiento_digital' = ANY(v_opc)) THEN
    RAISE EXCEPTION 'acta_digital_opcional: falta en asesor_opcionales';
  END IF;

  IF NOT ('cliente_acta_nacimiento_digital' = ANY(v_upload)) THEN
    RAISE EXCEPTION 'acta_digital_opcional: falta en asesor_upload';
  END IF;

  IF 'cliente_acta_nacimiento_digital' = ANY(v_envio) THEN
    RAISE EXCEPTION 'acta_digital_opcional: no debe ser obligatorio envio';
  END IF;

  IF 'cliente_acta_nacimiento_digital' = ANY(public.integration_doc_tipos_obligatorios()) THEN
    RAISE EXCEPTION 'acta_digital_opcional: no debe ser obligatorio Mesa';
  END IF;

  IF 'cliente_acta_nacimiento_digital' = ANY(public.integration_doc_tipos_mesa_upload()) THEN
    RAISE EXCEPTION 'acta_digital_opcional: no debe estar en mesa_upload';
  END IF;

  IF 'cliente_acta_nacimiento_digital' = ANY(v_opc)
     AND 'cliente_acta_nacimiento' = ANY(v_opc) THEN
    RAISE EXCEPTION 'acta_digital_opcional: no mezclar con acta Mesa';
  END IF;

  IF cardinality(v_opc) <> 3 OR cardinality(v_upload) <> 7 THEN
    RAISE EXCEPTION 'acta_digital_opcional: cardinalidad opc=% upload=%', cardinality(v_opc), cardinality(v_upload);
  END IF;

  RAISE NOTICE 'acta_digital_opcional: OK';
END;
$$;
