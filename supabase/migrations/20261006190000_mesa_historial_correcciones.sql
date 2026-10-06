-- Historial de correcciones visible en Mesa Control.
-- Read-model únicamente: no modifica expediente, etapas, documentos ni agenda.

CREATE OR REPLACE FUNCTION public.mesa_get_correcciones_historial(
  p_expediente_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_exp record;
  v_events jsonb;
BEGIN
  IF v_uid IS NULL OR p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_get_correcciones_historial: usuario no autenticado'
      USING ERRCODE='42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id=v_uid AND p.active=true;

  IF NOT FOUND OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'mesa_get_correcciones_historial: rol no autorizado'
      USING ERRCODE='42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_get_correcciones_historial: expediente no visible'
      USING ERRCODE='42501';
  END IF;

  SELECT e.id,e.fecha_envio_mesa,e.asesor_id INTO v_exp
  FROM public.expedientes e
  WHERE e.id=p_expediente_id AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_get_correcciones_historial: expediente no encontrado'
      USING ERRCODE='P0002';
  END IF;

  WITH event_rows AS (
    SELECT
      ('mesa-envio-' || v_exp.id::text) AS event_id,
      'mesa_envio'::text AS kind,
      v_exp.fecha_envio_mesa AS occurred_at,
      NULL::uuid AS actor_id,
      ap.full_name AS actor_name,
      'Expediente enviado a Mesa'::text AS title,
      NULL::text AS target_key,
      NULL::text AS reason,
      NULL::uuid AS lote_id,
      NULL::timestamptz AS request_at,
      '[]'::jsonb AS changes
    FROM public.profiles ap
    WHERE ap.id=v_exp.asesor_id
      AND v_exp.fecha_envio_mesa IS NOT NULL

    UNION ALL

    SELECT
      'doc-request-' || dr.id::text,
      'correccion_solicitada'::text,
      dr.created_at,
      dr.actor_id,
      p.full_name,
      'Corrección solicitada'::text,
      d.tipo_documento::text,
      NULLIF(btrim(dr.comentario_mesa),''),
      NULL::uuid,
      dr.created_at,
      '[]'::jsonb
    FROM public.documento_revisiones dr
    JOIN public.expediente_documentos d ON d.id=dr.documento_id
    LEFT JOIN public.profiles p ON p.id=dr.actor_id
    WHERE dr.expediente_id=p_expediente_id
      AND dr.estatus_nuevo='rechazado'

    UNION ALL

    SELECT
      'datos-request-' || al.id::text,
      'correccion_solicitada'::text,
      al.created_at,
      al.actor_id,
      p.full_name,
      'Corrección solicitada'::text,
      'datos_generales'::text,
      NULLIF(btrim(COALESCE(
        al.payload->>'comentario_rechazo',
        al.payload->>'comentario_mesa',
        al.payload->>'comentario'
      )),''),
      NULL::uuid,
      al.created_at,
      '[]'::jsonb
    FROM public.action_log al
    LEFT JOIN public.profiles p ON p.id=al.actor_id
    WHERE al.action='cliente_datos.revision.update'
      AND al.payload->>'estado_nuevo'='rechazado'
      AND (
        al.entity_id=p_expediente_id
        OR al.payload->>'expediente_id'=p_expediente_id::text
      )

    UNION ALL

    SELECT
      'response-' || l.id::text,
      'correccion_recibida'::text,
      l.submitted_at,
      l.asesor_id,
      p.full_name,
      'Corrección recibida'::text,
      NULL::text,
      NULL::text,
      l.id,
      (
        SELECT NULLIF(al.payload->>'request_at','')::timestamptz
        FROM public.action_log al
        WHERE al.action='asesor.correccion.reenviada_a_mesa'
          AND al.payload->>'lote_id'=l.id::text
        ORDER BY al.created_at DESC
        LIMIT 1
      ),
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',c.id,
            'label',c.label,
            'tipo',c.tipo::text,
            'document_kind',c.document_kind,
            'created_at',c.created_at
          )
          ORDER BY c.created_at,c.id
        )
        FROM public.expediente_asesor_cambios c
        WHERE c.lote_id=l.id
      ),'[]'::jsonb)
    FROM public.expediente_asesor_cambio_lotes l
    LEFT JOIN public.profiles p ON p.id=l.asesor_id
    WHERE l.expediente_id=p_expediente_id
      AND l.submitted_at IS NOT NULL

    UNION ALL

    SELECT
      'review-' || l.id::text,
      'correccion_revisada'::text,
      l.reviewed_at,
      l.reviewed_by,
      p.full_name,
      'Corrección revisada por Mesa'::text,
      NULL::text,
      NULL::text,
      l.id,
      NULL::timestamptz,
      '[]'::jsonb
    FROM public.expediente_asesor_cambio_lotes l
    LEFT JOIN public.profiles p ON p.id=l.reviewed_by
    WHERE l.expediente_id=p_expediente_id
      AND l.reviewed_at IS NOT NULL
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',event_id,
        'kind',kind,
        'occurred_at',occurred_at,
        'actor_name',actor_name,
        'title',title,
        'target_key',target_key,
        'reason',reason,
        'lote_id',lote_id,
        'request_at',request_at,
        'changes',changes
      )
      ORDER BY occurred_at,event_id
    ) FILTER (WHERE occurred_at IS NOT NULL),
    '[]'::jsonb
  )
  INTO v_events
  FROM event_rows;

  RETURN jsonb_build_object(
    'ok',true,
    'expediente_id',p_expediente_id,
    'events',COALESCE(v_events,'[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mesa_get_correcciones_historial(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_get_correcciones_historial(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.mesa_get_correcciones_historial(uuid) IS
  'Read-model Mesa del historial de correcciones: envío inicial, solicitudes documentales/datos generales, reenvíos del asesor y revisión Mesa. Solo lectura.';
