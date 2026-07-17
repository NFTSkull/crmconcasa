-- P085 §16A/§17: sin asesor_email en contrato Mesa + paginación timeline
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p085t_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P085 TIMELINE FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p085t_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p085t_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8085-000000000101';
  v_asesor UUID := '00000000-0000-4000-8085-000000000102';
  v_admin UUID := '00000000-0000-4000-8085-000000000103';
  v_mesa UUID := '00000000-0000-4000-8085-000000000104';
  v_exp UUID := '00000000-0000-4000-9085-000000000101';
  v_exp_empty UUID := '00000000-0000-4000-9085-000000000102';
  v_exp_out UUID := '00000000-0000-4000-9085-000000000103';
  v_from TIMESTAMPTZ := timestamptz '2026-07-01 00:00:00+00';
  v_to TIMESTAMPTZ := timestamptz '2026-08-01 00:00:00+00';
  v_src TEXT;
  v_list JSONB;
  v_tl JSONB;
  v_tl2 JSONB;
  v_item JSONB;
  v_keys TEXT[];
  v_ids_page1 TEXT[];
  v_ids_page2 TEXT[];
  v_fail BOOLEAN;
  v_i INTEGER;
  v_ts TIMESTAMPTZ := timestamptz '2026-07-10 15:00:00+00';
