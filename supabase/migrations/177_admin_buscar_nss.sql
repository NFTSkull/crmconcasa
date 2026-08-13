-- ConCasa CRM — Admin /admin: p_buscar incluye NSS
-- Migration 177. Extiende predicado de búsqueda en Mesa/Precal/Snapshot.
-- Paridad con stage-history/ingresos (ILIKE parcial sobre expedientes.nss).

CREATE OR REPLACE FUNCTION public.admin_list_mesa_envios_page(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_asesor_id UUID DEFAULT NULL,
  p_etapa_actual SMALLINT DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_buscar TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page INTEGER;
  v_size INTEGER;
  v_offset INTEGER;
  v_total BIGINT;
  v_q TEXT;
  v_items JSONB;
  v_page_ids UUID[];
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  -- 1) total_count de cohorte (sin seguimiento pesado)
  SELECT count(*) INTO v_total
  FROM public.expedientes e
  LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND e.submitted_to_mesa = TRUE
    AND e.fecha_envio_mesa IS NOT NULL
    AND e.fecha_envio_mesa >= p_from
    AND e.fecha_envio_mesa < p_to_exclusive
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
    AND (
      p_estado IS NULL
      OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
      OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
      OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
      OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
    )
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
    );

  -- 2) IDs de la página
  SELECT coalesce(array_agg(x.id), '{}'::UUID[])
  INTO v_page_ids
  FROM (
    SELECT e.id
    FROM public.expedientes e
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa >= p_from
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
      AND (
        p_estado IS NULL
        OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      )
    ORDER BY e.fecha_envio_mesa DESC, e.id DESC
    OFFSET v_offset LIMIT v_size
  ) x;

  -- 3) Seguimiento pesado solo para IDs de la página
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.fecha_envio_mesa DESC, t.expediente_id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      base.expediente_id,
      base.fecha_envio_mesa,
      base.cliente_nombre,
      base.asesor_id,
      base.asesor_nombre,
      base.programa,
      base.etapa_actual,
      base.etapa_label,
      base.subestado,
      base.ciclo_estado,
      base.ultima_actividad_mesa_code,
      base.ultima_actividad_mesa_label,
      base.ultima_actividad_mesa_at,
      base.correcciones_abiertas_count,
      sit.correccion_abierta_desde,
      base.correcciones_reenviadas_count,
      sit.correccion_reenviada_desde,
      base.rechazo_operativo,
      base.rechazo_at,
      base.rechazo_clasificacion,
      base.rechazo_motivo,
      base.reingreso_activo,
      sit.situacion_code,
      sit.situacion_label,
      sit.espera_tipo,
      sit.espera_label,
      sit.espera_desde,
      actn.siguiente_accion_label,
      actn.siguiente_accion_actor
    FROM (
      SELECT
        e.id AS expediente_id,
        e.fecha_envio_mesa,
        e.cliente_nombre,
        e.asesor_id,
        nullif(btrim(pr.full_name), '') AS asesor_nombre,
        e.programa::text AS programa,
        e.etapa_actual,
        CASE e.etapa_actual
          WHEN 1 THEN 'Integración'
          WHEN 2 THEN 'Registro'
          WHEN 3 THEN 'Listo para cita de biométrico'
          WHEN 4 THEN 'Cita agendada (biométricos)'
          WHEN 5 THEN 'Biometría (resultado)'
          WHEN 6 THEN 'Inscripción'
          WHEN 7 THEN 'Notificación'
          WHEN 8 THEN 'Acuse / Aviso de retención'
          WHEN 9 THEN 'Listo para agendar firma'
          WHEN 10 THEN 'Cita para firma'
          WHEN 11 THEN 'Firmado'
          WHEN 12 THEN 'Pago a ConCasa'
          ELSE 'Etapa ' || e.etapa_actual::text
        END AS etapa_label,
        e.subestado::text AS subestado,
        e.ciclo_estado::text AS ciclo_estado,
        act.ultima_actividad_mesa_code,
        CASE act.ultima_actividad_mesa_code
          WHEN 'documento.revision.update' THEN 'Revisión documental Mesa'
          WHEN 'cliente_datos.revision.update' THEN 'Revisión de datos generales Mesa'
          WHEN 'expediente.avanzar_etapa_operativa' THEN 'Avance de etapa'
          WHEN 'mesa.expediente.mover_etapa' THEN 'Movimiento manual de etapa'
          WHEN 'mesa.expediente.take' THEN 'Mesa tomó el expediente'
          WHEN 'mesa.expediente.release' THEN 'Mesa liberó el expediente'
          WHEN 'expediente.documento.mesa_register' THEN 'Mesa registró documento'
          WHEN 'expediente.rechazo_operativo' THEN 'Rechazo operativo'
          WHEN 'agenda.biometricos.mesa_reagendar' THEN 'Mesa reagendó biométricos'
          WHEN 'agenda.notificacion.mesa_reagendar' THEN 'Mesa reagendó notificación'
          WHEN 'agenda.firmas.mesa_book' THEN 'Mesa agendó firma'
          WHEN 'agenda.firmas.mesa_reagendar' THEN 'Mesa reagendó firma'
          WHEN 'agenda.firmas.mesa_cancel' THEN 'Mesa canceló firma'
          WHEN 'agenda.drive_validation.set' THEN 'Validado en Drive'
          WHEN 'agenda.drive_validation.clear' THEN 'Validación Drive quitada'
          ELSE NULL
        END AS ultima_actividad_mesa_label,
        act.ultima_actividad_mesa_at,
        corr.correcciones_abiertas_count,
        corr.correccion_abierta_desde_raw,
        corr.correcciones_reenviadas_count,
        corr.correccion_reenviada_desde_raw,
        (e.subestado = 'rechazado' OR ro.id IS NOT NULL) AS rechazo_operativo,
        ro.created_at AS rechazo_at,
        ro.biometricos_condicion::text AS rechazo_clasificacion,
        coalesce(nullif(left(btrim(ro.motivo), 500), ''), 'Sin motivo registrado') AS rechazo_motivo,
        (e.reingreso_rechazo_id IS NOT NULL) AS reingreso_activo,
        bk.bio_booked,
        bk.bio_cancelled_sin_booked,
        bk.firma_booked,
        bk.firma_cancelled_sin_booked
      FROM unnest(v_page_ids) AS pid(id)
      JOIN public.expedientes e ON e.id = pid.id
      LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
      LEFT JOIN LATERAL (
        SELECT r.id, r.created_at, r.motivo, r.biometricos_condicion
        FROM public.expediente_rechazos_operativos r
        WHERE r.expediente_id = e.id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      ) ro ON TRUE
      LEFT JOIN LATERAL (
        SELECT al.action AS ultima_actividad_mesa_code, al.created_at AS ultima_actividad_mesa_at
        FROM public.action_log al
        WHERE (
          (al.entity_type = 'expediente' AND al.entity_id = e.id)
          OR (al.payload->>'expediente_id') = e.id::text
        )
        AND al.action IN (
          'documento.revision.update',
          'cliente_datos.revision.update',
          'expediente.avanzar_etapa_operativa',
          'mesa.expediente.mover_etapa',
          'mesa.expediente.take',
          'mesa.expediente.release',
          'expediente.documento.mesa_register',
          'expediente.rechazo_operativo',
          'agenda.biometricos.mesa_reagendar',
          'agenda.notificacion.mesa_reagendar',
          'agenda.firmas.mesa_book',
          'agenda.firmas.mesa_reagendar',
          'agenda.firmas.mesa_cancel',
          'agenda.drive_validation.set',
          'agenda.drive_validation.clear'
        )
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT 1
      ) act ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          (
            (SELECT count(*)::INTEGER FROM public.expediente_documentos d
             WHERE d.expediente_id = e.id AND d.deleted_at IS NULL AND d.estatus_revision = 'rechazado')
            + CASE WHEN cd.estado = 'rechazado' THEN 1 ELSE 0 END
            + CASE WHEN re.estado = 'correccion_requerida' THEN 1 ELSE 0 END
          ) AS correcciones_abiertas_count,
          (
            SELECT LEAST(
              coalesce((
                SELECT min(dr.created_at)
                FROM public.documento_revisiones dr
                JOIN public.expediente_documentos d ON d.id = dr.documento_id
                WHERE d.expediente_id = e.id AND d.deleted_at IS NULL
                  AND d.estatus_revision = 'rechazado' AND dr.estatus_nuevo = 'rechazado'
              ), 'infinity'::timestamptz),
              coalesce(CASE WHEN cd.estado = 'rechazado' THEN cd.rejected_at END, 'infinity'::timestamptz),
              coalesce(CASE WHEN re.estado = 'correccion_requerida' THEN re.updated_at END, 'infinity'::timestamptz)
            )
          ) AS correccion_abierta_desde_raw,
          (
            (SELECT count(*)::INTEGER FROM public.expediente_documentos d
             WHERE d.expediente_id = e.id AND d.deleted_at IS NULL AND d.estatus_revision = 'resubido')
            + CASE
                WHEN cd.estado = 'completo' AND cd.validated_at IS NULL
                  AND cd.updated_at IS NOT NULL AND e.fecha_envio_mesa IS NOT NULL
                  AND cd.updated_at > e.fecha_envio_mesa
                THEN 1 ELSE 0
              END
            + CASE
                WHEN re.estado = 'enviado'
                  AND EXISTS (
                    SELECT 1 FROM public.expediente_documentos d
                    WHERE d.expediente_id = e.id AND d.deleted_at IS NULL
                      AND d.tipo_documento LIKE 'retencion_%' AND d.estatus_revision = 'resubido'
                  )
                THEN 1 ELSE 0
              END
          ) AS correcciones_reenviadas_count,
          (
            SELECT GREATEST(
              coalesce((
                SELECT max(d.created_at) FROM public.expediente_documentos d
                WHERE d.expediente_id = e.id AND d.deleted_at IS NULL AND d.estatus_revision = 'resubido'
              ), '-infinity'::timestamptz),
              coalesce(
                CASE
                  WHEN cd.estado = 'completo' AND cd.validated_at IS NULL
                    AND cd.updated_at IS NOT NULL AND e.fecha_envio_mesa IS NOT NULL
                    AND cd.updated_at > e.fecha_envio_mesa
                  THEN cd.updated_at
                END,
                '-infinity'::timestamptz
              ),
              coalesce((
                SELECT max(al.created_at) FROM public.action_log al
                WHERE al.action = 'expediente.enviar_retencion_mesa'
                  AND (
                    (al.entity_type = 'expediente' AND al.entity_id = e.id)
                    OR (al.payload->>'expediente_id') = e.id::text
                  )
                  AND coalesce((al.payload->>'is_resend')::boolean, false) = true
              ), '-infinity'::timestamptz)
            )
          ) AS correccion_reenviada_desde_raw
        FROM (SELECT 1) _
        LEFT JOIN public.cliente_datos cd ON cd.expediente_id = e.id
        LEFT JOIN public.retencion_envios re ON re.expediente_id = e.id
      ) corr ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          EXISTS (
            SELECT 1 FROM public.agenda_bookings b
            WHERE b.expediente_id = e.id AND b.kind = 'biometricos' AND b.status = 'booked'
          ) AS bio_booked,
          (
            EXISTS (
              SELECT 1 FROM public.agenda_bookings b
              WHERE b.expediente_id = e.id AND b.kind = 'biometricos' AND b.status = 'cancelled'
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.agenda_bookings b
              WHERE b.expediente_id = e.id AND b.kind = 'biometricos' AND b.status = 'booked'
            )
          ) AS bio_cancelled_sin_booked,
          EXISTS (
            SELECT 1 FROM public.agenda_bookings b
            WHERE b.expediente_id = e.id AND b.kind = 'firmas' AND b.status = 'booked'
          ) AS firma_booked,
          (
            EXISTS (
              SELECT 1 FROM public.agenda_bookings b
              WHERE b.expediente_id = e.id AND b.kind = 'firmas' AND b.status = 'cancelled'
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.agenda_bookings b
              WHERE b.expediente_id = e.id AND b.kind = 'firmas' AND b.status = 'booked'
            )
          ) AS firma_cancelled_sin_booked
      ) bk ON TRUE
    ) base
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN base.rechazo_operativo AND base.ciclo_estado = 'activo' AND base.subestado = 'rechazado'
          THEN 'rechazo_operativo'
        WHEN base.reingreso_activo THEN 'en_reingreso'
        WHEN base.correcciones_abiertas_count > 0 THEN 'correccion_pendiente_asesor'
        WHEN base.correcciones_reenviadas_count > 0 THEN 'correccion_reenviada_esperando_mesa'
        WHEN base.bio_cancelled_sin_booked AND base.etapa_actual IN (3, 4, 5)
          THEN 'cita_biometrica_cancelada_reagenda'
        WHEN base.firma_cancelled_sin_booked AND base.etapa_actual IN (9, 10)
          THEN 'firma_cancelada_reagenda'
        WHEN base.ciclo_estado IN ('cerrado', 'cancelado') THEN 'cerrado'
        WHEN base.etapa_actual = 12 THEN 'pago_a_concasa'
        WHEN base.etapa_actual = 11 THEN 'firmado'
        WHEN base.etapa_actual = 10 AND base.firma_booked THEN 'firma_agendada'
        WHEN base.etapa_actual = 9 THEN 'listo_agendar_firma'
        WHEN base.etapa_actual = 8 THEN 'pendiente_acuse'
        WHEN base.etapa_actual = 7 THEN 'notificacion'
        WHEN base.etapa_actual = 6 THEN 'inscripcion'
        WHEN base.etapa_actual = 5 THEN 'resultado_biometrico_pendiente'
        WHEN base.etapa_actual IN (3, 4) AND base.bio_booked THEN 'cita_biometrica_agendada'
        WHEN base.etapa_actual = 3 THEN 'listo_cita_biometrico'
        WHEN base.etapa_actual = 1 AND base.subestado = 'en_validacion_mesa' THEN 'en_revision_mesa'
        WHEN base.subestado = 'en_validacion_mesa' THEN 'en_revision_mesa'
        ELSE 'continuar_etapa'
      END AS situacion_code
    ) sit0
    CROSS JOIN LATERAL (
      SELECT
        sit0.situacion_code,
        CASE sit0.situacion_code
          WHEN 'rechazo_operativo' THEN 'Rechazado operativamente'
          WHEN 'en_reingreso' THEN 'En reingreso'
          WHEN 'correccion_pendiente_asesor' THEN 'Corrección pendiente del asesor'
          WHEN 'correccion_reenviada_esperando_mesa' THEN 'Corrección reenviada; esperando Mesa'
          WHEN 'cita_biometrica_cancelada_reagenda' THEN 'Cita biométrica cancelada; requiere reagenda'
          WHEN 'firma_cancelada_reagenda' THEN 'Firma cancelada; requiere reagenda'
          WHEN 'en_revision_mesa' THEN 'En revisión de Mesa'
          WHEN 'listo_cita_biometrico' THEN 'Listo para cita de biométrico'
          WHEN 'cita_biometrica_agendada' THEN 'Cita biométrica agendada'
          WHEN 'resultado_biometrico_pendiente' THEN 'Resultado biométrico pendiente'
          WHEN 'inscripcion' THEN 'Inscripción'
          WHEN 'notificacion' THEN 'Notificación'
          WHEN 'pendiente_acuse' THEN 'Pendiente de Acuse'
          WHEN 'listo_agendar_firma' THEN 'Listo para agendar firma'
          WHEN 'firma_agendada' THEN 'Firma agendada'
          WHEN 'firmado' THEN 'Firmado'
          WHEN 'pago_a_concasa' THEN 'Pago a ConCasa'
          WHEN 'cerrado' THEN 'Cerrado'
          ELSE 'Continuar etapa actual'
        END AS situacion_label,
        CASE
          WHEN sit0.situacion_code = 'correccion_pendiente_asesor' THEN 'correccion_asesor'
          WHEN sit0.situacion_code = 'correccion_reenviada_esperando_mesa' THEN 'correccion_mesa'
          WHEN sit0.situacion_code = 'en_revision_mesa' THEN 'mesa_revision'
          ELSE NULL
        END AS espera_tipo,
        CASE
          WHEN sit0.situacion_code = 'correccion_pendiente_asesor' THEN 'Espera corrección del asesor'
          WHEN sit0.situacion_code = 'correccion_reenviada_esperando_mesa' THEN 'Espera revisión de Mesa'
          WHEN sit0.situacion_code = 'en_revision_mesa' THEN 'En revisión de Mesa'
          ELSE NULL
        END AS espera_label,
        CASE
          WHEN sit0.situacion_code = 'correccion_pendiente_asesor'
            AND base.correccion_abierta_desde_raw < 'infinity'::timestamptz
            THEN base.correccion_abierta_desde_raw
          WHEN sit0.situacion_code = 'correccion_reenviada_esperando_mesa'
            AND base.correccion_reenviada_desde_raw > '-infinity'::timestamptz
            THEN base.correccion_reenviada_desde_raw
          WHEN sit0.situacion_code = 'en_revision_mesa' THEN base.fecha_envio_mesa
          ELSE NULL
        END AS espera_desde,
        CASE
          WHEN base.correccion_abierta_desde_raw < 'infinity'::timestamptz
            THEN base.correccion_abierta_desde_raw
          ELSE NULL
        END AS correccion_abierta_desde,
        CASE
          WHEN base.correccion_reenviada_desde_raw > '-infinity'::timestamptz
            THEN base.correccion_reenviada_desde_raw
          ELSE NULL
        END AS correccion_reenviada_desde
    ) sit
    CROSS JOIN LATERAL (
      SELECT
        CASE sit.situacion_code
          WHEN 'correccion_pendiente_asesor' THEN 'Corregir y reenviar'
          WHEN 'correccion_reenviada_esperando_mesa' THEN 'Revisar corrección'
          WHEN 'rechazo_operativo' THEN 'Revisar reingreso'
          WHEN 'en_reingreso' THEN 'Continuar reingreso'
          WHEN 'listo_cita_biometrico' THEN 'Agendar biométricos'
          WHEN 'cita_biometrica_cancelada_reagenda' THEN 'Reagendar biométricos'
          WHEN 'cita_biometrica_agendada' THEN 'Continuar etapa actual'
          WHEN 'resultado_biometrico_pendiente' THEN 'Continuar etapa actual'
          WHEN 'pendiente_acuse' THEN 'Cargar y enviar Acuse'
          WHEN 'listo_agendar_firma' THEN 'Agendar firma'
          WHEN 'firma_cancelada_reagenda' THEN 'Reagendar firma'
          WHEN 'firma_agendada' THEN 'Realizar o registrar firma'
          WHEN 'en_revision_mesa' THEN 'Validar integración'
          WHEN 'pago_a_concasa' THEN 'Continuar etapa actual'
          WHEN 'cerrado' THEN 'Sin acción'
          WHEN 'firmado' THEN 'Continuar etapa actual'
          WHEN 'inscripcion' THEN 'Continuar etapa actual'
          WHEN 'notificacion' THEN 'Continuar etapa actual'
          ELSE 'Continuar etapa actual'
        END AS siguiente_accion_label,
        CASE sit.situacion_code
          WHEN 'correccion_pendiente_asesor' THEN 'Asesor'
          WHEN 'correccion_reenviada_esperando_mesa' THEN 'Mesa'
          WHEN 'rechazo_operativo' THEN 'Asesor'
          WHEN 'en_reingreso' THEN 'Asesor'
          WHEN 'listo_cita_biometrico' THEN 'Asesor'
          WHEN 'cita_biometrica_cancelada_reagenda' THEN 'Asesor'
          WHEN 'pendiente_acuse' THEN 'Asesor'
          WHEN 'listo_agendar_firma' THEN 'Mesa'
          WHEN 'firma_cancelada_reagenda' THEN 'Asesor'
          WHEN 'firma_agendada' THEN 'Mesa'
          WHEN 'en_revision_mesa' THEN 'Mesa'
          WHEN 'cita_biometrica_agendada' THEN 'Mesa'
          WHEN 'resultado_biometrico_pendiente' THEN 'Mesa'
          WHEN 'pago_a_concasa' THEN 'Mesa'
          WHEN 'inscripcion' THEN 'Mesa'
          WHEN 'notificacion' THEN 'Mesa'
          WHEN 'firmado' THEN 'Mesa'
          ELSE 'Mesa'
        END AS siguiente_accion_actor
    ) actn
  ) t;

  RETURN jsonb_build_object(
    'total_count', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_size,
    'items', coalesce(v_items, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_precalificaciones_page(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_asesor_id UUID DEFAULT NULL,
  p_decision_filter TEXT DEFAULT NULL,
  p_buscar TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page INTEGER;
  v_size INTEGER;
  v_offset INTEGER;
  v_total BIGINT;
  v_q TEXT;
  v_items JSONB;
  v_sum JSONB;
  v_filter TEXT;
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');
  v_filter := coalesce(nullif(btrim(p_decision_filter), ''), 'resueltas');

  SELECT count(*) INTO v_total
  FROM public.editor_decisions ed
  JOIN public.expedientes e ON e.id = ed.expediente_id
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
    )
    AND (
      (
        v_filter IN ('resueltas', 'todas', 'aprobadas')
        AND ed.decision = 'aprobado'
        AND ed.aprobado_at IS NOT NULL
        AND ed.aprobado_at >= p_from
        AND ed.aprobado_at < p_to_exclusive
      )
      OR (
        v_filter IN ('resueltas', 'todas', 'no_cumple')
        AND ed.decision = 'no_cumple'
        AND ed.no_cumple_at IS NOT NULL
        AND ed.no_cumple_at >= p_from
        AND ed.no_cumple_at < p_to_exclusive
      )
      OR (
        v_filter IN ('todas', 'pendientes')
        AND ed.decision = 'pendiente'
      )
    );

  SELECT jsonb_build_object(
    'resueltas_count', count(*) FILTER (
      WHERE ed.decision IN ('aprobado', 'no_cumple')
    ),
    'aprobadas_count', count(*) FILTER (WHERE ed.decision = 'aprobado'),
    'no_cumple_count', count(*) FILTER (WHERE ed.decision = 'no_cumple'),
    'pendientes_actuales_count', count(*) FILTER (WHERE ed.decision = 'pendiente'),
    'mayores_20000_count', count(*) FILTER (
      WHERE ed.decision = 'aprobado'
        AND ed.monto_aprobado_al_aprobar IS NOT NULL
        AND ed.monto_aprobado_al_aprobar > 20000
    ),
    'mejoravit_aprobadas_count', count(*) FILTER (
      WHERE ed.decision = 'aprobado'
        AND lower(btrim(e.programa::text)) = 'mejoravit'
        AND ed.monto_aprobado_al_aprobar IS NOT NULL
        AND ed.monto_aprobado_al_aprobar > 0
    ),
    'monto_mejoravit_total', coalesce(
      sum(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)) FILTER (
        WHERE ed.decision = 'aprobado'
          AND lower(btrim(e.programa::text)) = 'mejoravit'
          AND ed.monto_aprobado_al_aprobar IS NOT NULL
          AND ed.monto_aprobado_al_aprobar > 0
      ),
      0
    ),
    'monto_mejoravit_promedio', CASE
      WHEN count(*) FILTER (
        WHERE ed.decision = 'aprobado'
          AND lower(btrim(e.programa::text)) = 'mejoravit'
          AND ed.monto_aprobado_al_aprobar IS NOT NULL
          AND ed.monto_aprobado_al_aprobar > 0
      ) = 0 THEN 0
      ELSE round(
        avg(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)) FILTER (
          WHERE ed.decision = 'aprobado'
            AND lower(btrim(e.programa::text)) = 'mejoravit'
            AND ed.monto_aprobado_al_aprobar IS NOT NULL
            AND ed.monto_aprobado_al_aprobar > 0
        ),
        2
      )
    END
  )
  INTO v_sum
  FROM public.editor_decisions ed
  JOIN public.expedientes e ON e.id = ed.expediente_id
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
    )
    AND (
      (
        v_filter IN ('resueltas', 'todas', 'aprobadas')
        AND ed.decision = 'aprobado'
        AND ed.aprobado_at IS NOT NULL
        AND ed.aprobado_at >= p_from
        AND ed.aprobado_at < p_to_exclusive
      )
      OR (
        v_filter IN ('resueltas', 'todas', 'no_cumple')
        AND ed.decision = 'no_cumple'
        AND ed.no_cumple_at IS NOT NULL
        AND ed.no_cumple_at >= p_from
        AND ed.no_cumple_at < p_to_exclusive
      )
      OR (
        v_filter IN ('todas', 'pendientes')
        AND ed.decision = 'pendiente'
      )
    );

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ed.expediente_id,
      CASE
        WHEN ed.decision = 'aprobado' THEN ed.aprobado_at
        WHEN ed.decision = 'no_cumple' THEN ed.no_cumple_at
        ELSE NULL
      END AS fecha,
      ed.aprobado_at,
      ed.no_cumple_at,
      e.cliente_nombre,
      e.asesor_id,
      nullif(btrim(p.full_name), '') AS asesor_nombre,
      p.email AS asesor_email,
      ed.decision::text AS decision,
      ed.monto_aprobado_al_aprobar,
      ed.monto_aprobado AS monto_aprobado_actual,
      ed.monto_aprobado_snapshot_no_recuperable,
      e.programa::text AS programa
    FROM public.editor_decisions ed
    JOIN public.expedientes e ON e.id = ed.expediente_id
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      )
      AND (
        (
          v_filter IN ('resueltas', 'todas', 'aprobadas')
          AND ed.decision = 'aprobado'
          AND ed.aprobado_at IS NOT NULL
          AND ed.aprobado_at >= p_from
          AND ed.aprobado_at < p_to_exclusive
        )
        OR (
          v_filter IN ('resueltas', 'todas', 'no_cumple')
          AND ed.decision = 'no_cumple'
          AND ed.no_cumple_at IS NOT NULL
          AND ed.no_cumple_at >= p_from
          AND ed.no_cumple_at < p_to_exclusive
        )
        OR (
          v_filter IN ('todas', 'pendientes')
          AND ed.decision = 'pendiente'
        )
      )
    ORDER BY
      CASE
        WHEN ed.decision = 'aprobado' THEN ed.aprobado_at
        WHEN ed.decision = 'no_cumple' THEN ed.no_cumple_at
        ELSE NULL
      END DESC NULLS LAST,
      ed.expediente_id DESC
    OFFSET v_offset LIMIT v_size
  ) t;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'page', v_page,
    'page_size', v_size,
    'summary', v_sum,
    'items', v_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_expedientes_snapshot_etapas(
  p_asesor_id UUID DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_buscar TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_by_etapa JSONB;
  v_by_paso JSONB;
  v_q TEXT;
  v_generated_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM public.__admin_require_super_admin();

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  WITH base AS (
    SELECT
      e.id,
      e.etapa_actual,
      CASE
        WHEN e.etapa_actual <= 3 THEN e.etapa_actual
        WHEN e.etapa_actual = 4 THEN 3
        ELSE e.etapa_actual - 1
      END AS paso_visual
    FROM public.expedientes e
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND (
        e.etapa_actual IS DISTINCT FROM 1
        OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
      )
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (
        p_estado IS NULL
        OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      )
  )
  SELECT count(*) INTO v_total FROM base;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'etapa', g.etapa,
      'count', g.cnt,
      'pct', CASE WHEN v_total = 0 THEN 0 ELSE round((g.cnt::NUMERIC * 1000 / v_total) / 10.0, 1) END
    )
    ORDER BY g.etapa
  ), '[]'::jsonb)
  INTO v_by_etapa
  FROM (
    SELECT s.etapa, coalesce(c.cnt, 0)::BIGINT AS cnt
    FROM generate_series(1, 12) AS s(etapa)
    LEFT JOIN (
      SELECT b.etapa_actual AS etapa, count(*)::BIGINT AS cnt
      FROM (
        SELECT
          e.etapa_actual
        FROM public.expedientes e
        LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
        WHERE e.deleted_at IS NULL
          AND (
            e.etapa_actual IS DISTINCT FROM 1
            OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
          )
          AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
          AND (
            p_estado IS NULL
            OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
            OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
            OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
            OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
          )
          AND (
            v_q IS NULL
            OR e.cliente_nombre ILIKE '%' || v_q || '%'
            OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
            OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
            OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
          )
      ) b
      GROUP BY b.etapa_actual
    ) c ON c.etapa = s.etapa
  ) g;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'paso_visual', g.paso,
      'count', g.cnt,
      'pct', CASE WHEN v_total = 0 THEN 0 ELSE round((g.cnt::NUMERIC * 1000 / v_total) / 10.0, 1) END
    )
    ORDER BY g.paso
  ), '[]'::jsonb)
  INTO v_by_paso
  FROM (
    SELECT s.paso, coalesce(c.cnt, 0)::BIGINT AS cnt
    FROM generate_series(1, 11) AS s(paso)
    LEFT JOIN (
      SELECT
        CASE
          WHEN e.etapa_actual <= 3 THEN e.etapa_actual
          WHEN e.etapa_actual = 4 THEN 3
          ELSE e.etapa_actual - 1
        END AS paso,
        count(*)::BIGINT AS cnt
      FROM public.expedientes e
      LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
      WHERE e.deleted_at IS NULL
        AND (
          e.etapa_actual IS DISTINCT FROM 1
          OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
        )
        AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
        AND (
          p_estado IS NULL
          OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
          OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
        )
        AND (
          v_q IS NULL
          OR e.cliente_nombre ILIKE '%' || v_q || '%'
          OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
          OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
          OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
        )
      GROUP BY 1
    ) c ON c.paso = s.paso
  ) g;

  RETURN jsonb_build_object(
    'total_actual', coalesce(v_total, 0),
    'by_etapa', coalesce(v_by_etapa, '[]'::jsonb),
    'by_paso_visual', coalesce(v_by_paso, '[]'::jsonb),
    'generated_at', v_generated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_expedientes_snapshot_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_asesor_id UUID DEFAULT NULL,
  p_etapa_actual SMALLINT DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_buscar TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page INTEGER;
  v_size INTEGER;
  v_offset INTEGER;
  v_total BIGINT;
  v_q TEXT;
  v_items JSONB;
BEGIN
  PERFORM public.__admin_require_super_admin();

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  SELECT count(*) INTO v_total
  FROM public.expedientes e
  LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
  WHERE e.deleted_at IS NULL
    AND (
      e.etapa_actual IS DISTINCT FROM 1
      OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
    )
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
    AND (
      p_estado IS NULL
      OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
      OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
      OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
      OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
    )
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
    );

  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.sort_at DESC, t.expediente_id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      e.id AS expediente_id,
      e.fecha_envio_mesa,
      e.cliente_nombre,
      e.asesor_id,
      nullif(btrim(pr.full_name), '') AS asesor_nombre,
      e.programa::text AS programa,
      e.etapa_actual,
      CASE e.etapa_actual
        WHEN 1 THEN 'Integración'
        WHEN 2 THEN 'Registro'
        WHEN 3 THEN 'Listo para cita de biométrico'
        WHEN 4 THEN 'Cita agendada (biométricos)'
        WHEN 5 THEN 'Biometría (resultado)'
        WHEN 6 THEN 'Inscripción'
        WHEN 7 THEN 'Notificación'
        WHEN 8 THEN 'Acuse / Aviso de retención'
        WHEN 9 THEN 'Listo para agendar firma'
        WHEN 10 THEN 'Cita para firma'
        WHEN 11 THEN 'Firmado'
        WHEN 12 THEN 'Pago a ConCasa'
        ELSE 'Etapa ' || e.etapa_actual::text
      END AS etapa_label,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      NULL::text AS ultima_actividad_mesa_code,
      NULL::text AS ultima_actividad_mesa_label,
      NULL::timestamptz AS ultima_actividad_mesa_at,
      0::bigint AS correcciones_abiertas_count,
      NULL::timestamptz AS correccion_abierta_desde,
      0::bigint AS correcciones_reenviadas_count,
      NULL::timestamptz AS correccion_reenviada_desde,
      (e.subestado = 'rechazado') AS rechazo_operativo,
      NULL::timestamptz AS rechazo_at,
      NULL::text AS rechazo_clasificacion,
      CASE WHEN e.subestado = 'rechazado' THEN 'Sin motivo registrado' ELSE NULL END AS rechazo_motivo,
      (e.reingreso_rechazo_id IS NOT NULL) AS reingreso_activo,
      'continuar_etapa'::text AS situacion_code,
      'Continuar etapa actual'::text AS situacion_label,
      NULL::text AS espera_tipo,
      NULL::text AS espera_label,
      NULL::timestamptz AS espera_desde,
      'Continuar etapa actual'::text AS siguiente_accion_label,
      'Mesa'::text AS siguiente_accion_actor,
      coalesce(e.fecha_envio_mesa, e.updated_at, e.created_at) AS sort_at
    FROM public.expedientes e
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND (
        e.etapa_actual IS DISTINCT FROM 1
        OR (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL)
      )
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
      AND (
        p_estado IS NULL
        OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      )
    ORDER BY coalesce(e.fecha_envio_mesa, e.updated_at, e.created_at) DESC, e.id DESC
    OFFSET v_offset LIMIT v_size
  ) t;

  RETURN jsonb_build_object(
    'total_count', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_size,
    'items', coalesce(v_items, '[]'::jsonb)
  );
END;
$$;
