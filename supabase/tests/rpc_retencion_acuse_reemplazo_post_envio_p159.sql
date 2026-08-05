-- ConCasa CRM — Hotfix Acuse: reemplazo post-envío (etapa 9) sin corrección Mesa
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p159_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P159 ACUSE REPLACE FAIL: %', p_msg; END IF; END; $$;

CREATE OR REPLACE FUNCTION public.__p159_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p159_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_exp UUID := '00000000-0000-4000-8159-000000000001';
  v_path1 TEXT;
  v_path2 TEXT;
  v_path_ajeno TEXT;
  v_result JSONB;
  v_etapa SMALLINT;
  v_sub TEXT;
  v_opcion TEXT;
  v_envio_estado TEXT;
  v_activos INT;
  v_activo_nombre TEXT;
  v_prev_deleted TIMESTAMPTZ;
BEGIN
  -- Dueño + ajeno (si el seed de a2 no existe, crear perfil mínimo no aplica aquí:
  -- el harness org/asesores suele existir en CI; usamos a1 como dueño y forzamos
  -- asesor_id distinto vía UPDATE solo si a2 existe.
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado, firma_agendable_desde
  ) VALUES (
    v_exp, v_org, v_a1, 'mejoravit', '92158000011', 'P159 Replace',
    '5533333301', 'interno', true, NOW(), 9, 'en_proceso', 'activo',
    (NOW() AT TIME ZONE 'America/Monterrey')::DATE
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = v_a1,
    etapa_actual = 9,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    submitted_to_mesa = true,
    deleted_at = NULL,
    updated_at = NOW();

  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp;
  DELETE FROM public.retencion_envios WHERE expediente_id = v_exp;
  DELETE FROM public.retencion_opciones WHERE expediente_id = v_exp;

  INSERT INTO public.retencion_opciones (expediente_id, organization_id, retencion_opcion, updated_by)
  VALUES (v_exp, v_org, 'con_sello', v_a1);

  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado
  ) VALUES (v_exp, v_org, true, NOW(), 'con_sello', 'enviado');

  -- v1 validado (simula aceptado por Mesa)
  v_path1 := v_org::text || '/' || v_exp::text || '/retencion_acuse_con_sello/acuse-v1.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path1, v_a1::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'retencion_acuse_con_sello', v_path1,
    'acuse-v1.pdf', 'application/pdf', 1024, 1, 'validado',
    v_a1, 'asesor'
  );

  -- Reemplazo exitoso por dueño (JPG)
  v_path2 := v_org::text || '/' || v_exp::text || '/retencion_acuse_con_sello/acuse-v2.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path2, v_a1::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;

  PERFORM public.__p159_set_auth(v_a1);
  SELECT public.register_expediente_documento_retencion(
    v_exp, 'retencion_acuse_con_sello', v_path2, 'acuse-v2.jpg', 'image/jpeg', 2048
  ) INTO v_result;
  PERFORM public.__p159_reset_auth();

  PERFORM public.__p159_assert((v_result->>'ok')::boolean, 'replace ok');
  PERFORM public.__p159_assert(NOT COALESCE((v_result->>'avance_8_9')::boolean, false), 'no re-avanza 8→9');

  SELECT etapa_actual, subestado::text INTO v_etapa, v_sub
  FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p159_assert(v_etapa = 9, 'etapa intacta 9');
  PERFORM public.__p159_assert(v_sub = 'en_proceso', 'subestado intacto');

  SELECT retencion_opcion::text INTO v_opcion FROM public.retencion_opciones WHERE expediente_id = v_exp;
  PERFORM public.__p159_assert(v_opcion = 'con_sello', 'opcion A intacta');

  SELECT estado::text INTO v_envio_estado FROM public.retencion_envios WHERE expediente_id = v_exp;
  PERFORM public.__p159_assert(v_envio_estado = 'enviado', 'envio estado intacto');

  SELECT count(*)::int INTO v_activos
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp
    AND tipo_documento = 'retencion_acuse_con_sello'
    AND deleted_at IS NULL;
  PERFORM public.__p159_assert(v_activos = 1, 'una sola version activa');

  SELECT nombre_original INTO v_activo_nombre
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp
    AND tipo_documento = 'retencion_acuse_con_sello'
    AND deleted_at IS NULL;
  PERFORM public.__p159_assert(v_activo_nombre = 'acuse-v2.jpg', 'mesa ve archivo nuevo');

  SELECT deleted_at INTO v_prev_deleted
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp
    AND tipo_documento = 'retencion_acuse_con_sello'
    AND nombre_original = 'acuse-v1.pdf';
  PERFORM public.__p159_assert(v_prev_deleted IS NOT NULL, 'version anterior inactiva');

  -- Asesor ajeno bloqueado (solo si existe perfil a2 en harness)
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_a2 AND p.active) THEN
    v_path_ajeno := v_org::text || '/' || v_exp::text || '/retencion_acuse_con_sello/acuse-ajeno.pdf';
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('expediente-documentos', v_path_ajeno, v_a2::text)
    ON CONFLICT (bucket_id, name) DO NOTHING;
    BEGIN
      PERFORM public.__p159_set_auth(v_a2);
      PERFORM public.register_expediente_documento_retencion(
        v_exp, 'retencion_acuse_con_sello', v_path_ajeno, 'acuse-ajeno.pdf', 'application/pdf', 1024
      );
      PERFORM public.__p159_reset_auth();
      RAISE EXCEPTION 'P159 ACUSE REPLACE FAIL: asesor ajeno debio fallar';
    EXCEPTION
      WHEN OTHERS THEN
        PERFORM public.__p159_reset_auth();
        IF SQLERRM LIKE '%P159 ACUSE REPLACE FAIL:%' THEN
          RAISE;
        END IF;
        PERFORM public.__p159_assert(
          SQLERRM ILIKE '%asesor dueño%' OR SQLERRM ILIKE '%no autorizado%' OR SQLERRM ILIKE '%organización%',
          'asesor ajeno bloqueado: ' || SQLERRM
        );
    END;

    SELECT count(*)::int INTO v_activos
    FROM public.expediente_documentos
    WHERE expediente_id = v_exp
      AND tipo_documento = 'retencion_acuse_con_sello'
      AND deleted_at IS NULL;
    PERFORM public.__p159_assert(v_activos = 1, 'ajeno no dejo segunda activa');
  END IF;

  RAISE NOTICE 'P159 Acuse reemplazo post-envio OK';
END;
$$;

DROP FUNCTION public.__p159_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p159_set_auth(UUID);
DROP FUNCTION public.__p159_reset_auth();
