-- ConCasa CRM — P169: reprecal / cambio programa PRE-MESA (extiende P168)
-- Uso: psql -f supabase/tests/rpc_asesor_reprecal_pre_mesa_p169.sql
-- Regresión post-Mesa: supabase/tests/rpc_asesor_reprecalificar_nss_propio_mesa.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p169_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P169 TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p169_set_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p169_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p169_cleanup(p_nss TEXT)
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nss TEXT := public.normalize_nss_mexico(p_nss);
BEGIN
  UPDATE public.expedientes e
  SET reprecalificacion_pendiente_id = NULL
  WHERE e.nss = v_nss;
  DELETE FROM public.expediente_precalificacion_intentos i
  USING public.expedientes e
  WHERE i.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.cliente_datos cd
  USING public.expedientes e
  WHERE cd.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.editor_decisions ed
  USING public.expedientes e
  WHERE ed.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expediente_documentos d
  USING public.expedientes e
  WHERE d.expediente_id = e.id AND e.nss = v_nss;
  IF to_regclass('public.expediente_paso_visual_transiciones') IS NOT NULL THEN
    DELETE FROM public.expediente_paso_visual_transiciones t
    USING public.expedientes e
    WHERE t.expediente_id = e.id AND e.nss = v_nss;
  END IF;
  DELETE FROM public.action_log a
  USING public.expedientes e
  WHERE a.entity_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expedientes e WHERE e.nss = v_nss;
END; $$;

