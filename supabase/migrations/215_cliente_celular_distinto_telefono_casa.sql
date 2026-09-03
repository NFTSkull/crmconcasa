-- ConCasa CRM — P215: celular de Datos Generales != teléfono de casa de precalificación.
--
-- Fuente teléfono de casa: expedientes.telefono_cliente.
-- Fuente celular: cliente_datos.telefono_normalizado (p_telefono de save_cliente_datos).
--
-- Compatibilidad: no muta datos históricos. Si una fila legacy YA tenía ambos iguales,
-- permite guardar otros cambios mientras el celular permanezca igual; cualquier alta nueva
-- o cambio que introduzca la igualdad se rechaza.

CREATE OR REPLACE FUNCTION public.cliente_datos_guard_celular_distinto_telefono_casa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telefono_casa TEXT;
  v_celular_nuevo TEXT;
  v_celular_anterior TEXT;
BEGIN
  SELECT public.normalize_telefono_mexico(e.telefono_cliente::TEXT)
  INTO v_telefono_casa
  FROM public.expedientes e
  WHERE e.id = NEW.expediente_id;

  v_celular_nuevo := public.normalize_telefono_mexico(NEW.telefono_normalizado);

  -- Solo comparar números canónicos completos. Los validadores existentes se encargan
  -- de formatos/obligatoriedad del celular.
  IF v_telefono_casa IS NULL
     OR v_celular_nuevo IS NULL
     OR v_telefono_casa !~ '^[0-9]{10}$'
     OR v_celular_nuevo !~ '^[0-9]{10}$'
     OR v_telefono_casa IS DISTINCT FROM v_celular_nuevo THEN
    RETURN NEW;
  END IF;

  -- Legacy grandfather: no romper correcciones/guardados de expedientes que ya tenían
  -- la duplicidad antes de P215, siempre que no estén introduciendo/cambiando el celular.
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

COMMENT ON FUNCTION public.cliente_datos_guard_celular_distinto_telefono_casa() IS
  'P215: impide altas/cambios donde celular DG = telefono_cliente del expediente; grandfather solo para duplicados legacy sin cambio.';

DROP TRIGGER IF EXISTS trg_cliente_datos_celular_distinto_telefono_casa
  ON public.cliente_datos;
CREATE TRIGGER trg_cliente_datos_celular_distinto_telefono_casa
BEFORE INSERT OR UPDATE OF telefono_normalizado
ON public.cliente_datos
FOR EACH ROW
EXECUTE FUNCTION public.cliente_datos_guard_celular_distinto_telefono_casa();

-- Defensa complementaria: si en el futuro alguna ruta permite editar telefono_cliente,
-- tampoco puede cambiarlo para hacerlo igual al celular ya guardado.
CREATE OR REPLACE FUNCTION public.expedientes_guard_telefono_casa_distinto_celular()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telefono_casa_nuevo TEXT;
  v_telefono_casa_anterior TEXT;
  v_celular TEXT;
BEGIN
  IF NEW.telefono_cliente IS NOT DISTINCT FROM OLD.telefono_cliente THEN
    RETURN NEW;
  END IF;

  v_telefono_casa_nuevo := public.normalize_telefono_mexico(NEW.telefono_cliente::TEXT);
  IF v_telefono_casa_nuevo IS NULL OR v_telefono_casa_nuevo !~ '^[0-9]{10}$' THEN
    RETURN NEW;
  END IF;

  SELECT public.normalize_telefono_mexico(cd.telefono_normalizado)
  INTO v_celular
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = NEW.id;

  IF v_celular IS NULL
     OR v_celular !~ '^[0-9]{10}$'
     OR v_celular IS DISTINCT FROM v_telefono_casa_nuevo THEN
    RETURN NEW;
  END IF;

  -- Grandfather de una igualdad preexistente; no bloquear un cambio de representación
  -- que siga siendo el mismo número canónico.
  v_telefono_casa_anterior := public.normalize_telefono_mexico(OLD.telefono_cliente::TEXT);
  IF v_telefono_casa_anterior = v_celular
     AND v_telefono_casa_anterior = v_telefono_casa_nuevo THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'expedientes: CLIENTE_DATOS_CELULAR_IGUAL_TELEFONO_CASA'
    USING ERRCODE = '22023';
END;
$$;

COMMENT ON FUNCTION public.expedientes_guard_telefono_casa_distinto_celular() IS
  'P215: impide cambiar telefono_cliente para igualarlo al celular DG existente; no muta legacy.';

DROP TRIGGER IF EXISTS trg_expedientes_telefono_casa_distinto_celular
  ON public.expedientes;
CREATE TRIGGER trg_expedientes_telefono_casa_distinto_celular
BEFORE UPDATE OF telefono_cliente
ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.expedientes_guard_telefono_casa_distinto_celular();

REVOKE ALL ON FUNCTION public.cliente_datos_guard_celular_distinto_telefono_casa()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expedientes_guard_telefono_casa_distinto_celular()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_datos_guard_celular_distinto_telefono_casa()
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.expedientes_guard_telefono_casa_distinto_celular()
  TO postgres, service_role;
