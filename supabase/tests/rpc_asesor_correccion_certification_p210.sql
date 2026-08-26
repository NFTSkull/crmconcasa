-- P210 CERTIFICACIÓN LOCAL — escenarios FASE 4–12 (PostgreSQL aislado).
\set ON_ERROR_STOP on
\ir ../migrations/210_asesor_correccion_accionable_reenvio.sql

CREATE OR REPLACE FUNCTION public.__p210_cert_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P210 CERT FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p210_cert_set_actor(p UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

BEGIN;
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8010-000000000001';
  v_asesor UUID := '00000000-0000-4000-8011-000000000001';
  v_mesa UUID := '00000000-0000-4000-8014-000000000001';
  v_envio TIMESTAMPTZ := '2026-08-01 10:00:00+00';
  v_request TIMESTAMPTZ := '2026-08-24 13:45:46+00';
  v_save TIMESTAMPTZ := '2026-08-24 18:00:00+00';
  v_exp UUID := gen_random_uuid();
  v_det JSONB;
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-cert-f7', 'P210 cert F7') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES (v_asesor, v_org, 'asesor', true, 'p210-f7@test', NULL), (v_mesa, v_org, 'mesa_interno', true, 'p210-mesa-f7@test', 'interno')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (v_exp, v_org, v_asesor, 'mejoravit', v_nss, 'F7 save noop', '5512100001', 'interno', true, v_envio, 1, 'en_proceso', 'activo');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado) VALUES (v_exp, v_org, '{}'::jsonb, 'completo');
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at)
  VALUES (v_org, v_mesa, 'mesa_interno', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('estado_nuevo', 'rechazado', 'comentario_rechazo', 'RFC DEL EDC NO EXISTE'), v_request);
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at)
  VALUES (v_org, v_asesor, 'asesor', 'cliente_datos.correccion_post_mesa', 'cliente_datos', v_exp, '{}'::jsonb, v_save);

  PERFORM public.__p210_cert_set_actor(v_asesor);
  v_det := public.asesor_correccion_detalle(v_exp);
  PERFORM public.__p210_cert_assert(
    coalesce((v_det->>'has_correction_activity_after_request')::boolean, false) IS FALSE,
    'F7: save sin diff no cuenta como actividad'
  );
  PERFORM public.__p210_cert_assert(
    coalesce((v_det->>'can_resubmit')::boolean, true) IS FALSE,
    'F7: can_resubmit false'
  );
END;
$$;

-- FASE 8: ACK honesto (aislado, tipo correccion_respuesta)
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8020-000000000001';
  v_asesor UUID := '00000000-0000-4000-8021-000000000001';
  v_exp UUID := gen_random_uuid();
  v_lote UUID := gen_random_uuid();
  v_row RECORD;
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-cert-f8', 'P210 cert F8') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email)
  VALUES (v_asesor, v_org, 'asesor', true, 'p210-f8@test') ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (v_exp, v_org, v_asesor, 'mejoravit', v_nss, 'F8 ack', '5512100002', 'interno', true, now(), 1, 'en_proceso', 'activo');
  INSERT INTO public.expediente_asesor_cambio_lotes (
    id, organization_id, expediente_id, asesor_id, status
  ) VALUES (v_lote, v_org, v_exp, v_asesor, 'borrador');

  PERFORM public.asesor_cambio_record_correccion_ack(v_lote, timestamptz '2026-08-24 13:45:46+00');

  SELECT c.tipo::text, c.entidad, c.campo, c.valor_anterior, c.valor_nuevo, c.label
  INTO v_row
  FROM public.expediente_asesor_cambios c WHERE c.lote_id = v_lote LIMIT 1;

  PERFORM public.__p210_cert_assert(v_row.tipo = 'correccion_respuesta', 'F8: tipo correccion_respuesta');
  PERFORM public.__p210_cert_assert(v_row.entidad = 'asesor_correccion_respuesta', 'F8: entidad ack');
  PERFORM public.__p210_cert_assert(v_row.valor_anterior IS NULL, 'F8: sin valor_anterior fingido');
  PERFORM public.__p210_cert_assert(v_row.valor_nuevo->>'kind' = 'correccion_respuesta', 'F8: metadata honesta');
  PERFORM public.__p210_cert_assert(v_row.campo = 'acknowledgement', 'F8: no campo rfc/curp');
