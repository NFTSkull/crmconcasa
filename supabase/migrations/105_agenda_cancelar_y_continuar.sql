-- ConCasa CRM — P118b: Cancelar cita y continuar (RPC dedicada)
-- Biométricos 4→5 · Firmas 10→11 · Notificación no soportada
-- Roles: mesa_admin | super_admin (UI alias mesa_control_admin → mesa_admin)
-- No modifica 001–104.

-- =============================================================================
-- Extender agenda_booking_decisiones
-- =============================================================================
ALTER TABLE public.agenda_booking_decisiones
  ADD COLUMN IF NOT EXISTS etapa_anterior SMALLINT,
  ADD COLUMN IF NOT EXISTS etapa_nueva SMALLINT;

ALTER TABLE public.agenda_booking_decisiones
  DROP CONSTRAINT IF EXISTS agenda_booking_decisiones_decision_check;

ALTER TABLE public.agenda_booking_decisiones
  ADD CONSTRAINT agenda_booking_decisiones_decision_check
  CHECK (decision = ANY (ARRAY[
    'reagendar'::text,
    'cancelar'::text,
    'cancelar_continuar'::text,
    'cancel_continue'::text
  ]));

COMMENT ON COLUMN public.agenda_booking_decisiones.etapa_anterior IS
  'P118b: etapa interna antes de cancel_continue';
COMMENT ON COLUMN public.agenda_booking_decisiones.etapa_nueva IS
  'P118b: etapa interna después de cancel_continue';

