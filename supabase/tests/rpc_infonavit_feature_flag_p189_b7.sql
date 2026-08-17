-- ConCasa CRM — P189 B7: feature flag DEFAULT OFF + elegibilidad created_at
-- LOCAL. NO Cloud. NO vault.create_secret en 184.

\set ON_ERROR_STOP on
\i supabase/tests/_p189_infonavit_datos_fixture.sql

CREATE OR REPLACE FUNCTION public.__p189_b7_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P189 B7 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_purge()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('infonavit.snapshot_mutable', '1', true);
  DELETE FROM public.infonavit_pdf_outbox
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1897%'
  );
  DELETE FROM public.expediente_infonavit_submission_snapshots
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1897%'
  );
  PERFORM set_config('infonavit.snapshot_mutable', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_seed_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss TEXT,
  p_submitted BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado, direccion_opcional
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss,
    'Fixture P189 B7', '5511111111', 'interno',
    p_submitted,
    CASE WHEN p_submitted THEN NOW() - INTERVAL '2 days' ELSE NULL END,
    1, 'pendiente', 'activo',
    'Av Siempre Viva 123, Centro, Monterrey, CP 64000'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    etapa_actual = 1,
    subestado = 'pendiente',
    ciclo_estado = 'activo',
    reingreso_manual_count = 0,
    reingreso_manual_at = NULL,
    reingreso_manual_by = NULL,
    direccion_opcional = EXCLUDED.direccion_opcional,
    deleted_at = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_seed_ready(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss TEXT,
  p_datos JSONB DEFAULT NULL,
  p_submitted BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_tipo TEXT;
  v_datos JSONB;
BEGIN
  PERFORM public.__p189_b7_seed_exp(p_id, p_org, p_asesor, p_nss, p_submitted);

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (p_id, p_org, 'aprobado', 150000)
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = 'aprobado', monto_aprobado = 150000;

  v_datos := COALESCE(p_datos, public.__p189_infonavit_datos_completo(p_nss));

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    p_id, p_org, v_datos, 'completo', 10, 11000, 'transferencia'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos,
    estado = 'completo',
    porcentaje_cobro = 10,
    monto_calculado = 11000,
    metodo_pago = 'transferencia';

  DELETE FROM public.expediente_documentos WHERE expediente_id = p_id;
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org, p_id, v_tipo,
      'dev/p189-b7/' || p_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor, 'asesor'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_legacy_datos(p_nss TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'nss', public.normalize_nss_mexico(p_nss),
    'curp', 'GAVF850101HDFRRL09',
    'celular', '5511111111',
    'correo', 'x@y.z',
    'empresa', 'E',
    'registroPatronal', 'Y1',
    'telefonoEmpresa', '8187654321',
    'nombreCliente', 'Legacy Cliente',
    'montoMejoravit', '80000',
    'plazo', '5'
  );
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_enviar(p_user UUID, p_exp UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  PERFORM public.__p189_b7_auth(p_user);
  SELECT public.enviar_a_mesa(p_exp) INTO v;
  PERFORM public.__p189_b7_reset();
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_reingreso(p_user UUID, p_exp UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  PERFORM public.__p189_b7_auth(p_user);
  SELECT public.asesor_enviar_reingreso_a_mesa(p_exp) INTO v;
  PERFORM public.__p189_b7_reset();
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_enviar_err(p_user UUID, p_exp UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__p189_b7_auth(p_user);
  BEGIN
    PERFORM public.enviar_a_mesa(p_exp);
    PERFORM public.__p189_b7_reset();
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p189_b7_reset();
    RETURN v_err;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_reingreso_err(p_user UUID, p_exp UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__p189_b7_auth(p_user);
  BEGIN
    PERFORM public.asesor_enviar_reingreso_a_mesa(p_exp);
    PERFORM public.__p189_b7_reset();
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p189_b7_reset();
    RETURN v_err;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b7_p189_counts(p_exp UUID, OUT snaps INTEGER, OUT outs INTEGER)
LANGUAGE sql AS $$
  SELECT
    (SELECT count(*)::int FROM public.expediente_infonavit_submission_snapshots s
      WHERE s.expediente_id = p_exp),
    (SELECT count(*)::int FROM public.infonavit_pdf_outbox o
      WHERE o.expediente_id = p_exp);
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9197-000000000100';
  v_asesor UUID := '00000000-0000-4000-9197-000000000111';
  v_ajeno UUID := '00000000-0000-4000-9197-000000000112';
  v_mesa UUID := '00000000-0000-4000-9197-000000000113';
  v_org2 UUID := '00000000-0000-4000-9197-000000000200';
  v_org2_asesor UUID := '00000000-0000-4000-9197-000000000211';
  v_exp UUID;
  v_res JSONB;
  v_err TEXT;
  v_snaps INTEGER;
  v_outs INTEGER;
  v_count INTEGER;
  v_src TEXT;
  v_status JSONB;
  v_elig JSONB;
  v_submitted BOOLEAN;
  v_etapa SMALLINT;
  v_exec BOOLEAN;
BEGIN
  PERFORM public.__p189_b7_purge();
  PERFORM public.__p189_clear_feature_vault();
  PERFORM set_config('role', 'postgres', true);

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p189-b7-org', 'P189 B7 Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org2, 'p189-b7-org2', 'P189 B7 Org2', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p189-b7-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_ajeno, 'authenticated', 'authenticated', 'p189-b7-ajeno@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p189-b7-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_org2_asesor, 'authenticated', 'authenticated', 'p189-b7-org2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_asesor, v_org, 'p189-b7-asesor@test.local', 'Asesor B7', 'asesor', 'interno', true),
    (v_ajeno, v_org, 'p189-b7-ajeno@test.local', 'Ajeno B7', 'asesor', 'interno', true),
    (v_mesa, v_org, 'p189-b7-mesa@test.local', 'Mesa B7', 'mesa_admin', NULL, true),
    (v_org2_asesor, v_org2, 'p189-b7-org2@test.local', 'Org2 B7', 'asesor', 'interno', true)
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    active = true,
    app_role = EXCLUDED.app_role;

  SELECT pg_get_functiondef('public.enviar_a_mesa(uuid)'::regprocedure) INTO v_src;
  PERFORM public.__p189_b7_assert(
    position('vault.create_secret' IN lower(v_src)) = 0,
    '184 enviar no crea secrets'
  );
  SELECT pg_get_functiondef('public.p189_infonavit_feature_enabled()'::regprocedure) INTO v_src;
  PERFORM public.__p189_b7_assert(
    position('vault.create_secret' IN lower(v_src)) = 0,
    'flag helper no crea secrets'
  );

  -- A. flag missing + incompleto → envío histórico, 0 P189
  v_exp := '00000000-0000-4000-9197-000000000001';
  PERFORM public.__p189_clear_feature_vault();
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000001',
    public.__p189_b7_legacy_datos('18970000001')
  );
  PERFORM public.__p189_b7_assert(
    public.p189_infonavit_feature_enabled() = false, 'A: feature OFF missing'
  );
  v_res := public.__p189_b7_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'ok')::boolean, 'A: enviar OK');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'A: 0 snapshot/outbox');

  -- B. flag=false
  v_exp := '00000000-0000-4000-9197-000000000002';
  PERFORM public.__p189_set_feature_vault('false', (NOW() - INTERVAL '1 day')::TEXT);
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000002',
    public.__p189_b7_legacy_datos('18970000002')
  );
  PERFORM public.__p189_b7_assert(
    public.p189_infonavit_feature_enabled() = false, 'B: false → OFF'
  );
  v_res := public.__p189_b7_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'ok')::boolean, 'B: enviar OK');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'B: 0 P189');

  -- C. enabled=true + activation missing
  v_exp := '00000000-0000-4000-9197-000000000003';
  PERFORM public.__p189_set_feature_vault('true', NULL);
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000003',
    public.__p189_b7_legacy_datos('18970000003')
  );
  PERFORM public.__p189_b7_assert(
    public.p189_infonavit_feature_enabled() = false, 'C: no activation → OFF'
  );
  v_res := public.__p189_b7_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'ok')::boolean, 'C: enviar OK');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'C: 0 P189');

  -- D. enabled=true + malformed activation
  v_exp := '00000000-0000-4000-9197-000000000004';
  PERFORM public.__p189_set_feature_vault('true', 'not-a-timestamp');
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000004',
    public.__p189_b7_legacy_datos('18970000004')
  );
  PERFORM public.__p189_b7_assert(
    public.p189_infonavit_feature_enabled() = false, 'D: malformed → OFF'
  );
  v_res := public.__p189_b7_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'ok')::boolean, 'D: enviar OK');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'D: 0 P189');

  -- E. enabled=true + activation future
  v_exp := '00000000-0000-4000-9197-000000000005';
  PERFORM public.__p189_set_feature_vault('true', (NOW() + INTERVAL '7 days')::TEXT);
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000005',
    public.__p189_b7_legacy_datos('18970000005')
  );
  PERFORM public.__p189_b7_assert(
    public.p189_infonavit_feature_enabled() = false, 'E: future → OFF'
  );
  v_res := public.__p189_b7_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'ok')::boolean, 'E: enviar OK');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'E: 0 P189');

  -- F. active + legacy incompleto
  PERFORM public.__p189_enable_feature_active();
  v_exp := '00000000-0000-4000-9197-000000000006';
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000006',
    public.__p189_b7_legacy_datos('18970000006')
  );
  UPDATE public.expedientes
  SET created_at = NOW() - INTERVAL '30 days'
  WHERE id = v_exp;
  v_elig := public.p189_infonavit_get_eligibility(v_exp);
  PERFORM public.__p189_b7_assert((v_elig->>'feature_active')::boolean, 'F: feature ON');
  PERFORM public.__p189_b7_assert((v_elig->>'legacy')::boolean, 'F: legacy');
  PERFORM public.__p189_b7_assert(NOT (v_elig->>'required')::boolean, 'F: not required');
  PERFORM public.__p189_b7_assert(NOT (v_elig->>'should_enqueue')::boolean, 'F: no enqueue');
  v_res := public.__p189_b7_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'ok')::boolean, 'F: enviar OK');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'F: 0 P189');

  -- G. active + legacy completo → enqueue
  v_exp := '00000000-0000-4000-9197-000000000007';
  PERFORM public.__p189_b7_seed_ready(v_exp, v_org, v_asesor, '18970000007');
  UPDATE public.expedientes SET created_at = NOW() - INTERVAL '30 days' WHERE id = v_exp;
  v_elig := public.p189_infonavit_get_eligibility(v_exp);
  PERFORM public.__p189_b7_assert((v_elig->>'legacy')::boolean, 'G: legacy');
  PERFORM public.__p189_b7_assert(NOT (v_elig->>'required')::boolean, 'G: not required');
  PERFORM public.__p189_b7_assert((v_elig->>'should_enqueue')::boolean, 'G: enqueue');
  v_res := public.__p189_b7_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'ok')::boolean, 'G: enviar OK');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 1 AND v_outs = 3, 'G: 1+3');

  -- H. active + NUEVO incompleto → REJECT + rollback
  v_exp := '00000000-0000-4000-9197-000000000008';
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000008',
    public.__p189_b7_legacy_datos('18970000008')
  );
  v_elig := public.p189_infonavit_get_eligibility(v_exp);
  PERFORM public.__p189_b7_assert((v_elig->>'required')::boolean, 'H: required');
  v_err := public.__p189_b7_enviar_err(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert(v_err LIKE '%INFONAVIT_DATOS_INCOMPLETOS%', 'H: reject');
  SELECT e.submitted_to_mesa, e.etapa_actual INTO v_submitted, v_etapa
  FROM public.expedientes e WHERE e.id = v_exp;
  PERFORM public.__p189_b7_assert(v_submitted = false, 'H: no submitted');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'H: 0 P189');

  -- I. active + NUEVO completo
  v_exp := '00000000-0000-4000-9197-000000000009';
  PERFORM public.__p189_b7_seed_ready(v_exp, v_org, v_asesor, '18970000009');
  v_res := public.__p189_b7_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'ok')::boolean, 'I: enviar OK');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 1 AND v_outs = 3, 'I: 1+3');

  -- J. kill switch: flag OFF → nuevo incompleto envía
  PERFORM public.__p189_set_feature_vault('false', (NOW() - INTERVAL '1 day')::TEXT);
  v_exp := '00000000-0000-4000-9197-000000000010';
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000010',
    public.__p189_b7_legacy_datos('18970000010')
  );
  PERFORM public.__p189_b7_assert(
    NOT public.p189_infonavit_feature_enabled(), 'J: kill OFF'
  );
  v_res := public.__p189_b7_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'ok')::boolean, 'J: enviar OK');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'J: 0 P189');

  -- Reingreso A: flag OFF + legacy incompleto
  PERFORM public.__p189_clear_feature_vault();
  v_exp := '00000000-0000-4000-9197-000000000011';
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000011',
    public.__p189_b7_legacy_datos('18970000011'),
    true
  );
  v_res := public.__p189_b7_reingreso(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'changed')::boolean, 'RA: changed');
  PERFORM public.__p189_b7_assert((v_res->>'reingreso_manual_count')::int = 1, 'RA: counter');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'RA: 0 P189');

  -- Reingreso B: active + legacy incompleto
  PERFORM public.__p189_enable_feature_active();
  v_exp := '00000000-0000-4000-9197-000000000012';
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000012',
    public.__p189_b7_legacy_datos('18970000012'),
    true
  );
  UPDATE public.expedientes SET created_at = NOW() - INTERVAL '30 days' WHERE id = v_exp;
  v_res := public.__p189_b7_reingreso(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'changed')::boolean, 'RB: changed');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'RB: 0 P189');

  -- Reingreso C: active + legacy completo
  v_exp := '00000000-0000-4000-9197-000000000013';
  PERFORM public.__p189_b7_seed_ready(v_exp, v_org, v_asesor, '18970000013', NULL, true);
  UPDATE public.expedientes SET created_at = NOW() - INTERVAL '30 days' WHERE id = v_exp;
  v_res := public.__p189_b7_reingreso(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'changed')::boolean, 'RC: changed');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 1 AND v_outs = 3, 'RC: 1+3');

  -- Reingreso D: active + NUEVO incompleto → REJECT antes counter
  v_exp := '00000000-0000-4000-9197-000000000014';
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000014',
    public.__p189_b7_legacy_datos('18970000014'),
    true
  );
  SELECT e.reingreso_manual_count INTO v_count FROM public.expedientes e WHERE e.id = v_exp;
  v_err := public.__p189_b7_reingreso_err(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert(v_err LIKE '%INFONAVIT_DATOS_INCOMPLETOS%', 'RD: reject');
  PERFORM public.__p189_b7_assert(
    (SELECT e.reingreso_manual_count FROM public.expedientes e WHERE e.id = v_exp) = v_count,
    'RD: counter intacto'
  );
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'RD: 0 P189');

  -- Reingreso E: active + NUEVO completo
  v_exp := '00000000-0000-4000-9197-000000000015';
  PERFORM public.__p189_b7_seed_ready(v_exp, v_org, v_asesor, '18970000015', NULL, true);
  v_res := public.__p189_b7_reingreso(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'changed')::boolean, 'RE: changed');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 1 AND v_outs = 3, 'RE: 1+3');

  -- Reingreso F: idempotent changed=false → 0 nuevas
  v_res := public.__p189_b7_reingreso(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'changed')::boolean = false, 'RF: changed false');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 1 AND v_outs = 3, 'RF: same rows');

  -- Reingreso G: kill switch OFF nunca bloquea
  PERFORM public.__p189_clear_feature_vault();
  v_exp := '00000000-0000-4000-9197-000000000016';
  PERFORM public.__p189_b7_seed_ready(
    v_exp, v_org, v_asesor, '18970000016',
    public.__p189_b7_legacy_datos('18970000016'),
    true
  );
  v_res := public.__p189_b7_reingreso(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert((v_res->>'changed')::boolean, 'RG: changed');
  SELECT * INTO v_snaps, v_outs FROM public.__p189_b7_p189_counts(v_exp);
  PERFORM public.__p189_b7_assert(v_snaps = 0 AND v_outs = 0, 'RG: 0 P189');

  -- Gates históricos con flag ON: sin docs sigue fallando
  PERFORM public.__p189_enable_feature_active();
  v_exp := '00000000-0000-4000-9197-000000000017';
  PERFORM public.__p189_b7_seed_ready(v_exp, v_org, v_asesor, '18970000017');
  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp;
  v_err := public.__p189_b7_enviar_err(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert(v_err LIKE '%faltan documentos%', 'gate docs');
  PERFORM public.__p189_b7_assert(
    (SELECT e.submitted_to_mesa FROM public.expedientes e WHERE e.id = v_exp) = false,
    'gate docs no submitted'
  );

  -- NSS P049/P179: flag ON no salta blocker (mismo NSS, segundo envío)
  v_exp := '00000000-0000-4000-9197-000000000019';
  PERFORM public.__p189_b7_seed_ready(v_exp, v_org, v_asesor, '18970000009');
  UPDATE public.expedientes SET created_at = NOW() - INTERVAL '30 days' WHERE id = v_exp;
  v_err := public.__p189_b7_enviar_err(v_asesor, v_exp);
  PERFORM public.__p189_b7_assert(v_err LIKE '%NSS_YA_BLOQUEADO%', 'gate NSS');
  PERFORM public.__p189_b7_assert(
    (SELECT e.submitted_to_mesa FROM public.expedientes e WHERE e.id = v_exp) = false,
    'gate NSS no submitted'
  );

  -- Status RPC: owner OK, mesa (post-envío), ajeno 42501, anon no execute, no PII keys
  v_exp := '00000000-0000-4000-9197-000000000018';
  PERFORM public.__p189_b7_seed_ready(v_exp, v_org, v_asesor, '18970000018', NULL, true);
  PERFORM public.__p189_b7_auth(v_asesor);
  SELECT public.get_p189_infonavit_feature_status(v_exp) INTO v_status;
  PERFORM public.__p189_b7_reset();
  PERFORM public.__p189_b7_assert((v_status->>'aplica')::boolean, 'status aplica');
  PERFORM public.__p189_b7_assert((v_status->>'required')::boolean, 'status required nuevo');
  PERFORM public.__p189_b7_assert(v_status ? 'has_complete_v1', 'status keys');
  PERFORM public.__p189_b7_assert(NOT (v_status ? 'activation_at'), 'no activation_at');
  PERFORM public.__p189_b7_assert(NOT (v_status ? 'snapshot'), 'no snapshot');
  PERFORM public.__p189_b7_assert(
    position('p189_infonavit' IN v_status::text) = 0, 'no vault names'
  );

  PERFORM public.__p189_b7_auth(v_mesa);
  SELECT public.get_p189_infonavit_feature_status(v_exp) INTO v_status;
  PERFORM public.__p189_b7_reset();
  PERFORM public.__p189_b7_assert((v_status->>'aplica')::boolean, 'mesa can_see status');

  PERFORM public.__p189_b7_auth(v_ajeno);
  BEGIN
    PERFORM public.get_p189_infonavit_feature_status(v_exp);
    PERFORM public.__p189_b7_reset();
    PERFORM public.__p189_b7_assert(false, 'ajeno debió denegar');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM public.__p189_b7_reset();
  WHEN OTHERS THEN
    PERFORM public.__p189_b7_reset();
    PERFORM public.__p189_b7_assert(SQLSTATE = '42501', 'ajeno 42501');
  END;

  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT has_function_privilege('anon', 'public.get_p189_infonavit_feature_status(uuid)', 'EXECUTE')
    INTO v_exec;
  PERFORM public.__p189_b7_reset();
  PERFORM public.__p189_b7_assert(NOT COALESCE(v_exec, false), 'anon no EXECUTE status');

  SELECT has_function_privilege(
    'authenticated', 'public.p189_infonavit_feature_enabled()', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b7_assert(NOT COALESCE(v_exec, false), 'authenticated no EXECUTE flag');

  SELECT has_function_privilege(
    'authenticated', 'public.p189_infonavit_vault_trimmed(text)', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b7_assert(NOT COALESCE(v_exec, false), 'authenticated no EXECUTE vault');

  -- enabled=true case-insensitive / trim
  PERFORM public.__p189_set_feature_vault(' TRUE ', (NOW() - INTERVAL '1 day')::TEXT);
  PERFORM public.__p189_b7_assert(
    public.p189_infonavit_feature_enabled(), 'TRUE trimmed ON'
  );
  PERFORM public.__p189_set_feature_vault('0', (NOW() - INTERVAL '1 day')::TEXT);
  PERFORM public.__p189_b7_assert(
    NOT public.p189_infonavit_feature_enabled(), '0 → OFF'
  );
  PERFORM public.__p189_set_feature_vault('garbage', (NOW() - INTERVAL '1 day')::TEXT);
  PERFORM public.__p189_b7_assert(
    NOT public.p189_infonavit_feature_enabled(), 'garbage → OFF'
  );

  PERFORM public.__p189_b7_purge();
  PERFORM public.__p189_clear_feature_vault();
  RAISE NOTICE 'P189 B7 SQL: ALL PASSED';
END;
$$;

DROP FUNCTION IF EXISTS public.__p189_b7_p189_counts(UUID);
DROP FUNCTION IF EXISTS public.__p189_b7_reingreso_err(UUID, UUID);
DROP FUNCTION IF EXISTS public.__p189_b7_enviar_err(UUID, UUID);
DROP FUNCTION IF EXISTS public.__p189_b7_reingreso(UUID, UUID);
DROP FUNCTION IF EXISTS public.__p189_b7_enviar(UUID, UUID);
DROP FUNCTION IF EXISTS public.__p189_b7_legacy_datos(TEXT);
DROP FUNCTION IF EXISTS public.__p189_b7_seed_ready(UUID, UUID, UUID, TEXT, JSONB, BOOLEAN);
DROP FUNCTION IF EXISTS public.__p189_b7_seed_exp(UUID, UUID, UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.__p189_b7_purge();
DROP FUNCTION IF EXISTS public.__p189_b7_reset();
DROP FUNCTION IF EXISTS public.__p189_b7_auth(UUID);
DROP FUNCTION IF EXISTS public.__p189_b7_assert(BOOLEAN, TEXT);
