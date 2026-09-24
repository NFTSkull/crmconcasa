-- =============================================================================
-- 228_fiscal_sat_gate_server_write.sql
-- Gate fiscal SAT en DB + escritura server-only + aprobación admin + piloto.
-- Default: fiscal_sat_gate_enabled=false y piloto=[] → enviar_a_mesa idéntico a hoy.
-- Nota: en main el slot 220 ya existía (externos constancia SAT); este bloque es 228.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 0) app_settings + helpers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT 'false'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_select_authenticated ON public.app_settings;
CREATE POLICY app_settings_select_authenticated
  ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.app_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.app_settings FROM anon;
REVOKE ALL ON TABLE public.app_settings FROM authenticated;
GRANT SELECT ON TABLE public.app_settings TO authenticated;
-- Escritura solo postgres/service_role (sin policy INSERT/UPDATE para authenticated;
-- REVOKE explícito a authenticated: en clones con grants previos, REVOKE PUBLIC no basta)

INSERT INTO public.app_settings (key, value)
VALUES
  ('fiscal_sat_gate_enabled', 'false'::jsonb),
  ('fiscal_sat_gate_pilot_asesores', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.app_setting_bool(p_key TEXT, p_default BOOLEAN DEFAULT false)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN jsonb_typeof(s.value) = 'boolean' THEN (s.value)::text::boolean
        WHEN s.value = 'true'::jsonb THEN true
        WHEN s.value = 'false'::jsonb THEN false
        WHEN lower(s.value #>> '{}') IN ('true', '1', 'yes') THEN true
        WHEN lower(s.value #>> '{}') IN ('false', '0', 'no') THEN false
        ELSE p_default
      END
      FROM public.app_settings s
      WHERE s.key = p_key
    ),
    p_default
  );
$$;

REVOKE ALL ON FUNCTION public.app_setting_bool(TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_setting_bool(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_setting_bool(TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_sat_gate_applies_to_expediente(p_expediente_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asesor UUID;
  v_pilot JSONB;
BEGIN
  IF public.app_setting_bool('fiscal_sat_gate_enabled', false) THEN
    RETURN true;
  END IF;

  SELECT e.asesor_id INTO v_asesor
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL;

  IF v_asesor IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.value INTO v_pilot
  FROM public.app_settings s
  WHERE s.key = 'fiscal_sat_gate_pilot_asesores';

  IF v_pilot IS NULL OR jsonb_typeof(v_pilot) <> 'array' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_pilot) AS x(val)
    WHERE x.val = v_asesor::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) TO service_role;

-- Snapshot de binding fiscal (sin PII en claro): EDC + CURP + RFCs candidatos
CREATE OR REPLACE FUNCTION public.fiscal_sat_binding_snapshot(p_expediente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_edc RECORD;
  v_curp TEXT;
  v_rfc_datos TEXT;
  v_rfc_infonavit TEXT;
BEGIN
  SELECT d.id, d.version
  INTO v_edc
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = 'cliente_estado_cuenta'
    AND d.deleted_at IS NULL
  ORDER BY d.created_at DESC, d.version DESC NULLS LAST
  LIMIT 1;

  SELECT
    upper(btrim(coalesce(cd.datos->>'curp', ''))),
    upper(btrim(coalesce(cd.datos->>'rfc', '')))
  INTO v_curp, v_rfc_datos
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  SELECT upper(btrim(coalesce(ed.rfc_infonavit, '')))
  INTO v_rfc_infonavit
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF v_edc.id IS NULL OR coalesce(v_curp, '') = '' THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'edc_documento_id', v_edc.id,
    'edc_version', v_edc.version,
    'curp_sha256', encode(extensions.digest(v_curp, 'sha256'), 'hex'),
    'rfc_datos_sha256', encode(extensions.digest(coalesce(v_rfc_datos, ''), 'sha256'), 'hex'),
    'rfc_infonavit_sha256', encode(extensions.digest(coalesce(v_rfc_infonavit, ''), 'sha256'), 'hex')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fiscal_sat_binding_snapshot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_binding_snapshot(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_sat_binding_matches(
  p_stored JSONB,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now JSONB;
BEGIN
  IF p_stored IS NULL OR jsonb_typeof(p_stored) <> 'object' THEN
    RETURN false;
  END IF;

  v_now := public.fiscal_sat_binding_snapshot(p_expediente_id);
  IF v_now IS NULL THEN
    RETURN false;
  END IF;

  RETURN
    (p_stored->>'edc_documento_id') IS NOT DISTINCT FROM (v_now->>'edc_documento_id')
    AND (p_stored->>'edc_version') IS NOT DISTINCT FROM (v_now->>'edc_version')
    AND (p_stored->>'curp_sha256') IS NOT DISTINCT FROM (v_now->>'curp_sha256')
    AND (p_stored->>'rfc_datos_sha256') IS NOT DISTINCT FROM (v_now->>'rfc_datos_sha256')
    AND (p_stored->>'rfc_infonavit_sha256') IS NOT DISTINCT FROM (v_now->>'rfc_infonavit_sha256');
END;
$$;

REVOKE ALL ON FUNCTION public.fiscal_sat_binding_matches(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_binding_matches(JSONB, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 1) Defensa: sin escritura directa authenticated en validaciones
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cliente_validaciones_identidad FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cliente_validaciones_identidad FROM anon;
-- ---------------------------------------------------------------------------
-- 2) Blindar asesor_registrar_validacion_identidad
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asesor_registrar_validacion_identidad(
  p_expediente_id UUID,
  p_tipo TEXT,
  p_estado TEXT,
  p_metodo TEXT,
  p_resultado_resumido JSONB DEFAULT '{}'::jsonb,
  p_documento_id UUID DEFAULT NULL,
  p_documento_version INT DEFAULT NULL,
  p_input_fingerprint TEXT DEFAULT '',
  p_proveedor TEXT DEFAULT 'local'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp public.expedientes%ROWTYPE;
  v_id UUID;
  v_prev UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_registrar_validacion_identidad: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_registrar_validacion_identidad: solo asesor'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exp FROM public.expedientes e
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_exp.organization_id IS DISTINCT FROM v_org OR NOT public.asesor_can_operate_expediente_as(v_actor, p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_registrar_validacion_identidad: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_tipo IS NULL OR p_estado IS NULL OR p_metodo IS NULL THEN
    RAISE EXCEPTION 'asesor_registrar_validacion_identidad: tipo/estado/metodo obligatorios'
      USING ERRCODE = '22023';
  END IF;

  IF p_tipo = 'rfc_validacion_sat' THEN
    IF p_estado IS DISTINCT FROM 'RFC_VALIDACION_SAT_PENDIENTE' THEN
      RAISE EXCEPTION 'asesor_registrar_validacion_identidad: rfc_validacion_sat solo PENDIENTE desde cliente'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.cliente_validaciones_identidad v
      WHERE v.expediente_id = p_expediente_id
        AND v.tipo = 'rfc_validacion_sat'
        AND v.vigente = true
        AND v.estado IN (
          'RFC_VALIDACION_SAT_VALIDADO',
          'RFC_VALIDACION_SAT_INVALIDO',
          'RFC_VALIDACION_SAT_REVISION_MANUAL',
          'RFC_VALIDACION_SAT_APROBADO_ADMIN'
        )
    ) THEN
      RETURN (
        SELECT jsonb_build_object(
          'ok', true,
          'unchanged', true,
          'id', v.id,
          'tipo', v.tipo,
          'estado', v.estado
        )
        FROM public.cliente_validaciones_identidad v
        WHERE v.expediente_id = p_expediente_id
          AND v.tipo = 'rfc_validacion_sat'
          AND v.vigente = true
        LIMIT 1
      );
    END IF;
  END IF;

  -- Invalidar vigente previa del mismo tipo
  UPDATE public.cliente_validaciones_identidad
  SET vigente = false,
      invalidado_at = now(),
      invalidado_motivo = 'reemplazo',
      updated_at = now()
  WHERE expediente_id = p_expediente_id
    AND tipo = p_tipo
    AND vigente = true
  RETURNING id INTO v_prev;

  INSERT INTO public.cliente_validaciones_identidad (
    organization_id, expediente_id, tipo, estado, metodo, proveedor,
    documento_id, documento_version, input_fingerprint, resultado_resumido,
    realizado_por, realizado_por_rol, vigente
  ) VALUES (
    v_org, p_expediente_id, p_tipo, p_estado, p_metodo, coalesce(nullif(btrim(p_proveedor), ''), 'local'),
    p_documento_id, p_documento_version, coalesce(p_input_fingerprint, ''),
    coalesce(p_resultado_resumido, '{}'::jsonb),
    v_actor, v_role, true
  ) RETURNING id INTO v_id;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'identidad.validacion.registrar',
    'expediente', p_expediente_id,
    jsonb_build_object(
      'validacion_id', v_id,
      'prev_id', v_prev,
      'tipo', p_tipo,
      'estado', p_estado,
      'metodo', p_metodo,
      'documento_id', p_documento_id,
      'documento_version', p_documento_version
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'tipo', p_tipo,
    'estado', p_estado
  );
END;
$$;
REVOKE ALL ON FUNCTION public.asesor_registrar_validacion_identidad(UUID, TEXT, TEXT, TEXT, JSONB, UUID, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_registrar_validacion_identidad(UUID, TEXT, TEXT, TEXT, JSONB, UUID, INT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_registrar_validacion_identidad(UUID, TEXT, TEXT, TEXT, JSONB, UUID, INT, TEXT, TEXT) TO authenticated;
-- ---------------------------------------------------------------------------
-- 3) server_registrar_validacion_fiscal_sat (service_role only)
--    Estados: VALIDADO | INVALIDO | REVISION_MANUAL  (NO APROBADO_ADMIN)
--    Binding: EDC id+versión + curp_sha256 + rfc_datos_sha256 + rfc_infonavit_sha256
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_registrar_validacion_fiscal_sat(
  p_expediente_id UUID,
  p_estado TEXT,
  p_resultado_resumido JSONB DEFAULT '{}'::jsonb,
  p_fiscal_rfc TEXT DEFAULT NULL,
  p_edc_documento_id UUID DEFAULT NULL,
  p_edc_version INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_id UUID;
  v_prev UUID;
  v_estado TEXT := upper(btrim(coalesce(p_estado, '')));
  v_res JSONB := coalesce(p_resultado_resumido, '{}'::jsonb);
  v_binding JSONB;
  v_fiscal_rfc TEXT := upper(btrim(coalesce(p_fiscal_rfc, '')));
  v_curp TEXT;
  v_fp TEXT;
  v_edc RECORD;
  v_attempt INT;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF v_estado NOT IN (
    'RFC_VALIDACION_SAT_VALIDADO',
    'RFC_VALIDACION_SAT_INVALIDO',
    'RFC_VALIDACION_SAT_REVISION_MANUAL'
  ) THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: estado inválido'
      USING ERRCODE = '22023';
  END IF;

  IF v_res ? 'rfc' OR v_res ? 'curp' OR v_res ? 'fiscalRfc' OR v_res ? 'fiscal_rfc' THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: evidencia con PII'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.organization_id INTO v_org
  FROM public.expedientes e
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  -- EDC pasado por la route debe ser el vigente del expediente
  SELECT d.id, d.version
  INTO v_edc
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = 'cliente_estado_cuenta'
    AND d.deleted_at IS NULL
  ORDER BY d.created_at DESC, d.version DESC NULLS LAST
  LIMIT 1;

  IF v_edc.id IS NULL THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: falta estado de cuenta'
      USING ERRCODE = '22023';
  END IF;

  IF p_edc_documento_id IS DISTINCT FROM v_edc.id
     OR p_edc_version IS DISTINCT FROM v_edc.version THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: EDC no coincide con vigente'
      USING ERRCODE = '22023';
  END IF;

  SELECT upper(btrim(coalesce(cd.datos->>'curp', '')))
  INTO v_curp
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF coalesce(v_curp, '') = '' THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: CURP ausente en cliente_datos'
      USING ERRCODE = '22023';
  END IF;

  IF v_fiscal_rfc = '' THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: fiscal_rfc obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_binding := public.fiscal_sat_binding_snapshot(p_expediente_id);
  IF v_binding IS NULL THEN
    RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: binding incompleto'
      USING ERRCODE = '22023';
  END IF;

  v_fp := encode(
    extensions.digest(
      v_fiscal_rfc || '|' || v_curp || '|' || v_edc.id::text || '|' || coalesce(v_edc.version, 0)::text,
      'sha256'
    ),
    'hex'
  );

  -- Guarda binding + máscaras; nunca RFC/CURP completos
  v_res := v_res || v_binding || jsonb_build_object(
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
        v_org, p_expediente_id, 'rfc_validacion_sat', v_estado,
        'api_oficial', 'sat_worker',
        v_edc.id, v_edc.version, v_fp,
        v_res,
        NULL, NULL, true
      ) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempt = 2 THEN
          RAISE EXCEPTION 'server_registrar_validacion_fiscal_sat: conflicto concurrente de vigencia'
            USING ERRCODE = '23505';
        END IF;
        v_prev := NULL;
    END;
  END LOOP;

  PERFORM public.log_action(
    v_org,
    NULL,
    NULL,
    'identidad.validacion.fiscal_sat',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'validacion_id', v_id,
      'prev_id', v_prev,
      'estado', v_estado,
      'source', 'sat_worker',
      'edc_documento_id', v_edc.id,
      'edc_version', v_edc.version
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'estado', v_estado);
END;
$$;

REVOKE ALL ON FUNCTION public.server_registrar_validacion_fiscal_sat(UUID, TEXT, JSONB, TEXT, UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.server_registrar_validacion_fiscal_sat(UUID, TEXT, JSONB, TEXT, UUID, INT) FROM anon;
REVOKE ALL ON FUNCTION public.server_registrar_validacion_fiscal_sat(UUID, TEXT, JSONB, TEXT, UUID, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.server_registrar_validacion_fiscal_sat(UUID, TEXT, JSONB, TEXT, UUID, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Helper: ¿pase fiscal OK para enviar? (estado + binding vigente)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fiscal_sat_gate_allows_envio(p_expediente_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cliente_validaciones_identidad v
    WHERE v.expediente_id = p_expediente_id
      AND v.tipo = 'rfc_validacion_sat'
      AND v.vigente = true
      AND v.estado IN (
        'RFC_VALIDACION_SAT_VALIDADO',
        'RFC_VALIDACION_SAT_APROBADO_ADMIN'
      )
      AND coalesce(v.input_fingerprint, '') <> ''
      AND public.fiscal_sat_binding_matches(v.resultado_resumido, p_expediente_id)
  );
$$;

REVOKE ALL ON FUNCTION public.fiscal_sat_gate_allows_envio(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_gate_allows_envio(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_gate_allows_envio(UUID) TO service_role;
-- ---------------------------------------------------------------------------
-- 5) Núcleo interno (SIN grant a authenticated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enviar_a_mesa_core(
  p_expediente_id UUID,
  p_actor_id UUID,
  p_actor_role public.app_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $enviar_mesa$
DECLARE
  v_org_id UUID;
  v_exp RECORD;
  v_editor public.editor_decisions%ROWTYPE;
  v_cliente public.cliente_datos%ROWTYPE;
  v_docs_count INTEGER;
  v_etapa_anterior SMALLINT;
  v_subestado_anterior public.operativo_subestado;
  v_now TIMESTAMPTZ := NOW();
  v_elig JSONB;
BEGIN
  IF p_expediente_id IS NULL OR p_actor_id IS NULL OR p_actor_role IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa_core: actor y expediente obligatorios'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.organization_id
  INTO v_org_id
  FROM public.profiles p
  WHERE p.id = p_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.programa,
    e.nss,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at,
    e.origen_mesa
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  -- GATE FISCAL (única lógica de negocio nueva; flag global O piloto)
  IF public.fiscal_sat_gate_applies_to_expediente(p_expediente_id)
     AND NOT public.fiscal_sat_gate_allows_envio(p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: requiere validación SAT vigente (VALIDADO o APROBADO_ADMIN) con huella vigente'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'enviar_a_mesa: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    RAISE EXCEPTION 'enviar_a_mesa: el expediente ya fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: falta decisión del editor'
      USING ERRCODE = '22023';
  END IF;

  IF v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'enviar_a_mesa: monto aprobado del editor debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cliente
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan datos del cliente'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.porcentaje_cobro IS NULL
     OR v_cliente.porcentaje_cobro <= 0
     OR v_cliente.monto_calculado IS NULL
     OR btrim(COALESCE(v_cliente.metodo_pago, '')) = '' THEN
    RAISE EXCEPTION 'enviar_a_mesa: Faltan datos obligatorios del cliente: porcentaje de cobro, monto calculado, método de pago.'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado NOT IN ('completo', 'validado') THEN
    RAISE EXCEPTION 'enviar_a_mesa: datos del cliente deben estar completos o validados (actual: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  v_elig := public.p189_infonavit_get_eligibility(p_expediente_id);
  IF COALESCE((v_elig->>'required')::boolean, false) THEN
    PERFORM public.assert_mejoravit_infonavit_datos_persistidos(p_expediente_id);
  END IF;

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);

  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan documentos obligatorios de integración (% de %)', v_docs_count, cardinality(public.integration_doc_tipos_requeridos_para_expediente(p_expediente_id))
      USING ERRCODE = '22023';
  END IF;

  IF public.nss_bloqueado_en_mesa(v_exp.organization_id, v_exp.nss, v_exp.programa, p_expediente_id) THEN
    RAISE EXCEPTION 'NSS_YA_BLOQUEADO: Este NSS ya tiene un expediente enviado a Mesa.'
      USING ERRCODE = '23505';
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;

  UPDATE public.expedientes
  SET
    submitted_to_mesa = true,
    fecha_envio_mesa = v_now,
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    updated_at = v_now
  WHERE id = p_expediente_id;

  IF COALESCE((v_elig->>'should_enqueue')::boolean, false) THEN
    PERFORM public.enqueue_infonavit_pdf_submission(
      p_expediente_id,
      v_exp.organization_id,
      0,
      'initial',
      v_now
    );
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    p_actor_id,
    p_actor_role,
    'expediente.enviar_a_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'asesor_id', v_exp.asesor_id,
      'organization_id', v_exp.organization_id,
      'etapa_anterior', v_etapa_anterior,
      'etapa_nueva', 1,
      'subestado_anterior', v_subestado_anterior,
      'subestado_nuevo', 'en_validacion_mesa',
      'documentos_obligatorios_count', v_docs_count,
      'documentos_asesor_envio_count', v_docs_count,
      'editor_decision_id', v_editor.expediente_id,
      'origen_mesa', v_exp.origen_mesa,
      'fiscal_sat_gate', public.fiscal_sat_gate_applies_to_expediente(p_expediente_id)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'etapa_actual', 1,
    'subestado', 'en_validacion_mesa',
    'operativo_subestado', 'en_validacion_mesa',
    'submitted_to_mesa', true,
    'enviado_a_mesa', true,
    'documentos_obligatorios_count', v_docs_count
  );
END;
$enviar_mesa$;
REVOKE ALL ON FUNCTION public.enviar_a_mesa_core(UUID, UUID, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_a_mesa_core(UUID, UUID, public.app_role) FROM anon;
REVOKE ALL ON FUNCTION public.enviar_a_mesa_core(UUID, UUID, public.app_role) FROM authenticated;
-- ---------------------------------------------------------------------------
-- 6) Wrapper público enviar_a_mesa (asesor dueño)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enviar_a_mesa(p_expediente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $enviar_mesa$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role
  INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'enviar_a_mesa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: solo el asesor dueño puede enviar a Mesa'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.enviar_a_mesa_core(p_expediente_id, v_actor_id, v_actor_role);
END;
$enviar_mesa$;
COMMENT ON FUNCTION public.enviar_a_mesa(UUID) IS
  'Envío a Mesa por asesor dueño. Gate fiscal si fiscal_sat_gate_enabled O asesor en piloto.';

REVOKE ALL ON FUNCTION public.enviar_a_mesa(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_a_mesa(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_a_mesa(UUID) TO authenticated;
-- ---------------------------------------------------------------------------
-- 7) Admin aprueba sin PASS SAT → APROBADO_ADMIN + core (congela binding)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_aprobar_envio_mesa_sin_fiscal(
  p_expediente_id UUID,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_motivo TEXT := nullif(btrim(p_motivo), '');
  v_id UUID;
  v_prev UUID;
  v_sent JSONB;
  v_binding JSONB;
  v_fp TEXT;
  v_attempt INT;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'admin_aprobar_envio_mesa_sin_fiscal: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND OR v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'admin_aprobar_envio_mesa_sin_fiscal: solo super_admin'
      USING ERRCODE = '42501';
  END IF;

  IF v_motivo IS NULL OR char_length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'admin_aprobar_envio_mesa_sin_fiscal: motivo obligatorio (>=10)'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.expedientes e
    WHERE e.id = p_expediente_id
      AND e.deleted_at IS NULL
      AND e.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'admin_aprobar_envio_mesa_sin_fiscal: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cliente_validaciones_identidad v
    WHERE v.expediente_id = p_expediente_id
      AND v.tipo = 'rfc_validacion_sat'
      AND v.vigente = true
      AND v.estado = 'RFC_VALIDACION_SAT_REVISION_MANUAL'
  ) THEN
    RAISE EXCEPTION 'admin_aprobar_envio_mesa_sin_fiscal: requiere revision_manual vigente'
      USING ERRCODE = 'P0001';
  END IF;

  v_binding := public.fiscal_sat_binding_snapshot(p_expediente_id);
  IF v_binding IS NULL THEN
    RAISE EXCEPTION 'admin_aprobar_envio_mesa_sin_fiscal: binding incompleto (EDC/CURP)'
      USING ERRCODE = '22023';
  END IF;

  v_fp := encode(
    extensions.digest(
      'APROBADO_ADMIN|' ||
      (v_binding->>'edc_documento_id') || '|' ||
      coalesce(v_binding->>'edc_version', '0') || '|' ||
      (v_binding->>'curp_sha256') || '|' ||
      (v_binding->>'rfc_datos_sha256') || '|' ||
      (v_binding->>'rfc_infonavit_sha256'),
      'sha256'
    ),
    'hex'
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
        v_org,
        p_expediente_id,
        'rfc_validacion_sat',
        'RFC_VALIDACION_SAT_APROBADO_ADMIN',
        'manual_asistido',
        'super_admin',
        (v_binding->>'edc_documento_id')::uuid,
        NULLIF(v_binding->>'edc_version', '')::int,
        v_fp,
        v_binding || jsonb_build_object(
          'motivo', left(v_motivo, 500),
          'aprobado_por', v_actor
        ),
        v_actor,
        v_role,
        true
      ) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempt = 2 THEN
          RAISE EXCEPTION 'admin_aprobar_envio_mesa_sin_fiscal: conflicto concurrente de vigencia'
            USING ERRCODE = '23505';
        END IF;
        v_prev := NULL;
    END;
  END LOOP;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'mesa.envio.aprobar_sin_fiscal',
    'expediente', p_expediente_id,
    jsonb_build_object(
      'validacion_id', v_id,
      'prev_id', v_prev,
      'motivo', left(v_motivo, 500),
      'edc_documento_id', v_binding->>'edc_documento_id',
      'edc_version', v_binding->>'edc_version'
    )
  );

  v_sent := public.enviar_a_mesa_core(p_expediente_id, v_actor, v_role);
  RETURN coalesce(v_sent, jsonb_build_object('ok', true, 'validacion_id', v_id));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_aprobar_envio_mesa_sin_fiscal(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_aprobar_envio_mesa_sin_fiscal(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_aprobar_envio_mesa_sin_fiscal(UUID, TEXT) TO authenticated;

COMMIT;
