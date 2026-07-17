-- P083: backfill no_cumple_at preserva updated_at (DISABLE/ENABLE trigger puntual)
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p083_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P083 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_exp UUID := '00000000-0000-4000-9083-000000000001';
  v_chk_pre TEXT;
  v_chk_post TEXT;
  v_updated_pre TIMESTAMPTZ;
  v_updated_post TIMESTAMPTZ;
  v_no_cumple TIMESTAMPTZ;
  v_decision public.editor_decision;
  v_enabled CHAR;
BEGIN
  PERFORM public.__p083_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'editor_decisions'
        AND column_name = 'no_cumple_at'
    ),
    'columna no_cumple_at presente'
  );

  DELETE FROM public.action_log WHERE entity_id = v_exp;
  DELETE FROM public.editor_decisions WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '08300000001', 'P083 Cliente', '8110000083',
    'interno', false, 1, 'pendiente', 'activo'
  );

  -- Hoy aprobada, pero historial con transición a no_cumple (universo tipo 595)
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision,
    aprobado_at, monto_aprobado_al_aprobar, updated_at
  ) VALUES (
    v_exp, v_org, 'aprobado', 25000, '',
    timestamptz '2026-07-10 12:00:00+00', 25000,
    timestamptz '2026-07-01 12:00:00+00'
  );

  INSERT INTO public.action_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at
  ) VALUES
  (
    v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_exp,
    jsonb_build_object('decision_anterior', 'pendiente', 'decision_nueva', 'no_cumple'),
    timestamptz '2026-07-05 10:00:00+00'
  ),
  (
    v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_exp,
    jsonb_build_object('decision_anterior', 'no_cumple', 'decision_nueva', 'no_cumple'),
    timestamptz '2026-07-06 10:00:00+00'
  ),
  (
    v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_exp,
    jsonb_build_object(
      'decision_anterior', 'no_cumple',
      'decision_nueva', 'aprobado',
      'monto_nuevo', '25000'
    ),
    timestamptz '2026-07-10 12:00:00+00'
  );

  SELECT md5(
    string_agg(
      expediente_id::text || ':' || COALESCE(updated_at::text, ''),
      ',' ORDER BY expediente_id
    )
  ) INTO v_chk_pre
  FROM public.editor_decisions;

  SELECT updated_at INTO v_updated_pre
  FROM public.editor_decisions WHERE expediente_id = v_exp;

  PERFORM public.__p083_assert(
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'editor_decisions'
        AND t.tgname = 'editor_decisions_set_updated_at' AND NOT t.tgisinternal
    ),
    'trigger editor_decisions_set_updated_at existe'
  );

  ALTER TABLE public.editor_decisions DISABLE TRIGGER editor_decisions_set_updated_at;

  WITH first_no_cumple AS (
    SELECT DISTINCT ON (al.entity_id)
      al.entity_id AS expediente_id,
      al.created_at AS no_cumple_at
    FROM public.action_log al
    WHERE al.action = 'editor.decision.upsert'
      AND al.entity_type = 'editor_decision'
      AND al.payload->>'decision_nueva' = 'no_cumple'
      AND (
        al.payload->>'decision_anterior' IS DISTINCT FROM 'no_cumple'
        OR al.payload->>'decision_anterior' IS NULL
      )
      AND al.entity_id = v_exp
    ORDER BY al.entity_id, al.created_at ASC
  )
  UPDATE public.editor_decisions ed
  SET no_cumple_at = f.no_cumple_at
  FROM first_no_cumple f
  WHERE ed.expediente_id = f.expediente_id
    AND ed.no_cumple_at IS NULL;

  ALTER TABLE public.editor_decisions ENABLE TRIGGER editor_decisions_set_updated_at;

  SELECT md5(
    string_agg(
      expediente_id::text || ':' || COALESCE(updated_at::text, ''),
      ',' ORDER BY expediente_id
    )
  ) INTO v_chk_post
  FROM public.editor_decisions;

  SELECT updated_at, no_cumple_at, decision
  INTO v_updated_post, v_no_cumple, v_decision
  FROM public.editor_decisions WHERE expediente_id = v_exp;

  PERFORM public.__p083_assert(v_chk_pre = v_chk_post, 'checksum updated_at pre=post');
  PERFORM public.__p083_assert(v_updated_pre = v_updated_post, 'updated_at fila intacto');
  PERFORM public.__p083_assert(
    v_no_cumple = timestamptz '2026-07-05 10:00:00+00',
    'primera transición gana (no la repetición)'
  );
  PERFORM public.__p083_assert(v_decision = 'aprobado', 'backfill no depende de decisión actual');

  SELECT t.tgenabled INTO v_enabled
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'editor_decisions'
    AND t.tgname = 'editor_decisions_set_updated_at' AND NOT t.tgisinternal;

  PERFORM public.__p083_assert(v_enabled = 'O', 'trigger habilitado tras backfill');

  UPDATE public.editor_decisions SET notas_revision = 'touch-p083' WHERE expediente_id = v_exp;
  SELECT updated_at INTO v_updated_post FROM public.editor_decisions WHERE expediente_id = v_exp;
  PERFORM public.__p083_assert(v_updated_post > v_updated_pre, 'UPDATE normal avanza updated_at');

  RAISE NOTICE 'P083 updated_at preserve: PASS';
END;
$$;

DROP FUNCTION public.__p083_assert(BOOLEAN, TEXT);
