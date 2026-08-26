-- P210 FASE 11 — security extended (PostgreSQL local aislado).
\set ON_ERROR_STOP on
\ir ../migrations/210_asesor_correccion_accionable_reenvio.sql

CREATE OR REPLACE FUNCTION public.__p210_sec_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P210 SEC FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p210_sec_set_actor(p UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p210_sec_expect_denied(p_exp UUID, p_actor UUID, p_label TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p210_sec_set_actor(p_actor);
  BEGIN
    PERFORM public.asesor_reenviar_correccion_a_mesa(p_exp);
    RAISE EXCEPTION 'P210 SEC FAIL: % debió fallar', p_label;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p210_sec_seed_ready(
  p_org UUID,
  p_owner UUID,
  p_mesa UUID,
  p_exp UUID,
  p_nss CHAR(11)
)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_lote UUID := gen_random_uuid();
  v_request TIMESTAMPTZ := timestamptz '2026-08-24 13:45:46+00';
  v_save TIMESTAMPTZ := timestamptz '2026-08-24 18:00:00+00';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
BEGIN
  INSERT INTO public.organizations (id, slug, name)
  VALUES (p_org, 'p210-sec-' || replace(p_org::text, '-', ''), 'P210 sec org')
  ON CONFLICT (id) DO UPDATE
    SET slug = EXCLUDED.slug, name = EXCLUDED.name;

  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES
    (p_owner, p_org, 'asesor', true, 'p210-sec-' || replace(p_owner::text, '-', '') || '@owner.test', NULL),
    (p_mesa, p_org, 'mesa_interno', true, 'p210-sec-' || replace(p_mesa::text, '-', '') || '@mesa.test', 'interno')
  ON CONFLICT (id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        app_role = EXCLUDED.app_role,
        active = EXCLUDED.active,
        email = EXCLUDED.email,
        tipo_mesa = EXCLUDED.tipo_mesa;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_exp, p_org, p_owner, 'mejoravit', p_nss, 'P210 sec',
    '5512109999', 'interno', true, v_envio, 1, 'en_proceso', 'activo'
  );

  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (p_exp, p_org, '{}'::jsonb, 'completo');

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    p_org, p_mesa, 'mesa_interno', 'cliente_datos.revision.update', 'cliente_datos', p_exp,
    jsonb_build_object('estado_nuevo', 'rechazado', 'comentario_rechazo', 'SEC TEST'), v_request
  );

  INSERT INTO public.expediente_asesor_cambio_lotes (
    id, organization_id, expediente_id, asesor_id, status, submitted_at, created_at
  ) VALUES (v_lote, p_org, p_exp, p_owner, 'pendiente_revision', v_envio, v_envio);

  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, entidad, campo, label, valor_anterior, valor_nuevo, created_at
  ) VALUES (
    v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC',
    '"A"'::jsonb, '"B"'::jsonb, v_save
  );

  RETURN v_lote;
END;
$$;

BEGIN;

-- E. anon sin EXECUTE (privilege check, no JWT simulable en fixture)
DO $$
BEGIN
  PERFORM public.__p210_sec_assert(
    NOT has_function_privilege('anon', 'public.asesor_reenviar_correccion_a_mesa(uuid)', 'EXECUTE'),
    'E: anon sin EXECUTE'
  );
  PERFORM public.__p210_sec_assert(
    NOT has_function_privilege('anon', 'public.asesor_correccion_detalle(uuid)', 'EXECUTE'),
    'E: anon sin EXECUTE detalle'
  );
END;
$$;

-- A. asesor dueño activo → PASS
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8101-000000000001';
  v_owner UUID := '00000000-0000-4000-8101-000000000011';
  v_mesa UUID := '00000000-0000-4000-8101-000000000014';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
  v_res JSONB;
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  PERFORM public.__p210_sec_seed_ready(v_org, v_owner, v_mesa, v_exp, v_nss);
  PERFORM public.__p210_sec_set_actor(v_owner);
  v_res := public.asesor_reenviar_correccion_a_mesa(v_exp);
  PERFORM public.__p210_sec_assert((v_res->>'ok')::boolean IS TRUE, 'A: owner PASS');
  PERFORM public.__p210_sec_assert(
    (v_res->>'already_submitted')::boolean IS DISTINCT FROM TRUE,
    'A: primera llamada submitted'
  );
END;
$$;

-- B. asesor ajeno → DENIED
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8102-000000000001';
  v_owner UUID := '00000000-0000-4000-8102-000000000011';
  v_other UUID := '00000000-0000-4000-8102-000000000012';
  v_mesa UUID := '00000000-0000-4000-8102-000000000014';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  PERFORM public.__p210_sec_seed_ready(v_org, v_owner, v_mesa, v_exp, v_nss);
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES (v_other, v_org, 'asesor', true, 'p210-sec-other@test', NULL)
  ON CONFLICT DO NOTHING;
  PERFORM public.__p210_sec_expect_denied(v_exp, v_other, 'B: asesor ajeno');
