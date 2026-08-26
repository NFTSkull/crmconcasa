-- P210 Mauricio projection RO (3370014e). NO mutaciones.
WITH exp AS (
  SELECT e.id
  FROM public.expedientes e
  WHERE left(e.id::text, 8) = '3370014e'
    AND e.deleted_at IS NULL
  LIMIT 1
),
ctx AS (
  SELECT
    e.id,
    public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo,
    s.estado AS p198_estado,
    s.request_type,
    s.request_at
  FROM exp e
  JOIN public.expedientes ex ON ex.id = e.id
  LEFT JOIN LATERAL (
    SELECT t.estado, t.request_type, t.request_at
    FROM public.mesa_cambio_revision_estado_efectivo(e.id) t
    LIMIT 1
  ) s ON TRUE
),
dg AS (
  SELECT NULLIF(btrim(coalesce(al.payload->>'comentario_rechazo', '')), '') AS motivo
  FROM exp e
  JOIN ctx c ON c.id = e.id
  LEFT JOIN public.action_log al ON al.entity_id = e.id
    AND al.action = 'cliente_datos.revision.update'
    AND al.entity_type = 'cliente_datos'
    AND coalesce(al.payload->>'estado_nuevo', '') = 'rechazado'
  ORDER BY al.created_at DESC NULLS LAST, al.id DESC
  LIMIT 1
),
activity AS (
  SELECT EXISTS (
    SELECT 1
    FROM public.expediente_asesor_cambios ch
    INNER JOIN public.expediente_asesor_cambio_lotes l ON l.id = ch.lote_id
    WHERE l.expediente_id = (SELECT id FROM exp)
      AND (SELECT request_at FROM ctx) IS NOT NULL
      AND ch.created_at > (SELECT request_at FROM ctx)
  ) AS has_post_request_activity
)
SELECT
  left(c.id::text, 8) AS short_id,
  c.estado_efectivo,
  c.p198_estado,
  c.request_type,
  c.request_at,
  d.motivo AS dg_motivo_esperado,
  a.has_post_request_activity,
  CASE
    WHEN c.p198_estado = 'WAITING_ADVISOR' AND a.has_post_request_activity THEN 'CAMBIOS_GUARDADOS_SIN_ENVIAR'
    WHEN c.p198_estado = 'WAITING_ADVISOR' AND NOT a.has_post_request_activity THEN 'PENDIENTE_DE_CORREGIR'
    WHEN c.estado_efectivo = 'correccion_enviada' THEN 'CORRECCION_ENVIADA'
    ELSE 'OTRO'
  END AS ux_state_proyectado,
  CASE
    WHEN c.p198_estado = 'WAITING_ADVISOR'
      AND a.has_post_request_activity
      AND c.estado_efectivo = 'correccion_requerida'
    THEN true
    ELSE false
  END AS can_resubmit_proyectado
FROM ctx c
CROSS JOIN dg d
CROSS JOIN activity a;
