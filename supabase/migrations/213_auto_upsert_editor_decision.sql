-- P213: documentar auto_upsert_editor_decision (Infonavit automation).
-- Ya aplicada en Cloud como 20260827220236_add_auto_upsert_editor_decision_for_infonavit_automation.
-- NO re-aplicar en Cloud. Local/idempotente: CREATE OR REPLACE + REVOKE/GRANT.

-- Perfil de sistema para la automatización de precalificación por Infonavit
INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  '50beae49-3961-4163-8e78-2251693f2c19',
  'automatizacion-infonavit@concasa.internal',
  'Automatización Infonavit',
  'editor',
  true
);

-- Función dedicada (mismas validaciones que upsert_editor_decision_pre_reingreso,
-- usando un actor de sistema fijo en vez de current_profile_id())
CREATE OR REPLACE FUNCTION public.auto_upsert_editor_decision(
  p_expediente_id uuid,
  p_decision editor_decision,
  p_monto_aprobado numeric DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID := 'a1000000-0000-4000-8000-000000000001';
  v_org_id UUID;
  v_exp RECORD;
  v_prev public.editor_decisions%ROWTYPE;
  v_motivo TEXT;
  v_monto_final NUMERIC(14,2);
  v_notas_final TEXT;
  v_updated_at TIMESTAMPTZ;
  v_aprobado_at TIMESTAMPTZ;
  v_monto_al_aprobar NUMERIC(14,2);
  v_no_cumple_at TIMESTAMPTZ;
BEGIN
  SELECT organization_id INTO v_org_id FROM public.profiles WHERE id = v_actor_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auto_upsert_editor_decision: perfil de sistema no encontrado o inactivo' USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'auto_upsert_editor_decision: expediente_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_decision IS NULL THEN
    RAISE EXCEPTION 'auto_upsert_editor_decision: decision es obligatoria' USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  SELECT e.id, e.organization_id, e.ciclo_estado, e.submitted_to_mesa, e.etapa_actual, e.deleted_at
  INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'auto_upsert_editor_decision: expediente no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'auto_upsert_editor_decision: expediente no disponible' USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'auto_upsert_editor_decision: expediente fuera de la organización del sistema' USING ERRCODE = '42501';
  END IF;
  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'auto_upsert_editor_decision: el expediente no está en ciclo activo' USING ERRCODE = '22023';
  END IF;
  IF v_exp.submitted_to_mesa IS TRUE THEN
    RAISE EXCEPTION 'auto_upsert_editor_decision: no se puede editar decisión tras enviar a Mesa' USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'aprobado' THEN
    IF p_monto_aprobado IS NULL OR p_monto_aprobado <= 0 THEN
      RAISE EXCEPTION 'auto_upsert_editor_decision: monto_aprobado debe ser mayor a 0' USING ERRCODE = '22023';
    END IF;
    v_monto_final := round(p_monto_aprobado::NUMERIC, 2);
  ELSE
    v_monto_final := NULL;
  END IF;

  SELECT ed.* INTO v_prev FROM public.editor_decisions ed WHERE ed.expediente_id = p_expediente_id;
  v_notas_final := COALESCE(v_motivo, CASE WHEN FOUND THEN v_prev.notas_revision ELSE '' END, '');

  IF p_decision = 'aprobado' AND (NOT FOUND OR v_prev.aprobado_at IS NULL)
     AND (NOT FOUND OR v_prev.decision IS DISTINCT FROM 'aprobado'::public.editor_decision) THEN
    v_aprobado_at := NOW(); v_monto_al_aprobar := v_monto_final;
  ELSIF FOUND THEN
    v_aprobado_at := v_prev.aprobado_at; v_monto_al_aprobar := v_prev.monto_aprobado_al_aprobar;
  ELSE
    v_aprobado_at := NULL; v_monto_al_aprobar := NULL;
  END IF;

  IF p_decision = 'no_cumple' AND (NOT FOUND OR v_prev.no_cumple_at IS NULL)
     AND (NOT FOUND OR v_prev.decision IS DISTINCT FROM 'no_cumple'::public.editor_decision) THEN
    v_no_cumple_at := NOW();
  ELSIF FOUND THEN
    v_no_cumple_at := v_prev.no_cumple_at;
  ELSE
    v_no_cumple_at := NULL;
  END IF;

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision, decided_by,
    aprobado_at, monto_aprobado_al_aprobar, no_cumple_at
  ) VALUES (
    p_expediente_id, v_exp.organization_id, p_decision, v_monto_final, v_notas_final, v_actor_id,
    v_aprobado_at, v_monto_al_aprobar, v_no_cumple_at
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    notas_revision = CASE WHEN v_motivo IS NOT NULL THEN EXCLUDED.notas_revision ELSE public.editor_decisions.notas_revision END,
    decided_by = EXCLUDED.decided_by,
    aprobado_at = CASE WHEN public.editor_decisions.aprobado_at IS NULL AND EXCLUDED.decision = 'aprobado'::public.editor_decision AND public.editor_decisions.decision IS DISTINCT FROM 'aprobado'::public.editor_decision THEN NOW() ELSE public.editor_decisions.aprobado_at END,
    monto_aprobado_al_aprobar = CASE WHEN public.editor_decisions.aprobado_at IS NULL AND EXCLUDED.decision = 'aprobado'::public.editor_decision AND public.editor_decisions.decision IS DISTINCT FROM 'aprobado'::public.editor_decision THEN EXCLUDED.monto_aprobado ELSE public.editor_decisions.monto_aprobado_al_aprobar END,
    no_cumple_at = CASE WHEN public.editor_decisions.no_cumple_at IS NULL AND EXCLUDED.decision = 'no_cumple'::public.editor_decision AND public.editor_decisions.decision IS DISTINCT FROM 'no_cumple'::public.editor_decision THEN NOW() ELSE public.editor_decisions.no_cumple_at END;

  SELECT ed.updated_at INTO v_updated_at FROM public.editor_decisions ed WHERE ed.expediente_id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id, v_actor_id, 'editor'::public.app_role, 'editor.decision.upsert.auto',
    'editor_decision', p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'decision_anterior', CASE WHEN v_prev.expediente_id IS NULL THEN NULL ELSE v_prev.decision END,
      'decision_nueva', p_decision,
      'monto_anterior', v_prev.monto_aprobado,
      'monto_nuevo', v_monto_final,
      'motivo', v_motivo,
      'fuente', 'automatizacion_infonavit'
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'expediente_id', p_expediente_id, 'decision', p_decision,
    'monto_aprobado', v_monto_final, 'editor_id', v_actor_id, 'updated_at', v_updated_at
  );
END;
$function$;

-- Solo el backend (service role) puede invocarla, nunca el navegador
REVOKE EXECUTE ON FUNCTION public.auto_upsert_editor_decision(uuid, editor_decision, numeric, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auto_upsert_editor_decision(uuid, editor_decision, numeric, text) TO service_role;