END;
$$;

-- FASE 5: documento exact-kind gate
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8030-000000000001';
  v_asesor UUID := '00000000-0000-4000-8031-000000000001';
  v_mesa UUID := '00000000-0000-4000-8034-000000000001';
  v_envio TIMESTAMPTZ := '2026-08-01 10:00:00+00';
  v_request TIMESTAMPTZ := '2026-08-20 12:00:00+00';
  v_t2 TIMESTAMPTZ := '2026-08-21 12:00:00+00';
  v_exp UUID := gen_random_uuid();
  v_lote UUID := gen_random_uuid();
  v_doc_edc UUID := gen_random_uuid();
  v_doc_ine UUID := gen_random_uuid();
  v_det JSONB;
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-cert-f5', 'P210 cert F5') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES (v_asesor, v_org, 'asesor', true, 'p210-f5@test', NULL), (v_mesa, v_org, 'mesa_interno', true, 'p210-mesa-f5@test', 'interno')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (v_exp, v_org, v_asesor, 'mejoravit', v_nss, 'F5 doc gate', '5512100003', 'interno', true, v_envio, 1, 'en_proceso', 'activo');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado) VALUES (v_exp, v_org, '{}'::jsonb, 'completo');

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, uploaded_by, uploaded_by_role, estatus_revision, created_at
  ) VALUES (
    v_doc_edc, v_org, v_exp, 'cliente_estado_cuenta', v_org::text || '/' || v_exp::text || '/edc.pdf',
    'edc.pdf', 'application/pdf', v_asesor, 'asesor', 'rechazado', v_envio
  );

  INSERT INTO public.documento_revisiones (
    organization_id, expediente_id, documento_id, estatus_anterior, estatus_nuevo, comentario_mesa, actor_id, created_at
  ) VALUES (v_org, v_exp, v_doc_edc, 'subido', 'rechazado', 'ACTUALIZAR EDC', v_mesa, v_request);

  PERFORM public.__p210_cert_set_actor(v_asesor);

  -- Caso A: solo cambio DG
  INSERT INTO public.expediente_asesor_cambio_lotes (id, organization_id, expediente_id, asesor_id, status, submitted_at, created_at)
  VALUES (v_lote, v_org, v_exp, v_asesor, 'pendiente_revision', v_envio, v_envio);
  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, entidad, campo, label, valor_anterior, valor_nuevo, created_at
  ) VALUES (
    v_lote, 'campo:direccion_opcional', 'campo_actualizado', 'expediente', 'direccion_opcional',
    'Dirección actualizada', '"A"'::jsonb, '"B"'::jsonb, v_t2
  );
  v_det := public.asesor_correccion_detalle(v_exp);
  PERFORM public.__p210_cert_assert(coalesce((v_det->>'can_resubmit')::boolean, true) IS FALSE, 'F5A: DG only blocked');

  -- Caso B: reemplazo INE (wrong kind)
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, uploaded_by, uploaded_by_role, estatus_revision, created_at
  ) VALUES (
    v_doc_ine, v_org, v_exp, 'cliente_ine_frente', v_org::text || '/' || v_exp::text || '/ine.pdf',
    'ine.pdf', 'application/pdf', v_asesor, 'asesor', 'subido', v_t2 + interval '1 minute'
  );
  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, document_kind, label, documento_nuevo_id, created_at
  ) VALUES (
    v_lote, 'doc:cliente_ine_frente', 'documento_reemplazado', 'cliente_ine_frente',
    'INE frente reemplazada', v_doc_ine, v_t2 + interval '1 minute'
  );
  v_det := public.asesor_correccion_detalle(v_exp);
  PERFORM public.__p210_cert_assert(coalesce((v_det->>'can_resubmit')::boolean, true) IS FALSE, 'F5B: INE blocked');

  -- Caso C: EDC exact kind (cambio P130 auditable)
  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, document_kind, label, documento_nuevo_id, created_at
  ) VALUES (
    v_lote, 'doc:cliente_estado_cuenta:v2', 'documento_reemplazado', 'cliente_estado_cuenta',
    'Estado de cuenta reemplazado', NULL, v_t2 + interval '2 minutes'
  );
  v_det := public.asesor_correccion_detalle(v_exp);
  PERFORM public.__p210_cert_assert(coalesce((v_det->>'can_resubmit')::boolean, false) IS TRUE, 'F5C: EDC enables');
