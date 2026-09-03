-- ConCasa CRM — P218: Teléfono de casa se guarda con el botón principal de Datos Generales.
--
-- Objetivo:
-- - un solo RPC / una sola transacción para Datos Generales + telefono_cliente;
-- - reutilizar toda la validación/seguridad existente de save_cliente_datos,
--   save_cliente_datos_correccion y asesor_actualizar_telefono_casa;
-- - si cualquiera de los dos guardados falla, PostgreSQL revierte ambos.
--
-- No backfill. No UPDATE masivo. No modifica filas al aplicar la migración.

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
BEGIN
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

  -- NULL significa que el cliente no tenía el nuevo control montado; preservar valor actual.
  -- Cadena vacía sí se valida y falla como teléfono inválido, evitando borrados silenciosos.
  IF p_telefono_casa IS NOT NULL THEN
    PERFORM public.asesor_actualizar_telefono_casa(
      p_expediente_id,
      p_telefono_casa
    );
  END IF;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'telefono_casa_guardado', p_telefono_casa IS NOT NULL
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  uuid, text, text, jsonb, jsonb, public.cliente_datos_estado,
  numeric, text, text, numeric, text, boolean
) IS
  'P218: guardado atómico de Datos Generales + telefono_cliente usando las reglas existentes; un solo botón en UI.';

REVOKE ALL ON FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  uuid, text, text, jsonb, jsonb, public.cliente_datos_estado,
  numeric, text, text, numeric, text, boolean
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.asesor_guardar_cliente_datos_con_telefono_casa(
  uuid, text, text, jsonb, jsonb, public.cliente_datos_estado,
  numeric, text, text, numeric, text, boolean
) TO authenticated, postgres, service_role;
