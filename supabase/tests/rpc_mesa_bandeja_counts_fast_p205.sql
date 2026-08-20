-- ConCasa CRM — P205-B1: parity OLD list-counts vs mesa_bandeja_counts_fast
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p205_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P205 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p205_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p205_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9205-000000000001';
  v_asesor UUID := '00000000-0000-4000-9205-000000000011';
  v_mesa UUID := '00000000-0000-4000-9205-000000000012';
  v_anon_asesor UUID := '00000000-0000-4000-9205-000000000013';
  v_today TEXT := to_char((now() AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD');
  v_old JSONB;
  v_new JSONB;
  v_origen TEXT;
BEGIN
  PERFORM public.__p205_assert(
    to_regprocedure('public.mesa_bandeja_counts_fast(text,text)') IS NOT NULL,
    'mesa_bandeja_counts_fast debe existir'
  );

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p205-org', 'P205 Org', true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p205-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p205-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_anon_asesor, 'authenticated', 'authenticated', 'p205-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW());

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p205-asesor@test.local', 'Asesor P205', 'asesor', NULL, true),
    (v_mesa, v_org, 'p205-mesa@test.local', 'Mesa P205', 'mesa_interno', 'interno', true),
    (v_anon_asesor, v_org, 'p205-asesor2@test.local', 'Asesor2 P205', 'asesor', NULL, true);

  -- C12/C13: asesor denegado
  PERFORM public.__p205_auth(v_asesor);
  BEGIN
    PERFORM public.mesa_bandeja_counts_fast(v_today, 'todos');
    RAISE EXCEPTION 'P205 TEST FAIL: se esperaba unauthorized para asesor';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'P205 TEST FAIL:%' THEN RAISE; END IF;
    PERFORM public.__p205_assert(
      position('no autorizado' IN SQLERRM) > 0
        OR position('42501' IN SQLSTATE) > 0
        OR SQLSTATE = '42501',
      format('esperaba unauthorized, recibió %s / %s', SQLSTATE, SQLERRM)
    );
  END;
  PERFORM public.__p205_reset();

  -- C1–C3 / C11: paridad exacta old vs new (universo Cloud visible del actor Mesa)
  PERFORM public.__p205_auth(v_mesa);
  FOREACH v_origen IN ARRAY ARRAY['todos', 'interno', 'externo'] LOOP
    v_old := public.mesa_list_bandeja_page(
      1, NULL::timestamptz, NULL::uuid, 'todos', NULL, NULL, NULL, NULL, false,
      v_today, NULL, CASE WHEN v_origen = 'todos' THEN NULL ELSE v_origen END, true
    )->'counts';
    v_new := public.mesa_bandeja_counts_fast(
      v_today,
      CASE WHEN v_origen = 'todos' THEN NULL ELSE v_origen END
    );
    PERFORM public.__p205_assert(
      v_old IS NOT NULL AND v_new IS NOT NULL,
      format('counts null origen=%s', v_origen)
    );
    PERFORM public.__p205_assert(
      v_old = v_new,
      format('paridad falló origen=%s old=%s new=%s', v_origen, v_old, v_new)
    );
    PERFORM public.__p205_assert(
      (SELECT count(*) FROM jsonb_object_keys(v_new)) = 13,
      format('esperaba 13 keys, got %s', (SELECT count(*) FROM jsonb_object_keys(v_new)))
    );
  END LOOP;
  PERFORM public.__p205_reset();

  RAISE NOTICE 'P205-B1 SQL fixtures OK';
END;
$$;

ROLLBACK;
