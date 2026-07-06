-- P055: monto calculado editable con default automático (+$3,000)
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_mce_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC MCE TEST FAIL: %', p_msg; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mce_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mce_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mce_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_programa public.programa,
  p_nss CHAR(11),
  p_submitted BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org_id, p_asesor_id, p_programa, p_nss,
    'Fixture MCE', '5500000055', 'interno', p_submitted, 1, 'pendiente', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    programa = EXCLUDED.programa,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    updated_at = NOW();
  DELETE FROM public.cliente_datos WHERE expediente_id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mce_test_insert_editor(
  p_expediente_id UUID,
  p_org_id UUID,
  p_monto NUMERIC
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (p_expediente_id, p_org_id, 'aprobado', p_monto)
  ON CONFLICT (expediente_id) DO UPDATE SET
    monto_aprobado = EXCLUDED.monto_aprobado, updated_at = NOW();
END;
$$;

DO $$
DECLARE
  v_org_id UUID;
  v_asesor_id UUID;
  v_exp_auto UUID := '00000000-0000-4000-9055-000000000001';
  v_exp_manual UUID := '00000000-0000-4000-9055-000000000002';
  v_exp_mejoravit UUID := '00000000-0000-4000-9055-000000000003';
  v_exp_mesa UUID := '00000000-0000-4000-9055-000000000004';
  v_row public.cliente_datos%ROWTYPE;
  v_monto_editor NUMERIC;
  v_exp public.expedientes%ROWTYPE;
  v_etapa INTEGER;
  v_submitted BOOLEAN;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
  SELECT id INTO v_asesor_id FROM public.profiles WHERE app_role = 'asesor' AND active LIMIT 1;

  -- save_cliente_datos sin manual → automático +3000 (150000 × 10% + 3000 = 18000)
  PERFORM public.__rpc_mce_test_insert_expediente(
    v_exp_auto, v_org_id, v_asesor_id, 'compro_tu_casa'::public.programa, '95501000001'
  );
  PERFORM public.__rpc_mce_test_insert_editor(v_exp_auto, v_org_id, 150000);

  PERFORM public.__rpc_mce_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos(
    v_exp_auto, '', '5595500001', '[]'::JSONB, NULL, '{}'::JSONB,
    'completo', 10, 'transferencia', 'Calle Auto'
  );
  PERFORM public.__rpc_mce_test_reset_auth();

  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_auto;
  PERFORM public.__rpc_mce_test_assert(v_row.monto_calculado = 18000.00, 'sin manual guarda automático +3000');

  -- save_cliente_datos con manual → guarda manual
  PERFORM public.__rpc_mce_test_insert_expediente(
    v_exp_manual, v_org_id, v_asesor_id, 'compro_tu_casa'::public.programa, '95501000002'
  );
  PERFORM public.__rpc_mce_test_insert_editor(v_exp_manual, v_org_id, 150000);

  PERFORM public.__rpc_mce_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos(
    v_exp_manual, '', '5595500002', '[]'::JSONB, NULL, '{}'::JSONB,
    'completo', 10, 'transferencia', 'Calle Manual', 17000
  );
  PERFORM public.__rpc_mce_test_reset_auth();

  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_manual;
  PERFORM public.__rpc_mce_test_assert(v_row.monto_calculado = 17000.00, 'con manual guarda manual');

  -- Mejoravit sin manual conserva montoMejoravit como base (169000 × 10% + 3000 = 19900)
  PERFORM public.__rpc_mce_test_insert_expediente(
    v_exp_mejoravit, v_org_id, v_asesor_id, 'mejoravit'::public.programa, '95501000003'
  );
  PERFORM public.__rpc_mce_test_insert_editor(v_exp_mejoravit, v_org_id, 200000);

  PERFORM public.__rpc_mce_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos(
    v_exp_mejoravit, '', '5595500003', '[]'::JSONB, NULL,
    '{"montoMejoravit": "169000"}'::JSONB,
    'completo', 10, 'transferencia', 'Calle Mejoravit'
  );
  PERFORM public.__rpc_mce_test_reset_auth();

  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_mejoravit;
  PERFORM public.__rpc_mce_test_assert(v_row.monto_calculado = 19900.00, 'mejoravit sin manual usa montoMejoravit');

  -- save_cliente_datos_correccion post-Mesa (P054 validado)
  PERFORM public.__rpc_mce_test_insert_expediente(
    v_exp_mesa, v_org_id, v_asesor_id, 'compro_tu_casa'::public.programa, '95501000004', false
  );
  PERFORM public.__rpc_mce_test_insert_editor(v_exp_mesa, v_org_id, 747580);

  PERFORM public.__rpc_mce_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos(
    v_exp_mesa, '', '5595500004', '[]'::JSONB, NULL, '{}'::JSONB,
    'completo', 10, 'transferencia', 'Calle Mesa'
  );
  PERFORM public.__rpc_mce_test_reset_auth();

  UPDATE public.expedientes SET submitted_to_mesa = true WHERE id = v_exp_mesa;
  UPDATE public.cliente_datos SET estado = 'validado' WHERE expediente_id = v_exp_mesa;

  SELECT monto_aprobado INTO v_monto_editor FROM public.editor_decisions WHERE expediente_id = v_exp_mesa;
  SELECT etapa_actual, submitted_to_mesa INTO v_etapa, v_submitted FROM public.expedientes WHERE id = v_exp_mesa;

  PERFORM public.__rpc_mce_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos_correccion(
    v_exp_mesa, '', '5595500004', '[]'::JSONB, NULL, '{}'::JSONB,
    10, 'transferencia', 'Calle Mesa Actualizada'
  );
  PERFORM public.__rpc_mce_test_reset_auth();

  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_mesa;
  PERFORM public.__rpc_mce_test_assert(v_row.monto_calculado = 77758.00, 'corrección sin manual conserva automático +3000');
  PERFORM public.__rpc_mce_test_assert(v_row.estado = 'validado', 'P054 preserva estado validado post-Mesa');

  -- save_cliente_datos_correccion con manual delega y guarda manual
  PERFORM public.__rpc_mce_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos_correccion(
    v_exp_mesa, '', '5595500004', '[]'::JSONB, NULL, '{}'::JSONB,
    10, 'transferencia', 'Calle Mesa Actualizada', 76000
  );
  PERFORM public.__rpc_mce_test_reset_auth();

  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_mesa;
  PERFORM public.__rpc_mce_test_assert(v_row.monto_calculado = 76000.00, 'corrección con manual guarda manual');

  -- No toca editor_decisions, etapa_actual ni submitted_to_mesa
  SELECT monto_aprobado INTO v_monto_editor FROM public.editor_decisions WHERE expediente_id = v_exp_mesa;
  PERFORM public.__rpc_mce_test_assert(v_monto_editor = 747580, 'no toca editor_decisions');

  SELECT * INTO v_exp FROM public.expedientes WHERE id = v_exp_mesa;
  PERFORM public.__rpc_mce_test_assert(v_exp.etapa_actual = v_etapa, 'no toca etapa_actual');
  PERFORM public.__rpc_mce_test_assert(v_exp.submitted_to_mesa = v_submitted, 'no toca submitted_to_mesa');
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_mce_test_insert_editor(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.__rpc_mce_test_insert_expediente(UUID, UUID, UUID, public.programa, CHAR(11), BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_mce_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_mce_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_mce_test_assert(BOOLEAN, TEXT);