END;
$$;

-- FASE 6: multi gate
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8040-000000000001';
  v_asesor UUID := '00000000-0000-4000-8041-000000000001';
  v_mesa UUID := '00000000-0000-4000-8044-000000000001';
  v_envio TIMESTAMPTZ := '2026-08-01 10:00:00+00';
  v_request TIMESTAMPTZ := '2026-08-22 12:00:00+00';
  v_t2 TIMESTAMPTZ := '2026-08-23 12:00:00+00';
  v_exp UUID := gen_random_uuid();
  v_lote UUID := gen_random_uuid();
  v_doc UUID := gen_random_uuid();
  v_det JSONB;
  v_n INT;
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-cert-f6', 'P210 cert F6') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES (v_asesor, v_org, 'asesor', true, 'p210-f6@test', NULL), (v_mesa, v_org, 'mesa_interno', true, 'p210-mesa-f6@test', 'interno')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (v_exp, v_org, v_asesor, 'mejoravit', v_nss, 'F6 multi', '5512100004', 'interno', true, v_envio, 1, 'en_proceso', 'activo');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado) VALUES (v_exp, v_org, '{}'::jsonb, 'completo');
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at)
  VALUES (v_org, v_mesa, 'mesa_interno', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('estado_nuevo', 'rechazado', 'comentario_rechazo', 'RFC'), v_request);
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, uploaded_by, uploaded_by_role, estatus_revision, created_at
  ) VALUES (
    v_doc, v_org, v_exp, 'cliente_estado_cuenta', v_org::text || '/' || v_exp::text || '/edc.pdf',
    'edc.pdf', 'application/pdf', v_asesor, 'asesor', 'rechazado', v_envio
  );
  INSERT INTO public.documento_revisiones (
    organization_id, expediente_id, documento_id, estatus_anterior, estatus_nuevo, comentario_mesa, actor_id, created_at
  ) VALUES (v_org, v_exp, v_doc, 'subido', 'rechazado', 'ACTUALIZAR EDC', v_mesa, v_request + interval '1 minute');

  INSERT INTO public.expediente_asesor_cambio_lotes (id, organization_id, expediente_id, asesor_id, status, submitted_at)
  VALUES (v_lote, v_org, v_exp, v_asesor, 'pendiente_revision', v_envio);
  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, entidad, campo, label, valor_anterior, valor_nuevo, created_at
  ) VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC actualizado',
    '"OLD"'::jsonb, '"NEW"'::jsonb, v_t2);

  PERFORM public.__p210_cert_set_actor(v_asesor);
  v_det := public.asesor_correccion_detalle(v_exp);
  v_n := jsonb_array_length(v_det->'items');
  PERFORM public.__p210_cert_assert(v_n = 2, 'F6: dos items');
  PERFORM public.__p210_cert_assert(coalesce((v_det->>'can_resubmit')::boolean, true) IS FALSE, 'F6: blocked sin EDC');

  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, document_kind, label, documento_nuevo_id, created_at
  ) VALUES (v_lote, 'doc:cliente_estado_cuenta', 'documento_reemplazado', 'cliente_estado_cuenta',
    'Estado de cuenta reemplazado', NULL, v_t2 + interval '1 hour');
  v_det := public.asesor_correccion_detalle(v_exp);
  PERFORM public.__p210_cert_assert(coalesce((v_det->>'can_resubmit')::boolean, false) IS TRUE, 'F6: enabled tras EDC');
END;
$$;

