-- P209 sample 10+ cases (no PII)
WITH correction AS (
  SELECT
    e.id,
    left(e.id::text, 8) AS short_id,
    e.etapa_actual
  FROM public.expedientes e
  WHERE e.deleted_at IS NULL
    AND public.asesor_inbox_estado_efectivo(e.id) = 'correccion_requerida'
),
p198 AS (
  SELECT
    c.id,
    c.short_id,
    c.etapa_actual,
    s.estado AS p198_estado,
    s.request_type AS p198_request_type
  FROM correction c
  LEFT JOIN LATERAL (
    SELECT t.estado, t.request_type
    FROM public.mesa_cambio_revision_estado_efectivo(c.id) t
    LIMIT 1
  ) s ON TRUE
),
docs AS (
  SELECT
    c.id,
    array_agg(DISTINCT d.tipo_documento ORDER BY d.tipo_documento) FILTER (
      WHERE d.estatus_revision::text = 'rechazado'
    ) AS rejected_kinds
  FROM correction c
  LEFT JOIN LATERAL (
    SELECT DISTINCT ON (d.tipo_documento)
      d.tipo_documento,
      d.estatus_revision::text AS estatus_revision
    FROM public.expediente_documentos d
    WHERE d.expediente_id = c.id AND d.deleted_at IS NULL
    ORDER BY d.tipo_documento, d.created_at DESC NULLS LAST, d.id DESC
  ) d ON TRUE
  GROUP BY c.id
)
SELECT
  p.short_id,
  p.etapa_actual,
  p.p198_estado,
  p.p198_request_type,
  cd.estado::text AS cliente_datos_estado,
  public.asesor_inbox_retencion_correccion_abierta(p.id) AS retencion,
  coalesce(d.rejected_kinds, ARRAY[]::text[]) AS rejected_kinds,
  (
    SELECT count(*)::int
    FROM (
      SELECT 1 WHERE cd.estado = 'rechazado'
      UNION ALL
      SELECT 1 FROM unnest(coalesce(d.rejected_kinds, ARRAY[]::text[]))
    ) z
  ) AS enrich_count_estimated
FROM p198 p
LEFT JOIN public.cliente_datos cd ON cd.expediente_id = p.id
LEFT JOIN docs d ON d.id = p.id
ORDER BY
  CASE p.p198_request_type
    WHEN 'SOLICITUD_DATOS_GENERALES' THEN 1
    WHEN 'SOLICITUD_DOCUMENTAL' THEN 2
    ELSE 3
  END,
  enrich_count_estimated ASC,
  p.short_id
LIMIT 12;
