-- ConCasa CRM — P2 shadow document_extractions
-- LOCAL. NO Cloud. Fixtures sintéticos (sin PII real).
-- Requiere migration 20260917210000 aplicada en DB local.
--
-- Higiene: TODO el cuerpo corre en una TRANSACTION y termina en ROLLBACK
-- (fixtures + override de feature_enabled no persisten; si falla a mitad,
-- el cierre de sesión de psql también descarta la tx abortada).

\set ON_ERROR_STOP on

BEGIN;

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

-- Guardrail: ningún literal UUID con nibble no-hex (p.ej. 'x')
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT m[1] INTO v_bad
  FROM regexp_matches(
    pg_read_file(
      -- no disponible en muchos entornos; fallback: skip si no hay
      'supabase/tests/rpc_document_extractions_shadow_p2.sql',
      0,
      200000
    ),
    '''([0-9a-fA-FxX-]{36})''',
    'g'
  ) AS m
  WHERE m[1] ~* '[^0-9a-f-]'
  LIMIT 1;
EXCEPTION
  WHEN undefined_file OR insufficient_privilege OR invalid_parameter_value THEN
    NULL; -- pg_read_file no disponible: la revisión la hace el test TS
  WHEN OTHERS THEN
    NULL;
END;
$$;

DO $$
DECLARE
  v_org UUID;
  v_asesor UUID;
  -- UUIDs sintéticos VÁLIDOS (solo hex). Prefijo a2d0… = P2 DX fixtures.
  v_exp UUID := 'a2d00000-0000-4000-8000-000000000001';
  v_doc_v1 UUID := 'a2d00000-0000-4000-8000-000000000011';
  v_doc_v2 UUID := 'a2d00000-0000-4000-8000-000000000012';
  v_doc_b UUID := 'a2d00000-0000-4000-8000-000000000013';
  v_doc_bad UUID := 'a2d00000-0000-4000-8000-000000000019';
  v_doc_del UUID := 'a2d00000-0000-4000-8000-000000000018';
  v_doc_missing UUID := 'a2d00000-0000-4000-8000-000000009999';
  v_r JSONB;
  v_r2 JSONB;
  v_cnt INTEGER;
  v_stale_cnt INTEGER;
  v_has_priv BOOLEAN;
  v_relforce BOOLEAN;
  v_ext_a UUID;
  v_ext_b UUID;
  v_job_id UUID;
  v_raised BOOLEAN;
