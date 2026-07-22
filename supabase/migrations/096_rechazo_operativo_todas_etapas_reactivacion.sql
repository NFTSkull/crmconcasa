-- ConCasa CRM — P108A: rechazo operativo en etapas internas 1–12 + reactivación segura
-- Amplía P071 sin tocar P072 (reingreso hijo post-biométricos).
-- Reactivación: mismo expediente, misma etapa_actual, sale de rechazado al subestado
-- canónico de Mesa para esa etapa (espejo mesa_mover_etapa: 1→en_validacion_mesa; 2–12→en_proceso).

ALTER TABLE public.expediente_rechazos_operativos
  DROP CONSTRAINT IF EXISTS expediente_rechazos_operativos_etapa_chk;

ALTER TABLE public.expediente_rechazos_operativos
  ADD CONSTRAINT expediente_rechazos_operativos_etapa_chk
    CHECK (etapa BETWEEN 1 AND 12);

COMMENT ON TABLE public.expediente_rechazos_operativos IS
  'Decisiones append-only de rechazo operativo en etapas internas 1–12. La condición biométrica es declaración humana de Mesa (P071/P072); el rechazo general UI usa desconocida. P108A: reactivación del mismo expediente no depende de biométricos.';

CREATE TABLE public.expediente_rechazo_reactivaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL
    REFERENCES public.expedientes(id) ON DELETE RESTRICT,
  rechazo_id UUID NOT NULL,
  etapa SMALLINT NOT NULL,
  subestado_anterior public.operativo_subestado NOT NULL,
  subestado_nuevo public.operativo_subestado NOT NULL,
  reactivado_por UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reactivado_por_rol public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_rechazo_reactivaciones_etapa_chk
    CHECK (etapa BETWEEN 1 AND 12),
  CONSTRAINT expediente_rechazo_reactivaciones_rechazo_fk
    FOREIGN KEY (rechazo_id, expediente_id)
    REFERENCES public.expediente_rechazos_operativos(id, expediente_id)
    ON DELETE RESTRICT,
  CONSTRAINT expediente_rechazo_reactivaciones_rechazo_unique
    UNIQUE (rechazo_id)
);

COMMENT ON TABLE public.expediente_rechazo_reactivaciones IS
  'P108A: traza append-only de reactivación (corregir y reenviar). Un rechazo solo puede reactivarse una vez. No borra el historial de rechazo.';

CREATE INDEX expediente_rechazo_reactivaciones_exp_created_idx
  ON public.expediente_rechazo_reactivaciones (expediente_id, created_at DESC);

CREATE INDEX expediente_rechazo_reactivaciones_org_created_idx
  ON public.expediente_rechazo_reactivaciones (organization_id, created_at DESC);

ALTER TABLE public.expediente_rechazo_reactivaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY expediente_rechazo_reactivaciones_select
  ON public.expediente_rechazo_reactivaciones
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

REVOKE ALL ON TABLE public.expediente_rechazo_reactivaciones FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_rechazo_reactivaciones FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.expediente_rechazo_reactivaciones FROM authenticated;
GRANT SELECT ON TABLE public.expediente_rechazo_reactivaciones TO authenticated;

