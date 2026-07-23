-- ConCasa CRM — P128: presencia activa Mesa
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--   -f supabase/tests/rpc_mesa_presencia_p128.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p128_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P128 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p128_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p128_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa2 UUID := '00000000-0000-4000-8003-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_exp UUID := '00000000-0000-4000-9128-000000000001';
  v_sid1 UUID := '00000000-0000-4000-a128-000000000001';
  v_sid2 UUID := '00000000-0000-4000-a128-000000000002';
  v_sid3 UUID := '00000000-0000-4000-a128-000000000003';
  v_res JSONB;
  v_cnt INTEGER;
  v_fail BOOLEAN;
  v_seen1 TIMESTAMPTZ;
  v_seen2 TIMESTAMPTZ;
  v_upd_before TIMESTAMPTZ;
  v_upd_after TIMESTAMPTZ;
  v_act_upd UUID;
BEGIN
  PERFORM public.__p128_assert(
    to_regclass('public.expediente_mesa_presencia') IS NOT NULL,
    'tabla presencia'
  );
  PERFORM public.__p128_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='mesa_touch_expediente_presencia'
    ), 'touch RPC'
  );
  PERFORM public.__p128_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='mesa_close_expediente_presencia'
    ), 'close RPC'
  );
  PERFORM public.__p128_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='mesa_list_expedientes_presencia'
    ), 'list RPC'
  );
  PERFORM public.__p128_assert(
    NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.table_schema='public' AND g.table_name='expediente_mesa_presencia'
        AND g.grantee='authenticated'
        AND g.privilege_type IN ('INSERT','UPDATE','DELETE')
    ),
    'sin write authenticated'
  );

  DELETE FROM public.expediente_mesa_presencia WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91280000001',
    'P128 Presencia', '5511280001', 'interno', true, NOW(),
    2, 'en_proceso', 'activo'
  );

  SELECT e.updated_at INTO v_upd_before FROM public.expedientes e WHERE e.id = v_exp;

  -- Asesor bloqueado
  PERFORM public.__p128_set_auth(v_asesor);
  v_fail := false;
  BEGIN
    PERFORM public.mesa_touch_expediente_presencia(v_exp, v_sid1);
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__p128_reset_auth();
  PERFORM public.__p128_assert(v_fail, 'asesor no touch');

  -- Abrir crea presencia
  PERFORM public.__p128_set_auth(v_mesa);
  v_res := public.mesa_touch_expediente_presencia(v_exp, v_sid1);
  PERFORM public.__p128_reset_auth();
  PERFORM public.__p128_assert(coalesce((v_res->>'ok')::boolean, false), 'touch ok');

  SELECT count(*) INTO v_cnt FROM public.expediente_mesa_presencia WHERE expediente_id = v_exp;
  PERFORM public.__p128_assert(v_cnt = 1, 'una fila tras abrir');

  SELECT last_seen_at INTO v_seen1
  FROM public.expediente_mesa_presencia
  WHERE expediente_id = v_exp AND session_id = v_sid1;

  -- Heartbeat misma sesión no duplica
  UPDATE public.expediente_mesa_presencia
  SET last_seen_at = clock_timestamp() - interval '5 seconds'
  WHERE expediente_id = v_exp AND session_id = v_sid1;
  SELECT last_seen_at INTO v_seen1
  FROM public.expediente_mesa_presencia
  WHERE expediente_id = v_exp AND session_id = v_sid1;

  PERFORM public.__p128_set_auth(v_mesa);
  v_res := public.mesa_touch_expediente_presencia(v_exp, v_sid1);
  PERFORM public.__p128_reset_auth();

  SELECT count(*) INTO v_cnt FROM public.expediente_mesa_presencia WHERE expediente_id = v_exp;
  PERFORM public.__p128_assert(v_cnt = 1, 'heartbeat sin duplicar');

  SELECT last_seen_at INTO v_seen2
  FROM public.expediente_mesa_presencia
  WHERE expediente_id = v_exp AND session_id = v_sid1;
  PERFORM public.__p128_assert(v_seen2 > v_seen1, 'heartbeat actualiza last_seen');

  -- Dos pestañas mismo usuario → list muestra un nombre
  PERFORM public.__p128_set_auth(v_mesa);
  PERFORM public.mesa_touch_expediente_presencia(v_exp, v_sid2);
  v_res := public.mesa_list_expedientes_presencia(ARRAY[v_exp]);
  PERFORM public.__p128_reset_auth();

  SELECT count(*) INTO v_cnt FROM public.expediente_mesa_presencia WHERE expediente_id = v_exp;
  PERFORM public.__p128_assert(v_cnt = 2, 'dos sesiones mismo user');

  PERFORM public.__p128_assert(
    jsonb_array_length(v_res->'items'->0->'users') = 1,
    'list dedupe mismo user'
  );

  -- Segundo usuario
  PERFORM public.__p128_set_auth(v_mesa2);
  PERFORM public.mesa_touch_expediente_presencia(v_exp, v_sid3);
  v_res := public.mesa_list_expedientes_presencia(ARRAY[v_exp]);
  PERFORM public.__p128_reset_auth();

  PERFORM public.__p128_assert(
    jsonb_array_length(v_res->'items'->0->'users') = 2,
    'dos usuarios en list'
  );

  -- Close retira solo sesión
  PERFORM public.__p128_set_auth(v_mesa);
  PERFORM public.mesa_close_expediente_presencia(v_exp, v_sid1);
  PERFORM public.__p128_reset_auth();
  SELECT count(*) INTO v_cnt
  FROM public.expediente_mesa_presencia
  WHERE expediente_id = v_exp AND session_id = v_sid1;
  PERFORM public.__p128_assert(v_cnt = 0, 'close elimina sesión');

  -- TTL >90s no aparece
  UPDATE public.expediente_mesa_presencia
  SET last_seen_at = clock_timestamp() - interval '91 seconds'
  WHERE expediente_id = v_exp;

  PERFORM public.__p128_set_auth(v_mesa);
  v_res := public.mesa_list_expedientes_presencia(ARRAY[v_exp]);
  PERFORM public.__p128_reset_auth();
  PERFORM public.__p128_assert(
    jsonb_array_length(coalesce(v_res->'items', '[]'::jsonb)) = 0,
    'TTL 90s filtra'
  );

  -- Touch no cambia expediente.updated_at
  SELECT e.updated_at INTO v_upd_after FROM public.expedientes e WHERE e.id = v_exp;
  PERFORM public.__p128_assert(v_upd_after = v_upd_before, 'no muta expedientes.updated_at');

  -- Touch no escribe Actualizado por (actividad)
  SELECT a.last_updated_by INTO v_act_upd
  FROM public.expediente_mesa_actividad a WHERE a.expediente_id = v_exp;
  PERFORM public.__p128_assert(v_act_upd IS NULL, 'presencia no setea last_updated');

  -- Cleanup
  DELETE FROM public.expediente_mesa_presencia WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  RAISE NOTICE 'P128 OK: presencia touch/close/list/TTL';
END;
$$;

DROP FUNCTION IF EXISTS public.__p128_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p128_reset_auth();
DROP FUNCTION IF EXISTS public.__p128_assert(BOOLEAN, TEXT);
