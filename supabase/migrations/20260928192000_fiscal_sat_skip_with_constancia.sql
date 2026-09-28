-- ConCasa CRM — Si existe Constancia de Situación Fiscal del asesor,
-- no ejecutar gate/worker SAT antes de enviar a Mesa.
--
-- Documento canónico del asesor:
--   cliente_constancia_situacion_fiscal
-- Distinto del complementario Mesa:
--   cliente_constancia_sat
--
-- La regla es fail-safe: solo cuenta una fila activa con storage_path real.

BEGIN;

CREATE OR REPLACE FUNCTION public.fiscal_sat_constancia_uploaded(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND d.tipo_documento = 'cliente_constancia_situacion_fiscal'
      AND d.deleted_at IS NULL
      AND NULLIF(btrim(COALESCE(d.storage_path, '')), '') IS NOT NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.fiscal_sat_constancia_uploaded(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_sat_constancia_uploaded(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_constancia_uploaded(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_constancia_uploaded(UUID) TO service_role;

COMMENT ON FUNCTION public.fiscal_sat_constancia_uploaded(UUID) IS
  'True si el expediente tiene Constancia de Situación Fiscal (asesor) activa y almacenada. Se usa para omitir validación SAT externa pre-Mesa.';

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

  -- Regla prioritaria: si ya adjuntaron la Constancia de Situación Fiscal
  -- del asesor, no llamar al SAT externo. El documento sustituye ese gate.
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

REVOKE ALL ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) TO service_role;

COMMENT ON FUNCTION public.fiscal_sat_gate_applies_to_expediente(UUID) IS
  'Gate SAT pre-Mesa. No aplica si existe Constancia de Situación Fiscal activa del asesor; conserva exclusiones, flag global y pilotos.';

COMMIT;
