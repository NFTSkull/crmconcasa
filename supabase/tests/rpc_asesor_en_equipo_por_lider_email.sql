-- ConCasa CRM — asesor_en_equipo_por_lider_email (mig 20260903160000)
-- Fail-closed: outsider / 0 equipos / >1 equipos / no auth → false.
-- Miembro o líder del único equipo del líder-email → true.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__aepl_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'ASESOR EN EQUIPO POR LIDER TEST FAIL: %', p_msg; END IF;
  RAISE NOTICE 'PASS: %', p_msg;
END; $$;

CREATE OR REPLACE FUNCTION public.__aepl_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__aepl_reset_auth()
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
  v_email_leader TEXT := 'aepl-leader@test.local';
BEGIN
  IF to_regprocedure('public.asesor_en_equipo_por_lider_email(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASESOR EN EQUIPO POR LIDER TEST FAIL: RPC ausente';
  END IF;

  IF to_regclass('public.asesor_equipos') IS NULL
     OR to_regprocedure('public.asesor_pertenece_equipo_activo(uuid, uuid)') IS NULL THEN
    RAISE NOTICE 'SKIP: asesor_equipos / asesor_pertenece_equipo_activo ausentes en este entorno';
    RETURN;
  END IF;

  DELETE FROM public.asesor_equipo_miembros
  WHERE team_id IN (SELECT id FROM public.asesor_equipos WHERE nombre = 'AEPL Test Team');
  DELETE FROM public.asesor_equipos WHERE nombre = 'AEPL Test Team';
  DELETE FROM public.profiles WHERE email IN (
    'aepl-leader@test.local', 'aepl-member@test.local', 'aepl-out@test.local', 'aepl-mesa@test.local'
  );

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_leader, v_org, v_email_leader, 'AEPL Leader', 'asesor', 'interno', true),
    (v_member, v_org, 'aepl-member@test.local', 'AEPL Member', 'asesor', 'interno', true),
    (v_out, v_org, 'aepl-out@test.local', 'AEPL Out', 'asesor', 'interno', true),
    (v_mesa, v_org, 'aepl-mesa@test.local', 'AEPL Mesa', 'mesa_interno', NULL, true);

  INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
  VALUES (gen_random_uuid(), v_org, 'AEPL Test Team', v_leader, true)
  RETURNING id INTO v_team;

  INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active) VALUES
    (v_team, v_member, true);

  PERFORM public.__aepl_set_auth(v_member);
  PERFORM public.__aepl_assert(
    public.asesor_en_equipo_por_lider_email(v_email_leader, NULL) = true,
    'miembro JWT (p_asesor_id NULL) → true'
  );
  PERFORM public.__aepl_assert(
    public.asesor_en_equipo_por_lider_email(v_email_leader, v_member) = true,
    'miembro explícito → true'
  );
  PERFORM public.__aepl_assert(
    public.asesor_en_equipo_por_lider_email(v_email_leader, v_leader) = true,
    'líder (sin fila miembro) → true vía leader_id'
  );
  PERFORM public.__aepl_reset_auth();

  PERFORM public.__aepl_set_auth(v_out);
  PERFORM public.__aepl_assert(
    public.asesor_en_equipo_por_lider_email(v_email_leader, NULL) = false,
    'outsider JWT → false'
  );
  PERFORM public.__aepl_assert(
    public.asesor_en_equipo_por_lider_email(v_email_leader, v_member) = true,
    'outsider same-org consulta membresía del miembro → true (del target)'
  );
  PERFORM public.__aepl_assert(
    public.asesor_en_equipo_por_lider_email(v_email_leader, v_out) = false,
    'outsider consulta sobre sí mismo → false'
  );
  PERFORM public.__aepl_reset_auth();

  PERFORM public.__aepl_set_auth(v_mesa);
  PERFORM public.__aepl_assert(
    public.asesor_en_equipo_por_lider_email(v_email_leader, v_member) = true,
    'mesa same-org consulta miembro → true'
  );
  PERFORM public.__aepl_reset_auth();

  PERFORM public.__aepl_assert(
    public.asesor_en_equipo_por_lider_email('', NULL) = false,
    'email vacío → false'
  );
  PERFORM public.__aepl_assert(
    public.asesor_en_equipo_por_lider_email('no-existe@test.local', v_member) = false,
    'líder inexistente → false (0 equipos)'
  );

  DELETE FROM public.asesor_equipo_miembros WHERE team_id = v_team;
  DELETE FROM public.asesor_equipos WHERE id = v_team;
  DELETE FROM public.profiles WHERE id IN (v_leader, v_member, v_out, v_mesa);
END;
$$;

DROP FUNCTION IF EXISTS public.__aepl_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__aepl_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__aepl_reset_auth();
