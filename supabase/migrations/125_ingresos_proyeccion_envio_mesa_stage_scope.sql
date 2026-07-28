-- ConCasa CRM — P137: Ingresos proyectados por envío a Mesa + alcance de etapa
-- Universo: submitted_to_mesa + fecha_envio_mesa (sin gate biométrico).
-- Conserva ingresos_bio_aprobacion_at (info/auditoría). Snapshot 11→12 intacto.

-- =============================================================================
-- A) Helpers de etapa visible → internas
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ingresos_etapas_internas_from_paso_visual(p_paso SMALLINT)
RETURNS SMALLINT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_paso
    WHEN 1 THEN ARRAY[1]::SMALLINT[]
    WHEN 2 THEN ARRAY[2]::SMALLINT[]
    WHEN 3 THEN ARRAY[3, 4]::SMALLINT[]
    WHEN 4 THEN ARRAY[5]::SMALLINT[]
    WHEN 5 THEN ARRAY[6]::SMALLINT[]
    WHEN 6 THEN ARRAY[7]::SMALLINT[]
    WHEN 7 THEN ARRAY[8]::SMALLINT[]
    WHEN 8 THEN ARRAY[9]::SMALLINT[]
    WHEN 9 THEN ARRAY[10]::SMALLINT[]
    WHEN 10 THEN ARRAY[11]::SMALLINT[]
    WHEN 11 THEN ARRAY[12]::SMALLINT[]
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.ingresos_etapas_internas_from_paso_visual(SMALLINT) IS
  'P137: mapeo canónico paso visible 1–11 → etapas internas.';

