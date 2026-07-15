-- ConCasa CRM — P072: reingreso post-biométricos mediante expediente hijo.
-- Depende de P071. No modifica agenda histórica ni reaprovecha decisiones de monto.

ALTER TABLE public.expedientes
  ADD COLUMN reingreso_rechazo_id UUID NULL;

ALTER TABLE public.expediente_documentos
  ADD COLUMN reutilizado_de_documento_id UUID NULL
    REFERENCES public.expediente_documentos(id) ON DELETE RESTRICT;

ALTER TABLE public.expedientes
  ADD CONSTRAINT expedientes_reingreso_rechazo_padre_fk
  FOREIGN KEY (reingreso_rechazo_id, expediente_anterior_id)
  REFERENCES public.expediente_rechazos_operativos(id, expediente_id)
  ON DELETE RESTRICT;

ALTER TABLE public.expedientes
  ADD CONSTRAINT expedientes_no_self_anterior_chk
    CHECK (expediente_anterior_id IS NULL OR expediente_anterior_id <> id),
  ADD CONSTRAINT expedientes_reingreso_requiere_anterior_chk
    CHECK (reingreso_rechazo_id IS NULL OR expediente_anterior_id IS NOT NULL);

CREATE UNIQUE INDEX expedientes_reingreso_rechazo_unique
  ON public.expedientes (reingreso_rechazo_id)
  WHERE reingreso_rechazo_id IS NOT NULL;

CREATE UNIQUE INDEX expedientes_reingreso_hijo_activo_unique
  ON public.expedientes (expediente_anterior_id)
  WHERE expediente_anterior_id IS NOT NULL
    AND reingreso_rechazo_id IS NOT NULL
    AND ciclo_estado = 'activo'
    AND deleted_at IS NULL;