CREATE OR REPLACE FUNCTION public.rechazar_etapa_operativa(
  p_expediente_id UUID,
  p_motivo TEXT,
  p_comentario TEXT,
  p_biometricos_condicion public.biometricos_condicion,
  p_biometricos_razon TEXT DEFAULT NULL,
  p_biometricos_booking_id UUID DEFAULT NULL
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
  v_booking RECORD;
  v_rechazo_id UUID;
  v_motivo TEXT;
  v_comentario TEXT;
  v_razon TEXT;
  v_timezone TEXT := 'America/Monterrey';
  v_booking_at TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: usuario no autenticado'
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
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_comentario := NULLIF(btrim(COALESCE(p_comentario, '')), '');
  v_razon := NULLIF(btrim(COALESCE(p_biometricos_razon, '')), '');

  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: motivo es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_biometricos_condicion IS NULL THEN
    RAISE EXCEPTION 'REENTRY_BIOMETRICS_NOT_REUSABLE: condición biométrica obligatoria'
      USING ERRCODE = '22023';
  END IF;

  IF p_biometricos_condicion IN ('reutilizables', 'repetir', 'invalidos')
     AND (p_biometricos_booking_id IS NULL OR v_razon IS NULL) THEN
    RAISE EXCEPTION 'REENTRY_BOOKING_EVIDENCE_MISSING: booking y razón son obligatorios para la condición declarada'
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
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: expediente no visible para el actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.etapa_actual < 1 OR v_exp.etapa_actual > 12 THEN
    RAISE EXCEPTION 'REENTRY_STAGE_OUT_OF_RANGE: etapa actual %', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'REENTRY_CYCLE_NOT_ACTIVE: ciclo no activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado = 'rechazado' THEN
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: expediente ya rechazado'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(ac.config->>'timezone'), ''), 'America/Monterrey')
  INTO v_timezone
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_exp.organization_id
    AND ac.kind = 'biometricos';
  v_timezone := COALESCE(v_timezone, 'America/Monterrey');

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'biometricos'
      AND b.status = 'booked'
      AND ((b.booking_date::TIMESTAMP + b.booking_time) AT TIME ZONE v_timezone) > NOW()
  ) THEN
    RAISE EXCEPTION 'REENTRY_FUTURE_BOOKING_ACTIVE: existe una cita biométrica futura activa'
      USING ERRCODE = '22023';
  END IF;

  IF p_biometricos_booking_id IS NOT NULL THEN
    SELECT
      b.id,
      b.expediente_id,
      b.organization_id,
      b.status,
      b.booking_date,
      b.booking_time,
      b.cancelled_at
    INTO v_booking
    FROM public.agenda_bookings b
    WHERE b.id = p_biometricos_booking_id
      AND b.expediente_id = p_expediente_id
      AND b.organization_id = v_exp.organization_id
      AND b.kind = 'biometricos';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REENTRY_BOOKING_EVIDENCE_MISSING: booking no pertenece al expediente'
        USING ERRCODE = '22023';
    END IF;

    v_booking_at :=
      (v_booking.booking_date::TIMESTAMP + v_booking.booking_time)
      AT TIME ZONE v_timezone;

    IF v_booking_at > NOW()
       OR (
         v_booking.status = 'cancelled'
         AND (v_booking.cancelled_at IS NULL OR v_booking.cancelled_at < v_booking_at)
       )
       OR v_booking.status NOT IN ('booked', 'cancelled') THEN
      RAISE EXCEPTION 'REENTRY_BOOKING_EVIDENCE_MISSING: booking no acredita un intento pasado'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.expediente_rechazos_operativos (
    organization_id,
    expediente_id,
    etapa,
    subestado_anterior,
    motivo,
    comentario,
    biometricos_condicion,
    biometricos_razon,
    biometricos_booking_id,
    decidido_por,
    decidido_por_rol
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_exp.etapa_actual,
    v_exp.subestado,
    v_motivo,
    v_comentario,
    p_biometricos_condicion,
    v_razon,
    p_biometricos_booking_id,
    v_actor_id,
    v_actor_role
  )
  RETURNING id INTO v_rechazo_id;

  UPDATE public.expedientes
  SET
    subestado = 'rechazado',
    motivo_rechazo = v_motivo,
    comentario_rechazo = v_comentario,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.rechazo_operativo',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'rechazo_id', v_rechazo_id,
      'etapa', v_exp.etapa_actual,
      'subestado_anterior', v_exp.subestado,
      'motivo', v_motivo,
      'comentario', v_comentario,
      'biometricos_condicion', p_biometricos_condicion,
      'biometricos_razon', v_razon,
      'biometricos_booking_id', p_biometricos_booking_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'rechazo_id', v_rechazo_id,
    'etapa', v_exp.etapa_actual,
    'subestado', 'rechazado',
    'biometricos_condicion', p_biometricos_condicion,
    'biometricos_booking_id', p_biometricos_booking_id
  );
END;
$$;

COMMENT ON FUNCTION public.rechazar_etapa_operativa(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID
) IS
  'P108A/P071: Mesa rechaza etapas internas 1–12; registra decisión append-only sin mutar agenda/documentos/montos. P072 (reingreso hijo) sigue aparte.';

