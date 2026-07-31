-- ConCasa CRM — Quitar mínimo de 5 días hábiles para agendar firmas.
-- Setter: Acuse 8→9 fija firma_agendable_desde = hoy Monterrey (si NULL).
-- Backfill: fechas futuras existentes → hoy Monterrey.
-- No toca biométricos, capacidad, sedes, Sheets ni agenda_config.min_lead_hours.
-- No edita migraciones 001–138.

CREATE OR REPLACE FUNCTION public.register_expediente_documento_retencion(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_fecha_local DATE;
  v_firma_desde DATE;
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
    e.deleted_at,
    e.firma_agendable_desde
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
  v_avance_8_9 := false;
  v_opcion := NULL;
  v_fecha_envio := NULL;
  v_firma_desde := v_exp.firma_agendable_desde;

  -- P132-acuse / P117: principal canónico + etapa exacta 8 → avance atómico 8→9
  -- + firma_agendable_desde solo si NULL (= hoy Monterrey; sin mínimo de 5 hábiles).
  IF v_principal AND v_exp.etapa_actual = 8 THEN
    v_opcion := CASE
      WHEN v_tipo = 'retencion_acuse_con_sello' THEN 'con_sello'::public.retencion_opcion
      ELSE 'sin_sello'::public.retencion_opcion
    END;
    v_fecha_envio := NOW();
    v_etapa_nueva := 9;
    v_avance_8_9 := true;
    v_fecha_local := (NOW() AT TIME ZONE 'America/Monterrey')::DATE;
    IF v_exp.firma_agendable_desde IS NULL THEN
      v_firma_desde := v_fecha_local;
    END IF;

    INSERT INTO public.retencion_opciones (
      expediente_id,
      organization_id,
      retencion_opcion,
      updated_by
    ) VALUES (
      p_expediente_id,
      v_exp.organization_id,
      v_opcion,
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
      v_opcion,
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
      firma_agendable_desde = COALESCE(firma_agendable_desde, v_firma_desde),
      updated_at = NOW()
    WHERE id = p_expediente_id;
  END IF;

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
      'retencion_opcion', v_opcion,
      'firma_agendable_desde', v_firma_desde,
      'fecha_carga_local', v_fecha_local
    )
  );

  IF v_avance_8_9 THEN
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
        'retencion_opcion', v_opcion,
        'required_documentos', to_jsonb(public.retencion_doc_tipos_requeridos(v_opcion)),
        'is_resend', false,
        'estado_nuevo', 'enviado',
        'etapa_anterior', v_etapa_anterior,
        'etapa_nueva', v_etapa_nueva,
        'transition', '8_9_acuse',
        'p132_acuse_libera_firma', true,
        'documento_id', v_new_id,
        'tipo_documento', v_tipo,
        'firma_agendable_desde', v_firma_desde,
        'fecha_carga_local', v_fecha_local,
        'timezone', 'America/Monterrey'
      )
    );

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
        'subestado_anterior', v_exp.subestado,
        'subestado_nuevo', 'en_proceso',
        'transition', '8_9_acuse',
        'evento', '8_9_acuse',
        'documento_id', v_new_id,
        'tipo_documento', v_tipo,
        'firma_agendable_desde', v_firma_desde,
        'fecha_carga_local', v_fecha_local,
        'timezone', 'America/Monterrey'
      )
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
    'mime_type', v_mime,
    'avance_8_9', v_avance_8_9,
    'etapa_anterior', v_etapa_anterior,
    'etapa_actual', v_etapa_nueva,
    'retencion_opcion', v_opcion,
    'firma_agendable_desde', v_firma_desde
  );
END;
$function$
;


COMMENT ON FUNCTION public.register_expediente_documento_retencion(uuid, text, text, text, text, bigint) IS
  'P132-acuse/P117: registra retención; principal en etapa 8 avanza 8→9 y fija firma_agendable_desde si NULL (= hoy Monterrey; sin mínimo 5 hábiles).';

REVOKE ALL ON FUNCTION public.register_expediente_documento_retencion(uuid, text, text, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_expediente_documento_retencion(uuid, text, text, text, text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_expediente_documento_retencion(uuid, text, text, text, text, bigint) TO authenticated;

-- Backfill: liberar agendamiento inmediato en expedientes con fecha futura.
UPDATE public.expedientes
SET
  firma_agendable_desde = (NOW() AT TIME ZONE 'America/Monterrey')::DATE,
  updated_at = NOW()
WHERE firma_agendable_desde IS NOT NULL
  AND firma_agendable_desde > (NOW() AT TIME ZONE 'America/Monterrey')::DATE;

COMMENT ON COLUMN public.expedientes.firma_agendable_desde IS
  'Fecha mínima local Monterrey para agendar firmas. NULL o <= hoy = agendable (sujeto a cupo/lead hours). Se fija al Acuse 8→9 si estaba NULL.';

-- Label UI: tipo interno apodaca se muestra como «Notificación» (sin Apodaca en texto visible).
CREATE OR REPLACE FUNCTION public.asesor_cambio_doc_label(p_tipo TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(btrim(COALESCE(p_tipo, '')))
    WHEN 'ine' THEN 'INE'
    WHEN 'estado_cuenta' THEN 'Estado de cuenta'
    WHEN 'nss' THEN 'NSS'
    WHEN 'direccion' THEN 'Comprobante de domicilio'
    WHEN 'cliente_ine_frente' THEN 'INE frente'
    WHEN 'cliente_ine_reverso' THEN 'INE reverso'
    WHEN 'cliente_comprobante_domicilio' THEN 'Comprobante de domicilio'
    WHEN 'cliente_estado_cuenta' THEN 'Estado de cuenta'
    WHEN 'cliente_acta_nacimiento' THEN 'Acta de nacimiento'
    WHEN 'cliente_constancia_sat' THEN 'Constancia SAT'
    WHEN 'cliente_semanas_cotizadas' THEN 'Semanas cotizadas'
    WHEN 'cliente_historial_laboral' THEN 'Historial laboral'
    WHEN 'cliente_carta_empresa' THEN 'Carta de la empresa'
    WHEN 'cliente_acta_nacimiento_digital' THEN 'Acta de nacimiento digital'
    WHEN 'cliente_notificacion_apodaca' THEN 'Notificación'
    WHEN 'cliente_pagare' THEN 'Pagaré'
    WHEN 'cliente_notificacion' THEN 'Notificación'
    WHEN 'cliente_solicitud' THEN 'Solicitud'
    WHEN 'retencion_acuse_con_sello' THEN 'Acuse con sello'
    WHEN 'retencion_aviso_retencion' THEN 'Aviso de retención'
    WHEN 'retencion_ine_frente' THEN 'Retención INE frente'
    WHEN 'retencion_ine_reverso' THEN 'Retención INE reverso'
    WHEN 'retencion_carta_sin_sello' THEN 'Carta sin sello'
    WHEN 'asesor_ine_frente' THEN 'Asesor INE frente'
    WHEN 'asesor_ine_reverso' THEN 'Asesor INE reverso'
    WHEN 'asesor_estado_cuenta' THEN 'Asesor estado de cuenta'
    WHEN 'asesor_recibo_luz' THEN 'Asesor recibo de luz'
    ELSE COALESCE(NULLIF(btrim(p_tipo), ''), 'Documento')
  END;
$$;

REVOKE ALL ON FUNCTION public.asesor_cambio_doc_label(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_cambio_doc_label(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.asesor_cambio_doc_label(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_cambio_doc_label(TEXT) TO service_role;

