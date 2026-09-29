-- ConCasa CRM — Persistir en Datos Generales el RFC validado desde Estado de Cuenta.
--
-- Solo service_role. Se ejecuta después de PASS SAT y antes de registrar la
-- validación terminal, para que la huella fiscal se calcule con el RFC final.
-- Usa CAS sobre CURP, RFC previo y versión/documento del Estado de Cuenta para
-- no pisar cambios concurrentes del asesor.

BEGIN;

CREATE OR REPLACE FUNCTION public.server_sync_rfc_datos_generales_from_sat(
  p_expediente_id UUID,
  p_fiscal_rfc TEXT,
  p_expected_curp TEXT,
  p_expected_rfc_datos TEXT,
  p_edc_documento_id UUID,
  p_edc_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_datos JSONB;
  v_curp TEXT;
  v_rfc_actual TEXT;
  v_fiscal_rfc TEXT := upper(btrim(coalesce(p_fiscal_rfc, '')));
  v_expected_curp TEXT := upper(btrim(coalesce(p_expected_curp, '')));
  v_expected_rfc TEXT := upper(btrim(coalesce(p_expected_rfc_datos, '')));
  v_edc RECORD;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_sat: forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL
     OR p_edc_documento_id IS NULL
     OR p_edc_version IS NULL
     OR v_expected_curp = ''
     OR v_fiscal_rfc !~ '^[A-ZÑ&]{4}[0-9]{6}[A-Z0-9]{3}$' THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_sat: argumentos inválidos'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.version
  INTO v_edc
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = 'cliente_estado_cuenta'
    AND d.deleted_at IS NULL
  ORDER BY d.created_at DESC, d.version DESC NULLS LAST
  LIMIT 1;

  IF v_edc.id IS NULL
     OR v_edc.id IS DISTINCT FROM p_edc_documento_id
     OR coalesce(v_edc.version, 0) IS DISTINCT FROM coalesce(p_edc_version, 0) THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_sat: Estado de Cuenta cambió'
      USING ERRCODE = '40001';
  END IF;

  SELECT cd.datos
  INTO v_datos
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_datos IS NULL THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_sat: datos del cliente ausentes'
      USING ERRCODE = 'P0002';
  END IF;

  v_curp := upper(btrim(coalesce(v_datos->>'curp', '')));
  v_rfc_actual := upper(btrim(coalesce(v_datos->>'rfc', '')));

  IF v_curp IS DISTINCT FROM v_expected_curp
     OR v_rfc_actual IS DISTINCT FROM v_expected_rfc THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_sat: datos fiscales cambiaron'
      USING ERRCODE = '40001';
  END IF;

  IF v_rfc_actual = v_fiscal_rfc THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'expediente_id', p_expediente_id
    );
  END IF;

  UPDATE public.cliente_datos
  SET
    datos = jsonb_set(
      coalesce(datos, '{}'::jsonb),
      '{rfc}',
      to_jsonb(v_fiscal_rfc),
      true
    ),
    updated_at = now()
  WHERE expediente_id = p_expediente_id;

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'expediente_id', p_expediente_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.server_sync_rfc_datos_generales_from_sat(
  UUID, TEXT, TEXT, TEXT, UUID, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.server_sync_rfc_datos_generales_from_sat(
  UUID, TEXT, TEXT, TEXT, UUID, INTEGER
) FROM anon;
REVOKE ALL ON FUNCTION public.server_sync_rfc_datos_generales_from_sat(
  UUID, TEXT, TEXT, TEXT, UUID, INTEGER
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.server_sync_rfc_datos_generales_from_sat(
  UUID, TEXT, TEXT, TEXT, UUID, INTEGER
) TO service_role;

COMMENT ON FUNCTION public.server_sync_rfc_datos_generales_from_sat(
  UUID, TEXT, TEXT, TEXT, UUID, INTEGER
) IS
  'Server-only: tras PASS SAT, persiste en cliente_datos.datos.rfc el RFC resuelto desde el Estado de Cuenta/respaldo fiscal, con CAS de CURP/RFC/EDC para evitar pisar cambios concurrentes.';

COMMIT;
