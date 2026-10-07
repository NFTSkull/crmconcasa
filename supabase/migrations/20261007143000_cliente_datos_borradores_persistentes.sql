-- ConCasa CRM — borrador persistente y no destructivo para Datos Generales
-- Aditivo: no modifica ni borra cliente_datos/expedientes existentes.

CREATE TABLE IF NOT EXISTS public.cliente_datos_borradores (
  expediente_id UUID PRIMARY KEY
    REFERENCES public.expedientes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  asesor_id UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  draft JSONB NOT NULL DEFAULT '{}'::JSONB,
  draft_version INTEGER NOT NULL DEFAULT 1 CHECK (draft_version >= 1),
  client_updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cliente_datos_borradores_asesor_idx
  ON public.cliente_datos_borradores (asesor_id, updated_at DESC);

ALTER TABLE public.cliente_datos_borradores ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cliente_datos_borradores
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.asesor_guardar_cliente_datos_borrador(
  p_expediente_id UUID,
  p_draft JSONB,
  p_draft_version INTEGER DEFAULT 1,
  p_client_updated_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_exp RECORD;
  v_client_updated_at TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_borrador: usuario no autenticado'
      USING ERRCODE='42501';
  END IF;

  SELECT p.app_role
  INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = TRUE;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_borrador: rol no autorizado'
      USING ERRCODE='42501';
  END IF;

  SELECT e.id, e.organization_id, e.asesor_id, e.ciclo_estado, e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_borrador: expediente no disponible'
      USING ERRCODE='P0002';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_borrador: solo el asesor dueño puede guardar'
      USING ERRCODE='42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_borrador: expediente no activo'
      USING ERRCODE='22023';
  END IF;

  IF p_draft IS NULL OR jsonb_typeof(p_draft) <> 'object' THEN
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_borrador: borrador inválido'
      USING ERRCODE='22023';
  END IF;

  IF octet_length(p_draft::TEXT) > 262144 THEN
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_borrador: borrador demasiado grande'
      USING ERRCODE='22023';
  END IF;

  v_client_updated_at := COALESCE(p_client_updated_at, NOW());

  INSERT INTO public.cliente_datos_borradores (
    expediente_id,
    organization_id,
    asesor_id,
    draft,
    draft_version,
    client_updated_at,
    created_at,
    updated_at
  )
  VALUES (
    p_expediente_id,
    v_exp.organization_id,
    v_actor_id,
    p_draft,
    GREATEST(COALESCE(p_draft_version, 1), 1),
    v_client_updated_at,
    NOW(),
    NOW()
  )
  ON CONFLICT (expediente_id) DO UPDATE
  SET
    organization_id = EXCLUDED.organization_id,
    asesor_id = EXCLUDED.asesor_id,
    draft = EXCLUDED.draft,
    draft_version = EXCLUDED.draft_version,
    client_updated_at = EXCLUDED.client_updated_at,
    updated_at = NOW()
  WHERE EXCLUDED.client_updated_at >= public.cliente_datos_borradores.client_updated_at;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'expediente_id', p_expediente_id,
    'client_updated_at', v_client_updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.asesor_leer_cliente_datos_borrador(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_owner_id UUID;
  v_deleted_at TIMESTAMPTZ;
  v_row RECORD;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_leer_cliente_datos_borrador: usuario no autenticado'
      USING ERRCODE='42501';
  END IF;

  SELECT p.app_role
  INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = TRUE;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_leer_cliente_datos_borrador: rol no autorizado'
      USING ERRCODE='42501';
  END IF;

  SELECT e.asesor_id, e.deleted_at
  INTO v_owner_id, v_deleted_at
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_leer_cliente_datos_borrador: expediente no disponible'
      USING ERRCODE='P0002';
  END IF;

  IF v_owner_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'asesor_leer_cliente_datos_borrador: solo el asesor dueño puede leer'
      USING ERRCODE='42501';
  END IF;

  SELECT d.draft, d.draft_version, d.client_updated_at, d.updated_at
  INTO v_row
  FROM public.cliente_datos_borradores d
  WHERE d.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', TRUE, 'draft', NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'draft', v_row.draft,
    'draft_version', v_row.draft_version,
    'client_updated_at', v_row.client_updated_at,
    'updated_at', v_row.updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.asesor_borrar_cliente_datos_borrador(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_owner_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_borrar_cliente_datos_borrador: usuario no autenticado'
      USING ERRCODE='42501';
  END IF;

  SELECT p.app_role
  INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = TRUE;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_borrar_cliente_datos_borrador: rol no autorizado'
      USING ERRCODE='42501';
  END IF;

  SELECT e.asesor_id
  INTO v_owner_id
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL;

  IF NOT FOUND OR v_owner_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'asesor_borrar_cliente_datos_borrador: expediente no autorizado'
      USING ERRCODE='42501';
  END IF;

  DELETE FROM public.cliente_datos_borradores d
  WHERE d.expediente_id = p_expediente_id;

  RETURN jsonb_build_object('ok', TRUE, 'expediente_id', p_expediente_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.asesor_guardar_cliente_datos_borrador(UUID, JSONB, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.asesor_leer_cliente_datos_borrador(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.asesor_borrar_cliente_datos_borrador(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.asesor_guardar_cliente_datos_borrador(UUID, JSONB, INTEGER, TIMESTAMPTZ)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asesor_leer_cliente_datos_borrador(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asesor_borrar_cliente_datos_borrador(UUID)
  TO authenticated, service_role;

COMMENT ON TABLE public.cliente_datos_borradores IS
  'Borrador transitorio de Datos Generales. No participa en Mesa, validación, completitud ni flujo operativo.';