-- Ampliar list RPC con etapas
DROP FUNCTION IF EXISTS public.list_agenda_booking_decisiones(UUID);
CREATE OR REPLACE FUNCTION public.list_agenda_booking_decisiones(
  p_expediente_id UUID
)
RETURNS TABLE (
  id UUID,
  kind public.booking_kind,
  decision TEXT,
  motivo TEXT,
  decided_at TIMESTAMPTZ,
  decided_by_name TEXT,
  previous_booking_date DATE,
  previous_booking_time TIME,
  previous_location_id TEXT,
  new_booking_date DATE,
  new_booking_time TIME,
  new_location_id TEXT,
  etapa_anterior SMALLINT,
  etapa_nueva SMALLINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'list_agenda_booking_decisiones: no autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'list_agenda_booking_decisiones: no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.kind,
    d.decision,
    d.motivo,
    d.decided_at,
    COALESCE(pr.full_name, pr.email, d.decided_by::TEXT) AS decided_by_name,
    d.previous_booking_date,
    d.previous_booking_time,
    d.previous_location_id,
    d.new_booking_date,
    d.new_booking_time,
    d.new_location_id,
    d.etapa_anterior,
    d.etapa_nueva
  FROM public.agenda_booking_decisiones d
  LEFT JOIN public.profiles pr ON pr.id = d.decided_by
  WHERE d.expediente_id = p_expediente_id
  ORDER BY d.decided_at DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.list_agenda_booking_decisiones(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agenda_booking_decisiones(UUID) TO authenticated;

-- =============================================================================
-- RPC dedicada
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_cancelar_cita_y_continuar(
  p_booking_id UUID,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_b public.agenda_bookings%ROWTYPE;
  v_exp RECORD;
  v_motivo TEXT;
  v_etapa_nueva SMALLINT;
  v_decision_id UUID;
  v_fecha_cita_anterior TIMESTAMPTZ;
  v_existing UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  -- Solo roles administrativos (mesa_control_admin es alias UI de mesa_admin)
  IF NOT FOUND OR v_role NOT IN ('mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: rol no autorizado (%)', v_role
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: booking_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: motivo obligatorio'
      USING ERRCODE = '22023';
  END IF;

  -- 1) Bloquear booking
  SELECT * INTO v_b
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: booking no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_role <> 'super_admin' AND v_b.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotencia: ya aplicada cancel_continue para este booking
  SELECT d.id INTO v_existing
  FROM public.agenda_booking_decisiones d
  WHERE d.booking_id = p_booking_id
    AND d.decision IN ('cancel_continue', 'cancelar_continuar')
  ORDER BY d.decided_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    IF v_b.status = 'cancelled' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'decision_id', v_existing,
        'action', 'cancel_continue',
        'booking_id', p_booking_id,
        'expediente_id', v_b.expediente_id
      );
    END IF;
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: decisión ya registrada con booking inconsistente'
      USING ERRCODE = '22023';
  END IF;

  IF v_b.status <> 'booked' THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: booking no activo (status: %)', v_b.status
      USING ERRCODE = '22023';
  END IF;

  IF v_b.kind = 'notificacion' THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: notificación no soporta cancelar y continuar'
      USING ERRCODE = '22023';
  END IF;

  IF v_b.kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: kind no soportado (%)', v_b.kind
      USING ERRCODE = '22023';
  END IF;

  -- 2) Bloquear expediente
  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.fecha_cita,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_b.expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_see_expediente(v_b.expediente_id) THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: subestado debe ser en_proceso (actual: %)',
      v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  -- Validar kind + etapa canónica
  IF v_b.kind = 'biometricos' THEN
    IF v_exp.etapa_actual <> 4 THEN
      RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: biométricos solo en etapa 4 (actual: %)',
        v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
    v_etapa_nueva := 5;
  ELSIF v_b.kind = 'firmas' THEN
    IF v_exp.etapa_actual <> 10 THEN
      RAISE EXCEPTION 'mesa_cancelar_cita_y_continuar: firmas solo en etapa 10 (actual: %)',
        v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
    v_etapa_nueva := 11;
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;

  -- 5) Cancelar booking (libera cupo: solo status=booked cuenta)
  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN NULLIF(btrim(COALESCE(note, '')), '') IS NULL THEN v_motivo
      ELSE btrim(note) || E'\n---\n' || v_motivo
    END,
    updated_at = NOW()
  WHERE id = v_b.id;

  -- 6) Avanzar etapa + limpiar fecha_cita (mismo tratamiento que cancel canónico)
  UPDATE public.expedientes
  SET
    etapa_actual = v_etapa_nueva,
    subestado = 'en_proceso',
    fecha_cita = NULL,
    updated_at = NOW()
  WHERE id = v_b.expediente_id;

  -- 7) Decisión append-only
  INSERT INTO public.agenda_booking_decisiones (
    organization_id,
    expediente_id,
    booking_id,
    kind,
    decision,
    motivo,
    decided_by,
    previous_booking_date,
    previous_booking_time,
    previous_location_id,
    etapa_anterior,
    etapa_nueva
  ) VALUES (
    v_b.organization_id,
    v_b.expediente_id,
    v_b.id,
    v_b.kind,
    'cancel_continue',
    v_motivo,
    v_actor,
    v_b.booking_date,
    v_b.booking_time,
    v_b.location_id,
    v_exp.etapa_actual,
    v_etapa_nueva
  )
  RETURNING id INTO v_decision_id;

  PERFORM public.log_action(
    v_b.organization_id,
    v_actor,
    v_role,
    'mesa.cancelar_cita_y_continuar',
    'expediente',
    v_b.expediente_id,
    jsonb_build_object(
      'booking_id', v_b.id,
      'kind', v_b.kind,
      'motivo', v_motivo,
      'etapa_anterior', v_exp.etapa_actual,
      'etapa_nueva', v_etapa_nueva,
      'fecha_cita_anterior', v_fecha_cita_anterior,
      'previous_booking_date', v_b.booking_date,
      'previous_booking_time', v_b.booking_time,
      'previous_location_id', v_b.location_id,
      'decision_id', v_decision_id,
      'transition',
        CASE
          WHEN v_b.kind = 'biometricos' THEN '4_5_cancel_continue'
          ELSE '10_11_cancel_continue'
        END
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'action', 'cancel_continue',
    'decision_id', v_decision_id,
    'booking_id', v_b.id,
    'expediente_id', v_b.expediente_id,
    'kind', v_b.kind,
    'etapa_anterior', v_exp.etapa_actual,
    'etapa_nueva', v_etapa_nueva,
    'fecha_cita', NULL,
    'status', 'cancelled'
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_cancelar_cita_y_continuar(UUID, TEXT) IS
  'P118b: Mesa Admin/super cancela booking y avanza (bio 4→5 | firmas 10→11). Limpia fecha_cita. Notificación no soportada.';

REVOKE ALL ON FUNCTION public.mesa_cancelar_cita_y_continuar(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_cancelar_cita_y_continuar(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_cancelar_cita_y_continuar(UUID, TEXT) TO authenticated;


-- Delegar cancelar_continuar / cancel_continue a la RPC dedicada
CREATE OR REPLACE FUNCTION public.mesa_gestionar_cita(
  p_booking_id UUID,
  p_action TEXT,
  p_motivo TEXT,
  p_new_scheduled_at TIMESTAMPTZ DEFAULT NULL,
  p_new_location_id TEXT DEFAULT NULL,
  p_new_booking_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_b public.agenda_bookings%ROWTYPE;
  v_motivo TEXT;
  v_action TEXT;
  v_result JSONB;
  v_new_booking_id UUID;
  v_decision_id UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  v_action := lower(btrim(COALESCE(p_action, '')));
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: motivo obligatorio' USING ERRCODE = '22023';
  END IF;

  -- P118b: cancelar y continuar → RPC dedicada (solo mesa_admin/super_admin dentro)
  IF v_action IN ('cancelar_continuar', 'cancel_continue') THEN
    v_result := public.mesa_cancelar_cita_y_continuar(p_booking_id, v_motivo);
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'cancel_continue',
      'decision_id', v_result->>'decision_id',
      'result', v_result
    );
  END IF;

  SELECT * INTO v_b
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: booking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_role <> 'super_admin' AND v_b.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: org distinta' USING ERRCODE = '42501';
  END IF;

  IF v_b.status <> 'booked' THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: booking no activo' USING ERRCODE = '22023';
  END IF;

  IF v_action = 'cancelar' THEN
    IF v_b.kind = 'biometricos' THEN
      v_result := public.cancel_biometricos(v_b.expediente_id, v_motivo);
    ELSIF v_b.kind = 'firmas' THEN
      IF to_regprocedure('public.mesa_cancel_firmas(uuid,text)') IS NOT NULL THEN
        v_result := public.mesa_cancel_firmas(v_b.expediente_id, v_motivo);
      ELSE
        v_result := public.cancel_firmas(v_b.expediente_id, v_motivo);
      END IF;
    ELSIF v_b.kind = 'notificacion' THEN
      IF v_role NOT IN ('mesa_admin', 'super_admin') THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: cancelar notificación solo mesa_admin/super_admin'
          USING ERRCODE = '42501';
      END IF;
      v_result := public.cancel_notificacion_etapa3(v_b.expediente_id, v_motivo);
    ELSE
      RAISE EXCEPTION 'mesa_gestionar_cita: kind no soportado' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.agenda_booking_decisiones (
      organization_id, expediente_id, booking_id, kind, decision, motivo, decided_by,
      previous_booking_date, previous_booking_time, previous_location_id
    ) VALUES (
      v_b.organization_id, v_b.expediente_id, v_b.id, v_b.kind, 'cancelar', v_motivo, v_actor,
      v_b.booking_date, v_b.booking_time, v_b.location_id
    ) RETURNING id INTO v_decision_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'cancelar',
      'decision_id', v_decision_id,
      'result', v_result
    );
  END IF;

  IF v_action = 'reagendar' THEN
    IF v_b.kind = 'biometricos' THEN
      IF p_new_scheduled_at IS NULL OR NULLIF(btrim(COALESCE(p_new_location_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar biométricos exige fecha/hora y sede'
          USING ERRCODE = '22023';
      END IF;
      IF v_role NOT IN ('mesa_admin', 'super_admin') THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar biométricos solo mesa_admin/super_admin'
          USING ERRCODE = '42501';
      END IF;
      v_result := public.mesa_reagendar_biometricos(
        v_b.expediente_id,
        (p_new_scheduled_at AT TIME ZONE 'America/Monterrey')::DATE,
        (p_new_scheduled_at AT TIME ZONE 'America/Monterrey')::TIME,
        NULLIF(btrim(p_new_location_id), ''),
        v_motivo
      );
    ELSIF v_b.kind = 'firmas' THEN
      IF p_new_scheduled_at IS NULL OR NULLIF(btrim(COALESCE(p_new_location_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar firmas exige fecha/hora y sede'
          USING ERRCODE = '22023';
      END IF;
      v_result := public.mesa_reagendar_firmas(
        v_b.expediente_id,
        p_new_scheduled_at,
        'America/Monterrey',
        NULLIF(btrim(p_new_location_id), ''),
        v_motivo
      );
    ELSIF v_b.kind = 'notificacion' THEN
      IF p_new_booking_date IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar notificación exige fecha'
          USING ERRCODE = '22023';
      END IF;
      IF v_role NOT IN ('mesa_admin', 'super_admin') THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar notificación solo mesa_admin/super_admin'
          USING ERRCODE = '42501';
      END IF;
      v_result := public.mesa_reagendar_notificacion(
        v_b.expediente_id, p_new_booking_date, v_motivo
      );
    ELSE
      RAISE EXCEPTION 'mesa_gestionar_cita: kind no soportado' USING ERRCODE = '22023';
    END IF;

    SELECT b.id INTO v_new_booking_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = v_b.expediente_id
      AND b.kind = v_b.kind
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    INSERT INTO public.agenda_booking_decisiones (
      organization_id, expediente_id, booking_id, kind, decision, motivo, decided_by,
      previous_booking_date, previous_booking_time, previous_location_id,
      new_booking_date, new_booking_time, new_location_id, new_booking_id
    )
    SELECT
      v_b.organization_id, v_b.expediente_id, v_b.id, v_b.kind, 'reagendar', v_motivo, v_actor,
      v_b.booking_date, v_b.booking_time, v_b.location_id,
      nb.booking_date, nb.booking_time, nb.location_id, nb.id
    FROM public.agenda_bookings nb
    WHERE nb.id = v_new_booking_id
    RETURNING id INTO v_decision_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'reagendar',
      'decision_id', v_decision_id,
      'new_booking_id', v_new_booking_id,
      'result', v_result
    );
  END IF;

  RAISE EXCEPTION 'mesa_gestionar_cita: acción no reconocida (%)', p_action
    USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_gestionar_cita(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesa_gestionar_cita(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE) TO authenticated;

COMMENT ON FUNCTION public.mesa_gestionar_cita(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE) IS
  'P118b: Mesa reagendar/cancelar; cancel_continue delega a mesa_cancelar_cita_y_continuar.';
