-- ConCasa CRM — P071: rechazo operativo en etapas 5/6 con decisión biométrica
-- Conserva íntegra la agenda histórica y registra una decisión append-only de Mesa.

CREATE TYPE public.biometricos_condicion AS ENUM (
  'reutilizables',
  'repetir',
  'invalidos',
  'no_completados',
  'desconocida'
);

CREATE TABLE public.expediente_rechazos_operativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL
    REFERENCES public.expedientes(id) ON DELETE RESTRICT,
  etapa SMALLINT NOT NULL,
  subestado_anterior public.operativo_subestado NOT NULL,
  motivo TEXT NOT NULL,
  comentario TEXT NULL,
  biometricos_condicion public.biometricos_condicion NOT NULL,
  biometricos_razon TEXT NULL,
  biometricos_booking_id UUID NULL
    REFERENCES public.agenda_bookings(id) ON DELETE RESTRICT,
  decidido_por UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decidido_por_rol public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_rechazos_operativos_etapa_chk
    CHECK (etapa IN (5, 6)),
  CONSTRAINT expediente_rechazos_operativos_motivo_chk
    CHECK (btrim(motivo) <> ''),
  CONSTRAINT expediente_rechazos_operativos_intento_chk
    CHECK (
      biometricos_condicion NOT IN ('reutilizables', 'repetir', 'invalidos')
      OR (
        biometricos_booking_id IS NOT NULL
        AND biometricos_razon IS NOT NULL
        AND btrim(biometricos_razon) <> ''
      )
    ),
  CONSTRAINT expediente_rechazos_operativos_id_expediente_unique
    UNIQUE (id, expediente_id)
);

COMMENT ON TABLE public.expediente_rechazos_operativos IS
  'Decisiones append-only de rechazo operativo en etapas 5/6. La condición biométrica es una declaración humana de Mesa respaldada por booking; nunca una inferencia automática.';

CREATE INDEX expediente_rechazos_operativos_exp_created_idx
  ON public.expediente_rechazos_operativos (expediente_id, created_at DESC);

CREATE INDEX expediente_rechazos_operativos_org_created_idx
  ON public.expediente_rechazos_operativos (organization_id, created_at DESC);

ALTER TABLE public.expediente_rechazos_operativos ENABLE ROW LEVEL SECURITY;

CREATE POLICY expediente_rechazos_operativos_select
  ON public.expediente_rechazos_operativos
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

REVOKE ALL ON TABLE public.expediente_rechazos_operativos FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_rechazos_operativos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.expediente_rechazos_operativos FROM authenticated;
GRANT SELECT ON TABLE public.expediente_rechazos_operativos TO authenticated;

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

  IF v_exp.etapa_actual NOT IN (5, 6) THEN
    RAISE EXCEPTION 'REENTRY_NOT_STAGE_5_OR_6: etapa actual %', v_exp.etapa_actual
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
  'P071: Mesa rechaza únicamente etapas 5/6 y registra decisión biométrica append-only sin mutar la agenda histórica.';

REVOKE ALL ON FUNCTION public.rechazar_etapa_operativa(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rechazar_etapa_operativa(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID
) FROM anon;
GRANT EXECUTE ON FUNCTION public.rechazar_etapa_operativa(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rechazar_etapa_operativa(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.rechazar_etapa_operativa(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID
) TO postgres;
