-- P207.3 pre/post apply snapshot (read-only counts). No hardcoded expectations.

WITH classified AS (
  SELECT
    e.id,
    e.etapa_actual,
    e.subestado::text AS subestado,
    e.ciclo_estado::text AS ciclo_estado,
    e.pago_concasa_resultado,
    public.mesa_bandeja_categoria_resumen(e.id, e.fecha_envio_mesa) AS categoria,
    (SELECT t.estado FROM public.mesa_cambio_revision_estado_efectivo(e.id) t LIMIT 1) AS cambio_estado
  FROM public.expedientes e
  WHERE e.deleted_at IS NULL
    AND e.submitted_to_mesa = TRUE
    AND e.ciclo_estado = 'activo'
),
signed11 AS (
  SELECT count(*) AS n
  FROM classified
  WHERE etapa_actual >= 11 AND pago_concasa_resultado IS NULL
),
stale AS (
  SELECT count(*) AS n
  FROM classified
  WHERE etapa_actual >= 11
    AND pago_concasa_resultado IS NULL
    AND cambio_estado IN ('CORRECTION_PENDING_REVIEW', 'ADVISOR_UPDATE_PENDING_REVIEW')
),
current AS (
  SELECT
    count(*) FILTER (
      WHERE ciclo_estado = 'activo' AND pago_concasa_resultado IS NULL
        AND (
          cambio_estado IN ('CORRECTION_PENDING_REVIEW', 'ADVISOR_UPDATE_PENDING_REVIEW')
          OR (etapa_actual IN (1,2) AND subestado IN ('pendiente','en_validacion_mesa','en_proceso')
              AND cambio_estado IS DISTINCT FROM 'WAITING_ADVISOR'
              AND categoria IS DISTINCT FROM 'correccion_requerida')
        )
    ) AS disponibles,
    count(*) FILTER (
      WHERE ciclo_estado = 'activo' AND pago_concasa_resultado IS NULL
        AND cambio_estado IN ('CORRECTION_PENDING_REVIEW', 'ADVISOR_UPDATE_PENDING_REVIEW')
    ) AS cambios,
    count(*) FILTER (
      WHERE ciclo_estado = 'activo' AND pago_concasa_resultado IS NULL
        AND cambio_estado = 'ADVISOR_UPDATE_PENDING_REVIEW'
    ) AS otras,
    count(*) FILTER (
      WHERE ciclo_estado = 'activo' AND pago_concasa_resultado IS NULL
        AND cambio_estado = 'CORRECTION_PENDING_REVIEW'
    ) AS correcciones
  FROM classified
),
simulated AS (
  SELECT
    count(*) FILTER (
      WHERE ciclo_estado = 'activo' AND pago_concasa_resultado IS NULL
        AND etapa_actual < 11
        AND (
          cambio_estado IN ('CORRECTION_PENDING_REVIEW', 'ADVISOR_UPDATE_PENDING_REVIEW')
          OR (etapa_actual IN (1,2) AND subestado IN ('pendiente','en_validacion_mesa','en_proceso')
              AND cambio_estado IS DISTINCT FROM 'WAITING_ADVISOR'
              AND categoria IS DISTINCT FROM 'correccion_requerida')
        )
    ) AS disponibles,
    count(*) FILTER (
      WHERE ciclo_estado = 'activo' AND etapa_actual < 11 AND pago_concasa_resultado IS NULL
        AND cambio_estado IN ('CORRECTION_PENDING_REVIEW', 'ADVISOR_UPDATE_PENDING_REVIEW')
    ) AS cambios,
    count(*) FILTER (
      WHERE ciclo_estado = 'activo' AND etapa_actual < 11 AND pago_concasa_resultado IS NULL
        AND cambio_estado = 'ADVISOR_UPDATE_PENDING_REVIEW'
    ) AS otras,
    count(*) FILTER (
      WHERE ciclo_estado = 'activo' AND etapa_actual < 11 AND pago_concasa_resultado IS NULL
        AND cambio_estado = 'CORRECTION_PENDING_REVIEW'
    ) AS correcciones
  FROM classified
)
SELECT jsonb_build_object(
  'CURRENT_AVAILABLE', (SELECT disponibles FROM current),
  'SIMULATED_AVAILABLE', (SELECT disponibles FROM simulated),
  'CURRENT_CAMBIOS', (SELECT cambios FROM current),
  'SIMULATED_CAMBIOS', (SELECT cambios FROM simulated),
  'CURRENT_OTRAS', (SELECT otras FROM current),
  'SIMULATED_OTRAS', (SELECT otras FROM simulated),
  'CURRENT_CORRECCIONES', (SELECT correcciones FROM current),
  'SIMULATED_CORRECCIONES', (SELECT correcciones FROM simulated),
  'SIGNED_STAGE11_TOTAL', (SELECT n FROM signed11),
  'SIGNED_WITH_STALE_CHANGE', (SELECT n FROM stale)
) AS p2073_snapshot;
