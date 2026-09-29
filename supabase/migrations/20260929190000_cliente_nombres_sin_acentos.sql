-- ConCasa CRM — Datos Generales: nombres sin acentos, preservando Ñ.
-- Alcance:
-- 1) normalizador server-side para nuevas escrituras;
-- 2) validación de payload sin diacríticos;
-- 3) cliente_nombre y datos.nombreCliente quedan canónicos aun desde clientes viejos.
-- Sin backfill: NO modifica expedientes/cliente_datos históricos por sí sola.

CREATE OR REPLACE FUNCTION public.cliente_datos_normalize_person_name(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT translate(
    upper(
      regexp_replace(
        btrim(COALESCE(p_input, '')),
        '\s+',
        ' ',
        'g'
      )
    ),
    'ÁÉÍÓÚÜ',
    'AEIOUU'
  );
$$;

COMMENT ON FUNCTION public.cliente_datos_normalize_person_name(text) IS
  'Datos Generales: trim + espacios + MAYÚSCULAS + elimina acentos comunes; preserva Ñ.';

CREATE OR REPLACE FUNCTION public.cliente_datos_is_valid_person_name(p_input text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t TEXT;
BEGIN
  v_t := btrim(COALESCE(p_input, ''));
  IF v_t = '' THEN
    RETURN true;
  END IF;

  -- Solo letras ASCII + Ñ/ñ, espacios, guion y apóstrofes.
  -- Esto evita que un cliente desactualizado vuelva a persistir ÁÉÍÓÚÜ.
  RETURN v_t ~ '^[A-Za-zÑñ[:space:]''’\-]+$';
END;
$$;

COMMENT ON FUNCTION public.cliente_datos_is_valid_person_name(text) IS
  'Datos Generales: vacío=true; letras sin acentos + Ñ + espacio/guion/apóstrofe.';

CREATE OR REPLACE FUNCTION public.normalize_expediente_cliente_nombre_upper()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cliente_nombre IS NOT NULL THEN
    NEW.cliente_nombre := public.cliente_datos_normalize_person_name(
      NEW.cliente_nombre
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_cliente_datos_nombre_upper()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_nombre text;
BEGIN
  IF NEW.datos IS NULL OR jsonb_typeof(NEW.datos) <> 'object' THEN
    RETURN NEW;
  END IF;

  IF NEW.datos ? 'nombreCliente' THEN
    v_nombre := NEW.datos->>'nombreCliente';
    IF v_nombre IS NOT NULL THEN
      NEW.datos := jsonb_set(
        NEW.datos,
        '{nombreCliente}',
        to_jsonb(public.cliente_datos_normalize_person_name(v_nombre)),
        true
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Los triggers ya existen; se recrean de forma idempotente para dejar explícito
-- que nuevas escrituras pasan por las funciones anteriores.
DROP TRIGGER IF EXISTS expedientes_cliente_nombre_upper_biu
  ON public.expedientes;
CREATE TRIGGER expedientes_cliente_nombre_upper_biu
BEFORE INSERT OR UPDATE OF cliente_nombre
ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.normalize_expediente_cliente_nombre_upper();

DROP TRIGGER IF EXISTS cliente_datos_nombre_upper_biu
  ON public.cliente_datos;
CREATE TRIGGER cliente_datos_nombre_upper_biu
BEFORE INSERT OR UPDATE OF datos
ON public.cliente_datos
FOR EACH ROW
EXECUTE FUNCTION public.normalize_cliente_datos_nombre_upper();

REVOKE ALL ON FUNCTION public.cliente_datos_normalize_person_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_datos_is_valid_person_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_datos_normalize_person_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cliente_datos_is_valid_person_name(text) TO service_role;
