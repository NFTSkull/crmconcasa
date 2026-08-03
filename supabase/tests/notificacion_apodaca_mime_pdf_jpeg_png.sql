-- Hotfix 144: MIME PDF/JPEG/PNG para cliente_notificacion_apodaca; sin ampliar otros.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT public.expediente_documento_mime_permitido('application/pdf', 'cliente_notificacion_apodaca') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: PDF';
  END IF;
  IF NOT public.expediente_documento_mime_permitido('image/jpeg', 'cliente_notificacion_apodaca') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: JPEG';
  END IF;
  IF NOT public.expediente_documento_mime_permitido('image/jpg', 'cliente_notificacion_apodaca') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: image/jpg alias';
  END IF;
  IF NOT public.expediente_documento_mime_permitido('image/png', 'cliente_notificacion_apodaca') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: PNG';
  END IF;
  IF public.expediente_documento_mime_permitido('image/webp', 'cliente_notificacion_apodaca') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: WEBP no';
  END IF;
  IF public.expediente_documento_mime_permitido('image/gif', 'cliente_notificacion_apodaca') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: GIF no';
  END IF;
  IF public.expediente_documento_mime_permitido('image/heic', 'cliente_notificacion_apodaca') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: HEIC no';
  END IF;
  IF public.expediente_documento_mime_permitido('image/svg+xml', 'cliente_notificacion_apodaca') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: SVG no';
  END IF;
  -- No ampliar domicilio / estado cuenta
  IF public.expediente_documento_mime_permitido('image/jpeg', 'cliente_comprobante_domicilio') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: no ampliar domicilio';
  END IF;
  IF public.expediente_documento_mime_permitido('image/jpeg', 'cliente_estado_cuenta') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: no ampliar estado cuenta';
  END IF;
  -- Regresiones: Pagaré/Notificación Mesa/Acuse siguen con imagen
  IF NOT public.expediente_documento_mime_permitido('image/jpeg', 'cliente_pagare') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: pagare jpeg';
  END IF;
  IF NOT public.expediente_documento_mime_permitido('image/png', 'retencion_acuse_con_sello') THEN
    RAISE EXCEPTION 'notif_apodaca_mime: acuse png';
  END IF;

  RAISE NOTICE 'notif_apodaca_mime (144): OK';
END;
$$;
