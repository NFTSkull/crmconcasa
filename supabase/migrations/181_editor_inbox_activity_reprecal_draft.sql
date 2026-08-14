-- ConCasa CRM — P186 B1A: Editor inbox activity (IDs page) + draft re-precal
-- LOCAL ONLY. No Cloud apply.
--
-- editor_activity_at = COALESCE(pending_intent.created_at, e.created_at)
-- JOIN exacto: e.reprecalificacion_pendiente_id = intentos.id AND intento.expediente_id = e.id
-- NO usa expedientes.updated_at ni decided_at de intentos resueltos.
-- Draft: solo monto_aprobado + notas_revision del pointer pending. 0 action_log (debounce).

-- =============================================================================
-- READ: page membership (IDs + activity). El repo FE sigue usando EXPEDIENTES_LIST_SELECT.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.editor_list_expediente_ids_page(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_role public.app_role;
  v_org uuid;
  v_page integer;
  v_page_size integer;
  v_offset integer;
  v_q text;
  v_like text;
  v_total bigint;
  v_items jsonb;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'editor_list_expediente_ids_page: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN ('editor', 'super_admin') THEN
    RAISE EXCEPTION 'editor_list_expediente_ids_page: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'editor_list_expediente_ids_page: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_page_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 50)));
  v_offset := (v_page - 1) * v_page_size;

  v_q := nullif(btrim(coalesce(p_search, '')), '');
  IF v_q IS NOT NULL THEN
    v_q := regexp_replace(v_q, ',', ' ', 'g');
    v_q := replace(replace(v_q, '%', ''), '_', '');
    v_q := nullif(btrim(regexp_replace(v_q, '\s+', ' ', 'g')), '');
  END IF;
  IF v_q IS NOT NULL THEN
    v_like := '%' || v_q || '%';
  END IF;

  WITH ranked AS (
    SELECT
      e.id,
      coalesce(pend.created_at, e.created_at) AS editor_activity_at
    FROM public.expedientes e
    LEFT JOIN public.profiles pr ON pr.id = e.asesor_id
    LEFT JOIN public.expediente_precalificacion_intentos pend
      ON pend.id = e.reprecalificacion_pendiente_id
     AND pend.expediente_id = e.id
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
      AND (
        v_like IS NULL
        OR e.cliente_nombre ILIKE v_like
        OR coalesce(e.telefono_cliente, '') ILIKE v_like
        OR e.nss::text ILIKE v_like
        OR e.programa::text ILIKE v_like
        OR coalesce(pr.email, '') ILIKE v_like
        OR coalesce(pr.full_name, '') ILIKE v_like
      )
  ),
  counted AS (
    SELECT count(*)::bigint AS total FROM ranked
  ),
  page AS (
    SELECT r.id, r.editor_activity_at
    FROM ranked r
    ORDER BY r.editor_activity_at DESC, r.id DESC
    OFFSET v_offset
    LIMIT v_page_size
  )
  SELECT
    counted.total,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'editor_activity_at', p.editor_activity_at
          )
          ORDER BY p.editor_activity_at DESC, p.id DESC
        )
        FROM page p
      ),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM counted;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_page_size
  );
END;
$$;

COMMENT ON FUNCTION public.editor_list_expediente_ids_page(integer, integer, text) IS
  'P186: membership de página Editor. Orden editor_activity_at DESC, id DESC ANTES de OFFSET/LIMIT. IDs only.';

REVOKE ALL ON FUNCTION public.editor_list_expediente_ids_page(integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editor_list_expediente_ids_page(integer, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.editor_list_expediente_ids_page(integer, integer, text) TO authenticated;

-- =============================================================================
-- WRITE: borrador re-precal (no resuelve, no toca expedientes ni editor_decisions)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.editor_guardar_borrador_reprecalificacion(
  p_expediente_id uuid,
  p_monto_aprobado numeric DEFAULT NULL,
  p_notas text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_role public.app_role;
  v_org uuid;
  v_exp public.expedientes%ROWTYPE;
  v_intento public.expediente_precalificacion_intentos%ROWTYPE;
  v_monto numeric(14, 2);
  v_notas text;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN ('editor', 'super_admin') THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: expediente_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_monto_aprobado IS NOT NULL AND p_monto_aprobado < 0 THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: monto_aprobado debe ser NULL o >= 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: expediente no disponible'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.reprecalificacion_pendiente_id IS NULL THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: no hay re-precal pendiente'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_intento
  FROM public.expediente_precalificacion_intentos i
  WHERE i.id = v_exp.reprecalificacion_pendiente_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_intento.expediente_id IS DISTINCT FROM v_exp.id
     OR v_intento.organization_id IS DISTINCT FROM v_org
     OR v_intento.decision IS DISTINCT FROM 'pendiente'
     OR v_intento.decided_at IS NOT NULL THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: pending stale o mismatch'
      USING ERRCODE = '22023';
  END IF;

  v_monto := CASE
    WHEN p_monto_aprobado IS NULL THEN NULL
    ELSE round(p_monto_aprobado::numeric, 2)
  END;
  v_notas := coalesce(p_notas, '');

  UPDATE public.expediente_precalificacion_intentos i
  SET monto_aprobado = v_monto,
      notas_revision = v_notas
  WHERE i.id = v_intento.id
    AND i.expediente_id = v_exp.id
    AND i.decision = 'pendiente'
    AND i.decided_at IS NULL
  RETURNING * INTO v_intento;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'editor_guardar_borrador_reprecalificacion: pending stale o mismatch'
      USING ERRCODE = '22023';
  END IF;

  -- P186 §19: 0 action_log en borrador (debounce 750ms). La resolución canónica audita.
  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', v_exp.id,
    'intento_id', v_intento.id,
    'decision', v_intento.decision,
    'monto_aprobado', v_intento.monto_aprobado,
    'notas_revision', v_intento.notas_revision
  );
END;
$$;

COMMENT ON FUNCTION public.editor_guardar_borrador_reprecalificacion(uuid, numeric, text) IS
  'P186: guarda borrador en intento pending (monto/notas). No resuelve, no toca expedientes ni editor_decisions, 0 action_log.';

REVOKE ALL ON FUNCTION public.editor_guardar_borrador_reprecalificacion(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editor_guardar_borrador_reprecalificacion(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.editor_guardar_borrador_reprecalificacion(uuid, numeric, text) TO authenticated;