END;
$$;

-- C. mesa_interno → DENIED
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8103-000000000001';
  v_owner UUID := '00000000-0000-4000-8103-000000000011';
  v_mesa UUID := '00000000-0000-4000-8103-000000000014';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  PERFORM public.__p210_sec_seed_ready(v_org, v_owner, v_mesa, v_exp, v_nss);
  PERFORM public.__p210_sec_expect_denied(v_exp, v_mesa, 'C: mesa_interno');
END;
$$;

-- D. mesa_admin → DENIED
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8104-000000000001';
  v_owner UUID := '00000000-0000-4000-8104-000000000011';
  v_mesa UUID := '00000000-0000-4000-8104-000000000014';
  v_admin UUID := '00000000-0000-4000-8104-000000000015';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  PERFORM public.__p210_sec_seed_ready(v_org, v_owner, v_mesa, v_exp, v_nss);
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES (v_admin, v_org, 'mesa_admin', true, 'p210-sec-admin@test', NULL)
  ON CONFLICT (id) DO NOTHING;
  PERFORM public.__p210_sec_expect_denied(v_exp, v_admin, 'D: mesa_admin');
END;
$$;

-- F. expediente cancelado → DENIED
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8105-000000000001';
  v_owner UUID := '00000000-0000-4000-8105-000000000011';
  v_mesa UUID := '00000000-0000-4000-8105-000000000014';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  PERFORM public.__p210_sec_seed_ready(v_org, v_owner, v_mesa, v_exp, v_nss);
  UPDATE public.expedientes SET ciclo_estado = 'cancelado' WHERE id = v_exp;
  PERFORM public.__p210_sec_expect_denied(v_exp, v_owner, 'F: cancelado');
END;
$$;

-- G. ciclo_estado cerrado → DENIED
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8106-000000000001';
  v_owner UUID := '00000000-0000-4000-8106-000000000011';
  v_mesa UUID := '00000000-0000-4000-8106-000000000014';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  PERFORM public.__p210_sec_seed_ready(v_org, v_owner, v_mesa, v_exp, v_nss);
  UPDATE public.expedientes SET ciclo_estado = 'cerrado' WHERE id = v_exp;
  PERFORM public.__p210_sec_expect_denied(v_exp, v_owner, 'G: cerrado');
END;
$$;

-- I. asesor inactivo → DENIED
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8107-000000000001';
  v_owner UUID := '00000000-0000-4000-8107-000000000011';
  v_mesa UUID := '00000000-0000-4000-8107-000000000014';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  PERFORM public.__p210_sec_seed_ready(v_org, v_owner, v_mesa, v_exp, v_nss);
  UPDATE public.profiles SET active = false WHERE id = v_owner;
  PERFORM public.__p210_sec_expect_denied(v_exp, v_owner, 'I: asesor inactivo');
END;
$$;

-- H. rechazo operativo abierto → DENIED (no flujo DG/doc reenvío)
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8108-000000000001';
  v_owner UUID := '00000000-0000-4000-8108-000000000011';
  v_mesa UUID := '00000000-0000-4000-8108-000000000014';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_t1 TIMESTAMPTZ := timestamptz '2026-08-20 12:00:00+00';
  v_submit TIMESTAMPTZ := timestamptz '2026-08-21 12:00:00+00';
  v_lote UUID;
  v_type TEXT;
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name)
  VALUES (v_org, 'p210-sec-op', 'P210 sec OP') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES
    (v_owner, v_org, 'asesor', true, 'p210-sec-op-owner@test', NULL),
    (v_mesa, v_org, 'mesa_admin', true, 'p210-sec-op-mesa@test', NULL)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_owner, 'mejoravit', v_nss, 'P210 sec OP',
    '5512109998', 'interno', true, v_envio, 2, 'en_proceso', 'activo'
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio);
  INSERT INTO public.expediente_rechazos_operativos (
    id, organization_id, expediente_id, etapa, subestado_anterior, motivo,
    biometricos_condicion, decidido_por, decidido_por_rol, created_at
  ) VALUES (
    gen_random_uuid(), v_org, v_exp, 2, 'en_proceso', 'revision operativa',
    'desconocida', v_mesa, 'mesa_admin', v_t1
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_org, v_exp, v_owner, 'pendiente_revision', v_submit)
  RETURNING id INTO v_lote;
  INSERT INTO public.expediente_asesor_cambios (lote_id, change_key, tipo, entidad, campo, label)
  VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC');
  SELECT request_type INTO v_type
  FROM public.mesa_cambio_revision_estado_efectivo(v_exp) LIMIT 1;
  PERFORM public.__p210_sec_assert(
    v_type = 'RECHAZO_OPERATIVO_CON_CORRECCION',
    'H: fixture OP request_type'
  );
  PERFORM public.__p210_sec_expect_denied(v_exp, v_owner, 'H: OP rejection');
END;
$$;

SELECT 'P210 SECURITY EXTENDED OK' AS status;

ROLLBACK;
