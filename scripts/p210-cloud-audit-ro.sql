-- P210 Cloud RO audit (current production P209). No PII.
WITH candidates AS (
  SELECT
    e.id,
    left(e.id::text, 8) AS short_id,
    e.asesor_id,
    public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo
  FROM public.expedientes e
  WHERE e.deleted_at IS NULL
    AND e.submitted_to_mesa = true
),
correction AS (
  SELECT c.*
  FROM candidates c
  WHERE c.estado_efectivo = 'correccion_requerida'
),
p198 AS (
  SELECT
    c.id,
    s.estado AS p198_estado,
    s.request_type AS p198_request_type,
    s.request_at AS p198_request_at
  FROM correction c
  LEFT JOIN LATERAL (
    SELECT t.estado, t.request_type, t.request_at
    FROM public.mesa_cambio_revision_estado_efectivo(c.id) t
    LIMIT 1
  ) s ON TRUE
),
dg_motivo AS (
  SELECT DISTINCT ON (c.id)
    c.id,
    NULLIF(btrim(coalesce(al.payload->>'comentario_rechazo', '')), '') AS dg_motivo
  FROM correction c
  LEFT JOIN public.action_log al ON al.entity_id = c.id
    AND al.action = 'cliente_datos.revision.update'
    AND al.entity_type = 'cliente_datos'
    AND coalesce(al.payload->>'estado_nuevo', '') = 'rechazado'
  ORDER BY c.id, al.created_at DESC NULLS LAST, al.id DESC
),
classified AS (
  SELECT
    c.id,
    c.short_id,
    p.p198_estado,
    p.p198_request_type,
    public.asesor_inbox_retencion_correccion_abierta(c.id) AS retencion_abierta,
    cd.estado::text AS cliente_datos_estado,
    dm.dg_motivo,
    (
      SELECT count(*)::int
      FROM (
        SELECT DISTINCT ON (d.tipo_documento) d.tipo_documento, d.estatus_revision::text AS est
        FROM public.expediente_documentos d
        WHERE d.expediente_id = c.id AND d.deleted_at IS NULL
        ORDER BY d.tipo_documento, d.created_at DESC NULLS LAST, d.id DESC
      ) x
      WHERE x.est = 'rechazado'
    ) AS rejected_doc_count,
    CASE
      WHEN p.p198_estado = 'WAITING_ADVISOR'
           AND p.p198_request_type = 'SOLICITUD_DATOS_GENERALES' THEN 'A_dg'
      WHEN p.p198_estado = 'WAITING_ADVISOR'
           AND p.p198_request_type = 'SOLICITUD_DOCUMENTAL' THEN 'B_documental'
      WHEN public.asesor_inbox_retencion_correccion_abierta(c.id) THEN 'C_retencion'
      WHEN p.p198_estado = 'WAITING_ADVISOR'
           AND p.p198_request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION' THEN 'E_op'
      WHEN p.p198_estado = 'WAITING_ADVISOR' THEN 'D_otro_waiting'
      ELSE 'F_sin_causa'
    END AS bucket
  FROM correction c
  LEFT JOIN p198 p ON p.id = c.id
  LEFT JOIN public.cliente_datos cd ON cd.expediente_id = c.id
  LEFT JOIN dg_motivo dm ON dm.id = c.id
),
readiness AS (
  SELECT
    cl.*,
    p.p198_request_at,
    EXISTS (
      SELECT 1
      FROM public.expediente_asesor_cambios c
      INNER JOIN public.expediente_asesor_cambio_lotes l ON l.id = c.lote_id
      WHERE l.expediente_id = cl.id
        AND p.p198_request_at IS NOT NULL
        AND c.created_at > p.p198_request_at
    ) AS has_post_request_activity,
    EXISTS (
      SELECT 1
      FROM public.expediente_asesor_cambio_lotes l
      WHERE l.expediente_id = cl.id
        AND l.status = 'pendiente_revision'
        AND l.submitted_at IS NOT NULL
        AND p.p198_request_at IS NOT NULL
        AND l.submitted_at > p.p198_request_at
    ) AS has_response_lote
  FROM classified cl
  LEFT JOIN p198 p ON p.id = cl.id
)
SELECT
  count(*) AS total_correction_required,
  count(*) FILTER (WHERE bucket = 'A_dg') AS bucket_a_dg,
  count(*) FILTER (WHERE bucket = 'B_documental') AS bucket_b_documental,
  count(*) FILTER (WHERE bucket = 'C_retencion') AS bucket_c_retencion,
  count(*) FILTER (WHERE rejected_doc_count >= 1 AND bucket = 'A_dg') AS multi_dg_doc_estimated,
  count(*) FILTER (WHERE bucket = 'E_op') AS bucket_e_op,
  count(*) FILTER (WHERE dg_motivo IS NULL AND bucket = 'A_dg') AS dg_motivo_missing,
  count(*) FILTER (WHERE dg_motivo IS NOT NULL AND bucket = 'A_dg') AS dg_motivo_present,
  count(*) FILTER (
    WHERE bucket = 'A_dg'
      AND p198_estado = 'WAITING_ADVISOR'
      AND NOT has_post_request_activity
      AND NOT has_response_lote
  ) AS state_a_pendiente,
  count(*) FILTER (
    WHERE bucket = 'A_dg'
      AND p198_estado = 'WAITING_ADVISOR'
      AND has_post_request_activity
      AND NOT has_response_lote
  ) AS state_b_guardado_sin_enviar,
  count(*) FILTER (
    WHERE bucket IN ('A_dg', 'B_documental', 'C_retencion')
      AND dg_motivo IS NULL
      AND rejected_doc_count = 0
      AND NOT retencion_abierta
  ) AS reasons_missing_count
FROM readiness;
