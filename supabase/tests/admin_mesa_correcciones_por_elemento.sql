-- P085: correcciones por elemento (casos A–F) + unicidad 1 fila
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p085c_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P085 CORRECCION FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8085-000000000001';
  v_asesor UUID := '00000000-0000-4000-8085-000000000002';
  v_mesa UUID := '00000000-0000-4000-8085-000000000003';
  v_exp UUID := '00000000-0000-4000-9085-000000000001';
  v_ine UUID := '00000000-0000-4000-9185-000000000001';
  v_comp UUID := '00000000-0000-4000-9185-000000000002';
  v_ine2 UUID := '00000000-0000-4000-9185-000000000003';
  v_from TIMESTAMPTZ := timestamptz '2026-07-01 00:00:00+00';
  v_to TIMESTAMPTZ := timestamptz '2026-08-01 00:00:00+00';
  v_abiertas INTEGER;
  v_reenviadas INTEGER;
  v_rows BIGINT;
BEGIN
  INSERT INTO public.organizations (id, slug, name)
  VALUES (v_org, 'p085-corr-org', 'P085 Corr Org')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'asesor.p085c@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
    (v_mesa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'mesa.p085c@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES
    (v_asesor, v_org, 'asesor.p085c@test.local', 'Asesor P085C', 'asesor', true),
    (v_mesa, v_org, 'mesa.p085c@test.local', 'Mesa P085C', 'mesa_admin', true)
  ON CONFLICT (id) DO UPDATE SET active = true, organization_id = EXCLUDED.organization_id;

  DELETE FROM public.documento_revisiones WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp;
  DELETE FROM public.action_log WHERE entity_id = v_exp;
  DELETE FROM public.cliente_datos WHERE expediente_id = v_exp;
  DELETE FROM public.retencion_envios WHERE expediente_id = v_exp;
  DELETE FROM public.editor_decisions WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '08500000085', 'P085 Cliente', '8110000085',
    'interno', true, timestamptz '2026-07-10 12:00:00+00', 1, 'en_validacion_mesa', 'activo'
  );

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'pendiente');

  -- INE reverso rechazado
  INSERT INTO public.expediente_documentos (
    id, expediente_id, organization_id, tipo_documento, storage_path, nombre_original,
    mime_type, size_bytes, version, estatus_revision, comentario_mesa,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_ine, v_exp, v_org, 'ine_reverso', v_org::text || '/' || v_exp::text || '/ine_reverso/v1',
    'ine.pdf', 'application/pdf', 100, 1, 'rechazado', 'Ilegible',
    v_asesor, 'asesor'
  );

  INSERT INTO public.documento_revisiones (
    documento_id, expediente_id, organization_id, actor_id,
    estatus_anterior, estatus_nuevo, comentario_mesa
  ) VALUES (
    v_ine, v_exp, v_org, v_mesa, 'subido', 'rechazado', 'Ilegible'
  );

  INSERT INTO public.expediente_documentos (
    id, expediente_id, organization_id, tipo_documento, storage_path, nombre_original,
    mime_type, size_bytes, version, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    v_comp, v_exp, v_org, 'comprobante_domicilio',
    v_org::text || '/' || v_exp::text || '/comprobante_domicilio/v1',
    'comp.pdf', 'application/pdf', 100, 1, 'subido', v_asesor, 'asesor'
  );

  -- Caso A: reemplazar comprobante no cierra INE
  UPDATE public.expediente_documentos SET deleted_at = now() WHERE id = v_comp;
  INSERT INTO public.expediente_documentos (
    expediente_id, organization_id, tipo_documento, storage_path, nombre_original,
    mime_type, size_bytes, version, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    v_exp, v_org, 'comprobante_domicilio',
    v_org::text || '/' || v_exp::text || '/comprobante_domicilio/v2',
    'comp2.pdf', 'application/pdf', 110, 2, 'subido', v_asesor, 'asesor'
  );

  SELECT
    (SELECT count(*)::INTEGER FROM public.expediente_documentos d
      WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL AND d.estatus_revision = 'rechazado'),
    (SELECT count(*)::INTEGER FROM public.expediente_documentos d
      WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL AND d.estatus_revision = 'resubido')
  INTO v_abiertas, v_reenviadas;
  PERFORM public.__p085c_assert(v_abiertas = 1 AND v_reenviadas = 0, 'caso A: INE sigue abierta');

  -- Caso B: reemplazar INE → resubido
  UPDATE public.expediente_documentos SET deleted_at = now() WHERE id = v_ine;
  INSERT INTO public.expediente_documentos (
    id, expediente_id, organization_id, tipo_documento, storage_path, nombre_original,
    mime_type, size_bytes, version, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    v_ine2, v_exp, v_org, 'ine_reverso',
    v_org::text || '/' || v_exp::text || '/ine_reverso/v2',
    'ine2.pdf', 'application/pdf', 120, 2, 'resubido', v_asesor, 'asesor'
  );

  SELECT
    (SELECT count(*)::INTEGER FROM public.expediente_documentos d
      WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL AND d.estatus_revision = 'rechazado'),
    (SELECT count(*)::INTEGER FROM public.expediente_documentos d
      WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL AND d.estatus_revision = 'resubido')
  INTO v_abiertas, v_reenviadas;
  PERFORM public.__p085c_assert(v_abiertas = 0 AND v_reenviadas = 1, 'caso B: reenviada esperando Mesa');

  -- Caso C: Mesa valida → cierra
  UPDATE public.expediente_documentos SET estatus_revision = 'validado' WHERE id = v_ine2;
  PERFORM public.__p085c_assert(
    (SELECT count(*) FROM public.expediente_documentos d
      WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL
        AND d.estatus_revision IN ('rechazado', 'resubido')) = 0,
    'caso C: corrección cerrada'
  );

  -- Caso D: dos rechazados, uno resubido
  UPDATE public.expediente_documentos SET deleted_at = now() WHERE expediente_id = v_exp;
  INSERT INTO public.expediente_documentos (
    expediente_id, organization_id, tipo_documento, storage_path, nombre_original,
    mime_type, size_bytes, version, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES
    (v_exp, v_org, 'ine_reverso', v_org::text || '/' || v_exp::text || '/ine/v3',
     'ine.pdf', 'application/pdf', 1, 3, 'rechazado', v_asesor, 'asesor'),
    (v_exp, v_org, 'comprobante_domicilio', v_org::text || '/' || v_exp::text || '/comp/v3',
     'c.pdf', 'application/pdf', 1, 3, 'resubido', v_asesor, 'asesor');

  SELECT
    (SELECT count(*)::INTEGER FROM public.expediente_documentos d
      WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL AND d.estatus_revision = 'rechazado'),
    (SELECT count(*)::INTEGER FROM public.expediente_documentos d
      WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL AND d.estatus_revision = 'resubido')
  INTO v_abiertas, v_reenviadas;
  PERFORM public.__p085c_assert(
    v_abiertas = 1 AND v_reenviadas = 1,
    'caso D: 1 pendiente + 1 reenviada'
  );

  -- Caso E: datos generales rechazados; tocar documento no cierra datos
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, comentario_rechazo, rejected_at, updated_at
  ) VALUES (
    v_exp, v_org, '{"rfc":"XAXX010101000"}'::jsonb, 'rechazado', 'RFC inválido', now(), now()
  ) ON CONFLICT (expediente_id) DO UPDATE
    SET estado = 'rechazado', comentario_rechazo = 'RFC inválido', rejected_at = now();

  UPDATE public.expediente_documentos
  SET nombre_original = 'c-touched.pdf'
  WHERE expediente_id = v_exp AND tipo_documento = 'comprobante_domicilio' AND deleted_at IS NULL;

  PERFORM public.__p085c_assert(
    EXISTS (
      SELECT 1 FROM public.cliente_datos cd
      WHERE cd.expediente_id = v_exp AND cd.estado = 'rechazado'
    ),
    'caso E: datos generales siguen rechazados'
  );

  -- Caso F: retención correccion_requerida → reenvío principal
  DELETE FROM public.cliente_datos WHERE expediente_id = v_exp;
  UPDATE public.expediente_documentos SET deleted_at = now() WHERE expediente_id = v_exp;
  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_exp;

  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, opcion, estado, updated_at
  ) VALUES (
    v_exp, v_org, true, 'con_sello', 'correccion_requerida', now()
  ) ON CONFLICT (expediente_id) DO UPDATE
    SET estado = 'correccion_requerida', updated_at = now();

  PERFORM public.__p085c_assert(
    EXISTS (
      SELECT 1 FROM public.retencion_envios re
      WHERE re.expediente_id = v_exp AND re.estado = 'correccion_requerida'
    ),
    'caso F prep: retención abierta'
  );

  INSERT INTO public.expediente_documentos (
    expediente_id, organization_id, tipo_documento, storage_path, nombre_original,
    mime_type, size_bytes, version, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    v_exp, v_org, 'retencion_acuse_con_sello',
    v_org::text || '/' || v_exp::text || '/retencion/v1',
    'acuse.pdf', 'application/pdf', 1, 1, 'resubido', v_asesor, 'asesor'
  );
  UPDATE public.retencion_envios
  SET estado = 'enviado', updated_at = now()
  WHERE expediente_id = v_exp;

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload
  ) VALUES (
    v_org, v_asesor, 'asesor', 'expediente.enviar_retencion_mesa', 'expediente', v_exp,
    jsonb_build_object('is_resend', true)
  );

  PERFORM public.__p085c_assert(
    EXISTS (
      SELECT 1 FROM public.retencion_envios re
      WHERE re.expediente_id = v_exp AND re.estado = 'enviado'
    )
    AND EXISTS (
      SELECT 1 FROM public.expediente_documentos d
      WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL
        AND d.tipo_documento LIKE 'retencion_%'
        AND d.estatus_revision = 'resubido'
    ),
    'caso F: retención reenviada (esperando Mesa / contrato vigente)'
  );

  -- Unicidad: múltiples action_log no multiplican cohorte ni joins laterales
  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload
  )
  SELECT v_org, v_mesa, 'mesa_admin', 'documento.revision.update', 'expediente', v_exp,
         jsonb_build_object('tipo_documento', 'ine_reverso', 'estatus_nuevo', 'rechazado')
  FROM generate_series(1, 8);

  SELECT count(*) INTO v_rows
  FROM public.expedientes e
  WHERE e.id = v_exp AND e.deleted_at IS NULL AND e.submitted_to_mesa
    AND e.fecha_envio_mesa >= v_from AND e.fecha_envio_mesa < v_to;
  PERFORM public.__p085c_assert(v_rows = 1, 'unicidad: 1 expediente = 1 fila cohorte');

  SELECT count(*) INTO v_rows
  FROM public.expedientes e
  LEFT JOIN LATERAL (
    SELECT al.action
    FROM public.action_log al
    WHERE (al.entity_type = 'expediente' AND al.entity_id = e.id)
    ORDER BY al.created_at DESC
    LIMIT 1
  ) act ON TRUE
  LEFT JOIN LATERAL (
    SELECT count(*)::INTEGER AS n
    FROM public.expediente_documentos d
    WHERE d.expediente_id = e.id AND d.deleted_at IS NULL AND d.estatus_revision = 'rechazado'
  ) corr ON TRUE
  WHERE e.id = v_exp;
  PERFORM public.__p085c_assert(v_rows = 1, 'unicidad: joins laterales no multiplican fila');
END;
$$;

DROP FUNCTION IF EXISTS public.__p085c_assert(BOOLEAN, TEXT);
