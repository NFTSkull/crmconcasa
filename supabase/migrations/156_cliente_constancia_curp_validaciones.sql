-- ConCasa CRM — P156: Constancia CURP + validaciones identidad + RFC estimado (piloto)
-- No bloquea envío a Mesa. Sin OCR. Sin TaxDown/SAT oficial.

-- =============================================================================
-- Tipo documental cliente_constancia_curp (PDF, asesor dueño)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_opcionales()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'cliente_semanas_cotizadas',
    'cliente_carta_empresa',
    'cliente_acta_nacimiento_digital',
    'cliente_notificacion_apodaca',
    'cliente_notificacion',
    'asesor_evidencia',
    'cliente_constancia_curp'
  ];
$$;

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.integration_doc_tipos_asesor_envio()
      || public.integration_doc_tipos_asesor_opcionales();
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_opcionales() IS
  'P156: + cliente_constancia_curp (opcional, no gate).';

-- =============================================================================
-- Tabla cliente_validaciones_identidad
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.cliente_validaciones_identidad (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id),
  tipo TEXT NOT NULL,
  estado TEXT NOT NULL,
  metodo TEXT NOT NULL,
  proveedor TEXT NOT NULL DEFAULT 'local',
  documento_id UUID REFERENCES public.expediente_documentos(id),
  documento_version INT,
  input_fingerprint TEXT NOT NULL DEFAULT '',
  resultado_resumido JSONB NOT NULL DEFAULT '{}'::jsonb,
  realizado_por UUID REFERENCES public.profiles(id),
  realizado_por_rol public.app_role,
  realizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  vigente BOOLEAN NOT NULL DEFAULT true,
  invalidado_at TIMESTAMPTZ,
  invalidado_motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cliente_validaciones_identidad_tipo_chk CHECK (
    tipo = ANY (ARRAY[
      'curp_local',
      'curp_constancia',
      'curp_certificacion_registro_civil',
      'curp_coincidencia_datos',
      'rfc_estimado',
      'rfc_validacion_sat'
    ])
  ),
  CONSTRAINT cliente_validaciones_identidad_metodo_chk CHECK (
    metodo = ANY (ARRAY['local', 'pdf_constancia', 'manual_asistido', 'api_oficial'])
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS cliente_validaciones_identidad_vigente_uidx
  ON public.cliente_validaciones_identidad (expediente_id, tipo)
  WHERE vigente = true;

CREATE INDEX IF NOT EXISTS cliente_validaciones_identidad_exp_idx
  ON public.cliente_validaciones_identidad (expediente_id, realizado_at DESC);

COMMENT ON TABLE public.cliente_validaciones_identidad IS
  'P156: historial de validaciones CURP/RFC. Una vigente por (expediente, tipo). Sin texto PDF.';

ALTER TABLE public.cliente_validaciones_identidad ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cliente_validaciones_identidad_select ON public.cliente_validaciones_identidad;
CREATE POLICY cliente_validaciones_identidad_select
  ON public.cliente_validaciones_identidad
  FOR SELECT TO authenticated
  USING (public.can_see_expediente(expediente_id));

REVOKE ALL ON TABLE public.cliente_validaciones_identidad FROM PUBLIC;
REVOKE ALL ON TABLE public.cliente_validaciones_identidad FROM anon;
GRANT SELECT ON TABLE public.cliente_validaciones_identidad TO authenticated;

-- =============================================================================
-- RPC: listar vigentes
-- =============================================================================
CREATE OR REPLACE FUNCTION public.asesor_list_validaciones_identidad(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp public.expedientes%ROWTYPE;
  v_items JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: perfil inactivo'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
  IF NOT FOUND OR v_exp.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_role = 'asesor' AND v_exp.asesor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('asesor', 'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin', 'editor') THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.tipo), '[]'::jsonb)
  INTO v_items
  FROM public.cliente_validaciones_identidad v
  WHERE v.expediente_id = p_expediente_id AND v.vigente = true;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_list_validaciones_identidad(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_list_validaciones_identidad(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_list_validaciones_identidad(UUID) TO authenticated;

-- =============================================================================
-- RPC: registrar / invalidar
-- =============================================================================
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
  IF NOT FOUND OR v_exp.organization_id IS DISTINCT FROM v_org OR v_exp.asesor_id IS DISTINCT FROM v_actor THEN
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

DROP FUNCTION IF EXISTS public.asesor_invalidar_validaciones_identidad(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.asesor_invalidar_validaciones_identidad(
  p_expediente_id UUID,
  p_motivo TEXT DEFAULT 'datos_cambiaron',
  p_tipos TEXT[] DEFAULT NULL
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
  v_count INT;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_invalidar_validaciones_identidad: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_invalidar_validaciones_identidad: solo asesor'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exp FROM public.expedientes e
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_exp.asesor_id IS DISTINCT FROM v_actor OR v_exp.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'asesor_invalidar_validaciones_identidad: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  -- p_tipos NULL → todas las vigentes; si array → solo esos tipos (historial intacto)
  UPDATE public.cliente_validaciones_identidad
  SET vigente = false,
      invalidado_at = now(),
      invalidado_motivo = coalesce(nullif(btrim(p_motivo), ''), 'datos_cambiaron'),
      updated_at = now()
  WHERE expediente_id = p_expediente_id
    AND vigente = true
    AND (p_tipos IS NULL OR tipo = ANY (p_tipos));

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'identidad.validacion.invalidar',
    'expediente', p_expediente_id,
    jsonb_build_object(
      'count', v_count,
      'motivo', coalesce(p_motivo, 'datos_cambiaron'),
      'tipos', to_jsonb(p_tipos)
    )
  );

  RETURN jsonb_build_object('ok', true, 'invalidated', v_count, 'tipos', to_jsonb(p_tipos));
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_invalidar_validaciones_identidad(UUID, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_invalidar_validaciones_identidad(UUID, TEXT, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_invalidar_validaciones_identidad(UUID, TEXT, TEXT[]) TO authenticated;
