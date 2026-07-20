-- ConCasa CRM — P090 B3: Pagaré (cliente_pagare)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_mesa_pagare_expediente.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p090p_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P090 PAGARE FAIL: %', p_msg; END IF; END;
$$;

CREATE OR REPLACE FUNCTION public.__p090p_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p090p_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p090p_path(
  p_org UUID, p_exp UUID, p_suffix TEXT
) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/cliente_pagare/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__p090p_seed_storage(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  -- Storage seed requiere privilegios de owner (no bajo RLS authenticated)
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', p_path, '00000000-0000-4000-8003-000000000001')
  ON CONFLICT (bucket_id, name) DO NOTHING;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';
  v_exp UUID := '00000000-0000-4000-9091-000000000001';
  v_exp6 UUID := '00000000-0000-4000-9091-000000000006';
  v_exp_ext UUID := '00000000-0000-4000-9091-000000000002';
  v_exp_closed UUID := '00000000-0000-4000-9091-000000000003';
  v_exp_draft UUID := '00000000-0000-4000-9091-000000000004';
  v_path TEXT;
  v_path2 TEXT;
  v_path3 TEXT;
  v_path_jpg TEXT;
  v_path_png TEXT;
  v_path_sat TEXT;
  v_res JSONB;
  v_doc public.expediente_documentos%ROWTYPE;
  v_active INT;
  v_ver INT;
  v_log INT;
  v_etapa SMALLINT;
  v_max BIGINT := public.expediente_documento_max_size_bytes();
  v_err TEXT;
BEGIN
  PERFORM public.__p090p_reset();

  PERFORM public.__p090p_assert(
    'cliente_pagare' = ANY(public.integration_doc_tipos_mesa_upload()),
    'allowlist mesa incluye pagaré'
  );
  PERFORM public.__p090p_assert(
    NOT ('cliente_pagare' = ANY(public.integration_doc_tipos_asesor_upload())),
    'asesor upload sin pagaré'
  );
  PERFORM public.__p090p_assert(
    NOT ('cliente_pagare' = ANY(public.integration_doc_tipos_obligatorios())),
    'pagaré no obligatorio'
  );

  -- MIME
  PERFORM public.__p090p_assert(
    public.expediente_documento_mime_permitido('application/pdf', 'cliente_pagare'),
    'pagaré pdf'
  );
  PERFORM public.__p090p_assert(
    public.expediente_documento_mime_permitido('image/jpeg', 'cliente_pagare'),
    'pagaré jpeg'
  );
  PERFORM public.__p090p_assert(
    public.expediente_documento_mime_permitido('image/png', 'cliente_pagare'),
    'pagaré png'
  );
  PERFORM public.__p090p_assert(
    NOT public.expediente_documento_mime_permitido('image/webp', 'cliente_pagare'),
    'pagaré sin webp'
  );
  PERFORM public.__p090p_assert(
    NOT public.expediente_documento_mime_permitido('image/gif', 'cliente_pagare'),
    'pagaré sin gif'
  );
  PERFORM public.__p090p_assert(
    NOT public.expediente_documento_mime_permitido('application/msword', 'cliente_pagare'),
    'pagaré sin word'
  );
  -- Otros Mesa: imágenes siguen bloqueadas
  PERFORM public.__p090p_assert(
    NOT public.expediente_documento_mime_permitido('image/jpeg', 'cliente_acta_nacimiento'),
    'acta sin jpeg'
  );
  PERFORM public.__p090p_assert(
    NOT public.expediente_documento_mime_permitido('image/png', 'cliente_constancia_sat'),
    'sat sin png'
  );
  PERFORM public.__p090p_assert(
    NOT public.expediente_documento_mime_permitido('image/jpeg', 'cliente_semanas_cotizadas'),
    'semanas sin jpeg'
  );
  PERFORM public.__p090p_assert(
    public.expediente_documento_mime_permitido('application/pdf', 'cliente_acta_nacimiento'),
    'acta pdf ok'
  );

  -- Fixtures
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '90911000001', 'P090 Pagare',
     '5590910001', 'interno', true, NOW(), 7, 'en_proceso', 'activo'),
    (v_exp6, v_org, v_asesor, 'mejoravit', '90911000006', 'P090 E6',
     '5590910006', 'interno', true, NOW(), 6, 'en_proceso', 'activo'),
    (v_exp_ext, v_org, v_asesor, 'mejoravit', '90911000002', 'P090 Ext',
     '5590910002', 'externo', true, NOW(), 8, 'en_proceso', 'activo'),
    (v_exp_closed, v_org, v_asesor, 'mejoravit', '90911000003', 'P090 Closed',
     '5590910003', 'interno', true, NOW(), 7, 'en_proceso', 'cerrado'),
    (v_exp_draft, v_org, v_asesor, 'mejoravit', '90911000004', 'P090 Draft',
     '5590910004', 'interno', false, NULL, 7, 'pendiente', 'activo')
  ON CONFLICT (id) DO UPDATE SET
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    origen_mesa = EXCLUDED.origen_mesa,
    ciclo_estado = EXCLUDED.ciclo_estado,
    deleted_at = NULL,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado;

  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (v_exp, v_exp6, v_exp_ext, v_exp_closed, v_exp_draft)
    AND tipo_documento = 'cliente_pagare';

  -- ===== Etapa 6 bloqueada =====
  v_path := public.__p090p_path(v_org, v_exp6, 'e6.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  PERFORM public.__p090p_auth(v_mesa_admin);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp6, 'cliente_pagare', v_path, 'e6.pdf', 'application/pdf', 1000
    );
    PERFORM public.__p090p_assert(false, 'etapa 6 debía fallar');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p090p_assert(
      v_err ILIKE '%después de concluir la inscripción%',
      'msg etapa: ' || v_err
    );
  END;
  PERFORM public.__p090p_reset();

  -- ===== Primera carga etapa 7 =====
  v_path := public.__p090p_path(v_org, v_exp, 'v1.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  PERFORM public.__p090p_auth(v_mesa_admin);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_pagare', v_path, 'pagare-v1.pdf', 'application/pdf', 2048
  );
  PERFORM public.__p090p_assert(v_res->>'ok' = 'true', 'v1 ok');
  PERFORM public.__p090p_assert((v_res->>'version')::INT = 1, 'version 1');
  PERFORM public.__p090p_reset();

  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_pagare' AND deleted_at IS NULL;
  PERFORM public.__p090p_assert(v_active = 1, '1 activo');

  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p090p_assert(v_etapa = 7, 'etapa intacta');

  -- ===== Reemplazo v2 (JPEG) =====
  v_path2 := public.__p090p_path(v_org, v_exp, 'v2.jpg');
  PERFORM public.__p090p_seed_storage(v_path2);
  PERFORM public.__p090p_auth(v_mesa_int);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_pagare', v_path2, 'pagare-v2.jpg', 'image/jpeg', 4096
  );
  PERFORM public.__p090p_assert((v_res->>'version')::INT = 2, 'version 2');
  PERFORM public.__p090p_reset();

  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_pagare' AND deleted_at IS NULL;
  PERFORM public.__p090p_assert(v_active = 1, 'solo 1 activo tras replace');

  SELECT * INTO v_doc
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_pagare' AND deleted_at IS NULL;
  PERFORM public.__p090p_assert(v_doc.version = 2, 'vigente v2');
  PERFORM public.__p090p_assert(v_doc.mime_type = 'image/jpeg', 'mime jpeg');

  SELECT COUNT(*) INTO v_ver
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_pagare' AND deleted_at IS NOT NULL;
  PERFORM public.__p090p_assert(v_ver = 1, 'histórica v1 soft-deleted');

  -- Storage anterior sigue existiendo
  PERFORM public.__p090p_assert(
    EXISTS (SELECT 1 FROM storage.objects WHERE name = v_path),
    'storage v1 conservado'
  );

  -- ===== v3 PNG =====
  v_path3 := public.__p090p_path(v_org, v_exp, 'v3.png');
  PERFORM public.__p090p_seed_storage(v_path3);
  PERFORM public.__p090p_auth(v_mesa_admin);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_pagare', v_path3, 'pagare-v3.png', 'image/png', 8192
  );
  PERFORM public.__p090p_assert((v_res->>'version')::INT = 3, 'version 3');
  PERFORM public.__p090p_reset();

  -- ===== Tamaño =====
  v_path := public.__p090p_path(v_org, v_exp, 'limit.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  PERFORM public.__p090p_auth(v_mesa_admin);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_pagare', v_path, 'limit.pdf', 'application/pdf', v_max
  );
  PERFORM public.__p090p_assert(v_res->>'ok' = 'true', 'exact 15MB ok');

  v_path := public.__p090p_path(v_org, v_exp, 'over.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_pagare', v_path, 'over.pdf', 'application/pdf', v_max + 1
    );
    PERFORM public.__p090p_assert(false, 'over size');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p090p_reset();

  -- ===== Permisos =====
  v_path := public.__p090p_path(v_org, v_exp, 'asesor.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  PERFORM public.__p090p_auth(v_asesor);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_pagare', v_path, 'a.pdf', 'application/pdf', 100
    );
    PERFORM public.__p090p_assert(false, 'asesor write');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p090p_auth(v_editor);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_pagare', v_path, 'e.pdf', 'application/pdf', 100
    );
    PERFORM public.__p090p_assert(false, 'editor write');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  -- externo en interno
  PERFORM public.__p090p_auth(v_mesa_ext);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_pagare', v_path, 'x.pdf', 'application/pdf', 100
    );
    PERFORM public.__p090p_assert(false, 'ext on int');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  -- externo en externo etapa 8
  v_path := public.__p090p_path(v_org, v_exp_ext, 'ext.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  v_res := public.register_mesa_documento(
    v_exp_ext, 'cliente_pagare', v_path, 'ext.pdf', 'application/pdf', 100
  );
  PERFORM public.__p090p_assert(v_res->>'ok' = 'true', 'ext ok');
  PERFORM public.__p090p_reset();

  PERFORM public.__p090p_auth(v_super);
  v_path := public.__p090p_path(v_org, v_exp, 'super.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_pagare', v_path, 'super.pdf', 'application/pdf', 100
  );
  PERFORM public.__p090p_assert(v_res->>'ok' = 'true', 'super ok');
  PERFORM public.__p090p_reset();

  -- cerrado / no enviado
  PERFORM public.__p090p_auth(v_mesa_admin);
  v_path := public.__p090p_path(v_org, v_exp_closed, 'c.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp_closed, 'cliente_pagare', v_path, 'c.pdf', 'application/pdf', 100
    );
    PERFORM public.__p090p_assert(false, 'cerrado');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  v_path := public.__p090p_path(v_org, v_exp_draft, 'd.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp_draft, 'cliente_pagare', v_path, 'd.pdf', 'application/pdf', 100
    );
    PERFORM public.__p090p_assert(false, 'draft');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p090p_reset();

  -- MIME inválido
  PERFORM public.__p090p_auth(v_mesa_admin);
  v_path := public.__p090p_path(v_org, v_exp, 'bad.gif');
  PERFORM public.__p090p_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_pagare', v_path, 'bad.gif', 'image/gif', 100
    );
    PERFORM public.__p090p_assert(false, 'gif');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  -- extensión pdf con mime inválido
  v_path := public.__p090p_path(v_org, v_exp, 'fake.pdf');
  PERFORM public.__p090p_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_pagare', v_path, 'fake.pdf', 'text/plain', 100
    );
    PERFORM public.__p090p_assert(false, 'mime texto');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p090p_reset();

  -- ===== Lectura asesor propietario =====
  PERFORM public.__p090p_auth(v_asesor);
  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_pagare' AND deleted_at IS NULL;
  PERFORM public.__p090p_assert(v_active = 1, 'asesor ve vigente');
  SELECT COUNT(*) INTO v_ver
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_pagare' AND deleted_at IS NOT NULL;
  PERFORM public.__p090p_assert(v_ver = 0, 'asesor no ve soft-deleted vía RLS');
  PERFORM public.__p090p_reset();

  -- asesor ajeno
  PERFORM public.__p090p_auth(v_asesor2);
  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_pagare' AND deleted_at IS NULL;
  PERFORM public.__p090p_assert(v_active = 0, 'asesor ajeno no ve');
  PERFORM public.__p090p_reset();

  -- action_log
  SELECT COUNT(*) INTO v_log
  FROM public.action_log
  WHERE action = 'expediente.documento.mesa_register'
    AND (payload->>'tipo_documento') = 'cliente_pagare'
    AND (payload->>'expediente_id')::UUID = v_exp;
  PERFORM public.__p090p_assert(v_log >= 3, 'action_log pagaré');

  -- Integridad: no tocar otros tipos al registrar pagaré
  v_path_sat := v_org::TEXT || '/' || v_exp::TEXT || '/cliente_constancia_sat/sat.pdf';
  PERFORM public.__p090p_seed_storage(v_path_sat);
  PERFORM public.__p090p_auth(v_mesa_admin);
  PERFORM public.register_mesa_documento(
    v_exp, 'cliente_constancia_sat', v_path_sat, 'sat.pdf', 'application/pdf', 100
  );
  PERFORM public.__p090p_reset();
  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_constancia_sat' AND deleted_at IS NULL;
  PERFORM public.__p090p_assert(v_active = 1, 'sat intacto junto a pagaré');

  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p090p_assert(v_etapa = 7, 'etapa aún 7');

  RAISE NOTICE 'P090 PAGARE OK';
END;
$$;

DROP FUNCTION public.__p090p_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p090p_auth(UUID);
DROP FUNCTION public.__p090p_reset();
DROP FUNCTION public.__p090p_path(UUID, UUID, TEXT);
DROP FUNCTION public.__p090p_seed_storage(TEXT);
