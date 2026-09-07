-- ConCasa CRM — bulk effective-state helper for Mesa read-model.
-- Read-only DDL: canonical P198/P202 remains unchanged.

CREATE OR REPLACE FUNCTION public.mesa_cambio_revision_estado_bandeja_bulk(p_expediente_ids uuid[])
RETURNS TABLE(
  expediente_id uuid,
  estado text,
  origin text,
  request_type text,
  request_at timestamptz,
  batch_id uuid,
  batch_submitted_at timestamptz,
  actionable_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH base AS MATERIALIZED (
    SELECT e.id, e.fecha_envio_mesa
    FROM public.expedientes e
    WHERE e.id = ANY(coalesce(p_expediente_ids, ARRAY[]::uuid[]))
  ),
  latest AS MATERIALIZED (
    SELECT
      b.id,
      b.fecha_envio_mesa,
      l.latest_request_at,
      l.latest_request_type,
      l.latest_response_at,
      l.latest_batch_id,
      EXISTS (
        SELECT 1
        FROM public.expediente_asesor_cambio_lotes x
        WHERE x.expediente_id = b.id
          AND x.status = 'pendiente_revision'
          AND x.submitted_at IS NOT NULL
          AND (b.fecha_envio_mesa IS NULL OR x.submitted_at >= b.fecha_envio_mesa)
      ) AS has_pending
    FROM base b
    LEFT JOIN LATERAL public.mesa_cambio_episodio_latest(b.id) l ON TRUE
  )
  SELECT
    l.id,
    'WAITING_ADVISOR'::text,
    NULL::text,
    l.latest_request_type,
    l.latest_request_at,
    NULL::uuid,
    l.latest_response_at,
    l.latest_request_at
  FROM latest l
  WHERE l.latest_request_at IS NOT NULL
    AND (l.latest_response_at IS NULL OR l.latest_request_at > l.latest_response_at)

  UNION ALL

  SELECT
    l.id,
    'CLOSED'::text,
    NULL::text,
    l.latest_request_type,
    l.latest_request_at,
    NULL::uuid,
    l.latest_response_at,
    NULL::timestamptz
  FROM latest l
  WHERE NOT (
    l.latest_request_at IS NOT NULL
    AND (l.latest_response_at IS NULL OR l.latest_request_at > l.latest_response_at)
  )
    AND NOT l.has_pending

  UNION ALL

  SELECT
    l.id,
    s.estado,
    s.origin,
    s.request_type,
    s.request_at,
    s.batch_id,
    s.batch_submitted_at,
    s.actionable_at
  FROM latest l
  CROSS JOIN LATERAL public.mesa_cambio_revision_estado_efectivo(l.id) s
  WHERE NOT (
    l.latest_request_at IS NOT NULL
    AND (l.latest_response_at IS NULL OR l.latest_request_at > l.latest_response_at)
  )
    AND l.has_pending;
$function$;

COMMENT ON FUNCTION public.mesa_cambio_revision_estado_bandeja_bulk(uuid[]) IS
  'Mesa perf bulk helper: exact fast-path for a visible ID set; canonical P198/P202 only for pending batches.';
REVOKE ALL ON FUNCTION public.mesa_cambio_revision_estado_bandeja_bulk(uuid[]) FROM PUBLIC, anon, authenticated;
