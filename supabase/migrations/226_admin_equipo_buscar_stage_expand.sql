-- ConCasa CRM — Admin rollup gaps (mig 226)
-- 1) Buscar por nombre/email de líder incluye equipo (antes solo ILIKE del dueño → Silvia=9).
-- 2) Stage history / cohort expand p_asesor_ids via admin_expand_asesor_ids.
-- 3) Report v1/v2 + production_by_asesor_v2 alineados con helpers 225.

CREATE OR REPLACE FUNCTION public.admin_asesor_ids_matching_buscar(p_q TEXT)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT x), ARRAY[]::UUID[])
  FROM public.profiles p
  CROSS JOIN LATERAL unnest(public.admin_expand_asesor_ids(p.id)) AS x
  WHERE nullif(btrim(coalesce(p_q, '')), '') IS NOT NULL
    AND (
      coalesce(p.full_name, '') ILIKE '%' || btrim(p_q) || '%'
      OR coalesce(p.email, '') ILIKE '%' || btrim(p_q) || '%'
    );
$$;

COMMENT ON FUNCTION public.admin_asesor_ids_matching_buscar(TEXT) IS
  'Admin: perfiles cuyo nombre/email matchean p_q, expandidos con admin_expand_asesor_ids (líder→equipo).';

REVOKE ALL ON FUNCTION public.admin_asesor_ids_matching_buscar(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_asesor_ids_matching_buscar(TEXT) TO authenticated;

-- ===== admin_expedientes_snapshot_etapas =====
CREATE OR REPLACE FUNCTION public.admin_expedientes_snapshot_etapas(p_asesor_id uuid DEFAULT NULL::uuid, p_estado text DEFAULT NULL::text, p_buscar text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
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
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::text ILIKE '%' || v_q || '%'
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
          AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
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
            OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
            OR e.programa::text ILIKE '%' || v_q || '%'
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
        AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
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
          OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
          OR e.programa::text ILIKE '%' || v_q || '%'
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
$function$
;


-- ===== admin_list_expedientes_snapshot_page =====
CREATE OR REPLACE FUNCTION public.admin_list_expedientes_snapshot_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_asesor_id uuid DEFAULT NULL::uuid, p_etapa_actual smallint DEFAULT NULL::smallint, p_estado text DEFAULT NULL::text, p_buscar text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
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
      OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
      OR e.programa::text ILIKE '%' || v_q || '%'
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
      AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
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
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::text ILIKE '%' || v_q || '%'
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
$function$
;


-- ===== admin_list_mesa_envios_page =====
CREATE OR REPLACE FUNCTION public.admin_list_mesa_envios_page(p_from timestamp with time zone, p_to_exclusive timestamp with time zone, p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_asesor_id uuid DEFAULT NULL::uuid, p_etapa_actual smallint DEFAULT NULL::smallint, p_estado text DEFAULT NULL::text, p_buscar text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
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
      OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
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
      AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
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
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
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
$function$
;


-- ===== admin_report_expedientes_asesores_etapas =====
CREATE OR REPLACE FUNCTION public.admin_report_expedientes_asesores_etapas(p_asesor_ids uuid[] DEFAULT NULL::uuid[], p_pasos_visuales smallint[] DEFAULT NULL::smallint[], p_estado text DEFAULT 'vigentes'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_estado TEXT;
  v_pasos SMALLINT[];
  v_etapas SMALLINT[];
  v_paso SMALLINT;
  v_resumen JSONB;
  v_detalle JSONB;
  v_meta JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  SELECT p.organization_id
  INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_report: organización del actor no disponible'
      USING ERRCODE = '22023';
  END IF;

  v_estado := lower(btrim(COALESCE(p_estado, 'vigentes')));
  IF v_estado NOT IN ('vigentes', 'activos', 'rechazados') THEN
    RAISE EXCEPTION 'admin_report: p_estado inválido (vigentes|activos|rechazados)'
      USING ERRCODE = '22023';
  END IF;

  -- Pasos visuales: NULL/{} = todos (1..11)
  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    v_pasos := ARRAY[1,2,3,4,5,6,7,8,9,10,11]::SMALLINT[];
  ELSE
    v_pasos := (
      SELECT array_agg(DISTINCT p ORDER BY p)
      FROM unnest(p_pasos_visuales) AS p
    );
    IF EXISTS (
      SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11
    ) THEN
      RAISE EXCEPTION 'admin_report: p_pasos_visuales debe estar entre 1 y 11'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Expandir pasos → etapas internas (paso 3 → 3,4)
  v_etapas := ARRAY[]::SMALLINT[];
  FOREACH v_paso IN ARRAY v_pasos
  LOOP
    IF v_paso = 3 THEN
      v_etapas := v_etapas || ARRAY[3, 4]::SMALLINT[];
    ELSIF v_paso <= 2 THEN
      v_etapas := v_etapas || ARRAY[v_paso]::SMALLINT[];
    ELSE
      v_etapas := v_etapas || ARRAY[(v_paso + 1)::SMALLINT];
    END IF;
  END LOOP;

  v_etapas := (
    SELECT array_agg(DISTINCT e ORDER BY e)
    FROM unnest(v_etapas) AS e
  );

  WITH base AS (
    SELECT
      e.id AS expediente_id,
      e.asesor_id,
      COALESCE(NULLIF(btrim(pa.full_name), ''), 'Asesor sin nombre registrado') AS asesor_nombre,
      NULLIF(btrim(pa.email), '') AS asesor_email,
      COALESCE(NULLIF(btrim(e.cliente_nombre), ''), '—') AS cliente_nombre,
      COALESCE(e.nss, '') AS nss,
      e.etapa_actual::INT AS etapa_actual,
      CASE
        WHEN e.etapa_actual <= 3 THEN e.etapa_actual::INT
        WHEN e.etapa_actual = 4 THEN 3
        ELSE (e.etapa_actual - 1)::INT
      END AS paso_visual,
      CASE
        WHEN e.subestado = 'rechazado' AND e.ciclo_estado = 'activo' THEN 'rechazado'
        ELSE 'activo'
      END AS estado
    FROM public.expedientes e
    LEFT JOIN public.profiles pa ON pa.id = e.asesor_id
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa IS TRUE
      AND e.ciclo_estado = 'activo'
      AND e.etapa_actual = ANY (v_etapas)
      AND (
        p_asesor_ids IS NULL
        OR cardinality(p_asesor_ids) IS NULL
        OR cardinality(p_asesor_ids) = 0
        OR e.asesor_id = ANY (
          SELECT DISTINCT x
          FROM unnest(p_asesor_ids) AS aid(id),
               LATERAL unnest(public.admin_expand_asesor_ids(aid.id)) AS x
        )
      )
      AND (
        (v_estado = 'vigentes')
        OR (v_estado = 'activos' AND e.subestado IS DISTINCT FROM 'rechazado')
        OR (
          v_estado = 'rechazados'
          AND e.subestado = 'rechazado'
        )
      )
  ),
  named AS (
    SELECT
      b.*,
      CASE b.paso_visual
        WHEN 1 THEN 'Integración'
        WHEN 2 THEN 'Registro'
        WHEN 3 THEN 'Listo para cita de biométrico'
        WHEN 4 THEN 'Biometría (resultado)'
        WHEN 5 THEN 'Inscripción'
        WHEN 6 THEN 'Notificación'
        WHEN 7 THEN 'Acuse / Aviso de retención'
        WHEN 8 THEN 'Listo para agendar firma'
        WHEN 9 THEN 'Cita para firma'
        WHEN 10 THEN 'Firmado'
        WHEN 11 THEN 'Pago a ConCasa'
        ELSE 'Paso ' || b.paso_visual::text
      END AS paso_nombre
    FROM base b
  ),
  resumen_rows AS (
    SELECT
      n.asesor_id,
      n.asesor_nombre,
      n.asesor_email,
      n.paso_visual,
      n.paso_nombre,
      COUNT(*) FILTER (WHERE n.estado = 'activo')::INT AS activos,
      COUNT(*) FILTER (WHERE n.estado = 'rechazado')::INT AS rechazados,
      COUNT(*)::INT AS total
    FROM named n
    GROUP BY n.asesor_id, n.asesor_nombre, n.asesor_email, n.paso_visual, n.paso_nombre
  ),
  detalle_rows AS (
    SELECT
      n.asesor_id,
      n.asesor_nombre,
      n.asesor_email,
      n.cliente_nombre,
      n.nss,
      n.etapa_actual,
      n.paso_visual,
      n.paso_nombre,
      n.estado
    FROM named n
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'asesor_id', r.asesor_id,
            'asesor_nombre', r.asesor_nombre,
            'asesor_email', r.asesor_email,
            'paso_visual', r.paso_visual,
            'paso_nombre', r.paso_nombre,
            'activos', r.activos,
            'rechazados', r.rechazados,
            'total', r.total
          )
          ORDER BY lower(r.asesor_nombre), r.paso_visual
        )
        FROM resumen_rows r
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'asesor_id', d.asesor_id,
            'asesor_nombre', d.asesor_nombre,
            'asesor_email', d.asesor_email,
            'cliente_nombre', d.cliente_nombre,
            'nss', d.nss,
            'etapa_actual', d.etapa_actual,
            'paso_visual', d.paso_visual,
            'paso_nombre', d.paso_nombre,
            'estado', d.estado
          )
          ORDER BY lower(d.asesor_nombre), d.paso_visual, lower(d.cliente_nombre)
        )
        FROM detalle_rows d
      ),
      '[]'::jsonb
    ),
    jsonb_build_object(
      'asesores', (SELECT COUNT(DISTINCT asesor_id)::INT FROM named),
      'pasos', (SELECT COUNT(DISTINCT paso_visual)::INT FROM named),
      'activos', (SELECT COUNT(*) FILTER (WHERE estado = 'activo')::INT FROM named),
      'rechazados', (SELECT COUNT(*) FILTER (WHERE estado = 'rechazado')::INT FROM named),
      'expedientes', (SELECT COUNT(*)::INT FROM named)
    )
  INTO v_resumen, v_detalle, v_meta;

  RETURN jsonb_build_object(
    'resumen', COALESCE(v_resumen, '[]'::jsonb),
    'detalle', COALESCE(v_detalle, '[]'::jsonb),
    'meta', COALESCE(v_meta, jsonb_build_object(
      'asesores', 0, 'pasos', 0, 'activos', 0, 'rechazados', 0, 'expedientes', 0
    ))
  );
