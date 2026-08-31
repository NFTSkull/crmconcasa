-- ConCasa CRM — Equipo líder / capabilities (Team Silvia)
-- Capacidades independientes de app_role. NO modifica can_see_expediente.
-- NO toca agenda / biométricos / firmas / sheets.
-- Base: c0ea84f. Seed idempotente solo Silvia (team_dashboard_read + equipo).
-- Nota: patches save_cliente_datos / enviar_a_mesa / register se anexan en paso aparte.

-- =============================================================================
-- 1. Tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.profile_capabilities (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN (
    'team_dashboard_read',
    'create_for_any_advisor',
    'integrate_for_any_advisor'
  )),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, capability)
);

CREATE INDEX IF NOT EXISTS profile_capabilities_capability_active_idx
  ON public.profile_capabilities (capability)
  WHERE active = true;

DROP TRIGGER IF EXISTS profile_capabilities_set_updated_at ON public.profile_capabilities;
CREATE TRIGGER profile_capabilities_set_updated_at
  BEFORE UPDATE ON public.profile_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.profile_capabilities IS
  'Capabilities por profile (Team Silvia). Independientes de app_role. Escritura solo service/migración/helpers DEFINER.';

COMMENT ON COLUMN public.profile_capabilities.capability IS
  'team_dashboard_read | create_for_any_advisor | integrate_for_any_advisor';

CREATE TABLE IF NOT EXISTS public.asesor_equipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  nombre text NOT NULL,
  leader_id uuid NOT NULL REFERENCES public.profiles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS asesor_equipos_one_active_leader_idx
  ON public.asesor_equipos (leader_id)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS asesor_equipos_organization_id_idx
  ON public.asesor_equipos (organization_id)
  WHERE active = true;

DROP TRIGGER IF EXISTS asesor_equipos_set_updated_at ON public.asesor_equipos;
CREATE TRIGGER asesor_equipos_set_updated_at
  BEFORE UPDATE ON public.asesor_equipos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.asesor_equipos IS
  'Equipos comerciales liderados por un asesor (Team Silvia). Un equipo activo por leader_id.';

CREATE TABLE IF NOT EXISTS public.asesor_equipo_miembros (
  team_id uuid NOT NULL REFERENCES public.asesor_equipos(id) ON DELETE CASCADE,
  asesor_id uuid NOT NULL REFERENCES public.profiles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, asesor_id)
);

CREATE INDEX IF NOT EXISTS asesor_equipo_miembros_asesor_active_idx
  ON public.asesor_equipo_miembros (asesor_id)
  WHERE active = true;

COMMENT ON TABLE public.asesor_equipo_miembros IS
  'Miembros activos de un asesor_equipos. El líder no necesita fila aquí (está en leader_id).';

-- =============================================================================
-- RLS (SELECT only for authenticated; mutaciones vía service/migración/DEFINER)
-- =============================================================================

ALTER TABLE public.profile_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asesor_equipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asesor_equipo_miembros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_capabilities_select ON public.profile_capabilities;
CREATE POLICY profile_capabilities_select
  ON public.profile_capabilities
  FOR SELECT
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR (
      public.is_super_admin()
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = profile_capabilities.profile_id
          AND p.organization_id = public.current_organization_id()
      )
    )
  );

DROP POLICY IF EXISTS asesor_equipos_select ON public.asesor_equipos;
CREATE POLICY asesor_equipos_select
  ON public.asesor_equipos
  FOR SELECT
  TO authenticated
  USING (
    leader_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.asesor_equipo_miembros m
      WHERE m.team_id = asesor_equipos.id
        AND m.asesor_id = auth.uid()
        AND m.active = true
    )
    OR (
      public.is_super_admin()
      AND organization_id = public.current_organization_id()
    )
  );

DROP POLICY IF EXISTS asesor_equipo_miembros_select ON public.asesor_equipo_miembros;
CREATE POLICY asesor_equipo_miembros_select
  ON public.asesor_equipo_miembros
  FOR SELECT
  TO authenticated
  USING (
    -- Propia fila, o líder del equipo, o super_admin de la org.
    -- NO listar peers (un miembro no ve a otros miembros por RLS).
    asesor_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.asesor_equipos t
      WHERE t.id = asesor_equipo_miembros.team_id
        AND t.leader_id = auth.uid()
        AND t.active = true
    )
    OR (
      public.is_super_admin()
      AND EXISTS (
        SELECT 1
        FROM public.asesor_equipos t
        WHERE t.id = asesor_equipo_miembros.team_id
          AND t.organization_id = public.current_organization_id()
      )
    )
  );

REVOKE ALL ON TABLE public.profile_capabilities FROM PUBLIC;
REVOKE ALL ON TABLE public.profile_capabilities FROM anon;
REVOKE ALL ON TABLE public.profile_capabilities FROM authenticated;
GRANT SELECT ON TABLE public.profile_capabilities TO authenticated;
GRANT ALL ON TABLE public.profile_capabilities TO service_role;

REVOKE ALL ON TABLE public.asesor_equipos FROM PUBLIC;
REVOKE ALL ON TABLE public.asesor_equipos FROM anon;
REVOKE ALL ON TABLE public.asesor_equipos FROM authenticated;
GRANT SELECT ON TABLE public.asesor_equipos TO authenticated;
GRANT ALL ON TABLE public.asesor_equipos TO service_role;

REVOKE ALL ON TABLE public.asesor_equipo_miembros FROM PUBLIC;
REVOKE ALL ON TABLE public.asesor_equipo_miembros FROM anon;
REVOKE ALL ON TABLE public.asesor_equipo_miembros FROM authenticated;
GRANT SELECT ON TABLE public.asesor_equipo_miembros TO authenticated;
GRANT ALL ON TABLE public.asesor_equipo_miembros TO service_role;

