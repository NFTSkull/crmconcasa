-- ConCasa CRM — P138: export Excel Ingresos (detalle completo, límite 10k)
-- No altera fórmula, elegibilidad, snapshot 11→12 ni universo P137.

CREATE OR REPLACE FUNCTION public.super_admin_export_ingresos(
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_asesor_ids UUID[] DEFAULT NULL,
  p_monto_fuente TEXT DEFAULT NULL,
  p_porcentajes NUMERIC[] DEFAULT NULL,
  p_stage_scope TEXT DEFAULT 'all_submitted',
  p_visible_step SMALLINT DEFAULT NULL,
  p_estado TEXT DEFAULT 'elegibles',
  p_buscar TEXT DEFAULT NULL,
  p_limit INT DEFAULT 10000
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
  v_tz TEXT := 'America/Monterrey';
  v_estado TEXT;
  v_fuente TEXT;
  v_etapas SMALLINT[];
  v_buscar TEXT;
  v_scope TEXT;
  v_limit INT;
  v_total INT;
  v_actor_nombre TEXT;
  v_org_nombre TEXT;
BEGIN
  v_actor := public.__admin_require_super_admin();
  SELECT p.organization_id, COALESCE(NULLIF(btrim(p.full_name), ''), p.id::text)
    INTO v_org, v_actor_nombre
  FROM public.profiles p WHERE p.id = v_actor;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_ingresos: organización del actor no disponible'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(o.name), ''), v_org::text)
    INTO v_org_nombre
  FROM public.organizations o WHERE o.id = v_org;

  IF p_fecha_desde IS NOT NULL AND p_fecha_hasta IS NOT NULL AND p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'admin_ingresos: fecha_desde no puede ser mayor que fecha_hasta'
      USING ERRCODE = '22023';
  END IF;

  v_estado := lower(btrim(COALESCE(p_estado, 'elegibles')));
  IF v_estado NOT IN ('elegibles', 'pendientes', 'pagados') THEN
    RAISE EXCEPTION 'admin_ingresos: p_estado inválido (elegibles|pendientes|pagados)'
      USING ERRCODE = '22023';
  END IF;

  v_fuente := NULLIF(lower(btrim(COALESCE(p_monto_fuente, ''))), '');
  IF v_fuente IS NOT NULL AND v_fuente NOT IN ('mesa_actualizado', 'datos_generales') THEN
    RAISE EXCEPTION 'admin_ingresos: p_monto_fuente inválido'
      USING ERRCODE = '22023';
  END IF;

  v_buscar := NULLIF(btrim(COALESCE(p_buscar, '')), '');
  v_scope := lower(btrim(COALESCE(p_stage_scope, 'all_submitted')));
  v_etapas := public.ingresos_resolve_etapas_filtro(v_scope, p_visible_step);
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 10000), 1), 10000);

  WITH filtered AS (
    SELECT
      u.*,
      public.__map_etapa_interna_a_paso_visual(u.etapa_actual::INT) AS paso_visual,
      e.programa::text AS programa
    FROM public.__ingresos_universe_rows(v_org) u
    JOIN public.expedientes e ON e.id = u.expediente_id
    WHERE u.ciclo_estado IS DISTINCT FROM 'cancelado'
      AND u.subestado IS DISTINCT FROM 'rechazado'
      AND u.ingreso_proyectado IS NOT NULL
      AND u.ingreso_proyectado > 0
      AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
           OR u.asesor_id = ANY (p_asesor_ids))
      AND u.etapa_actual = ANY (v_etapas)
      AND (v_fuente IS NULL OR u.monto_fuente = v_fuente)
      AND (p_porcentajes IS NULL OR cardinality(p_porcentajes) IS NULL OR cardinality(p_porcentajes) = 0
           OR u.porcentaje_cobro = ANY (p_porcentajes))
      AND (
        v_buscar IS NULL
        OR u.cliente_nombre ILIKE '%' || v_buscar || '%'
        OR COALESCE(u.nss, '') ILIKE '%' || v_buscar || '%'
      )
      AND (
        p_fecha_desde IS NULL
        OR (u.fecha_envio_mesa AT TIME ZONE v_tz)::date >= p_fecha_desde
      )
      AND (
        p_fecha_hasta IS NULL
        OR (u.fecha_envio_mesa AT TIME ZONE v_tz)::date <= p_fecha_hasta
      )
      AND (
        v_estado = 'elegibles'
        OR (v_estado = 'pendientes' AND u.ingreso_real IS NULL)
        OR (v_estado = 'pagados' AND u.ingreso_real IS NOT NULL)
      )
  )
  SELECT COUNT(*)::INT INTO v_total FROM filtered;

  IF v_total > v_limit THEN
    RAISE EXCEPTION 'admin_ingresos: export_limit_exceeded'
      USING ERRCODE = 'P0001',
            DETAIL = format('total=%s limit=%s', v_total, v_limit);
  END IF;

  RETURN (
    WITH filtered AS (
      SELECT
        u.*,
        public.__map_etapa_interna_a_paso_visual(u.etapa_actual::INT) AS paso_visual,
        e.programa::text AS programa
      FROM public.__ingresos_universe_rows(v_org) u
      JOIN public.expedientes e ON e.id = u.expediente_id
      WHERE u.ciclo_estado IS DISTINCT FROM 'cancelado'
        AND u.subestado IS DISTINCT FROM 'rechazado'
        AND u.ingreso_proyectado IS NOT NULL
        AND u.ingreso_proyectado > 0
        AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
             OR u.asesor_id = ANY (p_asesor_ids))
        AND u.etapa_actual = ANY (v_etapas)
        AND (v_fuente IS NULL OR u.monto_fuente = v_fuente)
        AND (p_porcentajes IS NULL OR cardinality(p_porcentajes) IS NULL OR cardinality(p_porcentajes) = 0
             OR u.porcentaje_cobro = ANY (p_porcentajes))
        AND (
          v_buscar IS NULL
          OR u.cliente_nombre ILIKE '%' || v_buscar || '%'
          OR COALESCE(u.nss, '') ILIKE '%' || v_buscar || '%'
        )
        AND (
          p_fecha_desde IS NULL
          OR (u.fecha_envio_mesa AT TIME ZONE v_tz)::date >= p_fecha_desde
        )
        AND (
          p_fecha_hasta IS NULL
          OR (u.fecha_envio_mesa AT TIME ZONE v_tz)::date <= p_fecha_hasta
        )
        AND (
          v_estado = 'elegibles'
          OR (v_estado = 'pendientes' AND u.ingreso_real IS NULL)
          OR (v_estado = 'pagados' AND u.ingreso_real IS NOT NULL)
        )
    )
    SELECT jsonb_build_object(
      'total', v_total,
      'limit', v_limit,
      'timezone', v_tz,
      'generated_at', now(),
      'actor_nombre', v_actor_nombre,
      'organization_nombre', COALESCE(v_org_nombre, v_org::text),
      'organization_id', v_org,
      'items', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'expediente_id', f.expediente_id,
              'cliente_nombre', f.cliente_nombre,
              'nss', f.nss,
              'asesor_id', f.asesor_id,
              'asesor_nombre', f.asesor_nombre,
              'programa', f.programa,
              'etapa_actual', f.etapa_actual,
              'paso_visual', f.paso_visual,
              'subestado', f.subestado,
              'ciclo_estado', f.ciclo_estado,
              'fecha_envio_mesa', f.fecha_envio_mesa,
              'bio_aprobacion_at', f.bio_aprobacion_at,
              'pago_concasa_at', f.reconocido_at,
              'monto_general', f.monto_general,
              'monto_actualizado', f.monto_actualizado,
              'monto_base', f.monto_base,
              'monto_fuente', f.monto_fuente,
              'porcentaje_cobro', f.porcentaje_cobro,
              'ingreso_proyectado', f.ingreso_proyectado,
              'ingreso_real', f.ingreso_real,
              'pendiente', GREATEST(
                COALESCE(f.ingreso_proyectado, 0) - COALESCE(f.ingreso_real, 0),
                0
              ),
              'is_historical_estimate', f.is_historical_estimate
            )
            ORDER BY
              f.asesor_nombre NULLS LAST,
              f.paso_visual NULLS LAST,
              f.fecha_envio_mesa NULLS LAST,
              f.cliente_nombre NULLS LAST,
              f.expediente_id
          )
          FROM filtered f
        ),
        '[]'::jsonb
      )
    )
  );
END;
$$;

COMMENT ON FUNCTION public.super_admin_export_ingresos(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT, INT) IS
  'P138: export detalle Ingresos (mismos filtros que list/resumen). Límite 10000. Solo super_admin.';

REVOKE ALL ON FUNCTION public.super_admin_export_ingresos(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_export_ingresos(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_export_ingresos(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT, INT)
  TO authenticated, service_role, postgres;
