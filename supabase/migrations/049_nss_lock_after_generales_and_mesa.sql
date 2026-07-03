-- ConCasa CRM — NSS bloqueado solo tras datos generales + envío a Mesa
-- P049: permite duplicar NSS en expedientes activos no enviados a Mesa

DROP INDEX IF EXISTS public.expedientes_nss_programa_activo_unique;

CREATE UNIQUE INDEX expedientes_nss_programa_mesa_enviado_unique
  ON public.expedientes (organization_id, nss, programa)
  WHERE ciclo_estado = 'activo'
    AND deleted_at IS NULL
    AND submitted_to_mesa = true;

CREATE OR REPLACE FUNCTION public.normalize_nss_mexico(p_nss TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(regexp_replace(btrim(COALESCE(p_nss, '')), '[^0-9]', '', 'g'), '');
$$;

COMMENT ON FUNCTION public.normalize_nss_mexico(TEXT) IS
  'NSS: solo dígitos (quita espacios, guiones y caracteres no numéricos).';

CREATE OR REPLACE FUNCTION public.nss_bloqueado_en_mesa(
  p_organization_id UUID,
  p_nss TEXT,
  p_programa public.programa,
  p_exclude_expediente_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.expedientes e
    INNER JOIN public.cliente_datos cd ON cd.expediente_id = e.id
    WHERE e.organization_id = p_organization_id
      AND e.nss = public.normalize_nss_mexico(p_nss)
      AND e.programa = p_programa
      AND e.ciclo_estado = 'activo'
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa = true
      AND (p_exclude_expediente_id IS NULL OR e.id IS DISTINCT FROM p_exclude_expediente_id)
  );
$$;

COMMENT ON FUNCTION public.nss_bloqueado_en_mesa(UUID, TEXT, public.programa, UUID) IS
  'true si otro expediente activo con mismo NSS/programa ya fue enviado a Mesa y tiene cliente_datos.';

REVOKE ALL ON FUNCTION public.normalize_nss_mexico(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nss_bloqueado_en_mesa(UUID, TEXT, public.programa, UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_expediente(
  p_programa public.programa,
  p_nss TEXT,
  p_cliente_nombre TEXT,
  p_telefono_cliente TEXT,
  p_direccion_opcional TEXT DEFAULT ''
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
  v_tipo_asesor public.tipo_asesor_origen;
  v_origen_mesa public.origen_mesa;
  v_nss TEXT;
  v_telefono TEXT;
  v_nombre TEXT;
  v_direccion TEXT;
  v_expediente_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'create_expediente: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id, p.tipo_asesor_origen
  INTO v_actor_role, v_org_id, v_tipo_asesor
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_expediente: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'create_expediente: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_programa IS NULL THEN
    RAISE EXCEPTION 'create_expediente: programa es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_nombre := btrim(COALESCE(p_cliente_nombre, ''));
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'create_expediente: el nombre del cliente es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_nss := public.normalize_nss_mexico(p_nss);
  IF v_nss IS NULL OR v_nss !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'create_expediente: el NSS debe tener exactamente 11 dígitos'
      USING ERRCODE = '22023';
  END IF;

  v_telefono := btrim(COALESCE(p_telefono_cliente, ''));
  IF v_telefono !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'create_expediente: el teléfono debe tener exactamente 10 dígitos'
      USING ERRCODE = '22023';
  END IF;

  v_direccion := COALESCE(btrim(COALESCE(p_direccion_opcional, '')), '');

  v_origen_mesa := COALESCE(v_tipo_asesor::text, 'interno')::public.origen_mesa;

  IF public.nss_bloqueado_en_mesa(v_org_id, v_nss, p_programa, NULL) THEN
    RAISE EXCEPTION 'create_expediente: Este NSS ya tiene un expediente enviado a Mesa.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.expedientes (
    organization_id,
    asesor_id,
    programa,
    nss,
    cliente_nombre,
    telefono_cliente,
    direccion_opcional,
    origen_mesa,
    ciclo_estado,
    submitted_to_mesa,
    etapa_actual,
    subestado,
    deleted_at
  ) VALUES (
    v_org_id,
    v_actor_id,
    p_programa,
    v_nss,
    v_nombre,
    v_telefono,
    v_direccion,
    v_origen_mesa,
    'activo',
    false,
    1,
    'pendiente',
    NULL
  )
  RETURNING id, created_at INTO v_expediente_id, v_created_at;

  INSERT INTO public.editor_decisions (
    expediente_id,
    organization_id,
    decision,
    monto_aprobado,
    notas_revision
  ) VALUES (
    v_expediente_id,
    v_org_id,
    'pendiente',
    NULL,
    ''
  );

  PERFORM public.log_action(
    v_org_id,
    v_actor_id,
    v_actor_role,
    'expediente.create',
    'expediente',
    v_expediente_id,
    jsonb_build_object(
      'programa', p_programa,
      'nss', v_nss,
      'cliente_nombre', v_nombre,
      'telefono_cliente', v_telefono,
      'origen_mesa', v_origen_mesa,
      'asesor_id', v_actor_id,
      'organization_id', v_org_id,
      'etapa_actual', 1,
      'subestado', 'pendiente',
      'ciclo_estado', 'activo'
    )
  );

  RETURN jsonb_build_object(
    'id', v_expediente_id,
    'organization_id', v_org_id,
    'asesor_id', v_actor_id,
    'origen_mesa', v_origen_mesa,
    'programa', p_programa,
    'nss', v_nss,
    'cliente_nombre', v_nombre,
    'telefono_cliente', v_telefono,
    'direccion_opcional', v_direccion,
    'etapa_actual', 1,
    'subestado', 'pendiente',
    'ciclo_estado', 'activo',
    'submitted_to_mesa', false,
    'created_at', v_created_at
  );
END;
$$;

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

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);

  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan documentos obligatorios de integración (% de %)', v_docs_count, cardinality(public.integration_doc_tipos_asesor_envio())
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
$$;

