-- Team Silvia: equipo líder + capabilities (create/integrate) + RLS + integrate real.
-- Fixtures propias; cleanup por prefijo silvia-test- / NSS 99881.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__silvia_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'SILVIA FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__silvia_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__silvia_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

\i supabase/tests/_p189_infonavit_datos_fixture.sql

-- =============================================================================
-- Contrato estático: existencia, DEFINER, grants, patches integrate, no-widen
-- =============================================================================
DO $$
DECLARE
  v_src TEXT;
  v_oid OID;
  v_names TEXT[] := ARRAY[
    'asesor_lider_get_context',
    'asesor_lider_list_members',
    'asesor_lider_get_dashboard',
    'asesor_lider_list_expedientes_page',
    'create_expediente_for_asesor'
  ];
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name
    ORDER BY p.oid
    LIMIT 1;
    PERFORM public.__silvia_assert(v_oid IS NOT NULL, v_name || ' existe');
    PERFORM public.__silvia_assert(position('SECURITY DEFINER' in v_src) > 0, v_name || ' DEFINER');
    PERFORM public.__silvia_assert(EXISTS (
      SELECT 1 FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name = v_name
        AND grantee = 'authenticated'
        AND privilege_type = 'EXECUTE'
    ), v_name || ' grant authenticated');
    PERFORM public.__silvia_assert(NOT EXISTS (
      SELECT 1 FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name = v_name
        AND grantee = 'PUBLIC'
        AND privilege_type = 'EXECUTE'
    ), v_name || ' sin PUBLIC');
  END LOOP;

  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_cliente_datos'
  ORDER BY p.oid DESC
  LIMIT 1;
  PERFORM public.__silvia_assert(v_oid IS NOT NULL, 'save_cliente_datos existe');
  PERFORM public.__silvia_assert(
    position('asesor_can_operate_expediente_as' in v_src) > 0,
    '14 save_cliente_datos usa CAN_OPERATE team-scoped'
  );

  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'enviar_a_mesa'
  ORDER BY p.oid DESC
  LIMIT 1;
  PERFORM public.__silvia_assert(v_oid IS NOT NULL, 'enviar_a_mesa existe');
  PERFORM public.__silvia_assert(
    position('asesor_can_operate_expediente_as' in v_src) > 0,
    '15 enviar_a_mesa usa CAN_OPERATE team-scoped'
  );

  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'can_see_expediente'
  ORDER BY p.oid DESC
  LIMIT 1;
  PERFORM public.__silvia_assert(v_oid IS NOT NULL, 'can_see_expediente existe');
  PERFORM public.__silvia_assert(
    position('integrate_for_any_advisor' in v_src) > 0,
    '16 can_see_expediente contiene integrate_for_any_advisor'
  );
  PERFORM public.__silvia_assert(
    position('asesor_comparten_equipo_activo' in v_src) > 0,
    '16b can_see usa team scope comparten_equipo'
  );
  PERFORM public.__silvia_assert(
    position('team_dashboard' in lower(v_src)) = 0,
    '16c can_see sin team_dashboard'
  );

  PERFORM public.__silvia_assert(EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'profile_has_capability'
  ), 'profile_has_capability existe');

  RAISE NOTICE 'SILVIA OK: contrato estático';
END;
$$;

