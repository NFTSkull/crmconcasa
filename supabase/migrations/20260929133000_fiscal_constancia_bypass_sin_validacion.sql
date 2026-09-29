-- ConCasa CRM — Constancia SAT activa omite validación RFC/SAT pre-Mesa.
--
-- Regla de negocio:
-- - Si existe cliente_constancia_situacion_fiscal activa, NO se ejecuta gate SAT.
-- - La route puede intentar autocompletar el RFC desde la propia Constancia,
--   pero ese autofill es best-effort y jamás bloquea el envío a Mesa.
-- - Sin Constancia, se conserva intacto el flujo Estado de Cuenta -> SAT.

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

  -- Regla prioritaria: la Constancia de Situación Fiscal oficial sustituye
  -- completamente la validación RFC/SAT externa para el envío a Mesa.
  IF public.fiscal_sat_constancia_uploaded(p_expediente_id) THEN
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

COMMENT ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) IS
  'Gate SAT pre-Mesa. No aplica si existe Constancia de Situación Fiscal activa; sin Constancia conserva exclusiones, flag global y pilotos.';

COMMIT;
