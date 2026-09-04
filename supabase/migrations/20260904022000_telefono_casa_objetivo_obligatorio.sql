-- ConCasa CRM — teléfono de casa objetivo + obligatoriedad segura.
--
-- Corrige la carrera lógica de P218: save_cliente_datos se ejecutaba antes de
-- asesor_actualizar_telefono_casa, por lo que los triggers P215/P217 comparaban
-- el celular nuevo contra el telefono_cliente VIEJO del expediente.
--
-- Estrategia:
-- - el wrapper atómico resuelve primero el teléfono de casa OBJETIVO;
-- - lo publica solo dentro de la transacción mediante set_config(..., true);
-- - los triggers de cliente_datos usan ese objetivo para validar el payload nuevo;
-- - al final asesor_actualizar_telefono_casa persiste el objetivo y vuelve a
--   validar contra el estado final de Datos Generales;
-- - cualquier fallo revierte la transacción completa.
--
-- Compatibilidad: p_telefono_casa NULL (bundle anterior) reutiliza el valor actual
-- si ya es un teléfono válido. Cadena vacía o ausencia real de teléfono = error.
-- Sin backfill, sin UPDATE masivo y sin mutar datos al aplicar la migración.

CREATE OR REPLACE FUNCTION public.cliente_datos_guard_celular_distinto_telefono_casa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telefono_casa TEXT;
  v_telefono_casa_objetivo TEXT;
  v_celular_nuevo TEXT;
  v_celular_anterior TEXT;
BEGIN
  v_telefono_casa_objetivo := NULLIF(
    current_setting('concasa.pending_telefono_casa', true),
    ''
  );

  IF v_telefono_casa_objetivo IS NOT NULL THEN
    v_telefono_casa := public.normalize_telefono_mexico(v_telefono_casa_objetivo);
  ELSE
    SELECT public.normalize_telefono_mexico(e.telefono_cliente::TEXT)
    INTO v_telefono_casa
    FROM public.expedientes e
    WHERE e.id = NEW.expediente_id;
  END IF;

  v_celular_nuevo := public.normalize_telefono_mexico(NEW.telefono_normalizado);

  IF v_telefono_casa IS NULL
     OR v_celular_nuevo IS NULL
     OR v_telefono_casa !~ '^[0-9]{10}$'
     OR v_celular_nuevo !~ '^[0-9]{10}$'
     OR v_telefono_casa IS DISTINCT FROM v_celular_nuevo THEN
    RETURN NEW;
  END IF;

  -- Compatibilidad legacy: el guardado final del wrapper volverá a validar el
  -- teléfono objetivo contra TODOS los teléfonos ya persistidos.
  IF TG_OP = 'UPDATE' THEN
    v_celular_anterior := public.normalize_telefono_mexico(OLD.telefono_normalizado);
    IF v_celular_anterior = v_telefono_casa
       AND v_celular_anterior = v_celular_nuevo THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'save_cliente_datos: CLIENTE_DATOS_CELULAR_IGUAL_TELEFONO_CASA'
    USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.cliente_datos_guard_telefono_casa_unico_generales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_casa text;
  v_casa_objetivo text;
  v_new jsonb;
  v_old jsonb := '{}'::jsonb;
  v_key text;
  v_value text;
BEGIN
  v_casa_objetivo := NULLIF(
    current_setting('concasa.pending_telefono_casa', true),
    ''
  );

  IF v_casa_objetivo IS NOT NULL THEN
    v_casa := public.cliente_datos_telefono_canonico(v_casa_objetivo);
  ELSE
    SELECT public.cliente_datos_telefono_canonico(e.telefono_cliente::text)
    INTO v_casa
    FROM public.expedientes e
    WHERE e.id = NEW.expediente_id;
  END IF;

  IF v_casa IS NULL THEN
    RETURN NEW;
  END IF;

  v_new := public.cliente_datos_telefonos_generales_mapa(
    NEW.telefono_normalizado,
    NEW.datos,
    NEW.referencias
  );

  IF TG_OP = 'UPDATE' THEN
    v_old := public.cliente_datos_telefonos_generales_mapa(
      OLD.telefono_normalizado,
      OLD.datos,
      OLD.referencias
    );
  END IF;

  FOR v_key, v_value IN
    SELECT key, value
    FROM jsonb_each_text(v_new)
  LOOP
    IF v_value IS NULL OR v_value IS DISTINCT FROM v_casa THEN
      CONTINUE;
    END IF;

    IF TG_OP = 'UPDATE' AND (v_old->>v_key) = v_casa THEN
      CONTINUE;
    END IF;

    RAISE EXCEPTION 'save_cliente_datos: CLIENTE_DATOS_TELEFONO_CASA_DUPLICADO'
      USING ERRCODE = '22023';
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  p_expediente_id uuid,
  p_rfc text,
  p_telefono text,
  p_referencias jsonb,
  p_datos jsonb,
  p_estado public.cliente_datos_estado,
  p_porcentaje_cobro numeric,
  p_metodo_pago text,
  p_direccion_opcional text,
  p_monto_calculado_manual numeric,
  p_telefono_casa text,
  p_es_correccion boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_telefono_casa_actual text;
  v_telefono_casa_objetivo text;
  v_telefono_casa_param_presente boolean := p_telefono_casa IS NOT NULL;
