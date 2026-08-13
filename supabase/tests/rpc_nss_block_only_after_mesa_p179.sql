\set ON_ERROR_STOP on

-- P179: gate NSS bloquea solo post-Mesa. Local only.

CREATE OR REPLACE FUNCTION public.__p179_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P179 FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p179_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p179_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p179_cleanup(p_nss TEXT)
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nss TEXT := public.normalize_nss_mexico(p_nss);
BEGIN
  UPDATE public.expedientes e SET reprecalificacion_pendiente_id = NULL WHERE e.nss = v_nss;
  DELETE FROM public.expediente_precalificacion_intentos i
  USING public.expedientes e WHERE i.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.cliente_datos cd
  USING public.expedientes e WHERE cd.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.editor_decisions ed
  USING public.expedientes e WHERE ed.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expediente_documentos d
  USING public.expedientes e WHERE d.expediente_id = e.id AND e.nss = v_nss;
  IF to_regclass('public.expediente_paso_visual_transiciones') IS NOT NULL THEN
    DELETE FROM public.expediente_paso_visual_transiciones t
    USING public.expedientes e WHERE t.expediente_id = e.id AND e.nss = v_nss;
  END IF;
  DELETE FROM public.action_log a
  USING public.expedientes e WHERE a.entity_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expedientes e WHERE e.nss = v_nss;
END; $$;

CREATE OR REPLACE FUNCTION public.__p179_insert_exp(
  p_org UUID, p_asesor UUID, p_nss TEXT, p_programa public.programa,
  p_mesa BOOLEAN, p_nombre TEXT DEFAULT 'Cliente P179'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    gen_random_uuid(), p_org, p_asesor, p_programa, public.normalize_nss_mexico(p_nss),
    p_nombre, '5591790000', 'interno',
    p_mesa, CASE WHEN p_mesa THEN now() ELSE NULL END,
    1, CASE WHEN p_mesa THEN 'en_validacion_mesa'::public.operativo_subestado ELSE 'pendiente'::public.operativo_subestado END,
    'activo'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.__p179_seed_enviar(p_exp UUID, p_org UUID, p_asesor UUID)
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tipo TEXT;
BEGIN
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (p_exp, p_org, 'aprobado', 15000)
  ON CONFLICT (expediente_id) DO UPDATE SET decision = 'aprobado', monto_aprobado = 15000;
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    p_exp, p_org, '{"nombreCliente":"P179"}'::jsonb, 'completo', 10, 4500, 'transferencia'
  ) ON CONFLICT (expediente_id) DO NOTHING;
  DELETE FROM public.expediente_documentos WHERE expediente_id = p_exp;
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org, p_exp, v_tipo,
      'dev/p179/' || p_exp::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor, 'asesor'
    );
  END LOOP;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9179-000000000001';
  v_a UUID := '00000000-0000-4000-9179-000000000011';
  v_b UUID := '00000000-0000-4000-9179-000000000012';
  v_nss TEXT := '99117900001';
  v_nss2 TEXT := '99117900002';
  v_nss3 TEXT := '99117900003';
  v_nss4 TEXT := '99117900004';
  v_nss5 TEXT := '99117900005';
  v_nss_ad TEXT := '99117943129'; -- sintético (caso Adriana-like)
  v_exp UUID;
  v_exp_a UUID;
  v_exp_b UUID;
  v_exp_ad UUID;
  v_gate JSONB;
  v_res JSONB;
  v_n INT;
  v_ok INT;
  v_fail INT;
  v_idx_def TEXT;