REVOKE ALL ON FUNCTION public.ingresos_etapas_internas_from_paso_visual(SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingresos_etapas_internas_from_paso_visual(SMALLINT)
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.ingresos_resolve_etapas_filtro(
  p_stage_scope TEXT,
  p_visible_step SMALLINT
)
RETURNS SMALLINT[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_scope TEXT;
  v_etapas SMALLINT[] := ARRAY[]::SMALLINT[];
  v_paso SMALLINT;
  v_part SMALLINT[];
BEGIN
  v_scope := lower(btrim(COALESCE(p_stage_scope, 'all_submitted')));
  IF v_scope NOT IN ('all_submitted', 'from_step', 'exact_step') THEN
    RAISE EXCEPTION 'admin_ingresos: p_stage_scope inválido (all_submitted|from_step|exact_step)'
      USING ERRCODE = '22023';
  END IF;

  IF v_scope = 'all_submitted' THEN
    IF p_visible_step IS NOT NULL THEN
      RAISE EXCEPTION 'admin_ingresos: all_submitted exige p_visible_step NULL'
        USING ERRCODE = '22023';
    END IF;
    RETURN ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::SMALLINT[];
  END IF;

  IF p_visible_step IS NULL OR p_visible_step < 1 OR p_visible_step > 11 THEN
    RAISE EXCEPTION 'admin_ingresos: p_visible_step debe estar entre 1 y 11'
      USING ERRCODE = '22023';
  END IF;

  IF v_scope = 'exact_step' THEN
    RETURN public.ingresos_etapas_internas_from_paso_visual(p_visible_step);
  END IF;

  -- from_step: paso mínimo inclusivo hasta 11
  FOR v_paso IN p_visible_step..11 LOOP
    v_part := public.ingresos_etapas_internas_from_paso_visual(v_paso::SMALLINT);
    IF v_part IS NOT NULL THEN
      v_etapas := v_etapas || v_part;
    END IF;
  END LOOP;

  RETURN (
    SELECT array_agg(DISTINCT e ORDER BY e)
    FROM unnest(v_etapas) AS e
  );
END;
$$;

COMMENT ON FUNCTION public.ingresos_resolve_etapas_filtro(TEXT, SMALLINT) IS
  'P137: resuelve etapas internas según alcance all_submitted|from_step|exact_step.';

REVOKE ALL ON FUNCTION public.ingresos_resolve_etapas_filtro(TEXT, SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingresos_resolve_etapas_filtro(TEXT, SMALLINT)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- B) Universo: enviados a Mesa (sin gate bio)
-- =============================================================================
DROP FUNCTION IF EXISTS public.__ingresos_universe_rows(UUID);

CREATE OR REPLACE FUNCTION public.__ingresos_universe_rows(p_org UUID)
RETURNS TABLE (
  expediente_id UUID,
  organization_id UUID,
  asesor_id UUID,
  cliente_nombre TEXT,
  nss TEXT,
  asesor_nombre TEXT,
  etapa_actual SMALLINT,
  subestado TEXT,
  ciclo_estado TEXT,
  fecha_envio_mesa TIMESTAMPTZ,
  bio_aprobacion_at TIMESTAMPTZ,
  monto_general NUMERIC,
  monto_actualizado NUMERIC,
  monto_base NUMERIC,
  monto_fuente TEXT,
  porcentaje_cobro NUMERIC,
  ingreso_proyectado NUMERIC,
  ingreso_real NUMERIC,
  reconocido_at TIMESTAMPTZ,
  is_historical_estimate BOOLEAN,
  incompleto_reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id AS expediente_id,
    e.organization_id,
    e.asesor_id,
    e.cliente_nombre,
    e.nss,
    COALESCE(NULLIF(btrim(p.full_name), ''), e.asesor_id::text) AS asesor_nombre,
    e.etapa_actual::SMALLINT,
    e.subestado::text,
    e.ciclo_estado::text,
    e.fecha_envio_mesa,
    public.ingresos_bio_aprobacion_at(e.id) AS bio_aprobacion_at,
    public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) AS monto_general,
    cd.monto_mejoravit_actualizado AS monto_actualizado,
    CASE
      WHEN cd.monto_mejoravit_actualizado IS NOT NULL AND cd.monto_mejoravit_actualizado > 0
        THEN round(cd.monto_mejoravit_actualizado, 2)
      WHEN public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) IS NOT NULL
        AND public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) > 0
        THEN round(public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)), 2)
      ELSE NULL
    END AS monto_base,
    CASE
      WHEN cd.monto_mejoravit_actualizado IS NOT NULL AND cd.monto_mejoravit_actualizado > 0
        THEN 'mesa_actualizado'
      WHEN public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) IS NOT NULL
        AND public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) > 0
        THEN 'datos_generales'
      ELSE NULL
    END AS monto_fuente,
    cd.porcentaje_cobro,
    public.ingresos_calc_ingreso(
      CASE
        WHEN cd.monto_mejoravit_actualizado IS NOT NULL AND cd.monto_mejoravit_actualizado > 0
          THEN cd.monto_mejoravit_actualizado
        ELSE public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB))
      END,
      cd.porcentaje_cobro
    ) AS ingreso_proyectado,
    r.ingreso_real,
    r.reconocido_at,
    COALESCE(r.is_historical_estimate, false) AS is_historical_estimate,
    CASE
      WHEN cd.porcentaje_cobro IS NULL OR cd.porcentaje_cobro <= 0 THEN
        CASE
          WHEN (cd.monto_mejoravit_actualizado IS NULL OR cd.monto_mejoravit_actualizado <= 0)
           AND (
             public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) IS NULL
             OR public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) <= 0
           )
          THEN 'sin_ambos'
          ELSE 'sin_porcentaje'
        END
      WHEN (cd.monto_mejoravit_actualizado IS NULL OR cd.monto_mejoravit_actualizado <= 0)
       AND (
         public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) IS NULL
         OR public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) <= 0
       )
      THEN 'sin_monto'
      ELSE NULL
    END AS incompleto_reason
  FROM public.expedientes e
  LEFT JOIN public.cliente_datos cd ON cd.expediente_id = e.id
  LEFT JOIN public.expediente_ingresos_reconocidos r ON r.expediente_id = e.id
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.organization_id = p_org
    AND e.deleted_at IS NULL
    AND e.submitted_to_mesa IS TRUE
    AND e.fecha_envio_mesa IS NOT NULL;
$$;

COMMENT ON FUNCTION public.__ingresos_universe_rows(UUID) IS
  'P137: universo Ingresos = enviados a Mesa con fecha_envio_mesa. Bio opcional (no gate).';

