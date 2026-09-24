-- ROLLBACK 228 fiscal_sat_gate_server_write
-- Restaura enviar_a_mesa (20260904120000) y asesor_registrar (p208 exacto).
-- Restaura grants de cliente_validaciones_identidad como en producción pre-228.
-- NO borra app_settings ni filas de validación.

CREATE OR REPLACE FUNCTION public.enviar_a_mesa(p_expediente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $enviar_mesa$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
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
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
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

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: solo el asesor dueño puede enviar a Mesa'
      USING ERRCODE = '42501';
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
    v_actor_id,
    v_actor_role,
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
      'origen_mesa', v_exp.origen_mesa
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

COMMENT ON FUNCTION public.enviar_a_mesa(UUID) IS
  'Envío a Mesa por asesor dueño (rollback pre-gate fiscal).';

REVOKE ALL ON FUNCTION public.enviar_a_mesa(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_a_mesa(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_a_mesa(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_a_mesa(UUID) TO service_role;

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
GRANT EXECUTE ON FUNCTION public.asesor_registrar_validacion_identidad(UUID, TEXT, TEXT, TEXT, JSONB, UUID, INT, TEXT, TEXT) TO service_role;

-- Grants tabla como en producción pre-228 (authenticated mutaba vía grants; RLS solo SELECT)
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.cliente_validaciones_identidad TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.cliente_validaciones_identidad TO service_role;

DROP FUNCTION IF EXISTS public.enviar_a_mesa_core(UUID, UUID, public.app_role);
DROP FUNCTION IF EXISTS public.server_registrar_validacion_fiscal_sat(UUID, TEXT, JSONB, TEXT, UUID, INT);
DROP FUNCTION IF EXISTS public.admin_aprobar_envio_mesa_sin_fiscal(UUID, TEXT);
DROP FUNCTION IF EXISTS public.fiscal_sat_gate_allows_envio(UUID);
DROP FUNCTION IF EXISTS public.fiscal_sat_gate_applies_to_expediente(UUID);
DROP FUNCTION IF EXISTS public.fiscal_sat_binding_matches(JSONB, UUID);
DROP FUNCTION IF EXISTS public.fiscal_sat_binding_snapshot(UUID);
DROP FUNCTION IF EXISTS public.app_setting_bool(TEXT, BOOLEAN);
