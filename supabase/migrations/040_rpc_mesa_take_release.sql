-- ConCasa CRM — Fase 1A: RPCs tomar/liberar expediente Mesa (modo sombra)
-- No invocadas por flujos existentes; no bloquean avance/cancel/documentos.

-- =============================================================================
-- ensure_mesa_expediente_ops_row — creación idempotente bajo lock
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ensure_mesa_expediente_ops_row(
  p_expediente_id UUID,
  p_organization_id UUID
)
RETURNS public.mesa_expediente_ops
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mesa_expediente_ops;
BEGIN
  INSERT INTO public.mesa_expediente_ops (
    expediente_id,
    organization_id,
    estado_mesa,
    last_activity_at
  )
  SELECT
    e.id,
    e.organization_id,
    'sin_asignar'::public.mesa_expediente_estado,
    COALESCE(e.fecha_envio_mesa, e.created_at)
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.organization_id = p_organization_id
  ON CONFLICT (expediente_id) DO NOTHING;

  SELECT *
  INTO v_row
  FROM public.mesa_expediente_ops mo
  WHERE mo.expediente_id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ensure_mesa_expediente_ops_row: fila ops no encontrada'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.ensure_mesa_expediente_ops_row(UUID, UUID) IS
  'Fase 1A: inserta fila ops sin_asignar si falta y devuelve fila bloqueada FOR UPDATE.';

REVOKE ALL ON FUNCTION public.ensure_mesa_expediente_ops_row(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_mesa_expediente_ops_row(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_mesa_expediente_ops_row(UUID, UUID) FROM authenticated;

-- =============================================================================
-- mesa_take_expediente
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_take_expediente(p_expediente_id UUID)
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
  v_ops public.mesa_expediente_ops;
  v_prev_estado public.mesa_expediente_estado;
  v_prev_assigned UUID;
  v_now TIMESTAMPTZ := NOW();
  v_idempotent BOOLEAN := false;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_take_expediente: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_take_expediente: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_take_expediente: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_take_expediente: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_take_expediente: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_take_expediente: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'mesa_take_expediente: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_take_expediente: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'mesa_take_expediente: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'mesa_take_expediente: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  v_ops := public.ensure_mesa_expediente_ops_row(p_expediente_id, v_exp.organization_id);
  v_prev_estado := v_ops.estado_mesa;
  v_prev_assigned := v_ops.assigned_to;

  IF v_ops.assigned_to IS NOT NULL AND v_ops.assigned_to = v_actor_id THEN
    v_idempotent := true;
  ELSIF v_ops.assigned_to IS NOT NULL AND v_ops.assigned_to IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'mesa_take_expediente: expediente asignado a otro operador'
      USING ERRCODE = '23505';
  ELSIF v_ops.estado_mesa = 'sin_asignar' AND v_ops.assigned_to IS NULL THEN
    UPDATE public.mesa_expediente_ops
    SET
      estado_mesa = 'trabajando',
      assigned_to = v_actor_id,
      assigned_at = v_now,
      last_activity_at = v_now,
      updated_at = v_now
    WHERE expediente_id = p_expediente_id
    RETURNING * INTO v_ops;
  ELSE
    RAISE EXCEPTION 'mesa_take_expediente: estado operativo no permite tomar (%)', v_ops.estado_mesa
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_idempotent THEN
    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'mesa.expediente.take',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'estado_mesa_anterior', v_prev_estado,
        'estado_mesa_nuevo', v_ops.estado_mesa,
        'assigned_to_anterior', v_prev_assigned,
        'assigned_to_nuevo', v_ops.assigned_to,
        'assigned_at', v_ops.assigned_at
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', v_idempotent,
    'expediente_id', p_expediente_id,
    'estado_mesa', v_ops.estado_mesa,
    'assigned_to', v_ops.assigned_to,
    'assigned_at', v_ops.assigned_at
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_take_expediente(UUID) IS
  'Fase 1A: operador Mesa toma expediente sin_asignar. Idempotente si ya es responsable. Modo sombra.';

REVOKE ALL ON FUNCTION public.mesa_take_expediente(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_take_expediente(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_take_expediente(UUID) TO authenticated;

-- =============================================================================
-- mesa_release_expediente
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_release_expediente(
  p_expediente_id UUID,
  p_motivo TEXT DEFAULT NULL
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
  v_ops public.mesa_expediente_ops;
  v_motivo TEXT;
  v_prev_assigned UUID;
  v_prev_estado public.mesa_expediente_estado;
  v_now TIMESTAMPTZ := NOW();
  v_is_admin BOOLEAN;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_release_expediente: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_release_expediente: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_release_expediente: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_release_expediente: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_is_admin := v_actor_role IN ('mesa_admin', 'super_admin');

  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_release_expediente: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_release_expediente: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'mesa_release_expediente: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_release_expediente: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'mesa_release_expediente: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'mesa_release_expediente: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  v_ops := public.ensure_mesa_expediente_ops_row(p_expediente_id, v_exp.organization_id);
  v_prev_assigned := v_ops.assigned_to;
  v_prev_estado := v_ops.estado_mesa;

  IF v_prev_assigned IS NULL THEN
    RAISE EXCEPTION 'mesa_release_expediente: el expediente no tiene responsable asignado'
      USING ERRCODE = '22023';
  END IF;

  IF v_prev_assigned = v_actor_id THEN
    NULL;
  ELSIF v_is_admin OR v_actor_role = 'super_admin' THEN
    IF v_motivo IS NULL THEN
      RAISE EXCEPTION 'mesa_release_expediente: el motivo es obligatorio al liberar expediente de otro operador'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'mesa_release_expediente: solo el responsable o un administrador puede liberar'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.mesa_expediente_ops
  SET
    estado_mesa = 'sin_asignar',
    assigned_to = NULL,
    assigned_at = NULL,
    last_activity_at = v_now,
    updated_at = v_now
  WHERE expediente_id = p_expediente_id
  RETURNING * INTO v_ops;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'mesa.expediente.release',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'motivo', v_motivo,
      'estado_mesa_anterior', v_prev_estado,
      'estado_mesa_nuevo', v_ops.estado_mesa,
      'assigned_to_anterior', v_prev_assigned,
      'assigned_to_nuevo', v_ops.assigned_to,
      'released_by_admin', (v_prev_assigned IS DISTINCT FROM v_actor_id)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'estado_mesa', v_ops.estado_mesa,
    'previous_assigned_to', v_prev_assigned
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_release_expediente(UUID, TEXT) IS
  'Fase 1A: libera responsable operativo Mesa. Admin/super_admin requieren motivo si liberan a otro. Modo sombra.';

REVOKE ALL ON FUNCTION public.mesa_release_expediente(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_release_expediente(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_release_expediente(UUID, TEXT) TO authenticated;
