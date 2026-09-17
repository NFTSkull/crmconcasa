-- ConCasa CRM — P2 shadow document_extractions
-- LOCAL. NO Cloud. Fixtures sintéticos (sin PII real).
-- Requiere migration 20260917210000 aplicada en DB local.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p2_dx_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P2 DX TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2_dx_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p2_dx_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

DO $$
DECLARE
  v_org UUID;
  v_asesor UUID;
  v_exp UUID := 'a2dx0000-0000-4000-8000-000000000001';
  v_doc_v1 UUID := 'a2dx0000-0000-4000-8000-000000000011';
  v_doc_v2 UUID := 'a2dx0000-0000-4000-8000-000000000012';
  v_doc_bad UUID := 'a2dx0000-0000-4000-8000-000000000019';
  v_doc_del UUID := 'a2dx0000-0000-4000-8000-000000000018';
  v_r JSONB;
  v_r2 JSONB;
  v_cnt INTEGER;
  v_stale_cnt INTEGER;
  v_has_priv BOOLEAN;
  v_relforce BOOLEAN;
BEGIN
  PERFORM public.__p2_dx_reset();

  -- Cleanup previo
  DELETE FROM public.document_extraction_jobs
  WHERE expediente_id = v_exp;
  DELETE FROM public.document_extractions
  WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_documentos
  WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  PERFORM public.__p2_dx_assert(v_org IS NOT NULL, 'org requerida');

  SELECT id INTO v_asesor
  FROM public.profiles
  WHERE organization_id = v_org AND role = 'asesor'
  LIMIT 1;
  PERFORM public.__p2_dx_assert(v_asesor IS NOT NULL, 'asesor requerido');

  -- 15) feature flag DEFAULT OFF
  PERFORM public.__p2_dx_assert(
    public.document_extraction_feature_enabled() IS FALSE,
    'feature debe estar OFF sin Vault secret'
  );

  -- 1) allowlist
  PERFORM public.__p2_dx_assert(
    cardinality(public.document_extraction_tipos_permitidos()) = 4,
    'allowlist debe tener 4 tipos'
  );
  PERFORM public.__p2_dx_assert(
    'cliente_ine_frente' = ANY (public.document_extraction_tipos_permitidos()),
    'ine frente en allowlist'
  );
  PERFORM public.__p2_dx_assert(
    NOT ('cliente_acta_nacimiento' = ANY (public.document_extraction_tipos_permitidos())),
    'acta no en allowlist'
  );

  -- 5) FORCE RLS
  SELECT c.relforcerowsecurity INTO v_relforce
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'document_extractions';
  PERFORM public.__p2_dx_assert(v_relforce IS TRUE, 'FORCE RLS document_extractions');

  SELECT c.relforcerowsecurity INTO v_relforce
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'document_extraction_jobs';
  PERFORM public.__p2_dx_assert(v_relforce IS TRUE, 'FORCE RLS document_extraction_jobs');

  -- 2/3/4) anon/authenticated sin privilegios de tabla (incl. payload_raw)
  SELECT has_table_privilege('anon', 'public.document_extractions', 'SELECT')
    INTO v_has_priv;
  PERFORM public.__p2_dx_assert(v_has_priv IS FALSE, 'anon sin SELECT extractions');

  SELECT has_table_privilege('authenticated', 'public.document_extractions', 'SELECT')
    INTO v_has_priv;
  PERFORM public.__p2_dx_assert(v_has_priv IS FALSE, 'authenticated sin SELECT extractions');

  SELECT has_table_privilege('authenticated', 'public.document_extractions', 'INSERT')
    INTO v_has_priv;
  PERFORM public.__p2_dx_assert(v_has_priv IS FALSE, 'authenticated sin INSERT extractions');

  SELECT has_table_privilege('authenticated', 'public.document_extractions', 'UPDATE')
    INTO v_has_priv;
  PERFORM public.__p2_dx_assert(v_has_priv IS FALSE, 'authenticated sin UPDATE extractions');

  SELECT has_table_privilege('authenticated', 'public.document_extractions', 'DELETE')
    INTO v_has_priv;
  PERFORM public.__p2_dx_assert(v_has_priv IS FALSE, 'authenticated sin DELETE extractions');

  SELECT has_table_privilege('authenticated', 'public.document_extraction_jobs', 'SELECT')
    INTO v_has_priv;
  PERFORM public.__p2_dx_assert(v_has_priv IS FALSE, 'authenticated sin SELECT jobs');

  -- 16) enqueue NO granted a authenticated
  SELECT has_function_privilege(
    'authenticated',
    'public.enqueue_document_extraction(uuid,text,text)',
    'EXECUTE'
  ) INTO v_has_priv;
  PERFORM public.__p2_dx_assert(v_has_priv IS FALSE, 'authenticated sin enqueue');

  SELECT has_function_privilege(
    'anon',
    'public.enqueue_document_extraction(uuid,text,text)',
    'EXECUTE'
  ) INTO v_has_priv;
  PERFORM public.__p2_dx_assert(v_has_priv IS FALSE, 'anon sin enqueue');

  -- Seed expediente + docs
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '22990011001',
    'Fixture P2 DX', '5500000001', 'interno', false,
    1, 'pendiente', 'activo'
  );

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES (
    v_doc_v1, v_org, v_exp, 'cliente_ine_frente',
    'synthetic/p2/ine_v1.pdf', 'ine_v1.pdf', 'application/pdf', 100, 1,
    v_asesor, 'asesor'
  );

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role,
    deleted_at
  ) VALUES (
    v_doc_del, v_org, v_exp, 'cliente_estado_cuenta',
    'synthetic/p2/estado_del.pdf', 'estado_del.pdf', 'application/pdf', 100, 1,
    v_asesor, 'asesor', NOW()
  );

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES (
    v_doc_bad, v_org, v_exp, 'cliente_acta_nacimiento',
    'synthetic/p2/acta.pdf', 'acta.pdf', 'application/pdf', 100, 1,
    v_asesor, 'asesor'
  );

  -- Con feature OFF: enqueue no inserta
  v_r := public.enqueue_document_extraction(v_doc_v1, 'shadow', 'p2');
  PERFORM public.__p2_dx_assert(
    (v_r->>'enqueued')::boolean IS FALSE
    AND v_r->>'reason' = 'feature_off',
    'enqueue con flag OFF'
  );

  -- Simular flag ON vía override temporal de la función (solo test local)
  CREATE OR REPLACE FUNCTION public.document_extraction_feature_enabled()
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$ SELECT true $$;

  -- 9/10/8) enqueue resuelve server-side + preserva version
  v_r := public.enqueue_document_extraction(v_doc_v1, 'shadow', 'p2');
  PERFORM public.__p2_dx_assert(
    (v_r->>'enqueued')::boolean IS TRUE,
    'enqueue v1 ok'
  );
  PERFORM public.__p2_dx_assert(
    (v_r->>'document_version')::int = 1,
    'document_version=1'
  );
  PERFORM public.__p2_dx_assert(
    v_r->>'document_type' = 'cliente_ine_frente',
    'document_type server-side'
  );

  SELECT COUNT(*) INTO v_cnt
  FROM public.document_extractions
  WHERE documento_id = v_doc_v1;
  PERFORM public.__p2_dx_assert(v_cnt = 1, 'una extraction v1');

  -- 7/13) idempotencia
  v_r2 := public.enqueue_document_extraction(v_doc_v1, 'shadow', 'p2');
  PERFORM public.__p2_dx_assert(
    (v_r2->>'enqueued')::boolean IS FALSE
    AND v_r2->>'reason' = 'already_enqueued',
    'duplicate enqueue no duplica'
  );
  SELECT COUNT(*) INTO v_cnt
  FROM public.document_extractions
  WHERE documento_id = v_doc_v1;
  PERFORM public.__p2_dx_assert(v_cnt = 1, 'sigue 1 extraction tras duplicate');

  -- 11) deleted no encolable
  v_r := public.enqueue_document_extraction(v_doc_del, 'shadow', 'p2');
  PERFORM public.__p2_dx_assert(
    v_r->>'reason' = 'documento_deleted',
    'deleted rechazado'
  );

  -- 12) tipo no permitido
  v_r := public.enqueue_document_extraction(v_doc_bad, 'shadow', 'p2');
  PERFORM public.__p2_dx_assert(
    v_r->>'reason' = 'tipo_not_allowed',
    'tipo no allowlist rechazado'
  );

  -- 6) FK: insert directo con documento inexistente falla
  BEGIN
    INSERT INTO public.document_extractions (
      organization_id, expediente_id, documento_id, document_version,
      document_type, provider, provider_version, status
    ) VALUES (
      v_org, v_exp, 'a2dx0000-0000-4000-8000-000000009999', 1,
      'cliente_ine_frente', 'shadow', 'p2-fk', 'pending'
    );
    RAISE EXCEPTION 'P2 DX TEST FAIL: FK debió fallar';
  EXCEPTION
    WHEN foreign_key_violation THEN
      NULL;
  END;

  -- 14) versión vieja → stale al encolar v2
  -- soft-delete v1, insert v2
  UPDATE public.expediente_documentos
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE id = v_doc_v1;

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES (
    v_doc_v2, v_org, v_exp, 'cliente_ine_frente',
    'synthetic/p2/ine_v2.pdf', 'ine_v2.pdf', 'application/pdf', 100, 2,
    v_asesor, 'asesor'
  );

  v_r := public.enqueue_document_extraction(v_doc_v2, 'shadow', 'p2');
  PERFORM public.__p2_dx_assert(
    (v_r->>'enqueued')::boolean IS TRUE
    AND (v_r->>'document_version')::int = 2,
    'enqueue v2 ok'
  );

  SELECT COUNT(*) INTO v_stale_cnt
  FROM public.document_extractions
  WHERE documento_id = v_doc_v1 AND status = 'stale';
  PERFORM public.__p2_dx_assert(v_stale_cnt = 1, 'v1 marcada stale');

  SELECT COUNT(*) INTO v_cnt
  FROM public.document_extractions
  WHERE documento_id = v_doc_v2 AND status = 'pending';
  PERFORM public.__p2_dx_assert(v_cnt = 1, 'v2 pending vigente');

  -- payload_raw sintético solo vía service/postgres (no PII real)
  UPDATE public.document_extractions
  SET
    payload_raw = '{"fixture":"SYNTHETIC_ONLY"}'::jsonb,
    payload_normalized = jsonb_build_object(
      'fields', jsonb_build_object(
        'titular.nombres', jsonb_build_object(
          'value', 'NOMBRE_SINTETICO',
          'confidence', 0.99,
          'sourceDocumentType', 'cliente_ine_frente',
          'sourceDocumentId', v_doc_v2::text,
          'documentVersion', 2
        )
      )
    ),
    status = 'done',
    processed_at = NOW(),
    updated_at = NOW()
  WHERE documento_id = v_doc_v2;

  -- authenticated: sin privilegio SELECT (no puede leer payload_raw)
  PERFORM public.__p2_dx_auth(v_asesor);
  BEGIN
    PERFORM 1 FROM public.document_extractions LIMIT 1;
    RAISE EXCEPTION 'P2 DX TEST FAIL: authenticated no debió poder SELECT';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  PERFORM public.__p2_dx_reset();

  -- Cleanup
  DELETE FROM public.document_extraction_jobs WHERE expediente_id = v_exp;
  DELETE FROM public.document_extractions WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  -- Restaurar feature fail-closed (reaplicar definición de migration)
  -- El test deja la función en true; re-ejecutar fragmento mínimo OFF.
  CREATE OR REPLACE FUNCTION public.document_extraction_feature_enabled()
  RETURNS BOOLEAN
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, vault
  AS $fn$
  DECLARE
    v_en TEXT;
    v_at TEXT;
    v_ts TIMESTAMPTZ;
  BEGIN
    v_en := lower(COALESCE(public.document_extraction_vault_trimmed(
      'document_extraction_enqueue_enabled'
    ), ''));
    IF v_en IS DISTINCT FROM 'true' THEN
      RETURN false;
    END IF;
    v_at := public.document_extraction_vault_trimmed(
      'document_extraction_activation_at'
    );
    IF v_at IS NULL OR btrim(v_at) = '' THEN
      RETURN true;
    END IF;
    BEGIN
      v_ts := v_at::TIMESTAMPTZ;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN false;
    END;
    IF NOW() < v_ts THEN
      RETURN false;
    END IF;
    RETURN true;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN false;
  END;
  $fn$;

  REVOKE ALL ON FUNCTION public.document_extraction_feature_enabled()
    FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.document_extraction_feature_enabled()
    TO authenticated, service_role;

  PERFORM public.__p2_dx_assert(
    public.document_extraction_feature_enabled() IS FALSE,
    'feature restaurada OFF'
  );

  RAISE NOTICE 'P2 DX tests PASS';
END;
$$;
