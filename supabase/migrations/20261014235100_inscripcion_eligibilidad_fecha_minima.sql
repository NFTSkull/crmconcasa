-- ConCasa: fecha de inscripción posterior a los biométricos futuros.
-- Sin modificar expedientes, agenda histórica o cupos. Idempotente.

CREATE OR REPLACE FUNCTION public.agenda_inscripcion_asesor_eligibility(p_expediente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp RECORD;
  v_has_req BOOLEAN := false;
  v_has_booking BOOLEAN := false;
  v_inscripcion_sede TEXT := 'monterrey';
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'not_authenticated');
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;
  IF v_role IS DISTINCT FROM 'asesor' THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'not_asesor');
  END IF;

  IF p_expediente_id IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'expediente_unavailable');
  END IF;

  SELECT e.* INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'expediente_unavailable');
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'org_mismatch');
  END IF;
  IF v_exp.asesor_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'not_owner');
  END IF;
  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'ciclo_inactivo');
  END IF;
  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'not_submitted');
  END IF;
  IF v_exp.subestado = 'rechazado' THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'rejected');
  END IF;
  IF NOT public.agenda_inscripcion_etapa_permitida(v_exp.etapa_actual) THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'etapa_fuera');
  END IF;
  IF NOT public.agenda_inscripcion_tiene_biometricos_previos(p_expediente_id) THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'sin_biometricos');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'inscripcion'::public.booking_kind
      AND b.status = 'booked'
  ) INTO v_has_booking;

  SELECT EXISTS (
    SELECT 1 FROM public.agenda_inscripcion_requerimientos r
    WHERE r.expediente_id = p_expediente_id
      AND r.status IN ('pending_booking', 'booked', 'rebook_required')
  ) INTO v_has_req;

  IF public.agenda_inscripcion_permite_apodaca(p_expediente_id) THEN
    v_inscripcion_sede := 'apodaca';
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'reason_code', 'eligible',
    'has_open_requirement', v_has_req,
    'has_active_booking', v_has_booking,
    'location_id', v_inscripcion_sede,
    'fixed_time', '11:00',
    'min_booking_date', public.agenda_inscripcion_earliest_post_bio_date(p_expediente_id),
    'etapa_actual', v_exp.etapa_actual
  );
END;
$function$
;
