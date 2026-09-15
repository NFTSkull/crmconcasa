-- ConCasa CRM — P189 v5: una sola mejora corta para Carta + Presupuesto.
-- Alcance quirúrgico: solo el helper de texto usado al crear nuevos snapshots INFONAVIT.
-- NO UPDATE/DELETE/backfill. NO toca expedientes, etapas, agenda, citas, cupos ni Sheets.

CREATE OR REPLACE FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(
  p_monto NUMERIC,
  p_seed TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_catalog TEXT[];
  v_seed TEXT := COALESCE(NULLIF(p_seed, ''), COALESCE(p_monto::TEXT, 'infonavit'));
  v_idx INTEGER;
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RETURN '';
  END IF;

  -- Regla explícita de negocio: arriba de $100,000, una sola mejora de paneles solares.
  IF p_monto > 100000 THEN
    RETURN 'Instalación de paneles solares.';
  END IF;

  IF p_monto <= 40000 THEN
    v_catalog := ARRAY[
      'Pintura interior de la vivienda.',
      'Impermeabilización de azotea.',
      'Reparación de instalación hidráulica.',
      'Renovación de instalación eléctrica.',
      'Cambio de puertas y cerraduras.'
    ];
  ELSE
    v_catalog := ARRAY[
      'Renovación de piso cerámico.',
      'Mejora de baño y grifería.',
      'Mejora de cocina y tarja.',
      'Instalación de tinaco y bomba.',
      'Cambio de calentador de agua.',
      'Rehabilitación de fachada.',
      'Mejora de ventanas y cancelería.',
      'Impermeabilización de azotea.'
    ];
  END IF;

  -- Una sola frase. La seed contiene expediente/versión para variar entre casos,
  -- mientras Carta y Presupuesto del mismo snapshot reciben exactamente el mismo texto.
  v_idx := 1 + (get_byte(decode(md5(v_seed), 'hex'), 0) % array_length(v_catalog, 1));
  RETURN v_catalog[v_idx];
END;
$$;

COMMENT ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT) IS
  'P189 v5: una sola mejora corta por snapshot; >100k paneles solares; <=100k catálogo determinístico por seed.';

REVOKE ALL ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT)
  TO postgres, service_role;
