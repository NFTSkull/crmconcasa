-- Editor: nombre + registro patronal editables para todas las precalificaciones.
-- No cambia decisión, monto, etapa, envío a Mesa ni documentos.

CREATE OR REPLACE FUNCTION public.editor_update_precal_nombre(
  p_expediente_id UUID,
  p_nombre_completo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID := public.current_profile_id();
  v_actor RECORD;
  v_exp RECORD;
  v_nombre TEXT;
  v_nombre_raw TEXT;
  v_nombre_anterior TEXT;
  v_partes TEXT[];
  v_n_partes INT;
  v_apellido_paterno TEXT;
  v_apellido_materno TEXT;
  v_nombres TEXT;
  v_datos_actuales JSONB;
  v_infonavit_actual JSONB;
  v_titular_nuevo JSONB;
  v_infonavit_nuevo JSONB;
  v_datos_nuevo JSONB;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'editor_update_precal_nombre: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id, p.app_role, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role IS DISTINCT FROM 'editor'::public.app_role THEN
    RAISE EXCEPTION 'editor_update_precal_nombre: solo editor'
      USING ERRCODE = '42501';
  END IF;

  v_nombre_raw := NULLIF(
    btrim(regexp_replace(COALESCE(p_nombre_completo, ''), '\\s+', ' ', 'g')),
    ''
  );
  IF p_expediente_id IS NULL OR v_nombre_raw IS NULL THEN
    RAISE EXCEPTION 'editor_update_precal_nombre: nombre y expediente requeridos'
      USING ERRCODE = '22023';
  END IF;

  v_nombre := public.cliente_datos_normalize_person_name(
    replace(v_nombre_raw, '#', 'Ñ')
  );
  IF NOT public.cliente_datos_is_valid_person_name(v_nombre) THEN
    RAISE EXCEPTION 'editor_update_precal_nombre: nombre inválido'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.id, e.organization_id, e.cliente_nombre, e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'editor_update_precal_nombre: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_actor.organization_id THEN
    RAISE EXCEPTION 'editor_update_precal_nombre: expediente fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  v_nombre_anterior := v_exp.cliente_nombre;

  v_partes := regexp_split_to_array(v_nombre, '\\s+');
  v_n_partes := array_length(v_partes, 1);
  IF v_n_partes >= 3 THEN
    v_apellido_paterno := v_partes[1];
    v_apellido_materno := v_partes[2];
    v_nombres := array_to_string(v_partes[3:v_n_partes], ' ');
  ELSE
    v_apellido_paterno := NULL;
    v_apellido_materno := NULL;
    v_nombres := v_nombre;
  END IF;

  UPDATE public.expedientes
  SET cliente_nombre = v_nombre,
      updated_at = NOW()
  WHERE id = p_expediente_id;

  SELECT datos
  INTO v_datos_actuales
  FROM public.cliente_datos
  WHERE expediente_id = p_expediente_id;

  v_datos_actuales := COALESCE(v_datos_actuales, '{}'::jsonb);
  v_infonavit_actual := COALESCE(
    v_datos_actuales->'infonavit',
    jsonb_build_object('schemaVersion', 1)
  );
  v_titular_nuevo := COALESCE(v_infonavit_actual->'titular', '{}'::jsonb)
    || jsonb_build_object('nombres', v_nombres)
    || CASE
         WHEN v_apellido_paterno IS NOT NULL
           THEN jsonb_build_object('apellidoPaterno', v_apellido_paterno)
         ELSE '{}'::jsonb
       END
    || CASE
         WHEN v_apellido_materno IS NOT NULL
           THEN jsonb_build_object('apellidoMaterno', v_apellido_materno)
         ELSE '{}'::jsonb
       END;
  v_infonavit_nuevo := v_infonavit_actual
    || jsonb_build_object('schemaVersion', 1, 'titular', v_titular_nuevo);
  v_datos_nuevo := v_datos_actuales
    || jsonb_build_object('nombreCliente', v_nombre)
    || jsonb_build_object('infonavit', v_infonavit_nuevo);

  INSERT INTO public.cliente_datos (
    expediente_id,
    organization_id,
    datos,
    updated_by
  )
  VALUES (
    p_expediente_id,
    v_exp.organization_id,
    v_datos_nuevo,
    v_actor_id
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'editor.precal.nombre.update',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'nombre_anterior', v_nombre_anterior,
      'nombre_nuevo', v_nombre,
      'fuente', 'editor_manual'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'nombre_completo', v_nombre
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.editor_update_precal_nombre(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editor_update_precal_nombre(UUID, TEXT)
  TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.editor_update_precal_nombre(UUID, TEXT) IS
  'Editor: corrige/captura el nombre de cualquier precalificación visible; sincroniza expedientes y cliente_datos con auditoría.';

CREATE OR REPLACE FUNCTION public.editor_update_precal_registro_patronal(
  p_expediente_id UUID,
  p_registro_patronal TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID := public.current_profile_id();
  v_actor RECORD;
  v_exp RECORD;
  v_registro TEXT;
  v_registro_anterior TEXT;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'editor_update_precal_registro_patronal: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id, p.app_role, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role IS DISTINCT FROM 'editor'::public.app_role THEN
    RAISE EXCEPTION 'editor_update_precal_registro_patronal: solo editor'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'editor_update_precal_registro_patronal: expediente requerido'
      USING ERRCODE = '22023';
  END IF;

  v_registro := NULLIF(
    upper(btrim(regexp_replace(COALESCE(p_registro_patronal, ''), '\\s+', ' ', 'g'))),
    ''
  );
  IF v_registro IS NOT NULL AND length(v_registro) > 80 THEN
    RAISE EXCEPTION 'editor_update_precal_registro_patronal: máximo 80 caracteres'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.id, e.organization_id, e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'editor_update_precal_registro_patronal: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_actor.organization_id THEN
    RAISE EXCEPTION 'editor_update_precal_registro_patronal: expediente fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  SELECT ed.registro_patronal_infonavit
  INTO v_registro_anterior
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  INSERT INTO public.editor_decisions (
    expediente_id,
    organization_id,
    decision,
    monto_aprobado,
    notas_revision,
    decided_by,
    registro_patronal_infonavit
  )
  VALUES (
    p_expediente_id,
    v_exp.organization_id,
    'pendiente'::public.editor_decision,
    NULL,
    '',
    v_actor_id,
    v_registro
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    registro_patronal_infonavit = EXCLUDED.registro_patronal_infonavit,
    updated_at = NOW();

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'editor.precal.registro_patronal.update',
    'editor_decision',
    p_expediente_id,
    jsonb_build_object(
      'registro_anterior', v_registro_anterior,
      'registro_nuevo', v_registro,
      'fuente', 'editor_manual'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'registro_patronal', v_registro
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.editor_update_precal_registro_patronal(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editor_update_precal_registro_patronal(UUID, TEXT)
  TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.editor_update_precal_registro_patronal(UUID, TEXT) IS
  'Editor: captura/corrige registro patronal Infonavit sin modificar decisión, monto, etapa ni envío a Mesa.';
