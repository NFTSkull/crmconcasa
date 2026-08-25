-- P209: explicación causal inbox asesor. C1–C14 + invariante SQL.
\set ON_ERROR_STOP on
\ir ../migrations/209_asesor_inbox_correccion_explicacion.sql

CREATE OR REPLACE FUNCTION public.__p209_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P209 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_list_expedientes_page';

  PERFORM public.__p209_assert(
    position('correccion_explicacion' in v_src) > 0,
    'list incluye correccion_explicacion'
  );
  PERFORM public.__p209_assert(
    position('asesor_inbox_correccion_labels_vigentes' in v_src) > 0,
    'list usa labels vigentes'
  );
  PERFORM public.__p209_assert(
    position('UPDATE public.' in v_src) = 0,
    'list sin writers'
  );
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_envio TIMESTAMPTZ := timestamptz '2026-08-01 10:00:00+00';
  v_r1 TIMESTAMPTZ := timestamptz '2026-08-05 12:00:00+00';
  v_r2 TIMESTAMPTZ := timestamptz '2026-08-15 12:00:00+00';
  v_exp UUID;
  v_doc UUID;
  v_eff TEXT;
  v_expl TEXT;
  v_labels TEXT[];
BEGIN
  v_exp := gen_random_uuid();
  INSERT INTO public.organizations (id, name) VALUES (v_org, 'P209 org') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email)
  VALUES (v_asesor, v_org, 'asesor', true, 'p209-asesor@test.local'),
         (v_mesa, v_org, 'mesa_control', true, 'p209-mesa@test.local')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '12345678901', 'P209 Test',
    true, v_envio, 1, 'en_proceso', 'activo'
  );

  INSERT INTO public.cliente_datos (expediente_id, estado)
  VALUES (v_exp, 'completo');

  INSERT INTO public.action_log (
    action, entity_type, entity_id, actor_id, payload, created_at
  ) VALUES (
    'cliente_datos.revision.update', 'cliente_datos', v_exp, v_mesa,
    jsonb_build_object('estado_nuevo', 'rechazado'), v_r1
  );

  v_eff := public.asesor_inbox_estado_efectivo(v_exp);
  PERFORM public.__p209_assert(v_eff = 'correccion_requerida', 'C1 estado correccion_requerida');

  v_labels := public.asesor_inbox_correccion_labels_vigentes(v_exp);
  PERFORM public.__p209_assert(
    v_labels = ARRAY['Datos generales']::text[],
    'C1 labels DG aunque cliente_datos=completo'
  );

  v_expl := public.asesor_inbox_correccion_explicacion(v_exp);
  PERFORM public.__p209_assert(
    v_expl = 'Mesa solicita corregir: Datos generales.',
    'C1 explanation DG'
  );

  -- C2 documental
  v_doc := gen_random_uuid();
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    uploaded_by, estatus_revision
  ) VALUES (
    v_doc, v_org, v_exp, 'cliente_ine_frente', v_org::text || '/' || v_exp::text || '/ine.pdf',
    v_asesor, 'rechazado'
  );
  INSERT INTO public.documento_revisiones (
    expediente_id, documento_id, estatus_anterior, estatus_nuevo, actor_id, created_at
  ) VALUES (
    v_exp, v_doc, 'subido', 'rechazado', v_mesa, v_r2
  );

  v_labels := public.asesor_inbox_correccion_labels_vigentes(v_exp);
  PERFORM public.__p209_assert(
    'Datos generales' = ANY(v_labels) AND 'INE frente' = ANY(v_labels),
    'C4 multi labels'
  );
  v_expl := public.asesor_inbox_format_correccion_explicacion(v_labels);
  PERFORM public.__p209_assert(
    v_expl LIKE '%2 elementos%' AND v_expl LIKE '%INE frente%',
    'C4 copy con nombres'
  );

  -- Invariante: toda fila correction_required tiene explanation non-empty
  PERFORM public.__p209_assert(
    v_expl IS NOT NULL AND btrim(v_expl) <> '',
    'C16/C17 invariant explanation'
  );

  RAISE NOTICE 'P209 SQL OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p209_assert(BOOLEAN, TEXT);
