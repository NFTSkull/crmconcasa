-- ConCasa CRM — monto aprobado para operador delegado autorizado.
-- Corrige el gap de P208: asesor_update_monto_aprobado seguía owner-only.
-- No cambia reglas de negocio del monto, estado, etapa ni organización.

CREATE OR REPLACE FUNCTION public.asesor_update_monto_aprobado(
  p_expediente_id UUID,
  p_monto_aprobado NUMERIC
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
  v_prev public.editor_decisions%ROWTYPE;
  v_monto NUMERIC(14, 2);
  v_updated_at TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_monto_aprobado IS NULL OR p_monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: monto_aprobado debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  v_monto := round(p_monto_aprobado::NUMERIC, 2);

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: expediente de otra organización'
      USING ERRCODE = '42501';
  END IF;

  -- P208 parity: dueño o asesor delegado autorizado del mismo equipo activo.
  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: asesor no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: expediente no activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    RAISE EXCEPTION 'asesor_update_monto_aprobado: expediente ya enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT ed.*
  INTO v_prev
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF FOUND THEN
    UPDATE public.editor_decisions
    SET
      monto_aprobado = v_monto,
      updated_at = NOW()
    WHERE expediente_id = p_expediente_id;
  ELSE
    INSERT INTO public.editor_decisions (
      expediente_id,
      organization_id,
      decision,
      monto_aprobado,
      notas_revision
    ) VALUES (
      p_expediente_id,
      v_org_id,
      'pendiente',
      v_monto,
      ''
    );
  END IF;

  SELECT ed.updated_at
  INTO v_updated_at
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'asesor.monto_aprobado.update',
    'editor_decision',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'monto_anterior', v_prev.monto_aprobado,
      'monto_nuevo', v_monto,
      'decision', COALESCE(v_prev.decision::TEXT, 'pendiente'),
      'asesor_id', v_actor_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'monto_aprobado', v_monto,
    'updated_at', v_updated_at
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_update_monto_aprobado(UUID, NUMERIC) IS
  'Asesor autorizado registra monto_aprobado sin modificar decision del editor; dueño o delegado válido vía asesor_can_operate_expediente_as.';

REVOKE ALL ON FUNCTION public.asesor_update_monto_aprobado(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_update_monto_aprobado(UUID, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_update_monto_aprobado(UUID, NUMERIC) TO authenticated;
