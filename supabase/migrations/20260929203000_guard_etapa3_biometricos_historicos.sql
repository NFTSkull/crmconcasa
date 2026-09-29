-- ConCasa CRM — guard permanente contra biométricos históricos en etapa 3
-- Refuerza P488 con una defensa en la transición operativa:
-- cuando un expediente queda "Etapa 3 / en_proceso / activo / enviado a Mesa",
-- cualquier cita biométrica booked con fecha anterior a hoy (America/Monterrey)
-- se cierra automáticamente y deja de bloquear al asesor.
--
-- Capas resultantes:
-- 1) Guard de transición a etapa 3 (esta migración).
-- 2) Inbox etapa 3 ignora bookings históricos (P488).
-- 3) book_biometricos autocierra un histórico antes de crear la nueva cita (P488).
-- 4) Barrido DB-only horario como red de seguridad, sin egress.

CREATE OR REPLACE FUNCTION public.close_stale_biometricos_for_stage3(
  p_expediente_id UUID,
  p_action TEXT DEFAULT 'agenda.biometricos.stale_stage3_guard'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_exp RECORD;
  v_booking RECORD;
  v_closed INTEGER := 0;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado::text AS subestado,
    e.ciclo_estado::text AS ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND
     OR v_exp.deleted_at IS NOT NULL
     OR v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS DISTINCT FROM TRUE
     OR v_exp.etapa_actual IS DISTINCT FROM 3
     OR v_exp.subestado IS DISTINCT FROM 'en_proceso' THEN
    RETURN 0;
  END IF;

  FOR v_booking IN
    SELECT
      b.id,
      b.booking_date,
      b.booking_time,
      b.location_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'biometricos'
      AND b.status = 'booked'
      AND b.booking_date < (clock_timestamp() AT TIME ZONE 'America/Monterrey')::date
    ORDER BY b.created_at ASC, b.id ASC
    FOR UPDATE
  LOOP
    UPDATE public.agenda_bookings
    SET
      status = 'cancelled',
      cancelled_at = NOW(),
      note = CASE
        WHEN note IS NULL OR btrim(note) = '' THEN
          'Auto-cierre preventivo: cita biométrica histórica incompatible con etapa 3.'
        ELSE
          note || E'\nAuto-cierre preventivo: cita biométrica histórica incompatible con etapa 3.'
      END
    WHERE id = v_booking.id
      AND status = 'booked';

    IF FOUND THEN
      v_closed := v_closed + 1;

      PERFORM public.log_action(
        v_exp.organization_id,
        NULL,
        NULL,
        COALESCE(NULLIF(btrim(p_action), ''), 'agenda.biometricos.stale_stage3_guard'),
        'agenda_booking',
        v_booking.id,
        jsonb_build_object(
          'expediente_id', p_expediente_id,
          'booking_id', v_booking.id,
          'booking_date', v_booking.booking_date,
          'booking_time', v_booking.booking_time,
          'location_id', v_booking.location_id,
          'reason', 'stage3_cannot_keep_past_booked_biometricos'
        )
      );
    END IF;
  END LOOP;

  IF v_closed > 0 THEN
    UPDATE public.expedientes
    SET fecha_cita = NULL,
        updated_at = NOW()
    WHERE id = p_expediente_id
      AND etapa_actual = 3
      AND subestado = 'en_proceso';
  END IF;

  RETURN v_closed;
END;
$function$;

REVOKE ALL ON FUNCTION public.close_stale_biometricos_for_stage3(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_stale_biometricos_for_stage3(UUID, TEXT)
  TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.guard_stage3_stale_biometricos_after_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.deleted_at IS NULL
     AND NEW.ciclo_estado::text = 'activo'
     AND NEW.submitted_to_mesa IS TRUE
     AND NEW.etapa_actual = 3
     AND NEW.subestado::text = 'en_proceso' THEN
    PERFORM public.close_stale_biometricos_for_stage3(
      NEW.id,
      'agenda.biometricos.stale_stage3_transition_guard'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expedientes_guard_stage3_stale_biometricos_au
  ON public.expedientes;

CREATE TRIGGER expedientes_guard_stage3_stale_biometricos_au
AFTER UPDATE OF etapa_actual, subestado, ciclo_estado, submitted_to_mesa
ON public.expedientes
FOR EACH ROW
WHEN (
  NEW.deleted_at IS NULL
  AND NEW.ciclo_estado::text = 'activo'
  AND NEW.submitted_to_mesa IS TRUE
  AND NEW.etapa_actual = 3
  AND NEW.subestado::text = 'en_proceso'
)
EXECUTE FUNCTION public.guard_stage3_stale_biometricos_after_transition();

REVOKE ALL ON FUNCTION public.guard_stage3_stale_biometricos_after_transition()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sweep_stage3_stale_biometricos(
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row RECORD;
  v_examined INTEGER := 0;
  v_expedientes_fixed INTEGER := 0;
  v_bookings_closed INTEGER := 0;
  v_closed INTEGER;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  FOR v_row IN
    SELECT DISTINCT e.id
    FROM public.expedientes e
    JOIN public.agenda_bookings b
      ON b.expediente_id = e.id
     AND b.kind = 'biometricos'
     AND b.status = 'booked'
     AND b.booking_date < (clock_timestamp() AT TIME ZONE 'America/Monterrey')::date
    WHERE e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa IS TRUE
      AND e.etapa_actual = 3
      AND e.subestado = 'en_proceso'
    ORDER BY e.id
    LIMIT v_limit
  LOOP
    v_examined := v_examined + 1;
    v_closed := public.close_stale_biometricos_for_stage3(
      v_row.id,
      'agenda.biometricos.stale_stage3_sweep'
    );

    IF v_closed > 0 THEN
      v_expedientes_fixed := v_expedientes_fixed + 1;
      v_bookings_closed := v_bookings_closed + v_closed;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'examined', v_examined,
    'expedientes_fixed', v_expedientes_fixed,
    'bookings_closed', v_bookings_closed,
    'limit', v_limit
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_stage3_stale_biometricos(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stage3_stale_biometricos(INTEGER)
  TO postgres, service_role;

DO $guard$
DECLARE
  r RECORD;
  v_jobid BIGINT;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE NOTICE 'stage3 stale biometricos guard: skip cron (database=%)', current_database();
    RETURN;
  END IF;

  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'biometricos-stage3-stale-guard-hourly'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  SELECT cron.schedule(
    'biometricos-stage3-stale-guard-hourly',
    '37 * * * *',
    $cron$SELECT public.sweep_stage3_stale_biometricos(100);$cron$
  )
  INTO v_jobid;

  RAISE NOTICE 'stage3 stale biometricos guard scheduled jobid=%', v_jobid;
END
$guard$;

COMMENT ON FUNCTION public.close_stale_biometricos_for_stage3(UUID, TEXT) IS
  'Preventivo: etapa 3/en_proceso no puede conservar biométricos booked con fecha pasada.';
COMMENT ON FUNCTION public.sweep_stage3_stale_biometricos(INTEGER) IS
  'Red de seguridad horaria DB-only para cerrar bookings biométricos históricos que bloqueen etapa 3.';
