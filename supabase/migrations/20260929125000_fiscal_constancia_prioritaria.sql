-- ConCasa CRM — Constancia SAT como fuente fiscal prioritaria.
--
-- Si el asesor cargó una Constancia de Situación Fiscal oficial:
--   1) la route extrae el RFC del PDF;
--   2) lo asocia al cliente por fecha YYMMDD de la CURP;
--   3) lo persiste en Datos Generales;
--   4) registra evidencia ligada a documento/version;
--   5) Mesa puede enviarse sin volver a consultar SAT externo.
--
-- La validación SAT externa sigue vigente como fallback cuando no hay
-- Constancia legible/resoluble.

BEGIN;

CREATE OR REPLACE FUNCTION public.fiscal_constancia_binding_snapshot(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc RECORD;
  v_curp TEXT;
  v_rfc_datos TEXT;
BEGIN
  SELECT d.id, d.version
  INTO v_doc
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = 'cliente_constancia_situacion_fiscal'
    AND d.deleted_at IS NULL
    AND NULLIF(btrim(COALESCE(d.storage_path, '')), '') IS NOT NULL
  ORDER BY d.created_at DESC, d.version DESC NULLS LAST
  LIMIT 1;

  SELECT
    upper(btrim(coalesce(cd.datos->>'curp', ''))),
    upper(btrim(coalesce(cd.datos->>'rfc', '')))
  INTO v_curp, v_rfc_datos
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF v_doc.id IS NULL OR coalesce(v_curp, '') = '' OR coalesce(v_rfc_datos, '') = '' THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'constancia_documento_id', v_doc.id,
    'constancia_version', v_doc.version,
    'curp_sha256', encode(extensions.digest(v_curp, 'sha256'), 'hex'),
    'rfc_datos_sha256', encode(extensions.digest(v_rfc_datos, 'sha256'), 'hex')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fiscal_constancia_binding_matches(
  p_stored JSONB,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now JSONB;
BEGIN
  IF p_stored IS NULL OR jsonb_typeof(p_stored) <> 'object' THEN
    RETURN false;
  END IF;

  v_now := public.fiscal_constancia_binding_snapshot(p_expediente_id);
  IF v_now IS NULL THEN
    RETURN false;
  END IF;

  RETURN
    (p_stored->>'constancia_documento_id') IS NOT DISTINCT FROM (v_now->>'constancia_documento_id')
    AND (p_stored->>'constancia_version') IS NOT DISTINCT FROM (v_now->>'constancia_version')
    AND (p_stored->>'curp_sha256') IS NOT DISTINCT FROM (v_now->>'curp_sha256')
    AND (p_stored->>'rfc_datos_sha256') IS NOT DISTINCT FROM (v_now->>'rfc_datos_sha256');
END;
$function$;

CREATE OR REPLACE FUNCTION public.server_sync_rfc_datos_generales_from_constancia(
  p_expediente_id UUID,
  p_fiscal_rfc TEXT,
  p_expected_curp TEXT,
  p_expected_rfc_datos TEXT,
  p_constancia_documento_id UUID,
  p_constancia_version INTEGER
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
  v_doc RECORD;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_constancia: forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL
     OR p_constancia_documento_id IS NULL
     OR p_constancia_version IS NULL
     OR v_expected_curp = ''
     OR v_fiscal_rfc !~ '^[A-ZÑ&]{4}[0-9]{6}[A-Z0-9]{3}$' THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_constancia: argumentos inválidos'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.version
  INTO v_doc
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = 'cliente_constancia_situacion_fiscal'
    AND d.deleted_at IS NULL
    AND NULLIF(btrim(COALESCE(d.storage_path, '')), '') IS NOT NULL
  ORDER BY d.created_at DESC, d.version DESC NULLS LAST
  LIMIT 1;

  IF v_doc.id IS NULL
     OR v_doc.id IS DISTINCT FROM p_constancia_documento_id
     OR coalesce(v_doc.version, 0) IS DISTINCT FROM coalesce(p_constancia_version, 0) THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_constancia: Constancia cambió'
      USING ERRCODE = '40001';
  END IF;

  SELECT cd.datos
  INTO v_datos
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_datos IS NULL THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_constancia: datos del cliente ausentes'
      USING ERRCODE = 'P0002';
  END IF;

  v_curp := upper(btrim(coalesce(v_datos->>'curp', '')));
  v_rfc_actual := upper(btrim(coalesce(v_datos->>'rfc', '')));

  IF v_curp IS DISTINCT FROM v_expected_curp
     OR v_rfc_actual IS DISTINCT FROM v_expected_rfc THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_constancia: datos fiscales cambiaron'
      USING ERRCODE = '40001';
  END IF;

  -- La Constancia es oficial; para ligar identidad exigimos misma fecha YYMMDD
  -- entre RFC y CURP, sin calcular el RFC por orden de apellidos/nombres.
  IF length(v_curp) < 10 OR substr(v_fiscal_rfc, 5, 6) IS DISTINCT FROM substr(v_curp, 5, 6) THEN
    RAISE EXCEPTION 'server_sync_rfc_datos_generales_from_constancia: RFC no corresponde a fecha CURP'
      USING ERRCODE = '22023';
  END IF;

  IF v_rfc_actual = v_fiscal_rfc THEN
    RETURN jsonb_build_object('ok', true, 'changed', false);
  END IF;

  UPDATE public.cliente_datos
  SET
    datos = jsonb_set(coalesce(datos, '{}'::jsonb), '{rfc}', to_jsonb(v_fiscal_rfc), true),
    updated_at = now()
  WHERE expediente_id = p_expediente_id;

  RETURN jsonb_build_object('ok', true, 'changed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.server_registrar_validacion_fiscal_constancia(
  p_expediente_id UUID,
  p_fiscal_rfc TEXT,
  p_constancia_documento_id UUID,
  p_constancia_version INTEGER,
  p_resultado_resumido JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org UUID;
  v_id UUID;
  v_prev UUID;
  v_doc RECORD;
  v_curp TEXT;
  v_rfc_datos TEXT;
  v_fiscal_rfc TEXT := upper(btrim(coalesce(p_fiscal_rfc, '')));
  v_res JSONB := coalesce(p_resultado_resumido, '{}'::jsonb);
  v_binding JSONB;
  v_fp TEXT;
  v_attempt INT;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_constancia: forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF v_res ? 'rfc' OR v_res ? 'curp' OR v_res ? 'fiscalRfc' OR v_res ? 'fiscal_rfc' THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_constancia: evidencia con PII'
      USING ERRCODE = '22023';
  END IF;

  IF v_fiscal_rfc !~ '^[A-ZÑ&]{4}[0-9]{6}[A-Z0-9]{3}$' THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_constancia: RFC inválido'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.organization_id
  INTO v_org
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_constancia: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT d.id, d.version
  INTO v_doc
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = 'cliente_constancia_situacion_fiscal'
    AND d.deleted_at IS NULL
    AND NULLIF(btrim(COALESCE(d.storage_path, '')), '') IS NOT NULL
  ORDER BY d.created_at DESC, d.version DESC NULLS LAST
  LIMIT 1;

  IF v_doc.id IS NULL
     OR v_doc.id IS DISTINCT FROM p_constancia_documento_id
     OR coalesce(v_doc.version, 0) IS DISTINCT FROM coalesce(p_constancia_version, 0) THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_constancia: Constancia no coincide con vigente'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    upper(btrim(coalesce(cd.datos->>'curp', ''))),
    upper(btrim(coalesce(cd.datos->>'rfc', '')))
  INTO v_curp, v_rfc_datos
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF coalesce(v_curp, '') = '' OR v_rfc_datos IS DISTINCT FROM v_fiscal_rfc THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_constancia: RFC/CURP no sincronizados'
      USING ERRCODE = '22023';
  END IF;

  IF substr(v_fiscal_rfc, 5, 6) IS DISTINCT FROM substr(v_curp, 5, 6) THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_constancia: fecha RFC/CURP no coincide'
      USING ERRCODE = '22023';
  END IF;

  v_binding := public.fiscal_constancia_binding_snapshot(p_expediente_id);
  IF v_binding IS NULL THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_constancia: binding incompleto'
      USING ERRCODE = '22023';
  END IF;

  v_fp := encode(
    extensions.digest(
      v_fiscal_rfc || '|' || v_curp || '|' || v_doc.id::text || '|' || coalesce(v_doc.version, 0)::text,
      'sha256'
    ),
    'hex'
  );

  v_res := v_res || v_binding || jsonb_build_object(
    'source', 'constancia_sat',
    'semantic', 'pass',
    'rfc_source', 'constancia_situacion_fiscal',
    'fiscal_rfc_sha256', encode(extensions.digest(v_fiscal_rfc, 'sha256'), 'hex'),
    'rfc_mask', left(v_fiscal_rfc, 4) || '****',
    'curp_mask', left(v_curp, 4) || '****'
  );

  FOR v_attempt IN 1..2 LOOP
    BEGIN
      UPDATE public.cliente_validaciones_identidad
      SET vigente = false,
          invalidado_at = now(),
          invalidado_motivo = 'reemplazo',
          updated_at = now()
      WHERE expediente_id = p_expediente_id
        AND tipo = 'rfc_validacion_sat'
        AND vigente = true
      RETURNING id INTO v_prev;

      INSERT INTO public.cliente_validaciones_identidad (
        organization_id, expediente_id, tipo, estado, metodo, proveedor,
        documento_id, documento_version, input_fingerprint, resultado_resumido,
        realizado_por, realizado_por_rol, vigente
      ) VALUES (
        v_org, p_expediente_id, 'rfc_validacion_sat',
        'RFC_VALIDACION_CONSTANCIA_VALIDADA',
        'pdf_constancia', 'sat_constancia',
        v_doc.id, v_doc.version, v_fp, v_res,
        NULL, NULL, true
      )
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempt = 2 THEN
          RAISE EXCEPTION 'server_registrar_validacion_fiscal_constancia: conflicto concurrente'
            USING ERRCODE = '23505';
        END IF;
        v_prev := NULL;
    END;
  END LOOP;

  PERFORM public.log_action(
    v_org,
    NULL,
    NULL,
    'identidad.validacion.fiscal_constancia',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'validacion_id', v_id,
      'prev_id', v_prev,
      'estado', 'RFC_VALIDACION_CONSTANCIA_VALIDADA',
      'source', 'constancia_sat',
      'constancia_documento_id', v_doc.id,
      'constancia_version', v_doc.version
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'estado', 'RFC_VALIDACION_CONSTANCIA_VALIDADA'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fiscal_sat_gate_allows_envio(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.cliente_validaciones_identidad v
    WHERE v.expediente_id = p_expediente_id
      AND v.tipo = 'rfc_validacion_sat'
      AND v.vigente = true
      AND coalesce(v.input_fingerprint, '') <> ''
      AND (
        (
          v.estado IN (
            'RFC_VALIDACION_SAT_VALIDADO',
            'RFC_VALIDACION_SAT_APROBADO_ADMIN'
          )
          AND public.fiscal_sat_binding_matches(v.resultado_resumido, p_expediente_id)
        )
        OR
        (
          v.estado = 'RFC_VALIDACION_CONSTANCIA_VALIDADA'
          AND v.metodo = 'pdf_constancia'
          AND v.proveedor = 'sat_constancia'
          AND public.fiscal_constancia_binding_matches(v.resultado_resumido, p_expediente_id)
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.fiscal_constancia_binding_snapshot(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_constancia_binding_snapshot(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_constancia_binding_snapshot(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_constancia_binding_snapshot(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.fiscal_constancia_binding_matches(JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_constancia_binding_matches(JSONB, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_constancia_binding_matches(JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_constancia_binding_matches(JSONB, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.server_sync_rfc_datos_generales_from_constancia(UUID, TEXT, TEXT, TEXT, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.server_sync_rfc_datos_generales_from_constancia(UUID, TEXT, TEXT, TEXT, UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.server_sync_rfc_datos_generales_from_constancia(UUID, TEXT, TEXT, TEXT, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.server_sync_rfc_datos_generales_from_constancia(UUID, TEXT, TEXT, TEXT, UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.server_registrar_validacion_fiscal_constancia(UUID, TEXT, UUID, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.server_registrar_validacion_fiscal_constancia(UUID, TEXT, UUID, INTEGER, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.server_registrar_validacion_fiscal_constancia(UUID, TEXT, UUID, INTEGER, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.server_registrar_validacion_fiscal_constancia(UUID, TEXT, UUID, INTEGER, JSONB) TO service_role;

COMMENT ON FUNCTION public.fiscal_sat_gate_allows_envio(UUID) IS
  'Autoriza Mesa con validación SAT externa vigente o con RFC extraído de Constancia de Situación Fiscal vigente y ligado a su documento/version + CURP/RFC actuales.';

COMMIT;
