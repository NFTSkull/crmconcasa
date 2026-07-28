-- ConCasa CRM — P132: Notificación libera firma (5→7, 7→9 al subir Notificación,
-- firma_agendable_desde + 5 días hábiles Monterrey; Acuse ya no avanza 8→9).
-- Sin backfill. No modifica migraciones 001–117.

-- =============================================================================
-- Columnas (nullable, sin backfill)
-- =============================================================================
ALTER TABLE public.expedientes
  ADD COLUMN IF NOT EXISTS firma_agendable_desde DATE NULL;

ALTER TABLE public.expedientes
  ADD COLUMN IF NOT EXISTS notificacion_primera_cargada_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.expedientes.firma_agendable_desde IS
  'P132: primera fecha local (America/Monterrey) seleccionable para agendar firma (5º día hábil tras Notificación). NULL = histórico sin gate.';

COMMENT ON COLUMN public.expedientes.notificacion_primera_cargada_at IS
  'P132: auditoría de la primera carga válida de Notificación que fijó firma_agendable_desde.';

-- =============================================================================
-- Helper: días hábiles Monterrey (lun–vie; sin feriados)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.add_business_days_monterrey(p_start DATE, p_days INT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d DATE;
  v_added INT := 0;
BEGIN
  IF p_start IS NULL THEN
    RAISE EXCEPTION 'add_business_days_monterrey: p_start es obligatorio'
      USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR p_days < 0 THEN
    RAISE EXCEPTION 'add_business_days_monterrey: p_days inválido'
      USING ERRCODE = '22023';
  END IF;
  IF p_days = 0 THEN
    RETURN p_start;
  END IF;

  -- No contar el día de carga: empezar desde el día siguiente.
  v_d := p_start;
  WHILE v_added < p_days LOOP
    v_d := v_d + 1;
    IF EXTRACT(ISODOW FROM v_d)::INT BETWEEN 1 AND 5 THEN
      v_added := v_added + 1;
    END IF;
  END LOOP;

  RETURN v_d;
END;
$$;

COMMENT ON FUNCTION public.add_business_days_monterrey(DATE, INT) IS
  'P132: suma p_days hábiles (lun–vie) sin contar p_start; 5ª fecha hábil es seleccionable. Sin calendario de feriados.';

REVOKE ALL ON FUNCTION public.add_business_days_monterrey(DATE, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_business_days_monterrey(DATE, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_business_days_monterrey(DATE, INT) TO service_role, postgres;

-- =============================================================================
-- Helper: apply 7→9 al cargar Notificación (idempotente / FOR UPDATE)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.expediente_apply_notificacion_7_9(
  p_expediente_id UUID,
  p_actor_id UUID,
  p_actor_role public.app_role,
  p_document_kind TEXT,
  p_documento_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp RECORD;
  v_fecha_local DATE;
  v_firma_desde DATE;
  v_primera_at TIMESTAMPTZ;
  v_subestado_anterior public.operativo_subestado;
BEGIN
  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'expediente_apply_notificacion_7_9: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at,
    e.firma_agendable_desde,
    e.notificacion_primera_cargada_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expediente_apply_notificacion_7_9: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotente: no reiniciar fecha ni duplicar transición
  IF v_exp.firma_agendable_desde IS NOT NULL
     OR COALESCE(v_exp.etapa_actual, 0) >= 9 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'advanced', false,
      'expediente_id', p_expediente_id,
      'etapa_actual', v_exp.etapa_actual,
      'firma_agendable_desde', v_exp.firma_agendable_desde,
      'notificacion_primera_cargada_at', v_exp.notificacion_primera_cargada_at,
      'idempotent', true
    );
  END IF;

  IF v_exp.deleted_at IS NOT NULL
     OR v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.etapa_actual IS DISTINCT FROM 7 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'advanced', false,
      'expediente_id', p_expediente_id,
      'etapa_actual', v_exp.etapa_actual,
      'firma_agendable_desde', v_exp.firma_agendable_desde,
      'notificacion_primera_cargada_at', v_exp.notificacion_primera_cargada_at,
      'idempotent', false,
      'skipped', true
    );
  END IF;

  v_fecha_local := (NOW() AT TIME ZONE 'America/Monterrey')::DATE;
  v_firma_desde := public.add_business_days_monterrey(v_fecha_local, 5);
  v_primera_at := NOW();
  v_subestado_anterior := v_exp.subestado;

  UPDATE public.expedientes
  SET
    etapa_actual = 9,
    subestado = 'en_proceso',
    firma_agendable_desde = v_firma_desde,
    notificacion_primera_cargada_at = COALESCE(notificacion_primera_cargada_at, v_primera_at),
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    p_actor_id,
    p_actor_role,
    'expediente.avanzar_etapa_operativa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'actor_id', p_actor_id,
      'actor_role', p_actor_role,
      'etapa_anterior', 7,
      'etapa_nueva', 9,
      'subestado_anterior', v_subestado_anterior,
      'subestado_nuevo', 'en_proceso',
      'transition', '7_9_notificacion',
      'evento', '7_9_notificacion',
      'document_kind', p_document_kind,
      'documento_id', p_documento_id,
      'fecha_carga_local', v_fecha_local,
      'firma_agendable_desde', v_firma_desde,
      'notificacion_primera_cargada_at', COALESCE(v_exp.notificacion_primera_cargada_at, v_primera_at),
      'timezone', 'America/Monterrey'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'advanced', true,
    'expediente_id', p_expediente_id,
    'etapa_anterior', 7,
    'etapa_actual', 9,
    'subestado', 'en_proceso',
    'firma_agendable_desde', v_firma_desde,
    'fecha_carga_local', v_fecha_local,
    'notificacion_primera_cargada_at', COALESCE(v_exp.notificacion_primera_cargada_at, v_primera_at),
    'documento_id', p_documento_id,
    'document_kind', p_document_kind
  );
END;
$$;

COMMENT ON FUNCTION public.expediente_apply_notificacion_7_9(UUID, UUID, public.app_role, TEXT, UUID) IS
  'P132: primera Notificación en etapa 7 → etapa 9 + firma_agendable_desde (5 días hábiles). Idempotente.';

REVOKE ALL ON FUNCTION public.expediente_apply_notificacion_7_9(UUID, UUID, public.app_role, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expediente_apply_notificacion_7_9(UUID, UUID, public.app_role, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expediente_apply_notificacion_7_9(UUID, UUID, public.app_role, TEXT, UUID) TO service_role, postgres;

-- =============================================================================
-- Gate agenda firmas: booking_date local >= firma_agendable_desde
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_firmas_assert_agendable_desde(
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_desde DATE;
  v_local_date DATE;
BEGIN
  IF p_expediente_id IS NULL OR p_scheduled_at IS NULL THEN
    RETURN;
  END IF;

  SELECT e.firma_agendable_desde
  INTO v_desde
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_desde IS NULL THEN
    -- Históricos sin gate
    RETURN;
  END IF;

  v_local_date := (p_scheduled_at AT TIME ZONE 'America/Monterrey')::DATE;
  IF v_local_date < v_desde THEN
    RAISE EXCEPTION 'agenda_firmas: la firma solo puede agendarse desde %', v_desde
      USING ERRCODE = '22023';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.agenda_firmas_assert_agendable_desde(UUID, TIMESTAMPTZ) IS
  'P132: exige fecha local Monterrey del slot >= firma_agendable_desde; NULL = sin gate (históricos).';

REVOKE ALL ON FUNCTION public.agenda_firmas_assert_agendable_desde(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agenda_firmas_assert_agendable_desde(UUID, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_assert_agendable_desde(UUID, TIMESTAMPTZ) TO service_role, postgres;

-- =============================================================================
-- Allowlist asesor: cliente_notificacion post-Mesa (etapa ≥7 gate en register)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_opcionales()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_semanas_cotizadas',
    'cliente_carta_empresa',
    'cliente_acta_nacimiento_digital',
    'cliente_notificacion_apodaca',
    'cliente_notificacion'
  ]::TEXT[];
$$;
COMMENT ON FUNCTION public.integration_doc_tipos_asesor_opcionales() IS
  'Allowlist opcionales asesor; P132 incluye cliente_notificacion (gate etapa ≥7 en register).';

-- =============================================================================
-- avanzar_etapa_operativa_pre_reingreso: rama 5→7 (conserva 6→7, 7→8, 8→9)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.avanzar_etapa_operativa_pre_reingreso(p_expediente_id uuid, p_comentario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
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
        'etapa_anterior', 5,
        'etapa_nueva', 7,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'comentario', v_comentario_final,
        'transition', '5_7'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 5,
      'etapa_actual', 7,
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
  ELSIF v_exp.etapa_actual = 10 THEN
    -- P117: Cita para firma → Firmado (interna 10→11 / visible 9→10)
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

    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 11,
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
        'etapa_anterior', 10,
        'etapa_nueva', 11,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'booking_id', v_booking_id,
        'fecha_cita', v_fecha_cita,
        'booking_date', v_booking_date,
        'booking_time', v_booking_time,
        'location_id', v_location_id,
        'comentario', v_comentario_final,
        'transition', '10_11',
        'kind', 'firmas'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 10,
      'etapa_actual', 11,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'booking_id', v_booking_id,
      'fecha_cita', v_fecha_cita,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'transition', '10_11',
      'kind', 'firmas'
    );

  ELSIF v_exp.etapa_actual = 11 THEN
    -- P119.4: Firmado → Pago a ConCasa (interna 11→12 / visible 10→11)
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'avanzar_etapa_operativa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    -- Idempotencia: si ya está en 12 (carrera), no debería llegar aquí.
    -- No muta bookings, documentos, montos ni fecha_cita.
    v_subestado_anterior := v_exp.subestado;

    UPDATE public.expedientes
    SET
      etapa_actual = 12,
      subestado = v_subestado_nuevo,
      updated_at = NOW()
    WHERE id = p_expediente_id
      AND etapa_actual = 11
      AND ciclo_estado = 'activo';

    IF NOT FOUND THEN
      -- Otra sesión avanzó o estado cambió: lectura post-update
      SELECT e.etapa_actual, e.subestado
      INTO v_exp.etapa_actual, v_exp.subestado
      FROM public.expedientes e
      WHERE e.id = p_expediente_id;

      IF v_exp.etapa_actual = 12 THEN
        RETURN jsonb_build_object(
          'ok', true,
          'expediente_id', p_expediente_id,
          'etapa_anterior', 11,
          'etapa_actual', 12,
          'subestado', v_exp.subestado,
          'operativo_subestado', v_exp.subestado,
          'comentario', v_comentario_final,
          'transition', '11_12',
          'idempotent', true
        );
      END IF;

      RAISE EXCEPTION 'avanzar_etapa_operativa: no se pudo avanzar 11→12 (estado actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;

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
        'etapa_anterior', 11,
        'etapa_nueva', 12,
        'subestado_anterior', v_subestado_anterior,
        'subestado_nuevo', v_subestado_nuevo,
        'comentario', v_comentario_final,
        'transition', '11_12'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 11,
      'etapa_actual', 12,
      'subestado', v_subestado_nuevo,
      'operativo_subestado', v_subestado_nuevo,
      'comentario', v_comentario_final,
      'transition', '11_12'
    );

  ELSE
    RAISE EXCEPTION 'avanzar_etapa_operativa: transición no permitida desde etapa %', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;
END;
$$;
-- =============================================================================
-- register_mesa_documento: hook Notificación → apply 7_9
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_mesa_documento(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_mesa_documento: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_mesa_documento: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'register_mesa_documento: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_mesa_documento: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_mesa_documento: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_mesa_upload())) THEN
    RAISE EXCEPTION 'register_mesa_documento: tipo_documento no permitido para Mesa (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_mesa_documento: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_mesa_documento: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_mesa_documento: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_mesa_documento: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_mesa_documento: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  -- Orden de bloqueo estable: expediente → documento vigente del tipo
  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at,
    e.etapa_actual
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE OF e;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_mesa_documento: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_mesa_documento: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_mesa_documento: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'register_mesa_documento: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_mesa_documento: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa <> true THEN
    RAISE EXCEPTION 'register_mesa_documento: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  -- P090: Pagaré solo desde etapa 7. No aplica a complementarios.
  IF v_tipo = 'cliente_pagare' AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_mesa_documento: El Pagaré solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  -- P092: documento Notificación (cliente_notificacion) solo desde etapa 7.
  -- No confundir con agenda_bookings.kind = 'notificacion'.
  IF v_tipo = 'cliente_notificacion' AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_mesa_documento: El documento Notificación solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  -- P096: documento Solicitud (cliente_solicitud) solo desde etapa 7.
  -- Nunca usar tipo corto 'solicitud'.
  IF v_tipo = 'cliente_solicitud' AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_mesa_documento: El documento Solicitud solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_mesa_documento: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_mesa_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    uploaded_by,
    uploaded_by_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_tipo,
    btrim(p_storage_path),
    btrim(p_nombre_original),
    lower(btrim(p_mime_type)),
    p_size_bytes,
    v_new_version,
    v_new_estatus,
    v_actor_id,
    v_actor_role::TEXT
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.mesa_register',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', lower(btrim(p_mime_type)),
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL
    )
  );


  -- P132: primera Notificación válida → 7→9 + firma_agendable_desde
  IF v_tipo = 'cliente_notificacion' THEN
    PERFORM public.expediente_apply_notificacion_7_9(
      p_expediente_id,
      v_actor_id,
      v_actor_role,
      v_tipo,
      v_new_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path)
  );
END;
$$;
-- =============================================================================
-- register_expediente_documento_pre_reingreso: allow + hook Notificación
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_expediente_documento_pre_reingreso(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento no permitido para upload asesor (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'register_expediente_documento: solo el asesor dueño puede registrar documentos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    IF EXISTS (
      SELECT 1
      FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.tipo_documento = v_tipo
        AND d.deleted_at IS NULL
    ) THEN
      NULL;
    ELSIF v_tipo = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'register_expediente_documento: el expediente ya fue enviado a Mesa'
        USING ERRCODE = '22023';
    END IF;
  END IF;


  -- P132: Notificación (canónica / Apodaca) solo desde etapa 7+
  IF v_tipo IN ('cliente_notificacion', 'cliente_notificacion_apodaca')
     AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_expediente_documento: El documento Notificación solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    uploaded_by,
    uploaded_by_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_tipo,
    btrim(p_storage_path),
    btrim(p_nombre_original),
    lower(btrim(p_mime_type)),
    p_size_bytes,
    v_new_version,
    v_new_estatus,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.register',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', lower(btrim(p_mime_type)),
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL
    )
  );


  -- P130: reemplazo post-Mesa vía register_expediente_documento (sin rechazo previo)
  IF v_prev_id IS NOT NULL
     AND v_exp.submitted_to_mesa IS TRUE THEN
    PERFORM public.asesor_cambio_record_doc_reemplazo(
      v_exp.organization_id,
      p_expediente_id,
      v_actor_id,
      v_tipo,
      v_prev_id,
      v_new_id
    );
  END IF;


  -- P132: primera Notificación válida (asesor) → 7→9 + firma_agendable_desde
  IF v_tipo IN ('cliente_notificacion', 'cliente_notificacion_apodaca')
     AND COALESCE(v_exp.etapa_actual, 0) >= 7
     AND v_exp.submitted_to_mesa IS TRUE THEN
    PERFORM public.expediente_apply_notificacion_7_9(
      p_expediente_id,
      v_actor_id,
      v_actor_role,
      v_tipo,
      v_new_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'integration_docs_presentes', public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos', public.integration_docs_completos(p_expediente_id)
  );
END;
$$;
-- =============================================================================
-- register_expediente_documento_retencion: sin avance automático 8→9
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_expediente_documento_retencion(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
  v_mime TEXT;
  v_principal BOOLEAN;
  v_opcion public.retencion_opcion;
  v_etapa_anterior SMALLINT;
  v_etapa_nueva SMALLINT;
  v_avance_8_9 BOOLEAN := false;
  v_fecha_envio TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.retencion_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: tipo_documento no permitido para retención (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_mime := lower(btrim(COALESCE(p_mime_type, '')));
  IF v_mime = 'image/jpg' THEN
    v_mime := 'image/jpeg';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(v_mime, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  v_principal := v_tipo IN (
    'retencion_acuse_con_sello',
    'retencion_carta_sin_sello'
  );

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
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: solo el asesor dueño puede registrar documentos de retención'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_principal THEN
    IF v_exp.etapa_actual < 8 THEN
      RAISE EXCEPTION 'register_expediente_documento_retencion: expediente debe estar en etapa 8 o posterior (actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_exp.etapa_actual <> 8 THEN
      RAISE EXCEPTION 'register_expediente_documento_retencion: expediente debe estar en etapa 8 (actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    IF v_prev_estatus = 'validado' THEN
      RAISE EXCEPTION 'register_expediente_documento_retencion: documento validado; Mesa debe rechazarlo antes de reemplazar'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    comentario_mesa,
    uploaded_by,
    uploaded_by_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_tipo,
    btrim(p_storage_path),
    btrim(p_nombre_original),
    v_mime,
    p_size_bytes,
    v_new_version,
    v_new_estatus,
    NULL,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  v_etapa_anterior := v_exp.etapa_actual;
  v_etapa_nueva := v_exp.etapa_actual;
  -- P132: Acuse/retención solo registra documento; no avanza 8→9 ni toca firma_agendable_desde.
  v_avance_8_9 := false;
  v_opcion := NULL;
  v_fecha_envio := NULL;

    PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.register_retencion',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', v_mime,
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL,
      'avance_8_9', v_avance_8_9,
      'etapa_anterior', v_etapa_anterior,
      'etapa_nueva', v_etapa_nueva,
      'retencion_opcion', v_opcion
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'mime_type', v_mime,
    'avance_8_9', v_avance_8_9,
    'etapa_anterior', v_etapa_anterior,
    'etapa_actual', v_etapa_nueva,
    'retencion_opcion', v_opcion
  );
END;
$$;
-- =============================================================================
-- enviar_retencion_mesa: marca envío sin avanzar etapa
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enviar_retencion_mesa(p_expediente_id uuid, p_retencion_opcion retencion_opcion)
 RETURNS jsonb
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
  -- P132: idempotencia en etapa ≥9 (flujo nuevo salta 8)
  IF v_exp.etapa_actual >= 9
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
      'etapa_anterior', v_exp.etapa_actual,
      'etapa_actual', v_exp.etapa_actual,
      'idempotent', true
    );
  END IF;

  -- Reenvío tras corrección / primer envío: etapa ≥8 (históricos 8; nuevos 9+)
  IF FOUND AND v_envio.estado = 'correccion_requerida' THEN
    IF COALESCE(v_exp.etapa_actual, 0) < 8 THEN
      RAISE EXCEPTION 'enviar_retencion_mesa: expediente debe estar en etapa 8 o superior para reenvío (actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
    v_is_resend := true;
    v_estado_anterior := v_envio.estado;
  ELSIF COALESCE(v_exp.etapa_actual, 0) < 8 THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: expediente debe estar en etapa 8 o superior (actual: %)', v_exp.etapa_actual
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
  v_etapa_nueva := v_etapa_anterior;

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

  -- P132: marcar envío sin avanzar etapa (Acuse no dispara 8→9; históricos usan avanzar_etapa_operativa).
  v_etapa_nueva := v_etapa_anterior;

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
      'p132_sin_avance_etapa', true
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
-- =============================================================================
-- book/reagendar firmas (+ mesa): gate firma_agendable_desde
-- =============================================================================

CREATE OR REPLACE FUNCTION public.book_firmas(p_expediente_id uuid, p_scheduled_at timestamp with time zone, p_location_id text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_booking_id UUID;
  v_location_id TEXT;
  v_note TEXT;
  v_booking_date DATE;
  v_booking_time TIME;
  v_kind public.booking_kind := 'firmas';
  v_status public.booking_status := 'booked';
  v_agenda_meta JSONB;
  v_etapa_actual SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'book_firmas: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_firmas: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('asesor', 'mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'book_firmas: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'book_firmas: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'book_firmas: scheduled_at es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'book_firmas: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'book_firmas: la cita debe ser en fecha/hora futura'
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
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_firmas: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_firmas: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'book_firmas: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'asesor'
     AND v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'book_firmas: solo el asesor dueño puede agendar firma'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role IN ('mesa_admin', 'super_admin')
     AND NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'book_firmas: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'book_firmas: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'book_firmas: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'book_firmas: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'book_firmas: solo se puede agendar en etapa 9 o 10 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = v_kind
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_firmas: ya existe una cita de firma activa para este expediente'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual = 10 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.agenda_bookings b
      WHERE b.expediente_id = p_expediente_id
        AND b.kind = v_kind
        AND b.status = 'cancelled'
        AND b.id = (
          SELECT b2.id
          FROM public.agenda_bookings b2
          WHERE b2.expediente_id = p_expediente_id
            AND b2.kind = v_kind
          ORDER BY b2.created_at DESC
          LIMIT 1
        )
    ) THEN
      RAISE EXCEPTION 'book_firmas: etapa 10 requiere que la última cita de firma esté cancelada'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM public.agenda_firmas_assert_agendable_desde(
    p_expediente_id,
    p_scheduled_at
  );

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_scheduled_at,
    v_location_id
  );

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;
  v_etapa_actual := v_exp.etapa_actual;

  BEGIN
    INSERT INTO public.agenda_bookings (
      organization_id,
      kind,
      expediente_id,
      booking_date,
      booking_time,
      location_id,
      status,
      note,
      created_by
    ) VALUES (
      v_exp.organization_id,
      v_kind,
      p_expediente_id,
      v_booking_date,
      v_booking_time,
      v_location_id,
      v_status,
      v_note,
      v_actor_id
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'book_firmas: ya existe una cita de firma activa para este expediente'
        USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET
    fecha_cita = p_scheduled_at,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'booking_id', v_booking_id,
      'expediente_id', p_expediente_id,
      'scheduled_at', p_scheduled_at,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'etapa_actual', v_etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking_id,
    'kind', v_kind,
    'scheduled_at', p_scheduled_at,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'fecha_cita', p_scheduled_at,
    'etapa_actual', v_etapa_actual,
    'no_etapa_change', true
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.reagendar_firmas(p_expediente_id uuid, p_scheduled_at timestamp with time zone, p_location_id text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_booking_anterior_id UUID;
  v_booking_nuevo_id UUID;
  v_location_id TEXT;
  v_note TEXT;
  v_booking_date DATE;
  v_booking_time TIME;
  v_fecha_cita_anterior TIMESTAMPTZ;
  v_kind public.booking_kind := 'firmas';
  v_status public.booking_status := 'booked';
  v_agenda_meta JSONB;
  v_etapa_actual SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_firmas: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('asesor', 'mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'reagendar_firmas: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: scheduled_at es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'reagendar_firmas: la cita debe ser en fecha/hora futura'
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
    RAISE EXCEPTION 'reagendar_firmas: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'reagendar_firmas: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'asesor'
     AND v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'reagendar_firmas: solo el asesor dueño puede reagendar firma'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role IN ('mesa_admin', 'super_admin')
     AND NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'reagendar_firmas: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'reagendar_firmas: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'reagendar_firmas: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'reagendar_firmas: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'reagendar_firmas: solo se puede reagendar en etapa 9 o 10 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  SELECT b.id
  INTO v_booking_anterior_id
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = v_kind
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_booking_anterior_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_firmas: no hay cita de firma activa para reagendar'
      USING ERRCODE = '22023';
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;
  v_etapa_actual := v_exp.etapa_actual;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN note IS NULL OR btrim(note) = '' THEN 'Reagendada'
      ELSE note || E'\nReagendada'
    END
  WHERE id = v_booking_anterior_id;

  PERFORM public.agenda_firmas_assert_agendable_desde(
    p_expediente_id,
    p_scheduled_at
  );

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_scheduled_at,
    v_location_id
  );

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;

  BEGIN
    INSERT INTO public.agenda_bookings (
      organization_id,
      kind,
      expediente_id,
      booking_date,
      booking_time,
      location_id,
      status,
      note,
      created_by
    ) VALUES (
      v_exp.organization_id,
      v_kind,
      p_expediente_id,
      v_booking_date,
      v_booking_time,
      v_location_id,
      v_status,
      v_note,
      v_actor_id
    )
    RETURNING id INTO v_booking_nuevo_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'reagendar_firmas: conflicto al crear la nueva cita de firma'
        USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET
    fecha_cita = p_scheduled_at,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.reagendar',
    'agenda_booking',
    v_booking_nuevo_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'old_booking_id', v_booking_anterior_id,
      'new_booking_id', v_booking_nuevo_id,
      'expediente_id', p_expediente_id,
      'old_fecha_cita', v_fecha_cita_anterior,
      'new_fecha_cita', p_scheduled_at,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'etapa_actual', v_etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'old_booking_id', v_booking_anterior_id,
    'new_booking_id', v_booking_nuevo_id,
    'kind', v_kind,
    'scheduled_at', p_scheduled_at,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'fecha_cita', p_scheduled_at,
    'etapa_actual', v_etapa_actual,
    'no_etapa_change', true
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.mesa_book_firmas(p_expediente_id uuid, p_booking_at timestamp with time zone, p_timezone text, p_location_id text, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_booking_id UUID;
  v_timezone TEXT;
  v_location_id TEXT;
  v_nota TEXT;
  v_agenda_meta JSONB;
  v_booking_date DATE;
  v_booking_time TIME;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: usuario no autenticado'
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
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: perfil inactivo o rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente_id obligatorio'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_booking_at IS NULL OR p_booking_at <= NOW() THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_DATE: fecha de firma debe ser futura'
      USING ERRCODE = '22023';
  END IF;

  v_timezone := NULLIF(btrim(COALESCE(p_timezone, '')), '');
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_LOCATION: sede obligatoria'
      USING ERRCODE = '22023';
  END IF;
  v_nota := NULLIF(btrim(COALESCE(p_nota, '')), '');

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
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente no encontrado o no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STATE: expediente no elegible para agenda'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STAGE: solo etapas 9 o 10'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'firmas'
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_ALREADY_BOOKED: ya existe una firma activa'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.agenda_firmas_assert_agendable_desde(
    p_expediente_id,
    p_booking_at
  );

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_booking_at,
    v_location_id
  );

  IF v_agenda_meta->>'timezone' IS DISTINCT FROM v_timezone THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone debe coincidir con agenda_config (%)',
      v_agenda_meta->>'timezone'
      USING ERRCODE = '22023';
  END IF;

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;

  BEGIN
    INSERT INTO public.agenda_bookings (
      organization_id,
      kind,
      expediente_id,
      booking_date,
      booking_time,
      location_id,
      status,
      note,
      created_by
    ) VALUES (
      v_exp.organization_id,
      'firmas',
      p_expediente_id,
      v_booking_date,
      v_booking_time,
      v_location_id,
      'booked',
      v_nota,
      v_actor_id
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_ALREADY_BOOKED: conflicto de firma activa'
      USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET fecha_cita = p_booking_at, updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.mesa_book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'booking_id', v_booking_id,
      'expediente_id', p_expediente_id,
      'booking_at', p_booking_at,
      'timezone', v_timezone,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'etapa_actual', v_exp.etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking_id,
    'booking_at', p_booking_at,
    'timezone', v_timezone,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'etapa_actual', v_exp.etapa_actual
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.mesa_reagendar_firmas(p_expediente_id uuid, p_booking_at timestamp with time zone, p_timezone text, p_location_id text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_booking RECORD;
  v_new_booking_id UUID;
  v_timezone TEXT;
  v_location_id TEXT;
  v_motivo TEXT;
  v_agenda_meta JSONB;
  v_booking_date DATE;
  v_booking_time TIME;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: usuario no autenticado'
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
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: perfil inactivo o rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_at IS NULL OR p_booking_at <= NOW() THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_DATE: fecha de firma debe ser futura'
      USING ERRCODE = '22023';
  END IF;

  v_timezone := NULLIF(btrim(COALESCE(p_timezone, '')), '');
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone obligatorio'
      USING ERRCODE = '22023';
  END IF;
  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_LOCATION: sede obligatoria'
      USING ERRCODE = '22023';
  END IF;
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_REASON_REQUIRED: motivo obligatorio'
      USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente no encontrado o no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STATE: expediente no elegible para agenda'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STAGE: solo etapas 9 o 10'
      USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.booking_date, b.booking_time, b.location_id, b.note
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = 'firmas'
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NO_ACTIVE_BOOKING: no hay firma activa'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = concat_ws(
      E'\n',
      NULLIF(btrim(COALESCE(note, '')), ''),
      'Reagendada por Mesa: ' || v_motivo
    )
  WHERE id = v_booking.id;

  PERFORM public.agenda_firmas_assert_agendable_desde(
    p_expediente_id,
    p_booking_at
  );

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_booking_at,
    v_location_id
  );

  IF v_agenda_meta->>'timezone' IS DISTINCT FROM v_timezone THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone debe coincidir con agenda_config (%)',
      v_agenda_meta->>'timezone'
      USING ERRCODE = '22023';
  END IF;

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;

  INSERT INTO public.agenda_bookings (
    organization_id,
    kind,
    expediente_id,
    booking_date,
    booking_time,
    location_id,
    status,
    note,
    created_by
  ) VALUES (
    v_exp.organization_id,
    'firmas',
    p_expediente_id,
    v_booking_date,
    v_booking_time,
    v_location_id,
    'booked',
    'Reagenda Mesa: ' || v_motivo,
    v_actor_id
  )
  RETURNING id INTO v_new_booking_id;

  UPDATE public.expedientes
  SET fecha_cita = p_booking_at, updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.mesa_reagendar',
    'agenda_booking',
    v_new_booking_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'old_booking_id', v_booking.id,
      'new_booking_id', v_new_booking_id,
      'expediente_id', p_expediente_id,
      'booking_at', p_booking_at,
      'timezone', v_timezone,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'motivo', v_motivo,
      'etapa_actual', v_exp.etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'old_booking_id', v_booking.id,
    'new_booking_id', v_new_booking_id,
    'booking_at', p_booking_at,
    'timezone', v_timezone,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'etapa_actual', v_exp.etapa_actual
  );
END;
$$;