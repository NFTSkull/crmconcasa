ALTER TABLE public.profile_capabilities
  DROP CONSTRAINT IF EXISTS profile_capabilities_capability_check;

ALTER TABLE public.profile_capabilities
  ADD CONSTRAINT profile_capabilities_capability_check
  CHECK (capability = ANY (ARRAY[
    'team_dashboard_read'::text,
    'create_for_any_advisor'::text,
    'integrate_for_any_advisor'::text,
    'ver_externos_mesa'::text,
    'autofill_nombre_infonavit'::text
  ]));

CREATE OR REPLACE FUNCTION public.auto_fill_nombre_infonavit(
  p_expediente_id uuid,
  p_nombre_completo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID := 'a1000000-0000-4000-8000-000000000001';
  v_exp RECORD;
  v_nombre TEXT;
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
  v_nombre := NULLIF(btrim(regexp_replace(COALESCE(p_nombre_completo, ''), '\s+', ' ', 'g')), '');
  IF v_nombre IS NULL OR p_expediente_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nombre_o_expediente_vacio');
  END IF;

  SELECT e.id, e.organization_id, e.asesor_id, e.deleted_at
  INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expediente_no_encontrado');
  END IF;

  IF NOT public.profile_has_capability(v_exp.asesor_id, 'autofill_nombre_infonavit') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sin_capability');
  END IF;

  v_partes := regexp_split_to_array(v_nombre, '\s+');
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
  SET cliente_nombre = v_nombre
  WHERE id = p_expediente_id;

  SELECT datos INTO v_datos_actuales FROM public.cliente_datos WHERE expediente_id = p_expediente_id;
  v_datos_actuales := COALESCE(v_datos_actuales, '{}'::jsonb);
  v_infonavit_actual := COALESCE(v_datos_actuales->'infonavit', jsonb_build_object('schemaVersion', 1));

  v_titular_nuevo := COALESCE(v_infonavit_actual->'titular', '{}'::jsonb)
    || jsonb_build_object('nombres', v_nombres)
    || CASE WHEN v_apellido_paterno IS NOT NULL
         THEN jsonb_build_object('apellidoPaterno', v_apellido_paterno) ELSE '{}'::jsonb END
    || CASE WHEN v_apellido_materno IS NOT NULL
         THEN jsonb_build_object('apellidoMaterno', v_apellido_materno) ELSE '{}'::jsonb END;

  v_infonavit_nuevo := v_infonavit_actual || jsonb_build_object('schemaVersion', 1, 'titular', v_titular_nuevo);
  v_datos_nuevo := v_datos_actuales || jsonb_build_object('infonavit', v_infonavit_nuevo);

  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, updated_by)
  VALUES (p_expediente_id, v_exp.organization_id, v_datos_nuevo, v_actor_id)
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = v_datos_nuevo,
    updated_by = v_actor_id;

  PERFORM public.log_action(
    v_exp.organization_id, v_actor_id, 'editor'::public.app_role,
    'expediente.nombre_infonavit.autofill', 'expediente', p_expediente_id,
    jsonb_build_object(
      'nombre_completo', v_nombre,
      'apellidoPaterno', v_apellido_paterno,
      'apellidoMaterno', v_apellido_materno,
      'nombres', v_nombres
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'expediente_id', p_expediente_id, 'nombre_completo', v_nombre,
    'apellidoPaterno', v_apellido_paterno, 'apellidoMaterno', v_apellido_materno,
    'nombres', v_nombres
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auto_fill_nombre_infonavit(uuid, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auto_fill_nombre_infonavit(uuid, text) TO service_role;
