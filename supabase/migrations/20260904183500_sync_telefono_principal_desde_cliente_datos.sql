-- ConCasa CRM — P224 complemento: telefono_cliente siempre refleja el celular vigente.
--
-- `cliente_datos.telefono_normalizado` es la fuente canónica del celular una vez que
-- existen Datos Generales. Cualquier INSERT/UPDATE válido sincroniza únicamente
-- `expedientes.telefono_cliente`; `expedientes.telefono_casa` permanece independiente.

CREATE OR REPLACE FUNCTION public.cliente_datos_sync_telefono_principal_expediente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_celular text;
  v_actual text;
BEGIN
  v_celular := public.cliente_datos_telefono_canonico(NEW.telefono_normalizado::text);
  IF v_celular IS NULL OR v_celular !~ '^[0-9]{10}$' THEN
    RETURN NEW;
  END IF;

  SELECT public.cliente_datos_telefono_canonico(e.telefono_cliente::text)
  INTO v_actual
  FROM public.expedientes e
  WHERE e.id = NEW.expediente_id;

  IF v_actual IS NOT DISTINCT FROM v_celular THEN
    RETURN NEW;
  END IF;

  UPDATE public.expedientes
  SET telefono_cliente = v_celular,
      updated_at = now()
  WHERE id = NEW.expediente_id
    AND deleted_at IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_datos_sync_telefono_principal_expediente
  ON public.cliente_datos;
CREATE TRIGGER trg_cliente_datos_sync_telefono_principal_expediente
AFTER INSERT OR UPDATE OF telefono_normalizado
ON public.cliente_datos
FOR EACH ROW
EXECUTE FUNCTION public.cliente_datos_sync_telefono_principal_expediente();

COMMENT ON FUNCTION public.cliente_datos_sync_telefono_principal_expediente() IS
  'P224: sincroniza expedientes.telefono_cliente con cliente_datos.telefono_normalizado; no toca telefono_casa.';

REVOKE ALL ON FUNCTION public.cliente_datos_sync_telefono_principal_expediente()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_datos_sync_telefono_principal_expediente()
  TO postgres, service_role;
