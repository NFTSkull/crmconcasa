-- ConCasa CRM — cerrar citas biométricas futuras obsoletas al completar biométricos.
-- Alcance quirúrgico:
--   * solo agenda_bookings.kind = 'biometricos'
--   * solo status = 'booked'
--   * solo booking_date FUTURA respecto a America/Monterrey
--   * solo cuando etapa_actual cambia y queda >= 8
-- No toca citas de hoy/pasadas, Firmas, Inscripción, capacidad ni etapas.

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
$function$;

REVOKE ALL ON FUNCTION public.agenda_autocancel_future_biometricos_after_stage()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_agenda_autocancel_future_biometricos_after_stage
  ON public.expedientes;

CREATE TRIGGER trg_agenda_autocancel_future_biometricos_after_stage
AFTER UPDATE OF etapa_actual ON public.expedientes
FOR EACH ROW
WHEN (NEW.etapa_actual IS DISTINCT FROM OLD.etapa_actual)
EXECUTE FUNCTION public.agenda_autocancel_future_biometricos_after_stage();

COMMENT ON FUNCTION public.agenda_autocancel_future_biometricos_after_stage() IS
  'Cancela solo bookings biométricos FUTUROS aún activos cuando el expediente ya queda en etapa >= 8; deja hoy/pasado intactos y permite al outbox CRM→Sheet liberar la fila.';
