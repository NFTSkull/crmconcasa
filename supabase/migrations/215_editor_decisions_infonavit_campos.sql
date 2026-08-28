-- P215: columnas Infonavit en editor_decisions + extensión auto_upsert_editor_decision.
-- Aplicar en Cloud manualmente (como P213). Idempotente local: IF NOT EXISTS + CREATE OR REPLACE.

-- =============================================================================
-- 1. Columnas nullable (datos capturados por scraper en precalificación aprobada)
-- =============================================================================
ALTER TABLE public.editor_decisions
  ADD COLUMN IF NOT EXISTS rfc_infonavit TEXT NULL,
  ADD COLUMN IF NOT EXISTS registro_patronal_infonavit TEXT NULL,
  ADD COLUMN IF NOT EXISTS empresa_infonavit TEXT NULL,
  ADD COLUMN IF NOT EXISTS advertencia_inscripcion TEXT NULL;

COMMENT ON COLUMN public.editor_decisions.rfc_infonavit IS
  'RFC del trabajador según pantalla de precalificación Infonavit (automatización).';

COMMENT ON COLUMN public.editor_decisions.registro_patronal_infonavit IS
  'N.R.P. según formulario Solicitud de Inscripción Infonavit (automatización; null si crédito activo u otro caso).';

COMMENT ON COLUMN public.editor_decisions.empresa_infonavit IS
  'Nombre de empresa patronal según formulario Solicitud de Inscripción Infonavit (automatización).';

COMMENT ON COLUMN public.editor_decisions.advertencia_inscripcion IS
  'Mensaje Infonavit cuando no hay formulario de inscripción (p. ej. crédito activo).';

-- =============================================================================
-- 2. RPC auto_upsert_editor_decision — 4 parámetros opcionales adicionales
-- =============================================================================
DROP FUNCTION IF EXISTS public.auto_upsert_editor_decision(uuid, public.editor_decision, numeric, text);

