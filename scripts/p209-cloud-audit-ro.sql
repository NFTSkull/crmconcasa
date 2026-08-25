-- P209 Cloud RO audit: correccion_requerida (SELECT only, no PII)
WITH candidates AS (
  SELECT
    e.id,
    left(e.id::text, 8) AS short_id,
    e.etapa_actual,
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
classified AS (
  SELECT
    c.id,
    c.short_id,
    c.etapa_actual,
    p.p198_estado,
    p.p198_request_type,
    public.asesor_inbox_retencion_correccion_abierta(c.id) AS retencion_abierta,
    cd.estado::text AS cliente_datos_estado,
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
      WHEN p.p198_estado = 'WAITING_ADVISOR'
           AND p.p198_request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION' THEN 'E_op_inconsistent'
      WHEN p.p198_estado = 'WAITING_ADVISOR' THEN 'D_otro_waiting'
      WHEN public.asesor_inbox_retencion_correccion_abierta(c.id) THEN 'C_retencion'
      ELSE 'F_sin_causa'
    END AS bucket
  FROM correction c
  LEFT JOIN p198 p ON p.id = c.id
  LEFT JOIN public.cliente_datos cd ON cd.expediente_id = c.id
)
SELECT
  count(*) AS total_correction_required,
  count(*) FILTER (WHERE bucket = 'A_dg') AS bucket_a_dg,
  count(*) FILTER (WHERE bucket = 'B_documental') AS bucket_b_documental,
  count(*) FILTER (WHERE bucket = 'C_retencion') AS bucket_c_retencion,
  count(*) FILTER (WHERE bucket IN ('D_otro_waiting', 'F_sin_causa')) AS bucket_d_otro,
  count(*) FILTER (WHERE bucket = 'E_op_inconsistent') AS bucket_e_op_inconsistent,
  count(*) FILTER (WHERE bucket = 'F_sin_causa') AS bucket_f_sin_causa,
  count(*) FILTER (
    WHERE rejected_doc_count = 0
      AND cliente_datos_estado IS DISTINCT FROM 'rechazado'
      AND NOT retencion_abierta
  ) AS enrich_count_zero_estimated,
  count(*) FILTER (
    WHERE (rejected_doc_count + CASE WHEN cliente_datos_estado = 'rechazado' THEN 1 ELSE 0 END) = 1
      AND bucket NOT IN ('C_retencion')
  ) AS only_one_element_generic_estimated,
  count(*) FILTER (
    WHERE (rejected_doc_count + CASE WHEN cliente_datos_estado = 'rechazado' THEN 1 ELSE 0 END) >= 2
  ) AS multi_element_estimated
FROM classified;
