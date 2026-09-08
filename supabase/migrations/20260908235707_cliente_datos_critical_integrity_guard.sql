-- ConCasa CRM — blindaje de integridad para Datos Generales.
--
-- Objetivos:
-- 1) Una regresión de formato no puede borrar información crítica ya persistida:
--    - referencias (incluida metadata referenciasEstructuradas),
--    - dirección de empresa (calle/colonia/municipio/cp),
--    - teléfono de casa.
-- 2) El primer envío a Mesa de expedientes INTERNOS queda fail-closed si falta
--    cualquiera de esos campos.
-- 3) No se hace backfill ni se inventan datos. Reingresos ya enviados no se bloquean.
-- 4) Externos (origen/perfil/equipos Silvia u Orlando) conservan su flujo simplificado.

-- -----------------------------------------------------------------------------
-- A. Preservar referencias + dirección empresa en UPDATE de cliente_datos.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cliente_datos_preserve_existing_referencias()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_old_refs jsonb := COALESCE(OLD.referencias, '[]'::jsonb);
  v_new_refs jsonb := COALESCE(NEW.referencias, '[]'::jsonb);
  v_old_refs_len integer := 0;
  v_new_refs_len integer := 0;
  v_old_struct jsonb;
  v_new_struct jsonb;
  v_old_struct_len integer := 0;
  v_new_struct_len integer := 0;
  v_old_dir jsonb;
  v_new_dir jsonb;
  v_key text;
  v_old_value text;
  v_new_value text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v_old_refs) = 'array' THEN
    v_old_refs_len := jsonb_array_length(v_old_refs);
  END IF;
  IF jsonb_typeof(v_new_refs) = 'array' THEN
    v_new_refs_len := jsonb_array_length(v_new_refs);
  END IF;

  -- Nunca degradar referencias existentes por un payload incompleto/vacío.
  -- Un reemplazo válido con igual o mayor cardinalidad sí se permite.
  IF v_old_refs_len > 0
     AND (jsonb_typeof(v_new_refs) IS DISTINCT FROM 'array' OR v_new_refs_len < v_old_refs_len) THEN
    NEW.referencias := v_old_refs;
    NEW.datos := jsonb_set(
      COALESCE(NEW.datos, '{}'::jsonb),
      '{referencias}',
      v_old_refs,
      true
    );
  END IF;

  -- La representación estructurada contiene los nombres/apellidos que la columna
  -- referencias legacy no puede conservar. Protegerla independientemente del array legacy.
  v_old_struct := OLD.datos->'referenciasEstructuradas';
  v_new_struct := NEW.datos->'referenciasEstructuradas';

  IF jsonb_typeof(v_old_struct) = 'array' THEN
    v_old_struct_len := jsonb_array_length(v_old_struct);
  END IF;
  IF jsonb_typeof(v_new_struct) = 'array' THEN
    v_new_struct_len := jsonb_array_length(v_new_struct);
  END IF;

  IF v_old_struct_len > 0
     AND (jsonb_typeof(v_new_struct) IS DISTINCT FROM 'array' OR v_new_struct_len < v_old_struct_len) THEN
    NEW.datos := jsonb_set(
      COALESCE(NEW.datos, '{}'::jsonb),
      '{referenciasEstructuradas}',
      v_old_struct,
      true
    );
  END IF;

  -- Dirección de empresa: cada subcampo histórico no vacío se conserva si un
  -- UPDATE posterior lo omite o lo manda vacío. Valores nuevos no vacíos sí reemplazan.
  v_old_dir := CASE
    WHEN jsonb_typeof(OLD.datos->'direccionEmpresa') = 'object'
      THEN OLD.datos->'direccionEmpresa'
    ELSE '{}'::jsonb
  END;
  v_new_dir := CASE
    WHEN jsonb_typeof(NEW.datos->'direccionEmpresa') = 'object'
      THEN NEW.datos->'direccionEmpresa'
    ELSE '{}'::jsonb
  END;

  FOREACH v_key IN ARRAY ARRAY['calle', 'colonia', 'municipio', 'cp']::text[]
  LOOP
    v_old_value := NULLIF(btrim(COALESCE(v_old_dir->>v_key, '')), '');
    v_new_value := NULLIF(btrim(COALESCE(v_new_dir->>v_key, '')), '');

    IF v_old_value IS NOT NULL AND v_new_value IS NULL THEN
      v_new_dir := jsonb_set(v_new_dir, ARRAY[v_key], to_jsonb(v_old_value), true);
    END IF;
  END LOOP;

  NEW.datos := jsonb_set(
    COALESCE(NEW.datos, '{}'::jsonb),
    '{direccionEmpresa}',
    v_new_dir,
    true
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.cliente_datos_preserve_existing_referencias() IS
  'Preserva referencias, referenciasEstructuradas y direcciónEmpresa no vacías ante payloads posteriores incompletos.';

-- El trigger ya existe desde la migración de recuperación histórica; se recrea
-- para dejar explícito el contrato vigente.
DROP TRIGGER IF EXISTS cliente_datos_preserve_existing_referencias_bu
  ON public.cliente_datos;

CREATE TRIGGER cliente_datos_preserve_existing_referencias_bu
BEFORE UPDATE OF referencias, datos ON public.cliente_datos
FOR EACH ROW
EXECUTE FUNCTION public.cliente_datos_preserve_existing_referencias();

-- -----------------------------------------------------------------------------
-- B. Teléfono de casa: un UPDATE accidental a NULL/vacío no borra un valor previo.
--    El cambio a otro teléfono válido sigue permitido y pasa por los guards existentes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expedientes_preserve_existing_telefono_casa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NULLIF(btrim(COALESCE(OLD.telefono_casa, '')), '') IS NOT NULL
     AND NULLIF(btrim(COALESCE(NEW.telefono_casa, '')), '') IS NULL THEN
    NEW.telefono_casa := OLD.telefono_casa;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expedientes_preserve_existing_telefono_casa_bu
  ON public.expedientes;

CREATE TRIGGER expedientes_preserve_existing_telefono_casa_bu
BEFORE UPDATE OF telefono_casa ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.expedientes_preserve_existing_telefono_casa();

COMMENT ON FUNCTION public.expedientes_preserve_existing_telefono_casa() IS
  'Evita borrar por accidente un telefono_casa ya persistido; permite reemplazo por otro valor no vacío.';

-- -----------------------------------------------------------------------------
-- C. Primer envío a Mesa: internos deben tener la captura crítica completa.
--    Solo aplica FALSE -> TRUE; no toca correcciones/reingresos ya enviados.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expedientes_assert_datos_generales_integrity_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_tipo_asesor_origen text;
  v_es_externo boolean := false;
  v_cd public.cliente_datos%ROWTYPE;
  v_refs jsonb;
  v_dir jsonb;
  v_ref jsonb;
  v_ref_phone text;
  i integer;
BEGIN
  IF TG_OP <> 'UPDATE'
     OR OLD.submitted_to_mesa IS TRUE
     OR NEW.submitted_to_mesa IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  SELECT p.tipo_asesor_origen::text
  INTO v_tipo_asesor_origen
  FROM public.profiles p
  WHERE p.id = NEW.asesor_id;

  -- Clasificación externa: origen explícito, perfil explícito o paquete documental
  -- externo vigente (equipos Silvia/Orlando). Consulta directa, sin depender del JWT.
  v_es_externo :=
    lower(btrim(COALESCE(NEW.origen_mesa::text, ''))) = 'externo'
    OR lower(btrim(COALESCE(v_tipo_asesor_origen, ''))) = 'externo'
    OR EXISTS (
      SELECT 1
      FROM public.asesor_equipo_miembros m
      JOIN public.asesor_equipos t
        ON t.id = m.team_id
       AND t.active = true
      JOIN public.profiles lider
        ON lider.id = t.leader_id
       AND lider.active = true
      WHERE m.asesor_id = NEW.asesor_id
        AND m.active = true
        AND lower(btrim(lider.email)) IN (
          'silvia.reyes@concasa.mx',
          'orlando.solis@concasa.mx'
        )
    );

  IF v_es_externo THEN
    RETURN NEW;
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.telefono_casa, '')), '') IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_TELEFONO_CASA_FALTANTE'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = NEW.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_FALTANTES'
      USING ERRCODE = '22023';
  END IF;

  v_refs := COALESCE(v_cd.referencias, '[]'::jsonb);
  IF jsonb_typeof(v_refs) <> 'array' OR jsonb_array_length(v_refs) < 2 THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_REFERENCIAS_FALTANTES'
      USING ERRCODE = '22023';
  END IF;

  FOR i IN 0..1 LOOP
    v_ref := COALESCE(v_refs->i, '{}'::jsonb);
    v_ref_phone := NULLIF(
      btrim(COALESCE(v_ref->>'celular', v_ref->>'telefono', '')),
      ''
    );

    IF NULLIF(btrim(COALESCE(v_ref->>'nombre', '')), '') IS NULL
       OR v_ref_phone IS NULL THEN
      RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_REFERENCIAS_INCOMPLETAS'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_dir := CASE
    WHEN jsonb_typeof(v_cd.datos->'direccionEmpresa') = 'object'
      THEN v_cd.datos->'direccionEmpresa'
    ELSE '{}'::jsonb
  END;

  IF NULLIF(btrim(COALESCE(v_dir->>'calle', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_dir->>'colonia', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_dir->>'municipio', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_dir->>'cp', '')), '') IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_DIRECCION_EMPRESA_FALTANTE'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expedientes_assert_datos_generales_integrity_on_submit_bu
  ON public.expedientes;

CREATE TRIGGER expedientes_assert_datos_generales_integrity_on_submit_bu
BEFORE UPDATE OF submitted_to_mesa ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.expedientes_assert_datos_generales_integrity_on_submit();

COMMENT ON FUNCTION public.expedientes_assert_datos_generales_integrity_on_submit() IS
  'Fail-closed en primer envío a Mesa para internos: exige telefono_casa, 2 referencias completas y direccionEmpresa completa. Externos exentos; reingresos ya enviados intactos.';
