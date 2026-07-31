-- Notificación compartida: cliente_notificacion_apodaca sin gate de etapa (asesor).
-- Conserva gate etapa >= 7 solo para cliente_notificacion.
\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.register_expediente_documento_pre_reingreso(uuid,text,text,text,text,bigint)'::regprocedure
  );

  IF position('IN (''cliente_notificacion'', ''cliente_notificacion_apodaca'')' in v_def) > 0 THEN
    RAISE EXCEPTION 'notif_compartida: apodaca aún en gate conjunto etapa>=7';
  END IF;

  IF v_def !~ 'v_tipo[[:space:]]*=[[:space:]]*''cliente_notificacion''' THEN
    RAISE EXCEPTION 'notif_compartida: falta gate exclusivo para cliente_notificacion';
  END IF;

  IF NOT ('cliente_notificacion_apodaca' = ANY(public.integration_doc_tipos_asesor_opcionales())) THEN
    RAISE EXCEPTION 'notif_compartida: falta en asesor opcionales';
  END IF;

  IF NOT ('cliente_notificacion_apodaca' = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'notif_compartida: falta en asesor upload';
  END IF;

  IF NOT ('cliente_notificacion_apodaca' = ANY(public.integration_doc_tipos_mesa_upload())) THEN
    RAISE EXCEPTION 'notif_compartida: falta en mesa upload';
  END IF;

  IF public.asesor_cambio_doc_label('cliente_notificacion_apodaca') IS DISTINCT FROM 'Notificación' THEN
    RAISE EXCEPTION 'notif_compartida: label SQL esperado Notificación';
  END IF;

  RAISE NOTICE 'notif_compartida: OK';
END;
$test$;
