-- ConCasa CRM — P224: separar teléfono de casa del celular principal del expediente.
--
-- Invariante nuevo:
-- - expedientes.telefono_cliente = celular principal del expediente.
-- - expedientes.telefono_casa = teléfono de casa capturado en Datos Generales.
-- - cliente_datos.telefono_normalizado = celular validado en Datos Generales.
--
-- Corrige P215–P220, que reutilizaban telefono_cliente como teléfono de casa y por ello
-- reemplazaban el teléfono principal al guardar Datos Generales.
--
-- Reparación acotada: solo migra/restaura expedientes que realmente fueron modificados
-- por `expediente.telefono_casa.actualizado`. No toca el resto del histórico.

ALTER TABLE public.expedientes
  ADD COLUMN IF NOT EXISTS telefono_casa text;

COMMENT ON COLUMN public.expedientes.telefono_casa IS
  'P224: teléfono de casa separado; telefono_cliente conserva el celular principal.';

-- Quitar las defensas antiguas que trataban telefono_cliente como casa antes de reparar.
DROP TRIGGER IF EXISTS trg_expedientes_telefono_casa_distinto_celular
  ON public.expedientes;
DROP TRIGGER IF EXISTS trg_expedientes_telefono_casa_unico_generales
  ON public.expedientes;

-- Reparación estrictamente causal: guardar el último valor escrito como casa y devolver
-- telefono_cliente al celular validado de Datos Generales. Solo números canónicos válidos.
WITH touched AS (
  SELECT DISTINCT al.entity_id AS expediente_id
  FROM public.action_log al
  WHERE al.action = 'expediente.telefono_casa.actualizado'
), candidates AS (
  SELECT
    e.id,
    public.cliente_datos_telefono_canonico(e.telefono_cliente::text) AS casa_actual,
    public.cliente_datos_telefono_canonico(cd.telefono_normalizado::text) AS celular_dg
  FROM touched t
  JOIN public.expedientes e ON e.id = t.expediente_id
  JOIN public.cliente_datos cd ON cd.expediente_id = e.id
  WHERE e.deleted_at IS NULL
)
UPDATE public.expedientes e
SET
  telefono_casa = CASE
    WHEN c.casa_actual IS NOT NULL
      AND c.celular_dg IS NOT NULL
      AND c.casa_actual IS DISTINCT FROM c.celular_dg
      THEN c.casa_actual
    ELSE NULL
  END,
  telefono_cliente = c.celular_dg
FROM candidates c
WHERE e.id = c.id
  AND c.celular_dg ~ '^[0-9]{10}$';

ALTER TABLE public.expedientes
  DROP CONSTRAINT IF EXISTS expedientes_telefono_casa_formato_chk;
ALTER TABLE public.expedientes
  ADD CONSTRAINT expedientes_telefono_casa_formato_chk
  CHECK (telefono_casa IS NULL OR telefono_casa ~ '^[0-9]{10}$') NOT VALID;
ALTER TABLE public.expedientes
  VALIDATE CONSTRAINT expedientes_telefono_casa_formato_chk;

-- Datos Generales: comparar el celular contra telefono_casa, nunca contra telefono_cliente.
CREATE OR REPLACE FUNCTION public.cliente_datos_guard_celular_distinto_telefono_casa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telefono_casa text;
  v_telefono_casa_objetivo text;
  v_celular_nuevo text;
  v_celular_anterior text;
BEGIN
  v_telefono_casa_objetivo := NULLIF(
    current_setting('concasa.pending_telefono_casa', true),
    ''
  );

  IF v_telefono_casa_objetivo IS NOT NULL THEN
    v_telefono_casa := public.normalize_telefono_mexico(v_telefono_casa_objetivo);
  ELSE
    SELECT public.normalize_telefono_mexico(e.telefono_casa::text)
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
    SELECT public.cliente_datos_telefono_canonico(e.telefono_casa::text)
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

