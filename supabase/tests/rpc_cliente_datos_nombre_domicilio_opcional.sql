-- P053: domicilio opcional + nombre Datos Generales → expedientes.cliente_nombre
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_cnd_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC CND TEST FAIL: %', p_msg; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_cnd_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_cnd_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_cnd_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_nombre TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'compro_tu_casa'::public.programa, p_nss,
    p_nombre, '5500000091', 'interno', false, 1, 'pendiente', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    cliente_nombre = EXCLUDED.cliente_nombre,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    updated_at = NOW();
  DELETE FROM public.cliente_datos WHERE expediente_id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_cnd_test_insert_editor(
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
  v_exp UUID := '00000000-0000-4000-9053-000000000001';
  v_exp_mesa UUID := '00000000-0000-4000-9053-000000000002';
  v_row public.expedientes%ROWTYPE;
  v_cd public.cliente_datos%ROWTYPE;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
  SELECT id INTO v_asesor_id FROM public.profiles WHERE app_role = 'asesor' AND active LIMIT 1;

  PERFORM public.__rpc_cnd_test_insert_expediente(v_exp, v_org_id, v_asesor_id, '95301000001', 'Pat');
  PERFORM public.__rpc_cnd_test_insert_editor(v_exp, v_org_id, 100000);

  PERFORM public.__rpc_cnd_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos(
    v_exp, '', '5595300001', '[]'::JSONB, NULL,
    '{"nombreCliente": "JUAN PEREZ LOPEZ"}'::JSONB,
    'completo', 10, 'transferencia', ''
  );
  PERFORM public.__rpc_cnd_test_reset_auth();

  SELECT * INTO v_row FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__rpc_cnd_test_assert(v_row.cliente_nombre = 'JUAN PEREZ LOPEZ', 'nombre actualiza expediente');
  PERFORM public.__rpc_cnd_test_assert(COALESCE(v_row.direccion_opcional, '') = '', 'domicilio vacío permitido');

  -- Corrección post-Mesa actualiza nombre
  PERFORM public.__rpc_cnd_test_insert_expediente(v_exp_mesa, v_org_id, v_asesor_id, '95301000002', 'Viejo Nombre');
  PERFORM public.__rpc_cnd_test_insert_editor(v_exp_mesa, v_org_id, 100000);

  PERFORM public.__rpc_cnd_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos(
    v_exp_mesa, '', '5595300002', '[]'::JSONB, NULL,
    '{"nombreCliente": "Nombre Inicial"}'::JSONB,
    'completo', 10, 'transferencia', 'Calle 1'
  );
  PERFORM public.__rpc_cnd_test_reset_auth();

  UPDATE public.expedientes SET submitted_to_mesa = true WHERE id = v_exp_mesa;
  UPDATE public.cliente_datos
  SET estado = 'rechazado', comentario_rechazo = 'Corregir nombre'
  WHERE expediente_id = v_exp_mesa;

  PERFORM public.__rpc_cnd_test_set_auth(v_asesor_id);
  PERFORM public.save_cliente_datos_correccion(
    v_exp_mesa, '', '5595300002', '[]'::JSONB, NULL,
    '{"nombreCliente": "NOMBRE CORREGIDO"}'::JSONB,
    10, 'transferencia', ''
  );
  PERFORM public.__rpc_cnd_test_reset_auth();

  SELECT * INTO v_row FROM public.expedientes WHERE id = v_exp_mesa;
  SELECT * INTO v_cd FROM public.cliente_datos WHERE expediente_id = v_exp_mesa;
  PERFORM public.__rpc_cnd_test_assert(v_row.cliente_nombre = 'NOMBRE CORREGIDO', 'corrección actualiza expediente');
  PERFORM public.__rpc_cnd_test_assert(v_cd.datos->>'nombreCliente' = 'NOMBRE CORREGIDO', 'corrección actualiza cliente_datos');
  PERFORM public.__rpc_cnd_test_assert(v_cd.estado = 'completo', 'corrección vuelve a completo');
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_cnd_test_insert_editor(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.__rpc_cnd_test_insert_expediente(UUID, UUID, UUID, CHAR(11), TEXT);
DROP FUNCTION IF EXISTS public.__rpc_cnd_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_cnd_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_cnd_test_assert(BOOLEAN, TEXT);