-- =============================================================================
-- 2. Helpers (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.profile_has_capability(
  p_profile_id uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_capabilities pc
    WHERE pc.profile_id = p_profile_id
      AND pc.capability = p_capability
      AND pc.active = true
  );
$$;

COMMENT ON FUNCTION public.profile_has_capability(uuid, text) IS
  'Helper interno: ¿profile_id tiene capability activa? SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION public.profile_has_capability(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.profile_has_capability(auth.uid(), p_capability);
$$;

COMMENT ON FUNCTION public.profile_has_capability(text) IS
  'Wrapper público: ¿auth.uid() tiene capability activa?';

CREATE OR REPLACE FUNCTION public.asesor_lider_require_context()
RETURNS TABLE(actor_id uuid, org_id uuid, team_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_org uuid;
  v_role public.app_role;
  v_active boolean;
  v_team uuid;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_lider: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id, p.app_role, p.active
  INTO v_org, v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_lider: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.profile_has_capability(v_actor, 'team_dashboard_read') THEN
    RAISE EXCEPTION 'asesor_lider: sin capability team_dashboard_read'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.id
  INTO v_team
  FROM public.asesor_equipos t
  WHERE t.leader_id = v_actor
    AND t.active = true
    AND t.organization_id = v_org
  LIMIT 1;

  IF v_team IS NULL THEN
    RAISE EXCEPTION 'asesor_lider: no es líder activo de un equipo en su organización'
      USING ERRCODE = '42501';
  END IF;

  actor_id := v_actor;
  org_id := v_org;
  team_id := v_team;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.asesor_lider_require_context() IS
  'Interno: valida asesor activo + team_dashboard_read + líder de equipo activo en su org. Raise 42501.';

CREATE OR REPLACE FUNCTION public.asesor_lider_scope_asesor_ids(p_team_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.asesor_equipos t
  JOIN public.profiles p ON p.id = t.leader_id
  WHERE t.id = p_team_id
    AND t.active = true
    AND p.active = true
    AND p.app_role = 'asesor'

  UNION

  SELECT p.id
  FROM public.asesor_equipo_miembros m
  JOIN public.asesor_equipos t ON t.id = m.team_id
  JOIN public.profiles p ON p.id = m.asesor_id
  WHERE m.team_id = p_team_id
    AND m.active = true
    AND t.active = true
    AND p.active = true
    AND p.app_role = 'asesor';
$$;

COMMENT ON FUNCTION public.asesor_lider_scope_asesor_ids(uuid) IS
  'Interno: leader_id + miembros activos del equipo (profiles activos app_role=asesor).';

REVOKE ALL ON FUNCTION public.profile_has_capability(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_has_capability(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.profile_has_capability(uuid, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.profile_has_capability(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_has_capability(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.profile_has_capability(text) TO authenticated;

REVOKE ALL ON FUNCTION public.asesor_lider_require_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_lider_require_context() FROM anon;
REVOKE ALL ON FUNCTION public.asesor_lider_require_context() FROM authenticated;

REVOKE ALL ON FUNCTION public.asesor_lider_scope_asesor_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_lider_scope_asesor_ids(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.asesor_lider_scope_asesor_ids(uuid) FROM authenticated;

-- =============================================================================
-- 3. RPCs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- asesor_lider_get_context
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asesor_lider_get_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_org uuid;
  v_role public.app_role;
  v_active boolean;
  v_caps text[];
  v_has_dash boolean := false;
  v_team jsonb := NULL;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_lider_get_context: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id, p.app_role, p.active
  INTO v_org, v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_lider_get_context: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(pc.capability ORDER BY pc.capability), ARRAY[]::text[])
  INTO v_caps
  FROM public.profile_capabilities pc
  WHERE pc.profile_id = v_actor
    AND pc.active = true;

  v_has_dash := 'team_dashboard_read' = ANY (v_caps);

  IF v_has_dash THEN
    SELECT jsonb_build_object(
      'id', t.id,
      'nombre', t.nombre,
      'leader_id', t.leader_id,
      'organization_id', t.organization_id
    )
    INTO v_team
    FROM public.asesor_equipos t
    WHERE t.leader_id = v_actor
      AND t.active = true
      AND t.organization_id = v_org
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'team_dashboard_read', v_has_dash,
    'capabilities', to_jsonb(v_caps),
    'team', v_team
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_lider_get_context() IS
  'Contexto líder para FE: capabilities + team (null si sin capability/equipo). No raise por falta de capability.';

-- ---------------------------------------------------------------------------
-- asesor_lider_list_members
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asesor_lider_list_members()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_org uuid;
  v_team uuid;
  v_members jsonb;
BEGIN
  SELECT r.actor_id, r.org_id, r.team_id
  INTO v_actor, v_org, v_team
  FROM public.asesor_lider_require_context() r;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'full_name', x.full_name,
        'email', x.email,
        'is_leader', x.is_leader,
        'active', x.active
      )
      ORDER BY x.is_leader DESC, x.full_name ASC
    ),
    '[]'::jsonb
  )
  INTO v_members
  FROM (
    SELECT
      p.id,
      p.full_name,
      p.email,
      (p.id = v_actor) AS is_leader,
      p.active
    FROM public.asesor_lider_scope_asesor_ids(v_team) s
    JOIN public.profiles p ON p.id = s
    WHERE p.organization_id = v_org
  ) x;

  RETURN jsonb_build_object('members', v_members);
END;
$$;

COMMENT ON FUNCTION public.asesor_lider_list_members() IS
  'Lista miembros del equipo del líder (incluye líder). Requiere team_dashboard_read + liderazgo activo.';

-- ---------------------------------------------------------------------------
-- asesor_lider_get_dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asesor_lider_get_dashboard(
  p_asesor_id uuid DEFAULT NULL,
  p_fecha_desde date DEFAULT NULL,
  p_fecha_hasta date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_org uuid;
  v_team uuid;
  v_activos bigint := 0;
  v_cerrados bigint := 0;
  v_total bigint := 0;
  v_monto numeric(14, 2) := 0;
  v_by_etapa jsonb;
BEGIN
  SELECT r.actor_id, r.org_id, r.team_id
  INTO v_actor, v_org, v_team
  FROM public.asesor_lider_require_context() r;

  IF p_asesor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.asesor_lider_scope_asesor_ids(v_team) s
    WHERE s = p_asesor_id
  ) THEN
    RAISE EXCEPTION 'asesor_lider_get_dashboard: asesor_id fuera de alcance del equipo'
      USING ERRCODE = '42501';
  END IF;

  IF p_fecha_desde IS NOT NULL
     AND p_fecha_hasta IS NOT NULL
     AND p_fecha_hasta < p_fecha_desde THEN
    RAISE EXCEPTION 'asesor_lider_get_dashboard: rango de fechas inválido'
      USING ERRCODE = '22023';
  END IF;

  WITH universe AS (
    SELECT e.id, e.etapa_actual, e.ciclo_estado
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.organization_id = v_org
      AND e.asesor_id IN (SELECT public.asesor_lider_scope_asesor_ids(v_team))
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (p_fecha_desde IS NULL OR e.created_at::date >= p_fecha_desde)
      AND (p_fecha_hasta IS NULL OR e.created_at::date <= p_fecha_hasta)
  ),
  counts AS (
    SELECT
      count(*) FILTER (WHERE ciclo_estado = 'activo') AS activos,
      count(*) FILTER (WHERE ciclo_estado <> 'activo') AS cerrados,
      count(*) AS total
    FROM universe
  ),
  montos AS (
    SELECT coalesce(
      sum(
        CASE
          WHEN ed.decision = 'aprobado'
          THEN least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)
          ELSE 0
        END
      ),
      0
    )::numeric(14, 2) AS monto_total
    FROM universe u
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = u.id
  ),
  por_etapa AS (
    SELECT
      u.etapa_actual AS etapa,
      count(*)::bigint AS cnt,
      coalesce(
        sum(
          CASE
            WHEN ed.decision = 'aprobado'
            THEN least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)
            ELSE 0
          END
        ),
        0
      )::numeric(14, 2) AS monto
    FROM universe u
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = u.id
    GROUP BY u.etapa_actual
  ),
  etapas AS (
    SELECT * FROM (VALUES
      (1, 'Integración'),
      (2, 'Registro'),
      (3, 'Listo para cita de biométrico'),
      (4, 'Cita agendada (biométricos)'),
      (5, 'Biometría (resultado)'),
      (6, 'Inscripción'),
      (7, 'Notificación'),
      (8, 'Acuse / Aviso de retención'),
      (9, 'Listo para agendar firma'),
      (10, 'Cita para firma'),
      (11, 'Firmado'),
      (12, 'Pago a ConCasa')
    ) AS t(etapa, nombre)
  )
  SELECT
    c.activos,
    c.cerrados,
    c.total,
    m.monto_total,
    (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'etapa', e.etapa,
            'nombre', e.nombre,
            'count', coalesce(pe.cnt, 0),
            'monto', coalesce(pe.monto, 0)
          )
          ORDER BY e.etapa
        ),
        '[]'::jsonb
      )
      FROM etapas e
      LEFT JOIN por_etapa pe ON pe.etapa = e.etapa
    )
  INTO v_activos, v_cerrados, v_total, v_monto, v_by_etapa
  FROM counts c
  CROSS JOIN montos m;

  RETURN jsonb_build_object(
    'activos', v_activos,
    'cerrados', v_cerrados,
    'total', v_total,
    'monto_total_aprobado', v_monto,
    'by_etapa', coalesce(v_by_etapa, '[]'::jsonb),
    'filters', jsonb_build_object(
      'asesor_id', p_asesor_id,
      'fecha_desde', p_fecha_desde,
      'fecha_hasta', p_fecha_hasta
    )
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_lider_get_dashboard(uuid, date, date) IS
  'KPIs equipo líder: activos/cerrados/total/monto (cap 169k) + by_etapa 1-12. Scope = equipo del líder.';

-- ---------------------------------------------------------------------------
-- asesor_lider_list_expedientes_page
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asesor_lider_list_expedientes_page(
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 25,
  p_buscar text DEFAULT NULL,
  p_asesor_id uuid DEFAULT NULL,
  p_etapa_exacta int DEFAULT NULL,
  p_fecha_desde date DEFAULT NULL,
  p_fecha_hasta date DEFAULT NULL,
  p_ciclo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_org uuid;
  v_team uuid;
  v_page int;
  v_size int;
  v_from int;
  v_ciclo text;
  v_total bigint;
  v_items jsonb;
BEGIN
  SELECT r.actor_id, r.org_id, r.team_id
  INTO v_actor, v_org, v_team
  FROM public.asesor_lider_require_context() r;

  IF p_asesor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.asesor_lider_scope_asesor_ids(v_team) s
    WHERE s = p_asesor_id
  ) THEN
    RAISE EXCEPTION 'asesor_lider_list_expedientes_page: asesor_id fuera de alcance'
      USING ERRCODE = '42501';
  END IF;

  IF p_fecha_desde IS NOT NULL
     AND p_fecha_hasta IS NOT NULL
     AND p_fecha_hasta < p_fecha_desde THEN
    RAISE EXCEPTION 'asesor_lider_list_expedientes_page: rango de fechas inválido'
      USING ERRCODE = '22023';
  END IF;

  IF p_etapa_exacta IS NOT NULL AND (p_etapa_exacta < 1 OR p_etapa_exacta > 12) THEN
    RAISE EXCEPTION 'asesor_lider_list_expedientes_page: etapa_exacta inválida'
      USING ERRCODE = '22023';
  END IF;

  v_ciclo := nullif(lower(btrim(coalesce(p_ciclo, ''))), '');
  IF v_ciclo IS NOT NULL AND v_ciclo NOT IN ('activo', 'cerrado') THEN
    RAISE EXCEPTION 'asesor_lider_list_expedientes_page: ciclo inválido (activo|cerrado)'
      USING ERRCODE = '22023';
  END IF;

  v_page := greatest(coalesce(p_page, 1), 1);
  v_size := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_from := (v_page - 1) * v_size;

  WITH scoped AS (
    SELECT
      e.id,
      e.cliente_nombre,
      e.nss,
      e.telefono_cliente,
      e.asesor_id,
      ap.full_name AS asesor_nombre,
      e.etapa_actual,
      e.ciclo_estado,
      e.subestado,
      e.submitted_to_mesa,
      ed.monto_aprobado,
      ed.monto_aprobado_al_aprobar,
      ed.decision,
      e.created_at,
      e.fecha_envio_mesa
    FROM public.expedientes e
    JOIN public.profiles ap ON ap.id = e.asesor_id
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.organization_id = v_org
      AND e.asesor_id IN (SELECT public.asesor_lider_scope_asesor_ids(v_team))
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (p_etapa_exacta IS NULL OR e.etapa_actual = p_etapa_exacta)
      AND (p_fecha_desde IS NULL OR e.created_at::date >= p_fecha_desde)
      AND (p_fecha_hasta IS NULL OR e.created_at::date <= p_fecha_hasta)
      AND (
        v_ciclo IS NULL
        OR (v_ciclo = 'activo' AND e.ciclo_estado = 'activo')
        OR (v_ciclo = 'cerrado' AND e.ciclo_estado <> 'activo')
      )
      AND public.asesor_inbox_matches_buscar(
        e.cliente_nombre,
        e.nss::text,
        e.telefono_cliente::text,
        NULL,
        p_buscar
      )
  ),
  counted AS (
    SELECT count(*)::bigint AS total_count FROM scoped
  ),
  page_rows AS (
    SELECT *
    FROM scoped
    ORDER BY created_at DESC, id DESC
    OFFSET v_from
    LIMIT v_size
  )
  SELECT
    c.total_count,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', pr.id,
            'cliente_nombre', pr.cliente_nombre,
            'nss', pr.nss,
            'telefono_cliente', pr.telefono_cliente,
            'asesor_id', pr.asesor_id,
            'asesor_nombre', pr.asesor_nombre,
            'etapa_actual', pr.etapa_actual,
            'ciclo_estado', pr.ciclo_estado,
            'subestado', pr.subestado,
            'submitted_to_mesa', pr.submitted_to_mesa,
            'monto_aprobado', pr.monto_aprobado,
            'monto_aprobado_al_aprobar', pr.monto_aprobado_al_aprobar,
            'decision', pr.decision,
            'created_at', pr.created_at,
            'fecha_envio_mesa', pr.fecha_envio_mesa
          )
          ORDER BY pr.created_at DESC, pr.id DESC
        )
        FROM page_rows pr
      ),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM counted c;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_size,
    'has_more', coalesce(v_total, 0) > (v_from + v_size)
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_lider_list_expedientes_page(int, int, text, uuid, int, date, date, text) IS
  'Paginación server-side de expedientes del equipo del líder. page_size máx 100.';

