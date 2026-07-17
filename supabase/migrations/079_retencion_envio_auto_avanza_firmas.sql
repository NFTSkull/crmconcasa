-- ConCasa CRM — P079: envío retención avanza atómicamente 8→9 (listo agendar firma)
-- No marca documentos como validado. No crea bookings ni fecha_cita.
-- No modifica migraciones 001–078.

-- =============================================================================
-- Gate 8→9: principal activo en subido|resubido|validado (sin exigir validado Mesa)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.avanzar_etapa_operativa_pre_reingreso(p_expediente_id uuid, p_comentario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_cliente public.cliente_datos%ROWTYPE;
  v_docs_validados INTEGER;
  v_subestado_anterior public.operativo_subestado;
  v_comentario_final TEXT;
  v_subestado_nuevo public.operativo_subestado := 'en_proceso';
  v_booking_id UUID;
  v_fecha_cita TIMESTAMPTZ;
  v_booking_date DATE;
  v_booking_time TIME;
  v_location_id TEXT;
  v_envio public.retencion_envios%ROWTYPE;
  v_opcion_efectiva public.retencion_opcion;
  v_required_docs TEXT[];
  v_tipo_doc TEXT;
  v_doc_estatus public.estatus_revision;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_comentario_final := NULLIF(btrim(COALESCE(p_comentario, '')), '');

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
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual = 1 THEN
    IF v_exp.subestado <> 'en_validacion_mesa' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_validacion_mesa (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    SELECT cd.*
    INTO v_cliente
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: faltan datos del cliente'
        USING ERRCODE = '22023';
    END IF;

    IF v_cliente.estado <> 'validado' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: datos del cliente deben estar validados por Mesa (actual: %)', v_cliente.estado
        USING ERRCODE = '22023';
    END IF;

    v_docs_validados := public.count_integration_docs_validados(p_expediente_id);

    IF NOT public.integration_docs_todos_validados(p_expediente_id) THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: faltan documentos obligatorios validados (% de %)', v_docs_validados, cardinality(public.integration_doc_tipos_obligatorios())
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 2,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 1,
        'etapa_nueva', 2,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'documentos_obligatorios_validados_count', v_docs_validados
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 1,
      'etapa_actual', 2,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'documentos_obligatorios_validados_count', v_docs_validados
    );
  ELSIF v_exp.etapa_actual = 2 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 3,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 2,
        'etapa_nueva', 3,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '2_3'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 2,
      'etapa_actual', 3,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final
    );
  ELSIF v_exp.etapa_actual = 3 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_fecha_cita := v_exp.fecha_cita;

    IF v_fecha_cita IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta fecha de notificación'
        USING ERRCODE = '22023';
    END IF;

    SELECT b.id
    INTO v_booking_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'notificacion'
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta notificación activa'
        USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = p_expediente_id
        AND b.kind = 'biometricos'
        AND b.status = 'booked'
    ) THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: transición 3→5 solo aplica con notificación activa, no biométricos'
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 5,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 3,
        'etapa_nueva', 5,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'comentario', v_comentario_final,
        'transition', '3_5_notificacion',
        'booking_kind', 'notificacion'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 3,
      'etapa_actual', 5,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final
    );
  ELSIF v_exp.etapa_actual = 4 THEN
    v_fecha_cita := v_exp.fecha_cita;

    IF v_fecha_cita IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta fecha de cita biométrica'
        USING ERRCODE = '22023';
    END IF;

    SELECT b.id
    INTO v_booking_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'biometricos'
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta booking biométrico activo'
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 5,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 4,
        'etapa_nueva', 5,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'comentario', v_comentario_final
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 4,
      'etapa_actual', 5,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'booking_id', v_booking_id,
      'fecha_cita', v_fecha_cita
    );
  ELSIF v_exp.etapa_actual = 5 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_fecha_cita := v_exp.fecha_cita;

    IF v_fecha_cita IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta fecha de cita biométrica'
        USING ERRCODE = '22023';
    END IF;

    IF v_fecha_cita > NOW() THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: cita biométrica aún no ha ocurrido'
        USING ERRCODE = '22023';
    END IF;

    SELECT b.id
    INTO v_booking_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'biometricos'
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta booking biométrico activo'
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 6,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 5,
        'etapa_nueva', 6,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'comentario', v_comentario_final,
        'transition', '5_6'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 5,
      'etapa_actual', 6,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'booking_id', v_booking_id,
      'fecha_cita', v_fecha_cita
    );
  ELSIF v_exp.etapa_actual = 6 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 7,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 6,
        'etapa_nueva', 7,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '6_7'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 6,
      'etapa_actual', 7,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final
    );
  ELSIF v_exp.etapa_actual = 7 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 8,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 7,
        'etapa_nueva', 8,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '7_8'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 7,
      'etapa_actual', 8,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final
    );
  ELSIF v_exp.etapa_actual = 8 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    SELECT cd.*
    INTO v_cliente
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;

    IF NOT FOUND OR v_cliente.estado <> 'validado' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: cliente_datos no validado'
        USING ERRCODE = '22023';
    END IF;

    SELECT re.*
    INTO v_envio
    FROM public.retencion_envios re
    WHERE re.expediente_id = p_expediente_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: retención no enviada'
        USING ERRCODE = '22023';
    END IF;

    IF v_envio.enviado IS NOT TRUE THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: retención no enviada'
        USING ERRCODE = '22023';
    END IF;

    IF v_envio.estado = 'correccion_requerida' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: retención requiere corrección'
        USING ERRCODE = '22023';
    END IF;

    IF v_envio.estado <> 'enviado' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: retención no enviada'
        USING ERRCODE = '22023';
    END IF;

    v_opcion_efectiva := v_envio.opcion;

    IF v_opcion_efectiva IS NULL THEN
      SELECT ro.retencion_opcion
      INTO v_opcion_efectiva
      FROM public.retencion_opciones ro
      WHERE ro.expediente_id = p_expediente_id;
    END IF;

    IF v_opcion_efectiva IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: opción de retención no encontrada'
        USING ERRCODE = '22023';
    END IF;

    v_required_docs := public.retencion_doc_tipos_requeridos(v_opcion_efectiva);

    FOREACH v_tipo_doc IN ARRAY v_required_docs
    LOOP
      SELECT d.estatus_revision
      INTO v_doc_estatus
      FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.tipo_documento = v_tipo_doc
        AND d.deleted_at IS NULL
      ORDER BY d.created_at DESC
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'avanzar_etapa_operativa: documento de retención faltante'
          USING ERRCODE = '22023';
      END IF;

      IF v_doc_estatus NOT IN ('subido', 'resubido', 'validado') THEN
        RAISE EXCEPTION 'avanzar_etapa_operativa: documento de retención no listo para avance (%)', v_doc_estatus
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 9,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 8,
        'etapa_nueva', 9,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '8_9',
        'retencion_opcion', v_opcion_efectiva,
        'required_documentos', to_jsonb(v_required_docs)
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 8,
      'etapa_actual', 9,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'retencion_opcion', v_opcion_efectiva,
      'required_documentos', to_jsonb(v_required_docs)
    );
  ELSIF v_exp.etapa_actual = 9 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    v_fecha_cita := v_exp.fecha_cita;

    IF v_fecha_cita IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta fecha de cita de firma'
        USING ERRCODE = '22023';
    END IF;

    SELECT b.id, b.booking_date, b.booking_time, b.location_id
    INTO v_booking_id, v_booking_date, v_booking_time, v_location_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'firmas'
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: falta booking de firma activo'
        USING ERRCODE = '22023';
    END IF;

    -- P2C-20: no comparamos fecha_cita vs booking_date/time por riesgo de timezone;
    -- basta con fecha_cita + booking activo kind=firmas status=booked (mismo patrón que 4→5).

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 10,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 9,
        'etapa_nueva', 10,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'booking_date', v_booking_date,
        'booking_time', v_booking_time,
        'location_id', v_location_id,
        'comentario', v_comentario_final,
        'transition', '9_10',
        'kind', 'firmas'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 9,
      'etapa_actual', 10,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'booking_id', v_booking_id,
      'fecha_cita', v_fecha_cita,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'transition', '9_10',
      'kind', 'firmas'
    );
  ELSE
    RAISE EXCEPTION 'avanzar_etapa_operativa: transición no permitida desde etapa %', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.avanzar_etapa_operativa_pre_reingreso(UUID, TEXT) IS
  'P079: gate 8→9 acepta documento principal retención en subido|resubido|validado (sin exigir validación Mesa).';


