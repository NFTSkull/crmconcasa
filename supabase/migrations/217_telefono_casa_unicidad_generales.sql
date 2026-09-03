-- ConCasa CRM — P217: teléfono de casa único dentro de Datos Generales.
--
-- Autoridad teléfono de casa: expedientes.telefono_cliente.
-- Teléfonos de Datos Generales cubiertos:
-- - celular
-- - teléfono empresa
-- - referencias 1/2 (legacy)
-- - referencias Infonavit schemaVersion=1 (celular y LADA+teléfono)
--
-- Compatibilidad legacy: no muta filas existentes y permite guardar otros cambios
-- cuando una duplicidad ya existía en el mismo campo antes de P217.

CREATE OR REPLACE FUNCTION public.cliente_datos_telefonos_generales_mapa(
  p_telefono text,
  p_datos jsonb,
  p_referencias jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_datos jsonb := COALESCE(p_datos, '{}'::jsonb);
  v_refs jsonb := COALESCE(p_referencias, '[]'::jsonb);
  v_ref1 text;
  v_ref2 text;
BEGIN
  IF jsonb_typeof(v_refs) = 'array' AND jsonb_array_length(v_refs) > 0 THEN
    v_ref1 := public.cliente_datos_telefono_canonico(
      public.referencia_telefono_raw(v_refs->0)
    );
  END IF;

  IF jsonb_typeof(v_refs) = 'array' AND jsonb_array_length(v_refs) > 1 THEN
    v_ref2 := public.cliente_datos_telefono_canonico(
      public.referencia_telefono_raw(v_refs->1)
    );
  END IF;

  RETURN jsonb_build_object(
    'celular', public.cliente_datos_telefono_canonico(p_telefono),
    'empresa', public.cliente_datos_telefono_canonico(v_datos->>'telefonoEmpresa'),
    'ref1', v_ref1,
    'ref2', v_ref2,
    'infonavit_ref1_celular', public.cliente_datos_telefono_canonico(
      v_datos #>> '{infonavit,referencias,0,celular}'
    ),
    'infonavit_ref1_fijo', public.cliente_datos_lada_telefono_canonico(
      v_datos #>> '{infonavit,referencias,0,lada}',
      v_datos #>> '{infonavit,referencias,0,telefono}'
    ),
    'infonavit_ref2_celular', public.cliente_datos_telefono_canonico(
      v_datos #>> '{infonavit,referencias,1,celular}'
    ),
    'infonavit_ref2_fijo', public.cliente_datos_lada_telefono_canonico(
      v_datos #>> '{infonavit,referencias,1,lada}',
      v_datos #>> '{infonavit,referencias,1,telefono}'
    )
  );
END;
$$;

COMMENT ON FUNCTION public.cliente_datos_telefonos_generales_mapa(text, jsonb, jsonb) IS
  'P217: mapa canónico de todos los teléfonos capturados en Datos Generales para comparar contra telefono_cliente.';

CREATE OR REPLACE FUNCTION public.cliente_datos_guard_telefono_casa_unico_generales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_casa text;
  v_new jsonb;
  v_old jsonb := '{}'::jsonb;
  v_key text;
  v_value text;
BEGIN
  SELECT public.cliente_datos_telefono_canonico(e.telefono_cliente::text)
  INTO v_casa
  FROM public.expedientes e
  WHERE e.id = NEW.expediente_id;

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

    -- Grandfather por campo: una duplicidad legacy sin cambio sigue permitiendo
    -- guardar otros datos; introducirla en otro campo queda bloqueado.
    IF TG_OP = 'UPDATE' AND (v_old->>v_key) = v_casa THEN
      CONTINUE;
    END IF;

    RAISE EXCEPTION 'save_cliente_datos: CLIENTE_DATOS_TELEFONO_CASA_DUPLICADO'
      USING ERRCODE = '22023';
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_datos_telefono_casa_unico_generales
  ON public.cliente_datos;
CREATE TRIGGER trg_cliente_datos_telefono_casa_unico_generales
BEFORE INSERT OR UPDATE OF telefono_normalizado, datos, referencias
ON public.cliente_datos
FOR EACH ROW
EXECUTE FUNCTION public.cliente_datos_guard_telefono_casa_unico_generales();

CREATE OR REPLACE FUNCTION public.expedientes_guard_telefono_casa_unico_generales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_casa text;
  v_old_casa text;
  v_cd public.cliente_datos%ROWTYPE;
  v_groups jsonb;
BEGIN
  v_new_casa := public.cliente_datos_telefono_canonico(NEW.telefono_cliente::text);
  v_old_casa := public.cliente_datos_telefono_canonico(OLD.telefono_cliente::text);

  -- No-op / cambio solo de representación: no romper legacy.
  IF v_new_casa IS NOT DISTINCT FROM v_old_casa THEN
    RETURN NEW;
  END IF;

  IF v_new_casa IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cd.*
  INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = NEW.id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_groups := public.cliente_datos_telefonos_generales_mapa(
    v_cd.telefono_normalizado,
    v_cd.datos,
    v_cd.referencias
  );

  IF EXISTS (
    SELECT 1
    FROM jsonb_each_text(v_groups) AS x(key, value)
    WHERE x.value = v_new_casa
  ) THEN
    RAISE EXCEPTION 'expedientes: TELEFONO_CASA_DUPLICADO_DATOS_GENERALES'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expedientes_telefono_casa_unico_generales
  ON public.expedientes;
CREATE TRIGGER trg_expedientes_telefono_casa_unico_generales
BEFORE UPDATE OF telefono_cliente
ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.expedientes_guard_telefono_casa_unico_generales();

-- P217: ampliar P216 para validar contra TODOS los teléfonos de Datos Generales.
CREATE OR REPLACE FUNCTION public.asesor_actualizar_telefono_casa(
  p_expediente_id uuid,
  p_telefono_casa text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role public.app_role;
  v_org_id uuid;
  v_exp public.expedientes%ROWTYPE;
  v_telefono_nuevo text;
  v_telefono_anterior text;
  v_cd public.cliente_datos%ROWTYPE;
  v_groups jsonb;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: expediente fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: expediente no activo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: solo el asesor dueño puede editar'
      USING ERRCODE = '42501';
  END IF;

  v_telefono_nuevo := public.cliente_datos_telefono_canonico(p_telefono_casa);
  IF v_telefono_nuevo IS NULL THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: TELEFONO_CASA_INVALIDO'
      USING ERRCODE = '22023';
  END IF;

  v_telefono_anterior := public.cliente_datos_telefono_canonico(v_exp.telefono_cliente::text);

  -- No-op seguro: permite expedientes legacy sin forzar limpieza automática.
  IF v_telefono_anterior = v_telefono_nuevo THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'expediente_id', p_expediente_id,
      'telefono_casa', v_telefono_nuevo
    );
  END IF;

  SELECT cd.*
  INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF FOUND THEN
    v_groups := public.cliente_datos_telefonos_generales_mapa(
      v_cd.telefono_normalizado,
      v_cd.datos,
      v_cd.referencias
    );

    IF EXISTS (
      SELECT 1
      FROM jsonb_each_text(v_groups) AS x(key, value)
      WHERE x.value = v_telefono_nuevo
    ) THEN
      RAISE EXCEPTION 'asesor_actualizar_telefono_casa: TELEFONO_CASA_DUPLICADO_DATOS_GENERALES'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.expedientes
  SET telefono_cliente = v_telefono_nuevo,
      updated_at = now()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.telefono_casa.actualizado',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'telefono_anterior_last4', CASE WHEN v_telefono_anterior IS NULL THEN NULL ELSE right(v_telefono_anterior, 4) END,
      'telefono_nuevo_last4', right(v_telefono_nuevo, 4)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'expediente_id', p_expediente_id,
    'telefono_casa', v_telefono_nuevo
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_actualizar_telefono_casa(uuid, text) IS
  'P217: asesor dueño edita telefono_cliente; bloquea igualdad con cualquier teléfono de Datos Generales.';

REVOKE ALL ON FUNCTION public.cliente_datos_telefonos_generales_mapa(text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cliente_datos_guard_telefono_casa_unico_generales()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expedientes_guard_telefono_casa_unico_generales()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_datos_telefonos_generales_mapa(text, jsonb, jsonb)
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.cliente_datos_guard_telefono_casa_unico_generales()
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.expedientes_guard_telefono_casa_unico_generales()
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.asesor_actualizar_telefono_casa(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_actualizar_telefono_casa(uuid, text)
  TO authenticated, postgres, service_role;
