-- P186 B1A: editor_list_expediente_ids_page + editor_guardar_borrador_reprecalificacion
-- LOCAL / rollback al final. No Cloud.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p186_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P186 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p186_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p186_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p186_cleanup()
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.expedientes e
  SET reprecalificacion_pendiente_id = NULL
  WHERE e.nss LIKE '99186%'
     OR e.cliente_nombre LIKE 'P186%';

  DELETE FROM public.expediente_precalificacion_intentos i
  USING public.expedientes e
  WHERE i.expediente_id = e.id
    AND (e.nss LIKE '99186%' OR e.cliente_nombre LIKE 'P186%');

  DELETE FROM public.cliente_datos cd
  USING public.expedientes e
  WHERE cd.expediente_id = e.id
    AND (e.nss LIKE '99186%' OR e.cliente_nombre LIKE 'P186%');

  DELETE FROM public.editor_decisions ed
  USING public.expedientes e
  WHERE ed.expediente_id = e.id
    AND (e.nss LIKE '99186%' OR e.cliente_nombre LIKE 'P186%');

  DELETE FROM public.action_log al
  USING public.expedientes e
  WHERE al.entity_id = e.id
    AND (e.nss LIKE '99186%' OR e.cliente_nombre LIKE 'P186%');

  IF to_regclass('public.expediente_paso_visual_transiciones') IS NOT NULL THEN
    DELETE FROM public.expediente_paso_visual_transiciones t
    USING public.expedientes e
    WHERE t.expediente_id = e.id
      AND (e.nss LIKE '99186%' OR e.cliente_nombre LIKE 'P186%');
  END IF;

  DELETE FROM public.expedientes e
  WHERE e.nss LIKE '99186%'
     OR e.cliente_nombre LIKE 'P186%';
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_draft TEXT;
  v_granted BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'editor_list_expediente_ids_page'
  LIMIT 1;
  PERFORM public.__p186_assert(v_src IS NOT NULL, 'list RPC existe');
  PERFORM public.__p186_assert(position('SECURITY DEFINER' in v_src) > 0, 'list DEFINER');
  PERFORM public.__p186_assert(position('STABLE' in v_src) > 0, 'list STABLE');
  PERFORM public.__p186_assert(position('editor_activity_at' in v_src) > 0, 'activity key');
  PERFORM public.__p186_assert(
    position('ORDER BY r.editor_activity_at DESC, r.id DESC' in v_src) > 0,
    'ORDER antes de paginar'
  );
  PERFORM public.__p186_assert(position('OFFSET v_offset' in v_src) > 0, 'OFFSET tras ORDER');
  PERFORM public.__p186_assert(
    position('e.updated_at' in v_src) = 0,
    'list no usa e.updated_at'
  );
  PERFORM public.__p186_assert(
    position('decided_at' in v_src) = 0,
    'list no ordena por decided_at'
  );
  PERFORM public.__p186_assert(
    position('reprecalificacion_pendiente_id' in v_src) > 0,
    'JOIN pointer exacto'
  );
  PERFORM public.__p186_assert(position('pend.expediente_id = e.id' in v_src) > 0, 'intento.expediente_id');
  PERFORM public.__p186_assert(position('e.organization_id = v_org' in v_src) > 0, 'org isolation');
  PERFORM public.__p186_assert(position('cliente_nombre ILIKE' in v_src) > 0, 'search cliente');
  PERFORM public.__p186_assert(position('telefono_cliente' in v_src) > 0, 'search tel');
  PERFORM public.__p186_assert(position('nss::text ILIKE' in v_src) > 0, 'search nss');
  PERFORM public.__p186_assert(position('programa::text ILIKE' in v_src) > 0, 'search programa');
  PERFORM public.__p186_assert(position('pr.email' in v_src) > 0, 'search asesor email');
  PERFORM public.__p186_assert(position('pr.full_name' in v_src) > 0, 'search asesor nombre');

  SELECT pg_get_functiondef(p.oid) INTO v_draft
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'editor_guardar_borrador_reprecalificacion'
  LIMIT 1;
  PERFORM public.__p186_assert(v_draft IS NOT NULL, 'draft RPC existe');
  PERFORM public.__p186_assert(position('SECURITY DEFINER' in v_draft) > 0, 'draft DEFINER');
  PERFORM public.__p186_assert(position('UPDATE public.expedientes' in v_draft) = 0, 'draft no UPDATE expedientes');
  PERFORM public.__p186_assert(position('editor_decisions' in v_draft) = 0, 'draft no toca editor_decisions');
  PERFORM public.__p186_assert(position('editor_resolver_reprecalificacion' in v_draft) = 0, 'draft no resuelve');
  PERFORM public.__p186_assert(position('upsert_editor_decision' in v_draft) = 0, 'draft no upsert decision');
  PERFORM public.__p186_assert(position('INSERT INTO public.action_log' in v_draft) = 0, 'draft 0 action_log');
  PERFORM public.__p186_assert(position('notas_revision' in v_draft) > 0, 'draft notas');
  PERFORM public.__p186_assert(position('FOR UPDATE' in v_draft) > 0, 'draft lock');

  SELECT has_function_privilege(
    'authenticated',
    'public.editor_list_expediente_ids_page(integer,integer,text)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p186_assert(v_granted, 'list grant authenticated');

  SELECT has_function_privilege(
    'anon',
    'public.editor_list_expediente_ids_page(integer,integer,text)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p186_assert(NOT v_granted, 'list revoke anon');

  SELECT has_function_privilege(
    'authenticated',
    'public.editor_guardar_borrador_reprecalificacion(uuid,numeric,text)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p186_assert(v_granted, 'draft grant authenticated');

  SELECT has_function_privilege(
    'anon',
    'public.editor_guardar_borrador_reprecalificacion(uuid,numeric,text)',
    'EXECUTE'
  ) INTO v_granted;
  PERFORM public.__p186_assert(NOT v_granted, 'draft revoke anon');
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9186-000000000001';
  v_org2 UUID := '00000000-0000-4000-9186-000000000002';
  v_asesor UUID := '00000000-0000-4000-9186-000000000011';
  v_editor UUID := '00000000-0000-4000-9186-000000000013';
  v_editor2 UUID := '00000000-0000-4000-9186-000000000014';
  v_admin UUID := '00000000-0000-4000-9186-000000000015';
  v_editor_org2 UUID := '00000000-0000-4000-9186-000000000016';
  v_id_alta UUID;
  v_id_viejo UUID;
  v_id_g1 UUID := '00000000-0000-4000-9186-0000000000a1';
  v_id_g2 UUID := '00000000-0000-4000-9186-0000000000a2';
  v_id_h1 UUID;
  v_id_h2 UUID;
  v_id_h3 UUID;
  v_id_prog UUID;
  v_id_draft UUID;
  v_id_hist UUID;
  v_id_org2 UUID;
  v_int_pend UUID;
  v_int_hist UUID;
  v_int_other UUID;
  v_page JSONB;
  v_ids TEXT[];
  v_act TIMESTAMPTZ;
  v_updated_before TIMESTAMPTZ;
  v_etapa_before SMALLINT;
  v_sub_before TEXT;
  v_ciclo_before TEXT;
  v_pointer UUID;
  v_ed_before JSONB;
  v_al_before BIGINT;
  v_al_after BIGINT;
  v_draft JSONB;
  v_err TEXT;
  v_code TEXT;
  v_p183 JSONB;
BEGIN
  PERFORM public.__p186_reset_auth();
  PERFORM public.__p186_cleanup();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES
    (v_org, 'p186-editor-inbox-org', 'P186 Editor Inbox Org', true),
    (v_org2, 'p186-editor-inbox-org2', 'P186 Editor Inbox Org2', true)
  ON CONFLICT (id) DO UPDATE SET active = true, slug = EXCLUDED.slug, name = EXCLUDED.name;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p186-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'p186-editor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor2, 'authenticated', 'authenticated', 'p186-editor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_admin, 'authenticated', 'authenticated', 'p186-admin@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor_org2, 'authenticated', 'authenticated', 'p186-editor-org2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p186-asesor@test.local', 'Asesor P186 Unique', 'asesor', 'interno', NULL, true),
    (v_editor, v_org, 'p186-editor@test.local', 'Editor P186', 'editor', NULL, NULL, true),
    (v_editor2, v_org, 'p186-editor2@test.local', 'Editor P186 B', 'editor', NULL, NULL, true),
    (v_admin, v_org, 'p186-admin@test.local', 'Admin P186', 'super_admin', NULL, NULL, true),
    (v_editor_org2, v_org2, 'p186-editor-org2@test.local', 'Editor P186 Org2', 'editor', NULL, NULL, true)
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    app_role = EXCLUDED.app_role,
    active = true;

  -- A. alta 14:20
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99186000001', 'P186 Alta Nueva',
    '5518600001', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-08-14 14:20:00+00', timestamptz '2026-08-14 14:20:00+00'
  ) RETURNING id INTO v_id_alta;

  -- B. viejo created 2026-07-01; updated_at 14:30 (ruido)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99186000002', 'P186 Viejo Ruido',
    '5518600002', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-07-01 00:00:00+00', timestamptz '2026-08-14 14:30:00+00'
  ) RETURNING id INTO v_id_viejo;
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar
  ) VALUES (v_id_viejo, v_org, 'aprobado', 80000, timestamptz '2026-07-01 00:00:00+00', 80000);

  PERFORM public.__p186_set_auth(v_editor);
  v_page := public.editor_list_expediente_ids_page(1, 50, 'P186 Alta');
  PERFORM public.__p186_assert((v_page->'items'->0->>'id') = v_id_alta::text, 'A. alta arriba por created_at');
  PERFORM public.__p186_assert(
    (v_page->'items'->0->>'editor_activity_at')::timestamptz = timestamptz '2026-08-14 14:20:00+00',
    'A. activity = created_at'
  );

  v_page := public.editor_list_expediente_ids_page(1, 50, NULL);
  v_ids := ARRAY(SELECT jsonb_array_elements(v_page->'items')->>'id');
  PERFORM public.__p186_assert(
    array_position(v_ids, v_id_alta::text) < array_position(v_ids, v_id_viejo::text),
    'B. updated_at 14:30 no gana a alta 14:20'
  );

  -- C. pending 14:21 en viejo
  PERFORM public.__p186_reset_auth();
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    idempotency_key, created_at, es_vigente, monto_aprobado, notas_revision
  ) VALUES (
    v_org, v_id_viejo, v_asesor, 'mejoravit', 'mejoravit', '99186000002',
    'P186 Viejo Ruido', '5518600002', 'pendiente', 'aprobado', 80000,
    'p186-viejo-pend', timestamptz '2026-08-14 14:21:00+00', false, NULL, ''
  ) RETURNING id INTO v_int_pend;
  UPDATE public.expedientes SET reprecalificacion_pendiente_id = v_int_pend WHERE id = v_id_viejo;

  PERFORM public.__p186_set_auth(v_editor);
  v_page := public.editor_list_expediente_ids_page(1, 50, NULL);
  PERFORM public.__p186_assert((v_page->'items'->0->>'id') = v_id_viejo::text, 'C. pending 14:21 gana a alta 14:20');
  PERFORM public.__p186_assert(
    (v_page->'items'->0->>'editor_activity_at')::timestamptz = timestamptz '2026-08-14 14:21:00+00',
    'C. activity = pending.created_at'
  );

  -- D. P181 reuse: refresh created_at 14:22
  PERFORM public.__p186_reset_auth();
  UPDATE public.expediente_precalificacion_intentos
  SET created_at = timestamptz '2026-08-14 14:22:00+00'
  WHERE id = v_int_pend;
  PERFORM public.__p186_set_auth(v_editor);
  v_page := public.editor_list_expediente_ids_page(1, 50, '99186000002');
  PERFORM public.__p186_assert(
    (v_page->'items'->0->>'editor_activity_at')::timestamptz = timestamptz '2026-08-14 14:22:00+00',
    'D. created_at refresh vuelve arriba'
  );
  PERFORM public.__p186_assert((v_page->'items'->0->>'id') = v_id_viejo::text, 'D. id pending');

  -- E. pending resuelto + pointer clear → vuelve a created_at viejo
  PERFORM public.__p186_reset_auth();
  UPDATE public.expediente_precalificacion_intentos
  SET decision = 'aprobado',
      monto_aprobado = 95000,
      decided_at = timestamptz '2026-08-14 14:25:00+00',
      decided_by = v_editor,
      es_vigente = true
  WHERE id = v_int_pend;
  UPDATE public.expedientes
  SET reprecalificacion_pendiente_id = NULL,
      updated_at = timestamptz '2026-08-14 14:25:00+00'
  WHERE id = v_id_viejo;
  UPDATE public.editor_decisions
  SET monto_aprobado = 95000
  WHERE expediente_id = v_id_viejo;

  PERFORM public.__p186_set_auth(v_editor);
  v_page := public.editor_list_expediente_ids_page(1, 50, NULL);
  v_ids := ARRAY(SELECT jsonb_array_elements(v_page->'items')->>'id');
  PERFORM public.__p186_assert(
    array_position(v_ids, v_id_alta::text) < array_position(v_ids, v_id_viejo::text),
    'E. resuelto vuelve a created_at histórico'
  );
  SELECT (elem->>'editor_activity_at')::timestamptz INTO v_act
  FROM jsonb_array_elements(v_page->'items') elem
  WHERE elem->>'id' = v_id_viejo::text;
  PERFORM public.__p186_assert(v_act = timestamptz '2026-07-01 00:00:00+00', 'E. activity = e.created_at');

  -- F. ruido etapa/updated_at no cambia activity
  PERFORM public.__p186_reset_auth();
  UPDATE public.expedientes
  SET etapa_actual = 8,
      subestado = 'en_proceso',
      updated_at = timestamptz '2026-08-14 18:00:00+00'
  WHERE id = v_id_viejo;
  PERFORM public.__p186_set_auth(v_editor);
  v_page := public.editor_list_expediente_ids_page(1, 50, NULL);
  SELECT (elem->>'editor_activity_at')::timestamptz INTO v_act
  FROM jsonb_array_elements(v_page->'items') elem
  WHERE elem->>'id' = v_id_viejo::text;
  PERFORM public.__p186_assert(v_act = timestamptz '2026-07-01 00:00:00+00', 'F. activity intacta tras updated_at');
  v_ids := ARRAY(SELECT jsonb_array_elements(v_page->'items')->>'id');
  PERFORM public.__p186_assert(
    array_position(v_ids, v_id_alta::text) < array_position(v_ids, v_id_viejo::text),
    'F. ruido no sube page 1 vs alta'
  );

  -- G. mismo timestamp → id DESC
  PERFORM public.__p186_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES
    (v_id_g1, v_org, v_asesor, 'mejoravit', '99186000003', 'P186 Tie A1',
     '5518600003', 'interno', 'activo', false, 1, 'pendiente',
     timestamptz '2026-08-14 13:00:00+00', timestamptz '2026-08-14 13:00:00+00'),
    (v_id_g2, v_org, v_asesor, 'mejoravit', '99186000004', 'P186 Tie A2',
     '5518600004', 'interno', 'activo', false, 1, 'pendiente',
     timestamptz '2026-08-14 13:00:00+00', timestamptz '2026-08-14 13:00:00+00');

  PERFORM public.__p186_set_auth(v_editor);
  v_page := public.editor_list_expediente_ids_page(1, 50, 'P186 Tie');
  PERFORM public.__p186_assert((v_page->'items'->0->>'id') = v_id_g2::text, 'G. id DESC primero');
  PERFORM public.__p186_assert((v_page->'items'->1->>'id') = v_id_g1::text, 'G. id DESC segundo');

  -- H/I/J. paginación
  PERFORM public.__p186_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99186000005', 'P186 Page H1',
    '5518600005', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-08-14 16:00:00+00', timestamptz '2026-08-14 16:00:00+00'
  ) RETURNING id INTO v_id_h1;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99186000006', 'P186 Page H2',
    '5518600006', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-08-14 16:01:00+00', timestamptz '2026-08-14 16:01:00+00'
  ) RETURNING id INTO v_id_h2;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99186000007', 'P186 Page H3',
    '5518600007', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-08-14 16:02:00+00', timestamptz '2026-08-14 16:02:00+00'
  ) RETURNING id INTO v_id_h3;

  PERFORM public.__p186_set_auth(v_editor);
  v_page := public.editor_list_expediente_ids_page(1, 2, 'P186 Page');
  PERFORM public.__p186_assert((v_page->>'total_count')::int = 3, 'J. total_count filtrado');
  PERFORM public.__p186_assert(jsonb_array_length(v_page->'items') = 2, 'H. page size 2');
  PERFORM public.__p186_assert((v_page->'items'->0->>'id') = v_id_h3::text, 'H. page1 #1 activity SQL');
  PERFORM public.__p186_assert((v_page->'items'->1->>'id') = v_id_h2::text, 'H. page1 #2');

  v_page := public.editor_list_expediente_ids_page(2, 2, 'P186 Page');
  PERFORM public.__p186_assert(jsonb_array_length(v_page->'items') = 1, 'I. page2 size');
  PERFORM public.__p186_assert((v_page->'items'->0->>'id') = v_id_h1::text, 'I. page2 sin salto');
  PERFORM public.__p186_assert(
    (v_page->'items'->0->>'id') IS DISTINCT FROM v_id_h3::text
    AND (v_page->'items'->0->>'id') IS DISTINCT FROM v_id_h2::text,
    'I. page2 sin duplicados'
  );

  -- K. search cliente
  v_page := public.editor_list_expediente_ids_page(1, 50, 'Alta Nueva');
  PERFORM public.__p186_assert((v_page->>'total_count')::int = 1, 'K. search cliente');
  PERFORM public.__p186_assert((v_page->'items'->0->>'id') = v_id_alta::text, 'K. id cliente');

  -- L. search NSS
  v_page := public.editor_list_expediente_ids_page(1, 50, '99186000001');
  PERFORM public.__p186_assert((v_page->'items'->0->>'id') = v_id_alta::text, 'L. search NSS');

  -- M. search programa
  PERFORM public.__p186_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'subcuenta', '99186000008', 'P186 Prog Subcuenta',
    '5518600008', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-08-14 11:00:00+00', timestamptz '2026-08-14 11:00:00+00'
  ) RETURNING id INTO v_id_prog;
  PERFORM public.__p186_set_auth(v_editor);
  v_page := public.editor_list_expediente_ids_page(1, 50, 'subcuenta');
  PERFORM public.__p186_assert((v_page->>'total_count')::int >= 1, 'M. search programa count');
  PERFORM public.__p186_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') x
      WHERE x->>'id' = v_id_prog::text
    ),
    'M. search programa id'
  );

  -- N. search asesor nombre/email
  v_page := public.editor_list_expediente_ids_page(1, 50, 'Asesor P186 Unique');
  PERFORM public.__p186_assert((v_page->>'total_count')::int > 0, 'N. search asesor nombre');
  v_page := public.editor_list_expediente_ids_page(1, 50, 'p186-asesor@test.local');
  PERFORM public.__p186_assert((v_page->>'total_count')::int > 0, 'N. search asesor email');

  -- O. org isolation
  PERFORM public.__p186_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org2, v_editor_org2, 'mejoravit', '99186000009', 'P186 Org2 Secret',
    '5518600009', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-08-14 19:00:00+00', timestamptz '2026-08-14 19:00:00+00'
  ) RETURNING id INTO v_id_org2;

  PERFORM public.__p186_set_auth(v_editor);
  v_page := public.editor_list_expediente_ids_page(1, 50, 'P186 Org2 Secret');
  PERFORM public.__p186_assert((v_page->>'total_count')::int = 0, 'O. org isolation search');
  v_page := public.editor_list_expediente_ids_page(1, 100, NULL);
  PERFORM public.__p186_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') x
      WHERE x->>'id' = v_id_org2::text
    ),
    'O. org isolation universe'
  );

  -- P. super_admin autorizado
  PERFORM public.__p186_set_auth(v_admin);
  v_page := public.editor_list_expediente_ids_page(1, 50, 'P186 Alta');
  PERFORM public.__p186_assert((v_page->'items'->0->>'id') = v_id_alta::text, 'P. super_admin list');

  -- Q. asesor bloqueado
  PERFORM public.__p186_set_auth(v_asesor);
  BEGIN
    v_page := public.editor_list_expediente_ids_page(1, 50, NULL);
    PERFORM public.__p186_assert(false, 'Q. asesor debió fallar');
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Q. anon: sin EXECUTE
  PERFORM public.__p186_assert(
    NOT has_function_privilege(
      'anon',
      'public.editor_list_expediente_ids_page(integer,integer,text)',
      'EXECUTE'
    ),
    'Q. anon sin EXECUTE list'
  );

  -- Draft fixture: pending + vigente editor_decisions + snapshot histórico
  PERFORM public.__p186_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99186000010', 'P186 Draft Target',
    '5518600010', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-06-01 00:00:00+00', timestamptz '2026-06-01 00:00:00+00'
  ) RETURNING id INTO v_id_draft;
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision,
    aprobado_at, monto_aprobado_al_aprobar
  ) VALUES (
    v_id_draft, v_org, 'aprobado', 50000, 'vigente original',
    timestamptz '2026-06-01 00:00:00+00', 50000
  );
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, monto_aprobado, notas_revision,
    es_vigente, created_at, decided_at, decided_by
  ) VALUES (
    v_org, v_id_draft, v_asesor, 'mejoravit', 'mejoravit', '99186000010',
    'P186 Draft Target', '5518600010', 'aprobado', 50000, 'snapshot historico',
    true, timestamptz '2026-06-01 00:00:00+00', timestamptz '2026-06-01 00:00:00+00', v_editor
  ) RETURNING id INTO v_int_hist;
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    intento_previo_id, idempotency_key, created_at, es_vigente, monto_aprobado, notas_revision
  ) VALUES (
    v_org, v_id_draft, v_asesor, 'mejoravit', 'mejoravit', '99186000010',
    'P186 Draft Target', '5518600010', 'pendiente', 'aprobado', 50000,
    v_int_hist, 'p186-draft-pend', timestamptz '2026-08-14 15:00:00+00', false, NULL, ''
  ) RETURNING id INTO v_int_pend;
  UPDATE public.expedientes SET reprecalificacion_pendiente_id = v_int_pend WHERE id = v_id_draft;

  SELECT to_jsonb(ed) INTO v_ed_before
  FROM public.editor_decisions ed WHERE ed.expediente_id = v_id_draft;
  SELECT e.updated_at, e.etapa_actual, e.subestado::text, e.ciclo_estado::text,
         e.reprecalificacion_pendiente_id
  INTO v_updated_before, v_etapa_before, v_sub_before, v_ciclo_before, v_pointer
  FROM public.expedientes e WHERE e.id = v_id_draft;
  SELECT count(*) INTO v_al_before FROM public.action_log al WHERE al.entity_id = v_id_draft;

  -- R. draft monto 12000
  PERFORM public.__p186_set_auth(v_editor);
  v_draft := public.editor_guardar_borrador_reprecalificacion(v_id_draft, 12000, NULL);
  PERFORM public.__p186_assert((v_draft->>'ok')::boolean, 'R. ok');
  PERFORM public.__p186_assert((v_draft->>'decision') = 'pendiente', 'R. decision pendiente');
  PERFORM public.__p186_assert((v_draft->>'monto_aprobado')::numeric = 12000, 'R. monto 12000');
  PERFORM public.__p186_assert((v_draft->>'intento_id') = v_int_pend::text, 'R. pointer intento');
  PERFORM public.__p186_assert(
    EXISTS (
      SELECT 1 FROM public.expediente_precalificacion_intentos i
      WHERE i.id = v_int_pend AND i.monto_aprobado = 12000 AND i.decision = 'pendiente'
        AND i.decided_at IS NULL
    ),
    'R. attempt persistido'
  );
  PERFORM public.__p186_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_id_draft AND e.reprecalificacion_pendiente_id = v_int_pend
    ),
    'R. pointer intacto'
  );

  -- S. 12000 → 120000
  v_draft := public.editor_guardar_borrador_reprecalificacion(v_id_draft, 120000, 'keep?');
  PERFORM public.__p186_assert((v_draft->>'monto_aprobado')::numeric = 120000, 'S. latest monto');

  -- T. notas
  v_draft := public.editor_guardar_borrador_reprecalificacion(v_id_draft, 120000, 'nota draft p186');
  PERFORM public.__p186_assert((v_draft->>'notas_revision') = 'nota draft p186', 'T. notas');

  -- U. limpiar monto NULL
  v_draft := public.editor_guardar_borrador_reprecalificacion(v_id_draft, NULL, 'nota draft p186');
  PERFORM public.__p186_assert(v_draft->>'monto_aprobado' IS NULL, 'U. monto NULL');

  -- V. limpiar notas ''
  v_draft := public.editor_guardar_borrador_reprecalificacion(v_id_draft, NULL, '');
  PERFORM public.__p186_assert((v_draft->>'notas_revision') = '', 'V. notas vacías');

  -- W/X/Y/Z
  PERFORM public.__p186_assert(
    (SELECT to_jsonb(ed) FROM public.editor_decisions ed WHERE ed.expediente_id = v_id_draft) = v_ed_before,
    'W. editor_decisions intacto'
  );
  PERFORM public.__p186_assert(
    (SELECT e.updated_at FROM public.expedientes e WHERE e.id = v_id_draft) = v_updated_before,
    'X. expediente.updated_at intacto'
  );
  PERFORM public.__p186_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_id_draft
        AND e.etapa_actual = v_etapa_before
        AND e.subestado::text = v_sub_before
        AND e.ciclo_estado::text = v_ciclo_before
        AND e.reprecalificacion_pendiente_id = v_pointer
    ),
    'Y. etapa/subestado/ciclo/pointer intactos'
  );
  PERFORM public.__p186_assert(
    EXISTS (
      SELECT 1 FROM public.expediente_precalificacion_intentos i
      WHERE i.id = v_int_pend AND i.decision = 'pendiente' AND i.decided_at IS NULL AND i.es_vigente = false
    ),
    'Z. no resolución'
  );
  SELECT count(*) INTO v_al_after FROM public.action_log al WHERE al.entity_id = v_id_draft;
  PERFORM public.__p186_assert(v_al_after = v_al_before, 'Z. 0 action_log extra');

  -- P183: pending sigue exponiendo monto vigente, no draft
  PERFORM public.__p186_reset_auth();
  UPDATE public.expediente_precalificacion_intentos
  SET monto_aprobado = 12000, notas_revision = 'draft visible?'
  WHERE id = v_int_pend;
  PERFORM public.__p186_set_auth(v_asesor);
  v_p183 := public.asesor_list_expedientes_page(
    1, 25, 'P186 Draft Target', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos'
  );
  PERFORM public.__p186_assert((v_p183->'items'->0->>'reprecal_estado') = 'pending', 'P183 pending');
  PERFORM public.__p186_assert((v_p183->'items'->0->>'monto_aprobado')::numeric = 50000, 'P183 monto vigente');
  PERFORM public.__p186_assert(v_p183->'items'->0->>'reprecal_monto_resultado' IS NULL, 'P183 draft no es resultado');
  PERFORM public.__p186_assert((v_p183->'items'->0->>'reprecal_monto_previo')::numeric = 50000, 'P183 monto previo');

  -- AA. otro editor misma org
  PERFORM public.__p186_set_auth(v_editor2);
  v_draft := public.editor_guardar_borrador_reprecalificacion(v_id_draft, 777, 'otro editor');
  PERFORM public.__p186_assert((v_draft->>'monto_aprobado')::numeric = 777, 'AA. otro editor misma org OK');

  -- AB. otra org
  PERFORM public.__p186_set_auth(v_editor_org2);
  BEGIN
    v_draft := public.editor_guardar_borrador_reprecalificacion(v_id_draft, 1, 'x');
    PERFORM public.__p186_assert(false, 'AB. otra org debió fallar');
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- AE. snapshot histórico no se modifica (RLS: leer como postgres)
  PERFORM public.__p186_reset_auth();
  PERFORM public.__p186_assert(
    EXISTS (
      SELECT 1 FROM public.expediente_precalificacion_intentos i
      WHERE i.id = v_int_hist AND i.monto_aprobado = 50000 AND i.notas_revision = 'snapshot historico'
        AND i.decision = 'aprobado'
    ),
    'AE. snapshot histórico intacto'
  );

  -- AD. pointer mismatch (apunta a intento de otro expediente)
  PERFORM public.__p186_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99186000011', 'P186 Mismatch Host',
    '5518600011', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-05-01 00:00:00+00', timestamptz '2026-05-01 00:00:00+00'
  ) RETURNING id INTO v_id_hist;
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, created_at, es_vigente
  ) VALUES (
    v_org, v_id_hist, v_asesor, 'mejoravit', 'mejoravit', '99186000011',
    'P186 Mismatch Host', '5518600011', 'pendiente', now(), false
  ) RETURNING id INTO v_int_other;
  UPDATE public.expedientes
  SET reprecalificacion_pendiente_id = v_int_other
  WHERE id = v_id_draft;

  PERFORM public.__p186_set_auth(v_editor);
  BEGIN
    v_draft := public.editor_guardar_borrador_reprecalificacion(v_id_draft, 1, 'stale');
    PERFORM public.__p186_assert(false, 'AD. mismatch debió fallar');
  EXCEPTION
    WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- restaurar pointer válido para AC
  PERFORM public.__p186_reset_auth();
  UPDATE public.expedientes SET reprecalificacion_pendiente_id = v_int_pend WHERE id = v_id_draft;
  UPDATE public.expediente_precalificacion_intentos
  SET decision = 'aprobado', decided_at = now(), decided_by = v_editor, monto_aprobado = 1
  WHERE id = v_int_pend;

  -- AC. intento ya resuelto (pointer aún apunta)
  PERFORM public.__p186_set_auth(v_editor);
  BEGIN
    v_draft := public.editor_guardar_borrador_reprecalificacion(v_id_draft, 9, 'late');
    PERFORM public.__p186_assert(false, 'AC. resuelto debió fallar');
  EXCEPTION
    WHEN SQLSTATE '22023' THEN NULL;
  END;

  PERFORM public.__p186_reset_auth();
  PERFORM public.__p186_cleanup();
END;
$$;

DROP FUNCTION IF EXISTS public.__p186_cleanup();
DROP FUNCTION IF EXISTS public.__p186_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p186_reset_auth();
DROP FUNCTION IF EXISTS public.__p186_assert(BOOLEAN, TEXT);
