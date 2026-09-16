-- ConCasa CRM — INFONAVIT: una sola mejora automática por monto.
--
-- Alcance:
-- - Carta Bajo Protesta y Presupuesto de Mejoramiento comparten una sola descripción.
-- - > $100,000 MXN => sistema fotovoltaico con paneles solares.
-- - Presupuesto estimado continúa NULL; la fecha inferior se omite en renderer mappingVersion>=3.
-- - La generación Mesa ignora descripciones viejas/manuales del borrador y recalcula por monto.
--
-- 0 UPDATE/DELETE/backfill. No toca expedientes, etapas, agenda, citas, cupos ni Sheets.

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
      'Instalación de sistema fotovoltaico con paneles solares.'
  END;
END;
$$;

COMMENT ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT) IS
  'INFONAVIT: una sola mejora automática por monto; >100k usa sistema fotovoltaico con paneles solares. p_seed se conserva por compatibilidad de firma.';

-- Conserva íntegramente la implementación previa (guards, lock, snapshot y outbox)
-- como helper interno. La nueva RPC pública solo normaliza la mejora antes de delegar.
ALTER FUNCTION public.mesa_generar_infonavit_documentos(UUID, JSONB)
  RENAME TO mesa_generar_infonavit_documentos_single_base;

REVOKE ALL ON FUNCTION public.mesa_generar_infonavit_documentos_single_base(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_generar_infonavit_documentos_single_base(UUID, JSONB)
  TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.mesa_generar_infonavit_documentos(
  p_expediente_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_payload JSONB := COALESCE(p_payload, '{}'::JSONB);
  v_base JSONB;
  v_mejora JSONB;
  v_monto_raw TEXT;
  v_monto NUMERIC;
  v_desc TEXT;
BEGIN
  -- Mismo gate explícito de la RPC base; evita leer el expediente antes de autorizar.
  IF NOT public.mesa_infonavit_generation_allowed(p_expediente_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  -- Delega payloads inválidos para conservar exactamente el error/validación canónica.
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RETURN public.mesa_generar_infonavit_documentos_single_base(
      p_expediente_id,
      p_payload
    );
  END IF;

  v_monto_raw := btrim(COALESCE(v_payload #>> '{credito,montoSolicitado}', ''));

  IF v_monto_raw <> '' THEN
    BEGIN
      v_monto := v_monto_raw::NUMERIC;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public.mesa_generar_infonavit_documentos_single_base(
        p_expediente_id,
        p_payload
      );
    END;

    IF v_monto <= 0 THEN
      RETURN public.mesa_generar_infonavit_documentos_single_base(
        p_expediente_id,
        p_payload
      );
    END IF;
  ELSE
    -- Si Mesa no envía monto explícito, usa la misma fuente vigente que usa el flujo base.
    v_base := public.infonavit_build_submission_payload(p_expediente_id, now());
    BEGIN
      v_monto := NULLIF(
        btrim(COALESCE(v_base #>> '{credito,montoSolicitado}', '')),
        ''
      )::NUMERIC;
    EXCEPTION WHEN invalid_text_representation THEN
      v_monto := NULL;
    END;
  END IF;

  IF v_monto IS NOT NULL AND v_monto > 0 THEN
    v_desc := public.infonavit_build_propuesta_mejoramiento_v3(
      round(v_monto, 2),
      p_expediente_id::TEXT || '|single|' || round(v_monto, 2)::TEXT
    );

    v_mejora := COALESCE(v_payload->'mejora', '{}'::JSONB);
    IF jsonb_typeof(v_mejora) <> 'object' THEN
      v_mejora := '{}'::JSONB;
    END IF;

    -- Autoridad servidor: una línea automática y sin presupuesto estimado.
    v_mejora := v_mejora || jsonb_build_object(
      'descripcion', v_desc,
      'presupuestoEstimado', NULL
    );
    v_payload := jsonb_set(v_payload, '{mejora}', v_mejora, true);
  END IF;

  RETURN public.mesa_generar_infonavit_documentos_single_base(
    p_expediente_id,
    v_payload
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_generar_infonavit_documentos(UUID, JSONB) IS
  'Mesa INFONAVIT: normaliza una sola mejora automática según monto y delega a la implementación base; no muta Datos Generales, expediente, etapa ni agenda.';

REVOKE ALL ON FUNCTION public.mesa_generar_infonavit_documentos(UUID, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_generar_infonavit_documentos(UUID, JSONB)
  TO authenticated, service_role;

-- El helper de propuesta continúa siendo interno.
REVOKE ALL ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT)
  TO postgres, service_role;