-- =============================================================================
-- Fixtures + RLS + comportamentales + integrate real + monto multi-programa
-- =============================================================================
DO $$
DECLARE
  v_org UUID := gen_random_uuid();
  v_org2 UUID := gen_random_uuid();
  v_leader UUID := gen_random_uuid();
  v_a UUID := gen_random_uuid();          -- Adriana
  v_b UUID := gen_random_uuid();
  v_c UUID := gen_random_uuid();          -- member C sin caps
  v_hector UUID := gen_random_uuid();
  v_oziel UUID := gen_random_uuid();
  v_outsider UUID := gen_random_uuid();
  v_inactive UUID := gen_random_uuid();
  v_editor UUID := gen_random_uuid();
  v_other_org UUID := gen_random_uuid();
  v_super UUID := gen_random_uuid();
  v_monto UUID := gen_random_uuid();      -- solo para dashboard monto
  v_team UUID;
  v_exp_a UUID;
  v_exp_out UUID;
  v_exp_b UUID;
  v_exp_enviar UUID;
  v_exp_enviar_deny UUID;
  v_exp_monto_mv UUID;
  v_exp_monto_sc UUID;
  v_exp_monto_ctc UUID;
  v_created UUID;
  v_page JSONB;
  v_members JSONB;
  v_ctx JSONB;
  v_dash JSONB;
  v_fail BOOLEAN;
  v_submitted BOOLEAN;
  v_sqlstate TEXT;
  v_cnt BIGINT;
  v_asesor_id UUID;
  v_actor UUID;
  v_uploaded_by UUID;
  v_updated_by UUID;
  v_path TEXT;
  v_path_c TEXT;
  v_tipo TEXT;
  v_nss_a TEXT := '99881000001';
  v_nss_out TEXT := '99881000002';
  v_nss_create TEXT := '99881000010';
  v_nss_hector TEXT := '99881000011';
  v_nss_dup TEXT := '99881000012';
  v_nss_enviar TEXT := '99881000030';
  v_nss_enviar_deny TEXT := '99881000031';
  v_nss_monto_mv TEXT := '99881000040';
  v_nss_monto_sc TEXT := '99881000041';
  v_nss_monto_ctc TEXT := '99881000042';
