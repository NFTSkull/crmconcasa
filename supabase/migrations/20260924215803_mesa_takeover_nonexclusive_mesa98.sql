-- ConCasa CRM — Mesa: asignación no exclusiva / takeover explícito.
-- Objetivo:
-- - cualquier operador Mesa ya autorizado puede tomar un expediente aunque tenga assigned_to;
-- - el takeover sólo cambia ownership operativo y conserva estados especiales;
-- - mesa98@concasa.mx nunca queda como dueño exclusivo: al "tomar" deja assigned_to NULL;
-- - no toca expedientes, etapas, subestados, documentos, citas ni agenda.
-- - conserva FOR UPDATE de ensure_mesa_expediente_ops_row para serializar tomas concurrentes.

DO $guard$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.mesa_take_expediente(uuid)'::regprocedure)
  INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MESA_TAKEOVER_ABORT: mesa_take_expediente no existe';
  END IF;

  IF strpos(v_def, 'mesa_take_expediente: expediente asignado a otro operador') = 0 THEN
    RAISE EXCEPTION 'MESA_TAKEOVER_ABORT: baseline de conflicto de asignación cambió';
  END IF;

  IF strpos(v_def, 'v_ops := public.ensure_mesa_expediente_ops_row') = 0 THEN
    RAISE EXCEPTION 'MESA_TAKEOVER_ABORT: baseline sin lock esperado';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.mesa_take_expediente(p_expediente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_email TEXT;
  v_org_id UUID;
  v_exp RECORD;
  v_ops public.mesa_expediente_ops;
  v_prev_estado public.mesa_expediente_estado;
  v_prev_assigned UUID;
  v_now TIMESTAMPTZ := NOW();
  v_idempotent BOOLEAN := false;
  v_shared_actor BOOLEAN := false;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_take_expediente: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id, p.email
  INTO v_actor_role, v_org_id, v_actor_email
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
  v_shared_actor := lower(btrim(COALESCE(v_actor_email, ''))) = 'mesa98@concasa.mx';

  -- Mesa 98 es cuenta compartida: nunca crea ownership exclusivo.
  -- Si toma un expediente, se limpia únicamente la asignación operativa.
  -- Estados especiales se conservan; "trabajando" vuelve a "sin_asignar".
  IF v_shared_actor THEN
    IF v_ops.assigned_to IS NOT NULL OR v_ops.estado_mesa = 'trabajando' THEN
      UPDATE public.mesa_expediente_ops
      SET
        estado_mesa = CASE
          WHEN estado_mesa = 'trabajando' THEN 'sin_asignar'::public.mesa_expediente_estado
          ELSE estado_mesa
        END,
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
          'motivo', 'shared_account_nonexclusive',
          'estado_mesa_anterior', v_prev_estado,
          'estado_mesa_nuevo', v_ops.estado_mesa,
          'assigned_to_anterior', v_prev_assigned,
          'assigned_to_nuevo', v_ops.assigned_to,
          'shared_actor', true
        )
      );
    ELSE
      v_idempotent := true;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', v_idempotent,
      'shared', true,
      'expediente_id', p_expediente_id,
      'estado_mesa', v_ops.estado_mesa,
      'assigned_to', v_ops.assigned_to,
      'assigned_at', v_ops.assigned_at
    );
  END IF;

  IF v_ops.assigned_to IS NOT NULL AND v_ops.assigned_to = v_actor_id THEN
    v_idempotent := true;

  ELSIF v_ops.assigned_to IS NOT NULL
     AND v_ops.assigned_to IS DISTINCT FROM v_actor_id THEN
    -- Takeover explícito: conserva el estado operativo si es especial.
    UPDATE public.mesa_expediente_ops
    SET
      estado_mesa = CASE
        WHEN estado_mesa = 'sin_asignar' THEN 'trabajando'::public.mesa_expediente_estado
        ELSE estado_mesa
      END,
      assigned_to = v_actor_id,
      assigned_at = v_now,
      last_activity_at = v_now,
      updated_at = v_now
    WHERE expediente_id = p_expediente_id
    RETURNING * INTO v_ops;

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
        'assigned_at', v_ops.assigned_at,
        'takeover', (
          v_prev_assigned IS NOT NULL
          AND v_prev_assigned IS DISTINCT FROM v_actor_id
        )
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', v_idempotent,
    'shared', false,
    'expediente_id', p_expediente_id,
    'estado_mesa', v_ops.estado_mesa,
    'assigned_to', v_ops.assigned_to,
    'assigned_at', v_ops.assigned_at
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_take_expediente(UUID) IS
  'Mesa assignment no exclusiva: cualquier operador autorizado puede tomar/reasignar bajo lock; mesa98 permanece sin ownership exclusivo.';

REVOKE ALL ON FUNCTION public.mesa_take_expediente(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_take_expediente(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_take_expediente(UUID) TO authenticated, service_role, postgres;
