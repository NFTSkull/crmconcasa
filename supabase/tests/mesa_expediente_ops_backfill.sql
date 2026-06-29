-- ConCasa CRM — pruebas Fase 1A backfill mesa_expediente_ops
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/mesa_expediente_ops_backfill.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__mesa_ops_bf_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'MESA OPS BACKFILL TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_ops_bf_test_insert_exp(
  p_id UUID,
  p_org UUID,
  p_asesor UUID,
  p_nss CHAR(11),
  p_submitted BOOLEAN DEFAULT true,
  p_ciclo public.expediente_ciclo_estado DEFAULT 'activo'
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
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture Mesa Ops BF',
    '5511111111', 'interno',
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    1,
    CASE WHEN p_submitted THEN 'en_validacion_mesa'::public.operativo_subestado ELSE 'pendiente'::public.operativo_subestado END,
    p_ciclo
  )
  ON CONFLICT (id) DO UPDATE SET
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    ciclo_estado = EXCLUDED.ciclo_estado,
    deleted_at = NULL,
    updated_at = NOW();
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8060-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_exp_enviado UUID := '00000000-0000-4000-9060-000000000010';
  v_exp_borrador UUID := '00000000-0000-4000-9060-000000000020';
  v_exp_cerrado UUID := '00000000-0000-4000-9060-000000000030';
  v_result JSONB;
  v_count INTEGER;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'fixture-mesa-ops-bf', 'Fixture Mesa Ops Backfill', true)
  ON CONFLICT (id) DO UPDATE SET active = true, updated_at = NOW();

  DELETE FROM public.mesa_expediente_ops
  WHERE expediente_id IN (v_exp_enviado, v_exp_borrador, v_exp_cerrado);

  PERFORM public.__mesa_ops_bf_test_insert_exp(
    v_exp_enviado, v_org, v_asesor, '96010000010', true, 'activo'
  );
  PERFORM public.__mesa_ops_bf_test_insert_exp(
    v_exp_borrador, v_org, v_asesor, '96020000020', false, 'activo'
  );
  PERFORM public.__mesa_ops_bf_test_insert_exp(
    v_exp_cerrado, v_org, v_asesor, '96030000030', true, 'cerrado'
  );

  -- test 1: backfill crea fila para enviado activo sin ops
  v_result := public.backfill_mesa_expediente_ops();
  PERFORM public.__mesa_ops_bf_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'inserted')::int >= 1,
    'test 1: backfill inserta expedientes enviados activos'
  );
  PERFORM public.__mesa_ops_bf_test_assert(
    EXISTS (
      SELECT 1 FROM public.mesa_expediente_ops mo
      WHERE mo.expediente_id = v_exp_enviado
        AND mo.estado_mesa = 'sin_asignar'
        AND mo.assigned_to IS NULL
    ),
    'test 1b: fila sin_asignar sin responsable'
  );

  -- test 2: no crea para no enviado
  SELECT COUNT(*) INTO v_count
  FROM public.mesa_expediente_ops
  WHERE expediente_id = v_exp_borrador;
  PERFORM public.__mesa_ops_bf_test_assert(
    v_count = 0,
    'test 2: no crea filas para expedientes no enviados a Mesa'
  );

  -- test 3: no crea para ciclo inactivo
  SELECT COUNT(*) INTO v_count
  FROM public.mesa_expediente_ops
  WHERE expediente_id = v_exp_cerrado;
  PERFORM public.__mesa_ops_bf_test_assert(
    v_count = 0,
    'test 3: no crea filas para ciclo inactivo'
  );

  -- test 4: idempotente — segunda ejecución no duplica
  SELECT COUNT(*) INTO v_count
  FROM public.mesa_expediente_ops
  WHERE expediente_id = v_exp_enviado;
  v_result := public.backfill_mesa_expediente_ops();
  PERFORM public.__mesa_ops_bf_test_assert(
    (v_result->>'inserted')::int = 0
      AND (SELECT COUNT(*) FROM public.mesa_expediente_ops WHERE expediente_id = v_exp_enviado) = v_count,
    'test 4: backfill idempotente sin duplicar'
  );
END;
$$;

DROP FUNCTION IF EXISTS public.__mesa_ops_bf_test_insert_exp(UUID, UUID, UUID, CHAR, BOOLEAN, public.expediente_ciclo_estado);
DROP FUNCTION IF EXISTS public.__mesa_ops_bf_test_assert(BOOLEAN, TEXT);
