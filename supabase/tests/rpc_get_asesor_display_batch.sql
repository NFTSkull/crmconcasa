-- ConCasa CRM — P050 RPC get_asesor_display_batch
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_rows INTEGER;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_mesa::text, true);

  SELECT count(*)::INTEGER
  INTO v_rows
  FROM public.get_asesor_display_batch(ARRAY[v_asesor])
  WHERE email IS NOT NULL OR full_name IS NOT NULL;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'get_asesor_display_batch: mesa debió ver perfil del asesor (rows=%)', v_rows;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;
