-- ConCasa CRM — scope equipo documentos asesor (mig 20260903140000)
-- Aislamiento: RPC register + Storage helpers. 4 tipos. Fail-closed 0 equipos.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__dts_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'DOC SCOPE EQUIPO TEST FAIL: %', p_msg; END IF;
  RAISE NOTICE 'PASS: %', p_msg;
END; $$;

CREATE OR REPLACE FUNCTION public.__dts_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__dts_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__dts_storage_path(
  p_org UUID, p_exp UUID, p_tipo TEXT, p_suffix TEXT DEFAULT 'v1.pdf'
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/' || p_tipo || '/' || p_suffix;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_leader UUID := gen_random_uuid();
  v_member UUID := gen_random_uuid();
  v_out UUID := gen_random_uuid();
  v_team UUID;
  v_exp_member UUID;
  v_exp_out UUID;
  v_path TEXT;
  v_tipo TEXT;
  v_ok BOOLEAN;
  v_allowed BOOLEAN;
  v_opc TEXT[];
  v_upload TEXT[];
  v_tipos TEXT[] := ARRAY[
    'cliente_solicitud_credito',
    'cliente_lista_nominal',
    'cliente_bajo_protesta',
    'cliente_presupuesto'
  ];
  v_email_test TEXT := 'dts-leader@test.local';
  v_email_prod TEXT := 'silvia.reyes@concasa.mx';
BEGIN
  DELETE FROM public.expedientes WHERE nss IN ('90601000011', '90601000012');
  DELETE FROM public.asesor_equipo_miembros
  WHERE team_id IN (SELECT id FROM public.asesor_equipos WHERE nombre = 'DTS Test Team');
  DELETE FROM public.asesor_equipos WHERE nombre = 'DTS Test Team';
  DELETE FROM public.profiles WHERE email IN (
    'dts-leader@test.local', 'dts-member@test.local', 'dts-out@test.local'
  );

  v_opc := public.integration_doc_tipos_asesor_opcionales();
  v_upload := public.integration_doc_tipos_asesor_upload();

  FOREACH v_tipo IN ARRAY v_tipos LOOP
    PERFORM public.__dts_assert(v_tipo = ANY(v_opc), v_tipo || ' en opcionales');
    PERFORM public.__dts_assert(v_tipo = ANY(v_upload), v_tipo || ' en upload');
    PERFORM public.__dts_assert(
      NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_envio())),
      v_tipo || ' NO en envio'
    );
    IF to_regprocedure('public.integration_doc_tipos_mesa_upload()') IS NOT NULL THEN
      PERFORM public.__dts_assert(
        NOT (v_tipo = ANY(public.integration_doc_tipos_mesa_upload())),
        v_tipo || ' NO en mesa_upload'
      );
    END IF;
  END LOOP;

  PERFORM public.__dts_assert(
    cardinality(v_opc) = 13 AND cardinality(v_upload) = 17,
    format('cardinalidad opc=%s upload=%s', cardinality(v_opc), cardinality(v_upload))
  );
  PERFORM public.__dts_assert(
    NOT ('cliente_solicitud' = ANY(v_opc)),
    'Mesa cliente_solicitud no en opcionales asesor'
  );
  PERFORM public.__dts_assert(
    EXISTS (
      SELECT 1 FROM public.documento_tipo_scope_equipo s
      WHERE s.tipo_documento = 'cliente_lista_nominal'
        AND lower(s.leader_email) = v_email_prod
        AND s.active
    ),
    'seed leader_email Silvia'
  );

  UPDATE public.documento_tipo_scope_equipo
  SET leader_email = v_email_test
  WHERE tipo_documento = ANY(v_tipos);

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_leader, v_org, v_email_test, 'DTS Leader', 'asesor', 'interno', true),
    (v_member, v_org, 'dts-member@test.local', 'DTS Member', 'asesor', 'interno', true),
    (v_out, v_org, 'dts-out@test.local', 'DTS Out', 'asesor', 'interno', true);

  INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
  VALUES (gen_random_uuid(), v_org, 'DTS Test Team', v_leader, true)
  RETURNING id INTO v_team;

  INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active) VALUES
    (v_team, v_leader, true),
    (v_team, v_member, true);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES
    (gen_random_uuid(), v_org, v_member, 'mejoravit', '90601000011', 'DTS Member Exp',
     '5599000001', 'interno', false, 1, 'pendiente', 'activo'),
    (gen_random_uuid(), v_org, v_out, 'mejoravit', '90601000012', 'DTS Out Exp',
     '5599000002', 'interno', false, 1, 'pendiente', 'activo');

  SELECT id INTO v_exp_member FROM public.expedientes WHERE nss = '90601000011' LIMIT 1;
  SELECT id INTO v_exp_out FROM public.expedientes WHERE nss = '90601000012' LIMIT 1;

  PERFORM public.__dts_assert(
    public.asesor_puede_usar_tipo_documento(v_member, 'cliente_lista_nominal') IS TRUE,
    'helper miembro scoped TRUE'
  );
  PERFORM public.__dts_assert(
    public.asesor_puede_usar_tipo_documento(v_leader, 'cliente_presupuesto') IS TRUE,
    'helper líder scoped TRUE'
  );
  PERFORM public.__dts_assert(
    public.asesor_puede_usar_tipo_documento(v_out, 'cliente_lista_nominal') IS FALSE,
    'helper outsider scoped FALSE'
  );
  PERFORM public.__dts_assert(
    public.asesor_puede_usar_tipo_documento(v_out, 'cliente_vigencia_derechos') IS TRUE,
    'helper outsider tipo sin scope TRUE'
  );

  FOREACH v_tipo IN ARRAY v_tipos LOOP
    v_path := public.__dts_storage_path(v_org, v_exp_out, v_tipo, 'out.pdf');
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('expediente-documentos', v_path, v_out)
    ON CONFLICT (bucket_id, name) DO NOTHING;

    PERFORM public.__dts_set_auth(v_out);
    v_allowed := public.expediente_documento_storage_asesor_upload_allowed(v_path);
    PERFORM public.__dts_reset_auth();
    PERFORM public.__dts_assert(v_allowed IS FALSE, v_tipo || ' storage outsider FALSE');

    PERFORM public.__dts_set_auth(v_out);
    BEGIN
      PERFORM public.register_expediente_documento(
        v_exp_out, v_tipo, v_path, 'x.pdf', 'application/pdf', 100
      );
      v_ok := false;
    EXCEPTION WHEN OTHERS THEN
      v_ok := (SQLSTATE = '42501')
           OR position('no permitido para este asesor' IN SQLERRM) > 0;
    END;
    PERFORM public.__dts_reset_auth();
    PERFORM public.__dts_assert(v_ok, v_tipo || ' RPC outsider rechazado');

    PERFORM public.__dts_set_auth(v_out);
    BEGIN
      PERFORM public.register_expediente_documento_correccion(
        v_exp_out, v_tipo, v_path, 'c.pdf', 'application/pdf', 100
      );
      v_ok := false;
    EXCEPTION WHEN OTHERS THEN
      v_ok := (SQLSTATE = '42501')
           OR position('no permitido para este asesor' IN SQLERRM) > 0;
    END;
    PERFORM public.__dts_reset_auth();
    PERFORM public.__dts_assert(v_ok, v_tipo || ' RPC correccion outsider rechazado');
  END LOOP;

  FOREACH v_tipo IN ARRAY v_tipos LOOP
    v_path := public.__dts_storage_path(v_org, v_exp_member, v_tipo, 'ok.pdf');
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('expediente-documentos', v_path, v_member)
    ON CONFLICT (bucket_id, name) DO NOTHING;

    PERFORM public.__dts_set_auth(v_member);
    v_allowed := public.expediente_documento_storage_asesor_upload_allowed(v_path);
    PERFORM public.__dts_reset_auth();
    PERFORM public.__dts_assert(v_allowed IS TRUE, v_tipo || ' storage miembro TRUE');

    PERFORM public.__dts_set_auth(v_member);
    PERFORM public.register_expediente_documento(
      v_exp_member, v_tipo, v_path, 'ok.pdf', 'application/pdf', 120
    );
    PERFORM public.__dts_reset_auth();
  END LOOP;

  UPDATE public.asesor_equipos SET active = false WHERE id = v_team;
  PERFORM public.__dts_assert(
    public.asesor_puede_usar_tipo_documento(v_member, 'cliente_lista_nominal') IS FALSE,
    'fail-closed equipo inactivo'
  );
  UPDATE public.asesor_equipos SET active = true WHERE id = v_team;

  UPDATE public.documento_tipo_scope_equipo
  SET leader_email = v_email_prod
  WHERE tipo_documento = ANY(v_tipos);

  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (v_exp_member, v_exp_out);
  DELETE FROM public.expedientes WHERE id IN (v_exp_member, v_exp_out);
  DELETE FROM public.asesor_equipo_miembros WHERE team_id = v_team;
  DELETE FROM public.asesor_equipos WHERE id = v_team;
  DELETE FROM public.profiles WHERE id IN (v_leader, v_member, v_out);

  RAISE NOTICE 'DOC SCOPE EQUIPO TESTS OK';
END; $$;

DROP FUNCTION IF EXISTS public.__dts_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__dts_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__dts_reset_auth();
DROP FUNCTION IF EXISTS public.__dts_storage_path(UUID, UUID, TEXT, TEXT);