CREATE OR REPLACE FUNCTION public.__p169_insert_activo_dup(
  p_org UUID, p_asesor UUID, p_nss TEXT, p_programa public.programa, p_mesa BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_sub public.operativo_subestado;
BEGIN
  IF p_mesa THEN
    v_sub := 'en_validacion_mesa';
  ELSE
    v_sub := 'pendiente';
  END IF;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    gen_random_uuid(), p_org, p_asesor, p_programa, public.normalize_nss_mexico(p_nss),
    'Dup P169', '5599999999',
    'interno',
    p_mesa,
    CASE WHEN p_mesa THEN now() ELSE NULL END,
    1,
    v_sub,
    'activo'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9169-000000000001';
  v_asesor_a UUID := '00000000-0000-4000-9169-000000000011';
  v_asesor_b UUID := '00000000-0000-4000-9169-000000000012';
  v_editor UUID := '00000000-0000-4000-9169-000000000013';
  v_nss TEXT := '99116900001';
  v_nss2 TEXT := '99116900002';
  v_nss3 TEXT := '99116900003';
  v_exp UUID;
  v_exp2 UUID;
  v_gate JSONB;
  v_ini JSONB;
  v_ini2 JSONB;
  v_res JSONB;
  v_intento UUID;
  v_prev_monto NUMERIC := 42805.49;
  v_etapa INT;
  v_subestado public.operativo_subestado;
  v_submitted BOOLEAN;
  v_fecha_mesa TIMESTAMPTZ;
  v_programa public.programa;
  v_count_exp INT;
  v_docs_before INT;
  v_docs_after INT;
  v_cd_before JSONB;
  v_cd_after JSONB;
  v_ed_monto NUMERIC;
  v_ed_decision public.editor_decision;
BEGIN
  PERFORM public.__p169_reset_auth();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p169-reprecal-pre-mesa-org', 'P169 Reprecal Pre-Mesa Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true, slug = EXCLUDED.slug, name = EXCLUDED.name;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor_a, 'authenticated', 'authenticated', 'p169-asesor-a@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor_b, 'authenticated', 'authenticated', 'p169-asesor-b@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'p169-editor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_asesor_a, v_org, 'p169-asesor-a@test.local', 'Asesor P169 A', 'asesor', 'interno', NULL, true),
    (v_asesor_b, v_org, 'p169-asesor-b@test.local', 'Asesor P169 B', 'asesor', 'interno', NULL, true),
    (v_editor, v_org, 'p169-editor@test.local', 'Editor P169', 'editor', NULL, NULL, true)
  ON CONFLICT (id) DO UPDATE SET
    active = true,
    organization_id = EXCLUDED.organization_id,
    app_role = EXCLUDED.app_role;

  PERFORM public.__p169_cleanup(v_nss);
  PERFORM public.__p169_cleanup(v_nss2);
  PERFORM public.__p169_cleanup(v_nss3);

  -- -------------------------------------------------------------------------
  -- Setup: expediente propio PRE-MESA + decisión aprobada + datos
  -- -------------------------------------------------------------------------
  PERFORM public.__p169_set_auth(v_asesor_a);
  SELECT public.create_expediente('mejoravit', v_nss, 'Cliente P169', '5512345678', '') INTO v_res;
  v_exp := (v_res->>'id')::UUID;
  PERFORM public.__p169_reset_auth();

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado, aprobado_at, monto_aprobado_al_aprobar)
  VALUES (v_exp, v_org, 'aprobado', v_prev_monto, now(), v_prev_monto)
  ON CONFLICT (expediente_id) DO UPDATE
  SET decision = 'aprobado', monto_aprobado = v_prev_monto, aprobado_at = now(), monto_aprobado_al_aprobar = v_prev_monto;

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    v_exp, v_org, '{"nombreCliente":"Cliente P169","curp":"XEXX010101HNEXXXA8"}'::jsonb,
    'completo', 10, 4280.55, 'transferencia'
  ) ON CONFLICT (expediente_id) DO NOTHING;

  -- Asegurar PRE-MESA (origen_mesa NOT NULL en algunos entornos locales)
  UPDATE public.expedientes
  SET submitted_to_mesa = false,
      fecha_envio_mesa = NULL,
      etapa_actual = 1,
      subestado = 'pendiente',
      ciclo_estado = 'activo'
  WHERE id = v_exp;

  SELECT etapa_actual, subestado, submitted_to_mesa, fecha_envio_mesa, programa
  INTO v_etapa, v_subestado, v_submitted, v_fecha_mesa, v_programa
  FROM public.expedientes WHERE id = v_exp;

  SELECT count(*) INTO v_docs_before FROM public.expediente_documentos WHERE expediente_id = v_exp;
  SELECT datos INTO v_cd_before FROM public.cliente_datos WHERE expediente_id = v_exp;

  PERFORM public.__p169_assert(v_submitted = false, 'setup pre-mesa');
  PERFORM public.__p169_assert(v_programa = 'mejoravit', 'setup programa mejoravit');

  -- 1) pre-Mesa propio mismo programa → permitido
  PERFORM public.__p169_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'mejoravit');
  PERFORM public.__p169_assert(v_gate->>'status' = 'reprecal_own_mesa', '1 gate own pre-mesa');
  PERFORM public.__p169_assert((v_gate->>'expediente_id')::UUID = v_exp, '1 mismo expediente');

  -- 2) pre-Mesa propio cambio programa → permitido
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'compro_tu_casa');
  PERFORM public.__p169_assert(v_gate->>'status' = 'reprecal_change_programa', '2 gate change pre-mesa');
  PERFORM public.__p169_assert(v_gate->>'programa_actual' = 'mejoravit', '2 programa_actual');
  PERFORM public.__p169_assert(v_gate->>'programa_solicitado' = 'compro_tu_casa', '2 solicitado');

  -- 3+11+12) iniciar mismo programa: no 2.º exp; idempotency; reuso pending
  v_ini := public.asesor_iniciar_reprecalificacion(
    v_nss, 'mejoravit', 'Cliente P169 Re', '5512345678', 'Calle 1', 'idem-p169-1'
  );
  PERFORM public.__p169_assert((v_ini->>'expediente_id')::UUID = v_exp, '3 mismo exp iniciar');
  v_intento := (v_ini->>'intento_id')::UUID;
  PERFORM public.__p169_assert(v_ini->>'status' = 'reprecal_pending', '3 pending');

  v_ini2 := public.asesor_iniciar_reprecalificacion(
    v_nss, 'mejoravit', 'Cliente P169 Re', '5512345678', 'Calle 1', 'idem-p169-1'
  );
  PERFORM public.__p169_assert((v_ini2->>'intento_id')::UUID = v_intento, '11 idempotent intento');
  PERFORM public.__p169_assert(COALESCE((v_ini2->>'idempotent')::BOOLEAN, false) = true, '11 idempotent flag');

  -- Reuso pending (nueva key, mismo pending pointer)
  v_ini2 := public.asesor_iniciar_reprecalificacion(
    v_nss, 'mejoravit', 'Cliente P169 Re2', '5512345678', 'Calle 1', 'idem-p169-2'
  );
  PERFORM public.__p169_assert((v_ini2->>'intento_id')::UUID = v_intento, '12 reusa pending');

  PERFORM public.__p169_reset_auth();
  SELECT count(*) INTO v_count_exp FROM public.expedientes WHERE nss = v_nss AND deleted_at IS NULL;
  PERFORM public.__p169_assert(v_count_exp = 1, '3 un solo expediente');

  -- 4-7+19) pending conserva submitted_to_mesa=false, etapa, monto, programa
  PERFORM public.__p169_assert(
    (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp) = false,
    '4 submitted_to_mesa false'
  );
  PERFORM public.__p169_assert(
    (SELECT fecha_envio_mesa FROM public.expedientes WHERE id = v_exp) IS NULL,
    '4 fecha_envio_mesa null'
  );
  PERFORM public.__p169_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp) = v_etapa,
    '5 etapa intacta'
  );
  PERFORM public.__p169_assert(
    (SELECT subestado FROM public.expedientes WHERE id = v_exp) = v_subestado,
    '5 subestado intacto'
  );
  PERFORM public.__p169_assert(
    (SELECT monto_aprobado FROM public.editor_decisions WHERE expediente_id = v_exp) = v_prev_monto,
    '6 monto vigente intacto pending'
  );
  PERFORM public.__p169_assert(
    (SELECT programa FROM public.expedientes WHERE id = v_exp) = 'mejoravit',
    '7 programa vigente intacto'
  );

  -- 20) docs / cliente_datos no tocados
  SELECT count(*) INTO v_docs_after FROM public.expediente_documentos WHERE expediente_id = v_exp;
  SELECT datos INTO v_cd_after FROM public.cliente_datos WHERE expediente_id = v_exp;
  PERFORM public.__p169_assert(v_docs_after = v_docs_before, '20 docs count');
  PERFORM public.__p169_assert(v_cd_after = v_cd_before, '20 cliente_datos intactos');

  -- 8) aprobar mismo programa → solo monto
  PERFORM public.__p169_set_auth(v_editor);
  v_res := public.upsert_editor_decision(v_exp, 'aprobado', 50000, 'reprecal pre-mesa ok');
  SELECT decision, monto_aprobado INTO v_ed_decision, v_ed_monto
  FROM public.editor_decisions WHERE expediente_id = v_exp;
  PERFORM public.__p169_assert(v_ed_decision = 'aprobado', '8 decision');
  PERFORM public.__p169_assert(v_ed_monto = 50000, '8 monto nuevo');
  PERFORM public.__p169_assert(
    (SELECT programa FROM public.expedientes WHERE id = v_exp) = 'mejoravit',
    '8 programa no cambia'
  );
  PERFORM public.__p169_assert(
    (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp) = false,
    '19 submitted tras aprobar same'
  );

  -- -------------------------------------------------------------------------
  -- Cambio de programa PRE-MESA (caso 2 / 9 / 10)
  -- -------------------------------------------------------------------------
  PERFORM public.__p169_set_auth(v_asesor_a);
  v_ini := public.asesor_iniciar_reprecalificacion(
    v_nss, 'compro_tu_casa', 'Cliente P169 Cambio', '5512345678', '', 'idem-p169-chg-1'
  );
  PERFORM public.__p169_assert((v_ini->>'expediente_id')::UUID = v_exp, 'cambio mismo exp');
  PERFORM public.__p169_assert(COALESCE((v_ini->>'cambio_programa')::BOOLEAN, false) = true, 'cambio flag');
  PERFORM public.__p169_assert(
    (SELECT programa FROM public.expedientes WHERE id = v_exp) = 'mejoravit',
    'pending conserva programa mejoravit'
  );
  PERFORM public.__p169_assert(
    (SELECT monto_aprobado FROM public.editor_decisions WHERE expediente_id = v_exp) = 50000,
    'pending conserva monto post-8'
  );
  PERFORM public.__p169_assert(
    (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp) = false,
    'pending cambio submitted false'
  );

  -- 10) no_cumple conserva programa+monto
  PERFORM public.__p169_set_auth(v_editor);
  v_res := public.upsert_editor_decision(v_exp, 'no_cumple', NULL, 'no cumple cambio');
  PERFORM public.__p169_assert(
    (SELECT programa FROM public.expedientes WHERE id = v_exp) = 'mejoravit',
    '10 programa tras no_cumple'
  );
  PERFORM public.__p169_assert(
    (SELECT monto_aprobado FROM public.editor_decisions WHERE expediente_id = v_exp) = 50000,
    '10 monto tras no_cumple'
  );
  PERFORM public.__p169_assert(
    (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp) = false,
    '19 submitted tras no_cumple'
  );

  -- 9) aprobar cambio → programa+monto
  PERFORM public.__p169_set_auth(v_asesor_a);
  v_ini := public.asesor_iniciar_reprecalificacion(
    v_nss, 'compro_tu_casa', 'Cliente P169 Cambio2', '5512345678', '', 'idem-p169-chg-2'
  );
  PERFORM public.__p169_set_auth(v_editor);
  v_res := public.upsert_editor_decision(v_exp, 'aprobado', 61000, 'aprueba cambio pre-mesa');
  PERFORM public.__p169_assert(
    (SELECT programa FROM public.expedientes WHERE id = v_exp) = 'compro_tu_casa',
    '9 programa actualizado'
  );
  PERFORM public.__p169_assert(
    (SELECT monto_aprobado FROM public.editor_decisions WHERE expediente_id = v_exp) = 61000,
    '9 monto actualizado'
  );
  PERFORM public.__p169_assert(
    (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp) = false,
    '19 submitted tras aprobar cambio'
  );
  PERFORM public.__p169_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp) = v_etapa,
    'etapa intacta tras ciclo completo'
  );

  -- 13) P179: otro asesor pre-Mesa → ok_create (NO blocked_other_asesor)
  PERFORM public.__p169_cleanup(v_nss2);
  PERFORM public.__p169_set_auth(v_asesor_a);
  SELECT public.create_expediente('mejoravit', v_nss2, 'Cliente P169 B', '5511111111', '') INTO v_res;
  v_exp2 := (v_res->>'id')::UUID;
  PERFORM public.__p169_reset_auth();
  UPDATE public.expedientes SET submitted_to_mesa = false, ciclo_estado = 'activo' WHERE id = v_exp2;
  PERFORM public.__p169_set_auth(v_asesor_b);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss2, 'mejoravit');
  PERFORM public.__p169_assert(v_gate->>'status' = 'ok_create', '13 other asesor pre-mesa → ok_create (P179)');
  BEGIN
    PERFORM public.asesor_iniciar_reprecalificacion(v_nss2, 'mejoravit', 'X', '5511111111', '', 'k-b');
    PERFORM public.__p169_assert(false, '13 B no inicia reprecal ajeno');
  EXCEPTION WHEN OTHERS THEN
    -- Gate ok_create → iniciar rechaza (solo reprecal_*)
    PERFORM public.__p169_assert(position('precalificación' IN SQLERRM) > 0 OR position('no permitido' IN SQLERRM) > 0 OR position('Puedes crear' IN SQLERRM) > 0, '13 iniciar no reprecal');
  END;

  -- 14) P179: varios pre-Mesa del mismo asesor → reprecal_own (NO ambiguous)
  PERFORM public.__p169_cleanup(v_nss3);
  PERFORM public.__p169_set_auth(v_asesor_a);
  SELECT public.create_expediente('mejoravit', v_nss3, 'Amb1', '5522222222', '') INTO v_res;
  v_exp2 := (v_res->>'id')::UUID;
  PERFORM public.__p169_reset_auth();
  UPDATE public.expedientes SET submitted_to_mesa = false WHERE id = v_exp2;
  PERFORM public.__p169_insert_activo_dup(v_org, v_asesor_a, v_nss3, 'mejoravit', false);
  PERFORM public.__p169_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss3, 'mejoravit');
  PERFORM public.__p169_assert(v_gate->>'status' = 'reprecal_own_mesa', '14 multi pre-mesa → own reprecal (P179)');
  PERFORM public.__p169_assert(v_gate->>'status' IS DISTINCT FROM 'blocked_ambiguous', '14 not ambiguous');

  -- 8b) cancelado / deleted no cuentan como activo reutilizable
  PERFORM public.__p169_cleanup(v_nss2);
  PERFORM public.__p169_set_auth(v_asesor_a);
  SELECT public.create_expediente('mejoravit', v_nss2, 'Cancel', '5533333333', '') INTO v_res;
  v_exp2 := (v_res->>'id')::UUID;
  PERFORM public.__p169_reset_auth();
  UPDATE public.expedientes SET submitted_to_mesa = false, ciclo_estado = 'cancelado' WHERE id = v_exp2;
  PERFORM public.__p169_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss2, 'mejoravit');
  PERFORM public.__p169_assert(v_gate->>'status' = 'ok_create', 'cancelado → ok_create');

  PERFORM public.__p169_reset_auth();
  UPDATE public.expedientes SET ciclo_estado = 'activo', deleted_at = now() WHERE id = v_exp2;
  PERFORM public.__p169_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss2, 'mejoravit');
  PERFORM public.__p169_assert(v_gate->>'status' = 'ok_create', 'deleted → ok_create');

  -- 17) gate NO ok_create para propio activo → /asesor/nueva no debe create
  PERFORM public.__p169_set_auth(v_asesor_a);
  v_gate := public.asesor_lookup_nss_precal_gate(v_nss, 'compro_tu_casa');
  PERFORM public.__p169_assert(v_gate->>'status' = 'reprecal_own_mesa', '17 no ok_create propio activo');
  PERFORM public.__p169_assert(v_gate->>'status' IS DISTINCT FROM 'ok_create', '17 no create');

  -- Cleanup
  PERFORM public.__p169_reset_auth();
  PERFORM public.__p169_cleanup(v_nss);
  PERFORM public.__p169_cleanup(v_nss2);
  PERFORM public.__p169_cleanup(v_nss3);

  RAISE NOTICE 'P169 pre-mesa tests PASSED';
END;
$$;

DROP FUNCTION IF EXISTS public.__p169_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p169_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p169_reset_auth();
DROP FUNCTION IF EXISTS public.__p169_cleanup(TEXT);
DROP FUNCTION IF EXISTS public.__p169_insert_activo_dup(UUID, UUID, TEXT, public.programa, BOOLEAN);