BEGIN
  -- Cadena vacía representa que el usuario dejó explícitamente vacío el campo.
  IF p_telefono_casa IS NOT NULL
     AND NULLIF(btrim(p_telefono_casa), '') IS NULL THEN
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_con_telefono_casa: TELEFONO_CASA_REQUERIDO'
      USING ERRCODE = '22023';
  END IF;

  IF p_telefono_casa IS NULL THEN
    SELECT public.cliente_datos_telefono_canonico(e.telefono_cliente::text)
    INTO v_telefono_casa_actual
    FROM public.expedientes e
    WHERE e.id = p_expediente_id;

    v_telefono_casa_objetivo := v_telefono_casa_actual;
  ELSE
    v_telefono_casa_objetivo := public.cliente_datos_telefono_canonico(p_telefono_casa);
  END IF;

  IF v_telefono_casa_objetivo IS NULL THEN
    IF p_telefono_casa IS NULL THEN
      RAISE EXCEPTION 'asesor_guardar_cliente_datos_con_telefono_casa: TELEFONO_CASA_REQUERIDO'
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_con_telefono_casa: TELEFONO_CASA_INVALIDO'
      USING ERRCODE = '22023';
  END IF;

  -- Solo vive en esta transacción (is_local=true). Los triggers P215/P217 leen
  -- este objetivo en vez del valor histórico todavía persistido en expedientes.
  PERFORM set_config(
    'concasa.pending_telefono_casa',
    v_telefono_casa_objetivo,
    true
  );

  IF p_es_correccion IS TRUE THEN
    v_result := public.save_cliente_datos_correccion(
      p_expediente_id,
      p_rfc,
      p_telefono,
      p_referencias,
      NULL,
      p_datos,
      p_porcentaje_cobro,
      p_metodo_pago,
      p_direccion_opcional,
      p_monto_calculado_manual
    );
  ELSE
    v_result := public.save_cliente_datos(
      p_expediente_id,
      p_rfc,
      p_telefono,
      p_referencias,
      NULL,
      p_datos,
      COALESCE(p_estado, 'completo'::public.cliente_datos_estado),
      p_porcentaje_cobro,
      p_metodo_pago,
      p_direccion_opcional,
      p_monto_calculado_manual
    );
  END IF;

  -- Si el bundle actual envió el campo, persistirlo. La RPC vuelve a validar el
  -- objetivo contra el estado FINAL de Datos Generales. Si falla, rollback total.
  IF v_telefono_casa_param_presente THEN
    PERFORM public.asesor_actualizar_telefono_casa(
      p_expediente_id,
      v_telefono_casa_objetivo
    );
  END IF;

  PERFORM set_config('concasa.pending_telefono_casa', '', true);

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'telefono_casa_guardado', true,
    'telefono_casa', v_telefono_casa_objetivo
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  uuid, text, text, jsonb, jsonb, public.cliente_datos_estado,
  numeric, text, text, numeric, text, boolean
) IS
  'Guardado atómico DG + teléfono casa: exige casa válida y valida DG contra el teléfono objetivo, no contra el histórico.';

REVOKE ALL ON FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  uuid, text, text, jsonb, jsonb, public.cliente_datos_estado,
  numeric, text, text, numeric, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  uuid, text, text, jsonb, jsonb, public.cliente_datos_estado,
  numeric, text, text, numeric, text, boolean
) TO authenticated, postgres, service_role;

-- Las funciones trigger siguen siendo internas.
REVOKE ALL ON FUNCTION public.cliente_datos_guard_celular_distinto_telefono_casa()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cliente_datos_guard_telefono_casa_unico_generales()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_datos_guard_celular_distinto_telefono_casa()
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.cliente_datos_guard_telefono_casa_unico_generales()
  TO postgres, service_role;
