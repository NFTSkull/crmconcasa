-- ConCasa CRM — P117: MIME Acuse + avance 8→9 al registrar principal
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p117_ret_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P117 RET TEST FAIL: %', p_msg; END IF; END; $$;

CREATE OR REPLACE FUNCTION public.__p117_ret_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p117_ret_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_exp UUID := '00000000-0000-4000-8117-000000000001';
  v_exp2 UUID := '00000000-0000-4000-8117-000000000002';
  v_exp3 UUID := '00000000-0000-4000-8117-000000000003';
  v_path TEXT;
  v_result JSONB;
  v_etapa SMALLINT;
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_a1, 'mejoravit', '92171000011', 'P117 JPG', '5522222201', 'interno', true, NOW(), 8, 'en_proceso', 'activo'),
    (v_exp2, v_org, v_a1, 'mejoravit', '92171000012', 'P117 PNG', '5522222202', 'interno', true, NOW(), 8, 'en_proceso', 'activo'),
    (v_exp3, v_org, v_a1, 'mejoravit', '92171000013', 'P117 aviso', '5522222203', 'interno', true, NOW(), 8, 'en_proceso', 'activo')
  ON CONFLICT (id) DO UPDATE SET
    etapa_actual = 8, subestado = 'en_proceso', ciclo_estado = 'activo',
    submitted_to_mesa = true, deleted_at = NULL, updated_at = NOW();

  DELETE FROM public.expediente_documentos WHERE expediente_id IN (v_exp, v_exp2, v_exp3);
  DELETE FROM public.retencion_envios WHERE expediente_id IN (v_exp, v_exp2, v_exp3);
  DELETE FROM public.retencion_opciones WHERE expediente_id IN (v_exp, v_exp2, v_exp3);

  -- JPEG principal avanza
  v_path := v_org::text || '/' || v_exp::text || '/retencion_acuse_con_sello/acuse.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_a1::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;
  PERFORM public.__p117_ret_set_auth(v_a1);
  SELECT public.register_expediente_documento_retencion(
    v_exp, 'retencion_acuse_con_sello', v_path, 'acuse.jpg', 'image/jpeg', 2048
  ) INTO v_result;
  PERFORM public.__p117_ret_reset_auth();
  PERFORM public.__p117_ret_assert((v_result->>'ok')::boolean, 'jpg ok');
  PERFORM public.__p117_ret_assert((v_result->>'avance_8_9')::boolean, 'jpg avanza');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p117_ret_assert(v_etapa = 9, 'jpg etapa 9');

  -- PNG carta sin sello avanza
  v_path := v_org::text || '/' || v_exp2::text || '/retencion_carta_sin_sello/carta.png';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_a1::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;
  PERFORM public.__p117_ret_set_auth(v_a1);
  SELECT public.register_expediente_documento_retencion(
    v_exp2, 'retencion_carta_sin_sello', v_path, 'carta.png', 'image/png', 2048
  ) INTO v_result;
  PERFORM public.__p117_ret_reset_auth();
  PERFORM public.__p117_ret_assert((v_result->>'avance_8_9')::boolean, 'png avanza');

  -- aviso (no principal) no avanza
  v_path := v_org::text || '/' || v_exp3::text || '/retencion_aviso_retencion/aviso.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_a1::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;
  PERFORM public.__p117_ret_set_auth(v_a1);
  SELECT public.register_expediente_documento_retencion(
    v_exp3, 'retencion_aviso_retencion', v_path, 'aviso.pdf', 'application/pdf', 1024
  ) INTO v_result;
  PERFORM public.__p117_ret_reset_auth();
  PERFORM public.__p117_ret_assert(COALESCE((v_result->>'avance_8_9')::boolean, false) = false, 'aviso no avanza');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp3;
  PERFORM public.__p117_ret_assert(v_etapa = 8, 'aviso sigue en 8');

  -- webp rechazado en principal
  v_path := v_org::text || '/' || v_exp3::text || '/retencion_acuse_con_sello/bad.webp';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_a1::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;
  PERFORM public.__p117_ret_set_auth(v_a1);
  BEGIN
    PERFORM public.register_expediente_documento_retencion(
      v_exp3, 'retencion_acuse_con_sello', v_path, 'bad.webp', 'image/webp', 1024
    );
    RAISE EXCEPTION 'P117 RET TEST FAIL: webp debía rechazarse';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p117_ret_assert(SQLERRM ILIKE '%mime%', 'webp mime rechazado');
  END;
  PERFORM public.__p117_ret_reset_auth();

  -- reemplazo en etapa 9 no re-avanza
  v_path := v_org::text || '/' || v_exp::text || '/retencion_acuse_con_sello/acuse2.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_a1::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;
  PERFORM public.__p117_ret_set_auth(v_a1);
  SELECT public.register_expediente_documento_retencion(
    v_exp, 'retencion_acuse_con_sello', v_path, 'acuse2.pdf', 'application/pdf', 1024
  ) INTO v_result;
  PERFORM public.__p117_ret_reset_auth();
  PERFORM public.__p117_ret_assert(COALESCE((v_result->>'avance_8_9')::boolean, false) = false, 'reemplazo 9 no avanza');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p117_ret_assert(v_etapa = 9, 'sigue en 9');

  RAISE NOTICE 'P117 register retención: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p117_ret_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p117_ret_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p117_ret_reset_auth();
