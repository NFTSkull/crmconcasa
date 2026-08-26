CREATE OR REPLACE FUNCTION public.avanzar_etapa_operativa(p_expediente_id uuid, p_comentario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