-- FASE 10: rollback — resend fallido no crea lote respuesta
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8050-000000000001';
  v_asesor UUID := '00000000-0000-4000-8051-000000000001';
  v_mesa UUID := '00000000-0000-4000-8054-000000000001';
  v_envio TIMESTAMPTZ := '2026-08-01 10:00:00+00';
  v_request TIMESTAMPTZ := '2026-08-24 13:45:46+00';
  v_exp UUID := gen_random_uuid();
  v_pre UUID := gen_random_uuid();
  v_cnt_before INT;
  v_cnt_after INT;
  v_p198 TEXT;
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-cert-f10', 'P210 cert F10') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES (v_asesor, v_org, 'asesor', true, 'p210-f10@test', NULL), (v_mesa, v_org, 'mesa_interno', true, 'p210-mesa-f10@test', 'interno')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (v_exp, v_org, v_asesor, 'mejoravit', v_nss, 'F10 rollback', '5512100005', 'interno', true, v_envio, 1, 'en_proceso', 'activo');
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at)
  VALUES (v_org, v_mesa, 'mesa_interno', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('estado_nuevo', 'rechazado', 'comentario_rechazo', 'X'), v_request);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    id, organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (v_pre, v_org, v_exp, v_asesor, 'pendiente_revision', v_envio - interval '1 day');

  SELECT count(*) INTO v_cnt_before FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = v_exp;
  PERFORM public.__p210_cert_set_actor(v_asesor);
  BEGIN
    PERFORM public.asesor_reenviar_correccion_a_mesa(v_exp);
    RAISE EXCEPTION 'F10: debió fallar sin actividad';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT count(*) INTO v_cnt_after FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = v_exp;
  PERFORM public.__p210_cert_assert(v_cnt_after = v_cnt_before, 'F10: sin lote parcial');
  SELECT s.estado INTO v_p198 FROM public.mesa_cambio_revision_estado_efectivo(v_exp) s;
  PERFORM public.__p210_cert_assert(v_p198 = 'WAITING_ADVISOR', 'F10: P198 sigue WAITING');
END;
$$;

-- FASE 11: security (subset)
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8060-000000000001';
  v_owner UUID := '00000000-0000-4000-8061-000000000001';
  v_other UUID := '00000000-0000-4000-8062-000000000001';
  v_mesa UUID := '00000000-0000-4000-8064-000000000001';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-cert-f11', 'P210 cert F11') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES
    (v_owner, v_org, 'asesor', true, 'p210-owner@test', NULL),
    (v_other, v_org, 'asesor', true, 'p210-other@test', NULL),
    (v_mesa, v_org, 'mesa_interno', true, 'p210-mesa-sec@test', 'interno')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (v_exp, v_org, v_owner, 'mejoravit', v_nss, 'F11 sec', '5512100006', 'interno', true, now(), 1, 'en_proceso', 'activo');

  PERFORM public.__p210_cert_set_actor(v_other);
  BEGIN
    PERFORM public.asesor_reenviar_correccion_a_mesa(v_exp);
    RAISE EXCEPTION 'F11: asesor ajeno debió fallar';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM public.__p210_cert_set_actor(v_mesa);
  BEGIN
    PERFORM public.asesor_reenviar_correccion_a_mesa(v_exp);
    RAISE EXCEPTION 'F11: mesa debió fallar';
  EXCEPTION WHEN OTHERS THEN NULL; END;
END;
$$;

