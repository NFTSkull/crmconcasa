-- ConCasa CRM — P128: presencia activa «Abierto ahora por»
-- Tabla por sesión de pestaña + RPCs touch/close/list (batch, TTL 90s).
-- No muta expedientes ni escribe action_log.

-- =============================================================================
-- Tabla
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.expediente_mesa_presencia (
  organization_id UUID NOT NULL REFERENCES public.organizations (id),
  expediente_id UUID NOT NULL REFERENCES public.expedientes (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id),
  session_id UUID NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_mesa_presencia_pk
    PRIMARY KEY (organization_id, expediente_id, user_id, session_id)
);

CREATE INDEX IF NOT EXISTS expediente_mesa_presencia_exp_seen_idx
  ON public.expediente_mesa_presencia (expediente_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS expediente_mesa_presencia_seen_idx
  ON public.expediente_mesa_presencia (last_seen_at DESC);

ALTER TABLE public.expediente_mesa_presencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expediente_mesa_presencia_select ON public.expediente_mesa_presencia;
CREATE POLICY expediente_mesa_presencia_select
  ON public.expediente_mesa_presencia
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

REVOKE ALL ON TABLE public.expediente_mesa_presencia FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_mesa_presencia FROM anon;
REVOKE ALL ON TABLE public.expediente_mesa_presencia FROM authenticated;
GRANT SELECT ON TABLE public.expediente_mesa_presencia TO authenticated;
GRANT ALL ON TABLE public.expediente_mesa_presencia TO service_role;

COMMENT ON TABLE public.expediente_mesa_presencia IS
  'P128: presencia activa Mesa por pestaña (escritura solo vía RPC; TTL visual 90s).';

-- =============================================================================
-- mesa_touch_expediente_presencia
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_touch_expediente_presencia(
  p_expediente_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp_org UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_touch_expediente_presencia: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_touch_expediente_presencia: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'mesa_touch_expediente_presencia: expediente y session_id requeridos'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_touch_expediente_presencia: expediente no visible' USING ERRCODE = '42501';
  END IF;

  SELECT e.organization_id INTO v_exp_org
  FROM public.expedientes e
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL;

  IF v_exp_org IS NULL THEN
    RAISE EXCEPTION 'mesa_touch_expediente_presencia: expediente no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_role <> 'super_admin' AND v_exp_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'mesa_touch_expediente_presencia: organización distinta' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.expediente_mesa_presencia (
    organization_id, expediente_id, user_id, session_id,
    opened_at, last_seen_at
  ) VALUES (
    v_exp_org, p_expediente_id, v_actor_id, p_session_id,
    v_now, v_now
  )
  ON CONFLICT (organization_id, expediente_id, user_id, session_id) DO UPDATE SET
    last_seen_at = EXCLUDED.last_seen_at;

  -- No action_log; no muta expedientes
  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'session_id', p_session_id,
    'last_seen_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_touch_expediente_presencia(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_touch_expediente_presencia(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_touch_expediente_presencia(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.mesa_touch_expediente_presencia(UUID, UUID) IS
  'P128: upsert presencia Mesa por pestaña. No muta expediente ni action_log.';

-- =============================================================================
-- mesa_close_expediente_presencia
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_close_expediente_presencia(
  p_expediente_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_deleted INTEGER := 0;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_close_expediente_presencia: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_close_expediente_presencia: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'mesa_close_expediente_presencia: expediente y session_id requeridos'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.expediente_mesa_presencia pr
  WHERE pr.expediente_id = p_expediente_id
    AND pr.user_id = v_actor_id
    AND pr.session_id = p_session_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', v_deleted,
    'expediente_id', p_expediente_id,
    'session_id', p_session_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_close_expediente_presencia(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_close_expediente_presencia(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_close_expediente_presencia(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.mesa_close_expediente_presencia(UUID, UUID) IS
  'P128: retira solo la sesión del actor (best-effort FE).';

-- =============================================================================
-- mesa_list_expedientes_presencia (batch, TTL 90s, nombres dedupe)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_list_expedientes_presencia(
  p_expediente_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_items JSONB;
  v_ids UUID[];
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_list_expedientes_presencia: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_list_expedientes_presencia: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  v_ids := ARRAY(
    SELECT DISTINCT x
    FROM unnest(coalesce(p_expediente_ids, ARRAY[]::UUID[])) AS x
    WHERE x IS NOT NULL
  );

  IF coalesce(cardinality(v_ids), 0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  END IF;

  -- Una sola query: visibles + TTL 90s + nombres únicos por usuario
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'expediente_id', s.expediente_id,
      'users', s.users
    )
    ORDER BY s.expediente_id
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      u.expediente_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'user_id', u.user_id,
            'full_name', u.full_name
          )
          ORDER BY u.full_name NULLS LAST, u.user_id
        ),
        '[]'::jsonb
      ) AS users
    FROM (
      SELECT DISTINCT ON (pr.expediente_id, pr.user_id)
        pr.expediente_id,
        pr.user_id,
        nullif(btrim(p.full_name), '') AS full_name
      FROM public.expediente_mesa_presencia pr
      JOIN public.profiles p ON p.id = pr.user_id
      WHERE pr.expediente_id = ANY (v_ids)
        AND pr.last_seen_at > (clock_timestamp() - interval '90 seconds')
        AND public.can_see_expediente(pr.expediente_id)
      ORDER BY pr.expediente_id, pr.user_id, pr.last_seen_at DESC
    ) u
    GROUP BY u.expediente_id
  ) s;

  RETURN jsonb_build_object('ok', true, 'items', coalesce(v_items, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_list_expedientes_presencia(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_list_expedientes_presencia(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_list_expedientes_presencia(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.mesa_list_expedientes_presencia(UUID[]) IS
  'P128: presencia activa batch (<90s), nombres dedupe por usuario, sin N+1.';
