-- ConCasa CRM — pruebas P2C-1 auditoría e historial documental
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/audit_document_history.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__audit_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'AUDIT TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__audit_test_try_insert_action_log_as(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  BEGIN
    INSERT INTO public.action_log (
      organization_id, actor_id, actor_role, action, entity_type, entity_id
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      p_user_id,
      'asesor',
      'test.direct_insert',
      'expediente',
      '00000000-0000-4000-9001-000000000001'
    );
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN true;
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM set_config('role', 'postgres', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      RETURN false;
    WHEN OTHERS THEN
      PERFORM set_config('role', 'postgres', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      RETURN false;
  END;
END;
$$;

-- UUIDs dev (ver seed.sql)
-- org              00000000-0000-4000-8000-000000000001
-- asesor_interno   00000000-0000-4000-8001-000000000001
-- mesa_interno     00000000-0000-4000-8004-000000000001
-- super_admin      00000000-0000-4000-8006-000000000001
-- exp_int_env_a1   00000000-0000-4000-9001-000000000001

DO $$
DECLARE
  v_doc_id UUID := '00000000-0000-4000-9004-000000000099';
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_exp_id UUID := '00000000-0000-4000-9001-000000000001';
  v_asesor_id UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa_id UUID := '00000000-0000-4000-8004-000000000001';
  v_count BIGINT;
  v_log_id UUID;
  v_blocked BOOLEAN;
BEGIN
  -- Fixture documento (postgres bypass RLS; INSERT inicial no genera historial)
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento,
    storage_path, nombre_original, mime_type, size_bytes,
    estatus_revision, comentario_mesa, uploaded_by, uploaded_by_role
  ) VALUES (
    v_doc_id,
    v_org_id,
    v_exp_id,
    'ine',
    'dev/fixtures/ine.pdf',
    'ine.pdf',
    'application/pdf',
    1024,
    'subido',
    NULL,
    v_asesor_id,
    'asesor'
  )
  ON CONFLICT (id) DO UPDATE SET
    estatus_revision = 'subido',
    comentario_mesa = NULL,
    updated_at = NOW();

  SELECT count(*) INTO v_count
  FROM public.documento_revisiones
  WHERE documento_id = v_doc_id;

  PERFORM public.__audit_test_assert(
    v_count = 0,
    'INSERT inicial no crea fila en documento_revisiones'
  );

  -- Test 2: cambio estatus subido -> validado (postgres + JWT simulado para actor_id)
  -- Nota: sin RPC P2C-2, UPDATE como authenticated está bloqueado por RLS (sin policy UPDATE).
  PERFORM set_config('request.jwt.claim.sub', v_mesa_id::text, true);

  UPDATE public.expediente_documentos
  SET estatus_revision = 'validado'
  WHERE id = v_doc_id;

  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT count(*) INTO v_count
  FROM public.documento_revisiones
  WHERE documento_id = v_doc_id
    AND estatus_anterior = 'subido'
    AND estatus_nuevo = 'validado';

  PERFORM public.__audit_test_assert(
    v_count = 1,
    'UPDATE estatus subido->validado crea una fila en documento_revisiones'
  );

  PERFORM public.__audit_test_assert(
    EXISTS (
      SELECT 1
      FROM public.documento_revisiones
      WHERE documento_id = v_doc_id
        AND estatus_nuevo = 'validado'
        AND actor_id = v_mesa_id
    ),
    'historial registra actor_id desde current_profile_id()'
  );

  -- Test 3: cambio comentario_mesa crea otra fila
  PERFORM set_config('request.jwt.claim.sub', v_mesa_id::text, true);

  UPDATE public.expediente_documentos
  SET comentario_mesa = 'Revisión OK con observación menor'
  WHERE id = v_doc_id;

  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT count(*) INTO v_count
  FROM public.documento_revisiones
  WHERE documento_id = v_doc_id
    AND comentario_mesa = 'Revisión OK con observación menor';

  PERFORM public.__audit_test_assert(
    v_count = 1,
    'UPDATE comentario_mesa crea fila adicional en documento_revisiones'
  );

  SELECT count(*) INTO v_count
  FROM public.documento_revisiones
  WHERE documento_id = v_doc_id;

  PERFORM public.__audit_test_assert(
    v_count = 2,
    'total historial esperado: 2 filas tras estatus + comentario'
  );

  -- Test 4: UPDATE sin cambiar estatus ni comentario no agrega fila
  UPDATE public.expediente_documentos
  SET nombre_original = 'ine_renombrado.pdf'
  WHERE id = v_doc_id;

  SELECT count(*) INTO v_count
  FROM public.documento_revisiones
  WHERE documento_id = v_doc_id;

  PERFORM public.__audit_test_assert(
    v_count = 2,
    'UPDATE sin cambio estatus/comentario NO crea fila nueva'
  );

  -- Test 5: log_action registra evento
  SELECT public.log_action(
    v_org_id,
    v_mesa_id,
    'mesa_interno'::public.app_role,
    'documento.revision.test',
    'expediente_documento',
    v_doc_id,
    '{"test":"p2c1"}'::jsonb
  ) INTO v_log_id;

  PERFORM public.__audit_test_assert(
    v_log_id IS NOT NULL,
    'log_action retorna id'
  );

  PERFORM public.__audit_test_assert(
    EXISTS (
      SELECT 1
      FROM public.action_log
      WHERE id = v_log_id
        AND action = 'documento.revision.test'
        AND entity_type = 'expediente_documento'
        AND entity_id = v_doc_id
        AND payload->>'test' = 'p2c1'
    ),
    'log_action inserta fila en action_log'
  );

  -- Test 6: usuario authenticated no puede INSERT directo en action_log
  v_blocked := NOT public.__audit_test_try_insert_action_log_as(v_asesor_id);

  PERFORM public.__audit_test_assert(
    v_blocked,
    'asesor authenticated no puede INSERT directo en action_log (RLS/privilegios)'
  );

  RAISE NOTICE 'Audit/document history tests: ALL PASSED';
END;
$$;

DROP FUNCTION IF EXISTS public.__audit_test_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__audit_test_try_insert_action_log_as(UUID);