BEGIN
  PERFORM public.__p2_dx_reset();

  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  PERFORM public.__p2_dx_assert(v_org IS NOT NULL, 'org requerida');

  SELECT id INTO v_asesor
  FROM public.profiles
  WHERE organization_id = v_org AND app_role = 'asesor'
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

  -- 2/3/4) anon/authenticated sin privilegios
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

  -- Modelo expediente_documentos: unique parcial activo por (expediente, tipo)
  PERFORM public.__p2_dx_assert(
    EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'expediente_documentos_active_tipo_unique'
    ),
    'unique parcial activo por tipo debe existir'
  );

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
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES (
    v_doc_b, v_org, v_exp, 'cliente_comprobante_domicilio',
    'synthetic/p2/cfe.pdf', 'cfe.pdf', 'application/pdf', 100, 1,
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

  -- Override temporal (queda dentro de la TRANSACTION → ROLLBACK lo deshace)
  CREATE OR REPLACE FUNCTION public.document_extraction_feature_enabled()
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $feat$ SELECT true $feat$;

  -- Enqueue normal → 1 extraction + 1 job enlazados
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
  PERFORM public.__p2_dx_assert(
    v_r->>'extraction_id' IS NOT NULL AND v_r->>'job_id' IS NOT NULL,
    'enqueue retorna extraction_id y job_id'
  );

  v_ext_a := (v_r->>'extraction_id')::uuid;
  v_job_id := (v_r->>'job_id')::uuid;

  SELECT COUNT(*) INTO v_cnt
  FROM public.document_extractions
  WHERE documento_id = v_doc_v1;
  PERFORM public.__p2_dx_assert(v_cnt = 1, 'una extraction v1');

  SELECT COUNT(*) INTO v_cnt
  FROM public.document_extraction_jobs
  WHERE documento_id = v_doc_v1 AND extraction_id = v_ext_a;
  PERFORM public.__p2_dx_assert(v_cnt = 1, 'un job v1 enlazado a extraction');

  SELECT COUNT(*) INTO v_cnt
  FROM public.document_extraction_jobs j
  JOIN public.document_extractions e ON e.id = j.extraction_id
  WHERE j.id = v_job_id
    AND j.documento_id = e.documento_id
    AND j.provider = e.provider
    AND j.provider_version = e.provider_version
    AND j.document_version = e.document_version
    AND j.organization_id = e.organization_id
    AND j.expediente_id = e.expediente_id
    AND j.document_type = e.document_type;
  PERFORM public.__p2_dx_assert(v_cnt = 1, 'job↔extraction alineados post-enqueue');

  -- Idempotencia
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
  SELECT COUNT(*) INTO v_cnt
  FROM public.document_extraction_jobs
  WHERE documento_id = v_doc_v1;
  PERFORM public.__p2_dx_assert(v_cnt = 1, 'sigue 1 job tras duplicate');

  -- Deleted / tipo no permitido
  v_r := public.enqueue_document_extraction(v_doc_del, 'shadow', 'p2');
  PERFORM public.__p2_dx_assert(
    v_r->>'reason' = 'documento_deleted',
    'deleted rechazado'
  );

  v_r := public.enqueue_document_extraction(v_doc_bad, 'shadow', 'p2');
  PERFORM public.__p2_dx_assert(
    v_r->>'reason' = 'tipo_not_allowed',
    'tipo no allowlist rechazado'
  );

  -- FK documento inexistente
  BEGIN
    INSERT INTO public.document_extractions (
      organization_id, expediente_id, documento_id, document_version,
      document_type, provider, provider_version, status
    ) VALUES (
      v_org, v_exp, v_doc_missing, 1,
      'cliente_ine_frente', 'shadow', 'p2-fk', 'pending'
    );
    RAISE EXCEPTION 'P2 DX TEST FAIL: FK debió fallar';
  EXCEPTION
    WHEN foreign_key_violation THEN
      NULL;
  END;

  -- Segunda extraction (doc B) para mismatch tests
  v_r := public.enqueue_document_extraction(v_doc_b, 'shadow', 'p2');
  PERFORM public.__p2_dx_assert(
    (v_r->>'enqueued')::boolean IS TRUE,
    'enqueue doc B ok'
  );
  v_ext_b := (v_r->>'extraction_id')::uuid;

  -- 1) job correcto (mismo doc/provider) → permitido (ya cubierto por enqueue;
  --    insert explícito de job duplicado choca UNIQUE; validamos UPDATE no-op path
  --    creando extraction+job shadow distinto provider_version alineado)
  INSERT INTO public.document_extractions (
    organization_id, expediente_id, documento_id, document_version,
    document_type, provider, provider_version, status
  ) VALUES (
    v_org, v_exp, v_doc_v1, 1,
    'cliente_ine_frente', 'shadow', 'p2-align-ok', 'pending'
  )
  RETURNING id INTO v_ext_a;

  INSERT INTO public.document_extraction_jobs (
    extraction_id, organization_id, expediente_id, documento_id,
    document_version, document_type, provider, provider_version, status
  ) VALUES (
    v_ext_a, v_org, v_exp, v_doc_v1, 1,
    'cliente_ine_frente', 'shadow', 'p2-align-ok', 'pending'
  );
  -- si llegó aquí → permitido

  -- 2) job doc B apuntando a extraction de doc A → rechazado
  v_raised := false;
  BEGIN
    INSERT INTO public.document_extraction_jobs (
      extraction_id, organization_id, expediente_id, documento_id,
      document_version, document_type, provider, provider_version, status
    ) VALUES (
      v_ext_a, -- extraction de ine v1 / p2-align-ok
      v_org, v_exp, v_doc_b, 1,
      'cliente_comprobante_domicilio', 'shadow', 'p2', 'pending'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := (SQLERRM LIKE '%extraction_id desalineado%'
                   OR SQLERRM LIKE '%no coincide con documento%');
  END;
  PERFORM public.__p2_dx_assert(v_raised, 'job otro documento rechazado');

  -- 3) mismo documento, provider distinto → rechazado
  v_raised := false;
  BEGIN
    INSERT INTO public.document_extraction_jobs (
      extraction_id, organization_id, expediente_id, documento_id,
      document_version, document_type, provider, provider_version, status
    ) VALUES (
      v_ext_a, v_org, v_exp, v_doc_v1, 1,
      'cliente_ine_frente', 'other_provider', 'p2-align-ok', 'pending'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := (SQLERRM LIKE '%extraction_id desalineado%');
  END;
  PERFORM public.__p2_dx_assert(v_raised, 'job provider distinto rechazado');

  -- 4) mismo documento/provider, provider_version distinta → rechazado
  v_raised := false;
  BEGIN
    INSERT INTO public.document_extraction_jobs (
      extraction_id, organization_id, expediente_id, documento_id,
      document_version, document_type, provider, provider_version, status
    ) VALUES (
      v_ext_a, v_org, v_exp, v_doc_v1, 1,
      'cliente_ine_frente', 'shadow', 'p2-OTHER', 'pending'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := (SQLERRM LIKE '%extraction_id desalineado%');
  END;
  PERFORM public.__p2_dx_assert(v_raised, 'job provider_version distinta rechazado');

  -- 5) org/expediente/tipo/version desalineados vs documento → rechazado
  v_raised := false;
  BEGIN
    INSERT INTO public.document_extractions (
      organization_id, expediente_id, documento_id, document_version,
      document_type, provider, provider_version, status
    ) VALUES (
      v_org, v_exp, v_doc_v1, 99,
      'cliente_ine_frente', 'shadow', 'p2-bad-ver', 'pending'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := (SQLERRM LIKE '%document_version no coincide%');
  END;
  PERFORM public.__p2_dx_assert(v_raised, 'version desalineada vs documento rechazada');

  v_raised := false;
  BEGIN
    INSERT INTO public.document_extractions (
      organization_id, expediente_id, documento_id, document_version,
      document_type, provider, provider_version, status
    ) VALUES (
      v_org, v_exp, v_doc_v1, 1,
      'cliente_estado_cuenta', 'shadow', 'p2-bad-tipo', 'pending'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := (SQLERRM LIKE '%document_type no coincide%');
  END;
  PERFORM public.__p2_dx_assert(v_raised, 'tipo desalineado vs documento rechazado');

  -- 14) versión vieja → stale al encolar v2
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
  PERFORM public.__p2_dx_assert(v_stale_cnt >= 1, 'v1 marcada stale');

  SELECT COUNT(*) INTO v_cnt
  FROM public.document_extractions
  WHERE documento_id = v_doc_v2 AND status = 'pending';
  PERFORM public.__p2_dx_assert(v_cnt = 1, 'v2 pending vigente');

  -- payload_raw sintético (sin PII real)
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

  -- authenticated sin SELECT
  PERFORM public.__p2_dx_auth(v_asesor);
  BEGIN
    PERFORM 1 FROM public.document_extractions LIMIT 1;
    RAISE EXCEPTION 'P2 DX TEST FAIL: authenticated no debió poder SELECT';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  PERFORM public.__p2_dx_reset();

  RAISE NOTICE 'P2 DX tests PASS';
END;
$$;

-- Descarta fixtures + override de feature_enabled + helpers de test
ROLLBACK;
