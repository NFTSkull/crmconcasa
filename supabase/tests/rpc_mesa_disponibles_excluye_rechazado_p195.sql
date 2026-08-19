-- P195: Disponibles (sin_asignar) excluye activo+rechazado; Rechazados lo incluye.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p195_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P195 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p195_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p195_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p195_assert(v_src IS NOT NULL, 'bandeja existe');
  PERFORM public.__p195_assert(position('WHEN ''sin_asignar'' THEN' in v_src) > 0, 'ops sin_asignar');
  PERFORM public.__p195_assert(
    position('cl.subestado IS DISTINCT FROM ''rechazado''' in v_src) > 0,
    'disponibles excluye rechazado'
  );
  PERFORM public.__p195_assert(
    position('expediente_tiene_correccion_asesor_pendiente' in v_src) = 0,
    'no duplica predicado P192 en lista'
  );
  PERFORM public.__p195_assert(position('UPDATE ' in v_src) = 0, 'read-model sin UPDATE');
  PERFORM public.__p195_assert(position('mesa_take' in v_src) = 0, 'no toca take');
  PERFORM public.__p195_assert(position('mesa_release' in v_src) = 0, 'no toca release');
  RAISE NOTICE 'P195 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_exp UUID := gen_random_uuid();
  v_page JSONB;
  v_hit INT;
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192501001',
    'P195 disponibles rechazo', '5519250101', '', 'interno', 'activo',
    true, v_envio, 2, 'rechazado', v_envio
  );
  INSERT INTO public.mesa_expediente_ops (
    expediente_id, organization_id, estado_mesa, assigned_to
  ) VALUES (
    v_exp, v_org, 'sin_asignar', NULL
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    estado_mesa = 'sin_asignar',
    assigned_to = NULL;

  PERFORM public.__p195_set_auth(v_mesa);

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'todos', 'sin_asignar',
    'P195 disponibles rechazo', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE (x->>'id')::uuid = v_exp;
  PERFORM public.__p195_assert(v_hit = 0, 'activo+rechazado NO está en Disponibles');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'rechazos_cancelaciones', 'todo_mesa',
    'P195 disponibles rechazo', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE (x->>'id')::uuid = v_exp;
  PERFORM public.__p195_assert(v_hit = 1, 'activo+rechazado SÍ está en Rechazados');

  PERFORM public.__p195_reset_auth();
  UPDATE public.expedientes
  SET subestado = 'en_validacion_mesa'
  WHERE id = v_exp;
  PERFORM public.__p195_assert(
    (SELECT subestado::text FROM public.expedientes WHERE id = v_exp) = 'en_validacion_mesa',
    'post-reactivación subestado deja de ser rechazado'
  );

  PERFORM public.__p195_set_auth(v_mesa);
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'todos', 'sin_asignar',
    'P195 disponibles rechazo', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE (x->>'id')::uuid = v_exp;
  PERFORM public.__p195_assert(v_hit = 1, 'tras reactivar vuelve a Disponibles');

  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'rechazos_cancelaciones', 'todo_mesa',
    'P195 disponibles rechazo', NULL, NULL, false, NULL, 'rechazados', NULL, false
  );
  SELECT count(*)::int INTO v_hit
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE (x->>'id')::uuid = v_exp;
  PERFORM public.__p195_assert(v_hit = 0, 'tras reactivar sale de Rechazados');

  PERFORM public.__p195_reset_auth();
  RAISE NOTICE 'P195 OK: disponibles excluye rechazo; reactivar restaura membership';
END;
$$;

DROP FUNCTION IF EXISTS public.__p195_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p195_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p195_reset_auth();
