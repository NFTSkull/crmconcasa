-- ConCasa CRM — P094 B1: cancelación terminal de expediente
-- Señal: ciclo_estado = cancelado + fila append-only en expediente_cancelaciones.
-- No muta subestado a rechazado; no toca agenda/bookings; no escribe rechazos_operativos.

CREATE TABLE public.expediente_cancelaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL
    REFERENCES public.expedientes(id) ON DELETE RESTRICT,
  etapa SMALLINT NOT NULL,
  subestado_anterior public.operativo_subestado NOT NULL,
  motivo TEXT NOT NULL,
  comentario TEXT NULL,
  decidido_por UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decidido_por_rol public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_cancelaciones_etapa_chk
    CHECK (etapa BETWEEN 1 AND 12),
  CONSTRAINT expediente_cancelaciones_motivo_chk
    CHECK (btrim(motivo) <> ''),
  CONSTRAINT expediente_cancelaciones_id_expediente_unique
    UNIQUE (id, expediente_id)
);

COMMENT ON TABLE public.expediente_cancelaciones IS
  'P094: decisiones append-only de cancelación terminal (cliente no continúa). Distinto de rechazo operativo y de booking cancelled.';

CREATE INDEX expediente_cancelaciones_exp_created_idx
  ON public.expediente_cancelaciones (expediente_id, created_at DESC);

CREATE INDEX expediente_cancelaciones_org_created_idx
  ON public.expediente_cancelaciones (organization_id, created_at DESC);

ALTER TABLE public.expediente_cancelaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY expediente_cancelaciones_select
  ON public.expediente_cancelaciones
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

REVOKE ALL ON TABLE public.expediente_cancelaciones FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_cancelaciones FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.expediente_cancelaciones FROM authenticated;
GRANT SELECT ON TABLE public.expediente_cancelaciones TO authenticated;

CREATE OR REPLACE FUNCTION public.cancelar_expediente_operativo(
  p_expediente_id UUID,
  p_motivo TEXT,
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
  v_actor_org UUID;
  v_exp RECORD;
  v_cancelacion_id UUID;
  v_motivo TEXT;
  v_comentario TEXT;
  v_bookings_before INTEGER;
  v_bookings_after INTEGER;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_UNAUTHORIZED: usuario no autenticado'
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
    RAISE EXCEPTION 'MESA_CANCEL_EXP_UNAUTHORIZED: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_NOT_FOUND: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_comentario := NULLIF(btrim(COALESCE(p_comentario, '')), '');

  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_REASON_REQUIRED: motivo es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_REASON_TOO_LONG: motivo no puede exceder 500 caracteres'
      USING ERRCODE = '22023';
  END IF;

  IF v_comentario IS NOT NULL AND char_length(v_comentario) > 2000 THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_COMMENT_TOO_LONG: comentario no puede exceder 2000 caracteres'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado,
    e.submitted_to_mesa,
    e.ciclo_estado,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_NOT_FOUND: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_UNAUTHORIZED: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_NOT_SUBMITTED: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_NOT_VISIBLE: expediente no visible para el actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado = 'cancelado' THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_ALREADY_CANCELLED: expediente ya cancelado'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_CYCLE_NOT_ACTIVE: ciclo no activo (%)', v_exp.ciclo_estado
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_bookings_before
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id;

  INSERT INTO public.expediente_cancelaciones (
    organization_id,
    expediente_id,
    etapa,
    subestado_anterior,
    motivo,
    comentario,
    decidido_por,
    decidido_por_rol
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_exp.etapa_actual,
    v_exp.subestado,
    v_motivo,
    v_comentario,
    v_actor_id,
    v_actor_role
  )
  RETURNING id INTO v_cancelacion_id;

  UPDATE public.expedientes
  SET
    ciclo_estado = 'cancelado',
    updated_at = NOW()
  WHERE id = p_expediente_id;

  SELECT COUNT(*)::INTEGER INTO v_bookings_after
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id;

  IF v_bookings_after IS DISTINCT FROM v_bookings_before THEN
    RAISE EXCEPTION 'MESA_CANCEL_EXP_BOOKING_MUTATION: la cancelación no debe mutar agenda'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.cancelacion_operativa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'cancelacion_id', v_cancelacion_id,
      'etapa', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'ciclo_estado_anterior', 'activo',
      'ciclo_estado', 'cancelado',
      'motivo', v_motivo,
      'comentario', v_comentario,
      'sin_efectos_agenda', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'cancelacion_id', v_cancelacion_id,
    'ciclo_estado', 'cancelado',
    'subestado', v_exp.subestado,
    'etapa', v_exp.etapa_actual
  );
END;
$$;

COMMENT ON FUNCTION public.cancelar_expediente_operativo(UUID, TEXT, TEXT) IS
  'P094: Mesa cancela terminalmente un expediente (ciclo=cancelado) sin mutar subestado a rechazado ni alterar bookings.';

REVOKE ALL ON FUNCTION public.cancelar_expediente_operativo(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancelar_expediente_operativo(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancelar_expediente_operativo(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_expediente_operativo(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_expediente_operativo(UUID, TEXT, TEXT) TO postgres;
