-- ConCasa CRM — Admin snapshot: Integración solo si ya enviado a Mesa
-- Misma definición KPI «Expedientes enviados a Mesa» sin rango de fechas:
--   submitted_to_mesa = TRUE AND fecha_envio_mesa IS NOT NULL
-- Pre-Mesa (etapa 1 sin envío) fuera de tarjetas, total_actual y drilldown.
-- Etapas ≥2: sin filtro adicional. SECURITY DEFINER / grants intactos.

-- =============================================================================
-- admin_expedientes_snapshot_etapas
-- =============================================================================
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

REVOKE ALL ON FUNCTION public.admin_expedientes_snapshot_etapas(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_expedientes_snapshot_etapas(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_expedientes_snapshot_etapas(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_expedientes_snapshot_etapas(UUID, TEXT, TEXT) IS
  'Admin RO: stock vigente por etapa (sin fechas). Integración (1) solo si submitted_to_mesa + fecha_envio_mesa (misma def. KPI sin rango).';

-- =============================================================================
-- admin_list_expedientes_snapshot_page
-- =============================================================================
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

REVOKE ALL ON FUNCTION public.admin_list_expedientes_snapshot_page(INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_expedientes_snapshot_page(INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_expedientes_snapshot_page(INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_list_expedientes_snapshot_page(INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT) IS
  'Admin RO: listado paginado alineado con admin_expedientes_snapshot_etapas (Integración solo enviados a Mesa).';