BEGIN
  -- Estático: arquitectura page_ids + sin asesor_email en respuesta Mesa
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_list_mesa_envios_page'
  LIMIT 1;

  PERFORM public.__p085t_assert(v_src IS NOT NULL, 'listado existe');
  PERFORM public.__p085t_assert(position('v_page_ids' in v_src) > 0, 'usa v_page_ids');
  PERFORM public.__p085t_assert(position('unnest(v_page_ids)' in v_src) > 0, 'unnest page_ids');
  PERFORM public.__p085t_assert(
    position('''asesor_email''' in v_src) = 0
      AND position('asesor_email,' in v_src) = 0,
    'listado Mesa sin clave asesor_email en respuesta'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_get_expediente_mesa_timeline'
  LIMIT 1;

  PERFORM public.__p085t_assert(
    position('LEAST(100, GREATEST(1, coalesce(p_limit, 10)))' in v_src) > 0,
    'clamp limit 1–100 / NULL→10'
  );
  PERFORM public.__p085t_assert(
    position('GREATEST(0, coalesce(p_offset, 0))' in v_src) > 0,
    'clamp offset ≥0 / NULL→0'
  );
  PERFORM public.__p085t_assert(
    position('ORDER BY al.created_at DESC, al.id DESC' in v_src) > 0,
    'orden estable created_at+id'
  );
  PERFORM public.__p085t_assert(position('has_more' in v_src) > 0, 'has_more presente');
  PERFORM public.__p085t_assert(
    position('''asesor_email''' in v_src) = 0,
    'timeline sin asesor_email'
  );
  PERFORM public.__p085t_assert(
    position('''sort_id''' in v_src) = 0,
    'timeline no expone sort_id técnico'
  );

  INSERT INTO public.organizations (id, slug, name)
  VALUES (v_org, 'p085-tl-org', 'P085 Timeline Org')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor.p085t@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin.p085t@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_mesa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'mesa.p085t@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES
    (v_asesor, v_org, 'asesor.p085t@test.local', ' ', 'asesor', true),
    (v_admin, v_org, 'admin.p085t@test.local', 'Admin P085T', 'super_admin', true),
    (v_mesa, v_org, 'mesa.p085t@test.local', 'Mesa P085T', 'mesa_admin', true)
  ON CONFLICT (id) DO UPDATE
    SET active = true,
        organization_id = EXCLUDED.organization_id,
        app_role = EXCLUDED.app_role,
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email;

  -- Nombre en blanco → RPC debe devolver asesor_nombre null (UI: fallback)
  UPDATE public.profiles SET full_name = '   ' WHERE id = v_asesor;

  DELETE FROM public.action_log WHERE entity_id IN (v_exp, v_exp_empty, v_exp_out);
  DELETE FROM public.expedientes WHERE id IN (v_exp, v_exp_empty, v_exp_out);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '88508500001', 'Cliente Timeline', '8110000001',
     'interno', true, v_ts, 2, 'en_proceso', 'activo'),
    (v_exp_empty, v_org, v_asesor, 'mejoravit', '88508500002', 'Cliente Sin Eventos', '8110000002',
     'interno', true, v_ts + interval '1 hour', 2, 'en_proceso', 'activo'),
    (v_exp_out, v_org, v_asesor, 'mejoravit', '88508500003', 'Cliente No Mesa', '8110000003',
     'interno', false, NULL, 1, 'pendiente', 'activo');

  -- 12 eventos con timestamps idénticos en pares → desempate por id
  FOR v_i IN 1..12 LOOP
    INSERT INTO public.action_log (
      organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
    ) VALUES (
      v_org, v_mesa, 'mesa_admin',
      CASE WHEN v_i % 2 = 0 THEN 'documento.revision.update' ELSE 'mesa.expediente.take' END,
      'expediente', v_exp,
      jsonb_build_object(
        'tipo_documento', 'ine_reverso',
        'motivo', 'motivo seguro ' || v_i,
        'storage_path', '/secret/' || v_i,
        'actor_id', v_mesa::text
      ),
      v_ts + ((v_i + 1) / 2) * interval '1 minute'
    );
  END LOOP;

  PERFORM public.__p085t_set_auth(v_admin);

  -- Listado: sin correo aunque asesor sin nombre; clave ausente
  v_list := public.admin_list_mesa_envios_page(
    v_from, v_to, 1, 25, v_asesor, NULL, NULL, 'Cliente Timeline'
  );
  PERFORM public.__p085t_assert(
    (v_list->'items') IS NOT NULL AND jsonb_typeof(v_list->'items') = 'array',
    'listado items array'
  );
  PERFORM public.__p085t_assert(
    jsonb_array_length(v_list->'items') >= 1,
    'listado encuentra fixture Cliente Timeline'
  );
  SELECT array_agg(k ORDER BY k) INTO v_keys
  FROM jsonb_object_keys(coalesce(v_list->'items'->0, '{}'::jsonb)) AS k;
  PERFORM public.__p085t_assert(
    NOT ('asesor_email' = ANY (coalesce(v_keys, ARRAY[]::TEXT[]))),
    'JSON listado sin asesor_email'
  );
  PERFORM public.__p085t_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list->'items') it
      WHERE (it->>'expediente_id') = v_exp::text
        AND nullif(btrim(coalesce(it->>'asesor_nombre', '')), '') IS NULL
    ),
    'asesor sin nombre → null (UI aplica fallback)'
  );

  -- Clamps limit/offset
  v_tl := public.admin_get_expediente_mesa_timeline(v_exp, NULL, NULL);
  PERFORM public.__p085t_assert((v_tl->>'limit')::int = 10, 'NULL limit → 10');
  PERFORM public.__p085t_assert((v_tl->>'offset')::int = 0, 'NULL offset → 0');
  PERFORM public.__p085t_assert((v_tl->>'total_count')::int = 12, 'total_count=12');
  PERFORM public.__p085t_assert(jsonb_array_length(v_tl->'items') = 10, 'página default 10');
  PERFORM public.__p085t_assert((v_tl->>'has_more')::boolean IS TRUE, 'has_more true');

  v_tl := public.admin_get_expediente_mesa_timeline(v_exp, 0, -1);
  PERFORM public.__p085t_assert((v_tl->>'limit')::int = 1, 'limit 0 → 1');
  PERFORM public.__p085t_assert((v_tl->>'offset')::int = 0, 'offset -1 → 0');

  v_tl := public.admin_get_expediente_mesa_timeline(v_exp, -1, 0);
  PERFORM public.__p085t_assert((v_tl->>'limit')::int = 1, 'limit -1 → 1');

  v_tl := public.admin_get_expediente_mesa_timeline(v_exp, 1, 0);
  PERFORM public.__p085t_assert(jsonb_array_length(v_tl->'items') = 1, 'limit 1');

  v_tl := public.admin_get_expediente_mesa_timeline(v_exp, 100, 0);
  PERFORM public.__p085t_assert(jsonb_array_length(v_tl->'items') = 12, 'limit 100 cap datos');
  PERFORM public.__p085t_assert((v_tl->>'limit')::int = 100, 'limit 100');

  v_tl := public.admin_get_expediente_mesa_timeline(v_exp, 101, 0);
  PERFORM public.__p085t_assert((v_tl->>'limit')::int = 100, 'limit 101 → 100');

  -- Páginas sin solape / sin omisión
  v_tl := public.admin_get_expediente_mesa_timeline(v_exp, 5, 0);
  v_tl2 := public.admin_get_expediente_mesa_timeline(v_exp, 5, 5);
  SELECT array_agg(it->>'at' || '|' || (it->>'action') ORDER BY ordinality)
    INTO v_ids_page1
  FROM jsonb_array_elements(v_tl->'items') WITH ORDINALITY AS t(it, ordinality);
  SELECT array_agg(it->>'at' || '|' || (it->>'action') ORDER BY ordinality)
    INTO v_ids_page2
  FROM jsonb_array_elements(v_tl2->'items') WITH ORDINALITY AS t(it, ordinality);
  PERFORM public.__p085t_assert(
    cardinality(v_ids_page1) = 5 AND cardinality(v_ids_page2) = 5,
    'páginas 5+5'
  );
  PERFORM public.__p085t_assert(
    (v_tl->>'total_count')::int = (v_tl2->>'total_count')::int
      AND (v_tl->>'total_count')::int = 12,
    'total_count independiente del offset'
  );
  PERFORM public.__p085t_assert(
    (v_tl->>'has_more')::boolean IS TRUE
      AND (v_tl2->>'has_more')::boolean IS TRUE,
    'has_more páginas intermedias'
  );
  PERFORM public.__p085t_assert(
    NOT (v_ids_page1 && v_ids_page2),
    'páginas sin repetir eventos'
  );

  v_tl := public.admin_get_expediente_mesa_timeline(v_exp, 5, 10);
  PERFORM public.__p085t_assert(jsonb_array_length(v_tl->'items') = 2, 'última página 2');
  PERFORM public.__p085t_assert((v_tl->>'has_more')::boolean IS FALSE, 'has_more false final');

  v_tl := public.admin_get_expediente_mesa_timeline(v_exp, 10, 100);
  PERFORM public.__p085t_assert(
    jsonb_array_length(v_tl->'items') = 0
      AND (v_tl->>'total_count')::int = 12
      AND (v_tl->>'has_more')::boolean IS FALSE,
    'offset fuera de rango: vacío + count intacto'
  );

  -- Sin sort_id / sin email / summary allowlist
  v_item := (SELECT it FROM jsonb_array_elements(
    (public.admin_get_expediente_mesa_timeline(v_exp, 1, 0))->'items'
  ) it LIMIT 1);
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_item) AS k;
  PERFORM public.__p085t_assert(
    NOT ('sort_id' = ANY (v_keys)) AND NOT ('asesor_email' = ANY (v_keys)),
    'item sin sort_id ni asesor_email'
  );
  PERFORM public.__p085t_assert(
    (v_item->'summary' ? 'storage_path') IS NOT TRUE
      AND (v_item->'summary' ? 'actor_id') IS NOT TRUE,
    'summary sin secrets'
  );

  -- Expediente válido sin eventos
  v_tl := public.admin_get_expediente_mesa_timeline(v_exp_empty, 10, 0);
  PERFORM public.__p085t_assert(
    (v_tl->>'expediente_id') = v_exp_empty::text
      AND jsonb_array_length(v_tl->'items') = 0
      AND (v_tl->>'total_count')::int = 0
      AND (v_tl->>'has_more')::boolean IS FALSE,
    'sin eventos: header + vacío'
  );

  -- Inexistente / fuera de alcance → mismo error
  BEGIN
    PERFORM public.admin_get_expediente_mesa_timeline(
      '00000000-0000-4000-9085-000000000999'::uuid, 10, 0
    );
    v_fail := FALSE;
  EXCEPTION WHEN others THEN
    v_fail := TRUE;
  END;
  PERFORM public.__p085t_assert(v_fail, 'inexistente error controlado');

  BEGIN
    PERFORM public.admin_get_expediente_mesa_timeline(v_exp_out, 10, 0);
    v_fail := FALSE;
  EXCEPTION WHEN others THEN
    v_fail := TRUE;
  END;
  PERFORM public.__p085t_assert(v_fail, 'fuera de alcance = inexistente');

  PERFORM public.__p085t_reset_auth();
END;
$$;

DROP FUNCTION IF EXISTS public.__p085t_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p085t_reset_auth();
DROP FUNCTION IF EXISTS public.__p085t_assert(BOOLEAN, TEXT);