BEGIN
  -- Limpieza residual de corridas previas
  -- Asegurar políticas acíclicas (contrato migración: miembros NO listan equipos).
  EXECUTE 'DROP POLICY IF EXISTS asesor_equipos_select ON public.asesor_equipos';
  EXECUTE $pol$
    CREATE POLICY asesor_equipos_select
      ON public.asesor_equipos
      FOR SELECT
      TO authenticated
      USING (
        leader_id = auth.uid()
        OR (
          public.is_super_admin()
          AND organization_id = public.current_organization_id()
        )
      )
  $pol$;
  EXECUTE 'DROP POLICY IF EXISTS asesor_equipo_miembros_select ON public.asesor_equipo_miembros';
  EXECUTE $pol$
    CREATE POLICY asesor_equipo_miembros_select
      ON public.asesor_equipo_miembros
      FOR SELECT
      TO authenticated
      USING (
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
      )
  $pol$;

  -- -------------------------------------------------------------------------
  -- Limpieza residual
  -- -------------------------------------------------------------------------
  DELETE FROM public.action_log
  WHERE entity_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  )
  OR actor_id IN (
    SELECT id FROM public.profiles WHERE email LIKE 'silvia-test-%@test.local'
  );
  DELETE FROM public.agenda_bookings
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  -- storage.objects: no DELETE (protect_objects_delete + owner supabase_storage_admin).
  -- Paths usan org/exp UUID únicos por corrida; ON CONFLICT DO NOTHING en inserts.
  DELETE FROM public.cliente_datos
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  DELETE FROM public.editor_decisions
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  DELETE FROM public.expedientes
  WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%';
  DELETE FROM public.asesor_equipo_miembros
  WHERE team_id IN (
    SELECT id FROM public.asesor_equipos WHERE nombre LIKE 'SILVIA Test%'
  );
  DELETE FROM public.asesor_equipos WHERE nombre LIKE 'SILVIA Test%';
  DELETE FROM public.profile_capabilities
  WHERE profile_id IN (
    SELECT id FROM public.profiles WHERE email LIKE 'silvia-test-%@test.local'
  );
  DELETE FROM public.profiles WHERE email LIKE 'silvia-test-%@test.local';
  DELETE FROM public.organizations WHERE slug LIKE 'silvia-test-%';

  -- -------------------------------------------------------------------------
  -- Orgs + profiles + caps + team
  -- -------------------------------------------------------------------------
  INSERT INTO public.organizations (id, slug, name, active) VALUES
    (v_org, 'silvia-test-' || substr(v_org::text, 1, 8), 'SILVIA Test Org', true),
    (v_org2, 'silvia-test-' || substr(v_org2::text, 1, 8), 'SILVIA Test Org2', true);

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_leader, v_org, 'silvia-test-leader@test.local', 'SILVIA Leader', 'asesor', 'interno', true),
    (v_a, v_org, 'silvia-test-adriana@test.local', 'SILVIA Adriana A', 'asesor', 'interno', true),
    (v_b, v_org, 'silvia-test-member-b@test.local', 'SILVIA Member B', 'asesor', 'interno', true),
    (v_c, v_org, 'silvia-test-member-c@test.local', 'SILVIA Member C', 'asesor', 'interno', true),
    (v_hector, v_org, 'silvia-test-hector@test.local', 'SILVIA Hector', 'asesor', 'interno', true),
    (v_oziel, v_org, 'silvia-test-oziel@test.local', 'SILVIA Oziel', 'asesor', 'interno', true),
    (v_monto, v_org, 'silvia-test-monto@test.local', 'SILVIA Monto Asesor', 'asesor', 'interno', true),
    (v_outsider, v_org, 'silvia-test-outsider@test.local', 'SILVIA Outsider', 'asesor', 'interno', true),
    (v_inactive, v_org, 'silvia-test-inactive@test.local', 'SILVIA Inactive', 'asesor', 'interno', false),
    (v_editor, v_org, 'silvia-test-editor@test.local', 'SILVIA Editor', 'editor', NULL, true),
    (v_other_org, v_org2, 'silvia-test-otherorg@test.local', 'SILVIA OtherOrg', 'asesor', 'interno', true),
    (v_super, v_org, 'silvia-test-super@test.local', 'SILVIA Super Admin', 'super_admin', NULL, true);

  INSERT INTO public.profile_capabilities (profile_id, capability, active) VALUES
    (v_leader, 'team_dashboard_read', true),
    (v_a, 'create_for_any_advisor', true),
    (v_a, 'integrate_for_any_advisor', true),
    (v_hector, 'create_for_any_advisor', true),
    (v_hector, 'integrate_for_any_advisor', true);

  INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
  VALUES (gen_random_uuid(), v_org, 'SILVIA Test Equipo', v_leader, true)
  RETURNING id INTO v_team;

  INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active) VALUES
    (v_team, v_a, true),
    (v_team, v_b, true),
    (v_team, v_c, true),
    (v_team, v_hector, true),
    (v_team, v_oziel, true),
    (v_team, v_monto, true);

  -- Expedientes filtro list (miembro A vs outsider)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, etapa_actual, subestado
  ) VALUES
    (gen_random_uuid(), v_org, v_a, 'mejoravit', v_nss_a, 'SILVIA Exp MemberA',
     '5581000101', '', 'interno', 'activo', false, 1, 'pendiente'),
    (gen_random_uuid(), v_org, v_outsider, 'mejoravit', v_nss_out, 'SILVIA Exp Outsider',
     '5581000102', '', 'interno', 'activo', false, 1, 'pendiente');

  SELECT id INTO v_exp_a FROM public.expedientes WHERE nss = v_nss_a LIMIT 1;
  SELECT id INTO v_exp_out FROM public.expedientes WHERE nss = v_nss_out LIMIT 1;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp_a, v_org, 'pendiente'), (v_exp_out, v_org, 'pendiente');

  -- -------------------------------------------------------------------------
  -- RLS SELECT directo (authenticated)
  -- -------------------------------------------------------------------------
  PERFORM public.__silvia_set_auth(v_leader);
  SELECT count(*) INTO v_cnt
  FROM public.asesor_equipos
  WHERE organization_id = v_org;
  PERFORM public.__silvia_assert(v_cnt = 1, 'RLS leader ve 1 equipo');
  SELECT count(*) INTO v_cnt
  FROM public.asesor_equipo_miembros
  WHERE team_id = v_team;
  PERFORM public.__silvia_assert(v_cnt >= 6, 'RLS leader ve miembros del equipo');
  PERFORM public.__silvia_reset_auth();

  PERFORM public.__silvia_set_auth(v_a);
  SELECT count(*) INTO v_cnt FROM public.asesor_equipos;
  PERFORM public.__silvia_assert(v_cnt = 0, 'RLS member A equipos = 0 (sin recursion)');
  SELECT count(*) INTO v_cnt FROM public.asesor_equipo_miembros;
  PERFORM public.__silvia_assert(v_cnt = 1, 'RLS member A solo su fila miembros');
  SELECT count(*) INTO v_cnt
  FROM public.asesor_equipo_miembros
  WHERE asesor_id = v_b;
  PERFORM public.__silvia_assert(v_cnt = 0, 'RLS member A no ve fila de B');
  PERFORM public.__silvia_reset_auth();

  PERFORM public.__silvia_set_auth(v_outsider);
  SELECT count(*) INTO v_cnt FROM public.asesor_equipos;
  PERFORM public.__silvia_assert(v_cnt = 0, 'RLS outsider equipos = 0');
  SELECT count(*) INTO v_cnt FROM public.asesor_equipo_miembros;
  PERFORM public.__silvia_assert(v_cnt = 0, 'RLS outsider miembros = 0');
  PERFORM public.__silvia_reset_auth();

  PERFORM public.__silvia_set_auth(v_super);
  SELECT count(*) INTO v_cnt
  FROM public.asesor_equipos
  WHERE organization_id = v_org;
  PERFORM public.__silvia_assert(v_cnt >= 1, 'RLS super_admin same org ve equipo');
  PERFORM public.__silvia_reset_auth();

  PERFORM public.__silvia_set_auth(v_other_org);
  SELECT count(*) INTO v_cnt
  FROM public.asesor_equipos
  WHERE organization_id = v_org;
  PERFORM public.__silvia_assert(v_cnt = 0, 'RLS cross-org asesor no ve equipos v_org');
  PERFORM public.__silvia_reset_auth();

  -- -------------------------------------------------------------------------
  -- Comportamentales existentes (líder / create / caps)
  -- -------------------------------------------------------------------------
  PERFORM public.__silvia_set_auth(v_leader);
  v_members := public.asesor_lider_list_members();
  PERFORM public.__silvia_assert(
    jsonb_array_length(v_members->'members') >= 3,
    '1 list_members count >= 3'
  );
  PERFORM public.__silvia_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_members->'members') m
      WHERE (m->>'id')::uuid = v_leader
    )
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_members->'members') m
      WHERE (m->>'id')::uuid = v_a
    )
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_members->'members') m
      WHERE (m->>'id')::uuid = v_b
    ),
    '1 list_members incluye leader+A+B'
  );

  v_page := public.asesor_lider_list_expedientes_page(
    1, 50, 'SILVIA Exp', NULL, NULL, NULL, NULL, NULL
  );
  PERFORM public.__silvia_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') x
      WHERE x->>'cliente_nombre' = 'SILVIA Exp MemberA'
    ),
    '2 leader ve exp de miembro A'
  );
  PERFORM public.__silvia_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') x
      WHERE x->>'cliente_nombre' = 'SILVIA Exp Outsider'
         OR (x->>'id')::uuid = v_exp_out
    ),
    '2 leader NO ve exp outsider'
  );

  PERFORM public.__silvia_set_auth(v_b);
  BEGIN
    PERFORM public.asesor_lider_list_members();
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '3 member B list_members raise');

  PERFORM public.__silvia_set_auth(v_outsider);
  BEGIN
    PERFORM public.asesor_lider_list_expedientes_page(1, 25);
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '4 outsider list_expedientes raise');

  PERFORM public.__silvia_set_auth(v_leader);
  PERFORM public.__silvia_assert(
    public.can_see_expediente(v_exp_a) IS FALSE,
    '5 leader can_see member exp = false'
  );

  -- 6) Adriana create_for_asesor(B)
  PERFORM public.__silvia_set_auth(v_a);
  v_page := public.create_expediente_for_asesor(
    v_b, 'mejoravit', v_nss_create, 'SILVIA Create For B', '5581000010', ''
  );
  v_created := (v_page->>'id')::uuid;
  v_asesor_id := (v_page->>'asesor_id')::uuid;
  PERFORM public.__silvia_assert(v_asesor_id = v_b, '6 expediente.asesor_id = B');
  SELECT e.asesor_id INTO v_asesor_id FROM public.expedientes e WHERE e.id = v_created;
  PERFORM public.__silvia_assert(v_asesor_id = v_b, '6 row asesor_id = B');
  SELECT al.actor_id INTO v_actor
  FROM public.action_log al
  WHERE al.entity_type = 'expediente'
    AND al.entity_id = v_created
    AND al.action = 'expediente.create'
  ORDER BY al.created_at DESC
  LIMIT 1;
  PERFORM public.__silvia_assert(v_actor = v_a, '6 action_log actor = Adriana');
  v_exp_b := v_created;

  -- 7) Hector create for A
  PERFORM public.__silvia_set_auth(v_hector);
  v_page := public.create_expediente_for_asesor(
    v_a, 'mejoravit', v_nss_hector, 'SILVIA Hector For A', '5581000011', ''
  );
  PERFORM public.__silvia_assert(
    (v_page->>'asesor_id')::uuid = v_a,
    '7 hector create for A asesor_id'
  );

  -- 8) B cannot create_for_any
  PERFORM public.__silvia_set_auth(v_b);
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_a, 'mejoravit', '99881000020', 'SILVIA B Fail', '5581000020', ''
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '8 member B create fails');

  -- 9) inactive target
  PERFORM public.__silvia_set_auth(v_a);
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_inactive, 'mejoravit', '99881000021', 'SILVIA Inactive Tgt', '5581000021', ''
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '9 inactive target fails');

  -- 10) editor target
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_editor, 'mejoravit', '99881000022', 'SILVIA Editor Tgt', '5581000022', ''
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '10 editor target fails');

  -- 11) cross-org
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_other_org, 'mejoravit', '99881000023', 'SILVIA Cross Org', '5581000023', ''
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '11 cross-org fails');

  -- 12) dup NSS
  PERFORM public.__silvia_set_auth(v_a);
  PERFORM public.create_expediente_for_asesor(
    v_b, 'mejoravit', v_nss_dup, 'SILVIA Dup First', '5581000012', ''
  );
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_a, 'mejoravit', v_nss_dup, 'SILVIA Dup Second', '5581000013', ''
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '12 duplicate NSS fails');

  -- 17) Oziel sin caps
  PERFORM public.__silvia_reset_auth();
  PERFORM public.__silvia_assert(
    NOT public.profile_has_capability(v_oziel, 'create_for_any_advisor')
    AND NOT public.profile_has_capability(v_oziel, 'integrate_for_any_advisor')
    AND NOT public.profile_has_capability(v_oziel, 'team_dashboard_read'),
    '17 Oziel sin caps especiales'
  );

  -- 18) get_context(B) team_dashboard_read false
  PERFORM public.__silvia_set_auth(v_b);
  v_ctx := public.asesor_lider_get_context();
  PERFORM public.__silvia_assert(
    (v_ctx->>'team_dashboard_read')::boolean IS FALSE,
    '18 get_context member B team_dashboard_read false'
  );
  PERFORM public.__silvia_reset_auth();

  -- -------------------------------------------------------------------------
  -- REAL delegated save_cliente_datos (sin fallback)
  -- -------------------------------------------------------------------------
  UPDATE public.editor_decisions
  SET
    decision = 'aprobado',
    monto_aprobado = 50000,
    monto_aprobado_al_aprobar = 50000,
    aprobado_at = COALESCE(aprobado_at, NOW()),
    updated_at = NOW()
  WHERE expediente_id = v_exp_b;

  PERFORM public.__silvia_set_auth(v_a);
  PERFORM public.save_cliente_datos(
    v_exp_b,
    'XAXX010101000',
    '5581000001',
    '[]'::jsonb,
    NULL,
    '{}'::jsonb,
    'completo',
    10,
    'transferencia',
    'Calle Test 1'
  );
  PERFORM public.__silvia_reset_auth();
  PERFORM public.__silvia_assert(
    EXISTS (SELECT 1 FROM public.cliente_datos WHERE expediente_id = v_exp_b),
    'save Adriana: cliente_datos existe'
  );
  SELECT cd.updated_by INTO v_updated_by
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = v_exp_b;
  PERFORM public.__silvia_assert(v_updated_by = v_a, 'save Adriana: updated_by = Adriana');
  SELECT e.asesor_id INTO v_asesor_id FROM public.expedientes e WHERE e.id = v_exp_b;
  PERFORM public.__silvia_assert(v_asesor_id = v_b, 'save Adriana: asesor_id sigue B');

  -- C sin cap → 42501
  PERFORM public.__silvia_set_auth(v_c);
  BEGIN
    PERFORM public.save_cliente_datos(
      v_exp_b,
      'XAXX010101000',
      '5581000002',
      '[]'::jsonb,
      NULL,
      '{}'::jsonb,
      'completo',
      10,
      'transferencia',
      'Calle Test Deny'
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__silvia_assert(
    v_fail AND v_sqlstate = '42501',
    'save member C deny 42501'
  );
  PERFORM public.__silvia_reset_auth();

  -- -------------------------------------------------------------------------
  -- REAL delegated register_expediente_documento
  -- -------------------------------------------------------------------------
  v_path := v_org::text || '/' || v_exp_b::text || '/cliente_ine_frente/silvia-test.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_a)
  ON CONFLICT (bucket_id, name) DO NOTHING;

  PERFORM public.__silvia_set_auth(v_a);
  PERFORM public.register_expediente_documento(
    v_exp_b, 'cliente_ine_frente', v_path, 'ine.pdf', 'application/pdf', 100
  );
  PERFORM public.__silvia_reset_auth();
  SELECT d.uploaded_by INTO v_uploaded_by
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_b
    AND d.tipo_documento = 'cliente_ine_frente'
    AND d.deleted_at IS NULL
  LIMIT 1;
  PERFORM public.__silvia_assert(v_uploaded_by = v_a, 'regdoc Adriana uploaded_by');
  SELECT e.asesor_id INTO v_asesor_id FROM public.expedientes e WHERE e.id = v_exp_b;
  PERFORM public.__silvia_assert(v_asesor_id = v_b, 'regdoc Adriana asesor_id sigue B');

  v_path_c := v_org::text || '/' || v_exp_b::text || '/cliente_ine_reverso/silvia-test.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path_c, v_c)
  ON CONFLICT (bucket_id, name) DO NOTHING;

  PERFORM public.__silvia_set_auth(v_c);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp_b, 'cliente_ine_reverso', v_path_c, 'ine-rev.pdf', 'application/pdf', 100
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__silvia_assert(
    v_fail AND v_sqlstate = '42501',
    'regdoc member C deny 42501'
  );
  PERFORM public.__silvia_reset_auth();

  -- -------------------------------------------------------------------------
  -- REAL enviar_a_mesa (Adriana OK / C deny)
  -- -------------------------------------------------------------------------
  IF to_regprocedure('public.__p189_clear_feature_vault()') IS NOT NULL THEN
    PERFORM public.__p189_clear_feature_vault();
  END IF;

  v_exp_enviar := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    v_exp_enviar, v_org, v_b, 'mejoravit', v_nss_enviar, 'SILVIA Enviar Mesa B',
    '5581000030', '', 'interno', 'activo', false, 1, 'pendiente'
  );
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, monto_aprobado_al_aprobar, aprobado_at
  ) VALUES (
    v_exp_enviar, v_org, 'aprobado', 15000, 15000, NOW()
  );
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago, updated_by
  ) VALUES (
    v_exp_enviar,
    v_org,
    public.__p189_infonavit_datos_completo(v_nss_enviar)
      || jsonb_build_object('rfc', 'XAXX010101000', 'celular', '5581000030'),
    'completo',
    10,
    1500,
    'transferencia',
    v_a
  );
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      v_org, v_exp_enviar, v_tipo,
      'dev/silvia/' || v_exp_enviar::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', v_a, 'asesor'
    );
  END LOOP;

  PERFORM public.__silvia_set_auth(v_a);
  PERFORM public.enviar_a_mesa(v_exp_enviar);
  PERFORM public.__silvia_reset_auth();

  SELECT e.submitted_to_mesa, e.asesor_id
  INTO v_submitted, v_asesor_id
  FROM public.expedientes e
  WHERE e.id = v_exp_enviar;
  PERFORM public.__silvia_assert(v_submitted IS TRUE, 'enviar Adriana: submitted_to_mesa');
  PERFORM public.__silvia_assert(v_asesor_id = v_b, 'enviar Adriana: asesor_id = B');
  SELECT al.actor_id INTO v_actor
  FROM public.action_log al
  WHERE al.entity_type = 'expediente'
    AND al.entity_id = v_exp_enviar
    AND al.action = 'expediente.enviar_a_mesa'
  ORDER BY al.created_at DESC
  LIMIT 1;
  PERFORM public.__silvia_assert(v_actor = v_a, 'enviar Adriana: action_log actor');
  PERFORM public.__silvia_assert(
    NOT EXISTS (
      SELECT 1 FROM public.agenda_bookings ab WHERE ab.expediente_id = v_exp_enviar
    ),
    'enviar Adriana: sin agenda_bookings'
  );

  -- Denegación C en expediente fresco
  v_exp_enviar_deny := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    v_exp_enviar_deny, v_org, v_b, 'mejoravit', v_nss_enviar_deny, 'SILVIA Enviar Deny C',
    '5581000031', '', 'interno', 'activo', false, 1, 'pendiente'
  );
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, monto_aprobado_al_aprobar, aprobado_at
  ) VALUES (
    v_exp_enviar_deny, v_org, 'aprobado', 15000, 15000, NOW()
  );
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago, updated_by
  ) VALUES (
    v_exp_enviar_deny,
    v_org,
    public.__p189_infonavit_datos_completo(v_nss_enviar_deny)
      || jsonb_build_object('rfc', 'XAXX010101000', 'celular', '5581000031'),
    'completo',
    10,
    1500,
    'transferencia',
    v_b
  );
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      v_org, v_exp_enviar_deny, v_tipo,
      'dev/silvia/' || v_exp_enviar_deny::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', v_b, 'asesor'
    );
  END LOOP;

  PERFORM public.__silvia_set_auth(v_c);
  BEGIN
    PERFORM public.enviar_a_mesa(v_exp_enviar_deny);
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__silvia_assert(
    v_fail AND v_sqlstate = '42501',
    'enviar member C deny 42501'
  );
  PERFORM public.__silvia_reset_auth();

  -- -------------------------------------------------------------------------
  -- Monto multi-programa (filtro p_asesor_id = v_monto)
  -- -------------------------------------------------------------------------
  v_exp_monto_mv := gen_random_uuid();
  v_exp_monto_sc := gen_random_uuid();
  v_exp_monto_ctc := gen_random_uuid();

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, etapa_actual, subestado
  ) VALUES
    (v_exp_monto_mv, v_org, v_monto, 'mejoravit', v_nss_monto_mv, 'SILVIA Monto Mejoravit',
     '5581000040', '', 'interno', 'activo', false, 1, 'pendiente'),
    (v_exp_monto_sc, v_org, v_monto, 'subcuenta', v_nss_monto_sc, 'SILVIA Monto Subcuenta',
     '5581000041', '', 'interno', 'activo', false, 1, 'pendiente'),
    (v_exp_monto_ctc, v_org, v_monto, 'compro_tu_casa', v_nss_monto_ctc, 'SILVIA Monto CTC',
     '5581000042', '', 'interno', 'activo', false, 1, 'pendiente');

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, monto_aprobado_al_aprobar, aprobado_at
  ) VALUES
    (v_exp_monto_mv, v_org, 'aprobado', 200000, 200000, NOW()),
    (v_exp_monto_sc, v_org, 'aprobado', 50000, 50000, NOW()),
    (v_exp_monto_ctc, v_org, 'aprobado', 80000, 80000, NOW());

  PERFORM public.__silvia_set_auth(v_leader);
  v_dash := public.asesor_lider_get_dashboard(v_monto, NULL, NULL);
  PERFORM public.__silvia_assert(
    (v_dash->>'monto_total_aprobado')::numeric = 299000,
    'dashboard monto multi-programa = 299000 (169k+50k+80k)'
  );
  PERFORM public.__silvia_reset_auth();

  -- -------------------------------------------------------------------------
  -- Cleanup
  -- -------------------------------------------------------------------------
  PERFORM public.__silvia_reset_auth();

  IF to_regprocedure('public.__p189_purge_submission(uuid)') IS NOT NULL THEN
    PERFORM public.__p189_purge_submission(v_exp_enviar);
    PERFORM public.__p189_purge_submission(v_exp_enviar_deny);
  END IF;

  DELETE FROM public.action_log
  WHERE entity_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  )
  OR actor_id IN (
    SELECT id FROM public.profiles WHERE email LIKE 'silvia-test-%@test.local'
  );
  DELETE FROM public.agenda_bookings
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  -- storage.objects: no DELETE (protect_objects_delete + owner supabase_storage_admin).
  DELETE FROM public.cliente_datos
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  DELETE FROM public.editor_decisions
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  );
  DELETE FROM public.expedientes
  WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%';
  DELETE FROM public.asesor_equipo_miembros WHERE team_id = v_team;
  DELETE FROM public.asesor_equipos WHERE id = v_team;
  DELETE FROM public.profile_capabilities
  WHERE profile_id IN (v_leader, v_a, v_hector);
  DELETE FROM public.profiles
  WHERE id IN (
    v_leader, v_a, v_b, v_c, v_hector, v_oziel, v_monto,
    v_outsider, v_inactive, v_editor, v_other_org, v_super
  );
  DELETE FROM public.organizations WHERE id IN (v_org, v_org2);

  RAISE NOTICE 'SILVIA OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__silvia_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__silvia_reset_auth();
DROP FUNCTION IF EXISTS public.__silvia_assert(BOOLEAN, TEXT);
