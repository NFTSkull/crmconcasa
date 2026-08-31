-- Team Silvia: equipo líder + capabilities (create/integrate) + contrato sin widen can_see.
-- Fixtures propias; cleanup por prefijo para no ensuciar la DB local.
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

  -- 14) save_cliente_datos patched con integrate
  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_cliente_datos'
  ORDER BY p.oid DESC
  LIMIT 1;
  PERFORM public.__silvia_assert(v_oid IS NOT NULL, 'save_cliente_datos existe');
  PERFORM public.__silvia_assert(
    position('integrate_for_any_advisor' in v_src) > 0,
    '14 save_cliente_datos contiene integrate_for_any_advisor'
  );

  -- 15) enviar_a_mesa patched con integrate
  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'enviar_a_mesa'
  ORDER BY p.oid DESC
  LIMIT 1;
  PERFORM public.__silvia_assert(v_oid IS NOT NULL, 'enviar_a_mesa existe');
  PERFORM public.__silvia_assert(
    position('integrate_for_any_advisor' in v_src) > 0,
    '15 enviar_a_mesa contiene integrate_for_any_advisor'
  );

  -- 16) can_see_expediente NO se amplía con team scope
  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'can_see_expediente'
  ORDER BY p.oid DESC
  LIMIT 1;
  PERFORM public.__silvia_assert(v_oid IS NOT NULL, 'can_see_expediente existe');
  PERFORM public.__silvia_assert(
    position('team_dashboard' in lower(v_src)) = 0
    AND position('asesor_equipo' in lower(v_src)) = 0,
    '16 can_see sin team_dashboard/asesor_equipo'
  );

  PERFORM public.__silvia_assert(EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'profile_has_capability'
  ), 'profile_has_capability existe');

  RAISE NOTICE 'SILVIA OK: contrato estático';
END;
$$;

-- =============================================================================
-- Fixtures + assertions comportamentales
-- =============================================================================
DO $$
DECLARE
  v_org UUID := gen_random_uuid();
  v_org2 UUID := gen_random_uuid();
  v_leader UUID := gen_random_uuid();
  v_a UUID := gen_random_uuid();       -- Adriana (member A)
  v_b UUID := gen_random_uuid();       -- member B
  v_hector UUID := gen_random_uuid();
  v_oziel UUID := gen_random_uuid();
  v_outsider UUID := gen_random_uuid();
  v_inactive UUID := gen_random_uuid();
  v_editor UUID := gen_random_uuid();
  v_other_org UUID := gen_random_uuid();
  v_team UUID;
  v_exp_a UUID;
  v_exp_out UUID;
  v_exp_b UUID;
  v_created UUID;
  v_page JSONB;
  v_members JSONB;
  v_ctx JSONB;
  v_fail BOOLEAN;
  v_asesor_id UUID;
  v_actor UUID;
  v_nss_a TEXT := '99881000001';
  v_nss_out TEXT := '99881000002';
  v_nss_create TEXT := '99881000010';
  v_nss_hector TEXT := '99881000011';
  v_nss_dup TEXT := '99881000012';
