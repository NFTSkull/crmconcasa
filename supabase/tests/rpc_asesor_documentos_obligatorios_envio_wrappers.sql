-- ConCasa CRM — wrappers Parte B (mig 20260904214500)
-- Requiere helpers Parte A en el entorno. Si faltan → SKIP (no FAIL).

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__pdo_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'PARTE B WRAPPERS TEST FAIL: %', p_msg; END IF;
  RAISE NOTICE 'PASS: %', p_msg;
END; $$;

CREATE OR REPLACE FUNCTION public.__pdo_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__pdo_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_silvia UUID := gen_random_uuid();
  v_orlando UUID := gen_random_uuid();
  v_member_s UUID := gen_random_uuid();
  v_member_o UUID := gen_random_uuid();
  v_out UUID := gen_random_uuid();
  v_team_s UUID;
  v_team_o UUID;
  v_docs TEXT[];
  v_has_exec BOOLEAN;
BEGIN
  IF to_regprocedure('public.asesor_documentos_obligatorios_envio(uuid)') IS NULL
     OR to_regprocedure('public.asesor_es_paquete_documental_externos(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PARTE B WRAPPERS TEST FAIL: RPCs wrapper ausentes';
  END IF;

  IF to_regprocedure('public.asesor_paquete_documental_externos(uuid)') IS NULL
     OR to_regprocedure('public.integration_doc_tipos_asesor_envio_para(uuid)') IS NULL THEN
    RAISE NOTICE 'SKIP: helpers Parte A ausentes en este entorno';
    RETURN;
  END IF;

  IF to_regclass('public.asesor_equipos') IS NULL THEN
    RAISE NOTICE 'SKIP: asesor_equipos ausente';
    RETURN;
  END IF;

  -- Grants: authenticated sí, anon no
  SELECT has_function_privilege('authenticated', 'public.asesor_documentos_obligatorios_envio(uuid)', 'EXECUTE')
  INTO v_has_exec;
  PERFORM public.__pdo_assert(v_has_exec = true, 'authenticated EXECUTE documentos');

  SELECT has_function_privilege('authenticated', 'public.asesor_es_paquete_documental_externos(uuid)', 'EXECUTE')
  INTO v_has_exec;
  PERFORM public.__pdo_assert(v_has_exec = true, 'authenticated EXECUTE es_paquete');

  SELECT has_function_privilege('anon', 'public.asesor_documentos_obligatorios_envio(uuid)', 'EXECUTE')
  INTO v_has_exec;
  PERFORM public.__pdo_assert(COALESCE(v_has_exec, false) = false, 'anon bloqueado documentos');

  SELECT has_function_privilege('anon', 'public.asesor_es_paquete_documental_externos(uuid)', 'EXECUTE')
  INTO v_has_exec;
  PERFORM public.__pdo_assert(COALESCE(v_has_exec, false) = false, 'anon bloqueado es_paquete');

  DELETE FROM public.asesor_equipo_miembros
  WHERE team_id IN (
    SELECT id FROM public.asesor_equipos
    WHERE nombre IN ('PDO Silvia Team', 'PDO Orlando Team')
  );
  DELETE FROM public.asesor_equipos
  WHERE nombre IN ('PDO Silvia Team', 'PDO Orlando Team');
  DELETE FROM public.profiles WHERE email IN (
    'silvia.reyes@concasa.mx',
    'orlando.solis@concasa.mx',
    'pdo-member-s@test.local',
    'pdo-member-o@test.local',
    'pdo-out@test.local'
  );

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_silvia, v_org, 'silvia.reyes@concasa.mx', 'Silvia Reyes', 'asesor', 'interno', true),
    (v_orlando, v_org, 'orlando.solis@concasa.mx', 'Orlando Solis', 'asesor', 'interno', true),
    (v_member_s, v_org, 'pdo-member-s@test.local', 'Member Silvia', 'asesor', 'interno', true),
    (v_member_o, v_org, 'pdo-member-o@test.local', 'Member Orlando', 'asesor', 'interno', true),
    (v_out, v_org, 'pdo-out@test.local', 'Outsider', 'asesor', 'interno', true);

  INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
  VALUES (gen_random_uuid(), v_org, 'PDO Silvia Team', v_silvia, true)
  RETURNING id INTO v_team_s;
  INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active)
  VALUES (v_team_s, v_member_s, true);

  INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
  VALUES (gen_random_uuid(), v_org, 'PDO Orlando Team', v_orlando, true)
  RETURNING id INTO v_team_o;
  INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active)
  VALUES (v_team_o, v_member_o, true);

  -- Fail-closed sin auth
  PERFORM public.__pdo_reset_auth();
  PERFORM public.__pdo_assert(
    public.asesor_es_paquete_documental_externos(NULL) = false,
    'sin auth → es_externo false'
  );
  v_docs := public.asesor_documentos_obligatorios_envio(NULL);
  PERFORM public.__pdo_assert(
    cardinality(v_docs) = 4 AND 'cliente_ine_reverso' = ANY (v_docs),
    'sin auth → 4 clásicos con reverso'
  );

  -- Outsider JWT → 4 / false
  PERFORM public.__pdo_set_auth(v_out);
  PERFORM public.__pdo_assert(
    public.asesor_es_paquete_documental_externos(NULL) = false,
    'outsider JWT → false'
  );
  v_docs := public.asesor_documentos_obligatorios_envio(NULL);
  PERFORM public.__pdo_assert(
    cardinality(v_docs) = 4 AND 'cliente_ine_reverso' = ANY (v_docs),
    'outsider JWT → 4 clásicos'
  );

  -- Silvia member → 7 / true
  PERFORM public.__pdo_set_auth(v_member_s);
  PERFORM public.__pdo_assert(
    public.asesor_es_paquete_documental_externos(NULL) = true,
    'Silvia member JWT → true'
  );
  v_docs := public.asesor_documentos_obligatorios_envio(NULL);
  PERFORM public.__pdo_assert(
    cardinality(v_docs) = 7
      AND NOT ('cliente_ine_reverso' = ANY (v_docs))
      AND 'cliente_solicitud_credito' = ANY (v_docs),
    'Silvia member JWT → 7 sin reverso'
  );

  -- Orlando member → 7 / true
  PERFORM public.__pdo_set_auth(v_member_o);
  PERFORM public.__pdo_assert(
    public.asesor_es_paquete_documental_externos(NULL) = true,
    'Orlando member JWT → true'
  );
  v_docs := public.asesor_documentos_obligatorios_envio(NULL);
  PERFORM public.__pdo_assert(
    cardinality(v_docs) = 7
      AND NOT ('cliente_ine_reverso' = ANY (v_docs)),
    'Orlando member JWT → 7 sin reverso'
  );

  -- Actor outsider consulta dueño Silvia → 7 / true (dueño manda)
  PERFORM public.__pdo_set_auth(v_out);
  PERFORM public.__pdo_assert(
    public.asesor_es_paquete_documental_externos(v_member_s) = true,
    'outsider consulta dueño Silvia → true'
  );
  v_docs := public.asesor_documentos_obligatorios_envio(v_member_s);
  PERFORM public.__pdo_assert(
    cardinality(v_docs) = 7,
    'outsider consulta docs dueño Silvia → 7'
  );
  PERFORM public.__pdo_assert(
    public.asesor_es_paquete_documental_externos(v_out) = false,
    'outsider consulta sí mismo → false'
  );
  v_docs := public.asesor_documentos_obligatorios_envio(v_out);
  PERFORM public.__pdo_assert(
    cardinality(v_docs) = 4,
    'outsider consulta docs sí mismo → 4'
  );

  PERFORM public.__pdo_reset_auth();

  DELETE FROM public.asesor_equipo_miembros WHERE team_id IN (v_team_s, v_team_o);
  DELETE FROM public.asesor_equipos WHERE id IN (v_team_s, v_team_o);
  DELETE FROM public.profiles
  WHERE id IN (v_silvia, v_orlando, v_member_s, v_member_o, v_out);
END;
$$;

DROP FUNCTION IF EXISTS public.__pdo_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__pdo_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__pdo_reset_auth();
