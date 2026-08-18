-- Hotfix 192: P130 pendiente_revision → correccion_enviada en Mesa + Asesor.
-- Casos A–H + Luis-like. Sin UPDATE de lotes/expedientes de producción (fixtures locales).
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p192_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P192 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p192_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p192_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'expediente_tiene_correccion_asesor_pendiente'
  LIMIT 1;
  PERFORM public.__p192_assert(v_src IS NOT NULL, 'helper canónico existe');
  PERFORM public.__p192_assert(position('pendiente_revision' in v_src) > 0, 'helper status pendiente');
  PERFORM public.__p192_assert(position('submitted_at IS NOT NULL' in v_src) > 0, 'helper submitted_at');
  PERFORM public.__p192_assert(position('STABLE' in v_src) > 0, 'helper STABLE');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_categoria_resumen'
  LIMIT 1;
  PERFORM public.__p192_assert(
    position('expediente_tiene_correccion_asesor_pendiente' in v_src) > 0,
    'categoria Mesa usa helper'
  );
  PERFORM public.__p192_assert(position('etapa_actual' in v_src) = 0, 'categoria Mesa sin stage gate');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
  LIMIT 1;
  PERFORM public.__p192_assert(
    position('mesa_bandeja_categoria_resumen' in v_src) > 0,
    'lista hereda categoria'
  );
  PERFORM public.__p192_assert(
    position('expediente_asesor_cambio_lotes' in v_src) = 0,
    'lista no duplica predicado P130'
  );
  PERFORM public.__p192_assert(position('correccionesEnviadas' in v_src) > 0, 'count correccionesEnviadas');
  PERFORM public.__p192_assert(position('correccion_enviada' in v_src) > 0, 'quick correccion_enviada');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_categoria_correccion'
  LIMIT 1;
  PERFORM public.__p192_assert(
    position('expediente_tiene_correccion_asesor_pendiente' in v_src) > 0,
    'categoria Asesor usa helper'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_bandeja_sort_ts'
  LIMIT 1;
  PERFORM public.__p192_assert(position('pendiente_revision' in v_src) > 0, 'sort usa P130');
  PERFORM public.__p192_assert(position('submitted_at' in v_src) > 0, 'sort submitted_at');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mesa_marcar_asesor_cambios_revisados'
  LIMIT 1;
  PERFORM public.__p192_assert(v_src IS NOT NULL, 'marcar revisado intacto');
  PERFORM public.__p192_assert(position('status = ''revisado''' in v_src) > 0, 'marcar pone revisado');

  RAISE NOTICE 'P192 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_exp UUID;
  v_exp_b UUID;
  v_lote UUID;
  v_envio TIMESTAMPTZ := timestamptz '2026-07-01 10:00:00+00';
  v_submit TIMESTAMPTZ := timestamptz '2026-07-20 18:00:00+00';
  v_submit2 TIMESTAMPTZ := timestamptz '2026-07-21 12:00:00+00';
  v_sort TIMESTAMPTZ;
  v_page JSONB;
  v_count INT;
  v_cat TEXT;
BEGIN
  -- A. P130 cliente_* subido (no resubido) + lote pendiente
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192120001',
    'P192 Caso A cliente', '5519210001', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_comprobante_domicilio',
    v_org::text || '/' || v_exp::text || '/cliente_comprobante_domicilio/p192.pdf',
    'dom.pdf', 'application/pdf', 100, 1, 'subido',
    v_asesor, 'asesor'
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (
    v_org, v_exp, v_asesor, 'pendiente_revision', v_submit
  );
  PERFORM public.__p192_assert(
    public.expediente_tiene_correccion_asesor_pendiente(v_exp) IS TRUE,
    'A helper true'
  );
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'A Mesa enviada'
  );
  PERFORM public.__p192_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_enviada',
    'A Asesor enviada'
  );

  -- B. P130 campo DG sin doc resubido
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192120002',
    'P192 Caso B DG', '5519210002', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (
    v_org, v_exp, v_asesor, 'pendiente_revision', v_submit
  );
  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, entidad, campo, label
  )
  SELECT l.id, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC'
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.expediente_id = v_exp AND l.status = 'pendiente_revision'
  LIMIT 1;
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'B Mesa enviada'
  );
  PERFORM public.__p192_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_enviada',
    'B Asesor enviada'
  );

  -- C. DG rechazado + lote pendiente → enviada (vence correccion_requerida)
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192120003',
    'P192 Caso C vence', '5519210003', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (
    v_org, v_exp, v_asesor, 'pendiente_revision', v_submit
  );
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'C Mesa enviada sobre requerida'
  );
  PERFORM public.__p192_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_enviada',
    'C Asesor enviada sobre requerida'
  );

  -- D. lote revisado → no P130 enviada (cae a legacy; DG completo sin timestamp post-mesa)
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192120004',
    'P192 Caso D revisado', '5519210004', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at
  ) VALUES (
    v_org, v_exp, v_asesor, 'revisado', v_submit, v_submit + interval '1 hour'
  );
  PERFORM public.__p192_assert(
    public.expediente_tiene_correccion_asesor_pendiente(v_exp) IS FALSE,
    'D helper false'
  );
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) IS DISTINCT FROM 'correccion_enviada',
    'D Mesa no enviada por P130'
  );
  PERFORM public.__p192_assert(
    public.asesor_inbox_categoria_correccion(v_exp) IS DISTINCT FROM 'correccion_enviada',
    'D Asesor no enviada por P130'
  );

  -- E. lote borrador → no enviada
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192120005',
    'P192 Caso E borrador', '5519210005', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (
    v_org, v_exp, v_asesor, 'borrador', NULL
  );
  PERFORM public.__p192_assert(
    public.expediente_tiene_correccion_asesor_pendiente(v_exp) IS FALSE,
    'E helper false'
  );
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) IS DISTINCT FROM 'correccion_enviada',
    'E Mesa no enviada'
  );

  -- F. legacy pre-P130: DG completo + timestamp post-Mesa, sin lote
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192120006',
    'P192 Caso F legacy DG', '5519210006', '', 'interno', 'activo',
    true, v_envio, 1, 'en_validacion_mesa', v_envio
  );
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, updated_at, validated_at
  ) VALUES (
    v_exp, v_org, '{}'::jsonb, 'completo', v_envio + interval '2 days', NULL
  )
  ON CONFLICT (expediente_id) DO UPDATE
    SET estado = 'completo',
        updated_at = v_envio + interval '2 days',
        validated_at = NULL;
  PERFORM public.__p192_assert(
    public.expediente_tiene_correccion_asesor_pendiente(v_exp) IS FALSE,
    'F sin lote'
  );
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'F Mesa legacy timestamp'
  );

  -- G. legacy resubido sin P130
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192120007',
    'P192 Caso G resubido', '5519210007', '', 'interno', 'activo',
    true, v_envio, 2, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES
    (v_org, v_exp, 'ine', v_org::text || '/' || v_exp::text || '/ine/p192.pdf',
     'ine.pdf', 'application/pdf', 100, 1, 'resubido', v_asesor, 'asesor'),
    (v_org, v_exp, 'estado_cuenta', v_org::text || '/' || v_exp::text || '/ec/p192.pdf',
     'ec.pdf', 'application/pdf', 100, 1, 'validado', v_asesor, 'asesor'),
    (v_org, v_exp, 'nss', v_org::text || '/' || v_exp::text || '/nss/p192.pdf',
     'nss.pdf', 'application/pdf', 100, 1, 'validado', v_asesor, 'asesor'),
    (v_org, v_exp, 'direccion', v_org::text || '/' || v_exp::text || '/dir/p192.pdf',
     'dir.pdf', 'application/pdf', 100, 1, 'validado', v_asesor, 'asesor');
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'G Mesa resubido legado'
  );
  PERFORM public.__p192_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_enviada',
    'G Asesor resubido legado'
  );

  -- H. etapa 11/12 + lote pendiente → enviada (sin stage gate)
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192120008',
    'P192 Caso H etapa alta', '5519210008', '', 'interno', 'activo',
    true, v_envio, 12, 'en_proceso', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES (
    v_org, v_exp, v_asesor, 'pendiente_revision', v_submit
  );
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'H etapa 12 enviada'
  );
  PERFORM public.__p192_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_enviada',
    'H Asesor etapa 12 enviada'
  );

  -- Luis-like: lote revisado ahora → fuera; el mismo lote pending habría entrado
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99192120009',
    'P192 Luis-like', '5519210009', '', 'interno', 'activo',
    true, v_envio, 1, 'en_validacion_mesa', v_envio
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo', validated_at = v_envio;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_comprobante_domicilio',
    v_org::text || '/' || v_exp::text || '/cliente_comprobante_domicilio/luis.pdf',
    'dom.pdf', 'application/pdf', 100, 2, 'subido',
    v_asesor, 'asesor'
  );
  INSERT INTO public.expediente_asesor_cambio_lotes (
    id, organization_id, expediente_id, asesor_id, status, submitted_at, reviewed_at
  ) VALUES (
    gen_random_uuid(), v_org, v_exp, v_asesor, 'revisado', v_submit, now()
  )
  RETURNING id INTO v_lote;
  PERFORM public.__p192_assert(
    public.expediente_tiene_correccion_asesor_pendiente(v_exp) IS FALSE,
    'Luis actual revisado fuera'
  );
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) IS DISTINCT FROM 'correccion_enviada',
    'Luis actual no chip'
  );
  UPDATE public.expediente_asesor_cambio_lotes
  SET status = 'pendiente_revision', reviewed_at = NULL
  WHERE id = v_lote;
  PERFORM public.__p192_assert(
    public.expediente_tiene_correccion_asesor_pendiente(v_exp) IS TRUE,
    'Luis histórico pending entra'
  );
  PERFORM public.__p192_assert(
    public.mesa_bandeja_categoria_resumen(v_exp, v_envio) = 'correccion_enviada',
    'Luis histórico Mesa enviada'
  );
  UPDATE public.expediente_asesor_cambio_lotes
  SET status = 'revisado', reviewed_at = now()
  WHERE id = v_lote;
  PERFORM public.__p192_assert(
    public.expediente_tiene_correccion_asesor_pendiente(v_exp) IS FALSE,
    'Luis vuelve a fuera al marcar revisado'
  );

  -- Sort: pending submitted_at gana sobre fecha_envio_mesa vieja
  v_exp := gen_random_uuid();
  v_exp_b := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '99192120010',
     'P192 Sort late', '5519210010', '', 'interno', 'activo',
     true, v_envio, 2, 'en_proceso', v_envio),
    (v_exp_b, v_org, v_asesor, 'mejoravit', '99192120011',
     'P192 Sort early', '5519210011', '', 'interno', 'activo',
     true, v_envio, 2, 'en_proceso', v_envio);
  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id, expediente_id, asesor_id, status, submitted_at
  ) VALUES
    (v_org, v_exp, v_asesor, 'pendiente_revision', v_submit2),
    (v_org, v_exp_b, v_asesor, 'pendiente_revision', v_submit);
  v_sort := public.mesa_bandeja_sort_ts(v_exp, v_envio, v_envio);
  PERFORM public.__p192_assert(v_sort = v_submit2, 'sort late = submitted_at');
  v_sort := public.mesa_bandeja_sort_ts(v_exp_b, v_envio, v_envio);
  PERFORM public.__p192_assert(v_sort = v_submit, 'sort early = submitted_at');
  PERFORM public.__p192_assert(
    public.mesa_bandeja_sort_ts(v_exp_b, v_envio, v_envio)
      < public.mesa_bandeja_sort_ts(v_exp, v_envio, v_envio),
    'sort determinista submitted_at ASC'
  );

  -- Lista + counts heredan la misma categoría (Mesa auth)
  PERFORM public.__p192_set_auth(v_mesa);
  v_page := public.mesa_list_bandeja_page(
    100, NULL, NULL, 'correccion_enviada', 'todo_mesa',
    'P192 Caso A cliente', NULL, NULL, false, NULL, 'rechazados', NULL, true
  );
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P192 Caso A cliente';
  PERFORM public.__p192_assert(v_count = 1, 'lista quick correccion_enviada incluye A');
  PERFORM public.__p192_assert(
    (v_page->'counts'->>'correccionesEnviadas') IS NOT NULL,
    'counts.correccionesEnviadas presente'
  );
  PERFORM public.__p192_reset_auth();

  PERFORM public.__p192_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(
    1, 100, 'P192 Caso A cliente', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_enviada'
  );
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'P192 Caso A cliente';
  PERFORM public.__p192_assert(v_count = 1, 'asesor inbox quick enviada incluye A');
  v_cat := (
    SELECT x->>'categoria_correccion'
    FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
    WHERE x->>'cliente_nombre' = 'P192 Caso A cliente'
    LIMIT 1
  );
  PERFORM public.__p192_assert(v_cat = 'correccion_enviada', 'asesor item categoria A');
  PERFORM public.__p192_reset_auth();

  RAISE NOTICE 'P192 OK: casos A–H + Luis-like + sort + lista/counts';
END;
$$;

DROP FUNCTION IF EXISTS public.__p192_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p192_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p192_reset_auth();
