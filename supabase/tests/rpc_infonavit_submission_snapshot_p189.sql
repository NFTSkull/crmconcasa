-- ConCasa CRM — P189 B3 tests: snapshot + outbox transaccional
-- Uso: aplicar 183+184 LOCAL, luego este archivo.

\set ON_ERROR_STOP on
\i supabase/tests/_p189_infonavit_datos_fixture.sql

CREATE OR REPLACE FUNCTION public.__p189_b3_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P189 B3 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b3_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b3_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b3_purge()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('infonavit.snapshot_mutable', '1', true);
  DELETE FROM public.infonavit_pdf_outbox
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '1840%' OR nss LIKE '1841%'
  );
  DELETE FROM public.expediente_infonavit_submission_snapshots
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes
    WHERE nss LIKE '1840%' OR nss LIKE '1841%'
  );
  PERFORM set_config('infonavit.snapshot_mutable', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b3_seed_exp(
  p_id UUID,
  p_org UUID,
  p_asesor UUID,
  p_nss TEXT,
  p_programa public.programa DEFAULT 'mejoravit',
  p_submitted BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado, direccion_opcional
  ) VALUES (
    p_id, p_org, p_asesor, p_programa, p_nss,
    'Fixture P189 B3', '5511111111', 'interno',
    p_submitted,
    CASE WHEN p_submitted THEN NOW() - INTERVAL '2 days' ELSE NULL END,
    1, 'pendiente', 'activo',
    'Av Siempre Viva 123, Centro, Monterrey, CP 64000'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    programa = EXCLUDED.programa,
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

CREATE OR REPLACE FUNCTION public.__p189_b3_seed_ready(
  p_id UUID,
  p_org UUID,
  p_asesor UUID,
  p_nss TEXT,
  p_programa public.programa DEFAULT 'mejoravit',
  p_datos JSONB DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_tipo TEXT;
  v_datos JSONB;
BEGIN
  PERFORM public.__p189_b3_seed_exp(p_id, p_org, p_asesor, p_nss, p_programa, false);

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
      'dev/p189/' || p_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor, 'asesor'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b3_enviar(p_user UUID, p_exp UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  PERFORM public.__p189_b3_auth(p_user);
  SELECT public.enviar_a_mesa(p_exp) INTO v;
  PERFORM public.__p189_b3_reset();
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b3_reingreso(p_user UUID, p_exp UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  PERFORM public.__p189_b3_auth(p_user);
  SELECT public.asesor_enviar_reingreso_a_mesa(p_exp) INTO v;
  PERFORM public.__p189_b3_reset();
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b3_enviar_err(p_user UUID, p_exp UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__p189_b3_auth(p_user);
  BEGIN
    PERFORM public.enviar_a_mesa(p_exp);
    PERFORM public.__p189_b3_reset();
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p189_b3_reset();
    RETURN v_err;
  END;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9184-000000000100';
  v_asesor UUID := '00000000-0000-4000-9184-000000000111';
  v_auth UUID := '00000000-0000-4000-9184-000000000111';
  v_exp UUID := '00000000-0000-4000-9184-000000000001';
  v_exp2 UUID := '00000000-0000-4000-9184-000000000002';
  v_exp3 UUID := '00000000-0000-4000-9184-000000000003';
  v_exp4 UUID := '00000000-0000-4000-9184-000000000004';
  v_exp5 UUID := '00000000-0000-4000-9184-000000000005';
  v_exp6 UUID := '00000000-0000-4000-9184-000000000006';
  v_exp7 UUID := '00000000-0000-4000-9184-000000000007';
  v_exp8 UUID := '00000000-0000-4000-9184-000000000008';
  v_exp9 UUID := '00000000-0000-4000-9184-000000000009';
  v_exp10 UUID := '00000000-0000-4000-9184-000000000010';
  v_exp11 UUID := '00000000-0000-4000-9184-000000000011';
  v_exp12 UUID := '00000000-0000-4000-9184-000000000012';
  v_nss TEXT := '18400000001';
  v_res JSONB;
  v_err TEXT;
  v_snap INTEGER;
  v_out INTEGER;
  v_ver INTEGER;
  v_kind TEXT;
  v_hash TEXT;
  v_fecha_doc DATE;
  v_fecha_env DATE;
  v_payload JSONB;
  v_sha TEXT;
  v_tipos TEXT[];
  v_submitted BOOLEAN;
  v_etapa SMALLINT;
  v_log BIGINT;
  v_dummy UUID;
  v_can INTEGER;
BEGIN
  PERFORM public.__p189_b3_purge();
  PERFORM set_config('role', 'postgres', true);
  PERFORM public.__p189_enable_feature_active();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p189-b3-org', 'P189 B3 Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_asesor, 'authenticated', 'authenticated', 'p189-b3-asesor@test.local',
    crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES (
    v_asesor, v_org, 'p189-b3-asesor@test.local', 'Asesor P189 B3', 'asesor', 'interno', true
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    active = true,
    app_role = 'asesor';

  -- 1-7 initial Mejoravit válido
  PERFORM public.__p189_b3_seed_ready(v_exp, v_org, v_asesor, v_nss);
  v_res := public.__p189_b3_enviar(v_asesor, v_exp);
  PERFORM public.__p189_b3_assert((v_res->>'ok')::boolean, '1: enviar ok');

  SELECT count(*) INTO v_snap
  FROM public.expediente_infonavit_submission_snapshots s
  WHERE s.expediente_id = v_exp;
  PERFORM public.__p189_b3_assert(v_snap = 1, '1: 1 snapshot');

  SELECT count(*) INTO v_out
  FROM public.infonavit_pdf_outbox o WHERE o.expediente_id = v_exp;
  PERFORM public.__p189_b3_assert(v_out = 3, '1: 3 outbox');

  SELECT s.submission_version, s.submission_kind, s.snapshot_hash, s.fecha_documento, s.payload
  INTO v_ver, v_kind, v_hash, v_fecha_doc, v_payload
  FROM public.expediente_infonavit_submission_snapshots s
  WHERE s.expediente_id = v_exp;
  PERFORM public.__p189_b3_assert(v_ver = 0, '2: version 0');
  PERFORM public.__p189_b3_assert(v_kind = 'initial', '2: kind initial');

  SELECT (e.fecha_envio_mesa AT TIME ZONE 'America/Monterrey')::date
  INTO v_fecha_env
  FROM public.expedientes e WHERE e.id = v_exp;
  PERFORM public.__p189_b3_assert(v_fecha_doc = v_fecha_env, '3: fechaDocumento = fecha_envio_mesa Monterrey');
  PERFORM public.__p189_b3_assert(v_payload->>'fechaDocumento' = to_char(v_fecha_doc, 'YYYY-MM-DD'), '3b: payload fecha');

  PERFORM public.__p189_b3_assert(v_payload #>> '{credito,plazoAnios}' = '5', '5: plazoAnios');
  PERFORM public.__p189_b3_assert(v_payload #> '{credito,plazoMeses}' IS NULL, '5b: no plazoMeses');
  PERFORM public.__p189_b3_assert(
    (v_payload #>> '{mejora,presupuestoEstimado}')::numeric = 25000,
    '6: presupuesto 25000'
  );
  PERFORM public.__p189_b3_assert(
    (v_payload #>> '{credito,montoSolicitado}')::numeric = 80000,
    '6b: monto solicitado ≠ presupuesto'
  );
  PERFORM public.__p189_b3_assert(v_payload #>> '{cliente,telefono}' = '', '7: tel titular blank');
  PERFORM public.__p189_b3_assert(v_payload #>> '{cliente,ladaTelefono}' = '', '7b: lada titular blank');
  PERFORM public.__p189_b3_assert(v_payload #>> '{empresa,lada}' = '', '7c: lada empresa blank');
  PERFORM public.__p189_b3_assert(v_payload #>> '{empresa,extension}' = '', '7d: ext empresa blank');
  PERFORM public.__p189_b3_assert(v_payload #> '{cliente,nss}' IS NOT NULL, '4: nss en payload');
  PERFORM public.__p189_b3_assert(v_payload #>> '{vivienda,calle}' = 'Av Siempre Viva', '4b: calle');

  SELECT array_agg(o.document_type ORDER BY o.document_type) INTO v_tipos
  FROM public.infonavit_pdf_outbox o WHERE o.expediente_id = v_exp;
  PERFORM public.__p189_b3_assert(
    v_tipos = ARRAY[
      'infonavit_carta_bajo_protesta',
      'infonavit_presupuesto_mejoramiento',
      'infonavit_solicitud_inscripcion'
    ]::TEXT[],
    '36: tipos exactos'
  );
  PERFORM public.__p189_b3_assert(
    NOT EXISTS (
      SELECT 1 FROM public.infonavit_pdf_outbox o
      WHERE o.expediente_id = v_exp
        AND (o.status <> 'pending' OR o.attempts <> 0 OR o.template_version <> 'v1'
             OR o.submission_version <> 0 OR o.snapshot_hash <> v_hash)
    ),
    '36b: pending/attempts/hash'
  );
  SELECT public.infonavit_pdf_template_sha256('infonavit_carta_bajo_protesta') INTO v_sha;
  PERFORM public.__p189_b3_assert(
    (SELECT o.template_sha256 FROM public.infonavit_pdf_outbox o
     WHERE o.expediente_id = v_exp AND o.document_type = 'infonavit_carta_bajo_protesta') = v_sha,
    '24: SHA carta'
  );
  PERFORM public.__p189_b3_assert(
    (SELECT o.template_sha256 FROM public.infonavit_pdf_outbox o
     WHERE o.expediente_id = v_exp AND o.document_type = 'infonavit_presupuesto_mejoramiento')
    = public.infonavit_pdf_template_sha256('infonavit_presupuesto_mejoramiento'),
    '24b: SHA presupuesto'
  );
  PERFORM public.__p189_b3_assert(
    (SELECT o.template_sha256 FROM public.infonavit_pdf_outbox o
     WHERE o.expediente_id = v_exp AND o.document_type = 'infonavit_solicitud_inscripcion')
    = public.infonavit_pdf_template_sha256('infonavit_solicitud_inscripcion'),
    '24c: SHA solicitud'
  );

  -- 8 missing infonavit
  PERFORM public.__p189_b3_seed_ready(
    v_exp2, v_org, v_asesor, '18400000002', 'mejoravit',
    jsonb_build_object(
      'nss', '18400000002', 'curp', 'GAVF850101HDFRRL09', 'celular', '5511111111',
      'correo', 'x@y.z', 'empresa', 'E', 'registroPatronal', 'Y1',
      'telefonoEmpresa', '8187654321', 'montoMejoravit', '80000', 'plazo', '5'
    )
  );
  v_err := public.__p189_b3_enviar_err(v_asesor, v_exp2);
  PERFORM public.__p189_b3_assert(v_err LIKE '%INFONAVIT_DATOS_INCOMPLETOS%', '8: missing infonavit');
  PERFORM public.__p189_b3_assert(
    (SELECT e.submitted_to_mesa FROM public.expedientes e WHERE e.id = v_exp2) = false,
    '8b: no submitted'
  );

  -- 9 schemaVersion inválida
  PERFORM public.__p189_b3_seed_ready(
    v_exp3, v_org, v_asesor, '18400000003', 'mejoravit',
    public.__p189_infonavit_datos_completo('18400000003')
      || jsonb_build_object(
        'infonavit',
        (public.__p189_infonavit_datos_completo('18400000003')->'infonavit')
          || jsonb_build_object('schemaVersion', 2)
      )
  );
  v_err := public.__p189_b3_enviar_err(v_asesor, v_exp3);
  PERFORM public.__p189_b3_assert(v_err LIKE '%INFONAVIT_DATOS_VERSION_INVALIDA%', '9: version');

  -- 10 required faltante (sin nombres titular)
  PERFORM public.__p189_b3_seed_ready(
    v_exp4, v_org, v_asesor, '18400000004', 'mejoravit',
    jsonb_set(
      public.__p189_infonavit_datos_completo('18400000004'),
      '{infonavit,titular,nombres}',
      '""'::jsonb
    )
  );
  v_err := public.__p189_b3_enviar_err(v_asesor, v_exp4);
  PERFORM public.__p189_b3_assert(v_err LIKE '%INFONAVIT_DATOS_INCOMPLETOS%', '10: nombres');

  -- 11 NSS mismatch
  PERFORM public.__p189_b3_seed_ready(
    v_exp5, v_org, v_asesor, '18400000005', 'mejoravit',
    jsonb_set(
      public.__p189_infonavit_datos_completo('18400000005'),
      '{nss}',
      '"18400000999"'::jsonb
    )
  );
  v_err := public.__p189_b3_enviar_err(v_asesor, v_exp5);
  PERFORM public.__p189_b3_assert(v_err LIKE '%INFONAVIT_NSS_MISMATCH%', '11: nss mismatch');
  PERFORM public.__p189_b3_assert(position('184000' IN COALESCE(v_err, '')) = 0, '11b: sin NSS en error');

  -- 12 Compro / subcuenta: 0 P189
  PERFORM public.__p189_b3_seed_ready(
    v_exp6, v_org, v_asesor, '18400000006', 'compro_tu_casa',
    jsonb_build_object('nombreCliente', 'Compro', 'rfc', 'XAXX010101000')
  );
  v_res := public.__p189_b3_enviar(v_asesor, v_exp6);
  PERFORM public.__p189_b3_assert((v_res->>'ok')::boolean, '12: compro ok');
  PERFORM public.__p189_b3_assert(
    NOT EXISTS (
      SELECT 1 FROM public.expediente_infonavit_submission_snapshots s
      WHERE s.expediente_id = v_exp6
    ),
    '12b: 0 snapshot compro'
  );

  PERFORM public.__p189_b3_seed_ready(
    v_exp7, v_org, v_asesor, '18400000007', 'subcuenta',
    jsonb_build_object('nombreCliente', 'Sub', 'rfc', 'XAXX010101000')
  );
  v_res := public.__p189_b3_enviar(v_asesor, v_exp7);
  PERFORM public.__p189_b3_assert((v_res->>'ok')::boolean, '12c: subcuenta ok');
  PERFORM public.__p189_b3_assert(
    NOT EXISTS (
      SELECT 1 FROM public.infonavit_pdf_outbox o WHERE o.expediente_id = v_exp7
    ),
    '12d: 0 outbox subcuenta'
  );

  -- 13 snapshot unique conflict → rollback
  PERFORM public.__p189_b3_seed_ready(v_exp8, v_org, v_asesor, '18400000008');
  INSERT INTO public.expediente_infonavit_submission_snapshots (
    organization_id, expediente_id, submission_version, submission_kind,
    template_version, snapshot_hash, payload, fecha_documento
  ) VALUES (
    v_org, v_exp8, 0, 'initial', 'v1',
    repeat('ab', 32),
    '{"schemaVersion":1}'::jsonb,
    CURRENT_DATE
  );
  SELECT e.submitted_to_mesa, e.etapa_actual INTO v_submitted, v_etapa
  FROM public.expedientes e WHERE e.id = v_exp8;
  SELECT count(*) INTO v_log FROM public.action_log al
  WHERE al.entity_id = v_exp8 AND al.action = 'expediente.enviar_a_mesa';
  v_err := public.__p189_b3_enviar_err(v_asesor, v_exp8);
  PERFORM public.__p189_b3_assert(v_err IS NOT NULL, '13: conflict falla');
  PERFORM public.__p189_b3_assert(
    (SELECT e.submitted_to_mesa FROM public.expedientes e WHERE e.id = v_exp8) = v_submitted,
    '13b: submitted intacto'
  );
  PERFORM public.__p189_b3_assert(
    (SELECT e.etapa_actual FROM public.expedientes e WHERE e.id = v_exp8) = v_etapa,
    '13c: etapa intacta'
  );
  PERFORM public.__p189_b3_assert(
    (SELECT count(*) FROM public.action_log al
     WHERE al.entity_id = v_exp8 AND al.action = 'expediente.enviar_a_mesa') = v_log,
    '13d: 0 action_log nuevo'
  );

  -- 14 outbox unique conflict → rollback
  PERFORM public.__p189_b3_seed_ready(v_exp9, v_org, v_asesor, '18400000009');
  INSERT INTO public.expediente_infonavit_submission_snapshots (
    organization_id, expediente_id, submission_version, submission_kind,
    template_version, snapshot_hash, payload, fecha_documento
  ) VALUES (
    v_org, v_exp9, 99, 'initial', 'v1',
    repeat('cd', 32),
    '{"schemaVersion":1}'::jsonb,
    CURRENT_DATE
  )
  RETURNING id INTO v_dummy;
  v_payload := public.infonavit_build_submission_payload(v_exp9, NOW());
  v_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.infonavit_pdf_outbox (
    organization_id, expediente_id, snapshot_id, document_type,
    submission_version, template_version, template_sha256, snapshot_hash, status
  ) VALUES (
    v_org, v_exp9, v_dummy, 'infonavit_carta_bajo_protesta',
    0, 'v1', public.infonavit_pdf_template_sha256('infonavit_carta_bajo_protesta'),
    v_hash, 'pending'
  );
  SELECT e.submitted_to_mesa INTO v_submitted FROM public.expedientes e WHERE e.id = v_exp9;
  v_err := public.__p189_b3_enviar_err(v_asesor, v_exp9);
  PERFORM public.__p189_b3_assert(v_err IS NOT NULL, '14: outbox conflict');
  PERFORM public.__p189_b3_assert(
    (SELECT e.submitted_to_mesa FROM public.expedientes e WHERE e.id = v_exp9) = v_submitted,
    '14b: rollback operativo'
  );
  PERFORM public.__p189_b3_assert(
    NOT EXISTS (
      SELECT 1 FROM public.expediente_infonavit_submission_snapshots s
      WHERE s.expediente_id = v_exp9 AND s.submission_version = 0
    ),
    '14c: 0 snapshot version 0'
  );

  -- 15-16 reingreso changed=true version=counter
  PERFORM public.__p189_b3_seed_ready(v_exp10, v_org, v_asesor, '18400000010');
  UPDATE public.expedientes
  SET submitted_to_mesa = true, fecha_envio_mesa = NOW() - INTERVAL '2 days',
      etapa_actual = 4, subestado = 'en_proceso'
  WHERE id = v_exp10;
  v_res := public.__p189_b3_reingreso(v_asesor, v_exp10);
  PERFORM public.__p189_b3_assert((v_res->>'changed')::boolean, '15: reingreso changed');
  PERFORM public.__p189_b3_assert((v_res->>'reingreso_manual_count')::int = 1, '16: counter 1');
  PERFORM public.__p189_b3_assert(
    (SELECT s.submission_version FROM public.expediente_infonavit_submission_snapshots s
     WHERE s.expediente_id = v_exp10) = 1,
    '16b: snapshot version 1'
  );
  PERFORM public.__p189_b3_assert(
    (SELECT s.submission_kind FROM public.expediente_infonavit_submission_snapshots s
     WHERE s.expediente_id = v_exp10) = 'reingreso',
    '16c: kind reingreso'
  );
  PERFORM public.__p189_b3_assert(
    (SELECT count(*) FROM public.infonavit_pdf_outbox o WHERE o.expediente_id = v_exp10) = 3,
    '15b: 3 outbox reingreso'
  );

  -- 17 idempotente changed=false → 0 nuevas
  v_res := public.__p189_b3_reingreso(v_asesor, v_exp10);
  PERFORM public.__p189_b3_assert((v_res->>'idempotent')::boolean, '17: idempotent');
  PERFORM public.__p189_b3_assert((v_res->>'changed')::boolean = false, '17b: changed false');
  PERFORM public.__p189_b3_assert(
    (SELECT count(*) FROM public.expediente_infonavit_submission_snapshots s
     WHERE s.expediente_id = v_exp10) = 1,
    '17c: sigue 1 snapshot'
  );
  PERFORM public.__p189_b3_assert(
    (SELECT count(*) FROM public.infonavit_pdf_outbox o WHERE o.expediente_id = v_exp10) = 3,
    '17d: sigue 3 outbox'
  );

  -- 18 primer envío vía reingreso → version 1
  PERFORM public.__p189_b3_seed_ready(v_exp11, v_org, v_asesor, '18400000011');
  v_res := public.__p189_b3_reingreso(v_asesor, v_exp11);
  PERFORM public.__p189_b3_assert((v_res->>'era_primer_envio')::boolean, '18: era_primer_envio');
  PERFORM public.__p189_b3_assert((v_res->>'reingreso_manual_count')::int = 1, '18b: count 1');
  PERFORM public.__p189_b3_assert(
    (SELECT s.submission_version FROM public.expediente_infonavit_submission_snapshots s
     WHERE s.expediente_id = v_exp11) = 1,
    '18c: version 1 no 0'
  );

  -- 23 S1/S2 separados (segundo reingreso fuera de ventana 5s)
  UPDATE public.expedientes
  SET reingreso_manual_at = NOW() - INTERVAL '1 minute', etapa_actual = 4
  WHERE id = v_exp10;
  v_res := public.__p189_b3_reingreso(v_asesor, v_exp10);
  PERFORM public.__p189_b3_assert((v_res->>'reingreso_manual_count')::int = 2, '23: count 2');
  PERFORM public.__p189_b3_assert(
    (SELECT count(*) FROM public.expediente_infonavit_submission_snapshots s
     WHERE s.expediente_id = v_exp10) = 2,
    '23b: 2 snapshots'
  );
  PERFORM public.__p189_b3_assert(
    (SELECT count(*) FROM public.infonavit_pdf_outbox o WHERE o.expediente_id = v_exp10) = 6,
    '23c: 6 outbox'
  );

  -- 19-20 immutability
  BEGIN
    UPDATE public.expediente_infonavit_submission_snapshots
    SET payload = '{}'::jsonb
    WHERE expediente_id = v_exp;
    PERFORM public.__p189_b3_assert(false, '19: update debió fallar');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p189_b3_assert(SQLERRM LIKE '%INFONAVIT_SNAPSHOT_IMMUTABLE%', '19: update reject');
  END;
  BEGIN
    DELETE FROM public.expediente_infonavit_submission_snapshots WHERE expediente_id = v_exp;
    PERFORM public.__p189_b3_assert(false, '20: delete debió fallar');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p189_b3_assert(SQLERRM LIKE '%INFONAVIT_SNAPSHOT_IMMUTABLE%', '20: delete reject');
  END;

  -- 21-22 authenticated sin privilegio directo
  PERFORM public.__p189_b3_auth(v_auth);
  BEGIN
    SELECT count(*)::int INTO v_can
    FROM public.expediente_infonavit_submission_snapshots;
    PERFORM public.__p189_b3_reset();
    PERFORM public.__p189_b3_assert(false, '21: SELECT snapshot no debió pasar');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM public.__p189_b3_reset();
  WHEN OTHERS THEN
    PERFORM public.__p189_b3_reset();
    IF SQLERRM LIKE '%permission denied%' THEN
      NULL;
    ELSE
      RAISE;
    END IF;
  END;

  PERFORM public.__p189_b3_auth(v_auth);
  BEGIN
    UPDATE public.infonavit_pdf_outbox SET status = 'done' WHERE expediente_id = v_exp;
    PERFORM public.__p189_b3_reset();
    PERFORM public.__p189_b3_assert(false, '22: UPDATE outbox no debió pasar');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM public.__p189_b3_reset();
  WHEN OTHERS THEN
    PERFORM public.__p189_b3_reset();
    IF SQLERRM LIKE '%permission denied%' THEN
      NULL;
    ELSE
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'P189 B3 SQL: ALL PASSED';
  PERFORM public.__p189_clear_feature_vault();
END;
$$;

DROP FUNCTION IF EXISTS public.__p189_b3_enviar_err(UUID, UUID);
DROP FUNCTION IF EXISTS public.__p189_b3_reingreso(UUID, UUID);
DROP FUNCTION IF EXISTS public.__p189_b3_enviar(UUID, UUID);
DROP FUNCTION IF EXISTS public.__p189_b3_seed_ready(UUID, UUID, UUID, TEXT, public.programa, JSONB);
DROP FUNCTION IF EXISTS public.__p189_b3_seed_exp(UUID, UUID, UUID, TEXT, public.programa, BOOLEAN);
DROP FUNCTION IF EXISTS public.__p189_b3_purge();
DROP FUNCTION IF EXISTS public.__p189_b3_reset();
DROP FUNCTION IF EXISTS public.__p189_b3_auth(UUID);
DROP FUNCTION IF EXISTS public.__p189_b3_assert(BOOLEAN, TEXT);
