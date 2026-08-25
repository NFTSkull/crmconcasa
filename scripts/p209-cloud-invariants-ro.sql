-- P209 AFTER apply: invariants on all correction_required (read-only aggregates)

WITH correction AS (
  SELECT e.id
  FROM public.expedientes e
  WHERE e.deleted_at IS NULL
    AND public.asesor_inbox_estado_efectivo(e.id) = 'correccion_requerida'
),
expl AS (
  SELECT
    c.id,
    public.asesor_inbox_correccion_explicacion(c.id) AS explanation,
    public.asesor_inbox_correccion_labels_vigentes(c.id) AS labels
  FROM correction c
),
p198 AS (
  SELECT
    c.id,
    s.estado AS p198_estado,
    s.request_type AS p198_request_type
  FROM correction c
  LEFT JOIN LATERAL (
    SELECT t.estado, t.request_type
    FROM public.mesa_cambio_revision_estado_efectivo(c.id) t
    LIMIT 1
  ) s ON TRUE
)
SELECT jsonb_build_object(
  'total_correction_required', (SELECT count(*) FROM correction),
  'explanation_non_null', (SELECT count(*) FROM expl WHERE explanation IS NOT NULL),
  'explanation_non_empty', (SELECT count(*) FROM expl WHERE btrim(coalesce(explanation, '')) <> ''),
  'fallback_count', (SELECT count(*) FROM expl WHERE explanation LIKE '%Abre el expediente para revisar el detalle%'),
  'bucket_dg', (SELECT count(*) FROM p198 WHERE p198_estado = 'WAITING_ADVISOR' AND p198_request_type = 'SOLICITUD_DATOS_GENERALES'),
  'bucket_documental', (SELECT count(*) FROM p198 WHERE p198_estado = 'WAITING_ADVISOR' AND p198_request_type = 'SOLICITUD_DOCUMENTAL'),
  'bucket_retencion', (SELECT count(*) FROM correction c WHERE public.asesor_inbox_retencion_correccion_abierta(c.id)),
  'bucket_op_inconsistent', (SELECT count(*) FROM p198 WHERE p198_estado = 'WAITING_ADVISOR' AND p198_request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION'),
  'dg_empty_labels_now_filled', (
    SELECT count(*)
    FROM expl e
    JOIN p198 p ON p.id = e.id
    WHERE p.p198_request_type = 'SOLICITUD_DATOS_GENERALES'
      AND e.explanation = 'Mesa solicita corregir: Datos generales.'
  ),
  'generic_one_element_now_specific', (
    SELECT count(*)
    FROM expl e
    WHERE e.explanation LIKE 'Mesa solicita corregir:%'
      AND e.explanation NOT LIKE '%1 elemento%'
      AND e.explanation NOT LIKE '%Abre el expediente%'
  ),
  'pending_review_with_expl', (
    SELECT count(*) FROM p198
    WHERE p198_estado = 'CORRECTION_PENDING_REVIEW'
      AND public.asesor_inbox_correccion_explicacion(p198.id) IS NOT NULL
  ),
  'rechazado_mesa_with_expl', (
    SELECT count(*) FROM correction c
    JOIN public.expedientes e ON e.id = c.id
    WHERE e.subestado::text = 'rechazado'
      AND public.asesor_inbox_correccion_explicacion(c.id) IS NOT NULL
  )
) AS invariants;
