-- ConCasa CRM — P182: localizador Admin por cliente / NSS (Resumen)
-- READ ONLY. Sin periodo. No altera KPIs ni p_buscar de listados existentes.
-- Identidad = expediente_id (P179: mismo NSS puede tener varios pre-Mesa).

CREATE OR REPLACE FUNCTION public.admin_search_cliente_expedientes(
  p_buscar TEXT,
  p_limit INTEGER DEFAULT 20,
  p_asesor_id UUID DEFAULT NULL
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
  v_q TEXT;
  v_digits TEXT;
  v_limit INTEGER;
  v_fetch INTEGER;
  v_items JSONB := '[]'::JSONB;
  v_truncated BOOLEAN := false;
BEGIN
  v_actor := public.__admin_require_super_admin();

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_search_cliente_expedientes: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  v_limit := LEAST(50, GREATEST(1, coalesce(p_limit, 20)));
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');

  IF v_q IS NULL THEN
    RETURN jsonb_build_object(
      'items', '[]'::JSONB,
      'truncated', false,
      'limit', v_limit
    );
  END IF;

  v_digits := NULL;
  IF regexp_replace(v_q, '[\s\-]', '', 'g') ~ '^[0-9]+$' THEN
    v_digits := nullif(regexp_replace(v_q, '[^0-9]', '', 'g'), '');
    IF v_digits IS NOT NULL AND length(v_digits) < 3 THEN
      v_digits := NULL;
    END IF;
  END IF;

  v_fetch := v_limit + 1;

  SELECT coalesce(jsonb_agg(x.item ORDER BY x.ord), '[]'::JSONB)
  INTO v_items
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC, e.id DESC
      ) AS ord,
      jsonb_build_object(
        'expediente_id', e.id,
        'cliente_nombre', e.cliente_nombre,
        'nss', e.nss::text,
        'asesor_id', e.asesor_id,
        'asesor_nombre', pr.full_name,
        'asesor_email', pr.email,
        'programa', e.programa::text,
        'created_at', e.created_at,
        'updated_at', e.updated_at,
        'ciclo_estado', e.ciclo_estado::text,
        'submitted_to_mesa', e.submitted_to_mesa,
        'fecha_envio_mesa', e.fecha_envio_mesa,
        'etapa_actual', e.etapa_actual,
        'subestado', e.subestado::text,
        'editor_decision', coalesce(ed.decision::text, 'pendiente'),
        'monto_aprobado', ed.monto_aprobado,
        'aprobado_at', ed.aprobado_at,
        'no_cumple_at', ed.no_cumple_at,
        'reprecalificacion_pendiente_id', e.reprecalificacion_pendiente_id,
        'precal_pending', (e.reprecalificacion_pendiente_id IS NOT NULL),
        'programa_solicitado', CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL
            THEN i.programa_solicitado::text
          ELSE NULL
        END
      ) AS item
    FROM public.expedientes e
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    LEFT JOIN public.expediente_precalificacion_intentos i
      ON i.id = e.reprecalificacion_pendiente_id
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (
        e.cliente_nombre ILIKE '%' || v_q || '%'
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
    ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC, e.id DESC
    LIMIT v_fetch
  ) x;

  IF jsonb_array_length(v_items) > v_limit THEN
    v_truncated := true;
    SELECT coalesce(jsonb_agg(elem), '[]'::JSONB)
    INTO v_items
    FROM (
      SELECT elem
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(elem, n)
      WHERE t.n <= v_limit
      ORDER BY t.n
    ) s;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'truncated', v_truncated,
    'limit', v_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_cliente_expedientes(TEXT, INTEGER, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_cliente_expedientes(TEXT, INTEGER, UUID)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_search_cliente_expedientes(TEXT, INTEGER, UUID)
  TO authenticated;

COMMENT ON FUNCTION public.admin_search_cliente_expedientes(TEXT, INTEGER, UUID) IS
  'P182: localizador RO super_admin por cliente/NSS/asesor. Sin periodo. deleted_at IS NULL. No dedupe por NSS.';
