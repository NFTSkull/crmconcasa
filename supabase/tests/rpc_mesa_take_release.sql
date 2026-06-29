-- ConCasa CRM — pruebas Fase 1A RPC mesa_take_expediente / mesa_release_expediente
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_mesa_take_release.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__mesa_tr_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'MESA TAKE/RELEASE TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_tr_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_tr_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_tr_test_insert_exp(
  p_id UUID,
  p_org UUID,
  p_asesor UUID,
  p_nss CHAR(11),
  p_origen public.origen_mesa DEFAULT 'interno'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture Mesa Take Release',
    '5511111111', p_origen, true, NOW(), 1, 'en_validacion_mesa', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    origen_mesa = EXCLUDED.origen_mesa,
    submitted_to_mesa = true,
    fecha_envio_mesa = NOW(),
    ciclo_estado = 'activo',
    deleted_at = NULL,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_tr_test_call_take(
  p_user UUID,
  p_exp UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__mesa_tr_test_set_auth(p_user);
  SELECT public.mesa_take_expediente(p_exp) INTO v_result;
  PERFORM public.__mesa_tr_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_tr_test_call_release(
  p_user UUID,
  p_exp UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__mesa_tr_test_set_auth(p_user);
  SELECT public.mesa_release_expediente(p_exp, p_motivo) INTO v_result;
  PERFORM public.__mesa_tr_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_tr_test_expect_fail(
  p_fn TEXT,
  p_user UUID,
  p_exp UUID,
  p_motivo TEXT DEFAULT NULL,
  p_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_err TEXT;
BEGIN
  PERFORM public.__mesa_tr_test_set_auth(p_user);
  BEGIN
    IF p_fn = 'take' THEN
      PERFORM public.mesa_take_expediente(p_exp);
    ELSE
      PERFORM public.mesa_release_expediente(p_exp, p_motivo);
    END IF;
    PERFORM public.__mesa_tr_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      PERFORM public.__mesa_tr_test_reset_auth();
      IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
        RAISE EXCEPTION 'error inesperado: %', v_err;
      END IF;
      RETURN true;
  END;
END;
$$;

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_int_b UUID := '00000000-0000-4000-8004-000000000002';

  v_exp_take UUID := '00000000-0000-4000-9070-000000000010';
  v_exp_idem UUID := '00000000-0000-4000-9070-000000000020';
  v_exp_conflict UUID := '00000000-0000-4000-9070-000000000030';
  v_exp_release UUID := '00000000-0000-4000-9070-000000000040';
  v_exp_admin_rel UUID := '00000000-0000-4000-9070-000000000050';
  v_exp_third UUID := '00000000-0000-4000-9070-000000000060';
  v_exp_log_take UUID := '00000000-0000-4000-9070-000000000070';
  v_exp_log_rel UUID := '00000000-0000-4000-9070-000000000080';
  v_exp_unique UUID := '00000000-0000-4000-9070-000000000090';

  v_result JSONB;
  v_ops public.mesa_expediente_ops;
  v_log_count INTEGER;
BEGIN
  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, active
  ) VALUES (
    v_mesa_int_b,
    v_org_id,
    'dev.mesa.interno.b@concasa.local',
    'Dev Mesa Interno B',
    'mesa_interno',
    'interno',
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    app_role = EXCLUDED.app_role,
    tipo_mesa = EXCLUDED.tipo_mesa,
    active = true,
    updated_at = NOW();

  PERFORM public.__mesa_tr_test_insert_exp(v_exp_take, v_org_id, v_asesor, '97010000010');
  PERFORM public.__mesa_tr_test_insert_exp(v_exp_idem, v_org_id, v_asesor, '97020000020');
  PERFORM public.__mesa_tr_test_insert_exp(v_exp_conflict, v_org_id, v_asesor, '97030000030');
  PERFORM public.__mesa_tr_test_insert_exp(v_exp_release, v_org_id, v_asesor, '97040000040');
  PERFORM public.__mesa_tr_test_insert_exp(v_exp_admin_rel, v_org_id, v_asesor, '97050000050');
  PERFORM public.__mesa_tr_test_insert_exp(v_exp_third, v_org_id, v_asesor, '97060000060');
  PERFORM public.__mesa_tr_test_insert_exp(v_exp_log_take, v_org_id, v_asesor, '97070000070');
  PERFORM public.__mesa_tr_test_insert_exp(v_exp_log_rel, v_org_id, v_asesor, '97080000080');
  PERFORM public.__mesa_tr_test_insert_exp(v_exp_unique, v_org_id, v_asesor, '97090000090');

  DELETE FROM public.mesa_expediente_ops
  WHERE expediente_id IN (
    v_exp_take, v_exp_idem, v_exp_conflict, v_exp_release,
    v_exp_admin_rel, v_exp_third, v_exp_log_take, v_exp_log_rel, v_exp_unique
  );

  DELETE FROM public.action_log
  WHERE entity_id IN (
    v_exp_take, v_exp_idem, v_exp_conflict, v_exp_release,
    v_exp_admin_rel, v_exp_third, v_exp_log_take, v_exp_log_rel, v_exp_unique
  )
    AND action IN ('mesa.expediente.take', 'mesa.expediente.release');

  -- test 1: tomar expediente sin asignar funciona
  v_result := public.__mesa_tr_test_call_take(v_mesa_int, v_exp_take);
  PERFORM public.__mesa_tr_test_assert(
    (v_result->>'ok')::boolean = true
      AND (v_result->>'assigned_to')::uuid = v_mesa_int
      AND v_result->>'estado_mesa' = 'trabajando',
    'test 1: tomar expediente sin asignar'
  );

  -- test 2: tomar dos veces por el mismo actor es idempotente
  v_result := public.__mesa_tr_test_call_take(v_mesa_int, v_exp_idem);
  PERFORM public.__mesa_tr_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'idempotent')::boolean = false,
    'test 2a: primera toma'
  );
  v_result := public.__mesa_tr_test_call_take(v_mesa_int, v_exp_idem);
  PERFORM public.__mesa_tr_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'idempotent')::boolean = true,
    'test 2b: segunda toma idempotente'
  );

  -- test 3: tomar expediente asignado a otro falla
  PERFORM public.__mesa_tr_test_call_take(v_mesa_int, v_exp_conflict);
  PERFORM public.__mesa_tr_test_assert(
    public.__mesa_tr_test_expect_fail(
      'take', v_mesa_int_b, v_exp_conflict, NULL, 'asignado a otro operador'
    ),
    'test 3: tomar asignado a otro falla'
  );

  -- test 4: liberar por asignado funciona
  PERFORM public.__mesa_tr_test_call_take(v_mesa_int, v_exp_release);
  v_result := public.__mesa_tr_test_call_release(v_mesa_int, v_exp_release);
  PERFORM public.__mesa_tr_test_assert((v_result->>'ok')::boolean = true, 'test 4: liberar por asignado');
  SELECT * INTO v_ops FROM public.mesa_expediente_ops WHERE expediente_id = v_exp_release;
  PERFORM public.__mesa_tr_test_assert(
    v_ops.estado_mesa = 'sin_asignar' AND v_ops.assigned_to IS NULL AND v_ops.assigned_at IS NULL,
    'test 4b: estado sin_asignar tras liberar'
  );

  -- test 5: liberar por admin funciona (con motivo)
  PERFORM public.__mesa_tr_test_call_take(v_mesa_int, v_exp_admin_rel);
  v_result := public.__mesa_tr_test_call_release(
    v_mesa_admin, v_exp_admin_rel, 'Reasignación operativa'
  );
  PERFORM public.__mesa_tr_test_assert((v_result->>'ok')::boolean = true, 'test 5: liberar por admin');

  -- test 6: liberar por tercero no admin falla
  PERFORM public.__mesa_tr_test_call_take(v_mesa_int, v_exp_third);
  PERFORM public.__mesa_tr_test_assert(
    public.__mesa_tr_test_expect_fail(
      'release', v_mesa_int_b, v_exp_third, NULL, 'solo el responsable o un administrador'
    ),
    'test 6: liberar por tercero no admin falla'
  );

  -- test 7: action_log registra take
  v_result := public.__mesa_tr_test_call_take(v_mesa_int, v_exp_log_take);
  SELECT COUNT(*) INTO v_log_count
  FROM public.action_log al
  WHERE al.entity_id = v_exp_log_take
    AND al.action = 'mesa.expediente.take';
  PERFORM public.__mesa_tr_test_assert(v_log_count >= 1, 'test 7: action_log take');

  -- test 8: action_log registra release
  PERFORM public.__mesa_tr_test_call_take(v_mesa_int, v_exp_log_rel);
  v_result := public.__mesa_tr_test_call_release(v_mesa_int, v_exp_log_rel);
  SELECT COUNT(*) INTO v_log_count
  FROM public.action_log al
  WHERE al.entity_id = v_exp_log_rel
    AND al.action = 'mesa.expediente.release';
  PERFORM public.__mesa_tr_test_assert(v_log_count >= 1, 'test 8: action_log release');

  -- test 9: no hay doble asignación posible (1:1 + segundo operador bloqueado)
  v_result := public.__mesa_tr_test_call_take(v_mesa_int, v_exp_unique);
  PERFORM public.__mesa_tr_test_assert(
    (SELECT COUNT(*) FROM public.mesa_expediente_ops WHERE expediente_id = v_exp_unique) = 1,
    'test 9a: una sola fila ops por expediente'
  );
  PERFORM public.__mesa_tr_test_assert(
    public.__mesa_tr_test_expect_fail(
      'take', v_mesa_int_b, v_exp_unique, NULL, 'asignado a otro operador'
    ),
    'test 9b: segundo operador no puede tomar'
  );
END;
$$;

DROP FUNCTION IF EXISTS public.__mesa_tr_test_expect_fail(TEXT, UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__mesa_tr_test_call_release(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__mesa_tr_test_call_take(UUID, UUID);
DROP FUNCTION IF EXISTS public.__mesa_tr_test_insert_exp(UUID, UUID, UUID, CHAR, public.origen_mesa);
DROP FUNCTION IF EXISTS public.__mesa_tr_test_reset_auth();
DROP FUNCTION IF EXISTS public.__mesa_tr_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__mesa_tr_test_assert(BOOLEAN, TEXT);
