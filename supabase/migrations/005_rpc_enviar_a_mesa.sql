-- ConCasa CRM — P2C-3 RPC enviar_a_mesa (asesor envía integración a Mesa)

-- =============================================================================
-- Helpers internos (catálogo integración etapa 1 — alineado con docs/PRODUCTO.md)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.integration_doc_tipos_obligatorios()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'ine',
    'estado_cuenta',
    'nss',
    'direccion',
    'cliente_ine_frente',
    'cliente_ine_reverso',
    'cliente_comprobante_domicilio',
    'cliente_estado_cuenta',
    'cliente_acta_nacimiento',
    'cliente_constancia_sat'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.count_integration_docs_presentes(p_expediente_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM unnest(public.integration_doc_tipos_obligatorios()) AS req(tipo)
  WHERE EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND d.tipo_documento = req.tipo
      AND d.deleted_at IS NULL
      AND d.estatus_revision IN ('subido', 'resubido', 'validado')
  );
$$;

CREATE OR REPLACE FUNCTION public.integration_docs_completos(p_expediente_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.count_integration_docs_presentes(p_expediente_id)
    = cardinality(public.integration_doc_tipos_obligatorios());
$$;

REVOKE ALL ON FUNCTION public.integration_doc_tipos_obligatorios() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_integration_docs_presentes(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.integration_docs_completos(UUID) FROM PUBLIC;

-- =============================================================================
-- enviar_a_mesa
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enviar_a_mesa(p_expediente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at,
    e.origen_mesa
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

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

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
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

  IF v_editor.decision <> 'aprobado' THEN
    RAISE EXCEPTION 'enviar_a_mesa: decisión del editor debe ser aprobado (actual: %)', v_editor.decision
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

  IF NULLIF(btrim(COALESCE(v_cliente.datos->>'rfc', '')), '') IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: RFC del cliente es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado NOT IN ('completo', 'validado') THEN
    RAISE EXCEPTION 'enviar_a_mesa: datos del cliente deben estar completos o validados (actual: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);

  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan documentos obligatorios de integración (% de %)', v_docs_count, cardinality(public.integration_doc_tipos_obligatorios())
      USING ERRCODE = '22023';
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;

  UPDATE public.expedientes
  SET
    submitted_to_mesa = true,
    fecha_envio_mesa = NOW(),
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    updated_at = NOW()
  WHERE id = p_expediente_id;

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
$$;

COMMENT ON FUNCTION public.enviar_a_mesa(UUID) IS
  'Asesor dueño envía expediente a Mesa (integración). Gates: editor aprobado+monto, RFC, cliente_datos completo, docs obligatorios.';

REVOKE ALL ON FUNCTION public.enviar_a_mesa(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_a_mesa(UUID) FROM anon;

GRANT EXECUTE ON FUNCTION public.enviar_a_mesa(UUID) TO authenticated;
