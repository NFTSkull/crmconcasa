-- ConCasa CRM — P136: mesa_eliminar_documento_expediente (estructural + grants)
-- Uso: npx supabase db query --linked -f supabase/tests/rpc_mesa_eliminar_documentos_operativos_p136.sql

CREATE OR REPLACE FUNCTION public.__p136_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P136 FAIL: %', p_msg; END IF; END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  PERFORM public.__p136_assert(
    'cliente_notificacion_apodaca' = ANY(public.integration_doc_tipos_mesa_upload()),
    'apodaca en mesa_upload'
  );
  PERFORM public.__p136_assert(
    'cliente_pagare' = ANY(public.integration_doc_tipos_mesa_upload()),
    'pagare en mesa_upload'
  );
  PERFORM public.__p136_assert(
    'cliente_notificacion' = ANY(public.integration_doc_tipos_mesa_upload()),
    'notificacion en mesa_upload'
  );
  PERFORM public.__p136_assert(
    NOT ('notificacion' = ANY(public.integration_doc_tipos_mesa_upload())),
    'nunca tipo corto notificacion'
  );

  PERFORM public.__p136_assert(
    'cliente_pagare' = ANY(public.mesa_tipos_documento_operativos_mutables()),
    'mutable pagare'
  );
  PERFORM public.__p136_assert(
    'cliente_notificacion' = ANY(public.mesa_tipos_documento_operativos_mutables()),
    'mutable notificacion'
  );
  PERFORM public.__p136_assert(
    'cliente_notificacion_apodaca' = ANY(public.mesa_tipos_documento_operativos_mutables()),
    'mutable apodaca'
  );
  PERFORM public.__p136_assert(
    NOT ('cliente_solicitud' = ANY(public.mesa_tipos_documento_operativos_mutables())),
    'solicitud no mutable P136'
  );

  PERFORM public.__p136_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'mesa_eliminar_documento_expediente'
    ),
    'rpc eliminar existe'
  );

  PERFORM public.__p136_assert(
    has_function_privilege(
      'authenticated',
      'public.mesa_eliminar_documento_expediente(uuid,text)',
      'EXECUTE'
    ),
    'grant authenticated'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_eliminar_documento_expediente'
  LIMIT 1;

  PERFORM public.__p136_assert(position('SET etapa_actual' in v_src) = 0, 'no setea etapa_actual');
  PERFORM public.__p136_assert(position('mesa_eliminar' in v_src) > 0, 'action log mesa_eliminar');
  PERFORM public.__p136_assert(position('already_absent' in v_src) > 0, 'idempotente');
  PERFORM public.__p136_assert(
    position('v_actor_role public.app_role' in v_src) > 0
      OR position('v_actor_role app_role' in v_src) > 0,
    'actor_role tipado app_role (fix log_action)'
  );
  PERFORM public.__p136_assert(
    position('https://' in lower(v_src)) = 0,
    'sin urls https en payload builder'
  );

  -- register_mesa_documento intacto (reemplazo)
  PERFORM public.__p136_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'register_mesa_documento'
    ),
    'register_mesa_documento intacto'
  );

  RAISE NOTICE 'P136 MESA ELIMINAR DOCS OK';
END $$;

DROP FUNCTION IF EXISTS public.__p136_assert(BOOLEAN, TEXT);
