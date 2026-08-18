-- P191: expedientes terminales fuera de tareas accionables del asesor.
-- LOCAL / rollback al final. 0 Cloud writes.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p191_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P191 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p191_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p191_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p191_cleanup()
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agenda_bookings b
  USING public.expedientes e
  WHERE b.expediente_id = e.id
    AND (e.nss LIKE '99191%' OR e.cliente_nombre LIKE 'P191%');

  DELETE FROM public.expediente_documentos d
  USING public.expedientes e
  WHERE d.expediente_id = e.id
    AND (e.nss LIKE '99191%' OR e.cliente_nombre LIKE 'P191%');

  DELETE FROM public.cliente_datos cd
  USING public.expedientes e
  WHERE cd.expediente_id = e.id
    AND (e.nss LIKE '99191%' OR e.cliente_nombre LIKE 'P191%');

  DELETE FROM public.editor_decisions ed
  USING public.expedientes e
  WHERE ed.expediente_id = e.id
    AND (e.nss LIKE '99191%' OR e.cliente_nombre LIKE 'P191%');

  DELETE FROM public.action_log al
  USING public.expedientes e
  WHERE al.entity_id = e.id
    AND (e.nss LIKE '99191%' OR e.cliente_nombre LIKE 'P191%');

  IF to_regclass('public.expediente_paso_visual_transiciones') IS NOT NULL THEN
    DELETE FROM public.expediente_paso_visual_transiciones t
    USING public.expedientes e
    WHERE t.expediente_id = e.id
      AND (e.nss LIKE '99191%' OR e.cliente_nombre LIKE 'P191%');
  END IF;

  DELETE FROM public.expedientes e
  WHERE e.nss LIKE '99191%'
     OR e.cliente_nombre LIKE 'P191%';
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'asesor_inbox_es_accionable'
    AND pg_get_function_identity_arguments(p.oid) LIKE 'p_submitted_to_mesa boolean%';
  PERFORM public.__p191_assert(v_src IS NOT NULL, 'es_accionable 4-arg existe');
  PERFORM public.__p191_assert(position('asesor_inbox_resultado_real' in v_src) > 0, 'reusa resultado_real');
  PERFORM public.__p191_assert(position('cancelado' in v_src) > 0, 'excluye cancelado');
  PERFORM public.__p191_assert(position('rechazado_mesa' in v_src) > 0, 'excluye rechazado_mesa');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'asesor_inbox_pendiente_agendar_biometricos'
  LIMIT 1;
  PERFORM public.__p191_assert(position('asesor_inbox_es_accionable' in v_src) > 0, 'bio usa guard');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'asesor_inbox_pendiente_agendar_firma'
  LIMIT 1;
  PERFORM public.__p191_assert(position('asesor_inbox_es_accionable' in v_src) > 0, 'firma usa guard');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'asesor_inbox_pendiente_subir_acuse'
  LIMIT 1;
  PERFORM public.__p191_assert(position('asesor_inbox_es_accionable' in v_src) > 0, 'acuse usa guard');

  PERFORM public.__p191_assert(
    public.asesor_inbox_es_accionable(true, 'en_proceso', 'activo', 'aprobado'),
    '4-arg en_tramite accionable'
  );
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_es_accionable(true, 'en_proceso', 'cancelado', 'aprobado'),
    '4-arg cancelado no accionable'
  );
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_es_accionable(true, 'rechazado', 'activo', 'aprobado'),
    '4-arg rechazado_mesa no accionable'
  );
  PERFORM public.__p191_assert(
    public.asesor_inbox_resultado_real(true, 'en_proceso', 'cancelado', 'aprobado') = 'cancelado',
    'resultado_real cancelado intacto'
  );
  PERFORM public.__p191_assert(
    public.asesor_inbox_resultado_real(true, 'rechazado', 'activo', 'aprobado') = 'rechazado_mesa',
    'resultado_real rechazado_mesa intacto'
  );

  RAISE NOTICE 'P191 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000191';
  v_cnt UUID := '00000000-0000-4000-8001-000000000192';
  v_exp UUID;
  v_exp_c UUID;
  v_exp_r UUID;
  v_a UUID;
  v_b UUID;
  v_c UUID;
  v_page JSONB;
  v_sum JSONB;
  v_ids TEXT[];
