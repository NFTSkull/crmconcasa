-- ConCasa CRM — nombres canónicos en MAYÚSCULAS.
-- Alcance quirúrgico:
-- 1) nuevas escrituras de expedientes.cliente_nombre;
-- 2) nombreCliente dentro de cliente_datos.datos;
-- 3) profiles.full_name solo para app_role='asesor';
-- 4) backfill únicamente de perfiles asesor (NO expedientes/cliente_datos históricos).

CREATE OR REPLACE FUNCTION public.normalize_expediente_cliente_nombre_upper()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cliente_nombre IS NOT NULL THEN
    NEW.cliente_nombre := upper(
      btrim(regexp_replace(NEW.cliente_nombre, '\s+', ' ', 'g'))
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expedientes_cliente_nombre_upper_biu
  ON public.expedientes;

CREATE TRIGGER expedientes_cliente_nombre_upper_biu
BEFORE INSERT OR UPDATE OF cliente_nombre
ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.normalize_expediente_cliente_nombre_upper();

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
        to_jsonb(
          upper(btrim(regexp_replace(v_nombre, '\s+', ' ', 'g')))
        ),
        true
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cliente_datos_nombre_upper_biu
  ON public.cliente_datos;

CREATE TRIGGER cliente_datos_nombre_upper_biu
BEFORE INSERT OR UPDATE OF datos
ON public.cliente_datos
FOR EACH ROW
EXECUTE FUNCTION public.normalize_cliente_datos_nombre_upper();

CREATE OR REPLACE FUNCTION public.normalize_asesor_full_name_upper()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.app_role = 'asesor'
     AND NULLIF(btrim(COALESCE(NEW.full_name, '')), '') IS NOT NULL THEN
    NEW.full_name := upper(
      btrim(regexp_replace(NEW.full_name, '\s+', ' ', 'g'))
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_asesor_full_name_upper_biu
  ON public.profiles;

CREATE TRIGGER profiles_asesor_full_name_upper_biu
BEFORE INSERT OR UPDATE OF full_name, app_role
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.normalize_asesor_full_name_upper();

-- Backfill seguro y acotado: solo nombres de perfiles asesor.
-- No se tocan expedientes ni cliente_datos históricos para no alterar updated_at,
-- orden de bandejas o historial operativo.
UPDATE public.profiles
SET full_name = upper(
  btrim(regexp_replace(full_name, '\s+', ' ', 'g'))
)
WHERE app_role = 'asesor'
  AND NULLIF(btrim(COALESCE(full_name, '')), '') IS NOT NULL
  AND full_name IS DISTINCT FROM upper(
    btrim(regexp_replace(full_name, '\s+', ' ', 'g'))
  );