-- FASE 12: R1/R2 — solo solicitud vigente en detalle; nuevo response lot por episodio
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8080-000000000001';
  v_asesor UUID := '00000000-0000-4000-8081-000000000001';
  v_mesa UUID := '00000000-0000-4000-8084-000000000001';
  v_envio TIMESTAMPTZ := '2026-08-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := '2026-08-10 12:00:00+00';
  v_l1 TIMESTAMPTZ := '2026-08-11 12:00:00+00';
  v_r2 TIMESTAMPTZ := '2026-08-15 12:00:00+00';
  v_save2 TIMESTAMPTZ := '2026-08-16 12:00:00+00';
  v_exp UUID := gen_random_uuid();
  v_pre UUID := gen_random_uuid();
  v_doc UUID := gen_random_uuid();
  v_res JSONB;
  v_det JSONB;
  v_lote1 UUID;
  v_lote2 UUID;
  v_lote1_submitted TIMESTAMPTZ;
  v_n INT;
  v_nss CHAR(11);
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-cert-f12', 'P210 cert F12') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES (v_asesor, v_org, 'asesor', true, 'p210-f12@test', NULL), (v_mesa, v_org, 'mesa_interno', true, 'p210-mesa-f12@test', 'interno')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (v_exp, v_org, v_asesor, 'mejoravit', v_nss, 'F12 R1R2', '5512100008', 'interno', true, v_envio, 1, 'en_proceso', 'activo');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado) VALUES (v_exp, v_org, '{}'::jsonb, 'completo');

  -- R1: DG rechazado
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at)
  VALUES (v_org, v_mesa, 'mesa_interno', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('estado_nuevo', 'rechazado', 'comentario_rechazo', 'RFC R1'), v_r1);

  INSERT INTO public.expediente_asesor_cambio_lotes (id, organization_id, expediente_id, asesor_id, status, submitted_at, created_at)
  VALUES (v_pre, v_org, v_exp, v_asesor, 'pendiente_revision', v_envio, v_envio);
  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, entidad, campo, label, valor_anterior, valor_nuevo, created_at
  ) VALUES (v_pre, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC R1', '"A"'::jsonb, '"B"'::jsonb, v_l1 - interval '1 hour');

  PERFORM public.__p210_cert_set_actor(v_asesor);
  v_res := public.asesor_reenviar_correccion_a_mesa(v_exp);
  v_lote1 := (v_res->>'lote_id')::uuid;
  SELECT l.submitted_at INTO v_lote1_submitted
  FROM public.expediente_asesor_cambio_lotes l WHERE l.id = v_lote1;
  PERFORM public.__p210_cert_assert(v_lote1 IS NOT NULL, 'F12: lote respuesta R1');

  UPDATE public.expediente_asesor_cambio_lotes
  SET status = 'revisado', reviewed_at = v_l1 + interval '1 hour', reviewed_by = v_mesa
  WHERE id = v_lote1;

  -- Mesa cierra R1: DG validado (cierra episodio DG)
  UPDATE public.cliente_datos SET estado = 'validado' WHERE expediente_id = v_exp;
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at)
  VALUES (v_org, v_mesa, 'mesa_interno', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('estado_nuevo', 'validado'), v_l1 + interval '2 hours');

  -- R2: documento rechazado (nueva solicitud)
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, uploaded_by, uploaded_by_role, estatus_revision, created_at
  ) VALUES (
    v_doc, v_org, v_exp, 'cliente_estado_cuenta', v_org::text || '/' || v_exp::text || '/edc.pdf',
    'edc.pdf', 'application/pdf', v_asesor, 'asesor', 'rechazado', v_envio
  );
  INSERT INTO public.documento_revisiones (
    organization_id, expediente_id, documento_id, estatus_anterior, estatus_nuevo, comentario_mesa, actor_id, created_at
  ) VALUES (v_org, v_exp, v_doc, 'subido', 'rechazado', 'ACTUALIZAR EDC R2', v_mesa, v_lote1_submitted + interval '1 day');

  v_det := public.asesor_correccion_detalle(v_exp);
  v_n := jsonb_array_length(v_det->'items');
  PERFORM public.__p210_cert_assert(v_n = 1, 'F12: detalle solo R2');
  PERFORM public.__p210_cert_assert(
    v_det->'items'->0->>'motivo' = 'ACTUALIZAR EDC R2',
    'F12: motivo R2 exclusivo'
  );

  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, document_kind, label, documento_nuevo_id, created_at
  ) VALUES (v_pre, 'doc:cliente_estado_cuenta:r2', 'documento_reemplazado', 'cliente_estado_cuenta',
    'EDC R2', NULL, v_lote1_submitted + interval '2 days');

  v_res := public.asesor_reenviar_correccion_a_mesa(v_exp);
  v_lote2 := (v_res->>'lote_id')::uuid;
  PERFORM public.__p210_cert_assert(v_lote2 IS DISTINCT FROM v_lote1, 'F12: nuevo response lot R2');
  PERFORM public.__p210_cert_assert(v_lote2 <> v_pre, 'F12: no reutiliza lote pre-request');
END;
$$;

SELECT 'P210 CERT SQL BLOCKS OK' AS status;

ROLLBACK;
