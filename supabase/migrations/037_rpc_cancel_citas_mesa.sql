-- ConCasa CRM — Mesa cancela citas biométricas/firmas con motivo (reagenda asesor)
-- Extiende cancel_biometricos (etapas 4/5, roles Mesa) y cancel_firmas (mesa_interno/externo).
-- No cambia etapa; no borra bookings históricos.

-- =============================================================================
-- cancel_biometricos
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_biometricos(
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
  v_booking RECORD;
  v_motivo TEXT;
  v_fecha_cita_anterior TIMESTAMPTZ;
  v_etapa_actual SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'cancel_biometricos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_biometricos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN (
    'asesor', 'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'cancel_biometricos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'cancel_biometricos: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  IF v_actor_role <> 'asesor' AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'cancel_biometricos: el motivo es obligatorio para Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.fecha_cita,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_biometricos: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cancel_biometricos: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'cancel_biometricos: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'asesor'
     AND v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'cancel_biometricos: solo el asesor dueño puede cancelar biométricos'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin')
     AND NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'cancel_biometricos: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'cancel_biometricos: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'cancel_biometricos: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'cancel_biometricos: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (4, 5) THEN
    RAISE EXCEPTION 'cancel_biometricos: solo se puede cancelar en etapa 4 o 5 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  SELECT
    b.id,
    b.booking_date,
    b.booking_time,
    b.location_id,
    b.note
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = 'biometricos'
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_biometricos: no hay cita biométrica activa para cancelar'
      USING ERRCODE = '22023';
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;
  v_etapa_actual := v_exp.etapa_actual;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN v_motivo IS NOT NULL THEN
        CASE
          WHEN note IS NULL OR btrim(note) = '' THEN 'Cancelado: ' || v_motivo
          ELSE note || E'\nCancelado: ' || v_motivo
        END
      ELSE note
    END
  WHERE id = v_booking.id;

  UPDATE public.expedientes
  SET
    fecha_cita = NULL,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.biometricos.cancel',
    'agenda_booking',
    v_booking.id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'expediente_id', p_expediente_id,
      'booking_id', v_booking.id,
      'motivo', v_motivo,
      'etapa_actual', v_etapa_actual,
      'fecha_cita_anterior', v_fecha_cita_anterior,
      'booking_date', v_booking.booking_date,
      'booking_time', v_booking.booking_time,
      'location_id', v_booking.location_id,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking.id,
    'status', 'cancelled',
    'fecha_cita', NULL,
    'etapa_actual', v_etapa_actual,
    'no_etapa_change', true
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_biometricos(UUID, TEXT) IS
  'Asesor dueño o Mesa cancela cita biométrica activa (etapas 4/5). Motivo obligatorio para Mesa. Limpia fecha_cita; no cambia etapa.';

-- =============================================================================
-- cancel_firmas
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_firmas(
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
  v_booking RECORD;
  v_motivo TEXT;
  v_fecha_cita_anterior TIMESTAMPTZ;
  v_kind public.booking_kind := 'firmas';
  v_etapa_actual SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'cancel_firmas: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_firmas: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN (
    'asesor', 'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'cancel_firmas: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'cancel_firmas: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  IF v_actor_role <> 'asesor' AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'cancel_firmas: el motivo es obligatorio para Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.fecha_cita,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_firmas: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cancel_firmas: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'cancel_firmas: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'asesor'
     AND v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'cancel_firmas: solo el asesor dueño puede cancelar firma'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin')
     AND NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'cancel_firmas: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'cancel_firmas: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'cancel_firmas: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'cancel_firmas: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'cancel_firmas: solo se puede cancelar en etapa 9 o 10 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  SELECT
    b.id,
    b.booking_date,
    b.booking_time,
    b.location_id,
    b.note
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = v_kind
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_firmas: no hay cita de firma activa para cancelar'
      USING ERRCODE = '22023';
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;
  v_etapa_actual := v_exp.etapa_actual;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN v_motivo IS NOT NULL THEN
        CASE
          WHEN note IS NULL OR btrim(note) = '' THEN 'Cancelado: ' || v_motivo
          ELSE note || E'\nCancelado: ' || v_motivo
        END
      ELSE note
    END
  WHERE id = v_booking.id;

  UPDATE public.expedientes
  SET
    fecha_cita = NULL,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.cancel',
    'agenda_booking',
    v_booking.id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'booking_id', v_booking.id,
      'expediente_id', p_expediente_id,
      'motivo', v_motivo,
      'etapa_actual', v_etapa_actual,
      'fecha_cita_anterior', v_fecha_cita_anterior,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking.id,
    'kind', v_kind,
    'status', 'cancelled',
    'fecha_cita', NULL,
    'etapa_actual', v_etapa_actual,
    'no_etapa_change', true
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_firmas(UUID, TEXT) IS
  'Asesor dueño o Mesa (admin/interno/externo/super) cancela cita firmas activa (etapas 9/10). Motivo obligatorio para Mesa. Limpia fecha_cita; no cambia etapa.';
