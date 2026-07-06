-- P052: base cobro Mejoravit (−11%, tope 169000) vs otros programas
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_mbc_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC MBC TEST FAIL: %', p_msg; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mbc_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mbc_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mbc_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_programa public.programa,
  p_nss CHAR(11)
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org_id, p_asesor_id, p_programa, p_nss,
    'Fixture MBC', '5500000099', 'interno', false, 1, 'pendiente', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET programa = EXCLUDED.programa, updated_at = NOW();
  DELETE FROM public.cliente_datos WHERE expediente_id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mbc_test_insert_editor(
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
  v_exp_mejoravit UUID := '00000000-0000-4000-9052-000000000001';
  v_exp_compro UUID := '00000000-0000-4000-9052-000000000002';
  v_row public.cliente_datos%ROWTYPE;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
  SELECT id INTO v_asesor_id FROM public.profiles WHERE app_role = 'asesor' AND active LIMIT 1;

  PERFORM public.__rpc_mbc_test_insert_expediente(v_exp_mejoravit, v_org_id, v_asesor_id, 'mejoravit'::public.programa, '95201000001');
  PERFORM public.__rpc_mbc_test_insert_expediente(v_exp_compro, v_org_id, v_asesor_id, 'compro_tu_casa'::public.programa, '95201000002');
  PERFORM public.__rpc_mbc_test_insert_editor(v_exp_mejoravit, v_org_id, 200000);
  PERFORM public.__rpc_mbc_test_insert_editor(v_exp_compro, v_org_id, 747580);

  PERFORM public.__rpc_mbc_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos(
    v_exp_mejoravit, '', '5595200001', '[]'::JSONB, NULL,
    '{"montoMejoravit": "150000"}'::JSONB,
    'completo', 10, 'transferencia', 'Calle Mejoravit 1'
  );
  PERFORM public.__rpc_mbc_test_reset_auth();

  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_mejoravit;
  PERFORM public.__rpc_mbc_test_assert(v_row.monto_calculado = 18000.00, 'mejoravit manual 150k pct10');

  PERFORM public.__rpc_mbc_test_insert_expediente(v_exp_mejoravit, v_org_id, v_asesor_id, 'mejoravit'::public.programa, '95201000001');
  PERFORM public.__rpc_mbc_test_insert_editor(v_exp_mejoravit, v_org_id, 200000);

  PERFORM public.__rpc_mbc_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos(
    v_exp_mejoravit, '', '5595200001', '[]'::JSONB, NULL, '{}'::JSONB,
    'completo', 10, 'transferencia', 'Calle Mejoravit 1'
  );
  PERFORM public.__rpc_mbc_test_reset_auth();

  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_mejoravit;
  PERFORM public.__rpc_mbc_test_assert(v_row.monto_calculado = 19900.00, 'mejoravit 200k pct10');

  PERFORM public.__rpc_mbc_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos(
    v_exp_compro, '', '5595200002', '[]'::JSONB, NULL, '{}'::JSONB,
    'completo', 10, 'transferencia', 'Calle Compro 2'
  );
  PERFORM public.__rpc_mbc_test_reset_auth();

  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_compro;
  PERFORM public.__rpc_mbc_test_assert(v_row.monto_calculado = 77758.00, 'compro_tu_casa sin 11%');
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_mbc_test_insert_editor(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.__rpc_mbc_test_insert_expediente(UUID, UUID, UUID, public.programa, CHAR(11));
DROP FUNCTION IF EXISTS public.__rpc_mbc_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_mbc_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_mbc_test_assert(BOOLEAN, TEXT);
