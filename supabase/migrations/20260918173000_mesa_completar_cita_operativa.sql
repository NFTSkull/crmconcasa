-- ConCasa CRM — Mesa Citas: cerrar cita ocurrida y llevar expediente al destino operativo.
-- Biométricos -> Acuse (4/5 -> 8)
-- Firma -> Firmado (9/10 -> 11)
-- Inscripción extraordinaria -> Acuse + requirement completed (3..7 -> 8)
-- No cancela/reagenda bookings, no toca cupos/inventario/Sheets y no exige Drive.

CREATE OR REPLACE FUNCTION public.mesa_completar_cita_operativa(
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_book public.agenda_bookings%ROWTYPE;
  v_exp public.expedientes%ROWTYPE;
  v_req public.agenda_inscripcion_requerimientos%ROWTYPE;
  v_initial SMALLINT;
  v_final SMALLINT;
  v_now_local TIMESTAMP WITHOUT TIME ZONE;
  v_booking_local TIMESTAMP WITHOUT TIME ZONE;
  v_idempotent BOOLEAN := false;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.active = true;

  IF v_role IS NULL
     OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: booking_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT b.*
  INTO v_book
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: cita no encontrada'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_book.kind::TEXT NOT IN ('biometricos','firmas','inscripcion') THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: tipo de cita no compatible (%)', v_book.kind
      USING ERRCODE = '22023';
  END IF;

  IF v_book.status IS DISTINCT FROM 'booked'::public.booking_status THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: la cita no está activa'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_book.expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_book.organization_id THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: organización inconsistente'
      USING ERRCODE = '22023';
  END IF;

  IF v_role IS DISTINCT FROM 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: expediente fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_role IS DISTINCT FROM 'super_admin'
     AND NOT public.can_see_expediente(v_exp.id) THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.subestado = 'rechazado' THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: expediente no elegible'
      USING ERRCODE = '22023';
  END IF;

  IF public.agenda_booking_has_contingency(p_booking_id) THEN
    RAISE EXCEPTION 'BOOKING_UNDER_CONTINGENCY'
      USING ERRCODE = '22023';
  END IF;

  v_now_local := timezone('America/Monterrey', now());
  v_booking_local := v_book.booking_date::TIMESTAMP + v_book.booking_time;

  IF v_booking_local > v_now_local THEN
    RAISE EXCEPTION 'mesa_completar_cita_operativa: la cita todavía no ocurre'
      USING ERRCODE = '22023';
  END IF;

  v_initial := v_exp.etapa_actual;

  IF v_book.kind::TEXT = 'biometricos' THEN
    IF v_exp.etapa_actual = 8 THEN
      v_idempotent := true;
      v_final := 8;
    ELSIF v_exp.etapa_actual NOT IN (4, 5) THEN
      RAISE EXCEPTION
        'mesa_completar_cita_operativa: biométricos no compatibles desde etapa %',
        v_exp.etapa_actual
        USING ERRCODE = '22023';
    ELSE
      IF v_exp.etapa_actual = 4 THEN
        PERFORM public.avanzar_etapa_operativa(
          v_exp.id,
          'Mesa Citas: biométricos completados'
        );
        SELECT e.* INTO v_exp
        FROM public.expedientes e
        WHERE e.id = v_book.expediente_id
        FOR UPDATE;
      END IF;

      IF v_exp.etapa_actual = 5 THEN
        PERFORM public.avanzar_etapa_operativa(
          v_exp.id,
          'Mesa Citas: biométricos completados; pasar a Acuse'
        );
        SELECT e.* INTO v_exp
        FROM public.expedientes e
        WHERE e.id = v_book.expediente_id
        FOR UPDATE;
      END IF;

      IF v_exp.etapa_actual IS DISTINCT FROM 8 THEN
        RAISE EXCEPTION
          'mesa_completar_cita_operativa: biométricos no alcanzaron Acuse (etapa %)',
          v_exp.etapa_actual
          USING ERRCODE = '22023';
      END IF;
      v_final := 8;
    END IF;

  ELSIF v_book.kind::TEXT = 'firmas' THEN
    IF v_exp.etapa_actual = 11 THEN
      v_idempotent := true;
      v_final := 11;
    ELSIF v_exp.etapa_actual NOT IN (9, 10) THEN
      RAISE EXCEPTION
        'mesa_completar_cita_operativa: firma no compatible desde etapa %',
        v_exp.etapa_actual
        USING ERRCODE = '22023';
    ELSE
      IF v_exp.etapa_actual = 9 THEN
        PERFORM public.avanzar_etapa_operativa(
          v_exp.id,
          'Mesa Citas: cita de firma realizada'
        );
        SELECT e.* INTO v_exp
        FROM public.expedientes e
        WHERE e.id = v_book.expediente_id
        FOR UPDATE;
      END IF;

      IF v_exp.etapa_actual = 10 THEN
        PERFORM public.avanzar_etapa_operativa(
          v_exp.id,
          'Mesa Citas: firma completada'
        );
        SELECT e.* INTO v_exp
        FROM public.expedientes e
        WHERE e.id = v_book.expediente_id
        FOR UPDATE;
      END IF;

      IF v_exp.etapa_actual IS DISTINCT FROM 11 THEN
        RAISE EXCEPTION
          'mesa_completar_cita_operativa: firma no alcanzó Firmado (etapa %)',
          v_exp.etapa_actual
          USING ERRCODE = '22023';
      END IF;
      v_final := 11;
    END IF;

  ELSE
    SELECT r.*
    INTO v_req
    FROM public.agenda_inscripcion_requerimientos r
    WHERE r.expediente_id = v_exp.id
      AND r.booked_booking_id = p_booking_id
      AND r.status IN ('booked','completed')
    ORDER BY r.updated_at DESC NULLS LAST
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'mesa_completar_cita_operativa: inscripción sin requerimiento asociado'
        USING ERRCODE = '22023';
    END IF;

    IF v_exp.etapa_actual < 3 OR v_exp.etapa_actual > 8 THEN
      RAISE EXCEPTION
        'mesa_completar_cita_operativa: inscripción no compatible desde etapa %',
        v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;

    IF v_exp.etapa_actual = 8 AND v_req.status = 'completed' THEN
      v_idempotent := true;
      v_final := 8;
    ELSE
      PERFORM public.assert_expediente_vigencia_documental_ok(v_exp.id);

      IF v_exp.etapa_actual <> 8 THEN
        UPDATE public.expedientes
        SET
          etapa_actual = 8,
          subestado = 'en_proceso',
          updated_at = NOW()
        WHERE id = v_exp.id;
      END IF;

      UPDATE public.agenda_inscripcion_requerimientos
      SET
        status = 'completed',
        completed_at = COALESCE(completed_at, NOW()),
        updated_at = NOW()
      WHERE id = v_req.id;

      PERFORM public.log_action(
        v_exp.organization_id,
        v_actor,
        v_role,
        'agenda.inscripcion.complete_advance',
        'agenda_booking',
        p_booking_id,
        jsonb_build_object(
          'expediente_id', v_exp.id,
          'requirement_id', v_req.id,
          'booking_id', p_booking_id,
          'etapa_anterior', v_initial,
          'etapa_nueva', 8,
          'kind', 'inscripcion',
          'booking_date', v_book.booking_date,
          'booking_time', v_book.booking_time,
          'location_id', v_book.location_id,
          'fecha_cita_unchanged', true
        )
      );

      v_final := 8;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', v_idempotent,
    'booking_id', p_booking_id,
    'expediente_id', v_exp.id,
    'kind', v_book.kind,
    'etapa_anterior', v_initial,
    'etapa_actual', v_final
  );
END;
$function$;

COMMENT ON FUNCTION public.mesa_completar_cita_operativa(UUID) IS
  'Mesa: cita ocurrida -> destino operativo. Biométricos 4/5→8, firmas 9/10→11, inscripción 3..7→8 + requirement completed. No cambia booking/cupo/Sheets.';

REVOKE ALL ON FUNCTION public.mesa_completar_cita_operativa(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_completar_cita_operativa(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_completar_cita_operativa(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_completar_cita_operativa(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mesa_completar_cita_operativa(UUID) TO postgres;