END;
$function$
;


-- ===== admin_report_expedientes_asesores_etapas_v2 =====
CREATE OR REPLACE FUNCTION public.admin_report_expedientes_asesores_etapas_v2(p_asesor_ids uuid[] DEFAULT NULL::uuid[], p_pasos_visuales smallint[] DEFAULT NULL::smallint[], p_estado text DEFAULT 'vigentes'::text, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_estado TEXT;
  v_pasos SMALLINT[];
  v_etapas SMALLINT[];
  v_paso SMALLINT;
  v_resumen JSONB;
  v_detalle JSONB;
  v_meta JSONB;
  v_tz TEXT := 'America/Monterrey';
  v_filtro_fecha BOOLEAN;
BEGIN
  v_actor := public.__admin_require_super_admin();

  SELECT p.organization_id
  INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_report: organización del actor no disponible'
      USING ERRCODE = '22023';
  END IF;

  v_estado := lower(btrim(COALESCE(p_estado, 'vigentes')));
  IF v_estado NOT IN ('vigentes', 'activos', 'rechazados') THEN
    RAISE EXCEPTION 'admin_report: p_estado inválido (vigentes|activos|rechazados)'
      USING ERRCODE = '22023';
  END IF;

  IF p_fecha_desde IS NOT NULL AND p_fecha_hasta IS NOT NULL
     AND p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'admin_report: p_fecha_desde no puede ser posterior a p_fecha_hasta'
      USING ERRCODE = '22023';
  END IF;

  v_filtro_fecha := (p_fecha_desde IS NOT NULL OR p_fecha_hasta IS NOT NULL);

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    v_pasos := ARRAY[1,2,3,4,5,6,7,8,9,10,11]::SMALLINT[];
  ELSE
    v_pasos := (
      SELECT array_agg(DISTINCT p ORDER BY p)
      FROM unnest(p_pasos_visuales) AS p
    );
    IF EXISTS (
      SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11
    ) THEN
      RAISE EXCEPTION 'admin_report: p_pasos_visuales debe estar entre 1 y 11'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_etapas := ARRAY[]::SMALLINT[];
  FOREACH v_paso IN ARRAY v_pasos
  LOOP
    IF v_paso = 3 THEN
      v_etapas := v_etapas || ARRAY[3, 4]::SMALLINT[];
    ELSIF v_paso <= 2 THEN
      v_etapas := v_etapas || ARRAY[v_paso]::SMALLINT[];
    ELSE
      v_etapas := v_etapas || ARRAY[(v_paso + 1)::SMALLINT];
    END IF;
  END LOOP;

  v_etapas := (
    SELECT array_agg(DISTINCT e ORDER BY e)
    FROM unnest(v_etapas) AS e
  );

  WITH universe AS (
    SELECT
      e.id AS expediente_id,
      e.asesor_id,
      COALESCE(NULLIF(btrim(pa.full_name), ''), 'Asesor sin nombre registrado') AS asesor_nombre,
      NULLIF(btrim(pa.email), '') AS asesor_email,
      COALESCE(NULLIF(btrim(e.cliente_nombre), ''), '—') AS cliente_nombre,
      COALESCE(e.nss, '') AS nss,
      e.etapa_actual::INT AS etapa_actual,
      public.__map_etapa_interna_a_paso_visual(e.etapa_actual)::INT AS paso_visual,
      CASE
        WHEN e.subestado = 'rechazado' AND e.ciclo_estado = 'activo' THEN 'rechazado'
        ELSE 'activo'
      END AS estado,
      e.fecha_entrada_paso_visual_actual,
      CASE
        WHEN e.fecha_entrada_paso_visual_actual IS NULL THEN NULL
        ELSE (e.fecha_entrada_paso_visual_actual AT TIME ZONE v_tz)::date
      END AS fecha_entrada_paso_ymd
    FROM public.expedientes e
    LEFT JOIN public.profiles pa ON pa.id = e.asesor_id
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa IS TRUE
      AND e.ciclo_estado = 'activo'
      AND e.etapa_actual = ANY (v_etapas)
      AND (
        p_asesor_ids IS NULL
        OR cardinality(p_asesor_ids) IS NULL
        OR cardinality(p_asesor_ids) = 0
        OR e.asesor_id = ANY (
          SELECT DISTINCT x
          FROM unnest(p_asesor_ids) AS aid(id),
               LATERAL unnest(public.admin_expand_asesor_ids(aid.id)) AS x
        )
      )
      AND (
        (v_estado = 'vigentes')
        OR (v_estado = 'activos' AND e.subestado IS DISTINCT FROM 'rechazado')
        OR (
          v_estado = 'rechazados'
          AND e.subestado = 'rechazado'
        )
      )
  ),
  stats AS (
    SELECT
      COUNT(*) FILTER (WHERE fecha_entrada_paso_visual_actual IS NULL)::INT AS sin_fecha
    FROM universe
  ),
  filtered AS (
    SELECT u.*
    FROM universe u
    WHERE
      CASE
        WHEN NOT v_filtro_fecha THEN TRUE
        WHEN u.fecha_entrada_paso_visual_actual IS NULL THEN FALSE
        ELSE
          (p_fecha_desde IS NULL OR u.fecha_entrada_paso_ymd >= p_fecha_desde)
          AND (p_fecha_hasta IS NULL OR u.fecha_entrada_paso_ymd <= p_fecha_hasta)
      END
  ),
  named AS (
    SELECT
      f.*,
      CASE f.paso_visual
        WHEN 1 THEN 'Integración'
        WHEN 2 THEN 'Registro'
        WHEN 3 THEN 'Listo para cita de biométrico'
        WHEN 4 THEN 'Biometría (resultado)'
        WHEN 5 THEN 'Inscripción'
        WHEN 6 THEN 'Notificación'
        WHEN 7 THEN 'Acuse / Aviso de retención'
        WHEN 8 THEN 'Listo para agendar firma'
        WHEN 9 THEN 'Cita para firma'
        WHEN 10 THEN 'Firmado'
        WHEN 11 THEN 'Pago a ConCasa'
        ELSE 'Paso ' || f.paso_visual::text
      END AS paso_nombre
    FROM filtered f
  ),
  resumen_rows AS (
    SELECT
      n.asesor_id,
      n.asesor_nombre,
      n.asesor_email,
      n.paso_visual,
      n.paso_nombre,
      COUNT(*) FILTER (WHERE n.estado = 'activo')::INT AS activos,
      COUNT(*) FILTER (WHERE n.estado = 'rechazado')::INT AS rechazados,
      COUNT(*)::INT AS total
    FROM named n
    GROUP BY n.asesor_id, n.asesor_nombre, n.asesor_email, n.paso_visual, n.paso_nombre
  ),
  detalle_rows AS (
    SELECT
      n.asesor_id,
      n.asesor_nombre,
      n.asesor_email,
      n.cliente_nombre,
      n.nss,
      n.etapa_actual,
      n.paso_visual,
      n.paso_nombre,
      n.estado,
      CASE
        WHEN n.fecha_entrada_paso_ymd IS NULL THEN NULL
        ELSE to_char(n.fecha_entrada_paso_ymd, 'YYYY-MM-DD')
      END AS fecha_entrada_paso_actual
    FROM named n
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'asesor_id', r.asesor_id,
            'asesor_nombre', r.asesor_nombre,
            'asesor_email', r.asesor_email,
            'paso_visual', r.paso_visual,
            'paso_nombre', r.paso_nombre,
            'activos', r.activos,
            'rechazados', r.rechazados,
            'total', r.total
          )
          ORDER BY lower(r.asesor_nombre), r.paso_visual
        )
        FROM resumen_rows r
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'asesor_id', d.asesor_id,
            'asesor_nombre', d.asesor_nombre,
            'asesor_email', d.asesor_email,
            'cliente_nombre', d.cliente_nombre,
            'nss', d.nss,
            'etapa_actual', d.etapa_actual,
            'paso_visual', d.paso_visual,
            'paso_nombre', d.paso_nombre,
            'estado', d.estado,
            'fecha_entrada_paso_actual', d.fecha_entrada_paso_actual
          )
          ORDER BY lower(d.asesor_nombre), d.paso_visual, lower(d.cliente_nombre)
        )
        FROM detalle_rows d
      ),
      '[]'::jsonb
    ),
    jsonb_build_object(
      'asesores', (SELECT COUNT(DISTINCT asesor_id)::INT FROM named),
      'pasos', (SELECT COUNT(DISTINCT paso_visual)::INT FROM named),
      'activos', (SELECT COUNT(*) FILTER (WHERE estado = 'activo')::INT FROM named),
      'rechazados', (SELECT COUNT(*) FILTER (WHERE estado = 'rechazado')::INT FROM named),
      'expedientes', (SELECT COUNT(*)::INT FROM named),
      'sin_fecha_canonica', (SELECT sin_fecha FROM stats),
      'excluidos_por_fecha_desconocida',
        CASE WHEN v_filtro_fecha THEN (SELECT sin_fecha FROM stats) ELSE 0 END
    )
  INTO v_resumen, v_detalle, v_meta;

  RETURN jsonb_build_object(
    'resumen', COALESCE(v_resumen, '[]'::jsonb),
    'detalle', COALESCE(v_detalle, '[]'::jsonb),
    'meta', COALESCE(v_meta, jsonb_build_object(
      'asesores', 0, 'pasos', 0, 'activos', 0, 'rechazados', 0, 'expedientes', 0,
      'sin_fecha_canonica', 0, 'excluidos_por_fecha_desconocida', 0
    ))
  );
