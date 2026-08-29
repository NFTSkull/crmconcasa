-- P216: auto_resolver_reprecalificacion — automatización Infonavit sobre intento pendiente.
-- Espejo de editor_resolver_reprecalificacion con actor de sistema (service_role).
-- Aprobado: monto + programa_solicitado + campos Infonavit opcionales (no pisan con NULL).
-- no_cumple: cierra intento; NO toca editor_decisions / programa / etapa (igual que P155/P168).
-- A diferencia de auto_upsert_editor_decision: SÍ permite expedientes ya enviados a Mesa.

CREATE OR REPLACE FUNCTION public.auto_resolver_reprecalificacion(
  p_intento_id UUID,
  p_decision public.editor_decision,
  p_monto_aprobado NUMERIC DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL,
  p_rfc TEXT DEFAULT NULL,
  p_registro_patronal TEXT DEFAULT NULL,
  p_empresa TEXT DEFAULT NULL,
  p_advertencia_inscripcion TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := 'a1000000-0000-4000-8000-000000000001';
  v_role public.app_role := 'editor';
  v_org UUID;
  v_intento public.expediente_precalificacion_intentos%ROWTYPE;
  v_exp public.expedientes%ROWTYPE;
  v_ed public.editor_decisions%ROWTYPE;
  v_monto NUMERIC(14, 2);
  v_motivo TEXT;
  v_rfc TEXT;
  v_registro_patronal TEXT;
  v_empresa TEXT;
  v_advertencia_inscripcion TEXT;
  v_cambio BOOLEAN;
  v_programa_anterior public.programa;
BEGIN
  SELECT organization_id INTO v_org
  FROM public.profiles
  WHERE id = v_actor AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'auto_resolver_reprecalificacion: perfil de sistema no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF p_intento_id IS NULL OR p_decision IS NULL THEN
    RAISE EXCEPTION 'auto_resolver_reprecalificacion: intento y decision obligatorios'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision NOT IN ('aprobado', 'no_cumple') THEN
    RAISE EXCEPTION 'auto_resolver_reprecalificacion: decision debe ser aprobado o no_cumple'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := COALESCE(NULLIF(btrim(COALESCE(p_motivo, '')), ''), '');
  v_rfc := NULLIF(btrim(COALESCE(p_rfc, '')), '');
  v_registro_patronal := NULLIF(btrim(COALESCE(p_registro_patronal, '')), '');
  v_empresa := NULLIF(btrim(COALESCE(p_empresa, '')), '');
  v_advertencia_inscripcion := NULLIF(btrim(COALESCE(p_advertencia_inscripcion, '')), '');

  SELECT * INTO v_intento
  FROM public.expediente_precalificacion_intentos i
  WHERE i.id = p_intento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'auto_resolver_reprecalificacion: intento no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_intento.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'auto_resolver_reprecalificacion: fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_intento.decision IS DISTINCT FROM 'pendiente' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'intento_id', v_intento.id,
      'expediente_id', v_intento.expediente_id,
      'decision', v_intento.decision,
      'monto_aprobado', v_intento.monto_aprobado,
      'programa', v_intento.programa,
      'programa_solicitado', v_intento.programa_solicitado
    );
  END IF;

  SELECT * INTO v_exp FROM public.expedientes e WHERE e.id = v_intento.expediente_id FOR UPDATE;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL OR v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'auto_resolver_reprecalificacion: expediente no disponible'
      USING ERRCODE = '22023';
  END IF;

  v_programa_anterior := v_exp.programa;
  v_cambio := (v_intento.programa_solicitado IS DISTINCT FROM v_exp.programa);

  IF p_decision = 'aprobado' THEN
    IF p_monto_aprobado IS NULL OR p_monto_aprobado <= 0 THEN
      RAISE EXCEPTION 'auto_resolver_reprecalificacion: monto_aprobado > 0 requerido'
        USING ERRCODE = '22023';
    END IF;
    v_monto := round(p_monto_aprobado::NUMERIC, 2);

    SELECT * INTO v_ed FROM public.editor_decisions ed WHERE ed.expediente_id = v_exp.id;

    UPDATE public.expediente_precalificacion_intentos
    SET es_vigente = false
    WHERE expediente_id = v_exp.id AND es_vigente = true;

    UPDATE public.expediente_precalificacion_intentos
    SET decision = 'aprobado',
        monto_aprobado = v_monto,
        notas_revision = v_motivo,
        es_vigente = true,
        decided_by = v_actor,
        decided_at = now()
    WHERE id = v_intento.id;

    INSERT INTO public.editor_decisions (
      expediente_id, organization_id, decision, monto_aprobado, notas_revision,
      decided_by, aprobado_at, monto_aprobado_al_aprobar,
      rfc_infonavit, registro_patronal_infonavit, empresa_infonavit, advertencia_inscripcion
    ) VALUES (
      v_exp.id, v_org, 'aprobado', v_monto, v_motivo,
      v_actor,
      coalesce(v_ed.aprobado_at, now()),
      coalesce(v_ed.monto_aprobado_al_aprobar, v_monto),
      v_rfc, v_registro_patronal, v_empresa, v_advertencia_inscripcion
    )
    ON CONFLICT (expediente_id) DO UPDATE
    SET decision = 'aprobado',
        monto_aprobado = EXCLUDED.monto_aprobado,
        notas_revision = EXCLUDED.notas_revision,
        decided_by = EXCLUDED.decided_by,
        aprobado_at = public.editor_decisions.aprobado_at,
        monto_aprobado_al_aprobar = public.editor_decisions.monto_aprobado_al_aprobar,
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
        END,
        updated_at = now();

    UPDATE public.expedientes
    SET reprecalificacion_pendiente_id = NULL,
        programa = COALESCE(v_intento.programa_solicitado, v_exp.programa),
        updated_at = now()
    WHERE id = v_exp.id;

    PERFORM public.log_action(
      v_org, v_actor, v_role,
      'editor.reprecalificacion.aprobar.auto',
      'expediente', v_exp.id,
      jsonb_build_object(
        'intento_id', v_intento.id,
        'monto_aprobado', v_monto,
        'intento_previo_id', v_intento.intento_previo_id,
        'programa_anterior', v_programa_anterior,
        'programa_solicitado', v_intento.programa_solicitado,
        'cambio_programa', v_cambio,
        'rfc_infonavit', v_rfc,
        'registro_patronal_infonavit', v_registro_patronal,
        'empresa_infonavit', v_empresa,
        'advertencia_inscripcion', v_advertencia_inscripcion,
        'fuente', 'automatizacion_infonavit'
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', v_exp.id,
      'intento_id', v_intento.id,
      'decision', 'aprobado',
      'monto_aprobado', v_monto,
      'programa', COALESCE(v_intento.programa_solicitado, v_programa_anterior),
      'programa_anterior', v_programa_anterior,
      'programa_solicitado', v_intento.programa_solicitado,
      'cambio_programa', v_cambio,
      'message', 'Precalificación actualizada en el mismo expediente (automatización).'
    );
  END IF;

  -- no_cumple: historial sí; NO tocar editor_decisions ni programa ni etapa
  UPDATE public.expediente_precalificacion_intentos
  SET decision = 'no_cumple',
      monto_aprobado = NULL,
      notas_revision = v_motivo,
      es_vigente = false,
      decided_by = v_actor,
      decided_at = now()
  WHERE id = v_intento.id;

  UPDATE public.expedientes
  SET reprecalificacion_pendiente_id = NULL,
      updated_at = now()
  WHERE id = v_exp.id;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'editor.reprecalificacion.no_cumple.auto',
    'expediente', v_exp.id,
    jsonb_build_object(
      'intento_id', v_intento.id,
      'intento_previo_id', v_intento.intento_previo_id,
      'programa_anterior', v_programa_anterior,
      'programa_solicitado', v_intento.programa_solicitado,
      'cambio_programa', v_cambio,
      'fuente', 'automatizacion_infonavit'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', v_exp.id,
    'intento_id', v_intento.id,
    'decision', 'no_cumple',
    'programa', v_programa_anterior,
    'programa_solicitado', v_intento.programa_solicitado,
    'cambio_programa', v_cambio,
    'message', 'Intento no aprobado (automatización). Se conservó la precalificación vigente anterior.'
  );
END;
$$;

COMMENT ON FUNCTION public.auto_resolver_reprecalificacion(
  UUID, public.editor_decision, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT
) IS
  'P216: resuelve re-precal vía automatización Infonavit (service_role). Aprobado: monto+programa+Infonavit; no_cumple conserva vigentes. Permite post-Mesa.';

REVOKE ALL ON FUNCTION public.auto_resolver_reprecalificacion(
  UUID, public.editor_decision, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.auto_resolver_reprecalificacion(
  UUID, public.editor_decision, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