-- Defensa al editar la casa: ahora se dispara sobre telefono_casa, no telefono_cliente.
CREATE OR REPLACE FUNCTION public.expedientes_guard_telefono_casa_distinto_celular()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_casa_nueva text;
  v_celular text;
BEGIN
  IF NEW.telefono_casa IS NOT DISTINCT FROM OLD.telefono_casa THEN
    RETURN NEW;
  END IF;

  v_casa_nueva := public.normalize_telefono_mexico(NEW.telefono_casa::text);
  IF v_casa_nueva IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT public.normalize_telefono_mexico(cd.telefono_normalizado)
  INTO v_celular
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = NEW.id;

  IF v_celular ~ '^[0-9]{10}$' AND v_celular = v_casa_nueva THEN
    RAISE EXCEPTION 'expedientes: CLIENTE_DATOS_CELULAR_IGUAL_TELEFONO_CASA'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

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
  v_new_casa := public.cliente_datos_telefono_canonico(NEW.telefono_casa::text);
  v_old_casa := public.cliente_datos_telefono_canonico(OLD.telefono_casa::text);

  IF v_new_casa IS NOT DISTINCT FROM v_old_casa OR v_new_casa IS NULL THEN
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

CREATE TRIGGER trg_expedientes_telefono_casa_distinto_celular
BEFORE UPDATE OF telefono_casa
ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.expedientes_guard_telefono_casa_distinto_celular();

CREATE TRIGGER trg_expedientes_telefono_casa_unico_generales
BEFORE UPDATE OF telefono_casa
ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.expedientes_guard_telefono_casa_unico_generales();

-- RPC canónica: conserva autorización y validaciones, pero escribe telefono_casa.
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

  v_telefono_anterior := public.cliente_datos_telefono_canonico(v_exp.telefono_casa::text);

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

  IF v_telefono_anterior IS NOT DISTINCT FROM v_telefono_nuevo THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'expediente_id', p_expediente_id,
      'telefono_casa', v_telefono_nuevo
    );
  END IF;

  UPDATE public.expedientes
  SET telefono_casa = v_telefono_nuevo,
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

-- Wrapper atómico DG + casa: la casa objetivo se valida contra el payload nuevo.
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
BEGIN
  IF p_telefono_casa IS NOT NULL
     AND NULLIF(btrim(p_telefono_casa), '') IS NULL THEN
    RAISE EXCEPTION 'asesor_guardar_cliente_datos_con_telefono_casa: TELEFONO_CASA_REQUERIDO'
      USING ERRCODE = '22023';
  END IF;

  IF p_telefono_casa IS NULL THEN
    SELECT public.cliente_datos_telefono_canonico(e.telefono_casa::text)
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

  PERFORM public.asesor_actualizar_telefono_casa(
    p_expediente_id,
    v_telefono_casa_objetivo
  );

  PERFORM set_config('concasa.pending_telefono_casa', '', true);

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'telefono_casa_guardado', true,
    'telefono_casa', v_telefono_casa_objetivo
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_actualizar_telefono_casa(uuid, text) IS
  'P224: asesor dueño actualiza expedientes.telefono_casa; telefono_cliente no se modifica.';
COMMENT ON FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  uuid, text, text, jsonb, jsonb, public.cliente_datos_estado,
  numeric, text, text, numeric, text, boolean
) IS
  'P224: guardado atómico de Datos Generales + telefono_casa separado; telefono_cliente conserva el celular principal.';

REVOKE ALL ON FUNCTION public.asesor_actualizar_telefono_casa(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_actualizar_telefono_casa(uuid, text)
  TO authenticated, postgres, service_role;

REVOKE ALL ON FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  uuid, text, text, jsonb, jsonb, public.cliente_datos_estado,
  numeric, text, text, numeric, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  uuid, text, text, jsonb, jsonb, public.cliente_datos_estado,
  numeric, text, text, numeric, text, boolean
) TO authenticated, postgres, service_role;
