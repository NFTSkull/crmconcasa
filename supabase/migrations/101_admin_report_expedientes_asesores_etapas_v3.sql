-- ConCasa CRM — P116: reporte Admin v3 con tipo de fecha (envio_mesa | entrada_paso_actual)
-- No modifica admin_report_expedientes_asesores_etapas (P112) ni …_v2 (P114).

CREATE OR REPLACE FUNCTION public.admin_report_expedientes_asesores_etapas_v3(
  p_asesor_ids UUID[] DEFAULT NULL,
  p_pasos_visuales SMALLINT[] DEFAULT NULL,
  p_estado TEXT DEFAULT 'vigentes',
  p_tipo_fecha TEXT DEFAULT 'envio_mesa',
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_estado TEXT;
  v_tipo TEXT;
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

  v_tipo := lower(btrim(COALESCE(p_tipo_fecha, 'envio_mesa')));
  IF v_tipo NOT IN ('envio_mesa', 'entrada_paso_actual') THEN
    RAISE EXCEPTION 'admin_report: p_tipo_fecha inválido (envio_mesa|entrada_paso_actual)'
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
      e.fecha_envio_mesa,
      e.fecha_entrada_paso_visual_actual,
      CASE
        WHEN e.fecha_envio_mesa IS NULL THEN NULL
        ELSE (e.fecha_envio_mesa AT TIME ZONE v_tz)::date
      END AS fecha_envio_mesa_ymd,
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
        OR e.asesor_id = ANY (p_asesor_ids)
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
      COUNT(*) FILTER (
        WHERE CASE
          WHEN v_tipo = 'envio_mesa' THEN fecha_envio_mesa IS NULL
          ELSE fecha_entrada_paso_visual_actual IS NULL
        END
      )::INT AS sin_fecha
    FROM universe
  ),
  filtered AS (
    SELECT u.*
    FROM universe u
    WHERE
      CASE
        WHEN NOT v_filtro_fecha THEN TRUE
        WHEN v_tipo = 'envio_mesa' THEN
          CASE
            WHEN u.fecha_envio_mesa IS NULL THEN FALSE
            ELSE
              (p_fecha_desde IS NULL OR u.fecha_envio_mesa_ymd >= p_fecha_desde)
              AND (p_fecha_hasta IS NULL OR u.fecha_envio_mesa_ymd <= p_fecha_hasta)
          END
        ELSE
          CASE
            WHEN u.fecha_entrada_paso_visual_actual IS NULL THEN FALSE
            ELSE
              (p_fecha_desde IS NULL OR u.fecha_entrada_paso_ymd >= p_fecha_desde)
              AND (p_fecha_hasta IS NULL OR u.fecha_entrada_paso_ymd <= p_fecha_hasta)
          END
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
      END AS fecha_entrada_paso_actual,
      CASE
        WHEN n.fecha_envio_mesa_ymd IS NULL THEN NULL
        ELSE to_char(n.fecha_envio_mesa_ymd, 'YYYY-MM-DD')
      END AS fecha_envio_mesa
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
            'fecha_entrada_paso_actual', d.fecha_entrada_paso_actual,
            'fecha_envio_mesa', d.fecha_envio_mesa
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
      'tipo_fecha', v_tipo,
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
      'tipo_fecha', v_tipo,
      'sin_fecha_canonica', 0, 'excluidos_por_fecha_desconocida', 0
    ))
  );
END;
$$;

COMMENT ON FUNCTION public.admin_report_expedientes_asesores_etapas_v3(UUID[], SMALLINT[], TEXT, TEXT, DATE, DATE) IS
  'P116: reporte Super Admin v3 — tipo fecha envio_mesa (default) o entrada_paso_actual; fechas America/Monterrey. P112/P114 intactas.';

REVOKE ALL ON FUNCTION public.admin_report_expedientes_asesores_etapas_v3(UUID[], SMALLINT[], TEXT, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_report_expedientes_asesores_etapas_v3(UUID[], SMALLINT[], TEXT, TEXT, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_report_expedientes_asesores_etapas_v3(UUID[], SMALLINT[], TEXT, TEXT, DATE, DATE) TO authenticated;
