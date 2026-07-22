-- P112: admin_report_expedientes_asesores_etapas
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p112_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P112 FAIL: %', p_msg; END IF; END;
$$;

CREATE OR REPLACE FUNCTION public.__p112_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p112_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_org_b UUID := '00000000-0000-4000-8000-000000000099';
  -- Asesores dedicados (evitan contaminación del seed)
  v_asesor UUID := '00000000-0000-4000-8112-000000000001';
  v_asesor2 UUID := '00000000-0000-4000-8112-000000000002';
  v_admin UUID := '00000000-0000-4000-8006-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_exp1 UUID := '00000000-0000-4000-9112-000000000001';
  v_exp2 UUID := '00000000-0000-4000-9112-000000000002';
  v_exp3 UUID := '00000000-0000-4000-9112-000000000003';
  v_exp4 UUID := '00000000-0000-4000-9112-000000000004';
  v_exp5 UUID := '00000000-0000-4000-9112-000000000005';
  v_exp_b UUID := '00000000-0000-4000-9112-000000000099';
  v_out JSONB;
  v_n INT;
BEGIN
  INSERT INTO public.organizations (id, name, slug, active)
  VALUES (v_org_b, 'Org P112 B', 'org-p112-b', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES
    (v_asesor, v_org, 'asesor1-p112@test.local', 'Asesor Uno P112', 'asesor', true),
    (v_asesor2, v_org, 'asesor2-p112@test.local', 'Asesor Dos P112', 'asesor', true)
  ON CONFLICT (id) DO UPDATE
    SET active = true, organization_id = v_org, full_name = EXCLUDED.full_name;

  DELETE FROM public.expedientes WHERE id IN (v_exp1, v_exp2, v_exp3, v_exp4, v_exp5, v_exp_b);

  -- Paso 3 (interna 3) activo
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp1, v_org, v_asesor, 'mejoravit', '01234567890', 'Cliente Paso3',
    '5511120001', 'interno', true, NOW(), 3, 'en_proceso', 'activo'
  );

  -- Paso 3 legacy interna 4 activo
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '01234567891', 'Cliente Legacy4',
    '5511120002', 'interno', true, NOW(), 4, 'en_proceso', 'activo'
  );

  -- Paso 6 (interna 7) rechazado
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp3, v_org, v_asesor2, 'mejoravit', '09876543210', 'Cliente Rechazado',
    '5511120003', 'interno', true, NOW(), 7, 'rechazado', 'activo'
  );

  -- Cancelado (excluido)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp4, v_org, v_asesor, 'mejoravit', '00000000004', 'Cliente Cancelado',
    '5511120004', 'interno', true, NOW(), 5, 'en_proceso', 'cancelado'
  );

  -- Otra org (excluido) — asesor de la org B
  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES (
    '00000000-0000-4000-8112-000000000099', v_org_b, 'asesor-b-p112@test.local', 'Asesor Org B', 'asesor', true
  ) ON CONFLICT (id) DO UPDATE SET organization_id = v_org_b, active = true;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_b, v_org_b, '00000000-0000-4000-8112-000000000099', 'mejoravit', '00000000099', 'Cliente Org B',
    '5511120099', 'interno', true, NOW(), 3, 'en_proceso', 'activo'
  );

  -- No enviado a Mesa (excluido)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp5, v_org, v_asesor, 'mejoravit', '00000000005', 'Cliente No Mesa',
    '5511120005', 'interno', false, NULL, 2, 'pendiente', 'activo'
  );

  -- 1) mesa no autorizado
  BEGIN
    PERFORM public.__p112_auth(v_mesa);
    PERFORM public.admin_report_expedientes_asesores_etapas(NULL, NULL, 'vigentes');
    PERFORM public.__p112_reset();
    RAISE EXCEPTION 'P112 FAIL: mesa debió fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p112_reset();
    IF SQLERRM LIKE 'P112 FAIL:%' THEN RAISE; END IF;
    PERFORM public.__p112_assert(SQLERRM ILIKE '%super_admin%', '1 solo super_admin');
  END;

  -- 2) paso inválido
  BEGIN
    PERFORM public.__p112_auth(v_admin);
    PERFORM public.admin_report_expedientes_asesores_etapas(NULL, ARRAY[12]::SMALLINT[], 'vigentes');
    PERFORM public.__p112_reset();
    RAISE EXCEPTION 'P112 FAIL: paso 12 debió fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p112_reset();
    IF SQLERRM LIKE 'P112 FAIL:%' THEN RAISE; END IF;
    PERFORM public.__p112_assert(SQLERRM ILIKE '%1 y 11%', '2 pasos 1-11');
  END;

  -- 3) vigentes / Paso 3 incluye 3 y 4
  PERFORM public.__p112_auth(v_admin);
  SELECT public.admin_report_expedientes_asesores_etapas(
    ARRAY[v_asesor]::UUID[],
    ARRAY[3]::SMALLINT[],
    'vigentes'
  ) INTO v_out;
  PERFORM public.__p112_reset();

  PERFORM public.__p112_assert((v_out->'meta'->>'expedientes')::int = 2, '3 meta exp=2');
  PERFORM public.__p112_assert(jsonb_array_length(v_out->'detalle') = 2, '3 detalle=2');
  PERFORM public.__p112_assert(
    (SELECT COUNT(*) FROM jsonb_array_elements(v_out->'detalle') d
     WHERE (d->>'paso_visual')::int = 3) = 2,
    '3 ambos paso_visual=3'
  );
  PERFORM public.__p112_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_out->'detalle') d
      WHERE d->>'nss' = '01234567890'
    ),
    '3 NSS con cero'
  );

  -- 4) varios asesores + rechazados
  PERFORM public.__p112_auth(v_admin);
  SELECT public.admin_report_expedientes_asesores_etapas(
    ARRAY[v_asesor, v_asesor2]::UUID[],
    ARRAY[3, 6]::SMALLINT[],
    'vigentes'
  ) INTO v_out;
  PERFORM public.__p112_reset();

  PERFORM public.__p112_assert((v_out->'meta'->>'expedientes')::int = 3, '4 meta=3');
  PERFORM public.__p112_assert((v_out->'meta'->>'rechazados')::int = 1, '4 rechazados=1');
  PERFORM public.__p112_assert((v_out->'meta'->>'activos')::int = 2, '4 activos=2');
  PERFORM public.__p112_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_out->'detalle') d
      WHERE d->>'estado' = 'rechazado' AND (d->>'paso_visual')::int = 6
    ),
    '4 rechazado en paso 6'
  );

  -- 5) filtro solo rechazados (scoped a asesores P112)
  PERFORM public.__p112_auth(v_admin);
  SELECT public.admin_report_expedientes_asesores_etapas(
    ARRAY[v_asesor, v_asesor2]::UUID[],
    NULL,
    'rechazados'
  ) INTO v_out;
  PERFORM public.__p112_reset();
  PERFORM public.__p112_assert((v_out->'meta'->>'expedientes')::int = 1, '5 exactamente 1 rechazado');
  PERFORM public.__p112_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_out->'detalle') d WHERE d->>'estado' = 'activo'
    ),
    '5 sin activos'
  );

  -- 6) cancelado y otra org / no-mesa no aparecen para asesores P112
  PERFORM public.__p112_auth(v_admin);
  SELECT public.admin_report_expedientes_asesores_etapas(
    ARRAY[v_asesor, v_asesor2]::UUID[],
    NULL,
    'vigentes'
  ) INTO v_out;
  PERFORM public.__p112_reset();
  PERFORM public.__p112_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_out->'detalle') d
      WHERE d->>'cliente_nombre' IN ('Cliente Cancelado', 'Cliente Org B', 'Cliente No Mesa')
    ),
    '6 excluye cancelado/org/no-mesa'
  );
  PERFORM public.__p112_assert((v_out->'meta'->>'expedientes')::int = 3, '6 solo 3 vigentes P112');

  -- 7) grants: anon sin execute
  SELECT COUNT(*)::int INTO v_n
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND routine_name = 'admin_report_expedientes_asesores_etapas'
    AND grantee = 'anon'
    AND privilege_type = 'EXECUTE';
  PERFORM public.__p112_assert(v_n = 0, '7 anon sin execute');

  RAISE NOTICE 'admin_report_expedientes_asesores_etapas: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p112_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p112_auth(UUID);
DROP FUNCTION IF EXISTS public.__p112_reset();
