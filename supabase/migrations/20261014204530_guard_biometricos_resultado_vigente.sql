-- ConCasa | Biométricos: impedir etapas concluidas antes de resultado válido.
-- Snapshot del control validado en producción; idempotente al aplicar en nuevos ambientes.
-- Cita activa desde el 14/10/2026: el resultado CURRENT/COMPLETED_CURRENT
-- sin veto rojo es obligatorio para avanzar desde 4 o 5. Otros expedientes intactos.

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
  IF v_booking.booking_date > v_today AND NOT v_completed THEN
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

DROP TRIGGER IF EXISTS z_guard_expedientes_bio_result_before_stage_bu ON public.expedientes;
CREATE TRIGGER z_guard_expedientes_bio_result_before_stage_bu
BEFORE UPDATE OF etapa_actual ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.guard_expedientes_biometricos_result_before_stage();