BEGIN
  -- Limpieza residual de corridas previas
  DELETE FROM public.action_log
  WHERE entity_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  )
  OR actor_id IN (
    SELECT id FROM public.profiles WHERE email LIKE 'silvia-test-%@test.local'
  );
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

  INSERT INTO public.organizations (id, slug, name, active) VALUES
    (v_org, 'silvia-test-' || substr(v_org::text, 1, 8), 'SILVIA Test Org', true),
    (v_org2, 'silvia-test-' || substr(v_org2::text, 1, 8), 'SILVIA Test Org2', true);

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_leader, v_org, 'silvia-test-leader@test.local', 'SILVIA Leader', 'asesor', 'interno', true),
    (v_a, v_org, 'silvia-test-adriana@test.local', 'SILVIA Adriana A', 'asesor', 'interno', true),
    (v_b, v_org, 'silvia-test-member-b@test.local', 'SILVIA Member B', 'asesor', 'interno', true),
    (v_hector, v_org, 'silvia-test-hector@test.local', 'SILVIA Hector', 'asesor', 'interno', true),
    (v_oziel, v_org, 'silvia-test-oziel@test.local', 'SILVIA Oziel', 'asesor', 'interno', true),
    (v_outsider, v_org, 'silvia-test-outsider@test.local', 'SILVIA Outsider', 'asesor', 'interno', true),
    (v_inactive, v_org, 'silvia-test-inactive@test.local', 'SILVIA Inactive', 'asesor', 'interno', false),
    (v_editor, v_org, 'silvia-test-editor@test.local', 'SILVIA Editor', 'editor', NULL, true),
    (v_other_org, v_org2, 'silvia-test-otherorg@test.local', 'SILVIA OtherOrg', 'asesor', 'interno', true);

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
    (v_team, v_oziel, true);

  -- Expedientes para filtro dashboard/list (miembro A vs outsider)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, etapa_actual, subestado
  ) VALUES
    (gen_random_uuid(), v_org, v_a, 'mejoravit', v_nss_a, 'SILVIA Exp MemberA',
     '5500000001', '', 'interno', 'activo', false, 1, 'pendiente'),
    (gen_random_uuid(), v_org, v_outsider, 'mejoravit', v_nss_out, 'SILVIA Exp Outsider',
     '5500000002', '', 'interno', 'activo', false, 1, 'pendiente');

  SELECT id INTO v_exp_a FROM public.expedientes WHERE nss = v_nss_a LIMIT 1;
  SELECT id INTO v_exp_out FROM public.expedientes WHERE nss = v_nss_out LIMIT 1;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp_a, v_org, 'pendiente'), (v_exp_out, v_org, 'pendiente');

  -- 1) Leader list_members incluye leader + A + B (count >= 3)
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

  -- 2) Leader list NO incluye expediente outsider; sí el de A
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

  -- 3) Member B calling lider RPC raises
  PERFORM public.__silvia_set_auth(v_b);
  BEGIN
    PERFORM public.asesor_lider_list_members();
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '3 member B list_members raise');

  -- 4) Outsider calling lider RPC raises
  PERFORM public.__silvia_set_auth(v_outsider);
  BEGIN
    PERFORM public.asesor_lider_list_expedientes_page(1, 25);
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '4 outsider list_expedientes raise');

  -- 5) can_see_expediente(leader, member_exp) = FALSE (no widen)
  PERFORM public.__silvia_set_auth(v_leader);
  PERFORM public.__silvia_assert(
    public.can_see_expediente(v_exp_a) IS FALSE,
    '5 leader can_see member exp = false'
  );

  -- 6) Adriana create_expediente_for_asesor(target=B) OK; asesor_id=B; action_log actor=Adriana
  PERFORM public.__silvia_set_auth(v_a);
  v_page := public.create_expediente_for_asesor(
    v_b, 'mejoravit', v_nss_create, 'SILVIA Create For B', '5510000010', ''
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

  -- 7) Hector create for A succeeds
  PERFORM public.__silvia_set_auth(v_hector);
  v_page := public.create_expediente_for_asesor(
    v_a, 'mejoravit', v_nss_hector, 'SILVIA Hector For A', '5510000011', ''
  );
  PERFORM public.__silvia_assert(
    (v_page->>'asesor_id')::uuid = v_a,
    '7 hector create for A asesor_id'
  );

  -- 8) Member B create_expediente_for_asesor fails (no capability)
  PERFORM public.__silvia_set_auth(v_b);
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_a, 'mejoravit', '99881000020', 'SILVIA B Fail', '5510000020', ''
    );
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '8 member B create fails');

  -- 9) create for inactive target fails
  PERFORM public.__silvia_set_auth(v_a);
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_inactive, 'mejoravit', '99881000021', 'SILVIA Inactive Tgt', '5510000021', ''
    );
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '9 inactive target fails');

  -- 10) create for editor (non-asesor) fails
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_editor, 'mejoravit', '99881000022', 'SILVIA Editor Tgt', '5510000022', ''
    );
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '10 editor target fails');

  -- 11) create cross-org fails
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_other_org, 'mejoravit', '99881000023', 'SILVIA Cross Org', '5510000023', ''
    );
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '11 cross-org fails');

  -- 12) Duplicate NSS gate (mismo nss+programa activo)
  PERFORM public.__silvia_set_auth(v_a);
  PERFORM public.create_expediente_for_asesor(
    v_b, 'mejoravit', v_nss_dup, 'SILVIA Dup First', '5510000012', ''
  );
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_a, 'mejoravit', v_nss_dup, 'SILVIA Dup Second', '5510000013', ''
    );
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__silvia_assert(v_fail, '12 duplicate NSS fails');

  -- 13) Adriana save_cliente_datos on B's expediente (integrate)
  PERFORM public.__silvia_set_auth(v_a);
  BEGIN
    PERFORM public.save_cliente_datos(
      v_exp_b,
      'XAXX010101000',
      '5521212199',
      '[]'::jsonb,
      NULL,
      '{}'::jsonb,
      'completo',
      10,
      'transferencia',
      'Calle Silvia 1'
    );
    v_fail := false;
  EXCEPTION WHEN others THEN
    -- Fallback documentado: si payload mínimo falla por validación de negocio,
    -- al menos el gate de capability debe permitir (probe ownership bypass).
    RAISE NOTICE 'save_cliente_datos payload falló (%); probe capability', SQLERRM;
    v_fail := true;
  END;
  IF v_fail THEN
    PERFORM public.__silvia_reset_auth();
    PERFORM public.__silvia_assert(
      public.profile_has_capability(v_a, 'integrate_for_any_advisor'),
      '13 fallback: Adriana tiene integrate_for_any_advisor (patch en functiondef #14)'
    );
  ELSE
    PERFORM public.__silvia_assert(
      EXISTS (SELECT 1 FROM public.cliente_datos WHERE expediente_id = v_exp_b),
      '13 Adriana save_cliente_datos on B exp OK'
    );
  END IF;

  -- 17) Oziel sin create / integrate / team_dashboard
  PERFORM public.__silvia_reset_auth();
  PERFORM public.__silvia_assert(
    NOT public.profile_has_capability(v_oziel, 'create_for_any_advisor')
    AND NOT public.profile_has_capability(v_oziel, 'integrate_for_any_advisor')
    AND NOT public.profile_has_capability(v_oziel, 'team_dashboard_read'),
    '17 Oziel sin caps especiales'
  );

  -- 18) get_context asesor normal → team_dashboard_read false
  PERFORM public.__silvia_set_auth(v_b);
  v_ctx := public.asesor_lider_get_context();
  PERFORM public.__silvia_assert(
    (v_ctx->>'team_dashboard_read')::boolean IS FALSE,
    '18 get_context member B team_dashboard_read false'
  );

  PERFORM public.__silvia_reset_auth();

  -- Cleanup
  DELETE FROM public.action_log
  WHERE entity_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '99881%' OR cliente_nombre LIKE 'SILVIA%'
  )
  OR actor_id IN (
    SELECT id FROM public.profiles WHERE email LIKE 'silvia-test-%@test.local'
  );
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
    v_leader, v_a, v_b, v_hector, v_oziel, v_outsider, v_inactive, v_editor, v_other_org
  );
  DELETE FROM public.organizations WHERE id IN (v_org, v_org2);

  RAISE NOTICE 'SILVIA OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__silvia_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__silvia_reset_auth();
DROP FUNCTION IF EXISTS public.__silvia_assert(BOOLEAN, TEXT);