CREATE OR REPLACE FUNCTION public.reactivar_expediente_rechazado(
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
  v_actor_org UUID;
  v_exp RECORD;
  v_rechazo RECORD;
  v_reactivacion_id UUID;
  v_subestado_nuevo public.operativo_subestado;
  v_bookings_before INTEGER;
  v_bookings_after INTEGER;
  v_docs_before INTEGER;
  v_docs_after INTEGER;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'REACTIVATION_UNAUTHORIZED: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REACTIVATION_UNAUTHORIZED: perfil inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'REACTIVATION_NOT_FOUND: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.etapa_actual,
    e.subestado,
    e.submitted_to_mesa,
    e.ciclo_estado,
    e.deleted_at,
    e.motivo_rechazo,
    e.comentario_rechazo
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'REACTIVATION_NOT_FOUND: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role = 'asesor' THEN
    IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'REACTIVATION_UNAUTHORIZED: solo el asesor propietario'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_actor_role IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    IF v_actor_role <> 'super_admin'
       AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
      RAISE EXCEPTION 'REACTIVATION_UNAUTHORIZED: expediente fuera de la organización'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'REACTIVATION_UNAUTHORIZED: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'REACTIVATION_UNAUTHORIZED: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'REACTIVATION_CYCLE_NOT_ACTIVE: ciclo no activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'rechazado' THEN
    RAISE EXCEPTION 'REACTIVATION_NOT_REJECTED: expediente no está rechazado'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual < 1 OR v_exp.etapa_actual > 12 THEN
    RAISE EXCEPTION 'REACTIVATION_STAGE_OUT_OF_RANGE: etapa %', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  SELECT r.*
  INTO v_rechazo
  FROM public.expediente_rechazos_operativos r
  WHERE r.expediente_id = p_expediente_id
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REACTIVATION_NO_REJECTION: no hay rechazo vigente'
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expediente_rechazo_reactivaciones x
    WHERE x.rechazo_id = v_rechazo.id
  ) THEN
    RAISE EXCEPTION 'REACTIVATION_ALREADY_DONE: este rechazo ya fue reactivado'
      USING ERRCODE = '22023';
  END IF;

  -- Estado canónico Mesa (misma regla que mesa_mover_etapa_operativa).
  v_subestado_nuevo := CASE
    WHEN v_exp.etapa_actual = 1 THEN 'en_validacion_mesa'::public.operativo_subestado
    ELSE 'en_proceso'::public.operativo_subestado
  END;

  SELECT COUNT(*)::INTEGER INTO v_bookings_before
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id;

  SELECT COUNT(*)::INTEGER INTO v_docs_before
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.deleted_at IS NULL;

  INSERT INTO public.expediente_rechazo_reactivaciones (
    organization_id,
    expediente_id,
    rechazo_id,
    etapa,
    subestado_anterior,
    subestado_nuevo,
    reactivado_por,
    reactivado_por_rol
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_rechazo.id,
    v_exp.etapa_actual,
    v_exp.subestado,
    v_subestado_nuevo,
    v_actor_id,
    v_actor_role
  )
  RETURNING id INTO v_reactivacion_id;

  UPDATE public.expedientes
  SET
    subestado = v_subestado_nuevo,
    motivo_rechazo = NULL,
    comentario_rechazo = NULL,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  SELECT COUNT(*)::INTEGER INTO v_bookings_after
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id;

  SELECT COUNT(*)::INTEGER INTO v_docs_after
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.deleted_at IS NULL;

  IF v_bookings_before IS DISTINCT FROM v_bookings_after
     OR v_docs_before IS DISTINCT FROM v_docs_after THEN
    RAISE EXCEPTION 'REACTIVATION_SIDE_EFFECT: no se permiten mutaciones colaterales'
      USING ERRCODE = 'XX000';
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.rechazo_reactivacion',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'reactivacion_id', v_reactivacion_id,
      'rechazo_id', v_rechazo.id,
      'etapa', v_exp.etapa_actual,
      'subestado_anterior', v_exp.subestado,
      'subestado_nuevo', v_subestado_nuevo,
      'rechazo_motivo', v_rechazo.motivo,
      'rechazo_comentario', v_rechazo.comentario
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'reactivacion_id', v_reactivacion_id,
    'rechazo_id', v_rechazo.id,
    'etapa', v_exp.etapa_actual,
    'subestado_anterior', v_exp.subestado,
    'subestado', v_subestado_nuevo
  );
END;
$$;

COMMENT ON FUNCTION public.reactivar_expediente_rechazado(UUID) IS
  'P108A: asesor propietario (o Mesa/admin) reenvía el mismo expediente rechazado a Mesa. Conserva etapa/docs/citas/montos; traza append-only; no usa biometricos_condicion ni P072.';

REVOKE ALL ON FUNCTION public.reactivar_expediente_rechazado(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reactivar_expediente_rechazado(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reactivar_expediente_rechazado(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivar_expediente_rechazado(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reactivar_expediente_rechazado(UUID) TO postgres;
