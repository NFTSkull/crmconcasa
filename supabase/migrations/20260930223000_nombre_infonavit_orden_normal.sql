-- ConCasa CRM — nombre Infonavit en orden humano:
-- NOMBRE(S) + APELLIDO PATERNO + APELLIDO MATERNO.
--
-- El portal devuelve: APELLIDO PATERNO + APELLIDO MATERNO + NOMBRE(S).
-- Hasta ahora ese string se guardaba tal cual en expediente/cliente_datos, aunque
-- los campos estructurados intentaban partirlo. Este cambio:
-- 1) centraliza un parser conservador del orden del portal;
-- 2) soporta apellidos con partículas comunes (DE LA, DE LOS, DEL, etc.);
-- 3) guarda cliente_nombre/nombreCliente en orden humano;
-- 4) conserva el nombre crudo normalizado del portal en auditoría;
-- 5) corrige únicamente filas que todavía coinciden exactamente con el último
--    nombre escrito por la automatización (no pisa correcciones manuales).

CREATE OR REPLACE FUNCTION public.infonavit_nombre_portal_parse(p_nombre text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_portal text;
  v_partes text[];
  v_n int;
  v_i int := 1;
  v_paterno text;
  v_materno text;
  v_nombres text;
  v_normal text;
  v_t text;
BEGIN
  v_portal := public.cliente_datos_normalize_person_name(
    replace(COALESCE(p_nombre, ''), '#', 'Ñ')
  );

  IF v_portal IS NULL
     OR btrim(v_portal) = ''
     OR NOT public.cliente_datos_is_valid_person_name(v_portal)
  THEN
    RETURN jsonb_build_object(
      'ok', false,
      'parsed', false,
      'reason', 'nombre_invalido',
      'nombre_portal', NULL
    );
  END IF;

  v_partes := regexp_split_to_array(v_portal, '\s+');
  v_n := COALESCE(array_length(v_partes, 1), 0);

  -- Para afirmar paterno + materno + nombre(s) necesitamos al menos 3 tokens.
  IF v_n < 3 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'parsed', false,
      'reason', 'nombre_ambiguo',
      'nombre_portal', v_portal
    );
  END IF;

  -- Apellido paterno desde el inicio del string del portal.
  v_t := v_partes[v_i];
  IF v_t = 'DE'
     AND v_i + 2 <= v_n
     AND v_partes[v_i + 1] IN ('LA', 'LAS', 'LOS')
  THEN
    v_paterno := concat_ws(' ', v_t, v_partes[v_i + 1], v_partes[v_i + 2]);
    v_i := v_i + 3;
  ELSIF v_t IN ('DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'VAN', 'VON', 'DA', 'DAS', 'DOS')
        AND v_i + 1 <= v_n
  THEN
    v_paterno := concat_ws(' ', v_t, v_partes[v_i + 1]);
    v_i := v_i + 2;
  ELSE
    v_paterno := v_t;
    v_i := v_i + 1;
  END IF;

  -- Deben quedar como mínimo materno + un nombre.
  IF v_i > v_n - 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'parsed', false,
      'reason', 'nombre_ambiguo',
      'nombre_portal', v_portal
    );
  END IF;

  -- Apellido materno, mismas partículas.
  v_t := v_partes[v_i];
  IF v_t = 'DE'
     AND v_i + 2 <= v_n - 1
     AND v_partes[v_i + 1] IN ('LA', 'LAS', 'LOS')
  THEN
    v_materno := concat_ws(' ', v_t, v_partes[v_i + 1], v_partes[v_i + 2]);
    v_i := v_i + 3;
  ELSIF v_t IN ('DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'VAN', 'VON', 'DA', 'DAS', 'DOS')
        AND v_i + 1 <= v_n - 1
  THEN
    v_materno := concat_ws(' ', v_t, v_partes[v_i + 1]);
    v_i := v_i + 2;
  ELSE
    v_materno := v_t;
    v_i := v_i + 1;
  END IF;

  IF v_i > v_n THEN
    RETURN jsonb_build_object(
      'ok', false,
      'parsed', false,
      'reason', 'nombre_ambiguo',
      'nombre_portal', v_portal
    );
  END IF;

  v_nombres := array_to_string(v_partes[v_i:v_n], ' ');
  v_normal := btrim(concat_ws(' ', v_nombres, v_paterno, v_materno));

  IF v_nombres IS NULL OR btrim(v_nombres) = ''
     OR v_paterno IS NULL OR btrim(v_paterno) = ''
     OR v_materno IS NULL OR btrim(v_materno) = ''
     OR NOT public.cliente_datos_is_valid_person_name(v_normal)
  THEN
    RETURN jsonb_build_object(
      'ok', false,
      'parsed', false,
      'reason', 'nombre_ambiguo',
      'nombre_portal', v_portal
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'parsed', true,
    'nombre_portal', v_portal,
    'nombre_normal', v_normal,
    'nombres', v_nombres,
    'apellidoPaterno', v_paterno,
    'apellidoMaterno', v_materno
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.infonavit_nombre_portal_parse(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.infonavit_nombre_portal_parse(text)
  TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.infonavit_nombre_portal_parse(text) IS
  'Convierte nombre del portal Infonavit (paterno materno nombres) a nombres paterno materno; soporta partículas comunes y falla cerrado si no puede separar con seguridad.';

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
  v_parse JSONB;
  v_nombre_portal TEXT;
  v_nombre_normal TEXT;
  v_apellido_paterno TEXT;
  v_apellido_materno TEXT;
  v_nombres TEXT;
  v_datos_actuales JSONB;
  v_infonavit_actual JSONB;
  v_titular_nuevo JSONB;
  v_infonavit_nuevo JSONB;
  v_datos_nuevo JSONB;
  v_hash_normalizado BOOLEAN := FALSE;
BEGIN
  IF p_expediente_id IS NULL OR NULLIF(btrim(COALESCE(p_nombre_completo, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nombre_o_expediente_vacio');
  END IF;

  v_hash_normalizado := position('#' in COALESCE(p_nombre_completo, '')) > 0;
  v_parse := public.infonavit_nombre_portal_parse(p_nombre_completo);

  IF COALESCE((v_parse->>'parsed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', COALESCE(v_parse->>'reason', 'nombre_ambiguo'),
      'nombre_portal', v_parse->>'nombre_portal'
    );
  END IF;

  v_nombre_portal := v_parse->>'nombre_portal';
  v_nombre_normal := v_parse->>'nombre_normal';
  v_apellido_paterno := v_parse->>'apellidoPaterno';
  v_apellido_materno := v_parse->>'apellidoMaterno';
  v_nombres := v_parse->>'nombres';

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.deleted_at,
    p.active AS asesor_active,
    p.app_role AS asesor_role
  INTO v_exp
  FROM public.expedientes e
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expediente_no_encontrado');
  END IF;

  IF v_exp.asesor_active IS DISTINCT FROM TRUE
     OR v_exp.asesor_role IS DISTINCT FROM 'asesor'::public.app_role THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'asesor_no_activo');
  END IF;

  UPDATE public.expedientes
  SET cliente_nombre = v_nombre_normal,
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
    || jsonb_build_object(
      'nombres', v_nombres,
      'apellidoPaterno', v_apellido_paterno,
      'apellidoMaterno', v_apellido_materno
    );

  v_infonavit_nuevo := v_infonavit_actual
    || jsonb_build_object(
      'schemaVersion', 1,
      'titular', v_titular_nuevo
    );

  v_datos_nuevo := v_datos_actuales
    || jsonb_build_object('infonavit', v_infonavit_nuevo)
    || jsonb_build_object('nombreCliente', v_nombre_normal);

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
    datos = v_datos_nuevo,
    updated_by = v_actor_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    'editor'::public.app_role,
    'expediente.nombre_infonavit.autofill',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'nombre_portal', v_nombre_portal,
      'nombre_completo', v_nombre_normal,
      'apellidoPaterno', v_apellido_paterno,
      'apellidoMaterno', v_apellido_materno,
      'nombres', v_nombres,
      'hash_a_enie_normalizado', v_hash_normalizado,
      'fuente', 'precalificacion_infonavit',
      'scope', 'todos_asesores_activos',
      'orden_display', 'nombres_paterno_materno'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'nombre_portal', v_nombre_portal,
    'nombre_completo', v_nombre_normal,
    'apellidoPaterno', v_apellido_paterno,
    'apellidoMaterno', v_apellido_materno,
    'nombres', v_nombres,
    'hash_a_enie_normalizado', v_hash_normalizado
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_fill_nombre_infonavit(uuid, text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auto_fill_nombre_infonavit(uuid, text)
  TO service_role;

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
  v_parse JSONB;
  v_nombre_portal TEXT;
  v_nombre_normal TEXT;
  v_nombre_anterior TEXT;
  v_apellido_paterno TEXT;
  v_apellido_materno TEXT;
  v_nombres TEXT;
  v_datos_actuales JSONB;
  v_infonavit_actual JSONB;
  v_titular_nuevo JSONB;
  v_infonavit_nuevo JSONB;
  v_datos_nuevo JSONB;
BEGIN
  IF p_intento_id IS NULL OR NULLIF(btrim(COALESCE(p_nombre_completo, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'intento_o_nombre_vacio');
  END IF;

  v_parse := public.infonavit_nombre_portal_parse(p_nombre_completo);
  IF COALESCE((v_parse->>'parsed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', COALESCE(v_parse->>'reason', 'nombre_ambiguo'),
      'nombre_portal', v_parse->>'nombre_portal'
    );
  END IF;

  v_nombre_portal := v_parse->>'nombre_portal';
  v_nombre_normal := v_parse->>'nombre_normal';
  v_apellido_paterno := v_parse->>'apellidoPaterno';
  v_apellido_materno := v_parse->>'apellidoMaterno';
  v_nombres := v_parse->>'nombres';

  SELECT organization_id
  INTO v_org
  FROM public.profiles
  WHERE id = v_actor_id
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'auto_refresh_nombre_infonavit_reprecal: perfil de sistema no disponible'
      USING ERRCODE = '42501';
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

  IF v_row.decision IS DISTINCT FROM 'aprobado' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'intento_no_aprobado');
  END IF;

  IF v_row.deleted_at IS NOT NULL OR v_row.ciclo_estado <> 'activo' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expediente_no_disponible');
  END IF;

  v_nombre_anterior := NULLIF(btrim(COALESCE(v_row.cliente_nombre, '')), '');

  UPDATE public.expedientes
  SET cliente_nombre = v_nombre_normal,
      updated_at = now()
  WHERE id = v_row.expediente_id
    AND cliente_nombre IS DISTINCT FROM v_nombre_normal;

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
    || jsonb_build_object(
      'nombres', v_nombres,
      'apellidoPaterno', v_apellido_paterno,
      'apellidoMaterno', v_apellido_materno
    );

  v_infonavit_nuevo := v_infonavit_actual
    || jsonb_build_object(
      'schemaVersion', 1,
      'titular', v_titular_nuevo
    );

  v_datos_nuevo := v_datos_actuales
    || jsonb_build_object('infonavit', v_infonavit_nuevo)
    || jsonb_build_object('nombreCliente', v_nombre_normal);

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
      'nombre_portal', v_nombre_portal,
      'nombre_nuevo', v_nombre_normal,
      'apellidoPaterno', v_apellido_paterno,
      'apellidoMaterno', v_apellido_materno,
      'nombres', v_nombres,
      'cambio', v_nombre_anterior IS DISTINCT FROM v_nombre_normal,
      'fuente', 'automatizacion_infonavit_reprecal',
      'orden_display', 'nombres_paterno_materno'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', v_row.expediente_id,
    'intento_id', p_intento_id,
    'nombre_anterior', v_nombre_anterior,
    'nombre_portal', v_nombre_portal,
    'nombre_nuevo', v_nombre_normal,
    'cambio', v_nombre_anterior IS DISTINCT FROM v_nombre_normal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_refresh_nombre_infonavit_reprecal(uuid, text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auto_refresh_nombre_infonavit_reprecal(uuid, text)
  TO service_role;

-- Backfill quirúrgico:
-- solo expedientes cuyo nombre ACTUAL sigue siendo exactamente el último nombre
-- crudo que escribió esta automatización. Si alguien lo corrigió manualmente,
-- queda fuera del UPDATE.
DO $backfill$
DECLARE
  r RECORD;
  v_parse JSONB;
  v_nombre_normal TEXT;
  v_nombres TEXT;
  v_paterno TEXT;
  v_materno TEXT;
  v_datos JSONB;
  v_inf JSONB;
  v_titular JSONB;
  v_datos_nuevo JSONB;
BEGIN
  FOR r IN
    WITH latest_name_action AS (
      SELECT DISTINCT ON (al.entity_id)
        al.entity_id AS expediente_id,
        al.created_at AS action_at,
        al.action,
        CASE
          WHEN al.action = 'expediente.nombre_infonavit.autofill'
            THEN COALESCE(NULLIF(al.payload->>'nombre_portal', ''), NULLIF(al.payload->>'nombre_completo', ''))
          WHEN al.action = 'expediente.nombre_infonavit.refresh_reprecal'
            THEN COALESCE(NULLIF(al.payload->>'nombre_portal', ''), NULLIF(al.payload->>'nombre_nuevo', ''))
        END AS portal_nombre
      FROM public.action_log al
      WHERE al.action IN (
        'expediente.nombre_infonavit.autofill',
        'expediente.nombre_infonavit.refresh_reprecal'
      )
      ORDER BY al.entity_id, al.created_at DESC
    )
    SELECT
      e.id,
      e.organization_id,
      e.cliente_nombre,
      e.submitted_to_mesa,
      e.etapa_actual,
      a.portal_nombre,
      cd.datos
    FROM latest_name_action a
    JOIN public.expedientes e ON e.id = a.expediente_id
    LEFT JOIN public.cliente_datos cd ON cd.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND a.portal_nombre IS NOT NULL
      AND upper(btrim(e.cliente_nombre)) = upper(btrim(a.portal_nombre))
  LOOP
    v_parse := public.infonavit_nombre_portal_parse(r.portal_nombre);

    IF COALESCE((v_parse->>'parsed')::boolean, false) IS NOT TRUE THEN
      CONTINUE;
    END IF;

    v_nombre_normal := v_parse->>'nombre_normal';
    v_nombres := v_parse->>'nombres';
    v_paterno := v_parse->>'apellidoPaterno';
    v_materno := v_parse->>'apellidoMaterno';

    IF v_nombre_normal IS NULL
       OR upper(btrim(v_nombre_normal)) = upper(btrim(r.cliente_nombre))
    THEN
      CONTINUE;
    END IF;

    UPDATE public.expedientes
    SET cliente_nombre = v_nombre_normal,
        updated_at = now()
    WHERE id = r.id
      AND upper(btrim(cliente_nombre)) = upper(btrim(r.portal_nombre));

    IF FOUND THEN
      v_datos := COALESCE(r.datos, '{}'::jsonb);
      v_inf := COALESCE(v_datos->'infonavit', jsonb_build_object('schemaVersion', 1));
      v_titular := COALESCE(v_inf->'titular', '{}'::jsonb)
        || jsonb_build_object(
          'nombres', v_nombres,
          'apellidoPaterno', v_paterno,
          'apellidoMaterno', v_materno
        );
      v_inf := v_inf || jsonb_build_object('schemaVersion', 1, 'titular', v_titular);
      v_datos_nuevo := v_datos
        || jsonb_build_object('infonavit', v_inf)
        || jsonb_build_object('nombreCliente', v_nombre_normal);

      UPDATE public.cliente_datos
      SET datos = v_datos_nuevo
      WHERE expediente_id = r.id;

      PERFORM public.log_action(
        r.organization_id,
        NULL,
        NULL,
        'expediente.nombre_infonavit.normal_order_backfill',
        'expediente',
        r.id,
        jsonb_build_object(
          'nombre_anterior', r.cliente_nombre,
          'nombre_portal', r.portal_nombre,
          'nombre_normal', v_nombre_normal,
          'nombres', v_nombres,
          'apellidoPaterno', v_paterno,
          'apellidoMaterno', v_materno,
          'submitted_to_mesa', r.submitted_to_mesa,
          'etapa_actual', r.etapa_actual,
          'criterio', 'current_equals_latest_automation_raw',
          'source', '20260930223000_nombre_infonavit_orden_normal'
        )
      );
    END IF;
  END LOOP;
END;
$backfill$;

COMMENT ON FUNCTION public.auto_fill_nombre_infonavit(uuid, text) IS
  'Autofill global: toma nombre del portal (paterno materno nombres), lo persiste como nombres paterno materno y mantiene componentes estructurados.';
COMMENT ON FUNCTION public.auto_refresh_nombre_infonavit_reprecal(uuid, text) IS
  'Re-precal: refresca nombre desde portal y lo persiste en orden nombres paterno materno; no toca RFC de Datos Generales.';
