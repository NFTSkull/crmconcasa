-- ConCasa CRM — P2C-9 RPC upsert_editor_decision (editor aprueba/rechaza monto)

-- =============================================================================
-- upsert_editor_decision
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_editor_decision(
  p_expediente_id UUID,
  p_decision public.editor_decision,
  p_monto_aprobado NUMERIC DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_prev public.editor_decisions%ROWTYPE;
  v_motivo TEXT;
  v_monto_final NUMERIC(14, 2);
  v_notas_final TEXT;
  v_updated_at TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_editor_decision: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'editor' THEN
    RAISE EXCEPTION 'upsert_editor_decision: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision IS NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: decision es obligatoria'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  SELECT
    e.id,
    e.organization_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_editor_decision: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'upsert_editor_decision: expediente fuera de la organización del editor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'upsert_editor_decision: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS TRUE THEN
    RAISE EXCEPTION 'upsert_editor_decision: no se puede editar decisión tras enviar a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'aprobado' THEN
    IF p_monto_aprobado IS NULL THEN
      RAISE EXCEPTION 'upsert_editor_decision: monto_aprobado es obligatorio cuando decision = aprobado'
        USING ERRCODE = '22023';
    END IF;
    IF p_monto_aprobado <= 0 THEN
      RAISE EXCEPTION 'upsert_editor_decision: monto_aprobado debe ser mayor a 0'
        USING ERRCODE = '22023';
    END IF;
    v_monto_final := p_monto_aprobado;
  ELSE
    v_monto_final := NULL;
  END IF;

  SELECT ed.*
  INTO v_prev
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  v_notas_final := COALESCE(v_motivo, CASE WHEN FOUND THEN v_prev.notas_revision ELSE '' END, '');

  INSERT INTO public.editor_decisions (
    expediente_id,
    organization_id,
    decision,
    monto_aprobado,
    notas_revision,
    decided_by
  ) VALUES (
    p_expediente_id,
    v_exp.organization_id,
    p_decision,
    v_monto_final,
    v_notas_final,
    v_actor_id
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    notas_revision = CASE
      WHEN v_motivo IS NOT NULL THEN EXCLUDED.notas_revision
      ELSE public.editor_decisions.notas_revision
    END,
    decided_by = EXCLUDED.decided_by;

  SELECT ed.updated_at
  INTO v_updated_at
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'editor.decision.upsert',
    'editor_decision',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'decision_anterior', CASE WHEN v_prev.expediente_id IS NULL THEN NULL ELSE v_prev.decision END,
      'decision_nueva', p_decision,
      'monto_anterior', v_prev.monto_aprobado,
      'monto_nuevo', v_monto_final,
      'motivo', v_motivo,
      'editor_id', v_actor_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'decision', p_decision,
    'monto_aprobado', v_monto_final,
    'editor_id', v_actor_id,
    'updated_at', v_updated_at
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_editor_decision(UUID, public.editor_decision, NUMERIC, TEXT) IS
  'Editor guarda decisión de monto (aprobado/no_cumple/pendiente) antes de envío a Mesa. p_motivo persiste en notas_revision.';

REVOKE ALL ON FUNCTION public.upsert_editor_decision(UUID, public.editor_decision, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_editor_decision(UUID, public.editor_decision, NUMERIC, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.upsert_editor_decision(UUID, public.editor_decision, NUMERIC, TEXT) TO authenticated;
