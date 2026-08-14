-- P183: inbox asesor ordena por actividad de re-precal REAL (local/rollback).
-- No muta asesor_iniciar_reprecalificacion / editor_resolver_reprecalificacion.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p183_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P183 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p183_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p183_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p183_cleanup()
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.expedientes e
  SET reprecalificacion_pendiente_id = NULL
  WHERE e.nss LIKE '99183%'
     OR e.cliente_nombre LIKE 'P183%';

  DELETE FROM public.expediente_precalificacion_intentos i
  USING public.expedientes e
  WHERE i.expediente_id = e.id
    AND (e.nss LIKE '99183%' OR e.cliente_nombre LIKE 'P183%');

  DELETE FROM public.cliente_datos cd
  USING public.expedientes e
  WHERE cd.expediente_id = e.id
    AND (e.nss LIKE '99183%' OR e.cliente_nombre LIKE 'P183%');

  DELETE FROM public.editor_decisions ed
  USING public.expedientes e
  WHERE ed.expediente_id = e.id
    AND (e.nss LIKE '99183%' OR e.cliente_nombre LIKE 'P183%');

  IF to_regclass('public.expediente_paso_visual_transiciones') IS NOT NULL THEN
    DELETE FROM public.expediente_paso_visual_transiciones t
    USING public.expedientes e
    WHERE t.expediente_id = e.id
      AND (e.nss LIKE '99183%' OR e.cliente_nombre LIKE 'P183%');
  END IF;

  DELETE FROM public.expedientes e
  WHERE e.nss LIKE '99183%'
     OR e.cliente_nombre LIKE 'P183%';
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_list_expedientes_page'
  LIMIT 1;
  PERFORM public.__p183_assert(v_src IS NOT NULL, 'list RPC existe');
  PERFORM public.__p183_assert(position('inbox_sort_at DESC' in v_src) > 0, 'ORDER inbox_sort_at');
  PERFORM public.__p183_assert(position('reprecal_activity_at' in v_src) > 0, 'meta activity');
  PERFORM public.__p183_assert(position('e.updated_at DESC' in v_src) = 0, 'no sort updated_at');
  PERFORM public.__p183_assert(
    position('p_fecha_desde' in v_src) > 0
    AND position('e.created_at' in v_src) > 0,
    'fecha filter sigue created_at'
  );
  PERFORM public.__p183_assert(
    position('to_jsonb(p) - ''inbox_sort_at''' in v_src) > 0
    OR position('to_jsonb(p) - ''inbox_sort_at''' in replace(v_src, ' ', '')) > 0
    OR position('- ''inbox_sort_at''' in v_src) > 0,
    'inbox_sort_at no sale en JSON'
  );
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9183-000000000001';
  v_asesor UUID := '00000000-0000-4000-9183-000000000011';
  v_asesor2 UUID := '00000000-0000-4000-9183-000000000012';
  v_editor UUID := '00000000-0000-4000-9183-000000000013';
  v_id_a UUID;
  v_id_b UUID;
  v_id_c UUID;
  v_id_g UUID;
  v_id_h UUID;
  v_id_i UUID;
  v_id_j UUID;
  v_id_k UUID;
  v_id_l1 UUID;
  v_id_l2 UUID;
  v_id_m UUID;
  v_id_n UUID;
  v_id_pad UUID;
  v_int_pend UUID;
  v_int_old UUID;
  v_int_new UUID;
  v_int_snap UUID;
  v_int_k UUID;
  v_page JSONB;
  v_item JSONB;
  v_ids TEXT[];
  v_i INT;
