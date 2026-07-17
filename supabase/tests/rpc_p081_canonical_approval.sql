-- ConCasa CRM — P081: snapshot canónico de primera aprobación
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_p081_canonical_approval.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p081_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P081 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p081_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p081_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p081_insert_exp(
  p_id UUID,
  p_org UUID,
  p_asesor UUID,
  p_nss CHAR(11)
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.action_log WHERE entity_id = p_id;
  DELETE FROM public.editor_decisions WHERE expediente_id = p_id;
  DELETE FROM public.expedientes WHERE id = p_id;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'P081 Cliente', '8111111181',
    'interno', false, 1, 'pendiente', 'activo'
  );

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (p_id, p_org, 'pendiente');
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_exp UUID := '00000000-0000-4000-9081-000000000001';
  v_exp2 UUID := '00000000-0000-4000-9081-000000000002';
  v_exp3 UUID := '00000000-0000-4000-9081-000000000003';
  v_at1 TIMESTAMPTZ;
  v_at2 TIMESTAMPTZ;
  v_monto1 NUMERIC(14,2);
  v_monto2 NUMERIC(14,2);
  v_monto_now NUMERIC(14,2);
  v_decision public.editor_decision;
BEGIN
  PERFORM public.__p081_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'editor_decisions'
        AND column_name IN ('aprobado_at', 'monto_aprobado_al_aprobar')
      HAVING count(*) = 2
    ),
    'columnas P081 presentes'
  );

  PERFORM public.__p081_insert_exp(v_exp, v_org, v_asesor, '98100000001');
  PERFORM public.__p081_insert_exp(v_exp2, v_org, v_asesor, '98100000002');
  PERFORM public.__p081_insert_exp(v_exp3, v_org, v_asesor, '98100000003');

  -- 1) Primera aprobación fija snapshot
  PERFORM public.__p081_set_auth(v_editor);
  PERFORM public.upsert_editor_decision(v_exp, 'aprobado', 25000, 'ok');
  PERFORM public.__p081_reset_auth();

  SELECT aprobado_at, monto_aprobado_al_aprobar, monto_aprobado
  INTO v_at1, v_monto1, v_monto_now
  FROM public.editor_decisions WHERE expediente_id = v_exp;

  PERFORM public.__p081_assert(v_at1 IS NOT NULL, 'aprobado_at tras 1ª aprobación');
  PERFORM public.__p081_assert(v_monto1 = 25000, 'snapshot monto 25000');
  PERFORM public.__p081_assert(v_monto_now = 25000, 'monto actual 25000');

  -- 2) Re-guardar aprobado: snapshot inmutable
  PERFORM public.__p081_set_auth(v_editor);
  PERFORM public.upsert_editor_decision(v_exp, 'aprobado', 30000, 'ajuste');
  PERFORM public.__p081_reset_auth();

  SELECT aprobado_at, monto_aprobado_al_aprobar, monto_aprobado
  INTO v_at2, v_monto2, v_monto_now
  FROM public.editor_decisions WHERE expediente_id = v_exp;

  PERFORM public.__p081_assert(v_at2 = v_at1, 'aprobado_at inmutable');
  PERFORM public.__p081_assert(v_monto2 = 25000, 'snapshot inmutable');
  PERFORM public.__p081_assert(v_monto_now = 30000, 'monto actual actualizado');

  -- 3) Exactamente 20000
  PERFORM public.__p081_set_auth(v_editor);
  PERFORM public.upsert_editor_decision(v_exp2, 'aprobado', 20000, 'limite');
  PERFORM public.__p081_reset_auth();

  SELECT monto_aprobado_al_aprobar INTO v_monto1
  FROM public.editor_decisions WHERE expediente_id = v_exp2;
  PERFORM public.__p081_assert(v_monto1 = 20000, 'snapshot exactamente 20000');

  -- 4) asesor_update_monto_aprobado no toca snapshot
  PERFORM public.__p081_set_auth(v_asesor);
  PERFORM public.asesor_update_monto_aprobado(v_exp, 99999);
  PERFORM public.__p081_reset_auth();

  SELECT aprobado_at, monto_aprobado_al_aprobar, monto_aprobado
  INTO v_at2, v_monto2, v_monto_now
  FROM public.editor_decisions WHERE expediente_id = v_exp;
  PERFORM public.__p081_assert(v_at2 = v_at1, 'asesor no mueve aprobado_at');
  PERFORM public.__p081_assert(v_monto2 = 25000, 'asesor no mueve snapshot');
  PERFORM public.__p081_assert(v_monto_now = 99999, 'asesor sí mueve monto actual');

  -- 5) aprobado → no_cumple → aprobado: conserva primera
  PERFORM public.__p081_set_auth(v_editor);
  PERFORM public.upsert_editor_decision(v_exp3, 'aprobado', 45000, 'primera');
  PERFORM public.__p081_reset_auth();

  SELECT aprobado_at, monto_aprobado_al_aprobar INTO v_at1, v_monto1
  FROM public.editor_decisions WHERE expediente_id = v_exp3;

  PERFORM public.__p081_set_auth(v_editor);
  PERFORM public.upsert_editor_decision(v_exp3, 'no_cumple', NULL, 'rechazo');
  PERFORM public.__p081_reset_auth();

  SELECT aprobado_at, monto_aprobado_al_aprobar, decision
  INTO v_at2, v_monto2, v_decision
  FROM public.editor_decisions WHERE expediente_id = v_exp3;
  PERFORM public.__p081_assert(v_decision = 'no_cumple', 'pasó a no_cumple');
  PERFORM public.__p081_assert(v_at2 = v_at1, 'snapshot sobrevive no_cumple');
  PERFORM public.__p081_assert(v_monto2 = 45000, 'monto snapshot sobrevive');

  PERFORM public.__p081_set_auth(v_editor);
  PERFORM public.upsert_editor_decision(v_exp3, 'aprobado', 50000, 'segunda');
  PERFORM public.__p081_reset_auth();

  SELECT aprobado_at, monto_aprobado_al_aprobar, monto_aprobado
  INTO v_at2, v_monto2, v_monto_now
  FROM public.editor_decisions WHERE expediente_id = v_exp3;
  PERFORM public.__p081_assert(v_at2 = v_at1, '2ª aprobación no mueve aprobado_at');
  PERFORM public.__p081_assert(v_monto2 = 45000, '2ª aprobación no mueve snapshot');
  PERFORM public.__p081_assert(v_monto_now = 50000, 'monto actual = 2ª');

  PERFORM public.__p081_assert(
    NOT has_function_privilege(
      'authenticated',
      'public.upsert_editor_decision_pre_reingreso(uuid, public.editor_decision, numeric, text)',
      'EXECUTE'
    ),
    'pre_reingreso sin EXECUTE authenticated'
  );

  DELETE FROM public.action_log WHERE entity_id IN (v_exp, v_exp2, v_exp3);
  DELETE FROM public.editor_decisions WHERE expediente_id IN (v_exp, v_exp2, v_exp3);
  DELETE FROM public.expedientes WHERE id IN (v_exp, v_exp2, v_exp3);

  RAISE NOTICE 'P081 canonical approval: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p081_insert_exp(UUID, UUID, UUID, CHAR);
DROP FUNCTION IF EXISTS public.__p081_reset_auth();
DROP FUNCTION IF EXISTS public.__p081_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p081_assert(BOOLEAN, TEXT);