END;
$function$
;


-- ===== admin_stage_history_report_summary =====
CREATE OR REPLACE FUNCTION public.admin_stage_history_report_summary(p_asesor_ids uuid[] DEFAULT NULL::uuid[], p_pasos_visuales smallint[] DEFAULT NULL::smallint[], p_movimiento text DEFAULT 'entrada'::text, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date, p_estado_actual text DEFAULT NULL::text, p_buscar text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_pasos SMALLINT[];
  v_mov TEXT;
  v_estado TEXT;
  v_q TEXT;
  v_from TIMESTAMPTZ;
  v_to_excl TIMESTAMPTZ;
  v_coverage TIMESTAMPTZ;
  v_resumen JSONB;
  v_totales JSONB;
  v_nota TEXT;
BEGIN
  v_actor := public.__admin_require_super_admin();

  v_mov := lower(btrim(COALESCE(p_movimiento, 'entrada')));
  IF v_mov NOT IN ('entrada', 'avance', 'estuvieron', 'estado_actual') THEN
    RAISE EXCEPTION 'admin_stage_history: p_movimiento inválido (entrada|avance|estuvieron|estado_actual)'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado_actual, ''))), '');
  IF v_estado IS NOT NULL AND v_estado NOT IN ('activos', 'rechazados', 'cancelados', 'todos') THEN
    RAISE EXCEPTION 'admin_stage_history: p_estado_actual inválido'
      USING ERRCODE = '22023';
  END IF;
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    v_pasos := ARRAY[1,2,3,4,5,6,7,8,9,10,11]::SMALLINT[];
  ELSE
    v_pasos := (
      SELECT array_agg(DISTINCT p ORDER BY p)
      FROM unnest(p_pasos_visuales) AS p
    );
    IF EXISTS (SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11) THEN
      RAISE EXCEPTION 'admin_stage_history: p_pasos_visuales debe estar entre 1 y 11'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  IF v_mov = 'estado_actual' THEN
    SELECT coalesce(min(t.fecha_entrada), NULL) INTO v_coverage
    FROM public.expediente_paso_visual_transiciones t;

    WITH base AS (
      SELECT
        e.id AS expediente_id,
        public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso,
        e.ciclo_estado,
        e.subestado
      FROM public.expedientes e
      LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
        AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
             OR e.asesor_id = ANY (
               SELECT DISTINCT x
               FROM unnest(p_asesor_ids) AS aid(id),
                    LATERAL unnest(public.admin_expand_asesor_ids(aid.id)) AS x
             ))
        AND public.__map_etapa_interna_a_paso_visual(e.etapa_actual) = ANY (v_pasos)
        AND (
          v_estado IS NULL
          OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
        )
        AND (
          v_q IS NULL
          OR e.cliente_nombre ILIKE '%' || v_q || '%'
          OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
          OR e.id::text ILIKE '%' || v_q || '%'
          OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
          OR e.programa::text ILIKE '%' || v_q || '%'
        )
    ),
    por_paso AS (
      SELECT
        s.paso,
        count(b.expediente_id)::BIGINT AS entered_count,
        0::BIGINT AS advanced_count,
        count(b.expediente_id)::BIGINT AS current_count,
        count(b.expediente_id) FILTER (WHERE b.subestado = 'rechazado')::BIGINT AS rejected_count,
        0::BIGINT AS returned_count,
        count(b.expediente_id)::BIGINT AS visitas,
        count(DISTINCT b.expediente_id)::BIGINT AS unicos
      FROM generate_series(1, 11) AS s(paso)
      LEFT JOIN base b ON b.paso = s.paso
      WHERE s.paso = ANY (v_pasos)
      GROUP BY s.paso
    ),
    snap_agg AS (
      SELECT
        coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'paso_visual', p.paso,
              'paso_nombre', CASE p.paso
                WHEN 1 THEN 'Integración'
                WHEN 2 THEN 'Registro'
                WHEN 3 THEN 'Listo para cita de biométrico'
                WHEN 4 THEN 'Biometría (resultado)'
                WHEN 5 THEN 'Inscripción'
                WHEN 6 THEN 'Notificación'
                WHEN 7 THEN 'Acuse / Aviso de retención'
                WHEN 8 THEN 'Listo para agendar firma'
                WHEN 9 THEN 'Cita para firma'
                WHEN 10 THEN 'Firmado'
                WHEN 11 THEN 'Pago a ConCasa'
                ELSE 'Paso ' || p.paso::text
              END,
              'entered_count', p.entered_count,
              'advanced_count', p.advanced_count,
              'current_count', p.current_count,
              'rejected_count', p.rejected_count,
              'returned_count', p.returned_count,
              'visitas', p.visitas,
              'expedientes_unicos', p.unicos,
              'avg_duration_seconds', NULL,
              'median_duration_seconds', NULL,
              'tasa_avance', NULL,
              'tasa_pendiente', CASE WHEN p.entered_count = 0 THEN NULL
                ELSE round((p.current_count::NUMERIC * 1000 / p.entered_count) / 10.0, 1) END
            )
            ORDER BY p.paso
          )
          FROM por_paso p
        ), '[]'::jsonb) AS resumen,
        jsonb_build_object(
          'total_expedientes_unicos', coalesce((SELECT count(DISTINCT expediente_id) FROM base), 0),
          'total_visitas', coalesce((SELECT count(*) FROM base), 0),
          'entered_count', coalesce((SELECT count(*) FROM base), 0),
          'advanced_count', 0,
          'current_count', coalesce((SELECT count(*) FROM base), 0),
          'rejected_count', coalesce((SELECT count(*) FROM base WHERE subestado = 'rechazado'), 0),
          'returned_count', 0,
          'avg_duration_seconds', NULL,
          'median_duration_seconds', NULL
        ) AS totales
    )
    SELECT snap_agg.resumen, snap_agg.totales INTO v_resumen, v_totales FROM snap_agg;

    RETURN jsonb_build_object(
      'totales', v_totales,
      'resumen_por_etapa', coalesce(v_resumen, '[]'::jsonb),
      'generated_at', clock_timestamp(),
      'history_coverage_from', v_coverage,
      'movimiento', v_mov,
      'timezone', 'America/Monterrey',
      'asesor_fuente', 'actual',
      'nota', 'Modo referencia: estado actual (etapa_actual). No es historial de visitas; el rango de fechas no aplica.'
    );
  END IF;

  SELECT * INTO v_from, v_to_excl
  FROM public.__admin_stage_history_bounds(p_fecha_desde, p_fecha_hasta);

  SELECT min(t.fecha_entrada) INTO v_coverage
  FROM public.expediente_paso_visual_transiciones t;

  v_nota := CASE v_mov
    WHEN 'entrada' THEN
      'ENTRARON: entrada a la etapa (fecha_entrada) dentro del periodo. Movimientos = entradas; un expediente con reingreso cuenta varias veces en movimientos.'
    WHEN 'avance' THEN
      'AVANZARON: salidas hacia paso visual posterior con exited_at (= LEAD fecha_entrada) DENTRO del periodo. KPI movimientos = advanced_count del filtro; no usa outcome eventual fuera de rango ni etapa_actual/updated_at. Retrocesos no cuentan.'
    ELSE
      'ESTUVIERON: intersección intervalo_en_etapa ∩ periodo ≠ vacío. Incluye quien entró antes y salió después si hubo solape.'
  END;

  WITH ordered AS (
    SELECT
      t.id AS visita_id,
      t.expediente_id,
      t.paso_visual_nuevo AS paso,
      t.etapa_nueva,
      t.etapa_anterior,
      t.paso_visual_anterior,
      t.fecha_entrada AS entered_at,
      t.actor_user_id,
      lead(t.fecha_entrada) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS exited_at,
      lead(t.paso_visual_nuevo) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_paso,
      lead(t.etapa_nueva) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_etapa
    FROM public.expediente_paso_visual_transiciones t
  ),
  visits AS (
    SELECT
      o.*,
      e.asesor_id,
      e.cliente_nombre,
      e.nss,
      e.programa::text AS programa,
      e.etapa_actual,
      e.subestado,
      e.ciclo_estado,
      e.fecha_envio_mesa,
      public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso_actual,
      CASE
        WHEN o.exited_at IS NULL THEN 'continua'
        WHEN o.next_paso IS NOT NULL AND o.next_paso > o.paso THEN 'avanzo'
        WHEN o.next_paso IS NOT NULL AND o.next_paso < o.paso THEN 'retrocedio'
        ELSE 'salio'
      END AS resultado_flujo,
      EXISTS (
        SELECT 1 FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action = 'expediente.rechazo_operativo'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
      ) AS tuvo_rechazo,
      (e.ciclo_estado = 'cancelado') AS cancelado,
      EXTRACT(EPOCH FROM (
        coalesce(o.exited_at, clock_timestamp()) - o.entered_at
      ))::BIGINT AS duration_seconds,
      -- Métricas calibradas al rango (independientes del filtro de movimiento)
      (o.entered_at >= v_from AND o.entered_at < v_to_excl) AS entered_in_range,
      (o.exited_at IS NOT NULL
        AND o.exited_at >= v_from AND o.exited_at < v_to_excl
        AND o.next_paso IS NOT NULL AND o.next_paso > o.paso) AS advanced_in_range,
      (o.exited_at IS NOT NULL
        AND o.exited_at >= v_from AND o.exited_at < v_to_excl
        AND o.next_paso IS NOT NULL AND o.next_paso < o.paso) AS retreated_in_range,
      (o.exited_at IS NULL OR o.exited_at >= v_to_excl) AS still_at_range_end
    FROM ordered o
    JOIN public.expedientes e ON e.id = o.expediente_id
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND o.paso = ANY (v_pasos)
      AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
           OR e.asesor_id = ANY (
               SELECT DISTINCT x
               FROM unnest(p_asesor_ids) AS aid(id),
                    LATERAL unnest(public.admin_expand_asesor_ids(aid.id)) AS x
             ))
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::text ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
      AND (
        (v_mov = 'entrada' AND o.entered_at >= v_from AND o.entered_at < v_to_excl)
        OR (v_mov = 'avance' AND o.exited_at IS NOT NULL
            AND o.exited_at >= v_from AND o.exited_at < v_to_excl
            AND o.next_paso IS NOT NULL AND o.next_paso > o.paso)
        OR (v_mov = 'estuvieron'
            AND o.entered_at < v_to_excl
            AND (o.exited_at IS NULL OR o.exited_at >= v_from))
      )
  ),
  classified AS (
    SELECT
      v.*,
      CASE
        WHEN v.cancelado THEN 'cancelado'
        WHEN v.tuvo_rechazo OR (v.resultado_flujo = 'continua' AND v.subestado = 'rechazado') THEN 'rechazado'
        WHEN v.resultado_flujo = 'retrocedio' THEN 'retrocedio'
        WHEN v.resultado_flujo = 'avanzo' THEN 'avanzo'
        WHEN v.resultado_flujo = 'continua' THEN 'continua'
        ELSE 'salio'
      END AS resultado
    FROM visits v
  ),
  por_paso AS (
    SELECT
      s.paso,
      count(c.expediente_id)::BIGINT AS visitas,
      count(DISTINCT c.expediente_id)::BIGINT AS unicos,
      -- Calibrado: no usar outcome eventual fuera de rango
      count(c.expediente_id) FILTER (WHERE c.entered_in_range)::BIGINT AS entered_count,
      count(c.expediente_id) FILTER (WHERE c.advanced_in_range)::BIGINT AS advanced_count,
      count(c.expediente_id) FILTER (WHERE c.still_at_range_end)::BIGINT AS current_count,
      count(c.expediente_id) FILTER (
        WHERE c.resultado IN ('rechazado', 'cancelado')
      )::BIGINT AS rejected_count,
      count(c.expediente_id) FILTER (WHERE c.retreated_in_range)::BIGINT AS returned_count,
      avg(c.duration_seconds)::BIGINT AS avg_duration_seconds,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY c.duration_seconds)::BIGINT AS median_duration_seconds
    FROM generate_series(1, 11) AS s(paso)
    LEFT JOIN classified c ON c.paso = s.paso
    WHERE s.paso = ANY (v_pasos)
    GROUP BY s.paso
  ),
  agg AS (
    SELECT
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'paso_visual', p.paso,
            'paso_nombre', CASE p.paso
              WHEN 1 THEN 'Integración'
              WHEN 2 THEN 'Registro'
              WHEN 3 THEN 'Listo para cita de biométrico'
              WHEN 4 THEN 'Biometría (resultado)'
              WHEN 5 THEN 'Inscripción'
              WHEN 6 THEN 'Notificación'
              WHEN 7 THEN 'Acuse / Aviso de retención'
              WHEN 8 THEN 'Listo para agendar firma'
              WHEN 9 THEN 'Cita para firma'
              WHEN 10 THEN 'Firmado'
              WHEN 11 THEN 'Pago a ConCasa'
              ELSE 'Paso ' || p.paso::text
            END,
            'entered_count', coalesce(p.entered_count, 0),
            'advanced_count', coalesce(p.advanced_count, 0),
            'current_count', coalesce(p.current_count, 0),
            'rejected_count', coalesce(p.rejected_count, 0),
            'returned_count', coalesce(p.returned_count, 0),
            'visitas', coalesce(p.visitas, 0),
            'expedientes_unicos', coalesce(p.unicos, 0),
            'avg_duration_seconds', p.avg_duration_seconds,
            'median_duration_seconds', p.median_duration_seconds,
            'tasa_avance', CASE WHEN coalesce(p.visitas, 0) = 0 THEN NULL
              ELSE round((coalesce(p.advanced_count, 0)::NUMERIC * 1000 / NULLIF(p.visitas, 0)) / 10.0, 1) END,
            'tasa_pendiente', CASE WHEN coalesce(p.visitas, 0) = 0 THEN NULL
              ELSE round((coalesce(p.current_count, 0)::NUMERIC * 1000 / NULLIF(p.visitas, 0)) / 10.0, 1) END
          )
          ORDER BY p.paso
        )
        FROM por_paso p
      ), '[]'::jsonb) AS resumen,
      jsonb_build_object(
        'total_expedientes_unicos', coalesce((SELECT count(DISTINCT expediente_id) FROM classified), 0),
        'total_visitas', coalesce((SELECT count(*) FROM classified), 0),
        'entered_count', coalesce((SELECT count(*) FROM classified WHERE entered_in_range), 0),
        'advanced_count', coalesce((SELECT count(*) FROM classified WHERE advanced_in_range), 0),
        'current_count', coalesce((SELECT count(*) FROM classified WHERE still_at_range_end), 0),
        'rejected_count', coalesce((SELECT count(*) FROM classified WHERE resultado IN ('rechazado', 'cancelado')), 0),
        'returned_count', coalesce((SELECT count(*) FROM classified WHERE retreated_in_range), 0),
        'avg_duration_seconds', (SELECT avg(duration_seconds)::BIGINT FROM classified),
        'median_duration_seconds', (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_seconds)::BIGINT FROM classified
        )
      ) AS totales
  )
  SELECT agg.resumen, agg.totales INTO v_resumen, v_totales FROM agg;

  RETURN jsonb_build_object(
    'totales', coalesce(v_totales, '{}'::jsonb),
    'resumen_por_etapa', coalesce(v_resumen, '[]'::jsonb),
    'generated_at', clock_timestamp(),
    'history_coverage_from', v_coverage,
    'movimiento', v_mov,
    'timezone', 'America/Monterrey',
    'asesor_fuente', 'actual',
    'fecha_desde', p_fecha_desde,
    'fecha_hasta', p_fecha_hasta,
    'nota', v_nota || ' Asesor = propietario actual del expediente (no histórico). Cobertura desde history_coverage_from; sin backfill.'
  );