-- ---------------------------------------------------------------------------
-- create_expediente_for_asesor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_expediente_for_asesor(
  p_asesor_id uuid,
  p_programa public.programa,
  p_nss text,
  p_cliente_nombre text,
  p_telefono_cliente text,
  p_direccion_opcional text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role public.app_role;
  v_org_id uuid;
  v_target public.profiles%ROWTYPE;
  v_origen_mesa public.origen_mesa;
  v_nss text;
  v_telefono text;
  v_nombre text;
  v_direccion text;
  v_expediente_id uuid;
  v_created_at timestamptz;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.profile_has_capability(v_actor_id, 'create_for_any_advisor') THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: sin capability create_for_any_advisor'
      USING ERRCODE = '42501';
  END IF;

  IF p_asesor_id IS NULL THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: p_asesor_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = p_asesor_id
    AND p.active = true
    AND p.app_role = 'asesor'
    AND p.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: asesor destino inválido o fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF p_programa IS NULL THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: programa es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_nombre := btrim(COALESCE(p_cliente_nombre, ''));
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: el nombre del cliente es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_nss := public.normalize_nss_mexico(p_nss);
  IF v_nss IS NULL OR v_nss !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: el NSS debe tener exactamente 11 dígitos'
      USING ERRCODE = '22023';
  END IF;

  v_telefono := btrim(COALESCE(p_telefono_cliente, ''));
  IF v_telefono !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: el teléfono debe tener exactamente 10 dígitos'
      USING ERRCODE = '22023';
  END IF;

  v_direccion := COALESCE(btrim(COALESCE(p_direccion_opcional, '')), '');

  -- origen_mesa desde el TARGET (no el actor)
  v_origen_mesa := COALESCE(v_target.tipo_asesor_origen::text, 'interno')::public.origen_mesa;

  IF public.nss_bloqueado_en_mesa(v_org_id, v_nss, p_programa, NULL) THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: Este NSS ya tiene un expediente enviado a Mesa.'
      USING ERRCODE = '23505';
  END IF;

  -- Duplicado activo NSS+programa (misma regla que índice único / create_expediente)
  IF EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.organization_id = v_org_id
      AND e.nss = v_nss
      AND e.programa = p_programa
      AND e.ciclo_estado = 'activo'
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: ya existe un expediente activo con ese NSS y programa'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.expedientes (
    organization_id,
    asesor_id,
    programa,
    nss,
    cliente_nombre,
    telefono_cliente,
    direccion_opcional,
    origen_mesa,
    ciclo_estado,
    submitted_to_mesa,
    etapa_actual,
    subestado,
    deleted_at
  ) VALUES (
    v_org_id,
    p_asesor_id,
    p_programa,
    v_nss,
    v_nombre,
    v_telefono,
    v_direccion,
    v_origen_mesa,
    'activo',
    false,
    1,
    'pendiente',
    NULL
  )
  RETURNING id, created_at INTO v_expediente_id, v_created_at;

  INSERT INTO public.editor_decisions (
    expediente_id,
    organization_id,
    decision,
    monto_aprobado,
    notas_revision
  ) VALUES (
    v_expediente_id,
    v_org_id,
    'pendiente',
    NULL,
    ''
  );

  PERFORM public.log_action(
    v_org_id,
    v_actor_id,
    v_actor_role,
    'expediente.create',
    'expediente',
    v_expediente_id,
    jsonb_build_object(
      'programa', p_programa,
      -- Sin NSS completo (requisito alta delegada); solo sufijo de auditoría.
      'nss_sufijo', right(v_nss, 4),
      'origen_mesa', v_origen_mesa,
      'asesor_id', p_asesor_id,
      'target_asesor_id', p_asesor_id,
      'organization_id', v_org_id,
      'etapa_actual', 1,
      'subestado', 'pendiente',
      'ciclo_estado', 'activo',
      'created_for_any_advisor', true
    )
  );

  RETURN jsonb_build_object(
    'id', v_expediente_id,
    'organization_id', v_org_id,
    'asesor_id', p_asesor_id,
    'origen_mesa', v_origen_mesa,
    'programa', p_programa,
    'nss', v_nss,
    'cliente_nombre', v_nombre,
    'telefono_cliente', v_telefono,
    'direccion_opcional', v_direccion,
    'etapa_actual', 1,
    'subestado', 'pendiente',
    'ciclo_estado', 'activo',
    'submitted_to_mesa', false,
    'created_at', v_created_at
  );
