-- ConCasa CRM — Editor: captura manual de nombre, registro patronal y empresa
-- en todas las precalificaciones visibles del inbox.
--
-- No modifica decisión, monto, notas, etapa, Mesa ni bookings.
-- Los datos patronales viven en editor_decisions como fuente Infonavit/manual
-- para alimentar Datos Generales cuando corresponda.

CREATE OR REPLACE FUNCTION public.editor_update_precal_field(
  p_expediente_id UUID,
  p_field TEXT,
  p_value TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp public.expedientes%ROWTYPE;
  v_field TEXT;
  v_raw TEXT;
  v_value TEXT;
  v_old TEXT;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'editor_update_precal_field: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.active = TRUE;

  IF NOT FOUND OR v_role NOT IN ('editor', 'super_admin') THEN
    RAISE EXCEPTION 'editor_update_precal_field: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'editor_update_precal_field: expediente_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_field := lower(btrim(coalesce(p_field, '')));
  IF v_field NOT IN ('cliente_nombre', 'registro_patronal', 'empresa') THEN
    RAISE EXCEPTION 'editor_update_precal_field: campo no permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'editor_update_precal_field: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'editor_update_precal_field: fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  v_raw := btrim(coalesce(p_value, ''));

  IF v_field = 'cliente_nombre' THEN
    IF v_raw = '' THEN
      RAISE EXCEPTION 'editor_update_precal_field: nombre requerido'
        USING ERRCODE = '22023';
    END IF;

    v_value := public.cliente_datos_normalize_person_name(v_raw);
    IF NOT public.cliente_datos_is_valid_person_name(v_value) THEN
      RAISE EXCEPTION 'editor_update_precal_field: nombre inválido'
        USING ERRCODE = '22023';
    END IF;

    v_old := v_exp.cliente_nombre;

    IF v_old IS DISTINCT FROM v_value THEN
      UPDATE public.expedientes
      SET cliente_nombre = v_value,
          updated_at = now()
      WHERE id = v_exp.id;

      PERFORM public.log_action(
        v_exp.organization_id,
        v_actor,
        v_role,
        'editor.precal_field.update',
        'expediente',
        v_exp.id,
        jsonb_build_object(
          'field', 'cliente_nombre',
          'old_value', v_old,
          'new_value', v_value,
          'source', 'editor_manual'
        )
      );
    END IF;

  ELSIF v_field = 'registro_patronal' THEN
    v_value := nullif(upper(regexp_replace(v_raw, '\s+', ' ', 'g')), '');

    IF v_value IS NOT NULL AND length(v_value) > 80 THEN
      RAISE EXCEPTION 'editor_update_precal_field: registro patronal demasiado largo'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.editor_decisions (
      expediente_id,
      decision,
      monto_aprobado,
      notas_revision,
      registro_patronal_infonavit
    )
    VALUES (
      v_exp.id,
      'pendiente'::public.editor_decision,
      NULL,
      '',
      v_value
    )
    ON CONFLICT (expediente_id) DO UPDATE
    SET registro_patronal_infonavit = EXCLUDED.registro_patronal_infonavit,
        updated_at = now()
    RETURNING registro_patronal_infonavit INTO v_value;

    SELECT ed.registro_patronal_infonavit
    INTO v_old
    FROM public.editor_decisions ed
    WHERE ed.expediente_id = v_exp.id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor,
      v_role,
      'editor.precal_field.update',
      'expediente',
      v_exp.id,
      jsonb_build_object(
        'field', 'registro_patronal',
        'new_value', v_value,
        'source', 'editor_manual'
      )
    );

  ELSE
    v_value := nullif(upper(regexp_replace(v_raw, '\s+', ' ', 'g')), '');

    IF v_value IS NOT NULL AND length(v_value) > 200 THEN
      RAISE EXCEPTION 'editor_update_precal_field: nombre de empresa demasiado largo'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.editor_decisions (
      expediente_id,
      decision,
      monto_aprobado,
      notas_revision,
      empresa_infonavit
    )
    VALUES (
      v_exp.id,
      'pendiente'::public.editor_decision,
      NULL,
      '',
      v_value
    )
    ON CONFLICT (expediente_id) DO UPDATE
    SET empresa_infonavit = EXCLUDED.empresa_infonavit,
        updated_at = now();

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor,
      v_role,
      'editor.precal_field.update',
      'expediente',
      v_exp.id,
      jsonb_build_object(
        'field', 'empresa',
        'new_value', v_value,
        'source', 'editor_manual'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', v_exp.id,
    'field', v_field,
    'value', v_value
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.editor_update_precal_field(UUID,TEXT,TEXT)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.editor_update_precal_field(UUID,TEXT,TEXT)
TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.editor_update_precal_field(UUID,TEXT,TEXT)
IS 'Editor/SuperAdmin: captura manual cliente_nombre, registro_patronal o empresa en precalificación sin alterar decisión/monto/flujo.';
