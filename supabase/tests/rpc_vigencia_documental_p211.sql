-- Rewrite base P211 test for redesign: hard-gate in assert/RPCs, not trigger.
-- Clock/release still via trigger. BEGIN/ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_org UUID := gen_random_uuid();
  v_asesor UUID := gen_random_uuid();
  v_exp UUID;
  v_estado JSONB;
  v_started TIMESTAMPTZ;
  v_liberada TIMESTAMPTZ;
  v_today DATE := (timezone('America/Monterrey', now()))::date;
  v_etapa INT;
  v_dom UUID;
  v_edc UUID;
BEGIN
  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'P211 Org', 'p211-' || substr(v_org::text, 1, 8));

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'p211-asesor-' || substr(v_asesor::text,1,8) || '@test.local', crypt('x', gen_salt('bf')),
     now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES (v_asesor, v_org, 'p211-a@test.local', 'P211 Asesor', 'asesor', true);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit',
    lpad((floor(random()*1e10))::bigint::text, 11, '0'),
    'P211 Cliente', '5512110001', 'interno', true, now() - interval '10 days',
    2, 'en_proceso', 'activo'
  ) RETURNING id INTO v_exp;

  UPDATE public.expedientes SET etapa_actual = 3 WHERE id = v_exp;
  SELECT vigencia_documental_started_at INTO v_started FROM public.expedientes WHERE id = v_exp;
  IF v_started IS NULL THEN RAISE EXCEPTION 'T1 fail'; END IF;

  UPDATE public.expedientes SET cliente_nombre = 'edit', updated_at = now() WHERE id = v_exp;
  IF (SELECT vigencia_documental_started_at FROM public.expedientes WHERE id = v_exp) IS DISTINCT FROM v_started THEN
    RAISE EXCEPTION 'T9 fail';
  END IF;

  PERFORM pg_sleep(0.05);
  UPDATE public.expedientes SET etapa_actual = 4 WHERE id = v_exp;
  UPDATE public.expedientes SET etapa_actual = 3 WHERE id = v_exp;
  UPDATE public.expedientes SET etapa_actual = 5 WHERE id = v_exp;
  UPDATE public.expedientes SET etapa_actual = 6 WHERE id = v_exp;
  UPDATE public.expedientes SET etapa_actual = 7 WHERE id = v_exp;
  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_exp;
  IF (SELECT vigencia_documental_started_at FROM public.expedientes WHERE id = v_exp) IS DISTINCT FROM v_started THEN
    RAISE EXCEPTION 'T2-T7 fail';
  END IF;

  UPDATE public.expedientes
  SET vigencia_documental_started_at = (v_today - 45)::timestamp AT TIME ZONE 'America/Monterrey',
      etapa_actual = 4
  WHERE id = v_exp;
  v_estado := public.expediente_vigencia_documental_estado(v_exp);
  IF coalesce((v_estado->>'vencido')::boolean, true) THEN RAISE EXCEPTION 'T13 fail'; END IF;

  UPDATE public.expedientes
  SET vigencia_documental_started_at = (v_today - 46)::timestamp AT TIME ZONE 'America/Monterrey'
  WHERE id = v_exp;
  v_estado := public.expediente_vigencia_documental_estado(v_exp);
  IF coalesce((v_estado->>'vencido')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'T14 fail'; END IF;

  FOREACH v_etapa IN ARRAY ARRAY[3,4,5,6,7,8]::int[] LOOP
    UPDATE public.expedientes SET etapa_actual = v_etapa WHERE id = v_exp;
    BEGIN
      PERFORM public.assert_expediente_vigencia_documental_ok(v_exp);
      RAISE EXCEPTION 'T24-29 fail etapa %', v_etapa;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VIGENCIA_DOCUMENTAL_REINGRESO_REQUERIDO%' THEN
        RAISE EXCEPTION 'T24-29 unexpected %: %', v_etapa, SQLERRM;
      END IF;
    END;
  END LOOP;

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, uploaded_by, uploaded_by_role, created_at
  ) VALUES
    (v_org, v_exp, 'cliente_comprobante_domicilio', v_org::text||'/'||v_exp::text||'/dom.pdf',
     'dom.pdf', 'application/pdf', 100, v_asesor, 'asesor', now()),
    (v_org, v_exp, 'cliente_estado_cuenta', v_org::text||'/'||v_exp::text||'/edc.pdf',
     'edc.pdf', 'application/pdf', 100, v_asesor, 'asesor', now());

  v_estado := public.expediente_vigencia_documental_estado(v_exp);
  IF coalesce((v_estado->>'docs_frescos_completos')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'T20 fail %', v_estado;
  END IF;

  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_exp;
  UPDATE public.expedientes SET etapa_actual = 9 WHERE id = v_exp;
  SELECT vigencia_documental_liberada_at INTO v_liberada FROM public.expedientes WHERE id = v_exp;
  IF v_liberada IS NULL THEN RAISE EXCEPTION 'T36 fail'; END IF;

  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_exp;
  v_estado := public.expediente_vigencia_documental_estado(v_exp);
  IF coalesce((v_estado->>'applicable')::boolean, false) OR coalesce(v_estado->>'reason','') <> 'already_released' THEN
    RAISE EXCEPTION 'T42 fail %', v_estado;
  END IF;

  -- T8 reentry
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit',
    lpad((floor(random()*1e10))::bigint::text, 11, '0'),
    'P211 Cliente2', '5512110002', 'interno', true, now() - interval '5 days',
    2, 'en_proceso', 'activo'
  ) RETURNING id INTO v_exp;
  UPDATE public.expedientes SET etapa_actual = 3 WHERE id = v_exp;
  SELECT vigencia_documental_started_at INTO v_started FROM public.expedientes WHERE id = v_exp;
  PERFORM pg_sleep(0.05);
  UPDATE public.expedientes SET etapa_actual = 2 WHERE id = v_exp;
  PERFORM pg_sleep(0.05);
  UPDATE public.expedientes SET etapa_actual = 3 WHERE id = v_exp;
  IF (SELECT vigencia_documental_started_at FROM public.expedientes WHERE id = v_exp) IS NOT DISTINCT FROM v_started THEN
    RAISE EXCEPTION 'T8 fail';
  END IF;

  RAISE NOTICE 'P211 base certification PASS';
END;
$$;

ROLLBACK;
