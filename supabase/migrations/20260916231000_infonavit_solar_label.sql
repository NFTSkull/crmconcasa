-- ConCasa CRM — INFONAVIT: copy corto para la mejora solar.
--
-- Único cambio funcional: para montos > $100,000 MXN la descripción automática
-- queda exactamente como "Instalación de paneles solares".
-- Conserva las bandas existentes, una sola línea y el contrato mappingVersion>=3.
-- 0 UPDATE/DELETE/backfill; no toca expedientes, etapas, agenda, citas, cupos ni Sheets.

CREATE OR REPLACE FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(
  p_monto NUMERIC,
  p_seed TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RETURN '';
  END IF;

  RETURN CASE
    WHEN p_monto <= 30000 THEN
      'Resanes y aplicación de pintura interior y exterior.'
    WHEN p_monto <= 60000 THEN
      'Impermeabilización y reparación de áreas con humedad.'
    WHEN p_monto <= 80000 THEN
      'Renovación de pisos cerámicos, adhesivos y recubrimientos.'
    WHEN p_monto <= 100000 THEN
      'Mejoras de baño con grifería, sanitario y accesorios.'
    ELSE
      'Instalación de paneles solares'
  END;
END;
$$;

COMMENT ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT) IS
  'INFONAVIT: una sola mejora automática por monto; >100k usa exactamente Instalación de paneles solares. p_seed se conserva por compatibilidad de firma.';

-- Mantener el helper interno con el mismo contrato de permisos.
REVOKE ALL ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT)
  TO postgres, service_role;
