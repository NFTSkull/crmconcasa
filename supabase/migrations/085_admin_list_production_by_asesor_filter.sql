-- ConCasa CRM — P085: filtro p_asesor_id en admin_list_production_by_asesor
-- No modifica archivos P070–P084. Solo redefine la RPC Admin RO.
-- Firma ampliada con p_asesor_id UUID DEFAULT NULL (compatible con llamadas nombradas).

DROP FUNCTION IF EXISTS public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.admin_list_production_by_asesor(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_estado TEXT DEFAULT NULL,
  p_asesor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  RETURN coalesce((
    WITH envios AS (
      SELECT e.asesor_id, e.etapa_actual, count(*)::BIGINT AS cnt
      FROM public.expedientes e
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
        AND e.fecha_envio_mesa >= p_from
        AND e.fecha_envio_mesa < p_to_exclusive
        AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
        AND (
          p_estado IS NULL
          OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
          OR (p_estado = 'rechazados' AND (e.subestado = 'rechazado' OR e.ciclo_estado = 'cancelado'))
        )
      GROUP BY e.asesor_id, e.etapa_actual
    ),
    envios_tot AS (
      SELECT asesor_id, sum(cnt)::BIGINT AS enviados
      FROM envios GROUP BY asesor_id
    ),
    aprob AS (
      SELECT e.asesor_id,
             count(*) FILTER (
               WHERE ed.decision = 'aprobado'
                 AND ed.aprobado_at IS NOT NULL
                 AND ed.aprobado_at >= p_from
                 AND ed.aprobado_at < p_to_exclusive
             )::BIGINT AS aprobadas,
             count(*) FILTER (
               WHERE ed.decision = 'no_cumple'
                 AND ed.no_cumple_at IS NOT NULL
                 AND ed.no_cumple_at >= p_from
                 AND ed.no_cumple_at < p_to_exclusive
             )::BIGINT AS no_cumple,
             count(*) FILTER (
               WHERE ed.decision = 'aprobado'
                 AND ed.aprobado_at IS NOT NULL
                 AND ed.aprobado_at >= p_from
                 AND ed.aprobado_at < p_to_exclusive
                 AND ed.monto_aprobado_al_aprobar > 20000
             )::BIGINT AS mayor,
             coalesce(
               sum(ed.monto_aprobado_al_aprobar) FILTER (
                 WHERE ed.decision = 'aprobado'
                   AND ed.aprobado_at IS NOT NULL
                   AND ed.aprobado_at >= p_from
                   AND ed.aprobado_at < p_to_exclusive
                   AND lower(btrim(e.programa::text)) = 'mejoravit'
                   AND ed.monto_aprobado_al_aprobar IS NOT NULL
                   AND ed.monto_aprobado_al_aprobar > 0
               ),
               0
             )::NUMERIC(14,2) AS monto_total
      FROM public.editor_decisions ed
      JOIN public.expedientes e ON e.id = ed.expediente_id
      WHERE e.deleted_at IS NULL
        AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      GROUP BY e.asesor_id
    ),
    asesores AS (
      SELECT DISTINCT asesor_id FROM envios_tot
      UNION
      SELECT DISTINCT asesor_id FROM aprob
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'asesor_id', a.asesor_id,
        'asesor_nombre', nullif(btrim(p.full_name), ''),
        'asesor_email', p.email,
        'enviados_a_mesa', coalesce(et.enviados, 0),
        'precalificaciones_aprobadas', coalesce(ap.aprobadas, 0),
        'precalificaciones_no_cumple', coalesce(ap.no_cumple, 0),
        'aprobadas_mayor_a_20000', coalesce(ap.mayor, 0),
        'monto_aprobado_total', coalesce(ap.monto_total, 0),
        'etapas', coalesce((
          SELECT jsonb_object_agg(en.etapa_actual::text, en.cnt)
          FROM envios en WHERE en.asesor_id = a.asesor_id
        ), '{}'::jsonb)
      )
      ORDER BY coalesce(et.enviados, 0) DESC, coalesce(ap.monto_total, 0) DESC
    )
    FROM asesores a
    LEFT JOIN envios_tot et ON et.asesor_id = a.asesor_id
    LEFT JOIN aprob ap ON ap.asesor_id = a.asesor_id
    LEFT JOIN public.profiles p ON p.id = a.asesor_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_list_production_by_asesor(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) IS
  'P082/P085 Admin RO: producción por asesor; p_asesor_id opcional filtra a un UUID estable.';

-- =============================================================================
-- P085 (ampliación): resumen Mesa RO + timeline bajo demanda
-- Arquitectura listado: cohorte → count → page_ids → seguimiento solo de la página.
-- Sin asesor_email en respuesta Mesa. Whitelist de acción (no por rol).
-- =============================================================================

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
      OR (p_estado = 'rechazados' AND (e.subestado = 'rechazado' OR e.ciclo_estado = 'cancelado'))
    )
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
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
        OR (p_estado = 'rechazados' AND (e.subestado = 'rechazado' OR e.ciclo_estado = 'cancelado'))
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
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

REVOKE ALL ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_list_mesa_envios_page(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) IS
  'P085 Admin RO: cohorte→page_ids→seguimiento de página; sin asesor_email; sin timeline embebido.';

-- =============================================================================
-- Timeline bajo demanda (orden estable created_at DESC, id DESC; has_more)
-- =============================================================================

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

  -- Alcance: enviado a Mesa. Inexistente / fuera de alcance → mismo error (sin filtrar info).
  SELECT EXISTS (
    SELECT 1 FROM public.expedientes e
    WHERE e.id = p_expediente_id
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'admin_timeline: expediente no visible o no enviado a Mesa'
      USING ERRCODE = 'P0002';
  END IF;

  -- NULL→10; <=0→1; >100→100
  v_limit := LEAST(100, GREATEST(1, coalesce(p_limit, 10)));
  v_offset := GREATEST(0, coalesce(p_offset, 0));

  SELECT count(*) INTO v_total
  FROM public.action_log al
  WHERE (
    (al.entity_type = 'expediente' AND al.entity_id = p_expediente_id)
    OR (al.payload->>'expediente_id') = p_expediente_id::text
  )
  AND al.action IN (
    'expediente.enviar_a_mesa',
    'documento.revision.update',
    'cliente_datos.revision.update',
    'expediente.documento.asesor_correccion',
    'cliente_datos.correccion_post_mesa',
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
    'agenda.firmas.book',
    'agenda.firmas.cancel',
    'agenda.firmas.reagendar',
    'agenda.firmas.mesa_book',
    'agenda.firmas.mesa_reagendar',
    'agenda.firmas.mesa_cancel',
    'agenda.drive_validation.set',
    'agenda.drive_validation.clear'
  );

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
          WHEN al.action IN (
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
          ) THEN 'Mesa'
          WHEN al.action IN (
            'expediente.enviar_a_mesa',
            'expediente.documento.asesor_correccion',
            'cliente_datos.correccion_post_mesa',
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
        'summary', jsonb_strip_nulls(jsonb_build_object(
          'tipo_documento', nullif(left(btrim(coalesce(al.payload->>'tipo_documento', '')), 120), ''),
          'estatus_nuevo', nullif(left(btrim(coalesce(al.payload->>'estatus_nuevo', '')), 40), ''),
          'estatus_anterior', nullif(left(btrim(coalesce(al.payload->>'estatus_anterior', '')), 40), ''),
          'etapa_destino', nullif(left(btrim(coalesce(al.payload->>'etapa_destino', '')), 10), ''),
          'etapa_origen', nullif(left(btrim(coalesce(al.payload->>'etapa_origen', '')), 10), ''),
          'motivo', nullif(left(btrim(coalesce(al.payload->>'motivo', '')), 500), ''),
          'is_resend', CASE
            WHEN al.payload ? 'is_resend'
              THEN left(btrim(coalesce(al.payload->>'is_resend', '')), 5)
            ELSE NULL
          END
        ))
      ) AS ev
    FROM public.action_log al
    WHERE (
      (al.entity_type = 'expediente' AND al.entity_id = p_expediente_id)
      OR (al.payload->>'expediente_id') = p_expediente_id::text
    )
    AND al.action IN (
      'expediente.enviar_a_mesa',
      'documento.revision.update',
      'cliente_datos.revision.update',
      'expediente.documento.asesor_correccion',
      'cliente_datos.correccion_post_mesa',
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
      'agenda.firmas.book',
      'agenda.firmas.cancel',
      'agenda.firmas.reagendar',
      'agenda.firmas.mesa_book',
      'agenda.firmas.mesa_reagendar',
      'agenda.firmas.mesa_cancel',
      'agenda.drive_validation.set',
      'agenda.drive_validation.clear'
    )
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

REVOKE ALL ON FUNCTION public.admin_get_expediente_mesa_timeline(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_expediente_mesa_timeline(UUID, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_expediente_mesa_timeline(UUID, INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.admin_get_expediente_mesa_timeline(UUID, INTEGER, INTEGER) IS
  'P085 Admin RO: timeline paginado (limit 1–100, offset≥0), orden created_at+id, has_more; payload redactado.';
