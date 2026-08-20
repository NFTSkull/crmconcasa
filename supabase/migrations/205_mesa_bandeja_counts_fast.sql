-- ConCasa CRM — P205-B1: counts-only RPC (sin pipeline de listado).
-- Cloud max conocido = 204. Esta mig = 205.
-- Read-only. 0 writers. 0 tablas. 0 backfill.
-- Paridad exacta con counts de mesa_list_bandeja_page (mig 199).
-- categoria + P198 se evalúan UNA vez por expediente (CTE MATERIALIZED).

CREATE OR REPLACE FUNCTION public.mesa_bandeja_counts_fast(
  p_today_ymd TEXT DEFAULT NULL,
  p_origen TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_role public.app_role;
  v_counts JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mesa_bandeja_counts: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_bandeja_counts: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  -- Misma semántica que counts de mesa_list_bandeja_page (199):
  -- solo actor/can_see + p_origen + p_today_ymd.
  -- NO depende de quick/ops/buscar/etapa/subestado/cursor/limit.
  WITH base AS MATERIALIZED (
    SELECT
      e.id,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.fecha_cita,
      e.fecha_envio_mesa
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.ciclo_estado IN ('activo', 'cancelado')
      AND public.can_see_expediente(e.id)
      AND (
        p_origen IS NULL OR p_origen = '' OR p_origen = 'todos'
        OR (p_origen = 'interno' AND coalesce(e.origen_mesa::text, 'interno') = 'interno')
        OR (p_origen = 'externo' AND e.origen_mesa::text = 'externo')
      )
  ),
  classified AS MATERIALIZED (
    SELECT
      b.id,
      b.etapa_actual,
      b.subestado,
      b.ciclo_estado,
      b.fecha_cita,
      public.mesa_bandeja_categoria_resumen(b.id, b.fecha_envio_mesa) AS categoria,
      (
        SELECT t.estado
        FROM public.mesa_cambio_revision_estado_efectivo(b.id) t
        LIMIT 1
      ) AS cambio_estado
    FROM base b
  )
  SELECT jsonb_build_object(
    'correccionesEnviadas', count(*) FILTER (
      WHERE ciclo_estado = 'activo'
        AND cambio_estado IN ('CORRECTION_PENDING_REVIEW', 'ADVISOR_UPDATE_PENDING_REVIEW')
    ),
    'correccionesSolicitadas', count(*) FILTER (
      WHERE ciclo_estado = 'activo'
        AND cambio_estado = 'CORRECTION_PENDING_REVIEW'
    ),
    'otrasActualizaciones', count(*) FILTER (
      WHERE ciclo_estado = 'activo'
        AND cambio_estado = 'ADVISOR_UPDATE_PENDING_REVIEW'
    ),
    'nuevos', count(*) FILTER (
      WHERE ciclo_estado = 'activo'
        AND etapa_actual IN (1, 2)
        AND subestado IN ('pendiente', 'en_validacion_mesa', 'en_proceso')
    ),
    'enProceso', count(*) FILTER (
      WHERE ciclo_estado = 'activo' AND subestado = 'en_proceso'
    ),
    'citasHoy', count(*) FILTER (
      WHERE ciclo_estado = 'activo'
        AND p_today_ymd IS NOT NULL
        AND to_char(
          (fecha_cita AT TIME ZONE 'America/Monterrey'),
          'YYYY-MM-DD'
        ) = p_today_ymd
    ),
    'rechazosCancelaciones', count(*) FILTER (
      WHERE (subestado = 'rechazado' AND ciclo_estado = 'activo')
         OR ciclo_estado = 'cancelado'
    ),
    'rechazados', count(*) FILTER (
      WHERE subestado = 'rechazado' AND ciclo_estado = 'activo'
    ),
    'cancelados', count(*) FILTER (WHERE ciclo_estado = 'cancelado'),
    'bloqueadosRechazados', count(*) FILTER (
      WHERE (subestado = 'rechazado' AND ciclo_estado = 'activo')
         OR (ciclo_estado = 'activo' AND categoria = 'correccion_requerida')
    ),
    'enValidacionMesa', count(*) FILTER (
      WHERE ciclo_estado = 'activo'
        AND subestado = 'en_validacion_mesa'
        AND categoria IS DISTINCT FROM 'correccion_enviada'
        AND categoria IS DISTINCT FROM 'correccion_requerida'
    ),
    'enEsperaAsesor', count(*) FILTER (
      WHERE ciclo_estado = 'activo'
        AND (
          categoria = 'correccion_requerida'
          OR cambio_estado = 'WAITING_ADVISOR'
        )
    ),
    'totalBandeja', count(*) FILTER (WHERE ciclo_estado = 'activo')
  )
  INTO v_counts
  FROM classified;

  RETURN coalesce(v_counts, jsonb_build_object(
    'correccionesEnviadas', 0,
    'correccionesSolicitadas', 0,
    'otrasActualizaciones', 0,
    'nuevos', 0,
    'enProceso', 0,
    'citasHoy', 0,
    'rechazosCancelaciones', 0,
    'rechazados', 0,
    'cancelados', 0,
    'bloqueadosRechazados', 0,
    'enValidacionMesa', 0,
    'enEsperaAsesor', 0,
    'totalBandeja', 0
  ));
END;
$$;

COMMENT ON FUNCTION public.mesa_bandeja_counts_fast(TEXT, TEXT) IS
  'P205-B1: KPIs/chips Mesa (solo counts). Paridad con mesa_list_bandeja_page.counts; sin items/cursor/list pipeline. categoria+P198 1×/expediente.';

REVOKE ALL ON FUNCTION public.mesa_bandeja_counts_fast(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_bandeja_counts_fast(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_bandeja_counts_fast(TEXT, TEXT)
  TO authenticated, service_role, postgres;
