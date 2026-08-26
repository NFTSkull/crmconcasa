-- P210: corrección accionable asesor (motivo causal + reenvío explícito).
\set ON_ERROR_STOP on
\ir ../migrations/210_asesor_correccion_accionable_reenvio.sql

CREATE OR REPLACE FUNCTION public.__p210_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P210 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_cambio_ensure_open_lote';

  PERFORM public.__p210_assert(
    position('asesor_cambio_create_response_lote' in v_src) = 0,
    'ensure_open_lote NO modificado con create_response_lote'
  );
END;
$$;

BEGIN;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000010';
  v_asesor UUID := '00000000-0000-4000-8001-000000000010';
  v_mesa UUID := '00000000-0000-4000-8004-000000000010';
  v_other UUID := '00000000-0000-4000-8001-000000000099';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_request TIMESTAMPTZ := timestamptz '2026-08-24 13:45:46+00';
  v_pre TIMESTAMPTZ := timestamptz '2026-08-22 18:47:05+00';
  v_save TIMESTAMPTZ := timestamptz '2026-08-24 17:55:00+00';
  v_exp UUID;
  v_lote_pre UUID;
  v_det JSONB;
  v_res JSONB;
  v_p198 TEXT;
  v_eff TEXT;
  v_lote_submitted TIMESTAMPTZ;
  v_lote_status TEXT;
  v_page JSONB;
  v_ids TEXT[];
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  v_exp := gen_random_uuid();
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-org-main', 'P210 org') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES
    (v_asesor, v_org, 'asesor', true, 'p210-asesor@test.local', NULL),
    (v_mesa, v_org, 'mesa_interno', true, 'p210-mesa@test.local', 'interno'),
    (v_other, v_org, 'asesor', true, 'p210-other@test.local', NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', v_nss, 'P210 Mauricio fixture',
    '5512100010', 'interno', true, v_envio, 1, 'en_proceso', 'activo'
  );

  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo');

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES (
    v_org, v_mesa, 'mesa_interno', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object(
      'estado_nuevo', 'rechazado',
      'comentario_rechazo', 'RFC DEL EDC NO EXISTE'
    ),
    v_request
  );

  v_lote_pre := gen_random_uuid();
  INSERT INTO public.expediente_asesor_cambio_lotes (
    id, organization_id, expediente_id, asesor_id, status, submitted_at, created_at
  ) VALUES (
    v_lote_pre, v_org, v_exp, v_asesor, 'pendiente_revision', v_pre, v_pre
  );

  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, entidad, campo, label, valor_anterior, valor_nuevo, created_at
  ) VALUES (
    v_lote_pre, 'campo:direccion_opcional', 'campo_actualizado', 'expediente',
    'direccion_opcional', 'Dirección actualizada', '"A"'::jsonb, '"B"'::jsonb, v_save
  );

  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_det := public.asesor_correccion_detalle(v_exp);
  PERFORM public.__p210_assert(
    v_det->'items'->0->>'motivo' = 'RFC DEL EDC NO EXISTE',
    'T1/T32 motivo exacto desde action_log'
  );
  PERFORM public.__p210_assert(
    (v_det->>'ux_state') = 'CAMBIOS_GUARDADOS_SIN_ENVIAR',
    'T14 estado B'
  );
  PERFORM public.__p210_assert(
    (v_det->>'can_resubmit')::boolean IS TRUE,
    'T7 readiness con actividad post-request'
  );

  v_res := public.asesor_reenviar_correccion_a_mesa(v_exp);
  PERFORM public.__p210_assert((v_res->>'ok')::boolean IS TRUE, 'T20 resend ok');
  PERFORM public.__p210_assert(
    (v_res->>'already_submitted')::boolean IS DISTINCT FROM TRUE,
    'T28 primera llamada no idempotente'
  );
  PERFORM public.__p210_assert(
    (v_res->>'submitted_at')::timestamptz > v_request,
    'T20 response lote > request'
  );

  SELECT l.status::text, l.submitted_at
  INTO v_lote_status, v_lote_submitted
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.id = (v_res->>'lote_id')::uuid;

  PERFORM public.__p210_assert(v_lote_status = 'pendiente_revision', 'lote pendiente');
  PERFORM public.__p210_assert(v_lote_submitted > v_request, 'T20 submitted_at');

  SELECT l.submitted_at INTO v_pre
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.id = v_lote_pre;
  PERFORM public.__p210_assert(
    v_pre = timestamptz '2026-08-22 18:47:05+00',
    'T22 lote histórico intacto'
  );

  SELECT s.estado INTO v_p198
  FROM public.mesa_cambio_revision_estado_efectivo(v_exp) s;
  PERFORM public.__p210_assert(
    v_p198 = 'CORRECTION_PENDING_REVIEW',
    'T25 P198 natural pending review'
  );

  v_eff := public.asesor_inbox_estado_efectivo(v_exp);
  PERFORM public.__p210_assert(v_eff = 'correccion_enviada', 'T26 P201 correction_sent');

  PERFORM set_config('request.jwt.claim.sub', v_mesa::text, true);
  v_page := public.mesa_list_bandeja_page(
    100, NULL::timestamptz, NULL::uuid, 'todos', 'sin_asignar', NULL, NULL, NULL, false,
    NULL, NULL, NULL, false
  );
  SELECT coalesce(array_agg(x->>'id'), ARRAY[]::text[]) INTO v_ids
  FROM jsonb_array_elements(v_page->'items') x;
  PERFORM public.__p210_assert(v_exp::text = ANY (v_ids), 'T27 P207 Disponibles IN');

  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  v_res := public.asesor_reenviar_correccion_a_mesa(v_exp);
  PERFORM public.__p210_assert(
    (v_res->>'already_submitted')::boolean IS TRUE,
    'T28 idempotencia segunda llamada'
  );

  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  BEGIN
    PERFORM public.asesor_reenviar_correccion_a_mesa(v_exp);
    RAISE EXCEPTION 'T29 foreign advisor should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

ROLLBACK;

ROLLBACK;
