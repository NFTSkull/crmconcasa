-- ConCasa CRM — asesor_tipos_documento_visibles (mig 20260903150000)
-- Miembro Equipo → 4 tipos; outsider → {}; no asesor → {}.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__atv_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'ASESOR TIPOS VISIBLES TEST FAIL: %', p_msg; END IF;
  RAISE NOTICE 'PASS: %', p_msg;
END; $$;

CREATE OR REPLACE FUNCTION public.__atv_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__atv_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_leader UUID := gen_random_uuid();
  v_member UUID := gen_random_uuid();
  v_out UUID := gen_random_uuid();
  v_mesa UUID := gen_random_uuid();
  v_team UUID;
  v_vis TEXT[];
  v_email_test TEXT := 'atv-leader@test.local';
  v_email_prod TEXT := 'silvia.reyes@concasa.mx';
  v_tipos TEXT[] := ARRAY[
    'cliente_solicitud_credito',
    'cliente_lista_nominal',
    'cliente_bajo_protesta',
    'cliente_presupuesto'
  ];
BEGIN
  IF to_regprocedure('public.asesor_tipos_documento_visibles()') IS NULL THEN
    RAISE EXCEPTION 'ASESOR TIPOS VISIBLES TEST FAIL: RPC ausente';
  END IF;

  DELETE FROM public.asesor_equipo_miembros
  WHERE team_id IN (SELECT id FROM public.asesor_equipos WHERE nombre = 'ATV Test Team');
  DELETE FROM public.asesor_equipos WHERE nombre = 'ATV Test Team';
  DELETE FROM public.profiles WHERE email IN (
    'atv-leader@test.local', 'atv-member@test.local', 'atv-out@test.local', 'atv-mesa@test.local'
  );

  UPDATE public.documento_tipo_scope_equipo
  SET leader_email = v_email_test
  WHERE tipo_documento = ANY(v_tipos);

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_leader, v_org, v_email_test, 'ATV Leader', 'asesor', 'interno', true),
    (v_member, v_org, 'atv-member@test.local', 'ATV Member', 'asesor', 'interno', true),
    (v_out, v_org, 'atv-out@test.local', 'ATV Out', 'asesor', 'interno', true),
    (v_mesa, v_org, 'atv-mesa@test.local', 'ATV Mesa', 'mesa', NULL, true);

  INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
  VALUES (gen_random_uuid(), v_org, 'ATV Test Team', v_leader, true)
  RETURNING id INTO v_team;

  INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active) VALUES
    (v_team, v_leader, true),
    (v_team, v_member, true);

  PERFORM public.__atv_set_auth(v_member);
  v_vis := public.asesor_tipos_documento_visibles();
  PERFORM public.__atv_reset_auth();
  PERFORM public.__atv_assert(
    cardinality(v_vis) = 4
    AND v_vis @> v_tipos
    AND v_tipos @> v_vis,
    'miembro recibe exactamente los 4 tipos scoped'
  );

  PERFORM public.__atv_set_auth(v_out);
  v_vis := public.asesor_tipos_documento_visibles();
  PERFORM public.__atv_reset_auth();
  PERFORM public.__atv_assert(
    cardinality(v_vis) = 0 OR v_vis IS NULL,
    'outsider recibe array vacío'
  );

  PERFORM public.__atv_set_auth(v_mesa);
  v_vis := public.asesor_tipos_documento_visibles();
  PERFORM public.__atv_reset_auth();
  PERFORM public.__atv_assert(
    cardinality(v_vis) = 0 OR v_vis IS NULL,
    'mesa (no asesor) recibe array vacío'
  );

  UPDATE public.documento_tipo_scope_equipo
  SET leader_email = v_email_prod
  WHERE tipo_documento = ANY(v_tipos);

  DELETE FROM public.asesor_equipo_miembros WHERE team_id = v_team;
  DELETE FROM public.asesor_equipos WHERE id = v_team;
  DELETE FROM public.profiles WHERE id IN (v_leader, v_member, v_out, v_mesa);

  RAISE NOTICE 'ASESOR TIPOS VISIBLES TESTS OK';
END; $$;

DROP FUNCTION IF EXISTS public.__atv_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__atv_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__atv_reset_auth();
