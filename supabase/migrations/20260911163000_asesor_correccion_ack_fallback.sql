-- ConCasa CRM — corrección de reenvío asesor: fallback ACK auditable.
--
-- Problema:
-- asesor_correccion_detalle puede devolver can_resubmit=true cuando existe actividad
-- post-solicitud (p.ej. save_cliente_datos_correccion / documento nuevo), aunque no exista
-- una fila P130 en expediente_asesor_cambios. En ese caso el RPC de reenvío copiaba 0
-- cambios y hacía rollback completo, dejando el expediente en WAITING_ADVISOR.
--
-- Solución:
-- cuando el detalle canónico ya autorizó el reenvío y no hay cambios P130 copiables,
-- registrar el ACK explícito ya existente (tipo correccion_respuesta) y continuar con el
-- submit del lote. No se inventan diffs de DG/documentos y no se altera P198.

CREATE OR REPLACE FUNCTION public.asesor_reenviar_correccion_a_mesa(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_active BOOLEAN;
  v_exp RECORD;
  v_p198 RECORD;
  v_p198_post TEXT;
  v_detalle JSONB;
  v_lote_id UUID;
  v_copied INT;
  v_submitted TIMESTAMPTZ;
  v_latest RECORD;
BEGIN
  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: expediente_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active INTO v_role, v_active
  FROM public.profiles p WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('asesor_reenviar_correccion:' || p_expediente_id::text)
  );

  SELECT e.id, e.organization_id, e.asesor_id, e.submitted_to_mesa, e.ciclo_estado::text
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: solo asesor dueño'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: expediente no activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.estado, s.request_type, s.request_at
  INTO v_p198
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  IF v_p198.estado IS DISTINCT FROM 'WAITING_ADVISOR' THEN
    SELECT t.latest_response_at, t.latest_batch_id
    INTO v_latest
    FROM public.mesa_cambio_episodio_latest(p_expediente_id) t
    LIMIT 1;

    IF v_p198.estado = 'CORRECTION_PENDING_REVIEW'
       OR (
         v_p198.request_at IS NOT NULL
         AND v_latest.latest_response_at IS NOT NULL
         AND v_latest.latest_response_at > v_p198.request_at
       ) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'already_submitted', true,
        'lote_id', v_latest.latest_batch_id,
        'submitted_at', v_latest.latest_response_at
      );
    END IF;

    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: no hay solicitud Mesa vigente (estado=%)',
      coalesce(v_p198.estado, 'null')
      USING ERRCODE = '22023';
  END IF;

  IF v_p198.request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION' THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: rechazo operativo usa otro flujo'
      USING ERRCODE = '22023';
  END IF;

  IF v_p198.request_at IS NULL THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: request_at ausente'
      USING ERRCODE = '22023';
  END IF;

  v_detalle := public.asesor_correccion_detalle(p_expediente_id);
  IF coalesce((v_detalle->>'can_resubmit')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'asesor_reenviar_correccion_a_mesa: no listo para reenviar (%).',
      coalesce(v_detalle->'blocking_reasons', '[]'::jsonb)::text
      USING ERRCODE = '22023';
  END IF;

  v_lote_id := public.asesor_cambio_create_response_lote(
    v_exp.organization_id,
    p_expediente_id,
    v_actor,
    v_p198.request_at
  );

  v_copied := public.asesor_cambio_copy_post_request_cambios(
    p_expediente_id,
    v_lote_id,
    v_p198.request_at
  );

  -- Fallback canónico P210: si hubo actividad válida post-request pero no existe
  -- un diff P130 estructurado que copiar, registrar un ACK honesto y auditable.
  -- El gate can_resubmit=true ya fue evaluado arriba; no se inventan cambios DG/doc.
  IF v_copied = 0 THEN
    PERFORM public.asesor_cambio_record_correccion_ack(
      v_lote_id,
      v_p198.request_at
    );
  END IF;

  v_submitted := public.asesor_cambio_submit_response_lote(v_lote_id, v_p198.request_at);

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload
  ) VALUES (
    v_exp.organization_id,
    v_actor,
    v_role,
    'asesor.correccion.reenviada_a_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'lote_id', v_lote_id,
      'request_at', v_p198.request_at,
      'request_type', v_p198.request_type,
      'submitted_at', v_submitted,
      'copied_cambios', v_copied,
      'ack_fallback', (v_copied = 0)
    )
  );

  -- P198 debe pasar a CORRECTION_PENDING_REVIEW sin UPDATE directo.
  SELECT s.estado INTO v_p198_post
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  IF v_p198_post IS DISTINCT FROM 'CORRECTION_PENDING_REVIEW' THEN
    RAISE EXCEPTION
      'asesor_reenviar_correccion_a_mesa: P198 no transicionó a CORRECTION_PENDING_REVIEW (=%)',
      coalesce(v_p198_post, 'null')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_submitted', false,
    'lote_id', v_lote_id,
    'submitted_at', v_submitted,
    'copied_cambios', v_copied,
    'ack_fallback', (v_copied = 0)
  );
END;
$function$;

COMMENT ON FUNCTION public.asesor_reenviar_correccion_a_mesa(UUID) IS
  'Reenvío explícito de corrección: copia cambios P130; si can_resubmit=true y no hay diff copiable, registra ACK correccion_respuesta auditable antes de enviar.';
