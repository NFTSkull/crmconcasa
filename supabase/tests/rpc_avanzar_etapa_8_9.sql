-- ConCasa CRM — pruebas P2C-17 RPC avanzar_etapa_operativa (transición 8→9)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_avanzar_etapa_8_9.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC AVANZAR 89 TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_call_as(
  p_user_id UUID, p_expediente_id UUID, p_comentario TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_avanzar_89_test_set_auth(p_user_id);
  SELECT public.avanzar_etapa_operativa(p_expediente_id, p_comentario) INTO v_result;
  PERFORM public.__rpc_avanzar_89_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_call_expect_fail(
  p_user_id UUID, p_expediente_id UUID, p_comentario TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__rpc_avanzar_89_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(p_expediente_id, p_comentario);
    PERFORM public.__rpc_avanzar_89_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_89_test_reset_auth();
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_insert_expediente(
  p_id UUID, p_org_id UUID, p_asesor_id UUID, p_nss CHAR(11),
  p_origen public.origen_mesa DEFAULT 'interno',
  p_submitted BOOLEAN DEFAULT true,
  p_etapa SMALLINT DEFAULT 8,
  p_subestado public.operativo_subestado DEFAULT 'en_proceso',
  p_fecha_cita TIMESTAMPTZ DEFAULT NULL,
  p_deleted_at TIMESTAMPTZ DEFAULT NULL,
  p_ciclo public.expediente_ciclo_estado DEFAULT 'activo'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, fecha_cita, deleted_at, ciclo_estado
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture Avanzar 8-9', '5555555555', p_origen,
    p_submitted, CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, p_subestado, p_fecha_cita, p_deleted_at, p_ciclo
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id, nss = EXCLUDED.nss,
    origen_mesa = EXCLUDED.origen_mesa, submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    etapa_actual = EXCLUDED.etapa_actual, subestado = EXCLUDED.subestado,
    fecha_cita = EXCLUDED.fecha_cita, deleted_at = EXCLUDED.deleted_at,
    ciclo_estado = EXCLUDED.ciclo_estado, updated_at = NOW();
  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_insert_cliente(
  p_expediente_id UUID, p_org_id UUID,
  p_estado public.cliente_datos_estado DEFAULT 'validado'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (
    p_expediente_id, p_org_id,
    jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Fixture 89'),
    p_estado
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    estado = EXCLUDED.estado, updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_insert_envio(
  p_expediente_id UUID, p_org_id UUID,
  p_opcion public.retencion_opcion DEFAULT 'con_sello',
  p_enviado BOOLEAN DEFAULT true,
  p_estado public.retencion_envio_estado DEFAULT 'enviado',
  p_with_opciones BOOLEAN DEFAULT true
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_with_opciones THEN
    INSERT INTO public.retencion_opciones (expediente_id, organization_id, retencion_opcion, updated_by)
    VALUES (p_expediente_id, p_org_id, p_opcion, NULL)
    ON CONFLICT (expediente_id) DO UPDATE SET
      retencion_opcion = EXCLUDED.retencion_opcion, updated_at = NOW();
  ELSE
    DELETE FROM public.retencion_opciones WHERE expediente_id = p_expediente_id;
  END IF;

  INSERT INTO public.retencion_envios (expediente_id, organization_id, enviado, opcion, estado)
  VALUES (p_expediente_id, p_org_id, p_enviado, p_opcion, p_estado)
  ON CONFLICT (expediente_id) DO UPDATE SET
    enviado = EXCLUDED.enviado, opcion = EXCLUDED.opcion,
    estado = EXCLUDED.estado, updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_insert_doc(
  p_expediente_id UUID, p_org_id UUID, p_asesor_id UUID,
  p_tipo TEXT, p_estatus public.estatus_revision DEFAULT 'validado'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento,
    storage_path, nombre_original, mime_type, size_bytes,
    estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    p_org_id, p_expediente_id, p_tipo,
    'dev/avanzar89/' || p_expediente_id::text || '/' || p_tipo || '.pdf',
    p_tipo || '.pdf', 'application/pdf', 100,
    p_estatus, p_asesor_id, 'asesor'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_insert_docs_opcion(
  p_expediente_id UUID, p_org_id UUID, p_asesor_id UUID,
  p_opcion public.retencion_opcion,
  p_estatus public.estatus_revision DEFAULT 'validado',
  p_omit_tipo TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_tipo TEXT;
BEGIN
  DELETE FROM public.expediente_documentos WHERE expediente_id = p_expediente_id;

  FOREACH v_tipo IN ARRAY public.retencion_doc_tipos_requeridos(p_opcion)
  LOOP
    IF p_omit_tipo IS NULL OR v_tipo <> p_omit_tipo THEN
      PERFORM public.__rpc_avanzar_89_test_insert_doc(
        p_expediente_id, p_org_id, p_asesor_id, v_tipo, p_estatus
      );
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_89_test_setup_listo(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11),
  p_opcion public.retencion_opcion DEFAULT 'con_sello',
  p_origen public.origen_mesa DEFAULT 'interno'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__rpc_avanzar_89_test_insert_expediente(
    p_id, p_org, p_asesor, p_nss, p_origen, true, 8::smallint
  );
  PERFORM public.__rpc_avanzar_89_test_insert_cliente(p_id, p_org, 'validado');
  PERFORM public.__rpc_avanzar_89_test_insert_envio(p_id, p_org, p_opcion, true, 'enviado', true);
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(p_id, p_org, p_asesor, p_opcion, 'validado');
END; $$;

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_super_admin UUID := '00000000-0000-4000-8006-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';

  v_exp_ok_a UUID := '00000000-0000-4000-9019-000000000010';
  v_exp_ok_b UUID := '00000000-0000-4000-9019-000000000011';
  v_exp_int UUID := '00000000-0000-4000-9019-000000000012';
  v_exp_int_block UUID := '00000000-0000-4000-9019-000000000013';
  v_exp_ext UUID := '00000000-0000-4000-9019-000000000014';
  v_exp_super UUID := '00000000-0000-4000-9019-000000000015';
  v_exp_roles UUID := '00000000-0000-4000-9019-000000000016';
  v_exp_etapa7 UUID := '00000000-0000-4000-9019-000000000017';
  v_exp_not_sent UUID := '00000000-0000-4000-9019-000000000018';
  v_exp_deleted UUID := '00000000-0000-4000-9019-000000000019';
  v_exp_ciclo UUID := '00000000-0000-4000-9019-000000000020';
  v_exp_bad_sub UUID := '00000000-0000-4000-9019-000000000021';
  v_exp_no_cliente UUID := '00000000-0000-4000-9019-000000000022';
  v_exp_cliente_pend UUID := '00000000-0000-4000-9019-000000000023';
  v_exp_no_envio UUID := '00000000-0000-4000-9019-000000000024';
  v_exp_no_enviado UUID := '00000000-0000-4000-9019-000000000025';
  v_exp_correccion UUID := '00000000-0000-4000-9019-000000000026';
  v_exp_fallback UUID := '00000000-0000-4000-9019-000000000027';
  v_exp_falta_acuse UUID := '00000000-0000-4000-9019-000000000028';
  v_exp_acuse_subido UUID := '00000000-0000-4000-9019-000000000029';
  v_exp_acuse_rech UUID := '00000000-0000-4000-9019-000000000030';
  v_exp_docs_a_ok UUID := '00000000-0000-4000-9019-000000000031';
  v_exp_falta_carta UUID := '00000000-0000-4000-9019-000000000032';
  v_exp_carta_subido UUID := '00000000-0000-4000-9019-000000000033';
  v_exp_docs_b_ok UUID := '00000000-0000-4000-9019-000000000034';
  v_exp_fecha UUID := '00000000-0000-4000-9019-000000000035';
  v_exp_booking UUID := '00000000-0000-4000-9019-000000000036';
  v_exp_side UUID := '00000000-0000-4000-9019-000000000037';
  v_exp_log UUID := '00000000-0000-4000-9019-000000000038';
  v_exp_no_810 UUID := '00000000-0000-4000-9019-000000000039';
  v_exp_etapa9 UUID := '00000000-0000-4000-9019-000000000040';
  v_exp_sanity_78 UUID := '00000000-0000-4000-9019-000000000041';

  v_fecha_cita TIMESTAMPTZ := NOW() - INTERVAL '3 days';
  v_result JSONB;
  v_fecha_before TIMESTAMPTZ;
  v_booking_count_before BIGINT;
  v_booking_count_after BIGINT;
  v_doc_count_before BIGINT;
  v_doc_count_after BIGINT;
  v_ret_opcion_before public.retencion_opcion;
  v_ret_envio_before BOOLEAN;
  v_ret_estado_before public.retencion_envio_estado;
  v_cliente_estado_before public.cliente_datos_estado;
  v_roles_revisor INTEGER;
  v_booking_id UUID;
BEGIN
  -- Happy path fixtures
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_ok_a, v_org_id, v_asesor_a1, '91901000010', 'con_sello');
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_ok_b, v_org_id, v_asesor_a1, '91901100011', 'sin_sello');
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_int, v_org_id, v_asesor_a1, '91901200012', 'con_sello', 'interno');
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_int_block, v_org_id, v_asesor_a1, '91901300013', 'con_sello', 'interno');
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_ext, v_org_id, v_asesor_a2, '91901400014', 'con_sello', 'externo');
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_super, v_org_id, v_asesor_a1, '91901500015', 'con_sello');
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_roles, v_org_id, v_asesor_a1, '91901600016', 'con_sello');

  -- Gates comunes
  PERFORM public.__rpc_avanzar_89_test_insert_expediente(
    v_exp_etapa7, v_org_id, v_asesor_a1, '91901700017', 'interno', true, 7::smallint
  );
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_not_sent, v_org_id, v_asesor_a1, '91901800018');
  UPDATE public.expedientes SET submitted_to_mesa = false, fecha_envio_mesa = NULL WHERE id = v_exp_not_sent;

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_deleted, v_org_id, v_asesor_a1, '91901900019');
  UPDATE public.expedientes SET deleted_at = NOW() WHERE id = v_exp_deleted;

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_ciclo, v_org_id, v_asesor_a1, '91902000020');
  UPDATE public.expedientes SET ciclo_estado = 'cerrado' WHERE id = v_exp_ciclo;

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_bad_sub, v_org_id, v_asesor_a1, '91902100021');
  UPDATE public.expedientes SET subestado = 'pendiente' WHERE id = v_exp_bad_sub;

  -- Cliente
  PERFORM public.__rpc_avanzar_89_test_insert_expediente(v_exp_no_cliente, v_org_id, v_asesor_a1, '91902200022');
  PERFORM public.__rpc_avanzar_89_test_insert_envio(v_exp_no_cliente, v_org_id);
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(v_exp_no_cliente, v_org_id, v_asesor_a1, 'con_sello', 'validado');

  PERFORM public.__rpc_avanzar_89_test_insert_expediente(v_exp_cliente_pend, v_org_id, v_asesor_a1, '91902300023');
  PERFORM public.__rpc_avanzar_89_test_insert_cliente(v_exp_cliente_pend, v_org_id, 'pendiente');
  PERFORM public.__rpc_avanzar_89_test_insert_envio(v_exp_cliente_pend, v_org_id);
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(v_exp_cliente_pend, v_org_id, v_asesor_a1, 'con_sello', 'validado');

  -- Retención envío
  PERFORM public.__rpc_avanzar_89_test_insert_expediente(v_exp_no_envio, v_org_id, v_asesor_a1, '91902400024');
  PERFORM public.__rpc_avanzar_89_test_insert_cliente(v_exp_no_envio, v_org_id, 'validado');
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(v_exp_no_envio, v_org_id, v_asesor_a1, 'con_sello', 'validado');

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_no_enviado, v_org_id, v_asesor_a1, '91902500025');
  UPDATE public.retencion_envios SET enviado = false WHERE expediente_id = v_exp_no_enviado;

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_correccion, v_org_id, v_asesor_a1, '91902600026');
  UPDATE public.retencion_envios SET estado = 'correccion_requerida' WHERE expediente_id = v_exp_correccion;

  -- Fallback opción: solo envio (sin retencion_opciones)
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_fallback, v_org_id, v_asesor_a1, '91902700027');
  DELETE FROM public.retencion_opciones WHERE expediente_id = v_exp_fallback;

  -- Documentos opción A
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_falta_acuse, v_org_id, v_asesor_a1, '91902800028');
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(
    v_exp_falta_acuse, v_org_id, v_asesor_a1, 'con_sello', 'validado', 'retencion_acuse_con_sello'
  );

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_acuse_subido, v_org_id, v_asesor_a1, '91902900029');
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(
    v_exp_acuse_subido, v_org_id, v_asesor_a1, 'con_sello', 'validado'
  );
  UPDATE public.expediente_documentos SET estatus_revision = 'subido'
  WHERE expediente_id = v_exp_acuse_subido AND tipo_documento = 'retencion_acuse_con_sello';

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_acuse_rech, v_org_id, v_asesor_a1, '91903000030');
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(
    v_exp_acuse_rech, v_org_id, v_asesor_a1, 'con_sello', 'validado'
  );
  UPDATE public.expediente_documentos SET estatus_revision = 'rechazado'
  WHERE expediente_id = v_exp_acuse_rech AND tipo_documento = 'retencion_acuse_con_sello';

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_docs_a_ok, v_org_id, v_asesor_a1, '91903100031');

  -- Documentos opción B
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_falta_carta, v_org_id, v_asesor_a1, '91903200032', 'sin_sello');
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(
    v_exp_falta_carta, v_org_id, v_asesor_a1, 'sin_sello', 'validado', 'retencion_carta_sin_sello'
  );

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_carta_subido, v_org_id, v_asesor_a1, '91903300033', 'sin_sello');
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(
    v_exp_carta_subido, v_org_id, v_asesor_a1, 'sin_sello', 'validado'
  );
  UPDATE public.expediente_documentos SET estatus_revision = 'resubido'
  WHERE expediente_id = v_exp_carta_subido AND tipo_documento = 'retencion_carta_sin_sello';

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_docs_b_ok, v_org_id, v_asesor_a1, '91903400034', 'sin_sello');

  -- Efectos colaterales
  PERFORM public.__rpc_avanzar_89_test_insert_expediente(
    v_exp_fecha, v_org_id, v_asesor_a1, '91903500035', 'interno', true, 8::smallint,
    'en_proceso', v_fecha_cita
  );
  PERFORM public.__rpc_avanzar_89_test_insert_cliente(v_exp_fecha, v_org_id, 'validado');
  PERFORM public.__rpc_avanzar_89_test_insert_envio(v_exp_fecha, v_org_id);
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(v_exp_fecha, v_org_id, v_asesor_a1, 'con_sello', 'validado');

  PERFORM public.__rpc_avanzar_89_test_insert_expediente(v_exp_booking, v_org_id, v_asesor_a1, '91903600036');
  PERFORM public.__rpc_avanzar_89_test_insert_cliente(v_exp_booking, v_org_id, 'validado');
  PERFORM public.__rpc_avanzar_89_test_insert_envio(v_exp_booking, v_org_id);
  PERFORM public.__rpc_avanzar_89_test_insert_docs_opcion(v_exp_booking, v_org_id, v_asesor_a1, 'con_sello', 'validado');
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org_id, 'biometricos', v_exp_booking, CURRENT_DATE - 1, '10:00:00',
    'sede-fixture', 'booked', v_asesor_a1
  ) RETURNING id INTO v_booking_id;

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_side, v_org_id, v_asesor_a1, '91903700037');
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_log, v_org_id, v_asesor_a1, '91903800038');
  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_no_810, v_org_id, v_asesor_a1, '91903900039');

  PERFORM public.__rpc_avanzar_89_test_setup_listo(v_exp_etapa9, v_org_id, v_asesor_a1, '91904000040');
  UPDATE public.expedientes SET etapa_actual = 9 WHERE id = v_exp_etapa9;

  PERFORM public.__rpc_avanzar_89_test_insert_expediente(
    v_exp_sanity_78, v_org_id, v_asesor_a1, '91904100041', 'interno', true, 7::smallint
  );

  -- 1. mesa_admin con_sello
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_ok_a, 'retención ok A');
  PERFORM public.__rpc_avanzar_89_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 9
      AND v_result->>'retencion_opcion' = 'con_sello',
    'test 1: mesa_admin 8→9 con_sello'
  );

  -- 2. mesa_admin sin_sello
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_ok_b);
  PERFORM public.__rpc_avanzar_89_test_assert(
    (v_result->>'etapa_actual')::int = 9 AND v_result->>'retencion_opcion' = 'sin_sello',
    'test 2: mesa_admin 8→9 sin_sello'
  );

  -- 3–5. roles mesa
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_int, v_exp_int);
  PERFORM public.__rpc_avanzar_89_test_assert((v_result->>'ok')::boolean = true, 'test 3: mesa_interno');
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_ext, v_exp_int_block), 'test 4: mesa_externo bloqueado'
  );
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_ext, v_exp_ext);
  PERFORM public.__rpc_avanzar_89_test_assert((v_result->>'ok')::boolean = true, 'test 5: mesa_externo externo');

  -- 6. super_admin
  v_result := public.__rpc_avanzar_89_test_call_as(v_super_admin, v_exp_super);
  PERFORM public.__rpc_avanzar_89_test_assert((v_result->>'etapa_actual')::int = 9, 'test 6: super_admin');

  -- 7–8. asesor/editor bloqueados
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_asesor_a1, v_exp_roles), 'test 7: asesor'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_editor, v_exp_roles), 'test 8: editor'
  );

  -- 9. etapa 7 no salta a 9 (rama 7→8)
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_etapa7);
  PERFORM public.__rpc_avanzar_89_test_assert(
    (v_result->>'etapa_actual')::int = 8, 'test 9: etapa 7 no salta a 9'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_not_sent), 'test 10: no enviado a mesa'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_deleted), 'test 11: soft-deleted'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_ciclo), 'test 12: ciclo no activo'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_bad_sub), 'test 13: subestado'
  );

  -- 14–15. cliente_datos
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_no_cliente), 'test 14: sin cliente_datos'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_cliente_pend), 'test 15: cliente no validado'
  );

  -- 16–19. retención envío
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_no_envio), 'test 16: sin retencion_envios'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_no_enviado), 'test 17: enviado=false'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_correccion), 'test 18: correccion_requerida'
  );
  -- 19: schema NOT NULL en opcion; equivalente: envío ausente (test 16). Verificar avance con solo envio.opcion:
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_fallback);
  PERFORM public.__rpc_avanzar_89_test_assert(
    (v_result->>'etapa_actual')::int = 9, 'test 19: opción desde retencion_envios.opcion (sin retencion_opciones)'
  );

  -- 20–23. documentos opción A
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_falta_acuse), 'test 20: falta acuse'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_acuse_subido), 'test 21: acuse subido'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_acuse_rech), 'test 22: acuse rechazado'
  );
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_docs_a_ok);
  PERFORM public.__rpc_avanzar_89_test_assert(
    (v_result->>'etapa_actual')::int = 9
      AND jsonb_array_length(v_result->'required_documentos') = 1,
    'test 23: documento principal opción A validado'
  );

  -- 24–26. documentos opción B
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_falta_carta), 'test 24: falta carta'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_carta_subido), 'test 25: carta resubido'
  );
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_docs_b_ok);
  PERFORM public.__rpc_avanzar_89_test_assert(
    (v_result->>'etapa_actual')::int = 9, 'test 26: documento principal opción B validado'
  );

  -- 27. actualiza etapa 9
  PERFORM public.__rpc_avanzar_89_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_docs_b_ok AND e.etapa_actual = 9 AND e.subestado = 'en_proceso'
    ),
    'test 27: etapa y subestado'
  );

  -- 28. conserva fecha_cita
  SELECT e.fecha_cita INTO v_fecha_before FROM public.expedientes e WHERE e.id = v_exp_fecha;
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_fecha);
  PERFORM public.__rpc_avanzar_89_test_assert(
    EXISTS (SELECT 1 FROM public.expedientes e WHERE e.id = v_exp_fecha AND e.fecha_cita = v_fecha_before),
    'test 28: fecha_cita'
  );

  -- 29. no crea/cancela bookings
  SELECT count(*) INTO v_booking_count_before FROM public.agenda_bookings b WHERE b.expediente_id = v_exp_booking;
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_booking);
  SELECT count(*) INTO v_booking_count_after FROM public.agenda_bookings b WHERE b.expediente_id = v_exp_booking;
  PERFORM public.__rpc_avanzar_89_test_assert(
    v_booking_count_after = v_booking_count_before
      AND EXISTS (SELECT 1 FROM public.agenda_bookings b WHERE b.id = v_booking_id AND b.status = 'booked'),
    'test 29: bookings'
  );

  -- 30–33. no modifica retención, documentos ni cliente_datos
  SELECT ro.retencion_opcion INTO v_ret_opcion_before FROM public.retencion_opciones ro WHERE ro.expediente_id = v_exp_side;
  SELECT re.enviado, re.estado INTO v_ret_envio_before, v_ret_estado_before
  FROM public.retencion_envios re WHERE re.expediente_id = v_exp_side;
  SELECT count(*) INTO v_doc_count_before FROM public.expediente_documentos d WHERE d.expediente_id = v_exp_side;
  SELECT cd.estado INTO v_cliente_estado_before FROM public.cliente_datos cd WHERE cd.expediente_id = v_exp_side;
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_side);
  SELECT count(*) INTO v_doc_count_after FROM public.expediente_documentos d WHERE d.expediente_id = v_exp_side;
  PERFORM public.__rpc_avanzar_89_test_assert(
    EXISTS (
      SELECT 1 FROM public.retencion_opciones ro
      WHERE ro.expediente_id = v_exp_side AND ro.retencion_opcion = v_ret_opcion_before
    )
    AND EXISTS (
      SELECT 1 FROM public.retencion_envios re
      WHERE re.expediente_id = v_exp_side
        AND re.enviado = v_ret_envio_before AND re.estado = v_ret_estado_before
    ),
    'test 30-31: retención intacta'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    v_doc_count_after = v_doc_count_before AND v_doc_count_before = 1, 'test 32: documentos'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    EXISTS (
      SELECT 1 FROM public.cliente_datos cd
      WHERE cd.expediente_id = v_exp_side AND cd.estado = v_cliente_estado_before
    ),
    'test 33: cliente_datos'
  );

  -- 34. action_log
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_log, 'avance 8-9');
  PERFORM public.__rpc_avanzar_89_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_id = v_exp_log
        AND al.action = 'expediente.avanzar_etapa_operativa'
        AND (al.payload->>'etapa_anterior')::int = 8
        AND (al.payload->>'etapa_nueva')::int = 9
        AND al.payload->>'transition' = '8_9'
        AND al.payload ? 'retencion_opcion'
        AND al.payload ? 'required_documentos'
    ),
    'test 34: action_log'
  );

  -- 35. no 8→10 directo (una llamada solo llega a 9)
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_no_810);
  PERFORM public.__rpc_avanzar_89_test_assert(
    (v_result->>'etapa_actual')::int = 9, 'test 35: una llamada 8→9, no 10'
  );
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_no_810), 'test 35b: desde 9 no avanza'
  );

  -- 36. expediente en 9 no avanza a 10
  PERFORM public.__rpc_avanzar_89_test_assert(
    public.__rpc_avanzar_89_test_call_expect_fail(v_mesa_admin, v_exp_etapa9), 'test 36: etapa 9 bloqueada'
  );

  -- 37. regresión 7→8
  v_result := public.__rpc_avanzar_89_test_call_as(v_mesa_admin, v_exp_sanity_78);
  PERFORM public.__rpc_avanzar_89_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 8,
    'test 37: sanity 7→8'
  );

  -- 38. no revisor
  SELECT COUNT(*) INTO v_roles_revisor
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__rpc_avanzar_89_test_assert(v_roles_revisor = 0, 'test 38: sin rol revisor');

  RAISE NOTICE 'RPC avanzar_etapa_operativa 8→9: 38 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_setup_listo(UUID, UUID, UUID, CHAR, public.retencion_opcion, public.origen_mesa);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_insert_docs_opcion(UUID, UUID, UUID, public.retencion_opcion, public.estatus_revision, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_insert_doc(UUID, UUID, UUID, TEXT, public.estatus_revision);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_insert_envio(UUID, UUID, public.retencion_opcion, BOOLEAN, public.retencion_envio_estado, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_insert_cliente(UUID, UUID, public.cliente_datos_estado);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_insert_expediente(UUID, UUID, UUID, CHAR, public.origen_mesa, BOOLEAN, SMALLINT, public.operativo_subestado, TIMESTAMPTZ, TIMESTAMPTZ, public.expediente_ciclo_estado);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_call_expect_fail(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_call_as(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_89_test_assert(BOOLEAN, TEXT);