END;
$function$
;


-- ===== admin_stage_history_report_page =====
CREATE OR REPLACE FUNCTION public.admin_stage_history_report_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_asesor_ids uuid[] DEFAULT NULL::uuid[], p_pasos_visuales smallint[] DEFAULT NULL::smallint[], p_movimiento text DEFAULT 'entrada'::text, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date, p_estado_actual text DEFAULT NULL::text, p_buscar text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_pasos SMALLINT[];
  v_mov TEXT;
  v_estado TEXT;
  v_q TEXT;
  v_from TIMESTAMPTZ;
  v_to_excl TIMESTAMPTZ;
  v_page INTEGER;
  v_size INTEGER;
  v_offset INTEGER;
  v_total BIGINT;
  v_items JSONB;
  v_coverage TIMESTAMPTZ;
BEGIN
  v_actor := public.__admin_require_super_admin();

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;

  v_mov := lower(btrim(COALESCE(p_movimiento, 'entrada')));
  IF v_mov NOT IN ('entrada', 'avance', 'estuvieron', 'estado_actual') THEN
    RAISE EXCEPTION 'admin_stage_history: p_movimiento inválido'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado_actual, ''))), '');
  IF v_estado IS NOT NULL AND v_estado NOT IN ('activos', 'rechazados', 'cancelados', 'todos') THEN
    RAISE EXCEPTION 'admin_stage_history: p_estado_actual inválido'
      USING ERRCODE = '22023';
  END IF;
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    v_pasos := ARRAY[1,2,3,4,5,6,7,8,9,10,11]::SMALLINT[];
  ELSE
    v_pasos := (
      SELECT array_agg(DISTINCT p ORDER BY p)
      FROM unnest(p_pasos_visuales) AS p
    );
    IF EXISTS (SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11) THEN
      RAISE EXCEPTION 'admin_stage_history: p_pasos_visuales debe estar entre 1 y 11'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');
  SELECT min(t.fecha_entrada) INTO v_coverage
  FROM public.expediente_paso_visual_transiciones t;

  IF v_mov = 'estado_actual' THEN
    WITH base AS (
      SELECT
        e.id AS visita_id,
        e.id AS expediente_id,
        e.cliente_nombre,
        coalesce(e.nss, '') AS nss,
        e.asesor_id,
        nullif(btrim(pr.full_name), '') AS asesor_nombre,
        'actual'::text AS asesor_fuente,
        e.programa::text AS programa,
        public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso_visual,
        CASE public.__map_etapa_interna_a_paso_visual(e.etapa_actual)
          WHEN 1 THEN 'Integración'
          WHEN 2 THEN 'Registro'
          WHEN 3 THEN 'Listo para cita de biométrico'
          WHEN 4 THEN 'Biometría (resultado)'
          WHEN 5 THEN 'Inscripción'
          WHEN 6 THEN 'Notificación'
          WHEN 7 THEN 'Acuse / Aviso de retención'
          WHEN 8 THEN 'Listo para agendar firma'
          WHEN 9 THEN 'Cita para firma'
          WHEN 10 THEN 'Firmado'
          WHEN 11 THEN 'Pago a ConCasa'
          ELSE 'Paso'
        END AS paso_nombre,
        e.etapa_actual AS etapa_entrada,
        NULL::smallint AS paso_origen,
        NULL::smallint AS etapa_origen,
        e.fecha_entrada_paso_visual_actual AS entered_at,
        NULL::timestamptz AS exited_at,
        e.fecha_entrada_paso_visual_actual AS movimiento_at,
        NULL::bigint AS duration_seconds,
        NULL::bigint AS duration_in_range_seconds,
        true AS still_in_stage_at_range_end,
        'continua'::text AS resultado,
        NULL::smallint AS etapa_siguiente_paso,
        NULL::smallint AS etapa_siguiente,
        e.etapa_actual,
        public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso_actual,
        e.ciclo_estado,
        e.subestado,
        e.fecha_envio_mesa,
        NULL::uuid AS actor_user_id,
        NULL::text AS actor_nombre,
        NULL::text AS motivo
      FROM public.expedientes e
      LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
        AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
             OR e.asesor_id = ANY (
               SELECT DISTINCT x
               FROM unnest(p_asesor_ids) AS aid(id),
                    LATERAL unnest(public.admin_expand_asesor_ids(aid.id)) AS x
             ))
        AND public.__map_etapa_interna_a_paso_visual(e.etapa_actual) = ANY (v_pasos)
        AND (
          v_estado IS NULL
          OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
        )
        AND (
          v_q IS NULL
          OR e.cliente_nombre ILIKE '%' || v_q || '%'
          OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
          OR e.id::text ILIKE '%' || v_q || '%'
          OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
          OR e.programa::text ILIKE '%' || v_q || '%'
        )
    ),
    counted AS (
      SELECT count(*)::BIGINT AS total FROM base
    ),
    page_rows AS (
      SELECT * FROM base
      ORDER BY entered_at DESC NULLS LAST, expediente_id DESC
      OFFSET v_offset LIMIT v_size
    )
    SELECT
      (SELECT total FROM counted),
      coalesce(
        (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.entered_at DESC NULLS LAST, t.expediente_id DESC)
         FROM page_rows t),
        '[]'::jsonb
      )
    INTO v_total, v_items;

    RETURN jsonb_build_object(
      'items', coalesce(v_items, '[]'::jsonb),
      'total', coalesce(v_total, 0),
      'page', v_page,
      'page_size', v_size,
      'history_coverage_from', v_coverage,
      'nss_completo', true,
      'movimiento', v_mov,
      'timezone', 'America/Monterrey',
      'asesor_fuente', 'actual',
      'filters', jsonb_build_object(
        'pasos_visuales', to_jsonb(v_pasos),
        'estado_actual', coalesce(p_estado_actual, 'todos'),
        'buscar', v_q
      )
    );
  END IF;

  SELECT * INTO v_from, v_to_excl
  FROM public.__admin_stage_history_bounds(p_fecha_desde, p_fecha_hasta);

  WITH ordered AS (
    SELECT
      t.id AS visita_id,
      t.expediente_id,
      t.paso_visual_nuevo AS paso,
      t.etapa_nueva,
      t.etapa_anterior,
      t.paso_visual_anterior,
      t.fecha_entrada AS entered_at,
      t.actor_user_id,
      lead(t.fecha_entrada) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS exited_at,
      lead(t.paso_visual_nuevo) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_paso,
      lead(t.etapa_nueva) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_etapa
    FROM public.expediente_paso_visual_transiciones t
  ),
  visits AS (
    SELECT
      o.visita_id,
      o.expediente_id,
      e.cliente_nombre,
      e.nss,
      e.asesor_id,
      nullif(btrim(pr.full_name), '') AS asesor_nombre,
      e.programa::text AS programa,
      o.paso AS paso_consultado,
      o.paso_visual_anterior AS paso_origen,
      o.etapa_anterior AS etapa_origen,
      o.etapa_nueva AS etapa_entrada,
      o.entered_at,
      o.exited_at,
      o.next_paso,
      o.next_etapa,
      e.etapa_actual,
      public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso_actual,
      e.ciclo_estado,
      e.subestado,
      e.fecha_envio_mesa,
      o.actor_user_id,
      nullif(btrim(act.full_name), '') AS actor_nombre,
      EXTRACT(EPOCH FROM (
        coalesce(o.exited_at, clock_timestamp()) - o.entered_at
      ))::BIGINT AS duration_seconds,
      EXTRACT(EPOCH FROM (
        LEAST(coalesce(o.exited_at, clock_timestamp()), v_to_excl)
        - GREATEST(o.entered_at, v_from)
      ))::BIGINT AS duration_in_range_seconds,
      (o.exited_at IS NULL OR o.exited_at >= v_to_excl) AS still_in_stage_at_range_end,
      CASE
        WHEN v_mov = 'avance' THEN o.exited_at
        ELSE o.entered_at
      END AS movimiento_at,
      CASE
        WHEN o.exited_at IS NULL THEN 'continua'
        WHEN o.next_paso IS NOT NULL AND o.next_paso > o.paso THEN 'avanzo'
        WHEN o.next_paso IS NOT NULL AND o.next_paso < o.paso THEN 'retrocedio'
        ELSE 'salio'
      END AS resultado_flujo,
      EXISTS (
        SELECT 1 FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action = 'expediente.rechazo_operativo'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
      ) AS tuvo_rechazo,
      (e.ciclo_estado = 'cancelado') AS cancelado
    FROM ordered o
    JOIN public.expedientes e ON e.id = o.expediente_id
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    LEFT JOIN public.profiles act ON act.id = o.actor_user_id
    WHERE e.deleted_at IS NULL
      AND o.paso = ANY (v_pasos)
      AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
           OR e.asesor_id = ANY (
               SELECT DISTINCT x
               FROM unnest(p_asesor_ids) AS aid(id),
                    LATERAL unnest(public.admin_expand_asesor_ids(aid.id)) AS x
             ))
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::text ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
      AND (
        (v_mov = 'entrada' AND o.entered_at >= v_from AND o.entered_at < v_to_excl)
        OR (v_mov = 'avance' AND o.exited_at IS NOT NULL
            AND o.exited_at >= v_from AND o.exited_at < v_to_excl
            AND o.next_paso IS NOT NULL AND o.next_paso > o.paso)
        OR (v_mov = 'estuvieron'
            AND o.entered_at < v_to_excl
            AND (o.exited_at IS NULL OR o.exited_at >= v_from))
      )
  ),
  classified AS (
    SELECT
      v.*,
      CASE
        WHEN v.cancelado THEN 'cancelado'
        WHEN v.tuvo_rechazo THEN 'rechazado'
        WHEN v.resultado_flujo = 'retrocedio' THEN 'retrocedio'
        WHEN v.resultado_flujo = 'avanzo' THEN 'avanzo'
        WHEN v.resultado_flujo = 'continua' THEN 'continua'
        ELSE 'salio'
      END AS resultado,
      CASE v.paso_consultado
        WHEN 1 THEN 'Integración'
        WHEN 2 THEN 'Registro'
        WHEN 3 THEN 'Listo para cita de biométrico'
        WHEN 4 THEN 'Biometría (resultado)'
        WHEN 5 THEN 'Inscripción'
        WHEN 6 THEN 'Notificación'
        WHEN 7 THEN 'Acuse / Aviso de retención'
        WHEN 8 THEN 'Listo para agendar firma'
        WHEN 9 THEN 'Cita para firma'
        WHEN 10 THEN 'Firmado'
        WHEN 11 THEN 'Pago a ConCasa'
        ELSE 'Paso ' || v.paso_consultado::text
      END AS paso_nombre
    FROM visits v
  ),
  counted AS (
    SELECT count(*)::BIGINT AS total FROM classified
  ),
  page_rows AS (
    SELECT
      c.visita_id,
      c.expediente_id,
      c.cliente_nombre,
      coalesce(c.nss, '') AS nss,
      c.asesor_id,
      c.asesor_nombre,
      'actual'::text AS asesor_fuente,
      c.programa,
      c.paso_consultado AS paso_visual,
      c.paso_nombre,
      c.etapa_entrada,
      c.paso_origen,
      c.etapa_origen,
      c.entered_at,
      c.exited_at,
      c.movimiento_at,
      GREATEST(c.duration_seconds, 0) AS duration_seconds,
      GREATEST(c.duration_in_range_seconds, 0) AS duration_in_range_seconds,
      c.still_in_stage_at_range_end,
      c.resultado,
      c.next_paso AS etapa_siguiente_paso,
      c.next_etapa AS etapa_siguiente,
      c.etapa_actual,
      c.paso_actual,
      c.ciclo_estado,
      c.subestado,
      c.fecha_envio_mesa,
      c.actor_user_id,
      c.actor_nombre,
      NULL::text AS motivo
    FROM classified c
    ORDER BY
      CASE WHEN v_mov = 'avance' THEN c.exited_at ELSE c.entered_at END DESC NULLS LAST,
      c.visita_id DESC
    OFFSET v_offset LIMIT v_size
  )
  SELECT
    (SELECT total FROM counted),
    coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  INTO v_total, v_items
  FROM page_rows x;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_size,
    'history_coverage_from', v_coverage,
      'nss_completo', true,
    'movimiento', v_mov,
    'timezone', 'America/Monterrey',
    'asesor_fuente', 'actual',
    'filters', jsonb_build_object(
      'fecha_desde', p_fecha_desde,
      'fecha_hasta', p_fecha_hasta,
      'pasos_visuales', to_jsonb(v_pasos),
      'estado_actual', coalesce(p_estado_actual, 'todos'),
      'buscar', v_q
    )
  );
