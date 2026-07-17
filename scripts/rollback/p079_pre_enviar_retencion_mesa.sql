-- Rollback snapshot P079 (pre-change Cloud/local @ 07ebfd3)
-- Restore with: psql -f p079_pre_enviar_retencion_mesa.sql
-- Re-aplica GRANT/REVOKE as in migration 017/066.

CREATE OR REPLACE FUNCTION public.enviar_retencion_mesa(p_expediente_id uuid, p_retencion_opcion retencion_opcion)
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
  v_envio public.retencion_envios%ROWTYPE;
  v_tipo TEXT;
  v_estatus public.estatus_revision;
  v_required TEXT[];
  v_is_resend BOOLEAN := false;
  v_estado_anterior public.retencion_envio_estado;
  v_fecha_envio TIMESTAMPTZ;
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
  WHERE e.id = p_expediente_id;

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

  IF v_exp.etapa_actual <> 8 THEN
    RAISE EXCEPTION 'enviar_retencion_mesa: expediente debe estar en etapa 8 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  v_required := public.retencion_doc_tipos_requeridos(p_retencion_opcion);

  FOREACH v_tipo IN ARRAY v_required
  LOOP
    SELECT d.estatus_revision
    INTO v_estatus
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND d.tipo_documento = v_tipo
      AND d.deleted_at IS NULL;

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

  SELECT re.*
  INTO v_envio
  FROM public.retencion_envios re
  WHERE re.expediente_id = p_expediente_id;

  IF FOUND THEN
    v_estado_anterior := v_envio.estado;
    IF v_envio.estado = 'enviado' AND v_envio.enviado = true THEN
      RAISE EXCEPTION 'enviar_retencion_mesa: bloque ya enviado a Mesa'
        USING ERRCODE = '22023';
    END IF;
    IF v_envio.estado = 'correccion_requerida' THEN
      v_is_resend := true;
    END IF;
  ELSE
    v_estado_anterior := NULL;
  END IF;

  v_fecha_envio := NOW();

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
      'estado_nuevo', 'enviado'
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
    'required_documentos', to_jsonb(v_required)
  );
END;
$function$
