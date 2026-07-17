-- P084: reparación snapshots + bandera no_recuperable
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p084_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P084 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_a UUID := '00000000-0000-4000-9084-000000000001';
  v_b UUID := '00000000-0000-4000-9084-000000000002';
  v_c UUID := '00000000-0000-4000-9084-000000000003';
  v_legit UUID := '00000000-0000-4000-9084-000000000099';
  v_snap NUMERIC;
  v_flag BOOLEAN;
  v_aprobado_at TIMESTAMPTZ;
  v_updated_at TIMESTAMPTZ;
  v_decision public.editor_decision;
  v_monto NUMERIC;
  v_cnt INTEGER;
BEGIN
  PERFORM public.__p084_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'editor_decisions'
        AND column_name = 'monto_aprobado_snapshot_no_recuperable'
    ),
    'columna monto_aprobado_snapshot_no_recuperable'
  );

  DELETE FROM public.action_log WHERE entity_id IN (v_a, v_b, v_c, v_legit);
  DELETE FROM public.editor_decisions WHERE expediente_id IN (v_a, v_b, v_c, v_legit);
  DELETE FROM public.expedientes WHERE id IN (v_a, v_b, v_c, v_legit);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_a, v_org, v_asesor, 'mejoravit', '08400000001', 'P084 A', '8110000084', 'interno', false, 1, 'pendiente', 'activo'),
    (v_b, v_org, v_asesor, 'mejoravit', '08400000002', 'P084 B', '8110000085', 'interno', false, 1, 'pendiente', 'activo'),
    (v_c, v_org, v_asesor, 'mejoravit', '08400000003', 'P084 C', '8110000086', 'interno', false, 1, 'pendiente', 'activo'),
    (v_legit, v_org, v_asesor, 'mejoravit', '08400000099', 'P084 Legit', '8110000099', 'interno', false, 1, 'pendiente', 'activo');

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision,
    aprobado_at, monto_aprobado_al_aprobar, updated_at
  ) VALUES (
    v_a, v_org, 'aprobado', 7152.01, '',
    timestamptz '2026-07-14 23:32:21+00', 43927582007.00,
    timestamptz '2026-07-01 12:00:00+00'
  );
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at) VALUES
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_a,
      jsonb_build_object('decision_anterior','pendiente','decision_nueva','aprobado','monto_nuevo','43927582007.00'),
      timestamptz '2026-07-14 23:32:21+00'),
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_a,
      jsonb_build_object('decision_anterior','aprobado','decision_nueva','pendiente'),
      timestamptz '2026-07-14 23:32:23.2+00'),
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_a,
      jsonb_build_object('decision_anterior','pendiente','decision_nueva','aprobado','monto_nuevo','7152.01'),
      timestamptz '2026-07-14 23:32:25.2+00');

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision,
    aprobado_at, monto_aprobado_al_aprobar, updated_at
  ) VALUES (
    v_b, v_org, 'aprobado', 48378.89, '',
    timestamptz '2026-07-09 18:34:44+00', 4027518671.00,
    timestamptz '2026-07-01 12:00:00+00'
  );
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at) VALUES
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_b,
      jsonb_build_object('decision_anterior','pendiente','decision_nueva','aprobado','monto_nuevo','4027518671.00'),
      timestamptz '2026-07-09 18:34:44+00'),
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_b,
      jsonb_build_object('decision_anterior','aprobado','decision_nueva','pendiente'),
      timestamptz '2026-07-09 18:34:45.9+00'),
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_b,
      jsonb_build_object('decision_anterior','pendiente','decision_nueva','aprobado','monto_nuevo','48378.89'),
      timestamptz '2026-07-09 18:34:48.8+00');

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision,
    aprobado_at, monto_aprobado_al_aprobar, no_cumple_at, updated_at
  ) VALUES (
    v_c, v_org, 'no_cumple', NULL, '',
    timestamptz '2026-07-13 03:21:14+00', 54169990063.00,
    timestamptz '2026-07-13 03:21:21+00',
    timestamptz '2026-07-01 12:00:00+00'
  );
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at) VALUES
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_c,
      jsonb_build_object('decision_anterior','pendiente','decision_nueva','aprobado','monto_nuevo','54169990063.00'),
      timestamptz '2026-07-13 03:21:14+00'),
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_c,
      jsonb_build_object('decision_anterior','aprobado','decision_nueva','pendiente'),
      timestamptz '2026-07-13 03:21:16.07+00'),
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_c,
      jsonb_build_object('decision_anterior','pendiente','decision_nueva','no_cumple'),
      timestamptz '2026-07-13 03:21:21.54+00');

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision,
    aprobado_at, monto_aprobado_al_aprobar, updated_at
  ) VALUES (
    v_legit, v_org, 'aprobado', 250000, '',
    timestamptz '2026-07-10 12:00:00+00', 250000.00,
    timestamptz '2026-07-01 12:00:00+00'
  );
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at) VALUES
    (v_org, v_editor, 'editor', 'editor.decision.upsert', 'editor_decision', v_legit,
      jsonb_build_object('decision_anterior','pendiente','decision_nueva','aprobado','monto_nuevo','250000.00'),
      timestamptz '2026-07-10 12:00:00+00');

  SELECT count(*)::INTEGER INTO v_cnt
  FROM (
    WITH first_ap AS (
      SELECT DISTINCT ON (al.entity_id)
        al.entity_id AS expediente_id,
        al.created_at AS first_at,
        round((al.payload->>'monto_nuevo')::NUMERIC, 2) AS first_monto
      FROM public.action_log al
      JOIN public.expedientes e ON e.id = al.entity_id
      WHERE al.action = 'editor.decision.upsert'
        AND al.entity_type = 'editor_decision'
        AND al.payload->>'decision_nueva' = 'aprobado'
        AND (al.payload->>'decision_anterior' IS DISTINCT FROM 'aprobado'
             OR al.payload->>'decision_anterior' IS NULL)
        AND (al.payload->>'monto_nuevo') ~ '^[0-9]+(\.[0-9]+)?$'
        AND (al.payload->>'monto_nuevo')::NUMERIC > 100000000
        AND lower(btrim(e.programa::text)) = 'mejoravit'
        AND al.entity_id IN (v_a, v_b, v_c, v_legit)
      ORDER BY al.entity_id, al.created_at ASC
    ),
    bounce AS (
      SELECT DISTINCT ON (f.expediente_id)
        f.expediente_id, f.first_at, f.first_monto, al.created_at AS pendiente_at
      FROM first_ap f
      JOIN public.action_log al ON al.entity_id = f.expediente_id
      WHERE al.action = 'editor.decision.upsert'
        AND al.payload->>'decision_nueva' = 'pendiente'
        AND al.created_at > f.first_at
        AND al.created_at < f.first_at + interval '60 seconds'
      ORDER BY f.expediente_id, al.created_at ASC
    ),
    reaprob AS (
      SELECT DISTINCT ON (b.expediente_id)
        b.expediente_id,
        round((al.payload->>'monto_nuevo')::NUMERIC, 2) AS reaprob_monto
      FROM bounce b
      JOIN public.action_log al ON al.entity_id = b.expediente_id
      WHERE al.action = 'editor.decision.upsert'
        AND al.payload->>'decision_nueva' = 'aprobado'
        AND (al.payload->>'decision_anterior' IS DISTINCT FROM 'aprobado'
             OR al.payload->>'decision_anterior' IS NULL)
        AND al.created_at > b.pendiente_at
        AND (al.payload->>'monto_nuevo') ~ '^[0-9]+(\.[0-9]+)?$'
        AND (al.payload->>'monto_nuevo')::NUMERIC > 0
        AND (al.payload->>'monto_nuevo')::NUMERIC <= 100000000
      ORDER BY b.expediente_id, al.created_at ASC
    )
    SELECT b.expediente_id FROM bounce b
    JOIN reaprob r ON r.expediente_id = b.expediente_id
    UNION ALL
    SELECT b.expediente_id FROM bounce b
    LEFT JOIN reaprob r ON r.expediente_id = b.expediente_id
    WHERE r.expediente_id IS NULL
  ) s;

  PERFORM public.__p084_assert(v_cnt = 3, format('candidatos = 3, got %s', v_cnt));

  ALTER TABLE public.editor_decisions DISABLE TRIGGER editor_decisions_set_updated_at;

  WITH first_ap AS (
    SELECT DISTINCT ON (al.entity_id)
      al.entity_id AS expediente_id,
      al.created_at AS first_at,
      round((al.payload->>'monto_nuevo')::NUMERIC, 2) AS first_monto
    FROM public.action_log al
    JOIN public.expedientes e ON e.id = al.entity_id
    WHERE al.action = 'editor.decision.upsert'
      AND al.entity_type = 'editor_decision'
      AND al.payload->>'decision_nueva' = 'aprobado'
      AND (al.payload->>'decision_anterior' IS DISTINCT FROM 'aprobado'
           OR al.payload->>'decision_anterior' IS NULL)
      AND (al.payload->>'monto_nuevo') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (al.payload->>'monto_nuevo')::NUMERIC > 100000000
      AND lower(btrim(e.programa::text)) = 'mejoravit'
      AND al.entity_id IN (v_a, v_b, v_c)
    ORDER BY al.entity_id, al.created_at ASC
  ),
  bounce AS (
    SELECT DISTINCT ON (f.expediente_id)
      f.expediente_id, f.first_at, f.first_monto, al.created_at AS pendiente_at
    FROM first_ap f
    JOIN public.action_log al ON al.entity_id = f.expediente_id
    WHERE al.action = 'editor.decision.upsert'
      AND al.payload->>'decision_nueva' = 'pendiente'
      AND al.created_at > f.first_at
      AND al.created_at < f.first_at + interval '60 seconds'
    ORDER BY f.expediente_id, al.created_at ASC
  ),
  reaprob AS (
    SELECT DISTINCT ON (b.expediente_id)
      b.expediente_id,
      round((al.payload->>'monto_nuevo')::NUMERIC, 2) AS reaprob_monto
    FROM bounce b
    JOIN public.action_log al ON al.entity_id = b.expediente_id
    WHERE al.action = 'editor.decision.upsert'
      AND al.payload->>'decision_nueva' = 'aprobado'
      AND (al.payload->>'decision_anterior' IS DISTINCT FROM 'aprobado'
           OR al.payload->>'decision_anterior' IS NULL)
      AND al.created_at > b.pendiente_at
      AND (al.payload->>'monto_nuevo') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (al.payload->>'monto_nuevo')::NUMERIC > 0
      AND (al.payload->>'monto_nuevo')::NUMERIC <= 100000000
    ORDER BY b.expediente_id, al.created_at ASC
  ),
  repair_candidates AS (
    SELECT b.expediente_id, r.reaprob_monto AS new_monto, false AS no_recuperable
    FROM bounce b
    JOIN reaprob r ON r.expediente_id = b.expediente_id
    JOIN public.editor_decisions ed ON ed.expediente_id = b.expediente_id
    WHERE ed.monto_aprobado_al_aprobar IS NOT DISTINCT FROM b.first_monto
      AND ed.monto_aprobado_al_aprobar > 100000000
    UNION ALL
    SELECT b.expediente_id, NULL::NUMERIC, true
    FROM bounce b
    LEFT JOIN reaprob r ON r.expediente_id = b.expediente_id
    JOIN public.editor_decisions ed ON ed.expediente_id = b.expediente_id
    WHERE r.expediente_id IS NULL
      AND ed.monto_aprobado_al_aprobar IS NOT DISTINCT FROM b.first_monto
      AND ed.monto_aprobado_al_aprobar > 100000000
  )
  UPDATE public.editor_decisions ed
  SET
    monto_aprobado_al_aprobar = rc.new_monto,
    monto_aprobado_snapshot_no_recuperable = rc.no_recuperable
  FROM repair_candidates rc
  WHERE ed.expediente_id = rc.expediente_id;

  ALTER TABLE public.editor_decisions ENABLE TRIGGER editor_decisions_set_updated_at;

  SELECT monto_aprobado_al_aprobar, monto_aprobado_snapshot_no_recuperable,
         aprobado_at, updated_at, decision, monto_aprobado
  INTO v_snap, v_flag, v_aprobado_at, v_updated_at, v_decision, v_monto
  FROM public.editor_decisions WHERE expediente_id = v_a;
  PERFORM public.__p084_assert(v_snap = 7152.01, 'A snap reparado');
  PERFORM public.__p084_assert(v_flag = false, 'A flag false');
  PERFORM public.__p084_assert(v_aprobado_at = timestamptz '2026-07-14 23:32:21+00', 'A aprobado_at');
  PERFORM public.__p084_assert(v_updated_at = timestamptz '2026-07-01 12:00:00+00', 'A updated_at');
  PERFORM public.__p084_assert(v_decision = 'aprobado', 'A decision');
  PERFORM public.__p084_assert(v_monto = 7152.01, 'A monto actual');

  SELECT monto_aprobado_al_aprobar, monto_aprobado_snapshot_no_recuperable
  INTO v_snap, v_flag FROM public.editor_decisions WHERE expediente_id = v_b;
  PERFORM public.__p084_assert(v_snap = 48378.89, 'B snap');
  PERFORM public.__p084_assert(v_flag = false, 'B flag');

  SELECT monto_aprobado_al_aprobar, monto_aprobado_snapshot_no_recuperable, aprobado_at, decision
  INTO v_snap, v_flag, v_aprobado_at, v_decision
  FROM public.editor_decisions WHERE expediente_id = v_c;
  PERFORM public.__p084_assert(v_snap IS NULL, 'C snap NULL');
  PERFORM public.__p084_assert(v_flag = true, 'C flag true');
  PERFORM public.__p084_assert(v_aprobado_at = timestamptz '2026-07-13 03:21:14+00', 'C aprobado_at conservado');
  PERFORM public.__p084_assert(v_decision = 'no_cumple', 'C decision');

  SELECT monto_aprobado_al_aprobar, monto_aprobado_snapshot_no_recuperable
  INTO v_snap, v_flag FROM public.editor_decisions WHERE expediente_id = v_legit;
  PERFORM public.__p084_assert(v_snap = 250000.00, 'legítimo intacto');
  PERFORM public.__p084_assert(v_flag = false, 'legítimo flag');

  -- CHECK: rechaza combos inválidos
  BEGIN
    UPDATE public.editor_decisions
    SET monto_aprobado_snapshot_no_recuperable = true
    WHERE expediente_id = v_legit;
    RAISE EXCEPTION 'P084 TEST FAIL: debió rechazar flag true con monto válido';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.editor_decisions
    SET monto_aprobado_al_aprobar = NULL,
        monto_aprobado_snapshot_no_recuperable = false
    WHERE expediente_id = v_a;
    RAISE EXCEPTION 'P084 TEST FAIL: debió rechazar monto null con flag false y aprobado_at';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Trigger: true→false solo con monto válido
  UPDATE public.editor_decisions
  SET monto_aprobado_al_aprobar = 12000.00,
      monto_aprobado_snapshot_no_recuperable = true
  WHERE expediente_id = v_c;
  SELECT monto_aprobado_snapshot_no_recuperable, monto_aprobado_al_aprobar
  INTO v_flag, v_snap
  FROM public.editor_decisions WHERE expediente_id = v_c;
  PERFORM public.__p084_assert(v_flag = false, 'trigger limpia flag con monto válido');
  PERFORM public.__p084_assert(v_snap = 12000.00, 'trigger conserva monto');

  RAISE NOTICE 'P084 repair + no_recuperable: PASS';
END $$;

DROP FUNCTION public.__p084_assert(BOOLEAN, TEXT);