END;
$function$
;


-- ===== admin_stage_cohort_outcome_summary =====
CREATE OR REPLACE FUNCTION public.admin_stage_cohort_outcome_summary(p_asesor_ids uuid[] DEFAULT NULL::uuid[], p_pasos_visuales smallint[] DEFAULT NULL::smallint[], p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date, p_estado_actual text DEFAULT NULL::text, p_buscar text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_pasos SMALLINT[];
  v_estado TEXT;
  v_q TEXT;
  v_from TIMESTAMPTZ;
  v_to_excl TIMESTAMPTZ;
  v_coverage TIMESTAMPTZ;
  v_etapas JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_pasos_visuales es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_pasos := (
    SELECT array_agg(DISTINCT p ORDER BY p)
    FROM unnest(p_pasos_visuales) AS p
  );
  IF EXISTS (SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11) THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_pasos_visuales debe estar entre 1 y 11'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado_actual, ''))), '');
  IF v_estado IS NOT NULL AND v_estado NOT IN ('activos', 'rechazados', 'cancelados', 'todos') THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_estado_actual inválido'
      USING ERRCODE = '22023';
  END IF;
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  SELECT * INTO v_from, v_to_excl
  FROM public.__admin_stage_history_bounds(p_fecha_desde, p_fecha_hasta);

  v_coverage := (DATE '2026-07-23'::timestamp AT TIME ZONE 'America/Monterrey');

  WITH ordered AS (
    SELECT
      t.id AS visita_id,
      t.expediente_id,
      t.paso_visual_nuevo AS paso,
      t.etapa_nueva,
      t.fecha_entrada AS entered_at,
      lead(t.fecha_entrada) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS exited_at,
      lead(t.paso_visual_nuevo) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_paso
    FROM public.expediente_paso_visual_transiciones t
  ),
  cohort AS (
    SELECT
      o.*,
      e.asesor_id,
      e.ciclo_estado,
      e.subestado,
      public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso_actual,
      EXISTS (
        SELECT 1 FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action = 'expediente.rechazo_operativo'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
      ) AS tuvo_rechazo,
      EXISTS (
        SELECT 1 FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action ILIKE '%cancel%'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
      ) AS tuvo_cancel,
      EXTRACT(EPOCH FROM (o.exited_at - o.entered_at))::BIGINT AS advance_duration_seconds
    FROM ordered o
    JOIN public.expedientes e ON e.id = o.expediente_id
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND o.paso = ANY (v_pasos)
      AND o.entered_at >= v_from
      AND o.entered_at < v_to_excl
      AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
           OR e.asesor_id = ANY (
               SELECT DISTINCT x
               FROM unnest(p_asesor_ids) AS aid(id),
                    LATERAL unnest(public.admin_expand_asesor_ids(aid.id)) AS x
             ))
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::text ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
  ),
  classified AS (
    SELECT
      c.*,
      CASE
        WHEN c.exited_at IS NOT NULL
             AND c.exited_at < v_to_excl
             AND c.next_paso IS NOT NULL
             AND c.next_paso > c.paso
          THEN 'advanced'
        WHEN c.exited_at IS NULL OR c.exited_at >= v_to_excl
          THEN 'stayed'
        WHEN c.exited_at IS NOT NULL AND c.exited_at < v_to_excl
          THEN 'incident'
        ELSE 'undetermined'
      END AS period_outcome
    FROM cohort c
  ),
  por_paso AS (
    SELECT
      s.paso,
      count(c.visita_id)::BIGINT AS entered_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'advanced')::BIGINT AS advanced_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'stayed')::BIGINT AS stayed_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'incident')::BIGINT AS incident_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'undetermined')::BIGINT AS undetermined_count,
      avg(c.advance_duration_seconds) FILTER (
        WHERE c.period_outcome = 'advanced' AND c.advance_duration_seconds IS NOT NULL
      )::BIGINT AS avg_advance_duration_seconds,
      (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY a.advance_duration_seconds)::BIGINT
        FROM classified a
        WHERE a.paso = s.paso
          AND a.period_outcome = 'advanced'
          AND a.advance_duration_seconds IS NOT NULL
      ) AS median_advance_duration_seconds
    FROM unnest(v_pasos) AS s(paso)
    LEFT JOIN classified c ON c.paso = s.paso
    GROUP BY s.paso
  ),
  por_asesor AS (
    SELECT
      c.paso,
      c.asesor_id,
      coalesce(max(pr.full_name), max(pr.email), 'Asesor sin nombre') AS asesor_nombre,
      max(pr.email) AS asesor_email,
      count(c.visita_id)::BIGINT AS entered_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'advanced')::BIGINT AS advanced_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'stayed')::BIGINT AS stayed_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'incident')::BIGINT AS incident_count,
      count(c.visita_id) FILTER (WHERE c.period_outcome = 'undetermined')::BIGINT AS undetermined_count
    FROM classified c
    LEFT JOIN public.profiles pr ON pr.id = c.asesor_id
    GROUP BY c.paso, c.asesor_id
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'paso_visual', p.paso,
      'etapa_label', CASE p.paso
        WHEN 1 THEN 'Integración'
        WHEN 2 THEN 'Registro'
        WHEN 3 THEN 'Listo para cita de biométrico'
        WHEN 4 THEN 'Biometría (resultado)'
        WHEN 5 THEN 'Inscripción'
        WHEN 6 THEN 'Notificación'
        WHEN 7 THEN 'Acuse / Aviso de retención'
        WHEN 8 THEN 'Listo para agendar firma'
        WHEN 9 THEN 'Cita para firma'
        WHEN 10 THEN 'Firmado'
        WHEN 11 THEN 'Pago a ConCasa'
        ELSE 'Paso ' || p.paso::text
      END,
      'entered_count', coalesce(p.entered_count, 0),
      'advanced_count', coalesce(p.advanced_count, 0),
      'stayed_count', coalesce(p.stayed_count, 0),
      'incident_count', coalesce(p.incident_count, 0),
      'undetermined_count', coalesce(p.undetermined_count, 0),
      'advance_rate', CASE WHEN coalesce(p.entered_count, 0) = 0 THEN NULL
        ELSE round((p.advanced_count::NUMERIC * 1000 / NULLIF(p.entered_count, 0)) / 10.0, 1) END,
      'stayed_rate', CASE WHEN coalesce(p.entered_count, 0) = 0 THEN NULL
        ELSE round((p.stayed_count::NUMERIC * 1000 / NULLIF(p.entered_count, 0)) / 10.0, 1) END,
      'avg_advance_duration_seconds', p.avg_advance_duration_seconds,
      'median_advance_duration_seconds', p.median_advance_duration_seconds,
      'por_asesor', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'asesor_id', pa.asesor_id,
            'asesor_nombre', pa.asesor_nombre,
            'asesor_email', pa.asesor_email,
            'entered_count', pa.entered_count,
            'advanced_count', pa.advanced_count,
            'stayed_count', pa.stayed_count,
            'incident_count', pa.incident_count,
            'undetermined_count', pa.undetermined_count
          )
          ORDER BY pa.asesor_nombre NULLS LAST, pa.asesor_id
        )
        FROM por_asesor pa
        WHERE pa.paso = p.paso
      ), '[]'::jsonb)
    )
    ORDER BY p.paso
  ), '[]'::jsonb)
  INTO v_etapas
  FROM por_paso p;

  RETURN jsonb_build_object(
    'etapas', coalesce(v_etapas, '[]'::jsonb),
    'generated_at', clock_timestamp(),
    'history_coverage_from', v_coverage,
    'fecha_desde', p_fecha_desde,
    'fecha_hasta', p_fecha_hasta,
    'nota', 'Resultados sobre quienes entraron a la etapa durante el periodo seleccionado.'
  );