END;
$$;

COMMENT ON FUNCTION public.create_expediente_for_asesor(uuid, public.programa, text, text, text, text) IS
  'Alta de expediente a nombre de otro asesor. Requiere create_for_any_advisor. Paridad de gates con create_expediente (049).';

-- =============================================================================
-- Grants RPCs (5 + profile_has_capability(text) ya otorgado arriba)
-- =============================================================================

REVOKE ALL ON FUNCTION public.asesor_lider_get_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_lider_get_context() FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_lider_get_context() TO authenticated;

REVOKE ALL ON FUNCTION public.asesor_lider_list_members() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_lider_list_members() FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_lider_list_members() TO authenticated;

REVOKE ALL ON FUNCTION public.asesor_lider_get_dashboard(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_lider_get_dashboard(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_lider_get_dashboard(uuid, date, date) TO authenticated;

REVOKE ALL ON FUNCTION public.asesor_lider_list_expedientes_page(int, int, text, uuid, int, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_lider_list_expedientes_page(int, int, text, uuid, int, date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_lider_list_expedientes_page(int, int, text, uuid, int, date, date, text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_expediente_for_asesor(uuid, public.programa, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_expediente_for_asesor(uuid, public.programa, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_expediente_for_asesor(uuid, public.programa, text, text, text, text) TO authenticated;

-- =============================================================================
-- 4. Seed idempotente (solo Silvia)
-- =============================================================================

DO $$
DECLARE
  v_silvia public.profiles%ROWTYPE;
  v_team_id uuid;
BEGIN
  SELECT * INTO v_silvia
  FROM public.profiles p
  WHERE lower(p.email) = lower('silvia.reyes@concasa.mx')
    AND p.active = true
    AND p.app_role = 'asesor'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'seed Team Silvia: perfil silvia.reyes@concasa.mx no encontrado como asesor activo — skip';
    RETURN;
  END IF;

  INSERT INTO public.profile_capabilities (profile_id, capability, active)
  VALUES (v_silvia.id, 'team_dashboard_read', true)
  ON CONFLICT (profile_id, capability) DO UPDATE
    SET active = true,
        updated_at = now();

  SELECT t.id INTO v_team_id
  FROM public.asesor_equipos t
  WHERE t.leader_id = v_silvia.id
    AND t.active = true
  LIMIT 1;

  IF v_team_id IS NULL THEN
    INSERT INTO public.asesor_equipos (
      organization_id,
      nombre,
      leader_id,
      active
    ) VALUES (
      v_silvia.organization_id,
      'Equipo Silvia Reyes',
      v_silvia.id,
      true
    )
    RETURNING id INTO v_team_id;
  END IF;

  RAISE NOTICE 'seed Team Silvia: capability + equipo listos (team_id=%)', v_team_id;
END;
$$;

-- Integrate: save_cliente_datos (ownership OR integrate_for_any_advisor)
CREATE OR REPLACE FUNCTION public.save_cliente_datos(p_expediente_id uuid, p_rfc text, p_telefono text, p_referencias jsonb DEFAULT '[]'::jsonb, p_imagenes jsonb DEFAULT NULL::jsonb, p_datos jsonb DEFAULT '{}'::jsonb, p_estado cliente_datos_estado DEFAULT 'completo'::cliente_datos_estado, p_porcentaje_cobro numeric DEFAULT NULL::numeric, p_metodo_pago text DEFAULT NULL::text, p_direccion_opcional text DEFAULT NULL::text, p_monto_calculado_manual numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $save_cd$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_prev public.cliente_datos%ROWTYPE;
  v_rfc TEXT;
  v_telefono_norm TEXT;
  v_referencias_norm JSONB := '[]'::JSONB;
  v_imagenes_norm JSONB;
  v_imagenes_final JSONB;
  v_datos_final JSONB;
  v_ref JSONB;
  v_img JSONB;
  v_nombre_raw TEXT;
  v_nombre_norm TEXT;
  v_ref_tel_raw TEXT;
  v_ref_tel_norm TEXT;
  v_ruta_imagen TEXT;
  v_mime TEXT;
  v_size NUMERIC;
  v_payload_phones TEXT[] := ARRAY[]::TEXT[];
  v_payload_names TEXT[] := ARRAY[]::TEXT[];
  v_updated_at TIMESTAMPTZ;
  v_referencias_count INTEGER;
  v_imagenes_count INTEGER;
  v_editor public.editor_decisions%ROWTYPE;
  v_monto_aprobado NUMERIC;
  v_porcentaje NUMERIC;
  v_metodo TEXT;
  v_monto_calculado NUMERIC(12,2);
  v_monto_calculado_auto NUMERIC(12,2);
  v_base_cobro NUMERIC(12,2);
  v_monto_mejoravit_actualizado NUMERIC(12,2);
  v_direccion TEXT;
  v_cliente_nombre_datos TEXT;
  v_estado_final public.cliente_datos_estado;
  i INTEGER;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_cliente_datos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'save_cliente_datos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente no encontrado'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente eliminado'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente no activo (%)', v_exp.ciclo_estado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.organization_id <> v_org_id THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente de otra organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id <> v_actor_id
     AND NOT public.profile_has_capability(v_actor_id, 'integrate_for_any_advisor') THEN
    RAISE EXCEPTION 'save_cliente_datos: solo el asesor dueño puede guardar datos del cliente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa THEN
    IF current_setting('concasa.cliente_datos_correccion', true) IS DISTINCT FROM '1'
       AND current_setting('concasa.cliente_datos_actualizacion_post_mesa', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'save_cliente_datos: expediente ya enviado a Mesa'
        USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.cliente_datos cd
      WHERE cd.expediente_id = p_expediente_id
    ) THEN
      -- Hotfix 151: primer alta solo con reingreso activo + flag post_mesa.
      IF current_setting('concasa.cliente_datos_actualizacion_post_mesa', true) IS DISTINCT FROM '1'
         OR NOT public.es_reingreso_asesor_edicion_activa(p_expediente_id) THEN
        RAISE EXCEPTION 'save_cliente_datos: faltan datos del cliente en expediente enviado a Mesa'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;


  -- P133: formatos de payload entrante (no muta filas existentes)
  PERFORM public.cliente_datos_assert_payload_formats(
    COALESCE(p_datos, '{}'::JSONB),
    COALESCE(p_referencias, '[]'::JSONB),
    p_telefono,
    p_rfc
  );

  -- P189 B2.1: unicidad intra-payload (no unique global / no otros expedientes)
  PERFORM public.cliente_datos_assert_telefonos_unicos(
    COALESCE(p_datos, '{}'::JSONB),
    COALESCE(p_referencias, '[]'::JSONB),
    p_telefono
  );

  v_direccion := NULLIF(btrim(COALESCE(p_direccion_opcional, '')), '');
  v_cliente_nombre_datos := btrim(COALESCE(p_datos->>'nombreCliente', ''));

  UPDATE public.expedientes
  SET direccion_opcional = COALESCE(v_direccion, ''),
      cliente_nombre = CASE
        WHEN v_cliente_nombre_datos <> '' THEN v_cliente_nombre_datos
        ELSE cliente_nombre
      END,
      updated_at = NOW()
  WHERE id = p_expediente_id;

  -- Información de cobro (monto calculado automático)
  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND
     OR v_editor.monto_aprobado IS NULL
     OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'save_cliente_datos: No hay monto aprobado para calcular el cobro.'
      USING ERRCODE = '22023';
  END IF;

  v_monto_aprobado := v_editor.monto_aprobado;

  IF p_porcentaje_cobro IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: porcentaje de cobro es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_porcentaje := p_porcentaje_cobro::NUMERIC;

  IF v_porcentaje <= 0 OR v_porcentaje > 100 THEN
    RAISE EXCEPTION 'save_cliente_datos: porcentaje de cobro inválido'
      USING ERRCODE = '22023';
  END IF;

  v_metodo := btrim(COALESCE(p_metodo_pago, ''));
  IF v_metodo = '' THEN
    RAISE EXCEPTION 'save_cliente_datos: método de pago es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  -- P090: precedencia operativa (override Mesa > JSON > fallback editor)
  SELECT cd.monto_mejoravit_actualizado
  INTO v_monto_mejoravit_actualizado
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF lower(btrim(v_exp.programa::text)) = 'mejoravit' THEN
    v_base_cobro := public.resolve_monto_operativo_mejoravit(
      v_monto_mejoravit_actualizado,
      p_datos,
      v_monto_aprobado
    );
  ELSE
    v_base_cobro := v_monto_aprobado;
  END IF;

  v_monto_calculado_auto := round(v_base_cobro * v_porcentaje / 100 + 3000, 2);

  IF p_monto_calculado_manual IS NOT NULL THEN
    IF p_monto_calculado_manual <= 0 THEN
      RAISE EXCEPTION 'save_cliente_datos: monto calculado manual inválido'
        USING ERRCODE = '22023';
    END IF;
    v_monto_calculado := round(p_monto_calculado_manual, 2);
  ELSE
    v_monto_calculado := v_monto_calculado_auto;
  END IF;

  -- RFC (opcional: vacío permitido; si tiene valor, validar formato)
  v_rfc := upper(btrim(COALESCE(p_rfc, '')));
  IF v_rfc <> '' AND (length(v_rfc) NOT IN (12, 13) OR NOT public.is_rfc_mexico_valido(v_rfc)) THEN
    RAISE EXCEPTION 'save_cliente_datos: RFC inválido'
      USING ERRCODE = '22023';
  END IF;

  -- Teléfono principal
  IF NULLIF(btrim(COALESCE(p_telefono, '')), '') IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: teléfono obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_telefono_norm := public.normalize_telefono_mexico(p_telefono);
  IF v_telefono_norm IS NULL OR length(v_telefono_norm) <> 10 OR v_telefono_norm !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'save_cliente_datos: teléfono inválido'
      USING ERRCODE = '22023';
  END IF;

  v_payload_phones := array_append(v_payload_phones, v_telefono_norm);

  -- Estado (asesor solo completo o pendiente)
  IF p_estado = 'validado' THEN
    RAISE EXCEPTION 'save_cliente_datos: asesor no puede marcar validado'
      USING ERRCODE = '22023';
  END IF;

  IF p_estado NOT IN ('completo', 'pendiente') THEN
    RAISE EXCEPTION 'save_cliente_datos: estado inválido'
      USING ERRCODE = '22023';
  END IF;

  -- Referencias
  IF p_referencias IS NULL OR jsonb_typeof(p_referencias) <> 'array' THEN
    RAISE EXCEPTION 'save_cliente_datos: referencias debe ser array'
      USING ERRCODE = '22023';
  END IF;

  FOR i IN 0..jsonb_array_length(p_referencias) - 1 LOOP
    v_ref := p_referencias->i;
    v_nombre_raw := btrim(COALESCE(v_ref->>'nombre', ''));
    IF v_nombre_raw = '' THEN
      RAISE EXCEPTION 'save_cliente_datos: nombre de referencia obligatorio'
        USING ERRCODE = '22023';
    END IF;

    v_nombre_norm := public.normalize_nombre_referencia(v_nombre_raw);
    IF v_nombre_norm = ANY(v_payload_names) THEN
      RAISE EXCEPTION 'save_cliente_datos: nombre de referencia repetido'
        USING ERRCODE = '22023';
    END IF;
    v_payload_names := array_append(v_payload_names, v_nombre_norm);

    v_ref_tel_raw := public.referencia_telefono_raw(v_ref);
    IF NULLIF(btrim(COALESCE(v_ref_tel_raw, '')), '') IS NULL THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono de referencia inválido'
        USING ERRCODE = '22023';
    END IF;

    v_ref_tel_norm := public.normalize_telefono_mexico(v_ref_tel_raw);
    IF v_ref_tel_norm IS NULL OR length(v_ref_tel_norm) <> 10 OR v_ref_tel_norm !~ '^[0-9]{10}$' THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono de referencia inválido'
        USING ERRCODE = '22023';
    END IF;

    IF v_ref_tel_norm = v_telefono_norm THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono repetido en referencias'
        USING ERRCODE = '22023';
    END IF;

    IF v_ref_tel_norm = ANY(v_payload_phones) THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono de referencia repetido'
        USING ERRCODE = '22023';
    END IF;
    v_payload_phones := array_append(v_payload_phones, v_ref_tel_norm);

    v_referencias_norm := v_referencias_norm || jsonb_build_array(
      jsonb_build_object(
        'nombre', v_nombre_raw,
        'telefono', v_ref_tel_norm,
        'celular', v_ref_tel_norm
      )
    );
  END LOOP;

  -- Duplicados cross-expediente (con lock por org+teléfono)
  FOR i IN 1..array_length(v_payload_phones, 1) LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext(v_org_id::text || ':' || v_payload_phones[i])
    );

    IF public.cliente_datos_telefono_ocupado_en_org(
      v_org_id,
      p_expediente_id,
      v_payload_phones[i]
    ) THEN
      IF v_payload_phones[i] = v_telefono_norm THEN
        RAISE EXCEPTION 'save_cliente_datos: teléfono repetido'
          USING ERRCODE = '22023';
      ELSE
        RAISE EXCEPTION 'save_cliente_datos: teléfono de referencia repetido'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  -- Imágenes (metadata/rutas; sin binarios)
  SELECT cd.*
  INTO v_prev
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF p_imagenes IS NULL THEN
    v_imagenes_final := COALESCE(v_prev.imagenes, '[]'::JSONB);
  ELSE
    IF jsonb_typeof(p_imagenes) <> 'array' THEN
      RAISE EXCEPTION 'save_cliente_datos: imagenes debe ser array'
        USING ERRCODE = '22023';
    END IF;

    v_imagenes_norm := '[]'::JSONB;
    FOR i IN 0..jsonb_array_length(p_imagenes) - 1 LOOP
      v_img := p_imagenes->i;
      v_ruta_imagen := NULLIF(
        btrim(
          COALESCE(
            v_img->>'storage_path',
            v_img->>'url',
            v_img->>'public_url',
            ''
          )
        ),
        ''
      );

      IF v_ruta_imagen IS NULL THEN
        RAISE EXCEPTION 'save_cliente_datos: imagen sin ruta'
          USING ERRCODE = '22023';
      END IF;

      IF v_img ? 'filename' AND NULLIF(btrim(COALESCE(v_img->>'filename', '')), '') IS NULL THEN
        RAISE EXCEPTION 'save_cliente_datos: imagen sin ruta'
          USING ERRCODE = '22023';
      END IF;

      IF v_img ? 'mime_type' THEN
        v_mime := lower(btrim(COALESCE(v_img->>'mime_type', '')));
        IF v_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
          RAISE EXCEPTION 'save_cliente_datos: mime_type de imagen inválido'
            USING ERRCODE = '22023';
        END IF;
      END IF;

      IF v_img ? 'size_bytes' THEN
        BEGIN
          v_size := (v_img->>'size_bytes')::NUMERIC;
        EXCEPTION
          WHEN OTHERS THEN
            RAISE EXCEPTION 'save_cliente_datos: size_bytes inválido'
              USING ERRCODE = '22023';
        END;

        IF v_size IS NULL OR v_size <= 0 THEN
          RAISE EXCEPTION 'save_cliente_datos: size_bytes inválido'
            USING ERRCODE = '22023';
        END IF;
      END IF;

      v_imagenes_norm := v_imagenes_norm || jsonb_build_array(
        jsonb_strip_nulls(
          jsonb_build_object(
            'storage_path', NULLIF(btrim(COALESCE(v_img->>'storage_path', '')), ''),
            'url', NULLIF(btrim(COALESCE(v_img->>'url', '')), ''),
            'public_url', NULLIF(btrim(COALESCE(v_img->>'public_url', '')), ''),
            'filename', NULLIF(btrim(COALESCE(v_img->>'filename', '')), ''),
            'mime_type', NULLIF(lower(btrim(COALESCE(v_img->>'mime_type', ''))), ''),
            'size_bytes', CASE
              WHEN v_img ? 'size_bytes' THEN (v_img->>'size_bytes')::BIGINT
              ELSE NULL
            END,
            'tipo', NULLIF(btrim(COALESCE(v_img->>'tipo', '')), '')
          )
        )
      );
    END LOOP;

    v_imagenes_final := v_imagenes_norm;
  END IF;

  v_datos_final := COALESCE(p_datos, '{}'::JSONB)
    || jsonb_build_object(
      'rfc', v_rfc,
      'celular', v_telefono_norm,
      'telefono', v_telefono_norm,
      'referencias', v_referencias_norm
    );

  BEGIN
    INSERT INTO public.cliente_datos (
      expediente_id,
      organization_id,
      datos,
      estado,
      telefono_normalizado,
      referencias,
      imagenes,
      updated_by,
      porcentaje_cobro,
      monto_calculado,
      metodo_pago
    ) VALUES (
      p_expediente_id,
      v_exp.organization_id,
      v_datos_final,
      p_estado,
      v_telefono_norm,
      v_referencias_norm,
      v_imagenes_final,
      v_actor_id,
      v_porcentaje,
      v_monto_calculado,
      v_metodo
    )
    ON CONFLICT (expediente_id) DO UPDATE SET
      datos = EXCLUDED.datos,
      estado = CASE
        WHEN current_setting('concasa.cliente_datos_actualizacion_post_mesa', true) = '1'
          THEN public.cliente_datos.estado
        ELSE EXCLUDED.estado
      END,
      telefono_normalizado = EXCLUDED.telefono_normalizado,
      referencias = EXCLUDED.referencias,
      imagenes = EXCLUDED.imagenes,
      updated_by = EXCLUDED.updated_by,
      porcentaje_cobro = EXCLUDED.porcentaje_cobro,
      monto_calculado = EXCLUDED.monto_calculado,
      metodo_pago = EXCLUDED.metodo_pago,
      comentario_rechazo = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.comentario_rechazo
      END,
      rejected_at = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.rejected_at
      END,
      rejected_by = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.rejected_by
      END,
      validated_at = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.validated_at
      END,
      validated_by = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.validated_by
      END,
      updated_at = NOW()
    RETURNING updated_at, estado INTO v_updated_at, v_estado_final;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono repetido'
        USING ERRCODE = '22023';
  END;

  v_referencias_count := jsonb_array_length(v_referencias_norm);
  v_imagenes_count := jsonb_array_length(v_imagenes_final);

  IF v_estado_final IS NULL THEN
    SELECT cd.estado
    INTO v_estado_final
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    CASE
      WHEN current_setting('concasa.cliente_datos_correccion', true) = '1'
        THEN 'cliente_datos.correccion_post_mesa'
      WHEN current_setting('concasa.cliente_datos_actualizacion_post_mesa', true) = '1'
        THEN 'cliente_datos.actualizado_post_mesa'
      ELSE 'cliente_datos.save'
    END,
    'cliente_datos',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'rfc_anterior', COALESCE(v_prev.datos->>'rfc', NULL),
      'rfc_nuevo', v_rfc,
      'telefono_anterior', COALESCE(v_prev.telefono_normalizado, public.normalize_telefono_mexico(v_prev.datos->>'celular')),
      'telefono_nuevo', v_telefono_norm,
      'estado_anterior', COALESCE(v_prev.estado::TEXT, NULL),
      'estado_nuevo', COALESCE(v_estado_final::TEXT, p_estado::TEXT),
      'referencias_count', v_referencias_count,
      'imagenes_count', v_imagenes_count,
      'actor_id', v_actor_id,
      'direccion_opcional', v_direccion,
      'cliente_nombre_anterior', NULLIF(btrim(COALESCE(v_exp.cliente_nombre, '')), ''),
      'cliente_nombre_nuevo', NULLIF(v_cliente_nombre_datos, '')
    )
  );

  PERFORM set_config('concasa.cliente_datos_correccion', '', true);
  PERFORM set_config('concasa.cliente_datos_actualizacion_post_mesa', '', true);

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'rfc', v_rfc,
    'telefono', v_telefono_norm,
    'estado', COALESCE(v_estado_final, p_estado),
    'referencias_count', v_referencias_count,
    'imagenes_count', v_imagenes_count,
    'porcentaje_cobro', v_porcentaje,
    'monto_calculado', v_monto_calculado,
    'metodo_pago', v_metodo,
    'direccion_opcional', v_direccion,
    'updated_at', v_updated_at
  );
END;
$save_cd$;

-- Integrate: enviar_a_mesa
CREATE OR REPLACE FUNCTION public.enviar_a_mesa(p_expediente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $enviar_mesa$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_editor public.editor_decisions%ROWTYPE;
  v_cliente public.cliente_datos%ROWTYPE;
  v_docs_count INTEGER;
  v_etapa_anterior SMALLINT;
  v_subestado_anterior public.operativo_subestado;
  v_now TIMESTAMPTZ := NOW();
  v_elig JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'enviar_a_mesa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.programa,
    e.nss,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at,
    e.origen_mesa
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id
     AND NOT public.profile_has_capability(v_actor_id, 'integrate_for_any_advisor') THEN
    RAISE EXCEPTION 'enviar_a_mesa: solo el asesor dueño puede enviar a Mesa'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'enviar_a_mesa: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    RAISE EXCEPTION 'enviar_a_mesa: el expediente ya fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: falta decisión del editor'
      USING ERRCODE = '22023';
  END IF;

  IF v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'enviar_a_mesa: monto aprobado del editor debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cliente
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan datos del cliente'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.porcentaje_cobro IS NULL
     OR v_cliente.porcentaje_cobro <= 0
     OR v_cliente.monto_calculado IS NULL
     OR btrim(COALESCE(v_cliente.metodo_pago, '')) = '' THEN
    RAISE EXCEPTION 'enviar_a_mesa: Faltan datos obligatorios del cliente: porcentaje de cobro, monto calculado, método de pago.'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado NOT IN ('completo', 'validado') THEN
    RAISE EXCEPTION 'enviar_a_mesa: datos del cliente deben estar completos o validados (actual: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  v_elig := public.p189_infonavit_get_eligibility(p_expediente_id);
  IF COALESCE((v_elig->>'required')::boolean, false) THEN
    PERFORM public.assert_mejoravit_infonavit_datos_persistidos(p_expediente_id);
  END IF;

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);

  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan documentos obligatorios de integración (% de %)', v_docs_count, cardinality(public.integration_doc_tipos_asesor_envio())
      USING ERRCODE = '22023';
  END IF;

  IF public.nss_bloqueado_en_mesa(v_exp.organization_id, v_exp.nss, v_exp.programa, p_expediente_id) THEN
    RAISE EXCEPTION 'NSS_YA_BLOQUEADO: Este NSS ya tiene un expediente enviado a Mesa.'
      USING ERRCODE = '23505';
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;

  UPDATE public.expedientes
  SET
    submitted_to_mesa = true,
    fecha_envio_mesa = v_now,
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    updated_at = v_now
  WHERE id = p_expediente_id;

  IF COALESCE((v_elig->>'should_enqueue')::boolean, false) THEN
    PERFORM public.enqueue_infonavit_pdf_submission(
      p_expediente_id,
      v_exp.organization_id,
      0,
      'initial',
      v_now
    );
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.enviar_a_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'asesor_id', v_exp.asesor_id,
      'organization_id', v_exp.organization_id,
      'etapa_anterior', v_etapa_anterior,
      'etapa_nueva', 1,
      'subestado_anterior', v_subestado_anterior,
      'subestado_nuevo', 'en_validacion_mesa',
      'documentos_obligatorios_count', v_docs_count,
      'documentos_asesor_envio_count', v_docs_count,
      'editor_decision_id', v_editor.expediente_id,
      'origen_mesa', v_exp.origen_mesa
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'etapa_actual', 1,
    'subestado', 'en_validacion_mesa',
    'operativo_subestado', 'en_validacion_mesa',
    'submitted_to_mesa', true,
    'enviado_a_mesa', true,
    'documentos_obligatorios_count', v_docs_count
  );
END;
$enviar_mesa$;

-- Integrate: register_expediente_documento (reingreso path)
CREATE OR REPLACE FUNCTION public.register_expediente_documento(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $reg_doc$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');

  IF NOT (
    v_tipo = ANY(public.integration_doc_tipos_asesor_upload())
    AND public.es_reingreso_asesor_edicion_activa(p_expediente_id)
  ) THEN
    RETURN public.register_expediente_documento_pre_reingreso(
      p_expediente_id, p_tipo_documento, p_storage_path,
      p_nombre_original, p_mime_type, p_size_bytes
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF v_actor_id IS NULL OR NOT FOUND
     OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR (
       v_exp.asesor_id IS DISTINCT FROM v_actor_id
       AND NOT public.profile_has_capability(v_actor_id, 'integrate_for_any_advisor')
     )
     OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id
     OR v_exp.deleted_at IS NOT NULL
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: solo el asesor dueño puede cargar documentos'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.es_reingreso_asesor_edicion_activa(p_expediente_id) THEN
    RAISE EXCEPTION 'register_expediente_documento: reingreso no válido para este documento'
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = ''
     OR p_nombre_original IS NULL OR btrim(p_nombre_original) = ''
     OR p_size_bytes IS NULL OR p_size_bytes <= 0
     OR p_size_bytes > public.expediente_documento_max_size_bytes()
     OR NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo)
     OR NOT public.expediente_documento_storage_path_valid(
       btrim(p_storage_path), v_exp.organization_id, p_expediente_id, v_tipo
     ) THEN
    RAISE EXCEPTION 'register_expediente_documento: metadata o path inválido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_exp.organization_id, p_expediente_id, v_tipo, btrim(p_storage_path),
    btrim(p_nombre_original), lower(btrim(p_mime_type)), p_size_bytes, v_new_version,
    v_new_estatus, v_actor_id, 'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'expediente.documento.register',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', lower(btrim(p_mime_type)),
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL,
      'reingreso_docs_update', true,
      'reingreso_edicion_completa', true
    )
  );

  IF v_prev_id IS NOT NULL THEN
    PERFORM public.asesor_cambio_record_doc_reemplazo(
      v_exp.organization_id,
      p_expediente_id,
      v_actor_id,
      v_tipo,
      v_prev_id,
      v_new_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'reemplazo', v_prev_id IS NOT NULL,
    'integration_docs_presentes', public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos', public.integration_docs_completos(p_expediente_id)
  );
END;
$reg_doc$;

-- Integrate: register_expediente_documento_pre_reingreso
CREATE OR REPLACE FUNCTION public.register_expediente_documento_pre_reingreso(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $reg_pre$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento no permitido para upload asesor (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id
     AND NOT public.profile_has_capability(v_actor_id, 'integrate_for_any_advisor') THEN
    RAISE EXCEPTION 'register_expediente_documento: solo el asesor dueño puede registrar documentos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    IF EXISTS (
      SELECT 1
      FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.tipo_documento = v_tipo
        AND d.deleted_at IS NULL
    ) THEN
      NULL;
    ELSIF v_tipo = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'register_expediente_documento: el expediente ya fue enviado a Mesa'
        USING ERRCODE = '22023';
    END IF;
  END IF;


  -- P132: Notificación canónica (`cliente_notificacion`) solo desde etapa 7+.
  -- `cliente_notificacion_apodaca` («Notificación» compartida) no tiene gate de etapa.
  IF v_tipo = 'cliente_notificacion'
     AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_expediente_documento: El documento Notificación solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    uploaded_by,
    uploaded_by_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_tipo,
    btrim(p_storage_path),
    btrim(p_nombre_original),
    lower(btrim(p_mime_type)),
    p_size_bytes,
    v_new_version,
    v_new_estatus,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.register',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', lower(btrim(p_mime_type)),
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL
    )
  );


  -- P130: reemplazo post-Mesa vía register_expediente_documento (sin rechazo previo)
  IF v_prev_id IS NOT NULL
     AND v_exp.submitted_to_mesa IS TRUE THEN
    PERFORM public.asesor_cambio_record_doc_reemplazo(
      v_exp.organization_id,
      p_expediente_id,
      v_actor_id,
      v_tipo,
      v_prev_id,
      v_new_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'integration_docs_presentes', public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos', public.integration_docs_completos(p_expediente_id)
  );
END;
$reg_pre$;

-- list_asesores_activos_org (create_for_any_advisor; no exige liderazgo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_asesores_activos_org()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role public.app_role;
  v_org_id uuid;
  v_items jsonb;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'list_asesores_activos_org: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'list_asesores_activos_org: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'list_asesores_activos_org: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.profile_has_capability(v_actor_id, 'create_for_any_advisor') THEN
    RAISE EXCEPTION 'list_asesores_activos_org: sin capability create_for_any_advisor'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'email', p.email
      )
      ORDER BY p.full_name ASC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.profiles p
  WHERE p.organization_id = v_org_id
    AND p.active = true
    AND p.app_role = 'asesor';

  RETURN jsonb_build_object('asesores', coalesce(v_items, '[]'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.list_asesores_activos_org() IS
  'Lista asesores activos de la org [{id, full_name, email}]. Requiere create_for_any_advisor (no exige ser líder de equipo).';

REVOKE ALL ON FUNCTION public.list_asesores_activos_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_asesores_activos_org() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_asesores_activos_org() TO authenticated;
