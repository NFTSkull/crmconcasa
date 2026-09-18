-- ConCasa CRM — claridad de correcciones + auditoría Admin.
-- Solo READ-MODEL / RPC. 0 UPDATE / 0 DELETE / 0 backfill / 0 datos de expedientes.
-- 1) Inbox asesor expone request_at de la solicitud Mesa vigente.
-- 2) Timeline Admin conserva todos los eventos operativos existentes y agrega el ciclo
--    completo de corrección con actor real y timestamps auditables.

CREATE OR REPLACE FUNCTION public.asesor_inbox_correccion_resumen(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
  v_labels TEXT[] := ARRAY[]::TEXT[];
  v_first_motivo TEXT;
  v_item JSONB;
  v_p198 RECORD;
  v_readiness JSONB;
  v_n INT;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF public.asesor_inbox_estado_efectivo(p_expediente_id) IS DISTINCT FROM 'correccion_requerida' THEN
    RETURN NULL;
  END IF;

  v_items := public.asesor_correccion_items_abiertos(p_expediente_id);
  v_n := coalesce(jsonb_array_length(v_items), 0);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_labels := array_append(v_labels, v_item->>'label');
    IF v_first_motivo IS NULL AND NULLIF(btrim(v_item->>'motivo'), '') IS NOT NULL THEN
      v_first_motivo := v_item->>'motivo';
    END IF;
  END LOOP;

  SELECT s.estado, s.request_at
  INTO v_p198
  FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
  LIMIT 1;

  v_readiness := public.asesor_correccion_compute_readiness(
    p_expediente_id, v_items, v_p198.request_at, v_p198.estado
  );

  RETURN jsonb_build_object(
    'count', v_n,
    'labels', to_jsonb(v_labels),
    'first_motivo', v_first_motivo,
    'request_at', v_p198.request_at,
    'ux_state', v_readiness->>'ux_state'
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_correccion_resumen(UUID) IS
  'P210+: resumen compacto inbox (labels + motivo + request_at + ux_state).';

REVOKE ALL ON FUNCTION public.asesor_inbox_correccion_resumen(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_correccion_resumen(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_get_expediente_mesa_timeline(
  p_expediente_id UUID,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_offset INTEGER;
  v_total BIGINT;
  v_items JSONB;
  v_exists BOOLEAN;
  v_returned INTEGER;
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'admin_timeline: expediente_id requerido' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.id = p_expediente_id
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'admin_timeline: expediente no visible o no enviado a Mesa'
      USING ERRCODE = 'P0002';
  END IF;

  v_limit := LEAST(100, GREATEST(1, coalesce(p_limit, 10)));
  v_offset := GREATEST(0, coalesce(p_offset, 0));

  SELECT count(*)
  INTO v_total
  FROM public.action_log al
  WHERE (
    (al.entity_type = 'expediente' AND al.entity_id = p_expediente_id)
    OR (al.payload->>'expediente_id') = p_expediente_id::text
  )
  AND al.action = ANY (ARRAY[
    'expediente.enviar_a_mesa',
    'documento.revision.update',
    'cliente_datos.revision.update',
    'expediente.documento.asesor_correccion',
    'expediente.documento.register',
    'expediente.documento.replace',
    'cliente_datos.save',
    'cliente_datos.correccion_post_mesa',
    'cliente_datos.actualizado_post_mesa',
    'asesor.correccion.reenviada_a_mesa',
    'expediente.avanzar_etapa_operativa',
    'mesa.expediente.mover_etapa',
    'mesa.expediente.take',
    'mesa.expediente.release',
    'expediente.documento.mesa_register',
    'expediente.enviar_retencion_mesa',
    'expediente.rechazo_operativo',
    'expediente.reingreso.crear',
    'expediente.reingreso.cerrar_anterior',
    'agenda.biometricos.book',
    'agenda.biometricos.cancel',
    'agenda.biometricos.reagendar',
    'agenda.biometricos.mesa_reagendar',
    'agenda.notificacion.mesa_reagendar',
    'agenda.firmas.book',
    'agenda.firmas.cancel',
    'agenda.firmas.reagendar',
    'agenda.firmas.mesa_book',
    'agenda.firmas.mesa_reagendar',
    'agenda.firmas.mesa_cancel',
    'agenda.drive_validation.set',
    'agenda.drive_validation.clear'
  ]::TEXT[]);

  SELECT coalesce(jsonb_agg(ev ORDER BY at DESC, sort_id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      al.created_at AS at,
      al.id AS sort_id,
      jsonb_build_object(
        'at', al.created_at,
        'action', al.action,
        'actor_general', CASE
          WHEN al.actor_role::text IN ('mesa_admin', 'mesa_interno', 'mesa_externo') THEN 'Mesa'
          WHEN al.actor_role::text = 'asesor' THEN 'Asesor'
          WHEN al.actor_role::text = 'editor' THEN 'Editor'
          WHEN al.actor_role::text = 'super_admin' THEN 'Super Admin'
          WHEN al.action LIKE 'mesa.%'
            OR al.action IN (
              'documento.revision.update',
              'cliente_datos.revision.update',
              'expediente.documento.mesa_register',
              'expediente.rechazo_operativo',
              'agenda.biometricos.mesa_reagendar',
              'agenda.notificacion.mesa_reagendar',
              'agenda.firmas.mesa_book',
              'agenda.firmas.mesa_reagendar',
              'agenda.firmas.mesa_cancel',
              'agenda.drive_validation.set',
              'agenda.drive_validation.clear'
            ) THEN 'Mesa'
          WHEN al.action IN (
            'expediente.enviar_a_mesa',
            'expediente.documento.asesor_correccion',
            'expediente.documento.register',
            'expediente.documento.replace',
            'cliente_datos.save',
            'cliente_datos.correccion_post_mesa',
            'cliente_datos.actualizado_post_mesa',
            'asesor.correccion.reenviada_a_mesa',
            'expediente.enviar_retencion_mesa',
            'expediente.reingreso.crear',
            'expediente.reingreso.cerrar_anterior',
            'agenda.biometricos.book',
            'agenda.biometricos.cancel',
            'agenda.biometricos.reagendar',
            'agenda.firmas.book',
            'agenda.firmas.cancel',
            'agenda.firmas.reagendar'
          ) THEN 'Asesor'
          ELSE 'Sistema'
        END,
        'actor_name', nullif(left(btrim(coalesce(ap.full_name, '')), 160), ''),
        'actor_role', nullif(left(btrim(coalesce(al.actor_role::text, '')), 40), ''),
        'summary', jsonb_strip_nulls(jsonb_build_object(
          'tipo_documento', nullif(left(btrim(coalesce(al.payload->>'tipo_documento', '')), 160), ''),
          'nombre_original', nullif(left(btrim(coalesce(al.payload->>'nombre_original', '')), 240), ''),
          'estatus_nuevo', nullif(left(btrim(coalesce(al.payload->>'estatus_nuevo', '')), 60), ''),
          'estatus_anterior', nullif(left(btrim(coalesce(al.payload->>'estatus_anterior', '')), 60), ''),
          'estado_nuevo', nullif(left(btrim(coalesce(al.payload->>'estado_nuevo', '')), 60), ''),
          'estado_anterior', nullif(left(btrim(coalesce(al.payload->>'estado_anterior', '')), 60), ''),
          'etapa_destino', nullif(left(btrim(coalesce(al.payload->>'etapa_destino', '')), 10), ''),
          'etapa_origen', nullif(left(btrim(coalesce(al.payload->>'etapa_origen', '')), 10), ''),
          'etapa_nueva', nullif(left(btrim(coalesce(al.payload->>'etapa_nueva', '')), 10), ''),
          'etapa_anterior', nullif(left(btrim(coalesce(al.payload->>'etapa_anterior', '')), 10), ''),
          'motivo', nullif(left(btrim(coalesce(al.payload->>'motivo', '')), 800), ''),
          'comentario_rechazo', nullif(left(btrim(coalesce(al.payload->>'comentario_rechazo', '')), 1200), ''),
          'comentario', nullif(left(btrim(coalesce(al.payload->>'comentario', '')), 1200), ''),
          'request_type', nullif(left(btrim(coalesce(al.payload->>'request_type', '')), 100), ''),
          'request_at', nullif(left(btrim(coalesce(al.payload->>'request_at', '')), 80), ''),
          'submitted_at', nullif(left(btrim(coalesce(al.payload->>'submitted_at', '')), 80), ''),
          'copied_cambios', CASE
            WHEN al.payload ? 'copied_cambios'
              THEN left(btrim(coalesce(al.payload->>'copied_cambios', '')), 20)
            ELSE NULL
          END,
          'lote_id', nullif(left(btrim(coalesce(al.payload->>'lote_id', '')), 80), ''),
          'reemplazo', CASE
            WHEN al.payload ? 'reemplazo'
              THEN left(btrim(coalesce(al.payload->>'reemplazo', '')), 5)
            ELSE NULL
          END,
          'is_resend', CASE
            WHEN al.payload ? 'is_resend'
              THEN left(btrim(coalesce(al.payload->>'is_resend', '')), 5)
            ELSE NULL
          END
        ))
      ) AS ev
    FROM public.action_log al
    LEFT JOIN public.profiles ap ON ap.id = al.actor_id
    WHERE (
      (al.entity_type = 'expediente' AND al.entity_id = p_expediente_id)
      OR (al.payload->>'expediente_id') = p_expediente_id::text
    )
    AND al.action = ANY (ARRAY[
      'expediente.enviar_a_mesa',
      'documento.revision.update',
      'cliente_datos.revision.update',
      'expediente.documento.asesor_correccion',
      'expediente.documento.register',
      'expediente.documento.replace',
      'cliente_datos.save',
      'cliente_datos.correccion_post_mesa',
      'cliente_datos.actualizado_post_mesa',
      'asesor.correccion.reenviada_a_mesa',
      'expediente.avanzar_etapa_operativa',
      'mesa.expediente.mover_etapa',
      'mesa.expediente.take',
      'mesa.expediente.release',
      'expediente.documento.mesa_register',
      'expediente.enviar_retencion_mesa',
      'expediente.rechazo_operativo',
      'expediente.reingreso.crear',
      'expediente.reingreso.cerrar_anterior',
      'agenda.biometricos.book',
      'agenda.biometricos.cancel',
      'agenda.biometricos.reagendar',
      'agenda.biometricos.mesa_reagendar',
      'agenda.notificacion.mesa_reagendar',
      'agenda.firmas.book',
      'agenda.firmas.cancel',
      'agenda.firmas.reagendar',
      'agenda.firmas.mesa_book',
      'agenda.firmas.mesa_reagendar',
      'agenda.firmas.mesa_cancel',
      'agenda.drive_validation.set',
      'agenda.drive_validation.clear'
    ]::TEXT[])
    ORDER BY al.created_at DESC, al.id DESC
    OFFSET v_offset LIMIT v_limit
  ) page;

  v_returned := coalesce(jsonb_array_length(v_items), 0);

  RETURN jsonb_build_object(
    'expediente_id', p_expediente_id,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', (v_offset + v_returned) < v_total,
    'items', v_items
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_expediente_mesa_timeline(UUID, INTEGER, INTEGER) IS
  'Admin RO: timeline auditable con ciclo de corrección completo, actor real y timestamps; paginado bajo demanda.';

REVOKE ALL ON FUNCTION public.admin_get_expediente_mesa_timeline(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_expediente_mesa_timeline(UUID, INTEGER, INTEGER)
  TO authenticated;