BEGIN
  PERFORM public.__p179_reset();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p179-org', 'P179 Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_a, 'authenticated', 'authenticated', 'p179-a@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_b, 'authenticated', 'authenticated', 'p179-b@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_a, v_org, 'p179-a@test.local', 'Asesor A P179', 'asesor', 'interno', NULL, true),
    (v_b, v_org, 'p179-b@test.local', 'Asesor B P179', 'asesor', 'interno', NULL, true)
  ON CONFLICT (id) DO UPDATE SET
    active = true, organization_id = EXCLUDED.organization_id, app_role = 'asesor';

  -- A) sin expediente → ok_create
  PERFORM public.__p179_cleanup(v_nss);
  PERFORM public.__p179_auth(v_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' = 'ok_create', 'A ok_create');
  PERFORM public.__p179_assert(v_gate->>'message' = 'Puedes crear una nueva precalificación.', 'A msg');

  -- B) otro asesor pre-Mesa mismo programa → ok_create
  PERFORM public.__p179_reset();
  v_exp_a := public.__p179_insert_exp(v_org, v_a, v_nss, 'mejoravit', false, 'A pre');
  PERFORM public.__p179_auth(v_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' = 'ok_create', 'B other pre-mesa ok_create');
  PERFORM public.__p179_assert(COALESCE(v_gate->>'expediente_id', '') = '', 'B no leak id');

  -- K) B crea → 2 pre-Mesa coexisten
  SELECT public.create_expediente('mejoravit', v_nss, 'B pre', '5591790001', '') INTO v_res;
  PERFORM public.__p179_assert(v_res->>'id' IS NOT NULL, 'K create B');
  v_exp_b := (v_res->>'id')::UUID;
  PERFORM public.__p179_reset();
  SELECT count(*) INTO v_n FROM public.expedientes
  WHERE nss = v_nss AND deleted_at IS NULL AND ciclo_estado = 'activo'
    AND submitted_to_mesa = false;
  PERFORM public.__p179_assert(v_n = 2, format('K two pre-mesa got %s', v_n));

  -- O) expediente A intacto
  PERFORM public.__p179_assert(
    (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp_a) = false
    AND (SELECT ciclo_estado FROM public.expedientes WHERE id = v_exp_a) = 'activo',
    'O A unchanged'
  );

  -- I) dos pre-Mesa → NO blocked_ambiguous
  PERFORM public.__p179_auth(v_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' IS DISTINCT FROM 'blocked_ambiguous', 'I not ambiguous');
  -- B tiene propio → reprecal_own_mesa
  PERFORM public.__p179_assert(v_gate->>'status' = 'reprecal_own_mesa', 'I B own reprecal');

  -- C) otro asesor pre-Mesa otro programa → ok_create (no blocked_other)
  PERFORM public.__p179_cleanup(v_nss2);
  PERFORM public.__p179_reset();
  PERFORM public.__p179_insert_exp(v_org, v_a, v_nss2, 'compro_tu_casa', false);
  PERFORM public.__p179_auth(v_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss2, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' = 'ok_create', 'C other pre other prog');
  PERFORM public.__p179_assert(v_gate->>'status' IS DISTINCT FROM 'blocked_other_asesor', 'C not blocked');

  -- D) propio pre-Mesa mismo programa → reprecal_own_mesa
  PERFORM public.__p179_cleanup(v_nss3);
  PERFORM public.__p179_reset();
  v_exp := public.__p179_insert_exp(v_org, v_a, v_nss3, 'mejoravit', false);
  PERFORM public.__p179_auth(v_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss3, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' = 'reprecal_own_mesa', 'D own pre');
  PERFORM public.__p179_assert((v_gate->>'expediente_id')::UUID = v_exp, 'D id');

  -- E) propio pre-Mesa otro programa → reprecal_change_programa
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss3, 'compro_tu_casa');
  PERFORM public.__p179_assert(v_gate->>'status' = 'reprecal_change_programa', 'E change prog');

  -- F) otro asesor post-Mesa mismo programa → blocked_other_asesor
  PERFORM public.__p179_cleanup(v_nss4);
  PERFORM public.__p179_reset();
  v_exp_a := public.__p179_insert_exp(v_org, v_a, v_nss4, 'mejoravit', true);
  PERFORM public.__p179_auth(v_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss4, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' = 'blocked_other_asesor', 'F other post');
  PERFORM public.__p179_assert(
    v_gate->>'message' = 'Este NSS ya tiene un expediente activo asignado a otro asesor.',
    'F msg'
  );

  -- G) otro asesor post-Mesa otro programa → blocked_other_asesor (contrato P168/P169)
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss4, 'compro_tu_casa');
  PERFORM public.__p179_assert(v_gate->>'status' = 'blocked_other_asesor', 'G other post other prog');

  -- H) propio post-Mesa
  PERFORM public.__p179_auth(v_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss4, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' = 'reprecal_own_mesa', 'H own post same');
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss4, 'compro_tu_casa');
  PERFORM public.__p179_assert(v_gate->>'status' = 'reprecal_change_programa', 'H own post change');

  -- J) uno post-Mesa + varios pre-Mesa → post-Mesa manda
  PERFORM public.__p179_cleanup(v_nss5);
  PERFORM public.__p179_reset();
  v_exp_a := public.__p179_insert_exp(v_org, v_a, v_nss5, 'mejoravit', true);
  PERFORM public.__p179_insert_exp(v_org, v_b, v_nss5, 'mejoravit', false);
  PERFORM public.__p179_auth(v_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss5, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' = 'blocked_other_asesor', 'J post wins');

  -- Caso Adriana-like (sintético): pre-Mesa ajeno → ok_create
  PERFORM public.__p179_cleanup(v_nss_ad);
  PERFORM public.__p179_reset();
  v_exp_ad := public.__p179_insert_exp(v_org, v_a, v_nss_ad, 'mejoravit', false, 'Cliente Adriana-like');
  UPDATE public.expedientes SET etapa_actual = 1, subestado = 'pendiente' WHERE id = v_exp_ad;
  PERFORM public.__p179_auth(v_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss_ad, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' = 'ok_create', 'Adriana-like ok_create');
  PERFORM public.__p179_assert(v_gate->>'status' IS DISTINCT FROM 'blocked_other_asesor', 'Adriana-like not blocked');

  -- L/M) primero enviar_a_mesa gana; segundo falla
  PERFORM public.__p179_cleanup(v_nss);
  PERFORM public.__p179_reset();
  PERFORM public.__p179_auth(v_a);
  SELECT public.create_expediente('mejoravit', v_nss, 'Race A', '5591790011', '') INTO v_res;
  v_exp_a := (v_res->>'id')::UUID;
  PERFORM public.__p179_auth(v_b);
  SELECT public.create_expediente('mejoravit', v_nss, 'Race B', '5591790012', '') INTO v_res;
  v_exp_b := (v_res->>'id')::UUID;
  PERFORM public.__p179_reset();
  PERFORM public.__p179_seed_enviar(v_exp_a, v_org, v_a);
  PERFORM public.__p179_seed_enviar(v_exp_b, v_org, v_b);

  PERFORM public.__p179_auth(v_a);
  v_res := public.enviar_a_mesa(v_exp_a);
  PERFORM public.__p179_assert(
    (v_res->>'ok')::BOOLEAN OR (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp_a),
    'L A envia'
  );
  PERFORM public.__p179_assert(
    (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp_a) = true,
    'L A submitted'
  );

  PERFORM public.__p179_auth(v_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p179_assert(v_gate->>'status' = 'blocked_other_asesor', 'L B gate blocked after A mesa');

  BEGIN
    PERFORM public.enviar_a_mesa(v_exp_b);
    PERFORM public.__p179_assert(false, 'M B should fail enviar');
  EXCEPTION WHEN others THEN
    PERFORM public.__p179_assert(
      SQLERRM ILIKE '%bloqueado%' OR SQLERRM ILIKE '%Mesa%' OR SQLSTATE = '23505',
      format('M B fail reason: %s', SQLERRM)
    );
  END;
  PERFORM public.__p179_reset();
  PERFORM public.__p179_assert(
    (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp_b) = false,
    'M B still pre-mesa'
  );
  SELECT count(*) INTO v_n FROM public.expedientes
  WHERE nss = v_nss
    AND deleted_at IS NULL AND ciclo_estado = 'activo' AND submitted_to_mesa = true;
  PERFORM public.__p179_assert(v_n = 1, format('M exactly one mesa got %s', v_n));

  -- Race concurrente: dos enviar sobre pre-mesa frescos (simulado sequential last-wins fail)
  PERFORM public.__p179_cleanup(v_nss2);
  PERFORM public.__p179_reset();
  v_exp_a := public.__p179_insert_exp(v_org, v_a, v_nss2, 'mejoravit', false);
  v_exp_b := public.__p179_insert_exp(v_org, v_b, v_nss2, 'mejoravit', false);
  PERFORM public.__p179_seed_enviar(v_exp_a, v_org, v_a);
  PERFORM public.__p179_seed_enviar(v_exp_b, v_org, v_b);
  v_ok := 0; v_fail := 0;
  BEGIN
    PERFORM public.__p179_auth(v_a);
    PERFORM public.enviar_a_mesa(v_exp_a);
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    v_fail := v_fail + 1;
  END;
  BEGIN
    PERFORM public.__p179_auth(v_b);
    PERFORM public.enviar_a_mesa(v_exp_b);
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    v_fail := v_fail + 1;
  END;
  PERFORM public.__p179_assert(v_ok = 1 AND v_fail = 1, format('race ok=%s fail=%s', v_ok, v_fail));
  PERFORM public.__p179_reset();
  SELECT count(*) INTO v_n FROM public.expedientes
  WHERE nss = v_nss2
    AND deleted_at IS NULL AND ciclo_estado = 'activo' AND submitted_to_mesa = true;
  PERFORM public.__p179_assert(v_n = 1, format('race one mesa got %s', v_n));

  -- N) unique index intacto
  SELECT pg_get_indexdef(i.indexrelid) INTO v_idx_def
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'expedientes_nss_programa_mesa_enviado_unique';
  PERFORM public.__p179_assert(v_idx_def IS NOT NULL, 'N index exists');
  PERFORM public.__p179_assert(v_idx_def ILIKE '%submitted_to_mesa%', 'N predicate mesa');
  PERFORM public.__p179_assert(v_idx_def ILIKE '%activo%', 'N predicate activo');

  -- create_expediente safety: post-Mesa bloquea create
  PERFORM public.__p179_auth(v_b);
  BEGIN
    PERFORM public.create_expediente('mejoravit', v_nss2, 'Should fail', '5591790099', '');
    PERFORM public.__p179_assert(false, 'create after mesa should fail');
  EXCEPTION WHEN others THEN
    PERFORM public.__p179_assert(SQLERRM ILIKE '%Mesa%' OR SQLERRM ILIKE '%bloqueado%', 'create blocked mesa');
  END;

  PERFORM public.__p179_reset();
  PERFORM public.__p179_cleanup(v_nss);
  PERFORM public.__p179_cleanup(v_nss2);
  PERFORM public.__p179_cleanup(v_nss3);
  PERFORM public.__p179_cleanup(v_nss4);
  PERFORM public.__p179_cleanup(v_nss5);
  PERFORM public.__p179_cleanup(v_nss_ad);

  RAISE NOTICE 'P179 SQL: ALL PASSED';
END;
$$;

SELECT 'P179 SQL: PASSED' AS result;

DROP FUNCTION IF EXISTS public.__p179_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p179_auth(UUID);
DROP FUNCTION IF EXISTS public.__p179_reset();
DROP FUNCTION IF EXISTS public.__p179_cleanup(TEXT);
DROP FUNCTION IF EXISTS public.__p179_insert_exp(UUID, UUID, TEXT, public.programa, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p179_seed_enviar(UUID, UUID, UUID);
