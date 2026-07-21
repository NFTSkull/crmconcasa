-- ConCasa CRM — P096: Solicitud documento (cliente_solicitud)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_mesa_solicitud_documento_expediente.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p096s_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P096 SOLICITUD DOC FAIL: %', p_msg; END IF; END;
$$;

CREATE OR REPLACE FUNCTION public.__p096s_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p096s_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p096s_path(
  p_org UUID, p_exp UUID, p_suffix TEXT
) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/cliente_solicitud/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__p096s_pagare_path(
  p_org UUID, p_exp UUID, p_suffix TEXT
) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/cliente_pagare/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__p096s_notif_path(
  p_org UUID, p_exp UUID, p_suffix TEXT
) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/cliente_notificacion/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__p096s_seed_storage(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
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
  v_exp UUID := '00000000-0000-4000-9092-000000000001';
  v_exp6 UUID := '00000000-0000-4000-9092-000000000006';
  v_exp_ext UUID := '00000000-0000-4000-9092-000000000002';
  v_exp_closed UUID := '00000000-0000-4000-9092-000000000003';
  v_exp_draft UUID := '00000000-0000-4000-9092-000000000004';
  v_path TEXT;
  v_path2 TEXT;
  v_path3 TEXT;
  v_path_pagare TEXT;
  v_path_notif TEXT;
  v_path_sat TEXT;
  v_res JSONB;
  v_doc public.expediente_documentos%ROWTYPE;
  v_active INT;
  v_ver INT;
  v_log INT;
  v_etapa SMALLINT;
  v_max BIGINT := public.expediente_documento_max_size_bytes();
  v_err TEXT;
  v_pagare_before INT;
  v_pagare_after INT;
BEGIN
  PERFORM public.__p096s_reset();

  PERFORM public.__p096s_assert(
    'cliente_solicitud' = ANY(public.integration_doc_tipos_mesa_upload()),
    'allowlist mesa incluye cliente_solicitud'
  );
  PERFORM public.__p096s_assert(
    'cliente_pagare' = ANY(public.integration_doc_tipos_mesa_upload()),
    'allowlist conserva cliente_pagare'
  );
  PERFORM public.__p096s_assert(
    'cliente_notificacion' = ANY(public.integration_doc_tipos_mesa_upload()),
    'allowlist conserva cliente_notificacion'
  );
  PERFORM public.__p096s_assert(
    NOT ('notificacion' = ANY(public.integration_doc_tipos_mesa_upload())),
    'allowlist NO usa tipo corto notificacion'
  );
  PERFORM public.__p096s_assert(
    NOT ('solicitud' = ANY(public.integration_doc_tipos_mesa_upload())),
    'allowlist NO usa tipo corto solicitud'
  );
  PERFORM public.__p096s_assert(
    NOT ('cliente_solicitud' = ANY(public.integration_doc_tipos_asesor_upload())),
    'asesor upload sin cliente_solicitud'
  );
  PERFORM public.__p096s_assert(
    NOT ('cliente_solicitud' = ANY(public.integration_doc_tipos_obligatorios())),
    'cliente_solicitud no obligatorio'
  );
  PERFORM public.__p096s_assert(v_max = 15728640, 'max size 15 MiB');

  -- MIME Solicitud doc
  PERFORM public.__p096s_assert(
    public.expediente_documento_mime_permitido('application/pdf', 'cliente_solicitud'),
    'solicitud doc pdf'
  );
  PERFORM public.__p096s_assert(
    public.expediente_documento_mime_permitido('image/jpeg', 'cliente_solicitud'),
    'solicitud doc jpeg'
  );
  PERFORM public.__p096s_assert(
    public.expediente_documento_mime_permitido('image/png', 'cliente_solicitud'),
    'solicitud doc png'
  );
  PERFORM public.__p096s_assert(
    NOT public.expediente_documento_mime_permitido('image/webp', 'cliente_solicitud'),
    'solicitud doc sin webp'
  );
  PERFORM public.__p096s_assert(
    NOT public.expediente_documento_mime_permitido('image/gif', 'cliente_solicitud'),
    'solicitud doc sin gif'
  );
  PERFORM public.__p096s_assert(
    NOT public.expediente_documento_mime_permitido('application/msword', 'cliente_solicitud'),
    'solicitud doc sin word'
  );
  -- Pagaré MIME intacto
  PERFORM public.__p096s_assert(
    public.expediente_documento_mime_permitido('image/jpeg', 'cliente_pagare'),
    'pagaré jpeg intacto'
  );
  -- Otros Mesa: imágenes siguen bloqueadas
  PERFORM public.__p096s_assert(
    NOT public.expediente_documento_mime_permitido('image/jpeg', 'cliente_acta_nacimiento'),
    'acta sin jpeg'
  );
  PERFORM public.__p096s_assert(
    NOT public.expediente_documento_mime_permitido('image/png', 'cliente_constancia_sat'),
    'sat sin png'
  );
  PERFORM public.__p096s_assert(
    NOT public.expediente_documento_mime_permitido('image/jpeg', 'cliente_semanas_cotizadas'),
    'semanas sin jpeg'
  );
  PERFORM public.__p096s_assert(
    public.expediente_documento_mime_permitido('application/pdf', 'cliente_acta_nacimiento'),
    'acta pdf ok'
  );

  -- Fixtures (UUIDs 9092* — no colisionan con P090 9091*)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '90921000001', 'P092 NotifDoc',
     '5590920001', 'interno', true, NOW(), 7, 'en_proceso', 'activo'),
    (v_exp6, v_org, v_asesor, 'mejoravit', '90921000006', 'P092 E6',
     '5590920006', 'interno', true, NOW(), 6, 'en_proceso', 'activo'),
    (v_exp_ext, v_org, v_asesor, 'mejoravit', '90921000002', 'P092 Ext',
     '5590920002', 'externo', true, NOW(), 8, 'en_proceso', 'activo'),
    (v_exp_closed, v_org, v_asesor, 'mejoravit', '90921000003', 'P092 Closed',
     '5590920003', 'interno', true, NOW(), 7, 'en_proceso', 'cerrado'),
    (v_exp_draft, v_org, v_asesor, 'mejoravit', '90921000004', 'P092 Draft',
     '5590920004', 'interno', false, NULL, 7, 'pendiente', 'activo')
  ON CONFLICT (id) DO UPDATE SET
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    origen_mesa = EXCLUDED.origen_mesa,
    ciclo_estado = EXCLUDED.ciclo_estado,
    deleted_at = NULL,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado;

  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (v_exp, v_exp6, v_exp_ext, v_exp_closed, v_exp_draft)
    AND tipo_documento IN ('cliente_solicitud', 'cliente_pagare', 'cliente_notificacion', 'cliente_constancia_sat');

  -- Tipo corto 'notificacion' rechazado en register
  v_path := public.__p096s_path(v_org, v_exp, 'wrong-tipo.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  PERFORM public.__p096s_auth(v_mesa_admin);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'notificacion', v_path, 'x.pdf', 'application/pdf', 1000
    );
    PERFORM public.__p096s_assert(false, 'tipo corto notificacion debía fallar');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p096s_assert(
      v_err ILIKE '%no permitido%',
      'msg tipo corto: ' || v_err
    );
  END;
  PERFORM public.__p096s_reset();

  -- Tipo corto 'solicitud' rechazado en register
  BEGIN
    PERFORM public.__p096s_auth(v_mesa_admin);
    PERFORM public.register_mesa_documento(
      v_exp, 'solicitud', v_path, 'x.pdf', 'application/pdf', 1000
    );
    PERFORM public.__p096s_assert(false, 'tipo corto solicitud debía fallar');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p096s_assert(
      v_err ILIKE '%no permitido%',
      'msg tipo corto solicitud: ' || v_err
    );
  END;
  PERFORM public.__p096s_reset();

  -- ===== Etapa 6 bloqueada =====
  v_path := public.__p096s_path(v_org, v_exp6, 'e6.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  PERFORM public.__p096s_auth(v_mesa_admin);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp6, 'cliente_solicitud', v_path, 'e6.pdf', 'application/pdf', 1000
    );
    PERFORM public.__p096s_assert(false, 'etapa 6 debía fallar');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p096s_assert(
      v_err ILIKE '%documento Solicitud%'
        AND v_err ILIKE '%después de concluir la inscripción%',
      'msg etapa: ' || v_err
    );
  END;
  PERFORM public.__p096s_reset();

  -- ===== Primera carga etapa 7 =====
  v_path := public.__p096s_path(v_org, v_exp, 'v1.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  PERFORM public.__p096s_auth(v_mesa_admin);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_solicitud', v_path, 'sol-v1.pdf', 'application/pdf', 2048
  );
  PERFORM public.__p096s_assert(v_res->>'ok' = 'true', 'v1 ok');
  PERFORM public.__p096s_assert((v_res->>'version')::INT = 1, 'version 1');
  PERFORM public.__p096s_assert(v_res->>'tipo_documento' = 'cliente_solicitud', 'tipo en resp');
  PERFORM public.__p096s_reset();

  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_active = 1, '1 activo');

  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p096s_assert(v_etapa = 7, 'etapa intacta');

  -- ===== Reemplazo v2 (JPEG) =====
  v_path2 := public.__p096s_path(v_org, v_exp, 'v2.jpg');
  PERFORM public.__p096s_seed_storage(v_path2);
  PERFORM public.__p096s_auth(v_mesa_int);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_solicitud', v_path2, 'sol-v2.jpg', 'image/jpeg', 4096
  );
  PERFORM public.__p096s_assert((v_res->>'version')::INT = 2, 'version 2');
  PERFORM public.__p096s_reset();

  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_active = 1, 'solo 1 activo tras replace');

  SELECT * INTO v_doc
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_doc.version = 2, 'vigente v2');
  PERFORM public.__p096s_assert(v_doc.mime_type = 'image/jpeg', 'mime jpeg');

  SELECT COUNT(*) INTO v_ver
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NOT NULL;
  PERFORM public.__p096s_assert(v_ver = 1, 'histórica v1 soft-deleted');

  PERFORM public.__p096s_assert(
    EXISTS (SELECT 1 FROM storage.objects WHERE name = v_path),
    'storage v1 conservado'
  );

  -- ===== v3 PNG =====
  v_path3 := public.__p096s_path(v_org, v_exp, 'v3.png');
  PERFORM public.__p096s_seed_storage(v_path3);
  PERFORM public.__p096s_auth(v_mesa_admin);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_solicitud', v_path3, 'sol-v3.png', 'image/png', 8192
  );
  PERFORM public.__p096s_assert((v_res->>'version')::INT = 3, 'version 3');
  PERFORM public.__p096s_reset();

  -- ===== Independencia vs Pagaré: registrar pagaré no altera solicitud vigente =====
  SELECT COUNT(*) INTO v_pagare_before
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NULL;

  v_path_pagare := public.__p096s_pagare_path(v_org, v_exp, 'indep.pdf');
  PERFORM public.__p096s_seed_storage(v_path_pagare);
  PERFORM public.__p096s_auth(v_mesa_admin);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_pagare', v_path_pagare, 'pagare-indep.pdf', 'application/pdf', 500
  );
  PERFORM public.__p096s_assert(v_res->>'ok' = 'true', 'pagaré paralelo ok');
  PERFORM public.__p096s_reset();

  SELECT COUNT(*) INTO v_pagare_after
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_pagare_after = v_pagare_before, 'solicitud intacta al registrar pagaré');

  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_pagare' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_active = 1, 'pagaré vigente paralelo');

  SELECT * INTO v_doc
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_doc.version = 3, 'solicitud sigue en v3');

  -- ===== Independencia vs Notificación =====
  v_path_notif := public.__p096s_notif_path(v_org, v_exp, 'indep-notif.pdf');
  PERFORM public.__p096s_seed_storage(v_path_notif);
  PERFORM public.__p096s_auth(v_mesa_admin);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_notificacion', v_path_notif, 'notif-indep.pdf', 'application/pdf', 500
  );
  PERFORM public.__p096s_assert(v_res->>'ok' = 'true', 'notif paralelo ok');
  PERFORM public.__p096s_reset();

  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_active = 1, 'solicitud intacta al registrar notif');
  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_notificacion' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_active = 1, 'notif vigente paralelo');

  -- ===== Tamaño =====
  v_path := public.__p096s_path(v_org, v_exp, 'limit.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  PERFORM public.__p096s_auth(v_mesa_admin);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_solicitud', v_path, 'limit.pdf', 'application/pdf', v_max
  );
  PERFORM public.__p096s_assert(v_res->>'ok' = 'true', 'exact 15MB ok');

  v_path := public.__p096s_path(v_org, v_exp, 'over.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_solicitud', v_path, 'over.pdf', 'application/pdf', v_max + 1
    );
    PERFORM public.__p096s_assert(false, 'over size');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p096s_reset();

  -- ===== Permisos =====
  v_path := public.__p096s_path(v_org, v_exp, 'asesor.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  PERFORM public.__p096s_auth(v_asesor);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_solicitud', v_path, 'a.pdf', 'application/pdf', 100
    );
    PERFORM public.__p096s_assert(false, 'asesor write');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p096s_auth(v_editor);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_solicitud', v_path, 'e.pdf', 'application/pdf', 100
    );
    PERFORM public.__p096s_assert(false, 'editor write');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p096s_auth(v_mesa_ext);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_solicitud', v_path, 'x.pdf', 'application/pdf', 100
    );
    PERFORM public.__p096s_assert(false, 'ext on int');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  v_path := public.__p096s_path(v_org, v_exp_ext, 'ext.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  v_res := public.register_mesa_documento(
    v_exp_ext, 'cliente_solicitud', v_path, 'ext.pdf', 'application/pdf', 100
  );
  PERFORM public.__p096s_assert(v_res->>'ok' = 'true', 'ext ok');
  PERFORM public.__p096s_reset();

  PERFORM public.__p096s_auth(v_super);
  v_path := public.__p096s_path(v_org, v_exp, 'super.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  v_res := public.register_mesa_documento(
    v_exp, 'cliente_solicitud', v_path, 'super.pdf', 'application/pdf', 100
  );
  PERFORM public.__p096s_assert(v_res->>'ok' = 'true', 'super ok');
  PERFORM public.__p096s_reset();

  -- cerrado / no enviado
  PERFORM public.__p096s_auth(v_mesa_admin);
  v_path := public.__p096s_path(v_org, v_exp_closed, 'c.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp_closed, 'cliente_solicitud', v_path, 'c.pdf', 'application/pdf', 100
    );
    PERFORM public.__p096s_assert(false, 'cerrado');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  v_path := public.__p096s_path(v_org, v_exp_draft, 'd.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp_draft, 'cliente_solicitud', v_path, 'd.pdf', 'application/pdf', 100
    );
    PERFORM public.__p096s_assert(false, 'draft');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p096s_reset();

  -- MIME inválido
  PERFORM public.__p096s_auth(v_mesa_admin);
  v_path := public.__p096s_path(v_org, v_exp, 'bad.gif');
  PERFORM public.__p096s_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_solicitud', v_path, 'bad.gif', 'image/gif', 100
    );
    PERFORM public.__p096s_assert(false, 'gif');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  v_path := public.__p096s_path(v_org, v_exp, 'fake.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_solicitud', v_path, 'fake.pdf', 'text/plain', 100
    );
    PERFORM public.__p096s_assert(false, 'mime texto');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p096s_reset();

  -- Path con tipo incorrecto (cliente_pagare path para notif)
  v_path := public.__p096s_pagare_path(v_org, v_exp, 'wrong-folder.pdf');
  PERFORM public.__p096s_seed_storage(v_path);
  PERFORM public.__p096s_auth(v_mesa_admin);
  BEGIN
    PERFORM public.register_mesa_documento(
      v_exp, 'cliente_solicitud', v_path, 'wrong.pdf', 'application/pdf', 100
    );
    PERFORM public.__p096s_assert(false, 'path tipo mismatch');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p096s_assert(
      v_err ILIKE '%storage_path%',
      'msg path: ' || v_err
    );
  END;
  PERFORM public.__p096s_reset();

  -- ===== Lectura asesor propietario =====
  PERFORM public.__p096s_auth(v_asesor);
  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_active = 1, 'asesor ve vigente');
  SELECT COUNT(*) INTO v_ver
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NOT NULL;
  PERFORM public.__p096s_assert(v_ver = 0, 'asesor no ve soft-deleted vía RLS');
  PERFORM public.__p096s_reset();

  PERFORM public.__p096s_auth(v_asesor2);
  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_solicitud' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_active = 0, 'asesor ajeno no ve');
  PERFORM public.__p096s_reset();

  -- action_log
  SELECT COUNT(*) INTO v_log
  FROM public.action_log
  WHERE action = 'expediente.documento.mesa_register'
    AND (payload->>'tipo_documento') = 'cliente_solicitud'
    AND (payload->>'expediente_id')::UUID = v_exp;
  PERFORM public.__p096s_assert(v_log >= 3, 'action_log solicitud doc');

  -- Integridad: SAT junto a notif
  v_path_sat := v_org::TEXT || '/' || v_exp::TEXT || '/cliente_constancia_sat/sat.pdf';
  PERFORM public.__p096s_seed_storage(v_path_sat);
  PERFORM public.__p096s_auth(v_mesa_admin);
  PERFORM public.register_mesa_documento(
    v_exp, 'cliente_constancia_sat', v_path_sat, 'sat.pdf', 'application/pdf', 100
  );
  PERFORM public.__p096s_reset();
  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'cliente_constancia_sat' AND deleted_at IS NULL;
  PERFORM public.__p096s_assert(v_active = 1, 'sat intacto junto a solicitud');

  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p096s_assert(v_etapa = 7, 'etapa aún 7');

  -- Agenda kind=notificacion: enum/RPC existen; no mutamos bookings en esta suite
  PERFORM public.__p096s_assert(
    EXISTS (
      SELECT 1 FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'booking_kind' AND e.enumlabel = 'notificacion'
    ),
    'enum booking_kind.notificacion intacto'
  );

  RAISE NOTICE 'P096 SOLICITUD DOC OK';
END;
$$;

DROP FUNCTION public.__p096s_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p096s_auth(UUID);
DROP FUNCTION public.__p096s_reset();
DROP FUNCTION public.__p096s_path(UUID, UUID, TEXT);
DROP FUNCTION public.__p096s_pagare_path(UUID, UUID, TEXT);
DROP FUNCTION public.__p096s_notif_path(UUID, UUID, TEXT);
DROP FUNCTION public.__p096s_seed_storage(TEXT);