BEGIN
  PERFORM public.__p191_cleanup();

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'p191-a@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_cnt, 'authenticated', 'authenticated', 'p191-cnt@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_asesor, v_org, 'p191-a@test.local', 'Asesor P191', 'asesor', 'interno', NULL, true),
    (v_cnt, v_org, 'p191-cnt@test.local', 'Asesor P191 CNT', 'asesor', 'interno', NULL, true)
  ON CONFLICT (id) DO UPDATE SET
    active = true, organization_id = EXCLUDED.organization_id, app_role = 'asesor';

  -- Test 1: bug real — cancelado etapa 3 sin booking → FALSE
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100001',
    'P191 Cancel Et3', '5519100001', '', 'interno', 'cancelado',
    true, now(), 3, 'en_proceso', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  PERFORM public.__p191_assert(
    public.asesor_inbox_resultado_real(true, 'en_proceso', 'cancelado', 'aprobado') = 'cancelado',
    't1 resultado_real=cancelado'
  );
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_es_accionable(v_exp),
    't1 no accionable'
  );
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_pendiente_agendar_biometricos(true, 3::smallint, v_exp),
    't1 agendar_biometricos FALSE (bug real)'
  );

  -- Test 2: etapa 3 normal en_tramite → TRUE
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100002',
    'P191 Bio Normal', '5519100002', '', 'interno', 'activo',
    true, now(), 3, 'en_proceso', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  PERFORM public.__p191_assert(
    public.asesor_inbox_resultado_real(true, 'en_proceso', 'activo', 'aprobado') = 'en_tramite',
    't2 en_tramite'
  );
  PERFORM public.__p191_assert(
    public.asesor_inbox_pendiente_agendar_biometricos(true, 3::smallint, v_exp),
    't2 agendar_biometricos TRUE'
  );

  -- Test 3: rechazado Mesa etapa 3 → bio FALSE; chip rechazados intacto
  v_exp_r := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp_r, v_org, v_asesor, 'mejoravit', '99191100003',
    'P191 Rech Mesa', '5519100003', '', 'interno', 'activo',
    true, now(), 3, 'rechazado', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp_r, v_org, 'aprobado');
  PERFORM public.__p191_assert(
    public.asesor_inbox_resultado_real(true, 'rechazado', 'activo', 'aprobado') = 'rechazado_mesa',
    't3 resultado_real=rechazado_mesa'
  );
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_pendiente_agendar_biometricos(true, 3::smallint, v_exp_r),
    't3 agendar_biometricos FALSE'
  );

  -- Test 4: reagendar bio válido etapa 4 en_tramite + último cancelled
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100004',
    'P191 Reagendar Bio', '5519100004', '', 'interno', 'activo',
    true, now(), 4, 'en_proceso', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, created_at
  ) VALUES (
    v_org, 'biometricos', v_exp, current_date - 2, '10:00:00',
    'sede-centro', 'cancelled', v_asesor, now() - interval '2 days'
  );
  PERFORM public.__p191_assert(
    public.asesor_inbox_pendiente_agendar_biometricos(true, 4::smallint, v_exp),
    't4 reagendar bio TRUE'
  );

  -- Test 5: mismo booking cancelled pero ciclo cancelado → FALSE
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100005',
    'P191 Cancel Et4', '5519100005', '', 'interno', 'cancelado',
    true, now(), 4, 'en_proceso', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, created_at
  ) VALUES (
    v_org, 'biometricos', v_exp, current_date - 2, '10:00:00',
    'sede-centro', 'cancelled', v_asesor, now() - interval '2 days'
  );
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_pendiente_agendar_biometricos(true, 4::smallint, v_exp),
    't5 cancelado etapa4 FALSE'
  );

  -- Test 6: firma etapa 9 en_tramite TRUE; cancelado/rechazado FALSE
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100006',
    'P191 Firma Normal', '5519100006', '', 'interno', 'activo',
    true, now(), 9, 'en_proceso', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  PERFORM public.__p191_assert(
    public.asesor_inbox_pendiente_agendar_firma(true, 9::smallint, v_exp),
    't6 firma en_tramite TRUE'
  );

  v_exp_c := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp_c, v_org, v_asesor, 'mejoravit', '99191100007',
    'P191 Firma Cancel', '5519100007', '', 'interno', 'cancelado',
    true, now(), 9, 'en_proceso', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp_c, v_org, 'aprobado');
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_pendiente_agendar_firma(true, 9::smallint, v_exp_c),
    't6 firma cancelado FALSE'
  );

  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100008',
    'P191 Firma Rech', '5519100008', '', 'interno', 'activo',
    true, now(), 9, 'rechazado', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_pendiente_agendar_firma(true, 9::smallint, v_exp),
    't6 firma rechazado_mesa FALSE'
  );

  -- Test 7: acuse etapa 8 en_tramite TRUE; cancelado/rechazado FALSE
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100009',
    'P191 Acuse Normal', '5519100009', '', 'interno', 'activo',
    true, now(), 8, 'en_proceso', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  PERFORM public.__p191_assert(
    public.asesor_inbox_pendiente_subir_acuse(true, 8::smallint, v_exp),
    't7 acuse en_tramite TRUE'
  );

  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100010',
    'P191 Acuse Cancel', '5519100010', '', 'interno', 'cancelado',
    true, now(), 8, 'en_proceso', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_pendiente_subir_acuse(true, 8::smallint, v_exp),
    't7 acuse cancelado FALSE'
  );

  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100011',
    'P191 Acuse Rech', '5519100011', '', 'interno', 'activo',
    true, now(), 8, 'rechazado', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  PERFORM public.__p191_assert(
    NOT public.asesor_inbox_pendiente_subir_acuse(true, 8::smallint, v_exp),
    't7 acuse rechazado_mesa FALSE'
  );

  -- Corrección documental NO es terminal: etapa 3 + correccion_requerida sigue bio TRUE
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99191100012',
    'P191 Corr Req Bio', '5519100012', '', 'interno', 'activo',
    true, now(), 3, 'en_proceso', now()
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp, v_org, '{}'::jsonb, 'rechazado');
  PERFORM public.__p191_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_requerida',
    'corr categoria intacta'
  );
  PERFORM public.__p191_assert(
    public.asesor_inbox_pendiente_agendar_biometricos(true, 3::smallint, v_exp),
    'corr no bloquea bio'
  );

  -- Counts: 1 cancelado etapa3 + 3 accionables etapa3 → chip 3, lista 3
  v_a := gen_random_uuid();
  v_b := gen_random_uuid();
  v_c := gen_random_uuid();
  v_exp_c := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES
    (v_a, v_org, v_cnt, 'mejoravit', '99191200001',
     'P191 CNT Bio A', '5519120001', '', 'interno', 'activo',
     true, now(), 3, 'en_proceso', now() + interval '1 hour'),
    (v_b, v_org, v_cnt, 'mejoravit', '99191200002',
     'P191 CNT Bio B', '5519120002', '', 'interno', 'activo',
     true, now(), 3, 'en_proceso', now() + interval '2 hours'),
    (v_c, v_org, v_cnt, 'mejoravit', '99191200003',
     'P191 CNT Bio C', '5519120003', '', 'interno', 'activo',
     true, now(), 3, 'en_proceso', now() + interval '3 hours'),
    (v_exp_c, v_org, v_cnt, 'mejoravit', '99191200004',
     'P191 CNT Cancel', '5519120004', '', 'interno', 'cancelado',
     true, now(), 3, 'en_proceso', now() + interval '4 hours');
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES
    (v_a, v_org, 'aprobado'),
    (v_b, v_org, 'aprobado'),
    (v_c, v_org, 'aprobado'),
    (v_exp_c, v_org, 'aprobado');

  PERFORM public.__p191_set_auth(v_cnt);
  v_sum := public.asesor_inbox_summary(10);
  PERFORM public.__p191_assert(
    (v_sum->'counts'->>'agendar_biometricos')::int = 3,
    'summary bio=3 no infla cancelado'
  );
  PERFORM public.__p191_assert(
    (v_sum->'counts'->>'cancelados')::int = 1,
    'chip cancelados=1 intacto'
  );

  v_page := public.asesor_list_expedientes_page(
    1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'agendar_biometricos'
  );
  PERFORM public.__p191_assert(
    (v_page->>'total_count')::int = 3,
    'lista bio total=3 (consistente con summary)'
  );
  PERFORM public.__p191_assert(
    jsonb_array_length(v_page->'items') = 3,
    'lista bio filas=3'
  );
  SELECT array_agg(x->>'cliente_nombre') INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p191_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') x
      WHERE x->>'cliente_nombre' = 'P191 CNT Cancel'
         OR x->>'resultado_real' = 'cancelado'
    ),
    'lista bio no incluye cancelado'
  );

  v_page := public.asesor_list_expedientes_page(
    1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'cancelados'
  );
  PERFORM public.__p191_assert(
    (v_page->>'total_count')::int = 1,
    'quick cancelados=1'
  );
  PERFORM public.__p191_assert(
    v_page->'items'->0->>'cliente_nombre' = 'P191 CNT Cancel',
    'cancelado sigue en chip Cancelados'
  );

  -- Rechazados por Mesa del asesor de fixtures (no CNT)
  PERFORM public.__p191_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(
    1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'rechazados_mesa'
  );
  PERFORM public.__p191_assert(
    (v_page->>'total_count')::int >= 1,
    'quick rechazados_mesa >=1'
  );
  PERFORM public.__p191_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') x
      WHERE x->>'cliente_nombre' = 'P191 Rech Mesa'
        AND x->>'resultado_real' = 'rechazado_mesa'
    ),
    'rechazado Mesa sigue en chip'
  );
  v_sum := public.asesor_inbox_summary(10);
  PERFORM public.__p191_assert(
    (v_sum->'counts'->>'rechazados_mesa')::int >= 1,
    'summary rechazados_mesa intacto'
  );

  -- Buscar cancelado por nombre sigue encontrándolo (no desaparece del dashboard)
  v_page := public.asesor_list_expedientes_page(
    1, 25, 'P191 Cancel Et3', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos'
  );
  PERFORM public.__p191_assert((v_page->>'total_count')::int = 1, 'buscar cancelado');

  PERFORM public.__p191_reset_auth();
  PERFORM public.__p191_cleanup();
  RAISE NOTICE 'P191 ALL PASSED';
END;
$$;

DROP FUNCTION public.__p191_cleanup();
DROP FUNCTION public.__p191_reset_auth();
DROP FUNCTION public.__p191_set_auth(UUID);
DROP FUNCTION public.__p191_assert(BOOLEAN, TEXT);
