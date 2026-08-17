-- ConCasa CRM — P189 B4.1 tests: dispatch helper + cron + Vault fail-closed
-- LOCAL: aplicar 186, luego este archivo. NO Cloud.

\set ON_ERROR_STOP on
\i supabase/tests/_p189_infonavit_datos_fixture.sql
\i supabase/migrations/186_infonavit_pdf_worker_schedule.sql

CREATE OR REPLACE FUNCTION public.__p189_b41_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P189 B4.1 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b41_clear_vault()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM vault.secrets
  WHERE name IN ('infonavit_pdf_worker_url', 'infonavit_pdf_worker_secret');
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b41_set_vault(p_url TEXT, p_secret TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p189_b41_clear_vault();
  IF p_url IS NOT NULL THEN
    PERFORM vault.create_secret(p_url, 'infonavit_pdf_worker_url', 'P189 B4.1 SQL fixture');
  END IF;
  IF p_secret IS NOT NULL THEN
    PERFORM vault.create_secret(p_secret, 'infonavit_pdf_worker_secret', 'P189 B4.1 SQL fixture');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b41_purge()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('infonavit.snapshot_mutable', '1', true);
  DELETE FROM public.infonavit_pdf_outbox
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1860%'
  );
  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1860%'
  )
    AND tipo_documento LIKE 'infonavit_%';
  DELETE FROM public.expediente_infonavit_submission_snapshots
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1860%'
  );
  PERFORM set_config('infonavit.snapshot_mutable', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b41_freeze_foreign()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.infonavit_pdf_outbox
  SET available_at = NOW() + INTERVAL '14 days'
  WHERE status = 'pending'
    AND expediente_id NOT IN (
      SELECT id FROM public.expedientes WHERE nss LIKE '1860%'
    );
  UPDATE public.infonavit_pdf_outbox
  SET processing_started_at = NOW()
  WHERE status = 'processing'
    AND expediente_id NOT IN (
      SELECT id FROM public.expedientes WHERE nss LIKE '1860%'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b41_http_max()
RETURNS bigint LANGUAGE sql AS $$
  SELECT GREATEST(
    COALESCE((SELECT max(id) FROM net.http_request_queue), 0),
    COALESCE((SELECT max(id) FROM net._http_response), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.__p189_b41_seed_ready(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_tipo TEXT;
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual,
    subestado, ciclo_estado, direccion_opcional
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss,
    'Fixture P189 B4.1', '5511111111', 'interno', false,
    1, 'pendiente', 'activo', 'Av Siempre Viva 123'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    submitted_to_mesa = false,
    etapa_actual = 1,
    subestado = 'pendiente',
    ciclo_estado = 'activo',
    deleted_at = NULL;

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (p_id, p_org, 'aprobado', 150000)
  ON CONFLICT (expediente_id) DO UPDATE SET decision = 'aprobado', monto_aprobado = 150000;

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    p_id, p_org, public.__p189_infonavit_datos_completo(p_nss),
    'completo', 10, 11000, 'transferencia'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos, estado = 'completo';

  DELETE FROM public.expediente_documentos
  WHERE expediente_id = p_id
    AND tipo_documento = ANY (public.integration_doc_tipos_asesor_envio());
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org, p_id, v_tipo,
      'dev/p189b41/' || p_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor, 'asesor'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b41_enviar(p_expediente_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_asesor UUID;
  v_res JSONB;
BEGIN
  SELECT e.asesor_id INTO v_asesor FROM public.expedientes e WHERE e.id = p_expediente_id;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  SELECT public.enviar_a_mesa(p_expediente_id) INTO v_res;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b41_put_pending(
  p_outbox_id UUID,
  p_org UUID,
  p_exp UUID,
  p_type TEXT,
  p_version INTEGER
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_snap UUID;
  v_hash TEXT;
  v_payload JSONB := '{"schemaVersion":1,"mark":"b41"}'::JSONB;
BEGIN
  v_hash := public.infonavit_pdf_payload_sha256(v_payload);

  SELECT s.id INTO v_snap
  FROM public.expediente_infonavit_submission_snapshots s
  WHERE s.expediente_id = p_exp AND s.submission_version = p_version;

  IF v_snap IS NULL THEN
    INSERT INTO public.expediente_infonavit_submission_snapshots (
      organization_id, expediente_id, submission_version, submission_kind,
      template_version, snapshot_hash, payload, fecha_documento
    ) VALUES (
      p_org, p_exp, p_version,
      CASE WHEN p_version = 0 THEN 'initial' ELSE 'reingreso' END,
      'v1', v_hash, v_payload, CURRENT_DATE
    )
    RETURNING id INTO v_snap;
  END IF;

  INSERT INTO public.infonavit_pdf_outbox (
    id, organization_id, expediente_id, snapshot_id, document_type,
    submission_version, template_version, template_sha256, snapshot_hash, status
  ) VALUES (
    p_outbox_id, p_org, p_exp, v_snap, p_type, p_version, 'v1',
    public.infonavit_pdf_template_sha256(p_type), v_hash, 'pending'
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'pending',
    attempts = 0,
    available_at = NOW(),
    processing_started_at = NULL,
    processed_at = NULL,
    documento_id = NULL,
    last_error_code = NULL;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9186-000000000100';
  v_asesor UUID := '00000000-0000-4000-9186-000000000111';
  v_exp UUID := '00000000-0000-4000-9186-000000000001';
  v_exp2 UUID := '00000000-0000-4000-9186-000000000002';
  v_exp3 UUID := '00000000-0000-4000-9186-000000000003';
  v_o1 UUID := '00000000-0000-4000-9186-00000000aa01';
  v_o2 UUID := '00000000-0000-4000-9186-00000000aa02';
  v_o3 UUID := '00000000-0000-4000-9186-00000000aa03';
  v_stale UUID := '00000000-0000-4000-9186-00000000aa10';
  v_future UUID := '00000000-0000-4000-9186-00000000aa20';
  v_res JSONB;
  v_http_before bigint;
  v_http_after bigint;
  v_exec BOOLEAN;
  v_src TEXT;
  v_cnt INTEGER;
  v_jobid bigint;
  v_sched TEXT;
  v_cmd TEXT;
  v_active BOOLEAN;
  v_rid bigint;
  v_body TEXT;
  v_has_ct BOOLEAN;
  v_has_sec BOOLEAN;
  v_sec_len INTEGER;
  r RECORD;
BEGIN
  PERFORM public.__p189_b41_purge();
  PERFORM public.__p189_b41_freeze_foreign();
  PERFORM public.__p189_b41_clear_vault();
  PERFORM set_config('role', 'postgres', true);
  PERFORM public.__p189_enable_feature_active();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p189-b41-org', 'P189 B4.1 Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_asesor, 'authenticated', 'authenticated', 'p189-b41-asesor@test.local',
    crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES (
    v_asesor, v_org, 'p189-b41-asesor@test.local', 'Asesor P189 B4.1',
    'asesor', 'interno', true
  )
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, active = true;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual,
    subestado, ciclo_estado, direccion_opcional
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '18600000001',
    'Fixture P189 B4.1', '5511111111', 'interno', false,
    1, 'pendiente', 'activo', 'Av Siempre Viva 123'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    ciclo_estado = 'activo',
    deleted_at = NULL;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual,
    subestado, ciclo_estado, direccion_opcional
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '18600000002',
    'Fixture P189 B4.1 stale', '5511111111', 'interno', false,
    1, 'pendiente', 'activo', 'Av Siempre Viva 123'
  )
  ON CONFLICT (id) DO UPDATE SET nss = EXCLUDED.nss, deleted_at = NULL;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual,
    subestado, ciclo_estado, direccion_opcional
  ) VALUES (
    v_exp3, v_org, v_asesor, 'mejoravit', '18600000003',
    'Fixture P189 B4.1 future', '5511111111', 'interno', false,
    1, 'pendiente', 'activo', 'Av Siempre Viva 123'
  )
  ON CONFLICT (id) DO UPDATE SET nss = EXCLUDED.nss, deleted_at = NULL;

  -- -------------------------------------------------------------------------
  -- Job único + schedule + command + agenda UNCHANGED
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_cnt
  FROM cron.job
  WHERE jobname = 'infonavit-pdf-worker-dispatch';
  PERFORM public.__p189_b41_assert(v_cnt = 1, 'job P189 count=' || v_cnt);

  SELECT jobid, schedule, command, active
    INTO v_jobid, v_sched, v_cmd, v_active
  FROM cron.job
  WHERE jobname = 'infonavit-pdf-worker-dispatch';
  PERFORM public.__p189_b41_assert(v_sched = '* * * * *', 'schedule=' || v_sched);
  PERFORM public.__p189_b41_assert(
    v_cmd = 'SELECT public.infonavit_pdf_dispatch_worker();',
    'command unexpected'
  );
  PERFORM public.__p189_b41_assert(v_active, 'job P189 inactive');

  SELECT count(*) INTO v_cnt
  FROM cron.job j
  WHERE j.jobid = 1
    AND j.jobname = 'agenda-sheet-sync-worker-every-minute'
    AND j.schedule = '* * * * *'
    AND j.command = 'SELECT public.agenda_sheet_invoke_sync_worker();'
    AND j.active;
  PERFORM public.__p189_b41_assert(v_cnt = 1, 'agenda sync cron mutated');

  SELECT count(*) INTO v_cnt
  FROM cron.job j
  WHERE j.jobid = 2
    AND j.jobname = 'agenda-sheet-reconcile-every-15m'
    AND j.schedule = '*/15 * * * *'
    AND j.command = 'SELECT public.agenda_sheet_invoke_reconcile();'
    AND j.active;
  PERFORM public.__p189_b41_assert(v_cnt = 1, 'agenda reconcile cron mutated');

  SELECT count(*) INTO v_cnt
  FROM cron.job j
  WHERE j.jobid = 5
    AND j.jobname = 'agenda-sheet-availability-refresh-every-2h'
    AND j.schedule = '7 */2 * * *'
    AND j.command = 'SELECT public.agenda_sheet_invoke_availability_refresh();'
    AND j.active;
  PERFORM public.__p189_b41_assert(v_cnt = 1, 'P188 availability cron mutated');

  SELECT count(*) INTO v_cnt FROM cron.job;
  PERFORM public.__p189_b41_assert(v_cnt = 4, 'cron total expected 4, got ' || v_cnt);

  -- Reaplicar migration: sigue 1 job
  -- (el \i del encabezado ya corrió; simulamos unschedule+schedule idempotente)
  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname = 'infonavit-pdf-worker-dispatch'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'infonavit-pdf-worker-dispatch',
    '* * * * *',
    'SELECT public.infonavit_pdf_dispatch_worker();'
  );
  SELECT count(*) INTO v_cnt
  FROM cron.job WHERE jobname = 'infonavit-pdf-worker-dispatch';
  PERFORM public.__p189_b41_assert(v_cnt = 1, 'job duplicado tras re-schedule');

  SELECT jobid, schedule, command, active
    INTO v_jobid, v_sched, v_cmd, v_active
  FROM cron.job WHERE jobid = 1;
  PERFORM public.__p189_b41_assert(
    v_sched = '* * * * *' AND v_active
      AND v_cmd = 'SELECT public.agenda_sheet_invoke_sync_worker();',
    'jobid 1 mutated after P189 reschedule'
  );

  -- -------------------------------------------------------------------------
  -- Grants
  -- -------------------------------------------------------------------------
  SELECT has_function_privilege(
    'authenticated', 'public.infonavit_pdf_dispatch_worker()', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b41_assert(NOT v_exec, 'authenticated no debe EXECUTE dispatch');

  SELECT has_function_privilege(
    'anon', 'public.infonavit_pdf_dispatch_worker()', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b41_assert(NOT v_exec, 'anon no debe EXECUTE dispatch');

  SELECT has_function_privilege(
    'postgres', 'public.infonavit_pdf_dispatch_worker()', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b41_assert(v_exec, 'postgres debe EXECUTE dispatch');

  SELECT has_function_privilege(
    'service_role', 'public.infonavit_pdf_dispatch_worker()', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b41_assert(v_exec, 'service_role debe EXECUTE dispatch');

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.infonavit_pdf_dispatch_worker();
    PERFORM public.__p189_b41_assert(false, 'authenticated EXECUTE debió denegar');
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      PERFORM public.__p189_b41_assert(
        SQLSTATE IN ('42501', '42500'),
        'auth dispatch denied: ' || SQLERRM
      );
  END;
  PERFORM set_config('role', 'postgres', true);

  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.infonavit_pdf_dispatch_worker();
    PERFORM public.__p189_b41_assert(false, 'anon EXECUTE debió denegar');
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      PERFORM public.__p189_b41_assert(
        SQLSTATE IN ('42501', '42500'),
        'anon dispatch denied: ' || SQLERRM
      );
  END;
  PERFORM set_config('role', 'postgres', true);

  -- -------------------------------------------------------------------------
  -- No PII in helper source / body is {}
  -- -------------------------------------------------------------------------
  SELECT pg_get_functiondef('public.infonavit_pdf_dispatch_worker()'::regprocedure)
    INTO v_src;
  PERFORM public.__p189_b41_assert(
    position('nss' IN lower(v_src)) = 0, 'helper source menciona nss'
  );
  PERFORM public.__p189_b41_assert(
    position('curp' IN lower(v_src)) = 0, 'helper source menciona curp'
  );
  PERFORM public.__p189_b41_assert(
    position('telefono' IN lower(v_src)) = 0, 'helper source menciona telefono'
  );
  PERFORM public.__p189_b41_assert(
    position('correo' IN lower(v_src)) = 0, 'helper source menciona correo'
  );
  PERFORM public.__p189_b41_assert(
    position('payload' IN lower(v_src)) = 0, 'helper source menciona payload'
  );
  PERFORM public.__p189_b41_assert(
    position('snapshot' IN lower(v_src)) = 0, 'helper source menciona snapshot'
  );
  PERFORM public.__p189_b41_assert(
    v_src LIKE '%''{}''::jsonb%',
    'helper body no es {}'
  );
  PERFORM public.__p189_b41_assert(
    position('vault.create_secret' IN lower(v_src)) = 0,
    'helper no debe create_secret'
  );
  PERFORM public.__p189_b41_assert(
    position('agenda_sheet' IN v_src) = 0, 'helper reutiliza agenda_sheet'
  );
  PERFORM public.__p189_b41_assert(
    position('infonavit_pdf_worker_url' IN v_src) > 0, 'falta vault url name'
  );
  PERFORM public.__p189_b41_assert(
    position('infonavit_pdf_worker_secret' IN v_src) > 0, 'falta vault secret name'
  );

  -- -------------------------------------------------------------------------
  -- No work → no HTTP (incluso con Vault presente)
  -- -------------------------------------------------------------------------
  PERFORM public.__p189_b41_set_vault(
    'http://127.0.0.1:9/functions/v1/infonavit-pdf-worker',
    'p189-b41-sql-fixture-secret'
  );
  v_http_before := public.__p189_b41_http_max();
  SELECT public.infonavit_pdf_dispatch_worker() INTO v_res;
  v_http_after := public.__p189_b41_http_max();
  PERFORM public.__p189_b41_assert(
    v_res->>'status' = 'no_work',
    'no-work status=' || COALESCE(v_res->>'status', 'null')
  );
  PERFORM public.__p189_b41_assert(
    v_res->>'request_id' IS NULL,
    'no-work no debe HTTP'
  );
  PERFORM public.__p189_b41_assert(
    v_http_after = v_http_before,
    'no-work incrementó pg_net'
  );

  -- -------------------------------------------------------------------------
  -- Pending + Vault missing → no HTTP, outbox intacto
  -- -------------------------------------------------------------------------
  PERFORM public.__p189_b41_put_pending(
    v_o1, v_org, v_exp, 'infonavit_carta_bajo_protesta', 0
  );
  PERFORM public.__p189_b41_put_pending(
    v_o2, v_org, v_exp, 'infonavit_presupuesto_mejoramiento', 0
  );
  PERFORM public.__p189_b41_put_pending(
    v_o3, v_org, v_exp, 'infonavit_solicitud_inscripcion', 0
  );
  PERFORM public.__p189_b41_clear_vault();
  v_http_before := public.__p189_b41_http_max();
  SELECT public.infonavit_pdf_dispatch_worker() INTO v_res;
  v_http_after := public.__p189_b41_http_max();
  PERFORM public.__p189_b41_assert(
    v_res->>'status' = 'missing_configuration',
    'missing-config status=' || COALESCE(v_res->>'status', 'null')
  );
  PERFORM public.__p189_b41_assert(v_res->>'request_id' IS NULL, 'missing-config HTTP');
  PERFORM public.__p189_b41_assert(
    v_http_after = v_http_before,
    'missing-config incrementó pg_net'
  );
  SELECT count(*) INTO v_cnt
  FROM public.infonavit_pdf_outbox
  WHERE expediente_id = v_exp AND status = 'pending' AND attempts = 0;
  PERFORM public.__p189_b41_assert(v_cnt = 3, 'missing-config mutó outbox');

  -- secret vacío / URL vacía = missing (no placeholder HTTP)
  PERFORM public.__p189_b41_set_vault(
    'http://127.0.0.1:9/functions/v1/infonavit-pdf-worker',
    '   '
  );
  SELECT public.infonavit_pdf_dispatch_worker() INTO v_res;
  PERFORM public.__p189_b41_assert(
    v_res->>'status' = 'missing_configuration',
    'blank secret debe fail-closed'
  );

  PERFORM public.__p189_b41_set_vault('', 'p189-b41-sql-fixture-secret');
  SELECT public.infonavit_pdf_dispatch_worker() INTO v_res;
  PERFORM public.__p189_b41_assert(
    v_res->>'status' = 'missing_configuration',
    'blank url debe fail-closed'
  );

  -- -------------------------------------------------------------------------
  -- available_at futuro → no_work
  -- -------------------------------------------------------------------------
  PERFORM public.__p189_b41_purge();
  PERFORM public.__p189_b41_freeze_foreign();
  PERFORM public.__p189_b41_put_pending(
    v_future, v_org, v_exp3, 'infonavit_carta_bajo_protesta', 0
  );
  UPDATE public.infonavit_pdf_outbox
  SET available_at = NOW() + INTERVAL '15 minutes', status = 'pending'
  WHERE id = v_future;
  PERFORM public.__p189_b41_set_vault(
    'http://127.0.0.1:9/functions/v1/infonavit-pdf-worker',
    'p189-b41-sql-fixture-secret'
  );
  v_http_before := public.__p189_b41_http_max();
  SELECT public.infonavit_pdf_dispatch_worker() INTO v_res;
  v_http_after := public.__p189_b41_http_max();
  PERFORM public.__p189_b41_assert(
    v_res->>'status' = 'no_work',
    'future available_at status=' || COALESCE(v_res->>'status', 'null')
  );
  PERFORM public.__p189_b41_assert(
    v_http_after = v_http_before,
    'future available_at disparó HTTP'
  );
  SELECT status, attempts INTO r
  FROM public.infonavit_pdf_outbox WHERE id = v_future;
  PERFORM public.__p189_b41_assert(r.status = 'pending' AND r.attempts = 0, 'future row claimed');

  -- -------------------------------------------------------------------------
  -- Pending detection → dispatched + body {} (sin imprimir secret)
  -- -------------------------------------------------------------------------
  UPDATE public.infonavit_pdf_outbox
  SET available_at = NOW() - INTERVAL '1 second'
  WHERE id = v_future;
  v_http_before := public.__p189_b41_http_max();
  SELECT public.infonavit_pdf_dispatch_worker() INTO v_res;
  PERFORM public.__p189_b41_assert(
    v_res->>'status' = 'dispatched',
    'pending detection status=' || COALESCE(v_res->>'status', 'null')
  );
  v_rid := (v_res->>'request_id')::bigint;
  PERFORM public.__p189_b41_assert(v_rid IS NOT NULL AND v_rid > v_http_before, 'pending sin request_id');

  SELECT convert_from(q.body, 'UTF8'),
         (q.headers ? 'Content-Type'),
         (q.headers ? 'x-concasa-worker-secret'),
         length(q.headers->>'x-concasa-worker-secret')
    INTO v_body, v_has_ct, v_has_sec, v_sec_len
  FROM net.http_request_queue q
  WHERE q.id = v_rid;
  IF v_body IS NOT NULL THEN
    PERFORM public.__p189_b41_assert(btrim(v_body) = '{}', 'pg_net body no es {}');
    PERFORM public.__p189_b41_assert(v_has_ct AND v_has_sec, 'faltan headers');
    PERFORM public.__p189_b41_assert(v_sec_len > 8, 'secret header vacío');
  END IF;

  SELECT status, attempts INTO r
  FROM public.infonavit_pdf_outbox WHERE id = v_future;
  PERFORM public.__p189_b41_assert(
    r.status = 'pending' AND r.attempts = 0,
    'dispatch no debe claim'
  );

  -- -------------------------------------------------------------------------
  -- Stale processing → dispatched
  -- -------------------------------------------------------------------------
  PERFORM public.__p189_b41_purge();
  PERFORM public.__p189_b41_freeze_foreign();
  PERFORM public.__p189_b41_put_pending(
    v_stale, v_org, v_exp2, 'infonavit_presupuesto_mejoramiento', 0
  );
  UPDATE public.infonavit_pdf_outbox
  SET status = 'processing',
      processing_started_at = NOW() - INTERVAL '11 minutes',
      attempts = 1,
      available_at = NOW() - INTERVAL '1 hour'
  WHERE id = v_stale;
  SELECT public.infonavit_pdf_dispatch_worker() INTO v_res;
  PERFORM public.__p189_b41_assert(
    v_res->>'status' = 'dispatched',
    'stale detection status=' || COALESCE(v_res->>'status', 'null')
  );
  SELECT status, attempts INTO r
  FROM public.infonavit_pdf_outbox WHERE id = v_stale;
  PERFORM public.__p189_b41_assert(
    r.status = 'processing' AND r.attempts = 1,
    'stale dispatch no debe claim'
  );

  -- processing fresco (<10m) no es trabajo
  UPDATE public.infonavit_pdf_outbox
  SET processing_started_at = NOW() - INTERVAL '2 minutes'
  WHERE id = v_stale;
  SELECT public.infonavit_pdf_dispatch_worker() INTO v_res;
  PERFORM public.__p189_b41_assert(
    v_res->>'status' = 'no_work',
    'fresh lease no debe dispatch'
  );

  PERFORM public.__p189_b41_purge();
  PERFORM public.__p189_b41_freeze_foreign();
  PERFORM public.__p189_b41_clear_vault();
  PERFORM public.__p189_clear_feature_vault();

  RAISE NOTICE 'P189 B4.1 SQL tests: PASS';
END;
$$;
