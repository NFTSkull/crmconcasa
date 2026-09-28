-- P229: al aprobar una re-precalificación automática, refrescar también el
-- nombre que Bansefi/Infonavit devuelve. RFC/registro/empresa/advertencia se
-- actualizan en auto_resolver_reprecalificacion; este RPC completa identidad.
--
-- Importante: NO copia rfc_infonavit a cliente_datos.datos.rfc. Esas fuentes
-- deben permanecer independientes para conservar el gate fiscal/SAT.

CREATE OR REPLACE FUNCTION public.auto_refresh_nombre_infonavit_reprecal(
  p_intento_id uuid,
  p_nombre_completo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID := 'a1000000-0000-4000-8000-000000000001';
  v_org UUID;
  v_row RECORD;
  v_nombre_raw TEXT;
  v_nombre TEXT;
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
  v_nombre_raw := NULLIF(
    btrim(regexp_replace(COALESCE(p_nombre_completo, ''), '\s+', ' ', 'g')),
    ''
  );

  IF p_intento_id IS NULL OR v_nombre_raw IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'intento_o_nombre_vacio');
  END IF;

  SELECT organization_id
  INTO v_org
  FROM public.profiles
  WHERE id = v_actor_id
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'auto_refresh_nombre_infonavit_reprecal: perfil de sistema no disponible'
      USING ERRCODE = '42501';
  END IF;

  -- El scraper históricamente puede representar Ñ como #.
  v_nombre := upper(replace(v_nombre_raw, '#', 'Ñ'));

  IF NOT public.cliente_datos_is_valid_person_name(v_nombre) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nombre_invalido');
  END IF;

  SELECT
    i.id AS intento_id,
    i.organization_id,
    i.decision,
    i.expediente_id,
    e.deleted_at,
    e.ciclo_estado,
    e.cliente_nombre
  INTO v_row
  FROM public.expediente_precalificacion_intentos i
  JOIN public.expedientes e ON e.id = i.expediente_id
  WHERE i.id = p_intento_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'intento_no_encontrado');
  END IF;

  IF v_row.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'auto_refresh_nombre_infonavit_reprecal: fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  -- Solo una re-precalificación que YA quedó aprobada puede refrescar identidad.
  IF v_row.decision IS DISTINCT FROM 'aprobado' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'intento_no_aprobado');
  END IF;

  IF v_row.deleted_at IS NOT NULL OR v_row.ciclo_estado <> 'activo' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expediente_no_disponible');
  END IF;

  v_nombre_anterior := NULLIF(btrim(COALESCE(v_row.cliente_nombre, '')), '');

  v_partes := regexp_split_to_array(v_nombre, '\s+');
  v_n_partes := array_length(v_partes, 1);

  IF v_n_partes >= 3 THEN
    -- Convención del portal: ApellidoPaterno ApellidoMaterno Nombre(s).
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
      updated_at = now()
  WHERE id = v_row.expediente_id
    AND cliente_nombre IS DISTINCT FROM v_nombre;

  SELECT datos
  INTO v_datos_actuales
  FROM public.cliente_datos
  WHERE expediente_id = v_row.expediente_id;

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
    || jsonb_build_object(
      'schemaVersion', 1,
      'titular', v_titular_nuevo
    );

  v_datos_nuevo := v_datos_actuales
    || jsonb_build_object('infonavit', v_infonavit_nuevo)
    || jsonb_build_object('nombreCliente', v_nombre);

  INSERT INTO public.cliente_datos (
    expediente_id,
    organization_id,
    datos,
    updated_by
  )
  VALUES (
    v_row.expediente_id,
    v_org,
    v_datos_nuevo,
    v_actor_id
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = v_datos_nuevo,
    updated_by = v_actor_id;

  PERFORM public.log_action(
    v_org,
    v_actor_id,
    'editor'::public.app_role,
    'expediente.nombre_infonavit.refresh_reprecal',
    'expediente',
    v_row.expediente_id,
    jsonb_build_object(
      'intento_id', p_intento_id,
      'nombre_anterior', v_nombre_anterior,
      'nombre_nuevo', v_nombre,
      'cambio', v_nombre_anterior IS DISTINCT FROM v_nombre,
      'fuente', 'automatizacion_infonavit_reprecal'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', v_row.expediente_id,
    'intento_id', p_intento_id,
    'nombre_anterior', v_nombre_anterior,
    'nombre_nuevo', v_nombre,
    'cambio', v_nombre_anterior IS DISTINCT FROM v_nombre
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_refresh_nombre_infonavit_reprecal(uuid, text)
  FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.auto_refresh_nombre_infonavit_reprecal(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.auto_refresh_nombre_infonavit_reprecal(uuid, text) IS
  'P229: refresca nombre/titular desde Bansefi tras re-precal automática aprobada; no toca RFC de Datos Generales.';