REVOKE ALL ON FUNCTION public.__ingresos_universe_rows(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.__ingresos_universe_rows(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.__ingresos_universe_rows(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.__ingresos_universe_rows(UUID)
  TO service_role, postgres;

-- =============================================================================
-- C) DROP firmas antiguas (p_pasos_visuales) y recrear con stage_scope
-- =============================================================================
DROP FUNCTION IF EXISTS public.super_admin_get_ingresos_resumen(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT);
DROP FUNCTION IF EXISTS public.super_admin_list_ingresos_page(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.super_admin_get_ingresos_resumen(
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_asesor_ids UUID[] DEFAULT NULL,
  p_monto_fuente TEXT DEFAULT NULL,
  p_porcentajes NUMERIC[] DEFAULT NULL,
  p_stage_scope TEXT DEFAULT 'all_submitted',
  p_visible_step SMALLINT DEFAULT NULL,
  p_estado TEXT DEFAULT 'elegibles',
  p_buscar TEXT DEFAULT NULL
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
BEGIN
  v_actor := public.__admin_require_super_admin();
  SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id = v_actor;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_ingresos: organización del actor no disponible'
      USING ERRCODE = '22023';
  END IF;

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

  RETURN (
    WITH universe AS (
      SELECT u.*
      FROM public.__ingresos_universe_rows(v_org) u
      WHERE u.ciclo_estado IS DISTINCT FROM 'cancelado'
        AND u.subestado IS DISTINCT FROM 'rechazado'
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
    ),
    proyectados AS (
      SELECT *
      FROM universe u
      WHERE u.ingreso_proyectado IS NOT NULL
        AND u.ingreso_proyectado > 0
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
    ),
    reales AS (
      SELECT *
      FROM universe u
      WHERE u.ingreso_real IS NOT NULL
        AND (
          p_fecha_desde IS NULL
          OR (u.reconocido_at AT TIME ZONE v_tz)::date >= p_fecha_desde
        )
        AND (
          p_fecha_hasta IS NULL
          OR (u.reconocido_at AT TIME ZONE v_tz)::date <= p_fecha_hasta
        )
        AND (
          v_estado = 'elegibles'
          OR v_estado = 'pagados'
          OR (v_estado = 'pendientes' AND false)
        )
    ),
    incompletos AS (
      SELECT *
      FROM universe u
      WHERE u.incompleto_reason IS NOT NULL
        AND (
          p_fecha_desde IS NULL
          OR (u.fecha_envio_mesa AT TIME ZONE v_tz)::date >= p_fecha_desde
        )
        AND (
          p_fecha_hasta IS NULL
          OR (u.fecha_envio_mesa AT TIME ZONE v_tz)::date <= p_fecha_hasta
        )
    ),
    agg_proj AS (
      SELECT
        COALESCE(SUM(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ingreso_proyectado,
        COUNT(*)::INT AS expedientes_proyectados,
        COALESCE(AVG(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ticket_promedio_proyectado,
        COUNT(*) FILTER (WHERE p.ingreso_real IS NULL)::INT AS expedientes_pendientes
      FROM proyectados p
    ),
    agg_real AS (
      SELECT
        COALESCE(SUM(r.ingreso_real), 0)::NUMERIC(14,2) AS ingreso_real,
        COUNT(*)::INT AS expedientes_pagados,
        COALESCE(AVG(r.ingreso_real), 0)::NUMERIC(14,2) AS ticket_promedio_real
      FROM reales r
    ),
    por_asesor AS (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.ingreso_proyectado DESC), '[]'::jsonb)
      FROM (
        SELECT
          p.asesor_id,
          MAX(p.asesor_nombre) AS asesor_nombre,
          COUNT(*)::INT AS expedientes,
          COALESCE(SUM(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ingreso_proyectado,
          COALESCE(SUM(p.ingreso_real), 0)::NUMERIC(14,2) AS ingreso_real,
          GREATEST(
            COALESCE(SUM(p.ingreso_proyectado), 0) - COALESCE(SUM(p.ingreso_real), 0),
            0
          )::NUMERIC(14,2) AS pendiente,
          CASE
            WHEN COALESCE(SUM(p.ingreso_proyectado), 0) = 0 THEN 0
            ELSE round(
              COALESCE(SUM(p.ingreso_real), 0) * 100 / SUM(p.ingreso_proyectado),
              2
            )
          END AS cumplimiento_pct
        FROM proyectados p
        GROUP BY p.asesor_id
      ) x
    ),
    por_pct AS (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.porcentaje_cobro), '[]'::jsonb)
      FROM (
        SELECT
          p.porcentaje_cobro,
          COUNT(*)::INT AS expedientes,
          COALESCE(SUM(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ingreso_proyectado,
          COALESCE(SUM(p.ingreso_real), 0)::NUMERIC(14,2) AS ingreso_real
        FROM proyectados p
        GROUP BY p.porcentaje_cobro
      ) x
    ),
    por_fuente AS (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.monto_fuente), '[]'::jsonb)
      FROM (
        SELECT
          p.monto_fuente,
          COUNT(*)::INT AS expedientes,
          COALESCE(SUM(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ingreso_proyectado,
          COALESCE(SUM(p.ingreso_real), 0)::NUMERIC(14,2) AS ingreso_real
        FROM proyectados p
        WHERE p.monto_fuente IS NOT NULL
        GROUP BY p.monto_fuente
      ) x
    ),
    por_paso AS (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.paso_visual), '[]'::jsonb)
      FROM (
        SELECT
          public.__map_etapa_interna_a_paso_visual(p.etapa_actual::INT) AS paso_visual,
          COUNT(*)::INT AS expedientes,
          COALESCE(SUM(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ingreso_proyectado
        FROM proyectados p
        GROUP BY 1
      ) x
    ),
    tendencia AS (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.fecha), '[]'::jsonb)
      FROM (
        SELECT
          d.fecha,
          COALESCE(SUM(d.proyectado), 0)::NUMERIC(14,2) AS proyectado,
          COALESCE(SUM(d.real), 0)::NUMERIC(14,2) AS real
        FROM (
          SELECT
            (p.fecha_envio_mesa AT TIME ZONE v_tz)::date AS fecha,
            p.ingreso_proyectado AS proyectado,
            0::NUMERIC AS real
          FROM proyectados p
          UNION ALL
          SELECT
            (r.reconocido_at AT TIME ZONE v_tz)::date AS fecha,
            0::NUMERIC AS proyectado,
            r.ingreso_real AS real
          FROM reales r
        ) d
        GROUP BY d.fecha
      ) x
    ),
    sin_datos AS (
      SELECT jsonb_build_object(
        'total', COUNT(*)::INT,
        'sin_porcentaje', COUNT(*) FILTER (WHERE i.incompleto_reason = 'sin_porcentaje')::INT,
        'sin_monto', COUNT(*) FILTER (WHERE i.incompleto_reason = 'sin_monto')::INT,
        'sin_ambos', COUNT(*) FILTER (WHERE i.incompleto_reason = 'sin_ambos')::INT,
        'items', COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'expediente_id', i.expediente_id,
              'cliente_nombre', i.cliente_nombre,
              'nss', i.nss,
              'reason', i.incompleto_reason
            )
            ORDER BY i.cliente_nombre
          ) FILTER (WHERE true),
          '[]'::jsonb
        )
      )
      FROM incompletos i
    )
    SELECT jsonb_build_object(
      'ingreso_proyectado', ap.ingreso_proyectado,
      'ingreso_real', ar.ingreso_real,
      'pendiente_por_cobrar', GREATEST(ap.ingreso_proyectado - ar.ingreso_real, 0)::NUMERIC(14,2),
      'cumplimiento_pct', CASE
        WHEN ap.ingreso_proyectado = 0 THEN 0
        ELSE round(ar.ingreso_real * 100 / ap.ingreso_proyectado, 2)
      END,
      'expedientes_proyectados', ap.expedientes_proyectados,
      'expedientes_pagados', ar.expedientes_pagados,
      'expedientes_pendientes', ap.expedientes_pendientes,
      'ticket_promedio_proyectado', ap.ticket_promedio_proyectado,
      'ticket_promedio_real', ar.ticket_promedio_real,
      'sin_datos_cobro', (SELECT * FROM sin_datos),
      'por_asesor', (SELECT * FROM por_asesor),
      'por_porcentaje', (SELECT * FROM por_pct),
      'por_fuente_monto', (SELECT * FROM por_fuente),
      'por_paso_visual', (SELECT * FROM por_paso),
      'tendencia', (SELECT * FROM tendencia),
      'meta', jsonb_build_object(
        'organization_id', v_org,
        'fecha_desde', p_fecha_desde,
        'fecha_hasta', p_fecha_hasta,
        'timezone', v_tz,
        'estado', v_estado,
        'stage_scope', v_scope,
        'visible_step', p_visible_step,
        'nota',
          'La proyección se agrupa por fecha de envío a Mesa. El ingreso real se agrupa por la fecha de Pago a ConCasa.'
      )
    )
    FROM agg_proj ap, agg_real ar
  );
END;
$$;

COMMENT ON FUNCTION public.super_admin_get_ingresos_resumen(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT) IS
  'P137: resumen ingresos Super Admin. Proyección por fecha_envio_mesa + stage_scope.';

REVOKE ALL ON FUNCTION public.super_admin_get_ingresos_resumen(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_get_ingresos_resumen(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_get_ingresos_resumen(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT)
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.super_admin_list_ingresos_page(
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_asesor_ids UUID[] DEFAULT NULL,
  p_monto_fuente TEXT DEFAULT NULL,
  p_porcentajes NUMERIC[] DEFAULT NULL,
  p_stage_scope TEXT DEFAULT 'all_submitted',
  p_visible_step SMALLINT DEFAULT NULL,
  p_estado TEXT DEFAULT 'elegibles',
  p_buscar TEXT DEFAULT NULL,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 25
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
  v_page INT;
  v_size INT;
  v_offset INT;
  v_scope TEXT;
BEGIN
  v_actor := public.__admin_require_super_admin();
  SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id = v_actor;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_ingresos: organización del actor no disponible'
      USING ERRCODE = '22023';
  END IF;

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
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 25), 1), 100);
  v_offset := (v_page - 1) * v_size;
  v_scope := lower(btrim(COALESCE(p_stage_scope, 'all_submitted')));
  v_etapas := public.ingresos_resolve_etapas_filtro(v_scope, p_visible_step);

  RETURN (
    WITH filtered AS (
      SELECT
        u.*,
        public.__map_etapa_interna_a_paso_visual(u.etapa_actual::INT) AS paso_visual
      FROM public.__ingresos_universe_rows(v_org) u
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
    ),
    counted AS (
      SELECT COUNT(*)::INT AS total FROM filtered
    ),
    page_rows AS (
      SELECT *
      FROM filtered f
      ORDER BY f.fecha_envio_mesa DESC NULLS LAST, f.expediente_id
      LIMIT v_size OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', c.total,
      'page', v_page,
      'page_size', v_size,
      'items', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'expediente_id', p.expediente_id,
              'cliente_nombre', p.cliente_nombre,
              'nss', p.nss,
              'asesor_id', p.asesor_id,
              'asesor_nombre', p.asesor_nombre,
              'etapa_actual', p.etapa_actual,
              'paso_visual', p.paso_visual,
              'subestado', p.subestado,
              'ciclo_estado', p.ciclo_estado,
              'fecha_envio_mesa', p.fecha_envio_mesa,
              'bio_aprobacion_at', p.bio_aprobacion_at,
              'pago_concasa_at', p.reconocido_at,
              'monto_general', p.monto_general,
              'monto_actualizado', p.monto_actualizado,
              'monto_base', p.monto_base,
              'monto_fuente', p.monto_fuente,
              'porcentaje_cobro', p.porcentaje_cobro,
              'ingreso_proyectado', p.ingreso_proyectado,
              'ingreso_real', p.ingreso_real,
              'pendiente', GREATEST(
                COALESCE(p.ingreso_proyectado, 0) - COALESCE(p.ingreso_real, 0),
                0
              ),
              'is_historical_estimate', p.is_historical_estimate,
              'calculo',
                CASE
                  WHEN p.monto_base IS NOT NULL AND p.porcentaje_cobro IS NOT NULL THEN
                    format(
                      '%s × %s%% = %s',
                      to_char(p.monto_base, 'FM999,999,999,990.00'),
                      trim(to_char(p.porcentaje_cobro, 'FM999990.##')),
                      to_char(p.ingreso_proyectado, 'FM999,999,999,990.00')
                    )
                  ELSE NULL
                END
            )
            ORDER BY p.fecha_envio_mesa DESC NULLS LAST, p.expediente_id
          )
          FROM page_rows p
        ),
        '[]'::jsonb
      )
    )
    FROM counted c
  );
END;
$$;

COMMENT ON FUNCTION public.super_admin_list_ingresos_page(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT, INT, INT) IS
  'P137: detalle paginado ingresos. Proyección por fecha_envio_mesa + stage_scope.';

REVOKE ALL ON FUNCTION public.super_admin_list_ingresos_page(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_list_ingresos_page(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_list_ingresos_page(DATE, DATE, UUID[], TEXT, NUMERIC[], TEXT, SMALLINT, TEXT, TEXT, INT, INT)
  TO authenticated, service_role, postgres;
