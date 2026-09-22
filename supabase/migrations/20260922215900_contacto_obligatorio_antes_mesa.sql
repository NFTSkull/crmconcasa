-- ConCasa CRM — contacto mínimo obligatorio antes de enviar a Mesa.
--
-- Objetivo:
-- - impedir que un expediente NUEVO avance a Mesa sin correo o teléfono de casa;
-- - no tocar expedientes ya enviados;
-- - no cambiar documentos, montos, etapas, roles ni el perfil simplificado;
-- - la validación final vive en DB para que no dependa solo de la UI.
--
-- Sin backfill y sin UPDATE de datos existentes.

CREATE OR REPLACE FUNCTION public.guard_expediente_contacto_mesa_bu()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_correo text;
  v_telefono_casa text;
BEGIN
  -- Solo transición inicial hacia Mesa. Filas ya enviadas quedan intactas.
  IF NEW.submitted_to_mesa IS TRUE
     AND COALESCE(OLD.submitted_to_mesa, FALSE) IS FALSE THEN
    SELECT btrim(COALESCE(cd.datos->>'correo', ''))
    INTO v_correo
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = NEW.id;

    IF COALESCE(v_correo, '') = '' THEN
      RAISE EXCEPTION 'enviar_a_mesa: CONTACTO_CORREO_REQUERIDO'
        USING ERRCODE = '22023';
    END IF;

    IF v_correo !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'enviar_a_mesa: CONTACTO_CORREO_INVALIDO'
        USING ERRCODE = '22023';
    END IF;

    v_telefono_casa := public.normalize_telefono_mexico(
      COALESCE(NEW.telefono_casa, '')
    );

    IF v_telefono_casa IS NULL OR v_telefono_casa !~ '^[0-9]{10}$' THEN
      RAISE EXCEPTION 'enviar_a_mesa: CONTACTO_TELEFONO_CASA_REQUERIDO'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS z_expediente_contacto_mesa_guard_bu
  ON public.expedientes;

CREATE TRIGGER z_expediente_contacto_mesa_guard_bu
BEFORE UPDATE OF submitted_to_mesa
ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.guard_expediente_contacto_mesa_bu();

COMMENT ON FUNCTION public.guard_expediente_contacto_mesa_bu() IS
  'Bloquea la transición inicial a Mesa si falta correo válido o teléfono de casa válido. No modifica datos.';

-- Función interna de trigger: no exponer ejecución directa.
REVOKE ALL ON FUNCTION public.guard_expediente_contacto_mesa_bu()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_expediente_contacto_mesa_bu()
  TO postgres, service_role;
