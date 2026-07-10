-- ConCasa CRM — carta empresa acepta imagen en expediente_documento_mime_permitido

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT public.expediente_documento_mime_permitido('application/pdf', 'cliente_carta_empresa') THEN
    RAISE EXCEPTION 'carta_empresa_image_mime: pdf debe ser true';
  END IF;

  IF NOT public.expediente_documento_mime_permitido('image/jpeg', 'cliente_carta_empresa') THEN
    RAISE EXCEPTION 'carta_empresa_image_mime: jpeg debe ser true';
  END IF;

  IF NOT public.expediente_documento_mime_permitido('image/png', 'cliente_carta_empresa') THEN
    RAISE EXCEPTION 'carta_empresa_image_mime: png debe ser true';
  END IF;

  IF NOT public.expediente_documento_mime_permitido('image/webp', 'cliente_carta_empresa') THEN
    RAISE EXCEPTION 'carta_empresa_image_mime: webp debe ser true';
  END IF;

  IF NOT public.expediente_documento_mime_permitido('image/heic', 'cliente_carta_empresa') THEN
    RAISE EXCEPTION 'carta_empresa_image_mime: heic debe ser true';
  END IF;

  IF public.expediente_documento_mime_permitido('image/jpeg', 'cliente_comprobante_domicilio') THEN
    RAISE EXCEPTION 'carta_empresa_image_mime: comprobante no debe aceptar jpeg';
  END IF;

  IF public.expediente_documento_mime_permitido('image/jpeg', 'cliente_estado_cuenta') THEN
    RAISE EXCEPTION 'carta_empresa_image_mime: estado cuenta no debe aceptar jpeg';
  END IF;

  IF public.expediente_documento_mime_permitido('image/jpeg', 'cliente_semanas_cotizadas') THEN
    RAISE EXCEPTION 'carta_empresa_image_mime: semanas no debe aceptar jpeg';
  END IF;

  IF NOT public.expediente_documento_mime_permitido('application/pdf', 'cliente_acta_nacimiento_digital') THEN
    RAISE EXCEPTION 'acta_digital_image_mime: pdf debe ser true';
  END IF;

  IF NOT public.expediente_documento_mime_permitido('image/jpeg', 'cliente_acta_nacimiento_digital') THEN
    RAISE EXCEPTION 'acta_digital_image_mime: jpeg debe ser true';
  END IF;

  IF NOT public.expediente_documento_mime_permitido('image/heif', 'cliente_acta_nacimiento_digital') THEN
    RAISE EXCEPTION 'acta_digital_image_mime: heif debe ser true';
  END IF;

  RAISE NOTICE 'carta_empresa_image_mime: OK';
END;
$$;