-- =============================================================================
-- enviar_retencion_mesa: registra envío + avanza 8→9 atómicamente
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enviar_retencion_mesa(
  p_expediente_id UUID,
  p_retencion_opcion public.retencion_opcion
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
  v_envio public.retencion_envios%ROWTYPE;
  v_tipo TEXT;
  v_estatus public.estatus_revision;
  v_required TEXT[];
  v_is_resend BOOLEAN := false;
  v_estado_anterior public.retencion_envio_estado;
  v_fecha_envio TIMESTAMPTZ;
  v_etapa_anterior SMALLINT;
  v_etapa_nueva SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_retencion_opcion IS NULL THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: retencion_opcion es obligatoria'
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
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: solo el asesor dueño puede enviar retención'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_exp.submitted_to_mesa THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  SELECT re.*
  INTO v_envio
  FROM public.retencion_envios re
  WHERE re.expediente_id = p_expediente_id;

  -- Idempotencia: ya en etapa 9 con bloque enviado (reintento/doble clic)
  IF v_exp.etapa_actual = 9
     AND FOUND
     AND v_envio.enviado = true
     AND v_envio.estado = 'enviado' THEN
    v_required := public.retencion_doc_tipos_requeridos(
      COALESCE(v_envio.opcion, p_retencion_opcion)
    );
    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'retencion_opcion', COALESCE(v_envio.opcion, p_retencion_opcion),
      'estado', 'enviado',
      'enviado', true,
      'fecha_envio_mesa', v_envio.fecha_envio_mesa,
      'is_resend', false,
      'required_documentos', to_jsonb(v_required),
      'etapa_anterior', 9,
      'etapa_actual', 9,
      'idempotent', true
    );
  END IF;

  -- Reenvío tras corrección: permitido en etapa 8 o 9 si correccion_requerida
  IF FOUND AND v_envio.estado = 'correccion_requerida' THEN
    IF v_exp.etapa_actual NOT IN (8, 9) THEN
      RAISE EXCEPTION 'enviar_retencion_mesa: expediente debe estar en etapa 8 o 9 para reenvío (actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
    v_is_resend := true;
    v_estado_anterior := v_envio.estado;
  ELSIF v_exp.etapa_actual <> 8 THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: expediente debe estar en etapa 8 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  ELSIF FOUND THEN
    v_estado_anterior := v_envio.estado;
    IF v_envio.estado = 'enviado' AND v_envio.enviado = true THEN
      RAISE EXCEPTION 'enviar_retencion_mesa: bloque ya enviado a Mesa'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_estado_anterior := NULL;
  END IF;

  v_required := public.retencion_doc_tipos_requeridos(p_retencion_opcion);

  FOREACH v_tipo IN ARRAY v_required
  LOOP
    SELECT d.estatus_revision
    INTO v_estatus
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND d.tipo_documento = v_tipo
      AND d.deleted_at IS NULL
    ORDER BY d.created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'enviar_retencion_mesa: falta documento %', v_tipo
        USING ERRCODE = '22023';
    END IF;

    IF v_estatus = 'rechazado' THEN
      RAISE EXCEPTION 'enviar_retencion_mesa: documento % rechazado; reemplazar antes de enviar', v_tipo
        USING ERRCODE = '22023';
    END IF;

    IF v_estatus NOT IN ('subido', 'resubido', 'validado') THEN
      RAISE EXCEPTION 'enviar_retencion_mesa: documento % no listo para envío (%)', v_tipo, v_estatus
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_fecha_envio := NOW();
  v_etapa_anterior := v_exp.etapa_actual;
  v_etapa_nueva := 9;

  INSERT INTO public.retencion_opciones (
    expediente_id,
    organization_id,
    retencion_opcion,
    updated_by
  ) VALUES (
    p_expediente_id,
    v_exp.organization_id,
    p_retencion_opcion,
    v_actor_id
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    retencion_opcion = EXCLUDED.retencion_opcion,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();

  INSERT INTO public.retencion_envios (
    expediente_id,
    organization_id,
    enviado,
    fecha_envio_mesa,
    opcion,
    estado
  ) VALUES (
    p_expediente_id,
    v_exp.organization_id,
    true,
    v_fecha_envio,
    p_retencion_opcion,
    'enviado'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    enviado = true,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    opcion = EXCLUDED.opcion,
    estado = 'enviado',
    updated_at = NOW();

  UPDATE public.expedientes
  SET
    etapa_actual = 9,
    subestado = 'en_proceso',
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.enviar_retencion_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'retencion_opcion', p_retencion_opcion,
      'required_documentos', to_jsonb(v_required),
      'is_resend', v_is_resend,
      'estado_anterior', v_estado_anterior,
      'estado_nuevo', 'enviado',
      'etapa_anterior', v_etapa_anterior,
      'etapa_nueva', v_etapa_nueva,
      'transition', '8_9',
      'p079_auto_avance_firmas', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'retencion_opcion', p_retencion_opcion,
    'estado', 'enviado',
    'enviado', true,
    'fecha_envio_mesa', v_fecha_envio,
    'is_resend', v_is_resend,
    'required_documentos', to_jsonb(v_required),
    'etapa_anterior', v_etapa_anterior,
    'etapa_actual', v_etapa_nueva,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.enviar_retencion_mesa(UUID, public.retencion_opcion) IS
  'P079: asesor dueño envía/reenvía Acuse retención y avanza atómicamente 8→9. No valida docs ni crea booking.';

REVOKE ALL ON FUNCTION public.enviar_retencion_mesa(UUID, public.retencion_opcion) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_retencion_mesa(UUID, public.retencion_opcion) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_retencion_mesa(UUID, public.retencion_opcion) TO authenticated;
