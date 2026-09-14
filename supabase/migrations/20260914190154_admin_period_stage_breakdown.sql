-- ConCasa CRM — Admin: desglose completo de etapas dentro del periodo seleccionado.
-- READ MODEL ONLY: 0 UPDATE / 0 backfill / 0 writers.

CREATE OR REPLACE FUNCTION public.admin_get_mesa_period_by_etapa_v2(
  p_from TIMESTAMPTZ,
  p_to_exclusive TIMESTAMPTZ,
  p_asesor_id UUID DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_buscar TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_rows JSONB;
  v_q TEXT;
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  WITH cohort AS (
    SELECT e.etapa_actual
    FROM public.expedientes e
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.fecha_envio_mesa IS NOT NULL
      AND e.fecha_envio_mesa >= p_from
      AND e.fecha_envio_mesa < p_to_exclusive
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (
        p_estado IS NULL
        OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(p.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
        OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      )
  ), counts AS (
    SELECT etapa_actual::INT AS etapa, count(*)::BIGINT AS cnt
    FROM cohort
    GROUP BY etapa_actual
  ), totals AS (
    SELECT count(*)::BIGINT AS total FROM cohort
  )
  SELECT t.total, coalesce(jsonb_agg(
    jsonb_build_object(
      'etapa', s.etapa,
      'count', coalesce(c.cnt, 0),
      'pct', CASE WHEN t.total = 0 THEN 0
        ELSE round((coalesce(c.cnt, 0)::NUMERIC * 1000 / t.total) / 10.0, 1) END
    ) ORDER BY s.etapa
  ), '[]'::jsonb)
  INTO v_total, v_rows
  FROM totals t
  CROSS JOIN generate_series(1, 12) AS s(etapa)
  LEFT JOIN counts c ON c.etapa = s.etapa
  GROUP BY t.total;

  RETURN jsonb_build_object('total', coalesce(v_total, 0), 'by_etapa', coalesce(v_rows, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_mesa_period_by_etapa_v2(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_mesa_period_by_etapa_v2(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_mesa_period_by_etapa_v2(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_get_mesa_period_by_etapa_v2(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT) IS
  'Admin RO: distribución completa por etapa del universo enviado a Mesa dentro del periodo; respeta asesor, estado y búsqueda; la etapa activa no recorta el desglose.';
