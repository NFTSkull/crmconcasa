-- ConCasa CRM — P127: nombres Mesa + Visto/Actualizado por
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--   -f supabase/tests/rpc_mesa_actividad_p127.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p127_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P127 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p127_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p127_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
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
  v_exp UUID := '00000000-0000-4000-9127-000000000001';
  v_src TEXT;
  v_res JSONB;
  v_view_by UUID;
  v_view_at TIMESTAMPTZ;
  v_upd_by UUID;
  v_upd_at TIMESTAMPTZ;
  v_upd_at_after TIMESTAMPTZ;
  v_fail BOOLEAN;
  v_has_insert BOOLEAN;
BEGIN
  -- Objetos
  PERFORM public.__p127_assert(
    to_regclass('public.expediente_mesa_actividad') IS NOT NULL,
    'tabla expediente_mesa_actividad'
  );
  PERFORM public.__p127_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'mesa_registrar_vista_expediente'
    ),
    'RPC mesa_registrar_vista_expediente'
  );
  PERFORM public.__p127_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_mesa_expediente_actividad'
    ),
    'RPC get_mesa_expediente_actividad'
  );
  PERFORM public.__p127_assert(
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'action_log'
        AND t.tgname = 'trg_expediente_mesa_actividad_action_log'
        AND NOT t.tgisinternal
    ),
    'trigger action_log → actividad'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p127_assert(v_src IS NOT NULL, 'bandeja existe');
  PERFORM public.__p127_assert(
    position('expediente_mesa_actividad' in v_src) > 0, 'bandeja JOIN actividad'
  );
  PERFORM public.__p127_assert(
    position('last_viewed_by_name' in v_src) > 0, 'bandeja last_viewed_by_name'
  );
  PERFORM public.__p127_assert(
    position('last_updated_by_name' in v_src) > 0, 'bandeja last_updated_by_name'
  );
  -- Sin N+1: un JOIN a profiles, no subselect por fila tipado como correlated loop
  PERFORM public.__p127_assert(
    position('LEFT JOIN public.profiles pv' in v_src) > 0
    OR position('LEFT JOIN public.profiles' in v_src) > 0,
    'nombres vía JOIN profiles'
  );

  -- Grants: authenticated sin escritura directa
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'expediente_mesa_actividad'
      AND g.grantee = 'authenticated'
      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) INTO v_has_insert;
  PERFORM public.__p127_assert(NOT coalesce(v_has_insert, false), 'sin write directo authenticated');

  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91270000001',
    'P127 Actividad Mesa', '5511270001', 'interno', true, NOW(),
    2, 'en_proceso', 'activo'
  );

  -- Asesor no puede registrar vista
  PERFORM public.__p127_set_auth(v_asesor);
  v_fail := false;
  BEGIN
    PERFORM public.mesa_registrar_vista_expediente(v_exp);
  EXCEPTION WHEN insufficient_privilege OR others THEN
    v_fail := true;
  END;
  PERFORM public.__p127_reset_auth();
  PERFORM public.__p127_assert(v_fail, 'asesor no registra vista');

  -- Mesa registra vista
  PERFORM public.__p127_set_auth(v_mesa);
  v_res := public.mesa_registrar_vista_expediente(v_exp);
  PERFORM public.__p127_reset_auth();
  PERFORM public.__p127_assert(coalesce((v_res->>'ok')::boolean, false), 'vista ok');

  SELECT a.last_viewed_by, a.last_viewed_at, a.last_updated_by, a.last_updated_at
  INTO v_view_by, v_view_at, v_upd_by, v_upd_at
  FROM public.expediente_mesa_actividad a
  WHERE a.expediente_id = v_exp;

  PERFORM public.__p127_assert(v_view_by = v_mesa, 'last_viewed_by = mesa');
  PERFORM public.__p127_assert(v_view_at IS NOT NULL, 'last_viewed_at set');
  PERFORM public.__p127_assert(v_upd_by IS NULL, 'vista no setea last_updated_by');
  PERFORM public.__p127_assert(v_upd_at IS NULL, 'vista no setea last_updated_at');

  -- Segunda vista (otro mesa) actualiza solo visto
  PERFORM public.__p127_set_auth(v_mesa2);
  v_res := public.mesa_registrar_vista_expediente(v_exp);
  PERFORM public.__p127_reset_auth();

  SELECT a.last_viewed_by, a.last_updated_by, a.last_updated_at
  INTO v_view_by, v_upd_by, v_upd_at
  FROM public.expediente_mesa_actividad a
  WHERE a.expediente_id = v_exp;

  PERFORM public.__p127_assert(v_view_by = v_mesa2, 'segunda vista cambia viewer');
  PERFORM public.__p127_assert(v_upd_by IS NULL AND v_upd_at IS NULL, 'segunda vista no actualiza');

  -- Mutación Mesa vía action_log → Actualizado por
  PERFORM public.log_action(
    v_org, v_mesa, 'mesa_interno',
    'mesa.expediente.take', 'expediente', v_exp,
    jsonb_build_object('test', 'p127')
  );

  SELECT a.last_updated_by, a.last_updated_at, a.last_viewed_by
  INTO v_upd_by, v_upd_at, v_view_by
  FROM public.expediente_mesa_actividad a
  WHERE a.expediente_id = v_exp;

  PERFORM public.__p127_assert(v_upd_by = v_mesa, 'mutación mesa → last_updated_by');
  PERFORM public.__p127_assert(v_upd_at IS NOT NULL, 'mutación mesa → last_updated_at');
  PERFORM public.__p127_assert(v_view_by = v_mesa2, 'mutación no cambia viewer');

  -- Acción asesor no cuenta como actualización Mesa
  v_upd_at_after := v_upd_at;
  PERFORM public.log_action(
    v_org, v_asesor, 'asesor',
    'asesor.documento.upload', 'expediente', v_exp,
    '{}'::jsonb
  );

  SELECT a.last_updated_by, a.last_updated_at
  INTO v_upd_by, v_upd_at
  FROM public.expediente_mesa_actividad a
  WHERE a.expediente_id = v_exp;

  PERFORM public.__p127_assert(v_upd_by = v_mesa, 'asesor no cambia last_updated_by');
  PERFORM public.__p127_assert(v_upd_at = v_upd_at_after, 'asesor no cambia last_updated_at');

  -- Lectura get con nombres
  PERFORM public.__p127_set_auth(v_mesa);
  v_res := public.get_mesa_expediente_actividad(v_exp);
  PERFORM public.__p127_reset_auth();
  PERFORM public.__p127_assert(coalesce((v_res->>'ok')::boolean, false), 'get actividad ok');
  PERFORM public.__p127_assert(
    nullif(btrim(coalesce(v_res->>'last_viewed_by_name', '')), '') IS NOT NULL,
    'get incluye nombre viewer'
  );
  PERFORM public.__p127_assert(
    nullif(btrim(coalesce(v_res->>'last_updated_by_name', '')), '') IS NOT NULL,
    'get incluye nombre updater'
  );

  -- Expediente sin actividad → vacío
  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = v_exp;
  PERFORM public.__p127_set_auth(v_mesa);
  v_res := public.get_mesa_expediente_actividad(v_exp);
  PERFORM public.__p127_reset_auth();
  PERFORM public.__p127_assert(v_res->>'last_viewed_by_name' IS NULL, 'sin vista nombre null');
  PERFORM public.__p127_assert(v_res->>'last_updated_by_name' IS NULL, 'sin update nombre null');

  -- Cleanup
  DELETE FROM public.action_log
  WHERE entity_id = v_exp OR (payload->>'expediente_id') = v_exp::text;
  DELETE FROM public.expediente_mesa_actividad WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  RAISE NOTICE 'P127 OK: mesa actividad + vista + trigger';
END;
$$;

DROP FUNCTION IF EXISTS public.__p127_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p127_reset_auth();
DROP FUNCTION IF EXISTS public.__p127_assert(BOOLEAN, TEXT);
