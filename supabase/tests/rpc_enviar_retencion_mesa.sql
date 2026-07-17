-- ConCasa CRM — pruebas P2C-16 RPC enviar_retencion_mesa + hook retención
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_enviar_retencion_mesa.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC RET TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_enviar(
  p_user_id UUID, p_expediente_id UUID, p_opcion public.retencion_opcion
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_ret_test_set_auth(p_user_id);
  SELECT public.enviar_retencion_mesa(p_expediente_id, p_opcion) INTO v_result;
  PERFORM public.__rpc_ret_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_enviar_expect_fail(
  p_user_id UUID, p_expediente_id UUID, p_opcion public.retencion_opcion
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__rpc_ret_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.enviar_retencion_mesa(p_expediente_id, p_opcion);
    PERFORM public.__rpc_ret_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_ret_test_reset_auth();
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_revision(
  p_user_id UUID, p_doc_id UUID, p_estatus public.estatus_revision, p_comentario TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_ret_test_set_auth(p_user_id);
  SELECT public.update_documento_revision(p_doc_id, p_estatus, p_comentario) INTO v_result;
  PERFORM public.__rpc_ret_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11),
  p_etapa SMALLINT DEFAULT 8, p_submitted BOOLEAN DEFAULT true,
  p_subestado public.operativo_subestado DEFAULT 'en_proceso',
  p_deleted TIMESTAMPTZ DEFAULT NULL,
  p_ciclo public.expediente_ciclo_estado DEFAULT 'activo'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, deleted_at, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture Ret',
    '5555555555', 'interno', p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, p_subestado, p_deleted, p_ciclo
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id, nss = EXCLUDED.nss,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    etapa_actual = EXCLUDED.etapa_actual, subestado = EXCLUDED.subestado,
    deleted_at = EXCLUDED.deleted_at, ciclo_estado = EXCLUDED.ciclo_estado,
    updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_insert_doc(
  p_id UUID, p_org UUID, p_exp UUID, p_asesor UUID,
  p_tipo TEXT, p_estatus public.estatus_revision DEFAULT 'subido',
  p_deleted TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento,
    storage_path, nombre_original, mime_type, size_bytes,
    estatus_revision, uploaded_by, uploaded_by_role, deleted_at
  ) VALUES (
    p_id, p_org, p_exp, p_tipo,
    'dev/ret/' || p_exp::text || '/' || p_tipo || '.pdf',
    p_tipo || '.pdf', 'application/pdf', 100,
    p_estatus, p_asesor, 'asesor', p_deleted
  )
  ON CONFLICT (id) DO UPDATE SET
    tipo_documento = EXCLUDED.tipo_documento,
    estatus_revision = EXCLUDED.estatus_revision,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_insert_con_sello_docs(
  p_org UUID, p_exp UUID, p_asesor UUID, p_estatus public.estatus_revision DEFAULT 'subido'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__rpc_ret_test_insert_doc(gen_random_uuid(), p_org, p_exp, p_asesor, 'retencion_acuse_con_sello', p_estatus);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_ret_test_insert_sin_sello_docs(
  p_org UUID, p_exp UUID, p_asesor UUID, p_estatus public.estatus_revision DEFAULT 'subido'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__rpc_ret_test_insert_doc(gen_random_uuid(), p_org, p_exp, p_asesor, 'retencion_carta_sin_sello', p_estatus);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';

  v_exp_a UUID := '00000000-0000-4000-9018-000000000010';
  v_exp_b UUID := '00000000-0000-4000-9018-000000000011';
  v_exp_owner UUID := '00000000-0000-4000-9018-000000000012';
  v_exp_roles UUID := '00000000-0000-4000-9018-000000000013';
  v_exp_etapa UUID := '00000000-0000-4000-9018-000000000014';
  v_exp_not_sent UUID := '00000000-0000-4000-9018-000000000015';
  v_exp_deleted UUID := '00000000-0000-4000-9018-000000000016';
  v_exp_ciclo UUID := '00000000-0000-4000-9018-000000000017';
  v_exp_bad_sub UUID := '00000000-0000-4000-9018-000000000018';
  v_exp_no_aviso UUID := '00000000-0000-4000-9018-000000000019';
  v_exp_no_ine UUID := '00000000-0000-4000-9018-000000000020';
  v_exp_rech UUID := '00000000-0000-4000-9018-000000000021';
  v_exp_subido UUID := '00000000-0000-4000-9018-000000000022';
  v_exp_resub UUID := '00000000-0000-4000-9018-000000000023';
  v_exp_valid UUID := '00000000-0000-4000-9018-000000000024';
  v_exp_del_doc UUID := '00000000-0000-4000-9018-000000000025';
  v_exp_resend UUID := '00000000-0000-4000-9018-000000000026';
  v_exp_double UUID := '00000000-0000-4000-9018-000000000027';
  v_exp_hook UUID := '00000000-0000-4000-9018-000000000028';
  v_exp_hook_no UUID := '00000000-0000-4000-9018-000000000029';
  v_exp_hook_nr UUID := '00000000-0000-4000-9018-000000000030';

  v_doc_rech UUID := '00000000-0000-4000-9018-000000000041';
  v_doc_del UUID := '00000000-0000-4000-9018-000000000042';
  v_doc_hook UUID := '00000000-0000-4000-9018-000000000043';
  v_doc_hook_nr UUID := '00000000-0000-4000-9018-000000000044';
  v_doc_hook_no UUID := '00000000-0000-4000-9018-000000000046';
  v_doc_resend UUID := '00000000-0000-4000-9018-000000000045';

  v_result JSONB;
  v_etapa SMALLINT;
  v_fecha1 TIMESTAMPTZ;
  v_fecha2 TIMESTAMPTZ;
  v_rev_before BIGINT;
  v_rev_after BIGINT;
  v_roles_revisor INTEGER;
BEGIN
  -- Fixtures
  PERFORM public.__rpc_ret_test_insert_exp(v_exp_a, v_org, v_a1, '91801000010');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_a, v_a1);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_b, v_org, v_a1, '91801100011');
  PERFORM public.__rpc_ret_test_insert_sin_sello_docs(v_org, v_exp_b, v_a1);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_owner, v_org, v_a2, '91801200012');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_owner, v_a2);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_roles, v_org, v_a1, '91801300013');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_roles, v_a1);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_etapa, v_org, v_a1, '91801400014', 7::smallint);
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_etapa, v_a1);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_not_sent, v_org, v_a1, '91801500015', 8::smallint, false);
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_not_sent, v_a1);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_deleted, v_org, v_a1, '91801600016', 8::smallint, true, 'en_proceso', NOW());
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_deleted, v_a1);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_ciclo, v_org, v_a1, '91801700017', 8::smallint, true, 'en_proceso', NULL, 'cerrado');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_ciclo, v_a1);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_bad_sub, v_org, v_a1, '91801800018', 8::smallint, true, 'pendiente');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_bad_sub, v_a1);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_no_aviso, v_org, v_a1, '91801900019');
  -- Sin documento principal: solo históricos (aviso/INE) → debe fallar
  PERFORM public.__rpc_ret_test_insert_doc(gen_random_uuid(), v_org, v_exp_no_aviso, v_a1, 'retencion_aviso_retencion');
  PERFORM public.__rpc_ret_test_insert_doc(gen_random_uuid(), v_org, v_exp_no_aviso, v_a1, 'retencion_ine_frente');
  PERFORM public.__rpc_ret_test_insert_doc(gen_random_uuid(), v_org, v_exp_no_aviso, v_a1, 'retencion_ine_reverso');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_no_ine, v_org, v_a1, '91802000020');
  -- Solo principal (sin aviso/INE) → debe pasar
  PERFORM public.__rpc_ret_test_insert_doc(gen_random_uuid(), v_org, v_exp_no_ine, v_a1, 'retencion_acuse_con_sello');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_rech, v_org, v_a1, '91802100021');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_rech, v_a1, 'rechazado');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_subido, v_org, v_a1, '91802200022');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_subido, v_a1, 'subido');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_resub, v_org, v_a1, '91802300023');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_resub, v_a1, 'resubido');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_valid, v_org, v_a1, '91802400024');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_valid, v_a1, 'validado');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_del_doc, v_org, v_a1, '91802500025');
  -- Principal soft-deleted → debe fallar (históricos activos no cuentan)
  PERFORM public.__rpc_ret_test_insert_doc(v_doc_del, v_org, v_exp_del_doc, v_a1, 'retencion_acuse_con_sello', 'subido', NOW());
  PERFORM public.__rpc_ret_test_insert_doc(gen_random_uuid(), v_org, v_exp_del_doc, v_a1, 'retencion_aviso_retencion');
  PERFORM public.__rpc_ret_test_insert_doc(gen_random_uuid(), v_org, v_exp_del_doc, v_a1, 'retencion_ine_frente');
  PERFORM public.__rpc_ret_test_insert_doc(gen_random_uuid(), v_org, v_exp_del_doc, v_a1, 'retencion_ine_reverso');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_resend, v_org, v_a1, '91802600026');
  PERFORM public.__rpc_ret_test_insert_doc(v_doc_resend, v_org, v_exp_resend, v_a1, 'retencion_acuse_con_sello', 'subido');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_double, v_org, v_a1, '91802700027');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_double, v_a1);

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_hook, v_org, v_a1, '91802800028');
  PERFORM public.__rpc_ret_test_insert_doc(v_doc_hook, v_org, v_exp_hook, v_a1, 'retencion_acuse_con_sello', 'subido');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_hook_no, v_org, v_a1, '91802900029');
  PERFORM public.__rpc_ret_test_insert_doc(v_doc_hook_no, v_org, v_exp_hook_no, v_a1, 'retencion_aviso_retencion', 'subido');

  PERFORM public.__rpc_ret_test_insert_exp(v_exp_hook_nr, v_org, v_a1, '91803000030');
  PERFORM public.__rpc_ret_test_insert_con_sello_docs(v_org, v_exp_hook_nr, v_a1);
  PERFORM public.__rpc_ret_test_insert_doc(v_doc_hook_nr, v_org, v_exp_hook_nr, v_a1, 'ine', 'subido');

  -- 1-5: envío opción A
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_a, 'con_sello');
  PERFORM public.__rpc_ret_test_assert((v_result->>'ok')::boolean = true, 'test 1');
  PERFORM public.__rpc_ret_test_assert(
    EXISTS (SELECT 1 FROM public.retencion_opciones ro WHERE ro.expediente_id = v_exp_a AND ro.retencion_opcion = 'con_sello'),
    'test 2'
  );
  PERFORM public.__rpc_ret_test_assert(
    EXISTS (SELECT 1 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_a AND re.estado = 'enviado' AND re.enviado = true),
    'test 3'
  );
  SELECT e.etapa_actual INTO v_etapa FROM public.expedientes e WHERE e.id = v_exp_a;
  PERFORM public.__rpc_ret_test_assert(v_etapa = 9, 'test 4 etapa 9');
  PERFORM public.__rpc_ret_test_assert(
    EXISTS (SELECT 1 FROM public.action_log al WHERE al.entity_id = v_exp_a AND al.action = 'expediente.enviar_retencion_mesa'),
    'test 5'
  );
  PERFORM public.__rpc_ret_test_assert(
    NOT EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp_a AND b.kind = 'firmas'
    ),
    'test 5b sin booking'
  );
  PERFORM public.__rpc_ret_test_assert(
    EXISTS (
      SELECT 1 FROM public.expediente_documentos d
      WHERE d.expediente_id = v_exp_a
        AND d.tipo_documento = 'retencion_acuse_con_sello'
        AND d.estatus_revision = 'subido'
        AND d.deleted_at IS NULL
    ),
    'test 5c estatus documental intacto'
  );

  -- 6-7: opción B
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_b, 'sin_sello');
  PERFORM public.__rpc_ret_test_assert((v_result->>'ok')::boolean = true, 'test 6');
  PERFORM public.__rpc_ret_test_assert(
    EXISTS (SELECT 1 FROM public.expediente_documentos d WHERE d.expediente_id = v_exp_b AND d.tipo_documento = 'retencion_carta_sin_sello' AND d.deleted_at IS NULL),
    'test 7'
  );

  -- 8-15: permisos y gates
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_a1, v_exp_owner, 'con_sello'), 'test 8');
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_mesa, v_exp_roles, 'con_sello'), 'test 9');
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_editor, v_exp_roles, 'con_sello'), 'test 10');
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_a1, v_exp_etapa, 'con_sello'), 'test 11');
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_a1, v_exp_not_sent, 'con_sello'), 'test 12');
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_a1, v_exp_deleted, 'con_sello'), 'test 13');
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_a1, v_exp_ciclo, 'con_sello'), 'test 14');
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_a1, v_exp_bad_sub, 'con_sello'), 'test 15');

  -- 16-22: documentos (P077: solo principal requerido)
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_a1, v_exp_no_aviso, 'con_sello'), 'test 16 sin principal');
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_no_ine, 'con_sello');
  PERFORM public.__rpc_ret_test_assert((v_result->>'ok')::boolean = true, 'test 17 solo principal');
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_a1, v_exp_rech, 'con_sello'), 'test 18');
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_subido, 'con_sello');
  PERFORM public.__rpc_ret_test_assert((v_result->>'ok')::boolean = true, 'test 19');
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_resub, 'con_sello');
  PERFORM public.__rpc_ret_test_assert((v_result->>'ok')::boolean = true, 'test 20');
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_valid, 'con_sello');
  PERFORM public.__rpc_ret_test_assert((v_result->>'ok')::boolean = true, 'test 21');
  PERFORM public.__rpc_ret_test_assert(public.__rpc_ret_test_enviar_expect_fail(v_a1, v_exp_del_doc, 'con_sello'), 'test 22 principal deleted');

  -- 23-28: reenvío
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_resend, 'con_sello');
  PERFORM public.__rpc_ret_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'is_resend')::boolean = false,
    'test 23'
  );

  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_double, 'con_sello');
  PERFORM public.__rpc_ret_test_assert((v_result->>'ok')::boolean = true, 'test 24 setup');
  -- P079: reintento en etapa 9 es idempotente (no avanza a 10, no falla)
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_double, 'con_sello');
  PERFORM public.__rpc_ret_test_assert(
    (v_result->>'ok')::boolean = true
      AND (v_result->>'idempotent')::boolean = true
      AND (v_result->>'etapa_actual')::int = 9,
    'test 24 idempotente etapa 9'
  );
  SELECT e.etapa_actual INTO v_etapa FROM public.expedientes e WHERE e.id = v_exp_double;
  PERFORM public.__rpc_ret_test_assert(v_etapa = 9, 'test 24 no avanza a 10');

  SELECT re.fecha_envio_mesa INTO v_fecha1 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_resend;
  v_result := public.__rpc_ret_test_revision(v_mesa, v_doc_resend, 'rechazado', 'Corregir acuse');
  PERFORM public.__rpc_ret_test_assert(
    EXISTS (SELECT 1 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_resend AND re.estado = 'correccion_requerida'),
    'test 25'
  );

  UPDATE public.expediente_documentos
  SET estatus_revision = 'resubido', comentario_mesa = NULL, updated_at = NOW()
  WHERE id = v_doc_resend;

  PERFORM public.__rpc_ret_test_insert_doc(
    gen_random_uuid(), v_org, v_exp_resend, v_a1, 'retencion_carta_sin_sello', 'subido'
  );

  PERFORM pg_sleep(0.02);
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_resend, 'sin_sello');
  PERFORM public.__rpc_ret_test_assert((v_result->>'is_resend')::boolean = true, 'test 26-27 resend');
  SELECT re.fecha_envio_mesa INTO v_fecha2 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_resend;
  PERFORM public.__rpc_ret_test_assert(v_fecha2 >= v_fecha1, 'test 26 fecha');
  PERFORM public.__rpc_ret_test_assert(
    EXISTS (SELECT 1 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_resend AND re.estado = 'enviado'),
    'test 27'
  );
  SELECT e.etapa_actual INTO v_etapa FROM public.expedientes e WHERE e.id = v_exp_resend;
  PERFORM public.__rpc_ret_test_assert(v_etapa = 9, 'test 27b reenvío queda etapa 9');
  PERFORM public.__rpc_ret_test_assert(
    EXISTS (SELECT 1 FROM public.retencion_opciones ro WHERE ro.expediente_id = v_exp_resend AND ro.retencion_opcion = 'sin_sello')
    AND EXISTS (SELECT 1 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_resend AND re.opcion = 'sin_sello'),
    'test 28'
  );

  -- 29-33: hook
  v_result := public.__rpc_ret_test_enviar(v_a1, v_exp_hook, 'con_sello');
  SELECT count(*) INTO v_rev_before FROM public.documento_revisiones WHERE documento_id = v_doc_hook;
  v_result := public.__rpc_ret_test_revision(v_mesa, v_doc_hook, 'rechazado', 'Nota mesa');
  PERFORM public.__rpc_ret_test_assert(
    EXISTS (SELECT 1 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_hook AND re.estado = 'correccion_requerida'),
    'test 29'
  );
  v_result := public.__rpc_ret_test_revision(v_mesa, v_doc_hook_nr, 'rechazado', 'Nota ine');
  PERFORM public.__rpc_ret_test_assert(
    NOT EXISTS (SELECT 1 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_hook_nr),
    'test 30 no envio'
  );
  v_result := public.__rpc_ret_test_revision(v_mesa, v_doc_hook_nr, 'validado');
  PERFORM public.__rpc_ret_test_assert(
    NOT EXISTS (SELECT 1 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_hook_nr),
    'test 31 validar no crea envio'
  );
  v_result := public.__rpc_ret_test_revision(v_mesa, v_doc_hook_no, 'rechazado', 'Sin envio previo');
  PERFORM public.__rpc_ret_test_assert(
    NOT EXISTS (SELECT 1 FROM public.retencion_envios re WHERE re.expediente_id = v_exp_hook_no),
    'test 32'
  );
  SELECT count(*) INTO v_rev_after FROM public.documento_revisiones WHERE documento_id = v_doc_hook;
  PERFORM public.__rpc_ret_test_assert(v_rev_after = v_rev_before + 1, 'test 33 historial');

  -- 36: no revisor
  SELECT COUNT(*) INTO v_roles_revisor
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__rpc_ret_test_assert(v_roles_revisor = 0, 'test 36');

  RAISE NOTICE 'RPC enviar_retencion_mesa: 36 pruebas OK (34-35 vía suites regresión)';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_ret_test_insert_sin_sello_docs(UUID, UUID, UUID, public.estatus_revision);
DROP FUNCTION IF EXISTS public.__rpc_ret_test_insert_con_sello_docs(UUID, UUID, UUID, public.estatus_revision);
DROP FUNCTION IF EXISTS public.__rpc_ret_test_insert_doc(UUID, UUID, UUID, UUID, TEXT, public.estatus_revision, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.__rpc_ret_test_insert_exp(UUID, UUID, UUID, CHAR, SMALLINT, BOOLEAN, public.operativo_subestado, TIMESTAMPTZ, public.expediente_ciclo_estado);
DROP FUNCTION IF EXISTS public.__rpc_ret_test_revision(UUID, UUID, public.estatus_revision, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_ret_test_enviar_expect_fail(UUID, UUID, public.retencion_opcion);
DROP FUNCTION IF EXISTS public.__rpc_ret_test_enviar(UUID, UUID, public.retencion_opcion);
DROP FUNCTION IF EXISTS public.__rpc_ret_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_ret_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_ret_test_assert(BOOLEAN, TEXT);
