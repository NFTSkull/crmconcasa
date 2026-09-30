-- ConCasa CRM — Admin: NSS + repetición histórica en precalificaciones.
-- Solo lectura. No modifica expedientes ni decisiones.
--
-- Para cada expediente solicitado devuelve:
-- - NSS completo (texto, conserva ceros a la izquierda)
-- - expedientes no eliminados de la misma organización con ese NSS
-- - veces históricas precalificadas:
--     * expediente sin historial P155 => 1 (precalificación inicial)
--     * expediente con historial P155 => número de filas en
--       expediente_precalificacion_intentos (incluye inicial archivada + reprecalificaciones)
--
-- El RPC está limitado a Super Admin y máx. 100 expedientes por llamada,
-- alineado al page_size máximo del listado Admin.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_precal_nss_enrichment(
  p_expediente_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_ids UUID[];
  v_items JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  SELECT p.organization_id
  INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.active = true;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_precal_nss_enrichment: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  v_ids := coalesce(p_expediente_ids, ARRAY[]::UUID[]);

  IF cardinality(v_ids) > 100 THEN
    RAISE EXCEPTION 'admin_precal_nss_enrichment: máximo 100 expedientes por llamada'
      USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT DISTINCT unnest(v_ids) AS expediente_id
  ),
  target AS (
    SELECT
      e.id AS expediente_id,
      e.nss,
      e.organization_id
    FROM requested r
    JOIN public.expedientes e
      ON e.id = r.expediente_id
     AND e.organization_id = v_org
     AND e.deleted_at IS NULL
  ),
  target_nss AS (
    SELECT DISTINCT nss
    FROM target
    WHERE nss IS NOT NULL
  ),
  attempt_counts AS (
    SELECT
      i.expediente_id,
      count(*)::INT AS cnt
    FROM public.expediente_precalificacion_intentos i
    JOIN public.expedientes e
      ON e.id = i.expediente_id
     AND e.organization_id = v_org
     AND e.deleted_at IS NULL
    JOIN target_nss n ON n.nss = e.nss
    GROUP BY i.expediente_id
  ),
  stats AS (
    SELECT
      e.nss,
      count(*)::INT AS expedientes_total,
      sum(
        CASE
          WHEN coalesce(ac.cnt, 0) > 0 THEN ac.cnt
          ELSE 1
        END
      )::INT AS precalificaciones_total
    FROM public.expedientes e
    JOIN target_nss n ON n.nss = e.nss
    LEFT JOIN attempt_counts ac ON ac.expediente_id = e.id
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
    GROUP BY e.nss
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'expediente_id', t.expediente_id,
        'nss', t.nss::TEXT,
        'nss_expedientes_total', coalesce(s.expedientes_total, 1),
        'nss_precalificaciones_total', coalesce(s.precalificaciones_total, 1)
      )
      ORDER BY t.expediente_id
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM target t
  LEFT JOIN stats s ON s.nss = t.nss;

  RETURN coalesce(v_items, '[]'::JSONB);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_precal_nss_enrichment(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_precal_nss_enrichment(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_precal_nss_enrichment(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.admin_precal_nss_enrichment(UUID[]) IS
  'Super Admin RO: NSS completo y métricas de repetición histórica por expediente para listado/Excel de precalificaciones.';

COMMIT;
