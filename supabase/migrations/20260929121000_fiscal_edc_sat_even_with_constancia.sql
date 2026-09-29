-- ConCasa CRM — La Constancia de Situación Fiscal NO sustituye la validación
-- RFC del Estado de Cuenta -> SAT antes de enviar a Mesa.
--
-- Corrige el bypass agregado en 20260928192000: una constancia activa podía
-- hacer que fiscal_sat_gate_applies_to_expediente() devolviera false aun con
-- el gate global encendido. Eso saltaba también el fallback OCR live del EDC.
--
-- La constancia se conserva como evidencia/documento, pero no desactiva el
-- flujo fiscal pre-Mesa. Exclusiones explícitas siguen teniendo prioridad.

BEGIN;

CREATE OR REPLACE FUNCTION public.fiscal_sat_gate_applies_to_expediente(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_asesor UUID;
  v_excluded_asesores JSONB;
  v_pilot_asesores JSONB;
  v_pilot_expedientes JSONB;
BEGIN
  SELECT e.asesor_id
  INTO v_asesor
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL;

  IF v_asesor IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.value
  INTO v_excluded_asesores
  FROM public.app_settings s
  WHERE s.key = 'fiscal_sat_gate_excluded_asesores';

  IF v_excluded_asesores IS NOT NULL
     AND jsonb_typeof(v_excluded_asesores) = 'array'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(v_excluded_asesores) AS x(val)
       WHERE x.val = v_asesor::text
     ) THEN
    RETURN false;
  END IF;

  IF public.app_setting_bool('fiscal_sat_gate_enabled', false) THEN
    RETURN true;
  END IF;

  SELECT s.value
  INTO v_pilot_expedientes
  FROM public.app_settings s
  WHERE s.key = 'fiscal_sat_gate_pilot_expedientes';

  IF v_pilot_expedientes IS NOT NULL
     AND jsonb_typeof(v_pilot_expedientes) = 'array'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(v_pilot_expedientes) AS x(val)
       WHERE x.val = p_expediente_id::text
     ) THEN
    RETURN true;
  END IF;

  SELECT s.value
  INTO v_pilot_asesores
  FROM public.app_settings s
  WHERE s.key = 'fiscal_sat_gate_pilot_asesores';

  IF v_pilot_asesores IS NULL OR jsonb_typeof(v_pilot_asesores) <> 'array' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_pilot_asesores) AS x(val)
    WHERE x.val = v_asesor::text
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) TO service_role;

COMMENT ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) IS
  'Gate SAT pre-Mesa. La Constancia de Situación Fiscal no lo desactiva; conserva exclusiones explícitas, flag global y pilotos.';

COMMENT ON FUNCTION public.fiscal_sat_constancia_uploaded(UUID) IS
  'True si el expediente tiene Constancia de Situación Fiscal activa y almacenada. Es evidencia documental; no sustituye la validación RFC EDC->SAT pre-Mesa.';

COMMIT;
