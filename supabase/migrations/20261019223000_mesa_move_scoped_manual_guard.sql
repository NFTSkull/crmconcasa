BEGIN;

-- ConCasa 19 Oct 2026. Scope Mesa manual movement to one authorized actor,
-- transaction and expediente. Never use client-spoofable session flags.
CREATE TABLE IF NOT EXISTS public.mesa_manual_move_tx_marker (
 transaction_id bigint NOT NULL,
 expediente_id uuid NOT NULL REFERENCES public.expedientes(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(transaction_id,expediente_id)
);
ALTER TABLE public.mesa_manual_move_tx_marker ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mesa_manual_move_tx_marker FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.mesa_manual_move_tx_marker IS 'Marcador privado de transacción insertado y borrado por Mesa; no se expone a clientes.';

CREATE OR REPLACE FUNCTION public.mesa_manual_move_marker_active(p_expediente_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS (
    SELECT 1
    FROM public.mesa_manual_move_tx_marker m
    JOIN public.profiles p ON p.id=m.actor_id AND p.active=true
    WHERE m.expediente_id=p_expediente_id
      AND m.transaction_id=txid_current_if_assigned()
      AND m.actor_id=public.current_profile_id()
      AND p.app_role IN ('mesa_admin','mesa_interno','mesa_externo','super_admin')
 );
$function$
;

REVOKE ALL ON FUNCTION public.mesa_manual_move_marker_active(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mesa_manual_move_marker_active(uuid) TO authenticated,service_role,postgres;

CREATE OR REPLACE FUNCTION public.guard_expedientes_biometricos_result_before_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_completed BOOLEAN := false;
  v_today date := (now() AT TIME ZONE 'America/Monterrey')::date;
BEGIN
  IF public.mesa_manual_move_marker_active(NEW.id) THEN
    RETURN NEW;
  END IF;
  IF NEW.etapa_actual IS NOT DISTINCT FROM OLD.etapa_actual
     OR NEW.etapa_actual <= OLD.etapa_actual
     OR NEW.etapa_actual < 5
     OR OLD.etapa_actual NOT BETWEEN 3 AND 7
     OR NEW.deleted_at IS NOT NULL
     OR NEW.ciclo_estado <> 'activo'
     OR NEW.submitted_to_mesa IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT b.id,b.booking_date,b.booking_time,b.location_id,
         r.projection_status,r.biometric_effective_result,r.operational_red_veto
  INTO v_booking
  FROM public.agenda_bookings b
  LEFT JOIN LATERAL (
    SELECT r.projection_status,r.biometric_effective_result,r.operational_red_veto
    FROM public.agenda_sheet_operational_results r
    WHERE r.booking_id=b.id
    ORDER BY r.updated_at DESC LIMIT 1
  ) r ON true
  WHERE b.expediente_id=NEW.id
    AND b.organization_id=NEW.organization_id
    AND b.kind='biometricos'::public.booking_kind
    AND b.status='booked'::public.booking_status
  ORDER BY b.booking_date DESC,b.booking_time DESC,b.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN NEW; END IF;

  v_completed := COALESCE((
    v_booking.projection_status='CURRENT'
    AND v_booking.biometric_effective_result='COMPLETED_CURRENT'
    AND COALESCE(v_booking.operational_red_veto,false)=false
  ), false);

  -- Jamás indicar 'realizados' o avanzar con una cita biométrica futura
  -- que sigue pendiente, incluso en movimientos de etapa extraordinarios.
  IF (v_booking.booking_date + v_booking.booking_time) >
     (now() AT TIME ZONE 'America/Monterrey') THEN
    RAISE EXCEPTION
      'BIOMETRICOS_PENDIENTES: cita biométrica futura del %, no se puede avanzar el expediente',
      v_booking.booking_date
      USING ERRCODE='22023';
  END IF;

  -- Para fechas actuales y futuras desde 14/oct: resultado Drive vigente,
  -- confirmación explícita y ninguna marca de rechazo antes de avanzar.
  IF OLD.etapa_actual IN (4,5)
     AND NEW.etapa_actual>=5
     AND v_booking.booking_date >= DATE '2026-10-14'
     AND NOT v_completed THEN
    RAISE EXCEPTION
      'BIOMETRICOS_RESULTADO_PENDIENTE: Mesa debe confirmar resultado biométrico vigente en Drive antes de avanzar de etapa'
      USING ERRCODE='22023';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.agenda_autocancel_future_biometricos_after_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_local_today DATE := (NOW() AT TIME ZONE 'America/Monterrey')::DATE;
  v_actor_id UUID := public.current_profile_id();
  v_actor_role public.app_role;
  v_booking RECORD;
  v_cancelled_count INTEGER := 0;
BEGIN
  IF public.mesa_manual_move_marker_active(NEW.id) THEN
    RETURN NEW;
  END IF;
  IF NEW.etapa_actual IS NOT DISTINCT FROM OLD.etapa_actual
     OR NEW.etapa_actual < 8 THEN
    RETURN NEW;
  END IF;

  IF v_actor_id IS NOT NULL THEN
    SELECT p.app_role
    INTO v_actor_role
    FROM public.profiles p
    WHERE p.id = v_actor_id;
  END IF;

  FOR v_booking IN
    SELECT b.id, b.booking_date, b.booking_time, b.location_id, b.note
    FROM public.agenda_bookings b
    WHERE b.expediente_id = NEW.id
      AND b.kind = 'biometricos'
      AND b.status = 'booked'
      AND b.booking_date > v_local_today
    ORDER BY b.booking_date, b.booking_time, b.created_at
    FOR UPDATE
  LOOP
    UPDATE public.agenda_bookings
    SET
      status = 'cancelled',
      cancelled_at = NOW(),
      note = CASE
        WHEN NULLIF(btrim(COALESCE(note, '')), '') IS NULL
          THEN 'Cancelado automáticamente: expediente ya completó Biométricos.'
        ELSE note || E'\nCancelado automáticamente: expediente ya completó Biométricos.'
      END
    WHERE id = v_booking.id
      AND status = 'booked';

    IF FOUND THEN
      v_cancelled_count := v_cancelled_count + 1;

      INSERT INTO public.action_log (
        organization_id,
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        payload
      ) VALUES (
        NEW.organization_id,
        v_actor_id,
        v_actor_role,
        'agenda.biometricos.auto_cancel_future_after_stage_complete',
        'agenda_booking',
        v_booking.id,
        jsonb_build_object(
          'expediente_id', NEW.id,
          'booking_id', v_booking.id,
          'booking_date', v_booking.booking_date,
          'booking_time', v_booking.booking_time,
          'location_id', v_booking.location_id,
          'etapa_anterior', OLD.etapa_actual,
          'etapa_nueva', NEW.etapa_actual,
          'reason', 'future_biometricos_stale_after_stage_complete'
        )
      );
    END IF;
  END LOOP;

  IF v_cancelled_count > 0 THEN
    UPDATE public.expedientes e
    SET fecha_cita = NULL
    WHERE e.id = NEW.id
      AND e.fecha_cita IS NOT NULL
      AND (e.fecha_cita AT TIME ZONE 'America/Monterrey')::DATE > v_local_today;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mesa_mover_etapa_operativa(p_expediente_id uuid, p_etapa_destino smallint, p_etapa_esperada smallint, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_motivo TEXT;
  v_subestado_destino public.operativo_subestado;
  v_movimiento_id UUID;
  v_direccion TEXT;
  v_reactivacion JSONB := NULL;
  v_subestado_origen public.operativo_subestado;
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

  v_subestado_origen := v_exp.subestado;

  IF v_exp.subestado = 'rechazado' THEN
    -- Override: reactivación canónica + movimiento en la misma transacción.
    v_reactivacion := public.reactivar_expediente_rechazado(p_expediente_id);
  ELSIF v_exp.subestado NOT IN ('pendiente', 'en_validacion_mesa', 'en_proceso') THEN
    RAISE EXCEPTION 'MESA_MOVE_BAD_SUBSTATE: subestado no elegible (%)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF p_etapa_destino IS NULL OR p_etapa_destino NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_BAD_DESTINATION: etapa destino debe estar entre 1 y 12'
      USING ERRCODE = '22023';
  END IF;

  IF p_etapa_esperada IS NULL OR p_etapa_esperada NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa esperada debe estar entre 1 y 12'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual <> p_etapa_esperada THEN
    RAISE EXCEPTION 'MESA_MOVE_STAGE_CONFLICT: etapa actual %, esperada %',
      v_exp.etapa_actual, p_etapa_esperada
      USING ERRCODE = '22023';
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
    v_subestado_origen,
    v_subestado_destino,
    v_motivo,
    v_actor_id,
    v_actor_role
  )
  RETURNING id INTO v_movimiento_id;

  INSERT INTO public.mesa_manual_move_tx_marker(transaction_id,expediente_id,actor_id)
  VALUES(txid_current(),p_expediente_id,v_actor_id);

  -- Override Mesa seguro, SOLO durante esta transacción y expediente.
  UPDATE public.expedientes
  SET
    etapa_actual = p_etapa_destino,
    subestado = v_subestado_destino,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  DELETE FROM public.mesa_manual_move_tx_marker
  WHERE transaction_id=txid_current()
    AND expediente_id=p_expediente_id AND actor_id=v_actor_id;

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
      'subestado_anterior', v_subestado_origen,
      'subestado_nuevo', v_subestado_destino,
      'direccion', v_direccion,
      'motivo', v_motivo,
      'movimiento_manual', true,
      'sin_efectos_adicionales', true,
      'reactivado', (v_reactivacion IS NOT NULL),
      'reactivacion_id', CASE
        WHEN v_reactivacion IS NULL THEN NULL
        ELSE v_reactivacion ->> 'reactivacion_id'
      END
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'movimiento_id', v_movimiento_id,
    'etapa_anterior', v_exp.etapa_actual,
    'etapa_actual', p_etapa_destino,
    'subestado_anterior', v_subestado_origen,
    'subestado', v_subestado_destino,
    'direccion', v_direccion,
    'reactivado', (v_reactivacion IS NOT NULL),
    'reactivacion_id', CASE
      WHEN v_reactivacion IS NULL THEN NULL
      ELSE v_reactivacion ->> 'reactivacion_id'
    END
  );
END;
$function$
;
COMMIT;