CREATE OR REPLACE FUNCTION public.auto_upsert_editor_decision(
  p_expediente_id uuid,
  p_decision public.editor_decision,
  p_monto_aprobado numeric DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_rfc text DEFAULT NULL,
  p_registro_patronal text DEFAULT NULL,
  p_empresa text DEFAULT NULL,
  p_advertencia_inscripcion text DEFAULT NULL
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
  v_rfc TEXT;
  v_registro_patronal TEXT;
  v_empresa TEXT;
  v_advertencia_inscripcion TEXT;
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
  v_rfc := NULLIF(btrim(COALESCE(p_rfc, '')), '');
  v_registro_patronal := NULLIF(btrim(COALESCE(p_registro_patronal, '')), '');
  v_empresa := NULLIF(btrim(COALESCE(p_empresa, '')), '');
  v_advertencia_inscripcion := NULLIF(btrim(COALESCE(p_advertencia_inscripcion, '')), '');

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
    expediente_id,
    organization_id,
    decision,
    monto_aprobado,
    notas_revision,
    decided_by,
    aprobado_at,
    monto_aprobado_al_aprobar,
    no_cumple_at,
    rfc_infonavit,
    registro_patronal_infonavit,
    empresa_infonavit,
    advertencia_inscripcion
  ) VALUES (
    p_expediente_id,
    v_exp.organization_id,
    p_decision,
    v_monto_final,
    v_notas_final,
    v_actor_id,
    v_aprobado_at,
    v_monto_al_aprobar,
    v_no_cumple_at,
    v_rfc,
    v_registro_patronal,
    v_empresa,
    v_advertencia_inscripcion
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    notas_revision = CASE
      WHEN v_motivo IS NOT NULL THEN EXCLUDED.notas_revision
      ELSE public.editor_decisions.notas_revision
    END,
    decided_by = EXCLUDED.decided_by,
    aprobado_at = CASE
      WHEN public.editor_decisions.aprobado_at IS NULL
        AND EXCLUDED.decision = 'aprobado'::public.editor_decision
        AND public.editor_decisions.decision IS DISTINCT FROM 'aprobado'::public.editor_decision
      THEN NOW()
      ELSE public.editor_decisions.aprobado_at
    END,
    monto_aprobado_al_aprobar = CASE
      WHEN public.editor_decisions.aprobado_at IS NULL
        AND EXCLUDED.decision = 'aprobado'::public.editor_decision
        AND public.editor_decisions.decision IS DISTINCT FROM 'aprobado'::public.editor_decision
      THEN EXCLUDED.monto_aprobado
      ELSE public.editor_decisions.monto_aprobado_al_aprobar
    END,
    no_cumple_at = CASE
      WHEN public.editor_decisions.no_cumple_at IS NULL
        AND EXCLUDED.decision = 'no_cumple'::public.editor_decision
        AND public.editor_decisions.decision IS DISTINCT FROM 'no_cumple'::public.editor_decision
      THEN NOW()
      ELSE public.editor_decisions.no_cumple_at
    END,
    rfc_infonavit = CASE
      WHEN v_rfc IS NOT NULL THEN v_rfc
      ELSE public.editor_decisions.rfc_infonavit
    END,
    registro_patronal_infonavit = CASE
      WHEN v_registro_patronal IS NOT NULL THEN v_registro_patronal
      ELSE public.editor_decisions.registro_patronal_infonavit
    END,
    empresa_infonavit = CASE
      WHEN v_empresa IS NOT NULL THEN v_empresa
      ELSE public.editor_decisions.empresa_infonavit
    END,
    advertencia_inscripcion = CASE
      WHEN v_advertencia_inscripcion IS NOT NULL THEN v_advertencia_inscripcion
      ELSE public.editor_decisions.advertencia_inscripcion
    END;

  SELECT ed.updated_at INTO v_updated_at FROM public.editor_decisions ed WHERE ed.expediente_id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    'editor'::public.app_role,
    'editor.decision.upsert.auto',
    'editor_decision',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'decision_anterior', CASE WHEN v_prev.expediente_id IS NULL THEN NULL ELSE v_prev.decision END,
      'decision_nueva', p_decision,
      'monto_anterior', v_prev.monto_aprobado,
      'monto_nuevo', v_monto_final,
      'motivo', v_motivo,
      'rfc_infonavit', v_rfc,
      'registro_patronal_infonavit', v_registro_patronal,
      'empresa_infonavit', v_empresa,
      'advertencia_inscripcion', v_advertencia_inscripcion,
      'fuente', 'automatizacion_infonavit'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'decision', p_decision,
    'monto_aprobado', v_monto_final,
    'rfc_infonavit', COALESCE(v_rfc, v_prev.rfc_infonavit),
    'registro_patronal_infonavit', COALESCE(v_registro_patronal, v_prev.registro_patronal_infonavit),
    'empresa_infonavit', COALESCE(v_empresa, v_prev.empresa_infonavit),
    'advertencia_inscripcion', COALESCE(v_advertencia_inscripcion, v_prev.advertencia_inscripcion),
    'editor_id', v_actor_id,
    'updated_at', v_updated_at
  );
END;
$function$;

COMMENT ON FUNCTION public.auto_upsert_editor_decision(
  uuid,
  public.editor_decision,
  numeric,
  text,
  text,
  text,
  text,
  text
) IS
  'Upsert de decisión del editor vía automatización Infonavit. Parámetros Infonavit opcionales: solo actualizan si vienen con valor (no pisan con NULL).';

REVOKE EXECUTE ON FUNCTION public.auto_upsert_editor_decision(
  uuid,
  public.editor_decision,
  numeric,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.auto_upsert_editor_decision(
  uuid,
  public.editor_decision,
  numeric,
  text,
  text,
  text,
  text,
  text
) TO service_role;
