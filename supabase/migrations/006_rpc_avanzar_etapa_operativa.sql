-- ConCasa CRM — P2C-4 RPC avanzar_etapa_operativa (Mesa avanza etapa 1→2)

-- =============================================================================
-- Helpers: documentos obligatorios de integración en estatus validado
-- =============================================================================
CREATE OR REPLACE FUNCTION public.count_integration_docs_validados(p_expediente_id UUID)
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
      AND d.estatus_revision = 'validado'
  );
$$;

CREATE OR REPLACE FUNCTION public.integration_docs_todos_validados(p_expediente_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.count_integration_docs_validados(p_expediente_id)
    = cardinality(public.integration_doc_tipos_obligatorios());
$$;

REVOKE ALL ON FUNCTION public.count_integration_docs_validados(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.integration_docs_todos_validados(UUID) FROM PUBLIC;

-- =============================================================================
-- avanzar_etapa_operativa (solo transición 1 → 2)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.avanzar_etapa_operativa(
  p_expediente_id UUID,
  p_comentario TEXT DEFAULT NULL
)
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
  v_cliente public.cliente_datos%ROWTYPE;
  v_docs_validados INTEGER;
  v_subestado_anterior public.operativo_subestado;
  v_comentario_final TEXT;
  v_subestado_nuevo public.operativo_subestado := 'en_proceso';
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_comentario_final := NULLIF(btrim(COALESCE(p_comentario, '')), '');

  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual <> 1 THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: solo se permite avanzar desde etapa 1 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_validacion_mesa' THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_validacion_mesa (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cliente
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: faltan datos del cliente'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado <> 'validado' THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: datos del cliente deben estar validados por Mesa (actual: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  v_docs_validados := public.count_integration_docs_validados(p_expediente_id);

  IF NOT public.integration_docs_todos_validados(p_expediente_id) THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: faltan documentos obligatorios validados (% de %)', v_docs_validados, cardinality(public.integration_doc_tipos_obligatorios())
      USING ERRCODE = '22023';
  END IF;

  v_subestado_anterior := v_exp.subestado;

  UPDATE public.expedientes
  SET
    etapa_actual = 2,
    subestado = v_subestado_nuevo,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.avanzar_etapa_operativa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'etapa_anterior', 1,
      'etapa_nueva', 2,
      'subestado_anterior', v_subestado_anterior,
      'subestado_nuevo', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'documentos_obligatorios_validados_count', v_docs_validados
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'etapa_anterior', 1,
    'etapa_actual', 2,
    'subestado', v_subestado_nuevo,
    'operativo_subestado', v_subestado_nuevo,
    'documentos_obligatorios_validados_count', v_docs_validados
  );
END;
$$;

COMMENT ON FUNCTION public.avanzar_etapa_operativa(UUID, TEXT) IS
  'Mesa avanza expediente de etapa 1 a 2 tras validar integración documental y datos cliente. Solo transición 1→2.';

REVOKE ALL ON FUNCTION public.avanzar_etapa_operativa(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avanzar_etapa_operativa(UUID, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.avanzar_etapa_operativa(UUID, TEXT) TO authenticated;