END;
$function$
;


-- ===== admin_stage_cohort_outcome_page =====
CREATE OR REPLACE FUNCTION public.admin_stage_cohort_outcome_page(p_asesor_ids uuid[] DEFAULT NULL::uuid[], p_pasos_visuales smallint[] DEFAULT NULL::smallint[], p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date, p_estado_actual text DEFAULT NULL::text, p_buscar text DEFAULT NULL::text, p_resultado text DEFAULT 'advanced'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_pasos SMALLINT[];
  v_estado TEXT;
  v_q TEXT;
  v_from TIMESTAMPTZ;
  v_to_excl TIMESTAMPTZ;
  v_coverage TIMESTAMPTZ;
  v_resultado TEXT;
  v_limit INT;
  v_offset INT;
  v_total BIGINT;
  v_items JSONB;
  v_org UUID;
BEGIN
  v_actor := public.__admin_require_super_admin();

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_pasos_visuales es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_pasos := (
    SELECT array_agg(DISTINCT p ORDER BY p)
    FROM unnest(p_pasos_visuales) AS p
  );
  IF EXISTS (SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11) THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_pasos_visuales debe estar entre 1 y 11'
      USING ERRCODE = '22023';
  END IF;

  v_resultado := lower(btrim(COALESCE(p_resultado, 'advanced')));
  IF v_resultado NOT IN ('entered', 'advanced', 'stayed', 'incident', 'undetermined') THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_resultado inválido (entered|advanced|stayed|incident|undetermined)'
      USING ERRCODE = '22023';
  END IF;

  v_estado := NULLIF(lower(btrim(COALESCE(p_estado_actual, ''))), '');
  IF v_estado IS NOT NULL AND v_estado NOT IN ('activos', 'rechazados', 'cancelados', 'todos') THEN
    RAISE EXCEPTION 'admin_stage_cohort: p_estado_actual inválido'
      USING ERRCODE = '22023';
  END IF;
  IF v_estado = 'todos' THEN
    v_estado := NULL;
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  SELECT * INTO v_from, v_to_excl
  FROM public.__admin_stage_history_bounds(p_fecha_desde, p_fecha_hasta);

  v_coverage := (DATE '2026-07-23'::timestamp AT TIME ZONE 'America/Monterrey');

  WITH ordered AS (
    SELECT
      t.id AS visita_id,
      t.expediente_id,
      t.paso_visual_nuevo AS paso,
      t.etapa_nueva AS etapa_entrada,
      t.fecha_entrada AS entered_at,
      t.actor_user_id,
      lead(t.fecha_entrada) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS exited_at,
      lead(t.paso_visual_nuevo) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_paso,
      lead(t.etapa_nueva) OVER (
        PARTITION BY t.expediente_id
        ORDER BY t.fecha_entrada ASC, t.created_at ASC, t.id ASC
      ) AS next_etapa
    FROM public.expediente_paso_visual_transiciones t
  ),
  cohort AS (
    SELECT
      o.*,
      e.asesor_id,
      e.cliente_nombre,
      e.nss,
      e.programa::text AS programa,
      e.etapa_actual,
      e.subestado,
      e.ciclo_estado,
      e.fecha_envio_mesa,
      public.__map_etapa_interna_a_paso_visual(e.etapa_actual) AS paso_actual,
      coalesce(pr.full_name, pr.email) AS asesor_nombre,
      pr.email AS asesor_email,
      EXISTS (
        SELECT 1 FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action = 'expediente.rechazo_operativo'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
      ) AS tuvo_rechazo,
      EXISTS (
        SELECT 1 FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action ILIKE '%cancel%'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
      ) AS tuvo_cancel,
      (
        SELECT nullif(btrim(coalesce(al.payload->>'motivo', al.payload->>'motivo_rechazo', '')), '')
        FROM public.action_log al
        WHERE al.entity_id = o.expediente_id
          AND al.action = 'expediente.rechazo_operativo'
          AND al.created_at >= o.entered_at
          AND (o.exited_at IS NULL OR al.created_at <= o.exited_at)
        ORDER BY al.created_at DESC
        LIMIT 1
      ) AS motivo_rechazo,
      EXTRACT(EPOCH FROM (
        CASE
          WHEN o.exited_at IS NOT NULL AND o.exited_at < v_to_excl THEN o.exited_at - o.entered_at
          ELSE v_to_excl - o.entered_at
        END
      ))::BIGINT AS duration_seconds_period
    FROM ordered o
    JOIN public.expedientes e ON e.id = o.expediente_id
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND o.paso = ANY (v_pasos)
      AND o.entered_at >= v_from
      AND o.entered_at < v_to_excl
      AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
           OR e.asesor_id = ANY (
               SELECT DISTINCT x
               FROM unnest(p_asesor_ids) AS aid(id),
                    LATERAL unnest(public.admin_expand_asesor_ids(aid.id)) AS x
             ))
      AND (
        v_estado IS NULL
        OR (v_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (v_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (v_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(e.nss, '') ILIKE '%' || v_q || '%'
        OR e.id::text ILIKE '%' || v_q || '%'
        OR e.asesor_id = ANY (public.admin_asesor_ids_matching_buscar(v_q))
        OR e.programa::text ILIKE '%' || v_q || '%'
      )
  ),
  classified AS (
    SELECT
      c.*,
      CASE
        WHEN c.exited_at IS NOT NULL
             AND c.exited_at < v_to_excl
             AND c.next_paso IS NOT NULL
             AND c.next_paso > c.paso
          THEN 'advanced'
        WHEN c.exited_at IS NULL OR c.exited_at >= v_to_excl
          THEN 'stayed'
        WHEN c.exited_at IS NOT NULL AND c.exited_at < v_to_excl
          THEN 'incident'
        ELSE 'undetermined'
      END AS period_outcome,
      CASE
        WHEN c.tuvo_cancel OR c.ciclo_estado = 'cancelado' THEN 'cancelado'
        WHEN c.tuvo_rechazo THEN 'rechazado'
        WHEN c.next_paso IS NOT NULL AND c.next_paso < c.paso THEN 'retrocedio'
        WHEN c.next_paso IS NOT NULL AND c.next_paso > c.paso THEN 'avanzo'
        WHEN c.exited_at IS NULL THEN 'continua'
        ELSE 'salio'
      END AS resultado_label,
      CASE
        WHEN c.ciclo_estado = 'cancelado' THEN 'cerrado_inactivo'
        WHEN c.exited_at IS NULL AND c.paso_actual = c.paso THEN 'sigue_en_etapa'
        WHEN c.exited_at IS NULL AND c.paso_actual IS DISTINCT FROM c.paso THEN 'cerrado_inactivo'
        WHEN c.exited_at IS NOT NULL AND c.exited_at >= v_to_excl AND c.next_paso IS NOT NULL AND c.next_paso > c.paso
          THEN 'avanzo_despues'
        WHEN c.exited_at IS NOT NULL AND c.exited_at >= v_to_excl AND c.next_paso IS NOT NULL AND c.next_paso < c.paso
          THEN 'retrocedio_despues'
        WHEN c.exited_at IS NOT NULL AND c.exited_at >= v_to_excl THEN 'salio_despues'
        WHEN c.exited_at IS NOT NULL AND c.exited_at < v_to_excl AND c.next_paso IS NOT NULL AND c.next_paso > c.paso
          THEN 'avanzo_en_periodo'
        WHEN c.exited_at IS NOT NULL AND c.exited_at < v_to_excl THEN 'incidencia_en_periodo'
        ELSE 'no_determinado'
      END AS situacion_actual,
      CASE c.paso
        WHEN 1 THEN 'Integración'
        WHEN 2 THEN 'Registro'
        WHEN 3 THEN 'Listo para cita de biométrico'
        WHEN 4 THEN 'Biometría (resultado)'
        WHEN 5 THEN 'Inscripción'
        WHEN 6 THEN 'Notificación'
        WHEN 7 THEN 'Acuse / Aviso de retención'
        WHEN 8 THEN 'Listo para agendar firma'
        WHEN 9 THEN 'Cita para firma'
        WHEN 10 THEN 'Firmado'
        WHEN 11 THEN 'Pago a ConCasa'
        ELSE 'Paso ' || c.paso::text
      END AS etapa_label,
      CASE c.next_paso
        WHEN 1 THEN 'Integración'
        WHEN 2 THEN 'Registro'
        WHEN 3 THEN 'Listo para cita de biométrico'
        WHEN 4 THEN 'Biometría (resultado)'
        WHEN 5 THEN 'Inscripción'
        WHEN 6 THEN 'Notificación'
        WHEN 7 THEN 'Acuse / Aviso de retención'
        WHEN 8 THEN 'Listo para agendar firma'
        WHEN 9 THEN 'Cita para firma'
        WHEN 10 THEN 'Firmado'
        WHEN 11 THEN 'Pago a ConCasa'
        ELSE CASE WHEN c.next_paso IS NULL THEN NULL ELSE 'Paso ' || c.next_paso::text END
      END AS etapa_siguiente_label
    FROM cohort c
  ),
  filtered AS (
    SELECT * FROM classified x
    WHERE v_resultado = 'entered' OR x.period_outcome = v_resultado
  ),
  counted AS (
    SELECT count(*)::BIGINT AS total FROM filtered
  ),
  page_rows AS (
    SELECT
      f.visita_id,
      f.expediente_id,
      f.cliente_nombre,
      coalesce(f.nss, '') AS nss,
      f.asesor_id,
      f.asesor_nombre,
      f.asesor_email,
      f.programa,
      f.paso AS paso_visual,
      f.etapa_label,
      f.etapa_entrada,
      f.entered_at,
      f.exited_at,
      f.duration_seconds_period AS duration_seconds,
      f.period_outcome,
      f.resultado_label,
      f.next_paso AS etapa_siguiente_paso,
      f.next_etapa AS etapa_siguiente,
      f.etapa_siguiente_label,
      f.etapa_actual,
      f.paso_actual,
      f.situacion_actual,
      f.motivo_rechazo AS motivo,
      f.fecha_envio_mesa
    FROM filtered f
    ORDER BY f.entered_at DESC, f.visita_id DESC
    OFFSET v_offset LIMIT v_limit
  )
  SELECT
    (SELECT total FROM counted),
    coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entered_at DESC, x.visita_id DESC), '[]'::jsonb)
  INTO v_total, v_items
  FROM page_rows x;

  -- Auditoría: acceso a detalle con NSS completo (solo Super Admin llega aquí)
  SELECT organization_id INTO v_org FROM public.profiles WHERE id = v_actor;
  IF v_org IS NOT NULL THEN
    PERFORM public.log_action(
      v_org,
      v_actor,
      'super_admin'::public.app_role,
      'admin.stage_cohort_outcome_detail',
      'admin_report',
      v_actor,
      jsonb_build_object(
        'nss_completo', true,
        'resultado', v_resultado,
        'pasos_visuales', to_jsonb(v_pasos),
        'asesor_ids', to_jsonb(p_asesor_ids),
        'fecha_desde', p_fecha_desde,
        'fecha_hasta', p_fecha_hasta,
        'total', coalesce(v_total, 0),
        'limit', v_limit,
        'offset', v_offset
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total', coalesce(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'resultado', v_resultado,
    'nss_completo', true,
    'history_coverage_from', v_coverage,
    'filters', jsonb_build_object(
      'fecha_desde', p_fecha_desde,
      'fecha_hasta', p_fecha_hasta,
      'pasos_visuales', to_jsonb(v_pasos),
      'estado_actual', coalesce(p_estado_actual, 'todos'),
      'buscar', v_q
    )
  );
END;
$function$
;


