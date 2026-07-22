-- P104: Notificación solo Apodaca opcional asesor —
-- en asesor_opcionales/upload; no en envio/obligatorios/mesa_upload;
-- distinto de cliente_notificacion y del tipo corto notificacion.

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

  IF NOT ('cliente_notificacion_apodaca' = ANY(v_opc)) THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: falta en asesor_opcionales';
  END IF;

  IF NOT ('cliente_notificacion_apodaca' = ANY(v_upload)) THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: falta en asesor_upload';
  END IF;

  IF 'cliente_notificacion_apodaca' = ANY(v_envio) THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: no debe ser obligatorio envio';
  END IF;

  IF 'cliente_notificacion_apodaca' = ANY(public.integration_doc_tipos_obligatorios()) THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: no debe ser obligatorio Mesa';
  END IF;

  IF 'cliente_notificacion_apodaca' = ANY(public.integration_doc_tipos_mesa_upload()) THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: no debe estar en mesa_upload';
  END IF;

  IF 'cliente_notificacion' = ANY(v_opc) THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: no mezclar cliente_notificacion en opcionales asesor';
  END IF;

  IF 'notificacion' = ANY(v_opc) OR 'notificacion' = ANY(v_upload) THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: nunca tipo corto notificacion';
  END IF;

  IF NOT ('cliente_notificacion_apodaca' = ANY(public.reingreso_documentos_reutilizables())) THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: falta en reingreso_documentos_reutilizables';
  END IF;

  IF cardinality(v_opc) <> 4 OR cardinality(v_upload) <> 8 THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: cardinalidad opc=% upload=%', cardinality(v_opc), cardinality(v_upload);
  END IF;

  -- MIME heredado: PDF ok; sin límites inventados para este tipo.
  IF NOT public.expediente_documento_mime_permitido('application/pdf', 'cliente_notificacion_apodaca') THEN
    RAISE EXCEPTION 'notif_apodaca_opcional: PDF debe permitirse';
  END IF;

  RAISE NOTICE 'notif_apodaca_opcional: OK';
END;
$$;
