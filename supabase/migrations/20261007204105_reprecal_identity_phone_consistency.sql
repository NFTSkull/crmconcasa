-- ConCasa CRM — re-precalificación consistente: identidad + teléfono + lectura fluida.
-- 1) Resuelve re-precal y refresca identidad en una sola RPC.
-- 2) También conserva la identidad nueva cuando la re-precal termina en no_cumple.
-- 3) Sincroniza el teléfono oficial de cliente_datos hacia expedientes y pendientes.

CREATE OR REPLACE FUNCTION public.auto_refresh_nombre_infonavit_reprecal_resuelto(
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
    RAISE EXCEPTION 'auto_refresh_nombre_infonavit_reprecal_resuelto: perfil de sistema no disponible'
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
    RAISE EXCEPTION 'auto_refresh_nombre_infonavit_reprecal_resuelto: fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_row.decision NOT IN ('aprobado', 'no_cumple') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'intento_no_resuelto');
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
    updated_by = v_actor_id,
    updated_at = now();

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
      'decision_reprecal', v_row.decision,
      'fuente', 'automatizacion_infonavit_reprecal',
      'orden_display', 'nombres_paterno_materno'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', v_row.expediente_id,
    'intento_id', p_intento_id,
    'decision', v_row.decision,
    'nombre_anterior', v_nombre_anterior,
    'nombre_portal', v_nombre_portal,
    'nombre_nuevo', v_nombre_normal,
    'cambio', v_nombre_anterior IS DISTINCT FROM v_nombre_normal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_refresh_nombre_infonavit_reprecal_resuelto(uuid, text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auto_refresh_nombre_infonavit_reprecal_resuelto(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.auto_resolver_reprecalificacion_v2(
  p_intento_id uuid,
  p_decision public.editor_decision,
  p_monto_aprobado numeric DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_rfc text DEFAULT NULL,
  p_registro_patronal text DEFAULT NULL,
  p_empresa text DEFAULT NULL,
  p_advertencia_inscripcion text DEFAULT NULL,
  p_nombre_completo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_nombre_result JSONB := jsonb_build_object('ok', true, 'skipped', true);
  v_exp_id UUID;
  v_rfc TEXT := NULLIF(upper(btrim(COALESCE(p_rfc, ''))), '');
  v_registro TEXT := NULLIF(btrim(COALESCE(p_registro_patronal, '')), '');
  v_empresa TEXT := NULLIF(btrim(COALESCE(p_empresa, '')), '');
  v_advertencia TEXT := NULLIF(btrim(COALESCE(p_advertencia_inscripcion, '')), '');
BEGIN
  v_result := public.auto_resolver_reprecalificacion(
    p_intento_id,
    p_decision,
    p_monto_aprobado,
    p_motivo,
    v_rfc,
    v_registro,
    v_empresa,
    v_advertencia
  );

  v_exp_id := NULLIF(v_result->>'expediente_id', '')::uuid;

  -- La decisión/monto vigentes anteriores se conservan en no_cumple,
  -- pero la identidad laboral sí pertenece a la consulta más reciente.
  IF p_decision = 'no_cumple' AND v_exp_id IS NOT NULL THEN
    UPDATE public.editor_decisions
    SET rfc_infonavit = COALESCE(v_rfc, rfc_infonavit),
        registro_patronal_infonavit = COALESCE(v_registro, registro_patronal_infonavit),
        empresa_infonavit = COALESCE(v_empresa, empresa_infonavit),
        advertencia_inscripcion = COALESCE(v_advertencia, advertencia_inscripcion),
        updated_at = now()
    WHERE expediente_id = v_exp_id;
  END IF;

  IF NULLIF(btrim(COALESCE(p_nombre_completo, '')), '') IS NOT NULL THEN
    v_nombre_result := public.auto_refresh_nombre_infonavit_reprecal_resuelto(
      p_intento_id,
      p_nombre_completo
    );
  END IF;

  RETURN v_result || jsonb_build_object('identity_refresh', v_nombre_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_resolver_reprecalificacion_v2(
  uuid, public.editor_decision, numeric, text, text, text, text, text, text
) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auto_resolver_reprecalificacion_v2(
  uuid, public.editor_decision, numeric, text, text, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.auto_resolver_reprecalificacion_v2(
  uuid, public.editor_decision, numeric, text, text, text, text, text, text
) IS
  'Re-precal automática consistente: resuelve monto/decisión y refresca identidad en la misma transacción; no_cumple conserva monto/programa previos.';

CREATE OR REPLACE FUNCTION public.sync_cliente_datos_telefono_expediente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tel TEXT;
BEGIN
  v_tel := regexp_replace(COALESCE(NEW.telefono_normalizado, ''), '[^0-9]', '', 'g');

  IF v_tel ~ '^[0-9]{10}$' THEN
    UPDATE public.expedientes e
    SET telefono_cliente = v_tel,
        updated_at = now()
    WHERE e.id = NEW.expediente_id
      AND e.deleted_at IS NULL
      AND regexp_replace(COALESCE(e.telefono_cliente::text, ''), '[^0-9]', '', 'g')
          IS DISTINCT FROM v_tel;

    UPDATE public.expediente_precalificacion_intentos i
    SET telefono_cliente = v_tel
    WHERE i.expediente_id = NEW.expediente_id
      AND i.decision = 'pendiente'
      AND regexp_replace(COALESCE(i.telefono_cliente::text, ''), '[^0-9]', '', 'g')
          IS DISTINCT FROM v_tel;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_cliente_datos_telefono_expediente() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_cliente_datos_telefono_expediente() TO service_role, postgres;

DROP TRIGGER IF EXISTS trg_cliente_datos_sync_telefono_expediente ON public.cliente_datos;
CREATE TRIGGER trg_cliente_datos_sync_telefono_expediente
AFTER INSERT OR UPDATE OF telefono_normalizado
ON public.cliente_datos
FOR EACH ROW
EXECUTE FUNCTION public.sync_cliente_datos_telefono_expediente();

-- Backfill conservador: cliente_datos es la fuente oficial de Datos Generales.
UPDATE public.expedientes e
SET telefono_cliente = regexp_replace(cd.telefono_normalizado, '[^0-9]', '', 'g'),
    updated_at = now()
FROM public.cliente_datos cd
WHERE cd.expediente_id = e.id
  AND e.deleted_at IS NULL
  AND regexp_replace(COALESCE(cd.telefono_normalizado, ''), '[^0-9]', '', 'g') ~ '^[0-9]{10}$'
  AND regexp_replace(COALESCE(e.telefono_cliente::text, ''), '[^0-9]', '', 'g')
      IS DISTINCT FROM regexp_replace(cd.telefono_normalizado, '[^0-9]', '', 'g');

UPDATE public.expediente_precalificacion_intentos i
SET telefono_cliente = regexp_replace(cd.telefono_normalizado, '[^0-9]', '', 'g')
FROM public.cliente_datos cd
WHERE cd.expediente_id = i.expediente_id
  AND i.decision = 'pendiente'
  AND regexp_replace(COALESCE(cd.telefono_normalizado, ''), '[^0-9]', '', 'g') ~ '^[0-9]{10}$'
  AND regexp_replace(COALESCE(i.telefono_cliente::text, ''), '[^0-9]', '', 'g')
      IS DISTINCT FROM regexp_replace(cd.telefono_normalizado, '[^0-9]', '', 'g');
