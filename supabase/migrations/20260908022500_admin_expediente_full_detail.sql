-- Admin full expediente detail (read-only).
-- Super Admin only. No mutations, no backfill.

CREATE OR REPLACE FUNCTION public.admin_get_expediente_full_detail(
  p_expediente_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'admin_expediente_detail: expediente_id requerido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.id = p_expediente_id
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'admin_expediente_detail: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  WITH expediente_base AS (
    SELECT jsonb_build_object(
      'id', e.id,
      'cliente_nombre', e.cliente_nombre,
      'nss', btrim(e.nss::text),
      'telefono_cliente', btrim(e.telefono_cliente::text),
      'telefono_casa', nullif(btrim(coalesce(e.telefono_casa, '')), ''),
      'direccion_opcional', e.direccion_opcional,
      'programa', e.programa::text,
      'origen_mesa', e.origen_mesa::text,
      'ciclo_estado', e.ciclo_estado::text,
      'submitted_to_mesa', e.submitted_to_mesa,
      'fecha_envio_mesa', e.fecha_envio_mesa,
      'etapa_actual', e.etapa_actual,
      'subestado', e.subestado::text,
      'motivo_rechazo', e.motivo_rechazo,
      'comentario_rechazo', e.comentario_rechazo,
      'fecha_cita', e.fecha_cita,
      'created_at', e.created_at,
      'updated_at', e.updated_at,
      'expediente_anterior_id', e.expediente_anterior_id,
      'reingreso_rechazo_id', e.reingreso_rechazo_id,
      'reingreso_manual_count', e.reingreso_manual_count,
      'reingreso_manual_at', e.reingreso_manual_at,
      'firma_agendable_desde', e.firma_agendable_desde,
      'pago_concasa_resultado', e.pago_concasa_resultado,
      'pago_concasa_at', e.pago_concasa_at,
      'vigencia_documental_started_at', e.vigencia_documental_started_at,
      'vigencia_documental_liberada_at', e.vigencia_documental_liberada_at,
      'vigencia_reingreso_completado_at', e.vigencia_reingreso_completado_at,
      'asesor', jsonb_build_object(
        'id', p.id,
        'nombre', p.full_name,
        'email', p.email
      )
    ) AS value
    FROM public.expedientes e
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
    WHERE e.id = p_expediente_id
  ),
  precal AS (
    SELECT coalesce((
      SELECT jsonb_build_object(
        'decision', ed.decision::text,
        'monto_aprobado', ed.monto_aprobado,
        'monto_aprobado_al_aprobar', ed.monto_aprobado_al_aprobar,
        'monto_snapshot_no_recuperable', ed.monto_aprobado_snapshot_no_recuperable,
        'notas_revision', ed.notas_revision,
        'aprobado_at', ed.aprobado_at,
        'no_cumple_at', ed.no_cumple_at,
        'created_at', ed.created_at,
        'updated_at', ed.updated_at,
        'rfc_infonavit', ed.rfc_infonavit,
        'registro_patronal_infonavit', ed.registro_patronal_infonavit,
        'empresa_infonavit', ed.empresa_infonavit,
        'advertencia_inscripcion', ed.advertencia_inscripcion,
        'decidido_por', jsonb_build_object(
          'id', dp.id,
          'nombre', dp.full_name,
          'email', dp.email
        )
      )
      FROM public.editor_decisions ed
      LEFT JOIN public.profiles dp ON dp.id = ed.decided_by
      WHERE ed.expediente_id = p_expediente_id
      LIMIT 1
    ), 'null'::jsonb) AS value
  ),
  cliente AS (
    SELECT coalesce((
      SELECT jsonb_build_object(
        'estado', cd.estado::text,
        'datos', coalesce(cd.datos, '{}'::jsonb),
        'referencias', coalesce(cd.referencias, '[]'::jsonb),
        'porcentaje_cobro', cd.porcentaje_cobro,
        'monto_calculado', cd.monto_calculado,
        'metodo_pago', cd.metodo_pago,
        'monto_mejoravit_actualizado', cd.monto_mejoravit_actualizado,
        'monto_mejoravit_actualizado_at', cd.monto_mejoravit_actualizado_at,
        'monto_mejoravit_actualizado_motivo', cd.monto_mejoravit_actualizado_motivo,
        'comentario_rechazo', cd.comentario_rechazo,
        'validated_at', cd.validated_at,
        'rejected_at', cd.rejected_at,
        'created_at', cd.created_at,
        'updated_at', cd.updated_at
      )
      FROM public.cliente_datos cd
      WHERE cd.expediente_id = p_expediente_id
      LIMIT 1
    ), 'null'::jsonb) AS value
  ),
  documentos AS (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'tipo_documento', d.tipo_documento,
        'nombre_original', d.nombre_original,
        'mime_type', d.mime_type,
        'size_bytes', d.size_bytes,
        'version', d.version,
        'estatus_revision', d.estatus_revision::text,
        'comentario_mesa', d.comentario_mesa,
        'uploaded_by_role', d.uploaded_by_role,
        'uploaded_by_nombre', up.full_name,
        'deleted_at', d.deleted_at,
        'created_at', d.created_at,
        'updated_at', d.updated_at,
        'reutilizado_de_documento_id', d.reutilizado_de_documento_id,
        'revisiones', coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', dr.id,
              'estatus_anterior', dr.estatus_anterior::text,
              'estatus_nuevo', dr.estatus_nuevo::text,
              'comentario_mesa', dr.comentario_mesa,
              'actor_nombre', rp.full_name,
              'created_at', dr.created_at
            ) ORDER BY dr.created_at ASC, dr.id ASC
          )
          FROM public.documento_revisiones dr
          LEFT JOIN public.profiles rp ON rp.id = dr.actor_id
          WHERE dr.documento_id = d.id
        ), '[]'::jsonb)
      ) ORDER BY d.created_at ASC, d.version ASC, d.id ASC
    ), '[]'::jsonb) AS value
    FROM public.expediente_documentos d
    LEFT JOIN public.profiles up ON up.id = d.uploaded_by
    WHERE d.expediente_id = p_expediente_id
  ),
  citas AS (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'kind', b.kind::text,
        'status', b.status::text,
        'booking_date', b.booking_date,
        'booking_time', b.booking_time,
        'location_id', b.location_id,
        'note', b.note,
        'created_by_nombre', cp.full_name,
        'cancelled_at', b.cancelled_at,
        'created_at', b.created_at,
        'updated_at', b.updated_at,
        'drive_validated', b.drive_validated,
        'drive_validated_at', b.drive_validated_at,
        'drive_validated_by_nombre', vp.full_name,
        'report_group', b.report_group
      ) ORDER BY b.created_at ASC, b.id ASC
    ), '[]'::jsonb) AS value
    FROM public.agenda_bookings b
    LEFT JOIN public.profiles cp ON cp.id = b.created_by
    LEFT JOIN public.profiles vp ON vp.id = b.drive_validated_by
    WHERE b.expediente_id = p_expediente_id
  ),
  decisiones_cita AS (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ad.id,
        'booking_id', ad.booking_id,
        'kind', ad.kind::text,
        'decision', ad.decision,
        'motivo', ad.motivo,
        'decidido_por_nombre', dp.full_name,
        'decided_at', ad.decided_at,
        'previous_booking_date', ad.previous_booking_date,
        'previous_booking_time', ad.previous_booking_time,
        'previous_location_id', ad.previous_location_id,
        'new_booking_date', ad.new_booking_date,
        'new_booking_time', ad.new_booking_time,
        'new_location_id', ad.new_location_id,
        'new_booking_id', ad.new_booking_id,
        'etapa_anterior', ad.etapa_anterior,
        'etapa_nueva', ad.etapa_nueva
      ) ORDER BY ad.decided_at ASC, ad.id ASC
    ), '[]'::jsonb) AS value
    FROM public.agenda_booking_decisiones ad
    LEFT JOIN public.profiles dp ON dp.id = ad.decided_by
    WHERE ad.expediente_id = p_expediente_id
  ),
  correcciones AS (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'correccion_ciclo_key', l.correccion_ciclo_key,
        'status', l.status::text,
        'submitted_at', l.submitted_at,
        'created_at', l.created_at,
        'updated_at', l.updated_at,
        'reviewed_at', l.reviewed_at,
        'reviewed_by_nombre', rvp.full_name,
        'cambios', coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', c.id,
              'change_key', c.change_key,
              'tipo', c.tipo::text,
              'entidad', c.entidad,
              'campo', c.campo,
              'document_kind', c.document_kind,
              'label', c.label,
              'valor_anterior', c.valor_anterior,
              'valor_nuevo', c.valor_nuevo,
              'created_at', c.created_at
            ) ORDER BY c.created_at ASC, c.id ASC
          )
          FROM public.expediente_asesor_cambios c
          WHERE c.lote_id = l.id
        ), '[]'::jsonb)
      ) ORDER BY l.created_at ASC, l.id ASC
    ), '[]'::jsonb) AS value
    FROM public.expediente_asesor_cambio_lotes l
    LEFT JOIN public.profiles rvp ON rvp.id = l.reviewed_by
    WHERE l.expediente_id = p_expediente_id
  ),
  rechazos AS (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'etapa', r.etapa,
        'subestado_anterior', r.subestado_anterior::text,
        'motivo', r.motivo,
        'comentario', r.comentario,
        'biometricos_condicion', r.biometricos_condicion::text,
        'biometricos_razon', r.biometricos_razon,
        'decidido_por_nombre', rp.full_name,
        'decidido_por_rol', r.decidido_por_rol::text,
        'created_at', r.created_at,
        'decision_source', r.decision_source
      ) ORDER BY r.created_at ASC, r.id ASC
    ), '[]'::jsonb) AS value
    FROM public.expediente_rechazos_operativos r
    LEFT JOIN public.profiles rp ON rp.id = r.decidido_por
    WHERE r.expediente_id = p_expediente_id
  ),
  reactivaciones AS (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', rr.id,
        'rechazo_id', rr.rechazo_id,
        'etapa', rr.etapa,
        'subestado_anterior', rr.subestado_anterior::text,
        'subestado_nuevo', rr.subestado_nuevo::text,
        'reactivado_por_nombre', rp.full_name,
        'reactivado_por_rol', rr.reactivado_por_rol::text,
        'created_at', rr.created_at
      ) ORDER BY rr.created_at ASC, rr.id ASC
    ), '[]'::jsonb) AS value
    FROM public.expediente_rechazo_reactivaciones rr
    LEFT JOIN public.profiles rp ON rp.id = rr.reactivado_por
    WHERE rr.expediente_id = p_expediente_id
  ),
  retencion AS (
    SELECT jsonb_build_object(
      'opcion', (
        SELECT jsonb_build_object(
          'retencion_opcion', ro.retencion_opcion::text,
          'created_at', ro.created_at,
          'updated_at', ro.updated_at,
          'updated_by_nombre', up.full_name
        )
        FROM public.retencion_opciones ro
        LEFT JOIN public.profiles up ON up.id = ro.updated_by
        WHERE ro.expediente_id = p_expediente_id
        LIMIT 1
      ),
      'envio', (
        SELECT jsonb_build_object(
          'enviado', re.enviado,
          'fecha_envio_mesa', re.fecha_envio_mesa,
          'opcion', re.opcion::text,
          'estado', re.estado::text,
          'created_at', re.created_at,
          'updated_at', re.updated_at
        )
        FROM public.retencion_envios re
        WHERE re.expediente_id = p_expediente_id
        LIMIT 1
      )
    ) AS value
  ),
  historial AS (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', al.id,
        'at', al.created_at,
        'action', al.action,
        'actor_role', al.actor_role,
        'actor_nombre', ap.full_name,
        'details', jsonb_strip_nulls(jsonb_build_object(
          'tipo_documento', nullif(left(btrim(coalesce(al.payload->>'tipo_documento', '')), 160), ''),
          'nombre_original', nullif(left(btrim(coalesce(al.payload->>'nombre_original', '')), 240), ''),
          'version', al.payload->'version',
          'estatus_anterior', nullif(left(btrim(coalesce(al.payload->>'estatus_anterior', '')), 60), ''),
          'estatus_nuevo', nullif(left(btrim(coalesce(al.payload->>'estatus_nuevo', '')), 60), ''),
          'decision_anterior', nullif(left(btrim(coalesce(al.payload->>'decision_anterior', '')), 80), ''),
          'decision_nueva', nullif(left(btrim(coalesce(al.payload->>'decision_nueva', '')), 80), ''),
          'monto_anterior', al.payload->'monto_anterior',
          'monto_nuevo', al.payload->'monto_nuevo',
          'monto_aprobado', al.payload->'monto_aprobado',
          'programa', nullif(left(btrim(coalesce(al.payload->>'programa', '')), 80), ''),
          'programa_anterior', nullif(left(btrim(coalesce(al.payload->>'programa_anterior', '')), 80), ''),
          'programa_solicitado', nullif(left(btrim(coalesce(al.payload->>'programa_solicitado', '')), 80), ''),
          'cliente_nombre_anterior', nullif(left(btrim(coalesce(al.payload->>'cliente_nombre_anterior', '')), 200), ''),
          'cliente_nombre_nuevo', nullif(left(btrim(coalesce(al.payload->>'cliente_nombre_nuevo', '')), 200), ''),
          'etapa_anterior', coalesce(al.payload->'etapa_anterior', al.payload->'etapa_origen'),
          'etapa_nueva', coalesce(al.payload->'etapa_nueva', al.payload->'etapa_destino'),
          'subestado_anterior', nullif(left(btrim(coalesce(al.payload->>'subestado_anterior', '')), 80), ''),
          'subestado_nuevo', nullif(left(btrim(coalesce(al.payload->>'subestado_nuevo', '')), 80), ''),
          'motivo', nullif(left(btrim(coalesce(al.payload->>'motivo', '')), 800), ''),
          'comentario', nullif(left(btrim(coalesce(al.payload->>'comentario', '')), 800), ''),
          'booking_kind', nullif(left(btrim(coalesce(al.payload->>'booking_kind', '')), 40), ''),
          'booking_date', nullif(left(btrim(coalesce(al.payload->>'booking_date', '')), 20), ''),
          'booking_time', nullif(left(btrim(coalesce(al.payload->>'booking_time', '')), 20), ''),
          'location_id', nullif(left(btrim(coalesce(al.payload->>'location_id', '')), 100), ''),
          'scheduled_at', nullif(left(btrim(coalesce(al.payload->>'scheduled_at', '')), 60), ''),
          'fecha_cita_anterior', nullif(left(btrim(coalesce(al.payload->>'fecha_cita_anterior', '')), 60), ''),
          'fecha_cita_nueva', nullif(left(btrim(coalesce(al.payload->>'fecha_cita_nueva', '')), 60), ''),
          'is_resend', al.payload->'is_resend',
          'opcion', nullif(left(btrim(coalesce(al.payload->>'opcion', '')), 80), '')
        ))
      ) ORDER BY al.created_at ASC, al.id ASC
    ), '[]'::jsonb) AS value
    FROM public.action_log al
    LEFT JOIN public.profiles ap ON ap.id = al.actor_id
    WHERE (
      (al.entity_type = 'expediente' AND al.entity_id = p_expediente_id)
      OR (al.payload->>'expediente_id') = p_expediente_id::text
    )
      -- Excluye ruido técnico generado por validación mientras se captura CURP/RFC.
      -- El estado funcional de identidad sigue visible en Datos Generales/documentos.
      AND al.action NOT LIKE 'identidad.validacion.%'
  )
  SELECT jsonb_build_object(
    'expediente', expediente_base.value,
    'precalificacion', precal.value,
    'cliente_datos', cliente.value,
    'documentos', documentos.value,
    'citas', citas.value,
    'decisiones_cita', decisiones_cita.value,
    'correcciones', correcciones.value,
    'rechazos_operativos', rechazos.value,
    'reactivaciones', reactivaciones.value,
    'retencion', retencion.value,
    'historial', historial.value
  )
  INTO v_result
  FROM expediente_base, precal, cliente, documentos, citas, decisiones_cita,
       correcciones, rechazos, reactivaciones, retencion, historial;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.admin_get_expediente_full_detail(uuid) IS
  'Super Admin RO: detalle completo de expediente + precal, DG, documentos/revisiones, agenda, correcciones, rechazos, retención e historial de negocio.';

REVOKE ALL ON FUNCTION public.admin_get_expediente_full_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_expediente_full_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_expediente_full_detail(uuid) TO authenticated;
