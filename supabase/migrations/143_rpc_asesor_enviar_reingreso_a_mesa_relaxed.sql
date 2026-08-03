-- ConCasa CRM — Hotfix: reingreso manual sin gates de checklist / envío previo
-- Migración 143. Reemplaza el cuerpo de asesor_enviar_reingreso_a_mesa (mig. 142 intacta).
-- Columnas reingreso_manual_* y bandeja Mesa ya existen en 142.

CREATE OR REPLACE FUNCTION public.asesor_enviar_reingreso_a_mesa(
  p_expediente_id UUID
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
  v_exp public.expedientes%ROWTYPE;
  v_etapa_anterior SMALLINT;
  v_subestado_anterior public.operativo_subestado;
  v_count INTEGER;
  v_era_primer_envio BOOLEAN;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: solo el asesor dueño puede reingresar a Mesa'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado = 'cancelado' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: el expediente está cancelado y no se puede reingresar'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotencia doble clic / carrera: misma TX actor en ventana corta.
  IF v_exp.reingreso_manual_at IS NOT NULL
     AND v_exp.reingreso_manual_by IS NOT DISTINCT FROM v_actor_id
     AND v_exp.reingreso_manual_at > (v_now - INTERVAL '5 seconds') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent', true,
      'expediente_id', v_exp.id,
      'precalificacion_id', v_exp.id,
      'reingreso_manual_count', v_exp.reingreso_manual_count,
      'reingreso_manual_at', v_exp.reingreso_manual_at,
      'reingreso_manual_by', v_exp.reingreso_manual_by,
      'etapa_actual', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'submitted_to_mesa', true,
      'fecha_envio_mesa', v_exp.fecha_envio_mesa,
      'era_primer_envio', false
    );
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;
  v_count := v_exp.reingreso_manual_count + 1;
  v_era_primer_envio := (v_exp.submitted_to_mesa IS NOT TRUE)
    OR (v_exp.fecha_envio_mesa IS NULL);

  -- UPDATE del mismo expediente. Sin INSERT. Sin gates de checklist.
  UPDATE public.expedientes
  SET
    submitted_to_mesa = true,
    fecha_envio_mesa = v_now,
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    reingreso_manual_count = v_count,
    reingreso_manual_at = v_now,
    reingreso_manual_by = v_actor_id,
    updated_at = v_now
  WHERE id = p_expediente_id
    AND reingreso_manual_count = v_exp.reingreso_manual_count;

  IF NOT FOUND THEN
    SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent', true,
      'expediente_id', v_exp.id,
      'precalificacion_id', v_exp.id,
      'reingreso_manual_count', v_exp.reingreso_manual_count,
      'reingreso_manual_at', v_exp.reingreso_manual_at,
      'reingreso_manual_by', v_exp.reingreso_manual_by,
      'etapa_actual', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'submitted_to_mesa', true,
      'fecha_envio_mesa', v_exp.fecha_envio_mesa,
      'era_primer_envio', false
    );
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente_reingreso_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'precalificacion_id', p_expediente_id,
      'asesor_id', v_exp.asesor_id,
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'etapa_anterior', v_etapa_anterior,
      'subestado_anterior', v_subestado_anterior,
      'etapa_final', 1,
      'subestado_final', 'en_validacion_mesa',
      'numero_reingreso', v_count,
      'fecha', v_now,
      'reingreso_manual_count', v_count,
      'era_primer_envio', v_era_primer_envio
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'idempotent', false,
    'expediente_id', p_expediente_id,
    'precalificacion_id', p_expediente_id,
    'reingreso_manual_count', v_count,
    'reingreso_manual_at', v_now,
    'reingreso_manual_by', v_actor_id,
    'etapa_anterior', v_etapa_anterior,
    'subestado_anterior', v_subestado_anterior,
    'etapa_actual', 1,
    'subestado', 'en_validacion_mesa',
    'submitted_to_mesa', true,
    'fecha_envio_mesa', v_now,
    'era_primer_envio', v_era_primer_envio
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID)
  TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID) IS
  'Reingreso manual del mismo expediente a Mesa (sin checklist). Solo asesor dueño + no cancelado/eliminado. No crea expediente.';
