-- ConCasa CRM — P3C RPC create_expediente (asesor crea expediente + editor_decisions pendiente)

-- =============================================================================
-- create_expediente
-- =============================================================================
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

  v_nss := btrim(COALESCE(p_nss, ''));
  IF v_nss !~ '^[0-9]{11}$' THEN
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

  IF EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.organization_id = v_org_id
      AND e.nss = v_nss
      AND e.programa = p_programa
      AND e.ciclo_estado = 'activo'
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'create_expediente: ya existe un expediente activo con el mismo NSS y programa en esta organización'
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

COMMENT ON FUNCTION public.create_expediente(
  public.programa, TEXT, TEXT, TEXT, TEXT
) IS
  'Asesor activo crea expediente en ciclo activo etapa 1 + editor_decisions pendiente. origen_mesa desde profiles.tipo_asesor_origen.';

REVOKE ALL ON FUNCTION public.create_expediente(
  public.programa, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_expediente(
  public.programa, TEXT, TEXT, TEXT, TEXT
) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_expediente(
  public.programa, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