CREATE INDEX expediente_documentos_reutilizado_idx
  ON public.expediente_documentos (reutilizado_de_documento_id)
  WHERE reutilizado_de_documento_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reingreso_documentos_reutilizables()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_ine_frente',
    'cliente_ine_reverso',
    'cliente_acta_nacimiento',
    'cliente_constancia_sat',
    'cliente_semanas_cotizadas',
    'cliente_carta_empresa',
    'cliente_acta_nacimiento_digital'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.es_reingreso_post_biometricos_valido(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.expedientes h
    JOIN public.expediente_rechazos_operativos r
      ON r.id = h.reingreso_rechazo_id
     AND r.expediente_id = h.expediente_anterior_id
    WHERE h.id = p_expediente_id
      AND h.reingreso_rechazo_id IS NOT NULL
      AND h.expediente_anterior_id IS NOT NULL
      AND h.etapa_actual = 6
      AND h.ciclo_estado = 'activo'
      AND h.subestado = 'en_proceso'
      AND h.submitted_to_mesa = true
      AND h.deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.reingreso_documentos_reutilizables() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reingreso_documentos_reutilizables() FROM anon;
REVOKE ALL ON FUNCTION public.reingreso_documentos_reutilizables() FROM authenticated;
REVOKE ALL ON FUNCTION public.es_reingreso_post_biometricos_valido(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.es_reingreso_post_biometricos_valido(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.es_reingreso_post_biometricos_valido(UUID) FROM authenticated;

-- Lectura de objeto compartido: acceso directo por el path o mediante un hijo visible
-- que conserve genealogía explícita hacia el documento original.
CREATE OR REPLACE FUNCTION public.expediente_documento_storage_can_read(
  p_object_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parsed RECORD;
BEGIN
  SELECT *
  INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.expediente_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.can_see_expediente(v_parsed.expediente_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    JOIN public.expedientes h
      ON h.id = d.expediente_id
     AND h.deleted_at IS NULL
    WHERE d.storage_path = p_object_name
      AND d.reutilizado_de_documento_id IS NOT NULL
      AND d.deleted_at IS NULL
      AND public.can_see_expediente(h.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expediente_documento_storage_can_read(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expediente_documento_storage_can_read(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.expediente_documento_storage_can_read(TEXT)
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.reingreso_post_biometricos_elegibilidad_interna(
  p_expediente_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp RECORD;
  v_actor RECORD;
  v_rechazo RECORD;
  v_booking RECORD;
  v_child UUID;
  v_timezone TEXT := 'America/Monterrey';
  v_booking_at TIMESTAMPTZ;
BEGIN
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = p_actor_id;

  IF NOT FOUND OR v_actor.active IS NOT TRUE OR v_actor.app_role <> 'asesor' THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_NOT_OWNER',
      'reason_message', 'Solo el asesor dueño puede iniciar el reingreso.',
      'rechazo_id', NULL, 'biometricos_condicion', NULL, 'existing_child_id', NULL
    );
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL;

  IF NOT FOUND
     OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id
     OR v_exp.asesor_id IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_NOT_OWNER',
      'reason_message', 'El expediente no pertenece al asesor.',
      'rechazo_id', NULL, 'biometricos_condicion', NULL, 'existing_child_id', NULL
    );
  END IF;

  IF v_exp.etapa_actual NOT IN (5, 6) THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_NOT_STAGE_5_OR_6',
      'reason_message', 'El reingreso solo aplica a expedientes rechazados en etapa 5 o 6.',
      'rechazo_id', NULL, 'biometricos_condicion', NULL, 'existing_child_id', NULL
    );
  END IF;

  IF v_exp.subestado <> 'rechazado' THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_NOT_REJECTED',
      'reason_message', 'El expediente no está rechazado.',
      'rechazo_id', NULL, 'biometricos_condicion', NULL, 'existing_child_id', NULL
    );
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_CYCLE_NOT_ACTIVE',
      'reason_message', 'El ciclo anterior ya no está activo.',
      'rechazo_id', NULL, 'biometricos_condicion', NULL, 'existing_child_id', NULL
    );
  END IF;

  SELECT r.*
  INTO v_rechazo
  FROM public.expediente_rechazos_operativos r
  WHERE r.expediente_id = p_expediente_id
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_NO_CLASSIFIED_REJECTION',
      'reason_message', 'No existe un rechazo operativo clasificado.',
      'rechazo_id', NULL, 'biometricos_condicion', NULL, 'existing_child_id', NULL
    );
  END IF;

  IF v_rechazo.biometricos_condicion <> 'reutilizables' THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_BIOMETRICS_NOT_REUSABLE',
      'reason_message', 'Mesa no declaró reutilizables los biométricos.',
      'rechazo_id', v_rechazo.id,
      'biometricos_condicion', v_rechazo.biometricos_condicion,
      'existing_child_id', NULL
    );
  END IF;

  IF v_rechazo.biometricos_booking_id IS NULL
     OR NULLIF(btrim(COALESCE(v_rechazo.biometricos_razon, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_BOOKING_EVIDENCE_MISSING',
      'reason_message', 'La decisión biométrica no tiene evidencia completa.',
      'rechazo_id', v_rechazo.id,
      'biometricos_condicion', v_rechazo.biometricos_condicion,
      'existing_child_id', NULL
    );
  END IF;

  SELECT COALESCE(NULLIF(btrim(ac.config->>'timezone'), ''), 'America/Monterrey')
  INTO v_timezone
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_exp.organization_id
    AND ac.kind = 'biometricos';
  v_timezone := COALESCE(v_timezone, 'America/Monterrey');

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'biometricos'
      AND b.status = 'booked'
      AND ((b.booking_date::TIMESTAMP + b.booking_time) AT TIME ZONE v_timezone) > NOW()
  ) THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_FUTURE_BOOKING_ACTIVE',
      'reason_message', 'Existe una cita biométrica futura activa.',
      'rechazo_id', v_rechazo.id,
      'biometricos_condicion', v_rechazo.biometricos_condicion,
      'existing_child_id', NULL
    );
  END IF;

  SELECT b.*
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.id = v_rechazo.biometricos_booking_id
    AND b.expediente_id = p_expediente_id
    AND b.organization_id = v_exp.organization_id
    AND b.kind = 'biometricos';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_BOOKING_EVIDENCE_MISSING',
      'reason_message', 'El booking de evidencia no pertenece al expediente.',
      'rechazo_id', v_rechazo.id,
      'biometricos_condicion', v_rechazo.biometricos_condicion,
      'existing_child_id', NULL
    );
  END IF;

  v_booking_at :=
    (v_booking.booking_date::TIMESTAMP + v_booking.booking_time)
    AT TIME ZONE v_timezone;

  IF v_booking_at > NOW()
     OR (
       v_booking.status = 'cancelled'
       AND (v_booking.cancelled_at IS NULL OR v_booking.cancelled_at < v_booking_at)
     )
     OR v_booking.status NOT IN ('booked', 'cancelled') THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_BOOKING_EVIDENCE_MISSING',
      'reason_message', 'El booking no acredita un intento biométrico pasado.',
      'rechazo_id', v_rechazo.id,
      'biometricos_condicion', v_rechazo.biometricos_condicion,
      'existing_child_id', NULL
    );
  END IF;

  SELECT e.id
  INTO v_child
  FROM public.expedientes e
  WHERE e.reingreso_rechazo_id = v_rechazo.id
  LIMIT 1;

  IF v_child IS NOT NULL THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_ALREADY_USED',
      'reason_message', 'Este rechazo ya fue utilizado para un reingreso.',
      'rechazo_id', v_rechazo.id,
      'biometricos_condicion', v_rechazo.biometricos_condicion,
      'existing_child_id', v_child
    );
  END IF;

  SELECT e.id
  INTO v_child
  FROM public.expedientes e
  WHERE e.expediente_anterior_id = p_expediente_id
    AND e.reingreso_rechazo_id IS NOT NULL
    AND e.ciclo_estado = 'activo'
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF v_child IS NOT NULL THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_ACTIVE_CHILD_EXISTS',
      'reason_message', 'Ya existe un reingreso activo para este expediente.',
      'rechazo_id', v_rechazo.id,
      'biometricos_condicion', v_rechazo.biometricos_condicion,
      'existing_child_id', v_child
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.id <> p_expediente_id
      AND e.organization_id = v_exp.organization_id
      AND e.nss = v_exp.nss
      AND e.programa = v_exp.programa
      AND e.ciclo_estado = 'activo'
      AND e.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason_code', 'REENTRY_ACTIVE_NSS_EXISTS',
      'reason_message', 'Existe otro ciclo activo para el mismo NSS y programa.',
      'rechazo_id', v_rechazo.id,
      'biometricos_condicion', v_rechazo.biometricos_condicion,
      'existing_child_id', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'reason_code', 'eligible',
    'reason_message', NULL,
    'rechazo_id', v_rechazo.id,
    'biometricos_condicion', v_rechazo.biometricos_condicion,
    'existing_child_id', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reingreso_post_biometricos_elegibilidad_interna(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reingreso_post_biometricos_elegibilidad_interna(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.reingreso_post_biometricos_elegibilidad_interna(UUID, UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_reingreso_post_biometricos_elegibilidad(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.reingreso_post_biometricos_elegibilidad_interna(
    p_expediente_id, v_actor_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_reingreso_post_biometricos_elegibilidad(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_reingreso_post_biometricos_elegibilidad(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_reingreso_post_biometricos_elegibilidad(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reingreso_post_biometricos_elegibilidad(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_reingreso_post_biometricos_elegibilidad(UUID) TO postgres;

CREATE OR REPLACE FUNCTION public.iniciar_reingreso_post_biometricos(
  p_expediente_anterior_id UUID,
  p_nota TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_parent public.expedientes%ROWTYPE;
  v_elig JSONB;
  v_rechazo_id UUID;
  v_child_id UUID;
  v_nota TEXT;
  v_docs TEXT[];
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF NOT FOUND OR v_actor.active IS NOT TRUE OR v_actor.app_role <> 'asesor' THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: solo el asesor puede iniciar el reingreso'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
  INTO v_parent
  FROM public.expedientes e
  WHERE e.id = p_expediente_anterior_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  v_elig := public.reingreso_post_biometricos_elegibilidad_interna(
    p_expediente_anterior_id, v_actor_id
  );

  IF COALESCE((v_elig->>'eligible')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%: %',
      COALESCE(v_elig->>'reason_code', 'REENTRY_NOT_REJECTED'),
      COALESCE(v_elig->>'reason_message', 'Reingreso no elegible')
      USING ERRCODE = '22023';
  END IF;

  v_rechazo_id := (v_elig->>'rechazo_id')::UUID;
  v_nota := NULLIF(btrim(COALESCE(p_nota, '')), '');

  UPDATE public.expedientes
  SET ciclo_estado = 'cerrado', updated_at = NOW()
  WHERE id = p_expediente_anterior_id;

  INSERT INTO public.expedientes (
    organization_id,
    asesor_id,
    expediente_anterior_id,
    reingreso_rechazo_id,
    programa,
    nss,
    cliente_nombre,
    telefono_cliente,
    direccion_opcional,
    origen_mesa,
    ciclo_estado,
    submitted_to_mesa,
    fecha_envio_mesa,
    etapa_actual,
    subestado,
    motivo_rechazo,
    comentario_rechazo,
    fecha_cita
  ) VALUES (
    v_parent.organization_id,
    v_parent.asesor_id,
    v_parent.id,
    v_rechazo_id,
    v_parent.programa,
    v_parent.nss,
    v_parent.cliente_nombre,
    v_parent.telefono_cliente,
    v_parent.direccion_opcional,
    v_parent.origen_mesa,
    'activo',
    true,
    NOW(),
    6,
    'en_proceso',
    NULL,
    NULL,
    NULL
  )
  RETURNING id INTO v_child_id;

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision, decided_by
  ) VALUES (
    v_child_id, v_parent.organization_id, 'pendiente', NULL, '', NULL
  );

  INSERT INTO public.cliente_datos (
    expediente_id,
    organization_id,
    datos,
    estado,
    comentario_rechazo,
    validated_at,
    validated_by,
    rejected_at,
    rejected_by,
    updated_by,
    telefono_normalizado,
    referencias,
    imagenes,
    porcentaje_cobro,
    monto_calculado,
    metodo_pago
  )
  SELECT
    v_child_id,
    cd.organization_id,
    jsonb_strip_nulls(jsonb_build_object(
      'nombreCliente', cd.datos->'nombreCliente',
      'nss', cd.datos->'nss',
      'curp', cd.datos->'curp',
      'rfc', cd.datos->'rfc',
      'celular', cd.datos->'celular',
      'telefono', cd.datos->'telefono',
      'correo', cd.datos->'correo',
      'empresa', cd.datos->'empresa',
      'registroPatronal', cd.datos->'registroPatronal',
      'telefonoEmpresa', cd.datos->'telefonoEmpresa',
      'referencias', COALESCE(cd.datos->'referencias', cd.referencias),
      'beneficiario', cd.datos->'beneficiario',
      'direccionEmpresa', cd.datos->'direccionEmpresa',
      'plazo', cd.datos->'plazo',
      'notaMesa', cd.datos->'notaMesa'
    )),
    CASE WHEN cd.estado = 'pendiente' THEN 'pendiente'::public.cliente_datos_estado
         ELSE 'completo'::public.cliente_datos_estado END,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    v_actor_id,
    NULL,
    cd.referencias,
    cd.imagenes,
    cd.porcentaje_cobro,
    NULL,
    cd.metodo_pago
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = v_parent.id;

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
    uploaded_by_role,
    reutilizado_de_documento_id
  )
  SELECT
    d.organization_id,
    v_child_id,
    d.tipo_documento,
    d.storage_path,
    d.nombre_original,
    d.mime_type,
    d.size_bytes,
    1,
    'validado',
    NULL,
    d.uploaded_by,
    d.uploaded_by_role,
    d.id
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_parent.id
    AND d.tipo_documento = ANY(public.reingreso_documentos_reutilizables())
    AND d.deleted_at IS NULL
    AND d.estatus_revision = 'validado'
    AND NULLIF(btrim(d.storage_path), '') IS NOT NULL
    AND (
      SELECT count(*)
      FROM public.expediente_documentos active_d
      WHERE active_d.expediente_id = v_parent.id
        AND active_d.tipo_documento = d.tipo_documento
        AND active_d.deleted_at IS NULL
    ) = 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.expediente_documentos child_d
      WHERE child_d.expediente_id = v_child_id
        AND child_d.tipo_documento = d.tipo_documento
        AND child_d.deleted_at IS NULL
    );

  SELECT COALESCE(array_agg(d.tipo_documento ORDER BY d.tipo_documento), ARRAY[]::TEXT[])
  INTO v_docs
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_child_id
    AND d.reutilizado_de_documento_id IS NOT NULL
    AND d.deleted_at IS NULL;

  PERFORM public.log_action(
    v_parent.organization_id,
    v_actor_id,
    v_actor.app_role,
    'expediente.reingreso.cerrar_anterior',
    'expediente',
    v_parent.id,
    jsonb_build_object(
      'ciclo_estado_anterior', v_parent.ciclo_estado,
      'ciclo_estado_nuevo', 'cerrado',
      'rechazo_id', v_rechazo_id,
      'expediente_hijo_id', v_child_id
    )
  );

  PERFORM public.log_action(
    v_parent.organization_id,
    v_actor_id,
    v_actor.app_role,
    'expediente.reingreso.crear',
    'expediente',
    v_child_id,
    jsonb_build_object(
      'expediente_anterior_id', v_parent.id,
      'rechazo_id', v_rechazo_id,
      'nota', v_nota,
      'documentos_reutilizados', to_jsonb(v_docs),
      'documentos_pendientes', jsonb_build_array(
        'cliente_comprobante_domicilio', 'cliente_estado_cuenta'
      ),
      'monto_pendiente', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', v_child_id,
    'expediente_anterior_id', v_parent.id,
    'rechazo_id', v_rechazo_id,
    'etapa_actual', 6,
    'documentos_reutilizados', to_jsonb(v_docs),
    'documentos_pendientes', jsonb_build_array(
      'cliente_comprobante_domicilio', 'cliente_estado_cuenta'
    ),
    'monto_pendiente', true
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'REENTRY_ALREADY_USED: el rechazo o ciclo ya tiene un reingreso'
      USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.iniciar_reingreso_post_biometricos(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.iniciar_reingreso_post_biometricos(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.iniciar_reingreso_post_biometricos(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_reingreso_post_biometricos(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.iniciar_reingreso_post_biometricos(UUID, TEXT) TO postgres;

-- Excepción estricta del editor: el flujo normal conserva literalmente P010.
ALTER FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) RENAME TO upsert_editor_decision_pre_reingreso;

REVOKE ALL ON FUNCTION public.upsert_editor_decision_pre_reingreso(
  UUID, public.editor_decision, NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_editor_decision(
  p_expediente_id UUID,
  p_decision public.editor_decision,
  p_monto_aprobado NUMERIC DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_prev public.editor_decisions%ROWTYPE;
  v_monto NUMERIC(14,2);
  v_motivo TEXT;
  v_base NUMERIC(12,2);
BEGIN
  IF NOT public.es_reingreso_post_biometricos_valido(p_expediente_id) THEN
    RETURN public.upsert_editor_decision_pre_reingreso(
      p_expediente_id, p_decision, p_monto_aprobado, p_motivo
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'editor' THEN
    RAISE EXCEPTION 'upsert_editor_decision: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  JOIN public.expediente_rechazos_operativos r
    ON r.id = e.reingreso_rechazo_id
   AND r.expediente_id = e.expediente_anterior_id
  WHERE e.id = p_expediente_id
    AND e.organization_id = v_actor.organization_id
    AND e.etapa_actual = 6
    AND e.ciclo_estado = 'activo'
    AND e.subestado = 'en_proceso'
    AND e.submitted_to_mesa = true
    AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_editor_decision: reingreso no válido'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision IS NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: decision es obligatoria'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'aprobado' AND (p_monto_aprobado IS NULL OR p_monto_aprobado <= 0) THEN
    RAISE EXCEPTION 'REENTRY_AMOUNT_PENDING: monto aprobado debe ser mayor a cero'
      USING ERRCODE = '22023';
  END IF;

  v_monto := CASE WHEN p_decision = 'aprobado'
    THEN round(p_monto_aprobado::NUMERIC, 2) ELSE NULL END;
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  SELECT ed.* INTO v_prev
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision, decided_by
  ) VALUES (
    p_expediente_id, v_exp.organization_id, p_decision, v_monto,
    COALESCE(v_motivo, ''), v_actor_id
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    notas_revision = CASE WHEN v_motivo IS NOT NULL
      THEN EXCLUDED.notas_revision ELSE public.editor_decisions.notas_revision END,
    decided_by = EXCLUDED.decided_by,
    updated_at = NOW();

  IF p_decision = 'aprobado' THEN
    v_base := CASE WHEN v_exp.programa = 'mejoravit'
      THEN least(round(v_monto * 0.89, 2), 169000)
      ELSE v_monto END;
    UPDATE public.cliente_datos
    SET monto_calculado = CASE
          WHEN porcentaje_cobro IS NULL THEN NULL
          ELSE round(v_base * porcentaje_cobro / 100 + 3000, 2)
        END,
        updated_at = NOW()
    WHERE expediente_id = p_expediente_id;
  ELSE
    UPDATE public.cliente_datos
    SET monto_calculado = NULL, updated_at = NOW()
    WHERE expediente_id = p_expediente_id;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'editor.decision.upsert',
    'editor_decision',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'decision_anterior', v_prev.decision,
      'decision_nueva', p_decision,
      'monto_anterior', v_prev.monto_aprobado,
      'monto_nuevo', v_monto,
      'motivo', v_motivo,
      'reingreso', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'decision', p_decision,
    'monto_aprobado', v_monto,
    'editor_id', v_actor_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) TO authenticated, service_role, postgres;

-- Excepción documental: solo primer upload de domicilio/estado de cuenta en hijo válido.
ALTER FUNCTION public.register_expediente_documento(
  UUID, TEXT, TEXT, TEXT, TEXT, BIGINT
) RENAME TO register_expediente_documento_pre_reingreso;

REVOKE ALL ON FUNCTION public.register_expediente_documento_pre_reingreso(
  UUID, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_expediente_documento(
  p_expediente_id UUID,
  p_tipo_documento TEXT,
  p_storage_path TEXT,
  p_nombre_original TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_tipo TEXT;
  v_new_id UUID;
BEGIN
  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');

  IF NOT (
    public.es_reingreso_post_biometricos_valido(p_expediente_id)
    AND v_tipo IN ('cliente_comprobante_domicilio', 'cliente_estado_cuenta')
    AND NOT EXISTS (
      SELECT 1 FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.tipo_documento = v_tipo
        AND d.deleted_at IS NULL
    )
  ) THEN
    RETURN public.register_expediente_documento_pre_reingreso(
      p_expediente_id, p_tipo_documento, p_storage_path,
      p_nombre_original, p_mime_type, p_size_bytes
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  JOIN public.expediente_rechazos_operativos r
    ON r.id = e.reingreso_rechazo_id
   AND r.expediente_id = e.expediente_anterior_id
  WHERE e.id = p_expediente_id
    AND e.etapa_actual = 6
    AND e.ciclo_estado = 'activo'
    AND e.subestado = 'en_proceso'
    AND e.submitted_to_mesa = true
    AND e.deleted_at IS NULL;

  IF v_actor_id IS NULL OR NOT FOUND
     OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR v_exp.asesor_id IS DISTINCT FROM v_actor_id
     OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: solo el asesor dueño puede cargar documentos'
      USING ERRCODE = '42501';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = ''
     OR p_nombre_original IS NULL OR btrim(p_nombre_original) = ''
     OR p_size_bytes IS NULL OR p_size_bytes <= 0
     OR p_size_bytes > public.expediente_documento_max_size_bytes()
     OR NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo)
     OR NOT public.expediente_documento_storage_path_valid(
       btrim(p_storage_path), v_exp.organization_id, p_expediente_id, v_tipo
     ) THEN
    RAISE EXCEPTION 'register_expediente_documento: metadata o path inválido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_exp.organization_id, p_expediente_id, v_tipo, btrim(p_storage_path),
    btrim(p_nombre_original), lower(btrim(p_mime_type)), p_size_bytes, 1,
    'subido', v_actor_id, 'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'expediente.documento.register',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', 1,
      'storage_path', btrim(p_storage_path),
      'estatus_revision', 'subido',
      'reingreso_primer_upload', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', 1,
    'estatus_revision', 'subido',
    'storage_path', btrim(p_storage_path)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_expediente_documento(
  UUID, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_expediente_documento(
  UUID, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_expediente_documento(
  UUID, TEXT, TEXT, TEXT, TEXT, BIGINT
) TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(
  p_object_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
BEGIN
  SELECT * INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL
     OR NOT (v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR v_actor.organization_id IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL
     OR v_exp.asesor_id IS DISTINCT FROM v_actor_id
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.expediente_documentos d
    WHERE d.expediente_id = v_exp.id
      AND d.tipo_documento = v_parsed.tipo_documento
      AND d.deleted_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  IF v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
    RETURN true;
  END IF;

  RETURN (
    v_parsed.tipo_documento IN (
      'cliente_comprobante_domicilio', 'cliente_estado_cuenta'
    )
    AND v_exp.etapa_actual = 6
    AND v_exp.subestado = 'en_proceso'
    AND public.es_reingreso_post_biometricos_valido(v_exp.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(TEXT)
  TO authenticated, service_role, postgres;

-- Gate especial 6→7; las demás ramas delegan sin cambio a la función P066.
ALTER FUNCTION public.avanzar_etapa_operativa(UUID, TEXT)
  RENAME TO avanzar_etapa_operativa_pre_reingreso;

REVOKE ALL ON FUNCTION public.avanzar_etapa_operativa_pre_reingreso(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.avanzar_etapa_operativa(
  p_expediente_id UUID,
  p_comentario TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_editor RECORD;
  v_tipo TEXT;
BEGIN
  IF NOT public.es_reingreso_post_biometricos_valido(p_expediente_id) THEN
    RETURN public.avanzar_etapa_operativa_pre_reingreso(
      p_expediente_id, p_comentario
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role NOT IN (
       'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
     ) THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  JOIN public.expediente_rechazos_operativos r
    ON r.id = e.reingreso_rechazo_id
   AND r.expediente_id = e.expediente_anterior_id
  WHERE e.id = p_expediente_id
    AND e.etapa_actual = 6
    AND e.ciclo_estado = 'activo'
    AND e.subestado = 'en_proceso'
    AND e.submitted_to_mesa = true
    AND e.deleted_at IS NULL;

  IF NOT FOUND OR (
    v_actor.app_role <> 'super_admin'
    AND v_exp.organization_id IS DISTINCT FROM v_actor.organization_id
  ) OR NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'avanzar_etapa_operativa: expediente no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT ed.decision, ed.monto_aprobado
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND OR v_editor.decision <> 'aprobado'
     OR v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'REENTRY_AMOUNT_PENDING: falta nueva aprobación de monto'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_tipo IN ARRAY ARRAY[
    'cliente_comprobante_domicilio', 'cliente_estado_cuenta'
  ]::TEXT[] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.tipo_documento = v_tipo
        AND d.deleted_at IS NULL
        AND d.estatus_revision = 'validado'
    ) THEN
      RAISE EXCEPTION 'REENTRY_DOCUMENTS_PENDING: falta documento validado %', v_tipo
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.expedientes
  SET etapa_actual = 7, subestado = 'en_proceso', updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'expediente.avanzar_etapa_operativa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor.app_role,
      'etapa_anterior', 6,
      'etapa_nueva', 7,
      'subestado_anterior', v_exp.subestado,
      'subestado_nuevo', 'en_proceso',
      'comentario', NULLIF(btrim(COALESCE(p_comentario, '')), ''),
      'transition', '6_7_reingreso'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'etapa_anterior', 6,
    'etapa_actual', 7,
    'subestado', 'en_proceso',
    'operativo_subestado', 'en_proceso',
    'comentario', NULLIF(btrim(COALESCE(p_comentario, '')), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.avanzar_etapa_operativa(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avanzar_etapa_operativa(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.avanzar_etapa_operativa(UUID, TEXT)
  TO authenticated, service_role, postgres;