BEGIN
  PERFORM public.__p183_reset_auth();
  PERFORM public.__p183_cleanup();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p183-reprecal-inbox-org', 'P183 Reprecal Inbox Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true, slug = EXCLUDED.slug, name = EXCLUDED.name;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p183-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor2, 'authenticated', 'authenticated', 'p183-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'p183-editor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p183-asesor@test.local', 'Asesor P183', 'asesor', 'interno', NULL, true),
    (v_asesor2, v_org, 'p183-asesor2@test.local', 'Asesor P183 B', 'asesor', 'interno', NULL, true),
    (v_editor, v_org, 'p183-editor@test.local', 'Editor P183', 'editor', NULL, NULL, true)
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    email = EXCLUDED.email,
    app_role = EXCLUDED.app_role,
    active = true;

  -- A: nuevo sin reprecal (created_at más reciente que B)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000001', 'P183 A nuevo',
    '5500000001', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-08-14 12:00:00+00', timestamptz '2026-08-14 12:00:00+00'
  ) RETURNING id INTO v_id_a;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar)
  VALUES (v_id_a, v_org, 'aprobado', 50000, timestamptz '2026-08-14 12:00:00+00', 50000);

  -- B: viejo; pending nuevo 12:05
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000002', 'P183 B pending',
    '5500000002', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-05-01 00:00:00+00', timestamptz '2026-08-14 12:05:00+00'
  ) RETURNING id INTO v_id_b;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar)
  VALUES (v_id_b, v_org, 'aprobado', 80000, timestamptz '2026-05-01 00:00:00+00', 80000);
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    idempotency_key, created_at, es_vigente
  ) VALUES (
    v_org, v_id_b, v_asesor, 'mejoravit', 'mejoravit', '99183000002',
    'P183 B pending', '5500000002', 'pendiente', 'aprobado', 80000,
    'p183-b-pend', timestamptz '2026-08-14 12:05:00+00', false
  ) RETURNING id INTO v_int_pend;
  UPDATE public.expedientes SET reprecalificacion_pendiente_id = v_int_pend WHERE id = v_id_b;

  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, 'P183', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert((v_page->'items'->0->>'cliente_nombre') = 'P183 B pending', 'B. pending sube #1');
  PERFORM public.__p183_assert((v_page->'items'->0->>'reprecal_estado') = 'pending', 'B. estado pending');
  PERFORM public.__p183_assert((v_page->'items'->0->>'monto_aprobado')::numeric = 80000, 'B. monto vigente');
  PERFORM public.__p183_assert(v_page->'items'->0->>'inbox_sort_at' IS NULL, 'B. sort key no en JSON');

  -- A. expediente nuevo sin reprecal → sort created_at (segundo si B pending)
  PERFORM public.__p183_assert((v_page->'items'->1->>'cliente_nombre') = 'P183 A nuevo', 'A. segundo por created_at');
  PERFORM public.__p183_assert(v_page->'items'->1->>'reprecal_estado' IS NULL, 'A. sin reprecal_estado');

  PERFORM public.__p183_reset_auth();

  -- C. pending reutilizado: renovar created_at
  UPDATE public.expediente_precalificacion_intentos
  SET created_at = timestamptz '2026-08-14 12:20:00+00'
  WHERE id = v_int_pend;
  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, '99183000002', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert(
    (v_page->'items'->0->>'reprecal_solicitada_at') LIKE '2026-08-14T12:20:00%',
    'C. created_at renovado'
  );
  PERFORM public.__p183_assert(
    (v_page->'items'->0->>'reprecal_activity_at')::timestamptz = timestamptz '2026-08-14 12:20:00+00',
    'C. activity = created_at'
  );

  -- D/E/F. editor aprueba re-precal
  PERFORM public.__p183_reset_auth();
  UPDATE public.expediente_precalificacion_intentos
  SET
    decision = 'aprobado',
    monto_aprobado = 95000,
    decided_at = timestamptz '2026-08-14 12:10:00+00',
    decided_by = v_editor,
    es_vigente = true
  WHERE id = v_int_pend;
  UPDATE public.expedientes SET reprecalificacion_pendiente_id = NULL, updated_at = timestamptz '2026-08-14 12:10:00+00' WHERE id = v_id_b;
  UPDATE public.editor_decisions
  SET monto_aprobado = 95000,
      aprobado_at = timestamptz '2026-08-14 12:10:00+00',
      monto_aprobado_al_aprobar = 95000
  WHERE expediente_id = v_id_b;

  -- C nuevo más tarde 12:15
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000003', 'P183 C nuevo',
    '5500000003', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-08-14 12:15:00+00', timestamptz '2026-08-14 12:15:00+00'
  ) RETURNING id INTO v_id_c;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_id_c, v_org, 'pendiente');

  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, 'P183', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert((v_page->'items'->0->>'cliente_nombre') = 'P183 C nuevo', 'ejemplo C primero 12:15');
  PERFORM public.__p183_assert((v_page->'items'->1->>'cliente_nombre') = 'P183 B pending', 'D. B por decided_at 12:10');
  PERFORM public.__p183_assert((v_page->'items'->1->>'reprecal_estado') = 'approved', 'D. approved');
  PERFORM public.__p183_assert((v_page->'items'->1->>'reprecal_monto_resultado')::numeric = 95000, 'E. monto nuevo');
  PERFORM public.__p183_assert((v_page->'items'->1->>'reprecal_monto_previo')::numeric = 80000, 'F. monto previo');
  PERFORM public.__p183_assert((v_page->'items'->1->>'monto_aprobado')::numeric = 95000, 'E. vigente editor');
  PERFORM public.__p183_assert((v_page->'items'->2->>'cliente_nombre') = 'P183 A nuevo', 'A al final del trio');

  -- G. no_cumple conserva monto vigente
  PERFORM public.__p183_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000007', 'P183 G nocumple',
    '5500000007', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-01-01 00:00:00+00', timestamptz '2026-08-14 13:00:00+00'
  ) RETURNING id INTO v_id_g;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar)
  VALUES (v_id_g, v_org, 'aprobado', 70000, timestamptz '2026-01-01 00:00:00+00', 70000);
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    monto_aprobado, idempotency_key, created_at, decided_at, es_vigente
  ) VALUES (
    v_org, v_id_g, v_asesor, 'mejoravit', 'mejoravit', '99183000007',
    'P183 G nocumple', '5500000007', 'no_cumple', 'aprobado', 70000,
    NULL, 'p183-g', timestamptz '2026-08-14 12:50:00+00', timestamptz '2026-08-14 13:00:00+00', false
  );
  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, 'G nocumple', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert((v_page->'items'->0->>'reprecal_estado') = 'no_cumple', 'G. estado');
  PERFORM public.__p183_assert((v_page->'items'->0->>'monto_aprobado')::numeric = 70000, 'G. monto vigente');
  PERFORM public.__p183_assert(v_page->'items'->0->>'reprecal_monto_resultado' IS NULL, 'G. sin monto resultado');
  PERFORM public.__p183_assert(
    (v_page->'items'->0->>'reprecal_activity_at')::timestamptz = timestamptz '2026-08-14 13:00:00+00',
    'G. sort decided_at'
  );

  -- H. snapshot histórico inicial NO es re-precal real
  PERFORM public.__p183_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000008', 'P183 H snapshot',
    '5500000008', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-08-14 11:00:00+00', timestamptz '2026-08-14 11:00:00+00'
  ) RETURNING id INTO v_id_h;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar)
  VALUES (v_id_h, v_org, 'aprobado', 40000, timestamptz '2026-08-14 11:00:00+00', 40000);
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, idempotency_key,
    created_at, decided_at, es_vigente, monto_aprobado
  ) VALUES (
    v_org, v_id_h, v_asesor, 'mejoravit', 'mejoravit', '99183000008',
    'P183 H snapshot', '5500000008', 'aprobado', NULL, NULL,
    timestamptz '2026-08-14 11:00:00+00', timestamptz '2026-08-14 11:00:00+00', true, 40000
  ) RETURNING id INTO v_int_snap;
  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, 'H snapshot', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert(v_page->'items'->0->>'reprecal_estado' IS NULL, 'H. snapshot no real');
  PERFORM public.__p183_assert(v_page->'items'->0->>'reprecal_activity_at' IS NULL, 'H. activity null');

  -- I. updated_at por operación NO altera orden vs A (A 12:00, I creado 2026-02, updated 12:30)
  PERFORM public.__p183_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000009', 'P183 I updated',
    '5500000009', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-02-01 00:00:00+00', timestamptz '2026-08-14 18:00:00+00'
  ) RETURNING id INTO v_id_i;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_id_i, v_org, 'pendiente');
  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, 'P183', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  SELECT array_agg(elem->>'cliente_nombre' ORDER BY ord)
  INTO v_ids
  FROM jsonb_array_elements(v_page->'items') WITH ORDINALITY AS t(elem, ord);
  PERFORM public.__p183_assert(
    array_position(v_ids, 'P183 A nuevo') < array_position(v_ids, 'P183 I updated'),
    'I. updated_at no sube sobre A'
  );

  -- J. dos re-precal históricas → última REAL
  PERFORM public.__p183_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000010', 'P183 J last',
    '5500000010', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2025-01-01 00:00:00+00', timestamptz '2026-08-14 14:00:00+00'
  ) RETURNING id INTO v_id_j;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (v_id_j, v_org, 'aprobado', 110000);
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    monto_aprobado, idempotency_key, created_at, decided_at, es_vigente
  ) VALUES (
    v_org, v_id_j, v_asesor, 'mejoravit', 'mejoravit', '99183000010',
    'P183 J last', '5500000010', 'aprobado', 'aprobado', 50000, 90000,
    'p183-j-old', timestamptz '2026-06-01 00:00:00+00', timestamptz '2026-06-01 01:00:00+00', false
  ) RETURNING id INTO v_int_old;
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    monto_aprobado, idempotency_key, created_at, decided_at, es_vigente
  ) VALUES (
    v_org, v_id_j, v_asesor, 'mejoravit', 'mejoravit', '99183000010',
    'P183 J last', '5500000010', 'aprobado', 'aprobado', 90000, 110000,
    'p183-j-new', timestamptz '2026-08-14 13:50:00+00', timestamptz '2026-08-14 14:00:00+00', true
  ) RETURNING id INTO v_int_new;
  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, 'J last', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert((v_page->'items'->0->>'reprecal_monto_resultado')::numeric = 110000, 'J. última');
  PERFORM public.__p183_assert((v_page->'items'->0->>'reprecal_monto_previo')::numeric = 90000, 'J. previo de última');

  -- K. pending actual gana sobre resolved anterior
  PERFORM public.__p183_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000011', 'P183 K pending wins',
    '5500000011', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2025-02-01 00:00:00+00', timestamptz '2026-08-14 15:00:00+00'
  ) RETURNING id INTO v_id_k;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (v_id_k, v_org, 'aprobado', 60000);
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    monto_aprobado, idempotency_key, created_at, decided_at, es_vigente
  ) VALUES (
    v_org, v_id_k, v_asesor, 'mejoravit', 'mejoravit', '99183000011',
    'P183 K pending wins', '5500000011', 'aprobado', 'aprobado', 50000, 60000,
    'p183-k-old', timestamptz '2026-07-01 00:00:00+00', timestamptz '2026-07-01 01:00:00+00', true
  );
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    idempotency_key, created_at, es_vigente
  ) VALUES (
    v_org, v_id_k, v_asesor, 'mejoravit', 'mejoravit', '99183000011',
    'P183 K pending wins', '5500000011', 'pendiente', 'aprobado', 60000,
    'p183-k-pend', timestamptz '2026-08-14 15:00:00+00', false
  ) RETURNING id INTO v_int_k;
  UPDATE public.expedientes SET reprecalificacion_pendiente_id = v_int_k WHERE id = v_id_k;
  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, 'K pending wins', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert((v_page->'items'->0->>'reprecal_estado') = 'pending', 'K. pending gana');
  PERFORM public.__p183_assert(v_page->'items'->0->>'reprecal_resuelta_at' IS NULL, 'K. resuelta null');
  PERFORM public.__p183_assert((v_page->'items'->0->>'monto_aprobado')::numeric = 60000, 'K. monto viejo vigente');

  -- L. mismo NSS, distintos expedientes (programas distintos, pre-Mesa)
  PERFORM public.__p183_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000012', 'P183 L mejoravit',
    '5500000012', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-03-01 00:00:00+00', timestamptz '2026-03-01 00:00:00+00'
  ) RETURNING id INTO v_id_l1;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'subcuenta', '99183000012', 'P183 L subcuenta',
    '5500000012', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2026-03-01 00:00:00+00', timestamptz '2026-03-01 00:00:00+00'
  ) RETURNING id INTO v_id_l2;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (v_id_l1, v_org, 'aprobado', 10000), (v_id_l2, v_org, 'aprobado', 20000);
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    monto_aprobado, idempotency_key, created_at, decided_at, es_vigente
  ) VALUES (
    v_org, v_id_l1, v_asesor, 'mejoravit', 'mejoravit', '99183000012',
    'P183 L mejoravit', '5500000012', 'aprobado', 'aprobado', 10000, 15000,
    'p183-l1', timestamptz '2026-08-14 16:00:00+00', timestamptz '2026-08-14 16:00:00+00', true
  );
  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, '99183000012', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert((v_page->>'total_count')::int = 2, 'L. dos expedientes');
  SELECT elem INTO v_item FROM jsonb_array_elements(v_page->'items') elem
  WHERE elem->>'cliente_nombre' = 'P183 L subcuenta';
  PERFORM public.__p183_assert(v_item->>'reprecal_estado' IS NULL, 'L. subcuenta independiente');
  SELECT elem INTO v_item FROM jsonb_array_elements(v_page->'items') elem
  WHERE elem->>'cliente_nombre' = 'P183 L mejoravit';
  PERFORM public.__p183_assert(v_item->>'reprecal_estado' = 'approved', 'L. mejoravit con reprecal');

  -- M. paginación: viejo re-precal entra page1 (25 dummies más viejos + M actividad ahora)
  PERFORM public.__p183_reset_auth();
  FOR v_i IN 1..30 LOOP
    INSERT INTO public.expedientes (
      id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
      origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at
    ) VALUES (
      gen_random_uuid(), v_org, v_asesor, 'mejoravit',
      lpad((99183100000 + v_i)::text, 11, '0'),
      'P183 PAD ' || lpad(v_i::text, 2, '0'),
      '5590000000', 'interno', 'activo', false, 1, 'pendiente',
      timestamptz '2024-01-01 00:00:00+00' + (v_i || ' minutes')::interval
    ) RETURNING id INTO v_id_pad;
    INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
    VALUES (v_id_pad, v_org, 'pendiente');
  END LOOP;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000013', 'P183 M page1',
    '5500000013', 'interno', 'activo', false, 1, 'pendiente',
    timestamptz '2023-01-01 00:00:00+00', timestamptz '2026-08-14 17:00:00+00'
  ) RETURNING id INTO v_id_m;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (v_id_m, v_org, 'aprobado', 30000);
  INSERT INTO public.expediente_precalificacion_intentos (
    organization_id, expediente_id, asesor_id, programa, programa_solicitado, nss,
    cliente_nombre, telefono_cliente, decision, decision_previa, monto_aprobado_previo,
    monto_aprobado, idempotency_key, created_at, decided_at, es_vigente
  ) VALUES (
    v_org, v_id_m, v_asesor, 'mejoravit', 'mejoravit', '99183000013',
    'P183 M page1', '5500000013', 'aprobado', 'aprobado', 20000, 30000,
    'p183-m', timestamptz '2026-08-14 17:00:00+00', timestamptz '2026-08-14 17:00:00+00', true
  );
  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, 'P183', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert((v_page->'items'->0->>'cliente_nombre') = 'P183 M page1', 'M. page1 first');
  PERFORM public.__p183_assert((v_page->>'has_more')::boolean = true, 'M. has_more');

  -- N. quick filters (bio)
  PERFORM public.__p183_reset_auth();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, ciclo_estado, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit', '99183000014', 'P183 N bio',
    '5500000014', 'interno', 'activo', true, now(), 3, 'en_proceso',
    timestamptz '2026-08-10 00:00:00+00'
  ) RETURNING id INTO v_id_n;
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (v_id_n, v_org, 'aprobado', 1);
  PERFORM public.__p183_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'agendar_biometricos');
  PERFORM public.__p183_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') x
      WHERE x->>'cliente_nombre' = 'P183 N bio'
    ),
    'N. quick bio'
  );

  -- O. buscar NSS
  v_page := public.asesor_list_expedientes_page(1, 25, '99183000013', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert((v_page->>'total_count')::int = 1, 'O. buscar NSS');
  PERFORM public.__p183_assert((v_page->'items'->0->>'cliente_nombre') = 'P183 M page1', 'O. item');

  -- P. aislamiento
  PERFORM public.__p183_set_auth(v_asesor2);
  v_page := public.asesor_list_expedientes_page(1, 25, 'P183', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos');
  PERFORM public.__p183_assert((v_page->>'total_count')::int = 0, 'P. otro asesor no ve inbox');

  PERFORM public.__p183_reset_auth();
  PERFORM public.__p183_cleanup();
  RAISE NOTICE 'P183 OK: A–P';
END;
$$;

DROP FUNCTION IF EXISTS public.__p183_cleanup();
DROP FUNCTION IF EXISTS public.__p183_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p183_reset_auth();
DROP FUNCTION IF EXISTS public.__p183_assert(BOOLEAN, TEXT);
