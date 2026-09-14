-- ConCasa CRM — Admin: inventario transparente de expedientes.
-- READ ONLY. No cambia KPIs, agenda, cupos, etapas ni datos de expedientes.
-- Permite al Super Admin ver enviados y no enviados a Mesa, con conteo documental.

CREATE OR REPLACE FUNCTION public.admin_list_expedientes_overview_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_asesor_id UUID DEFAULT NULL,
  p_etapa_actual SMALLINT DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_buscar TEXT DEFAULT NULL,
  p_mesa_status TEXT DEFAULT 'todos'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_page INTEGER;
  v_size INTEGER;
  v_offset INTEGER;
  v_total BIGINT;
  v_q TEXT;
  v_digits TEXT;
  v_mesa_status TEXT;
  v_items JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_expedientes_overview: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_offset := (v_page - 1) * v_size;
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');
  v_mesa_status := lower(btrim(coalesce(p_mesa_status, 'todos')));

  IF v_mesa_status NOT IN ('todos', 'enviados', 'no_enviados') THEN
    RAISE EXCEPTION 'admin_expedientes_overview: p_mesa_status inválido'
      USING ERRCODE = '22023';
  END IF;

  IF p_estado IS NOT NULL AND p_estado NOT IN ('activos', 'finalizados', 'rechazados', 'cancelados') THEN
    RAISE EXCEPTION 'admin_expedientes_overview: p_estado inválido'
      USING ERRCODE = '22023';
  END IF;

  v_digits := NULL;
  IF v_q IS NOT NULL AND regexp_replace(v_q, '[\s\-]', '', 'g') ~ '^[0-9]+$' THEN
    v_digits := nullif(regexp_replace(v_q, '[^0-9]', '', 'g'), '');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.expedientes e
  LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
  WHERE e.organization_id = v_org
    AND e.deleted_at IS NULL
    AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
    AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
    AND (
      p_estado IS NULL
      OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
      OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
      OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
      OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
    )
    AND (
      v_mesa_status = 'todos'
      OR (
        v_mesa_status = 'enviados'
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
      )
      OR (
        v_mesa_status = 'no_enviados'
        AND (e.submitted_to_mesa IS DISTINCT FROM TRUE OR e.fecha_envio_mesa IS NULL)
      )
    )
    AND (
      v_q IS NULL
      OR e.cliente_nombre ILIKE '%' || v_q || '%'
      OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
      OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
      OR e.programa::text ILIKE '%' || v_q || '%'
      OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      OR (
        v_digits IS NOT NULL
        AND regexp_replace(coalesce(e.nss::text, ''), '[^0-9]', '', 'g')
          LIKE '%' || v_digits || '%'
      )
    );

  SELECT coalesce(
    jsonb_agg(to_jsonb(t) ORDER BY t.sort_at DESC, t.expediente_id DESC),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT
      e.id AS expediente_id,
      e.cliente_nombre,
      btrim(e.nss::text) AS nss,
      e.asesor_id,
      nullif(btrim(pr.full_name), '') AS asesor_nombre,
      nullif(btrim(pr.email), '') AS asesor_email,
      e.programa::text AS programa,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      (e.submitted_to_mesa = TRUE AND e.fecha_envio_mesa IS NOT NULL) AS enviado_a_mesa,
      e.fecha_envio_mesa,
      e.created_at,
      e.updated_at,
      coalesce(docs.documentos_activos_count, 0)::bigint AS documentos_activos_count,
      coalesce(docs.documentos_total_count, 0)::bigint AS documentos_total_count,
      docs.ultimo_documento_at,
      coalesce(e.fecha_envio_mesa, docs.ultimo_documento_at, e.updated_at, e.created_at) AS sort_at
    FROM public.expedientes e
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE d.deleted_at IS NULL) AS documentos_activos_count,
        count(*) AS documentos_total_count,
        max(d.created_at) FILTER (WHERE d.deleted_at IS NULL) AS ultimo_documento_at
      FROM public.expediente_documentos d
      WHERE d.expediente_id = e.id
    ) docs ON TRUE
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (p_etapa_actual IS NULL OR e.etapa_actual = p_etapa_actual)
      AND (
        p_estado IS NULL
        OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
        OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
        OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
        OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
      )
      AND (
        v_mesa_status = 'todos'
        OR (
          v_mesa_status = 'enviados'
          AND e.submitted_to_mesa = TRUE
          AND e.fecha_envio_mesa IS NOT NULL
        )
        OR (
          v_mesa_status = 'no_enviados'
          AND (e.submitted_to_mesa IS DISTINCT FROM TRUE OR e.fecha_envio_mesa IS NULL)
        )
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR coalesce(pr.full_name, '') ILIKE '%' || v_q || '%'
        OR coalesce(pr.email, '') ILIKE '%' || v_q || '%'
        OR e.programa::text ILIKE '%' || v_q || '%'
        OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
        OR (
          v_digits IS NOT NULL
          AND regexp_replace(coalesce(e.nss::text, ''), '[^0-9]', '', 'g')
            LIKE '%' || v_digits || '%'
        )
      )
    ORDER BY coalesce(e.fecha_envio_mesa, docs.ultimo_documento_at, e.updated_at, e.created_at) DESC,
             e.id DESC
    OFFSET v_offset
    LIMIT v_size
  ) t;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_size,
    'mesa_status', v_mesa_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_expedientes_overview_page(
  INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_expedientes_overview_page(
  INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_expedientes_overview_page(
  INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.admin_list_expedientes_overview_page(
  INTEGER, INTEGER, UUID, SMALLINT, TEXT, TEXT, TEXT
) IS 'Super Admin RO: inventario paginado de expedientes enviados/no enviados a Mesa con conteo documental. No altera KPIs ni flujo operativo.';

CREATE OR REPLACE FUNCTION public.admin_list_expedientes_overview_asesores()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_items JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_expedientes_overview_asesores: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'asesor_id', x.asesor_id,
        'asesor_nombre', x.asesor_nombre,
        'asesor_email', x.asesor_email
      ) ORDER BY coalesce(x.asesor_nombre, x.asesor_email, x.asesor_id::text)
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT DISTINCT
      e.asesor_id,
      nullif(btrim(p.full_name), '') AS asesor_nombre,
      nullif(btrim(p.email), '') AS asesor_email
    FROM public.expedientes e
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
      AND e.asesor_id IS NOT NULL
  ) x;

  RETURN jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_expedientes_overview_asesores() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_expedientes_overview_asesores() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_expedientes_overview_asesores() TO authenticated;

COMMENT ON FUNCTION public.admin_list_expedientes_overview_asesores() IS
  'Super Admin RO: asesores con expedientes activos en la organización para filtro de inventario Admin.';
