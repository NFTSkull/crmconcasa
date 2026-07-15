-- ConCasa CRM — P074: libertad operativa manual de Mesa Control
-- Operación separada del flujo normal. No ejecuta gates ni efectos colaterales de etapa.

CREATE TABLE public.expediente_movimientos_mesa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL
    REFERENCES public.expedientes(id) ON DELETE RESTRICT,
  etapa_origen SMALLINT NOT NULL
    CONSTRAINT expediente_movimientos_mesa_etapa_origen_chk
    CHECK (etapa_origen BETWEEN 1 AND 12),
  etapa_destino SMALLINT NOT NULL
    CONSTRAINT expediente_movimientos_mesa_etapa_destino_chk
    CHECK (etapa_destino BETWEEN 1 AND 12),
  subestado_origen public.operativo_subestado NOT NULL,
  subestado_destino public.operativo_subestado NOT NULL,
  motivo TEXT NOT NULL
    CONSTRAINT expediente_movimientos_mesa_motivo_chk
    CHECK (btrim(motivo) <> '' AND char_length(motivo) <= 500),
  actor_id UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_movimientos_mesa_etapas_distintas_chk
    CHECK (etapa_origen <> etapa_destino)
);

COMMENT ON TABLE public.expediente_movimientos_mesa IS
  'Historial append-only de movimientos manuales de etapa realizados por Mesa. No contiene PII ni implica efectos de negocio adicionales.';

CREATE INDEX expediente_movimientos_mesa_exp_created_idx
  ON public.expediente_movimientos_mesa (expediente_id, created_at DESC);

CREATE INDEX expediente_movimientos_mesa_org_created_idx
  ON public.expediente_movimientos_mesa (organization_id, created_at DESC);

ALTER TABLE public.expediente_movimientos_mesa ENABLE ROW LEVEL SECURITY;

CREATE POLICY expediente_movimientos_mesa_select
  ON public.expediente_movimientos_mesa
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

REVOKE ALL ON TABLE public.expediente_movimientos_mesa FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_movimientos_mesa FROM anon;
REVOKE ALL ON TABLE public.expediente_movimientos_mesa FROM authenticated;
REVOKE ALL ON TABLE public.expediente_movimientos_mesa FROM service_role;
GRANT SELECT ON TABLE public.expediente_movimientos_mesa
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.mesa_mover_etapa_operativa(
  p_expediente_id UUID,
  p_etapa_destino SMALLINT,
  p_etapa_esperada SMALLINT,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_motivo TEXT;
  v_subestado_destino public.operativo_subestado;
  v_movimiento_id UUID;
  v_direccion TEXT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_MOVE_UNAUTHORIZED: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'MESA_MOVE_UNAUTHORIZED: perfil inactivo o rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_FOUND: expediente_id es obligatorio'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_FOUND: expediente no encontrado o no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_VISIBLE: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_SUBMITTED: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'MESA_MOVE_CYCLE_NOT_ACTIVE: ciclo no activo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_MOVE_NOT_VISIBLE: expediente no visible para el actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.subestado NOT IN ('en_validacion_mesa', 'en_proceso') THEN
    RAISE EXCEPTION 'MESA_MOVE_BAD_SUBSTATE: subestado no elegible (%)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF p_etapa_destino IS NULL OR p_etapa_destino NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_BAD_DESTINATION: etapa destino debe estar entre 1 y 12'
      USING ERRCODE = '22023';
  END IF;

  IF p_etapa_esperada IS NULL OR p_etapa_esperada NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa esperada debe estar entre 1 y 12'
      USING ERRCODE = '40001';
  END IF;

  IF v_exp.etapa_actual <> p_etapa_esperada THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa actual %, esperada %',
      v_exp.etapa_actual, p_etapa_esperada
      USING ERRCODE = '40001';
  END IF;

  IF p_etapa_destino = v_exp.etapa_actual THEN
    RAISE EXCEPTION 'MESA_MOVE_SAME_STAGE: origen y destino son iguales'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MESA_MOVE_REASON_REQUIRED: motivo obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'MESA_MOVE_REASON_TOO_LONG: máximo 500 caracteres'
      USING ERRCODE = '22023';
  END IF;

  v_subestado_destino := CASE
    WHEN p_etapa_destino = 1 THEN 'en_validacion_mesa'::public.operativo_subestado
    ELSE 'en_proceso'::public.operativo_subestado
  END;

  v_direccion := CASE
    WHEN abs(p_etapa_destino - v_exp.etapa_actual) > 1 THEN 'salto'
    WHEN p_etapa_destino > v_exp.etapa_actual THEN 'avance'
    ELSE 'retroceso'
  END;

  INSERT INTO public.expediente_movimientos_mesa (
    organization_id,
    expediente_id,
    etapa_origen,
    etapa_destino,
    subestado_origen,
    subestado_destino,
    motivo,
    actor_id,
    actor_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_exp.etapa_actual,
    p_etapa_destino,
    v_exp.subestado,
    v_subestado_destino,
    v_motivo,
    v_actor_id,
    v_actor_role
  )
  RETURNING id INTO v_movimiento_id;

  UPDATE public.expedientes
  SET
    etapa_actual = p_etapa_destino,
    subestado = v_subestado_destino,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'mesa.expediente.mover_etapa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'movimiento_id', v_movimiento_id,
      'etapa_anterior', v_exp.etapa_actual,
      'etapa_nueva', p_etapa_destino,
      'subestado_anterior', v_exp.subestado,
      'subestado_nuevo', v_subestado_destino,
      'direccion', v_direccion,
      'motivo', v_motivo,
      'movimiento_manual', true,
      'sin_efectos_adicionales', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'movimiento_id', v_movimiento_id,
    'etapa_anterior', v_exp.etapa_actual,
    'etapa_actual', p_etapa_destino,
    'subestado_anterior', v_exp.subestado,
    'subestado', v_subestado_destino,
    'direccion', v_direccion
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_mover_etapa_operativa(UUID, SMALLINT, SMALLINT, TEXT) IS
  'Mueve manualmente un expediente visible y activo entre etapas 1-12. Solo cambia etapa/subestado y registra auditoría; no ejecuta gates ni efectos del flujo normal.';

REVOKE ALL ON FUNCTION public.mesa_mover_etapa_operativa(UUID, SMALLINT, SMALLINT, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_mover_etapa_operativa(UUID, SMALLINT, SMALLINT, TEXT)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_mover_etapa_operativa(UUID, SMALLINT, SMALLINT, TEXT)
  TO authenticated, service_role, postgres;
