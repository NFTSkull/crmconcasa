-- P210 — retención (OPCIÓN A: soportada con motivo real + fallback).
\set ON_ERROR_STOP on
\ir ../migrations/210_asesor_correccion_accionable_reenvio.sql

CREATE OR REPLACE FUNCTION public.__p210_ret_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P210 RET FAIL: %', p_msg;
  END IF;
END;
$$;

BEGIN;

-- Caso 1: motivo real desde documento_revisiones retencion_*
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8201-000000000001';
  v_asesor UUID := '00000000-0000-4000-8201-000000000011';
  v_mesa UUID := '00000000-0000-4000-8201-000000000014';
  v_exp UUID := gen_random_uuid();
  v_doc UUID := gen_random_uuid();
  v_nss CHAR(11);
  v_envio TIMESTAMPTZ := '2026-08-01 10:00:00+00';
  v_rej TIMESTAMPTZ := '2026-08-20 12:00:00+00';
  v_items JSONB;
  v_det JSONB;
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-ret-1', 'P210 ret 1') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES
    (v_asesor, v_org, 'asesor', true, 'p210-ret1@test', NULL),
    (v_mesa, v_org, 'mesa_interno', true, 'p210-ret1-mesa@test', 'interno')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', v_nss, 'P210 ret motivo',
    '5512200001', 'interno', true, v_envio, 9, 'en_proceso', 'activo'
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado, validated_at)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo', v_envio);
  INSERT INTO public.retencion_opciones (expediente_id, organization_id, retencion_opcion, updated_by)
  VALUES (v_exp, v_org, 'con_sello', v_asesor);
  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado
  ) VALUES (v_exp, v_org, true, v_envio, 'con_sello', 'correccion_requerida');
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, uploaded_by, uploaded_by_role, estatus_revision, created_at
  ) VALUES (
    v_doc, v_org, v_exp, 'retencion_acuse_con_sello',
    v_org::text || '/' || v_exp::text || '/acuse.pdf',
    'acuse.pdf', 'application/pdf', v_asesor, 'asesor', 'rechazado', v_envio
  );
  INSERT INTO public.documento_revisiones (
    organization_id, expediente_id, documento_id, estatus_anterior, estatus_nuevo,
    comentario_mesa, actor_id, created_at
  ) VALUES (
    v_org, v_exp, v_doc, 'subido', 'rechazado', 'ACTUALIZAR ACUSE RETENCION', v_mesa, v_rej
  );

  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_items := public.asesor_correccion_items_abiertos(v_exp);
  PERFORM public.__p210_ret_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_items) x
      WHERE x->>'type' = 'retencion'
    ),
    'retencion: item type retencion'
  );
  PERFORM public.__p210_ret_assert(
    (SELECT x->>'motivo' FROM jsonb_array_elements(v_items) x WHERE x->>'type' = 'retencion' LIMIT 1)
      = 'ACTUALIZAR ACUSE RETENCION',
    'retencion: motivo real'
  );
  PERFORM public.__p210_ret_assert(
    (SELECT x->>'action_target' FROM jsonb_array_elements(v_items) x WHERE x->>'type' = 'retencion' LIMIT 1)
      LIKE 'retencion_%',
    'retencion: action_target doc kind'
  );

  v_det := public.asesor_correccion_detalle(v_exp);
  PERFORM public.__p210_ret_assert(v_det IS NOT NULL, 'retencion: detalle visible');
  PERFORM public.__p210_ret_assert(
    coalesce((v_det->>'can_resubmit')::boolean, true) IS FALSE,
    'retencion: blocked sin reemplazo post-request'
  );
END;
$$;

-- Caso 2: fallback seguro sin comentario_mesa
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8202-000000000001';
  v_asesor UUID := '00000000-0000-4000-8202-000000000011';
  v_exp UUID := gen_random_uuid();
  v_nss CHAR(11);
  v_envio TIMESTAMPTZ := '2026-08-01 10:00:00+00';
  v_items JSONB;
  v_motivo TEXT;
BEGIN
  v_nss := ('9' || lpad(floor(random() * 10000000000)::bigint::text, 10, '0'))::char(11);
  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-ret-2', 'P210 ret 2') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email)
  VALUES (v_asesor, v_org, 'asesor', true, 'p210-ret2@test') ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', v_nss, 'P210 ret fallback',
    '5512200002', 'interno', true, v_envio, 9, 'en_proceso', 'activo'
  );
  INSERT INTO public.retencion_opciones (expediente_id, organization_id, retencion_opcion, updated_by)
  VALUES (v_exp, v_org, 'con_sello', v_asesor);
  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado
  ) VALUES (v_exp, v_org, true, v_envio, 'con_sello', 'correccion_requerida');

  v_items := public.asesor_correccion_items_abiertos(v_exp);
  SELECT x->>'motivo' INTO v_motivo
  FROM jsonb_array_elements(v_items) x WHERE x->>'type' = 'retencion' LIMIT 1;

  PERFORM public.__p210_ret_assert(v_motivo IS NOT NULL, 'retencion fallback: motivo presente');
  PERFORM public.__p210_ret_assert(
    v_motivo = 'Motivo específico no disponible. Revisa la sección indicada o contacta a Mesa.',
    'retencion fallback: texto seguro'
  );
  PERFORM public.__p210_ret_assert(
    v_motivo NOT ILIKE '%RFC%' AND v_motivo NOT ILIKE '%CURP%',
    'retencion fallback: sin motivo inventado'
  );
END;
$$;

SELECT 'P210 RETENTION OK' AS status;

ROLLBACK;
