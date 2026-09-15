-- ConCasa CRM — INFONAVIT v4: generación controlada por Mesa.
--
-- Objetivos:
-- 1) Enviar a Mesa / reingreso ya NO genera automáticamente los 3 documentos.
-- 2) Mesa parte de Datos Generales; después de una generación reutiliza la última
--    corrección de Mesa (p. ej. NRPP), sin escribir de regreso a cliente_datos.
-- 3) La descripción de mejora se regenera por versión: variada, sin duplicados y
--    filtrada por un umbral económico razonable según el monto aprobado.
-- 4) Presupuesto estimado y fecha inferior siguen vacíos por mappingVersion >= 3.
--
-- Catálogo calibrado con referencias minoristas Home Depot México consultadas
-- 2026-09-14 (pisos cerámicos ~124-319 MXN/m2; tinacos 1100 L ~3.1-6.6k;
-- calentadores ~3.5-13.3k). Los umbrales son de PROYECTO y deliberadamente
-- conservadores; NO son cotizaciones ni existe dependencia runtime de Home Depot.
--
-- Alcance: solo helpers/snapshots/outbox INFONAVIT. 0 UPDATE/DELETE/backfill.
-- No toca agenda, citas, cupos, Sheets, etapas ni Datos Generales del asesor.

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
  v_catalog TEXT[] := ARRAY[
    'Resanes, sellado y aplicación de pintura en muros interiores.',
    'Impermeabilización de azotea y reparación de zonas con humedad.',
    'Renovación parcial de piso cerámico, adhesivo y boquilla.',
    'Mejora de baño con grifería, sanitario y accesorios.',
    'Mejora de cocina con tarja, mezcladora y recubrimiento.',
    'Mantenimiento de tuberías, llaves y conexiones hidráulicas.',
    'Mantenimiento eléctrico con contactos, apagadores y luminarias.',
    'Renovación de puertas, cerraduras y herrajes.',
    'Mejora de ventanas y cancelería sin afectación estructural.',
    'Instalación o renovación de tinaco y accesorios hidráulicos.',
    'Renovación de calentador de agua y conexiones.',
    'Rehabilitación de fachada con sellador, resanes y recubrimiento.',
    'Mejora de ventilación y aislamiento térmico ligero.',
    'Renovación de accesorios y muebles básicos de baño.',
    'Reparación y mejora de área de lavado con conexiones hidráulicas.'
  ];
  -- Monto mínimo del crédito para incluir cada concepto en una combinación
  -- razonable junto con mano de obra/consumibles y otros conceptos del proyecto.
  v_min_monto NUMERIC[] := ARRAY[
     8000, 12000, 25000, 20000, 22000,
    12000, 12000, 10000, 30000, 18000,
    15000, 10000, 18000, 16000, 12000
  ]::NUMERIC[];
  v_eligible INTEGER[] := ARRAY[]::INTEGER[];
  v_selected INTEGER[] := ARRAY[]::INTEGER[];
  v_target INTEGER;
  v_i INTEGER;
  v_j INTEGER;
  v_start INTEGER;
  v_candidate INTEGER;
  v_hash BYTEA;
  v_result TEXT := '';
  v_seed TEXT := COALESCE(NULLIF(p_seed, ''), 'infonavit');
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RETURN '';
  END IF;

  FOR v_i IN 1..array_length(v_catalog, 1) LOOP
    IF p_monto >= v_min_monto[v_i] THEN
      v_eligible := array_append(v_eligible, v_i);
    END IF;
  END LOOP;

  -- Fail-safe para montos extraordinariamente bajos: usa solo mejoras ligeras.
  IF cardinality(v_eligible) < 2 THEN
    v_eligible := ARRAY[1, 8, 12]::INTEGER[];
  END IF;

  v_target := CASE
    WHEN p_monto < 30000 THEN 2
    WHEN p_monto < 70000 THEN 3
    ELSE 4
  END;
  v_target := LEAST(v_target, cardinality(v_eligible));

  FOR v_i IN 1..v_target LOOP
    v_hash := decode(md5(v_seed || '|' || v_i::TEXT), 'hex');
    v_start := 1 + (get_byte(v_hash, 0) % cardinality(v_eligible));

    FOR v_j IN 0..cardinality(v_eligible) - 1 LOOP
      v_candidate := v_eligible[1 + ((v_start - 1 + v_j) % cardinality(v_eligible))];
      EXIT WHEN NOT (v_candidate = ANY(v_selected));
    END LOOP;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(v_selected)) THEN
      v_selected := array_append(v_selected, v_candidate);
    END IF;
  END LOOP;

  FOREACH v_candidate IN ARRAY v_selected LOOP
    v_result := v_result
      || CASE WHEN v_result = '' THEN '' ELSE E'\n' END
      || v_catalog[v_candidate];
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT) IS
  'INFONAVIT v4: 2-4 mejoras distintas por generación, filtradas por monto y selección determinística por seed/version.';

-- Draft de Mesa: la primera vez replica Datos Generales. Después conserva la
-- última edición realmente GENERADA por Mesa para que correcciones como NRPP
-- no se pierdan al reabrir el expediente. La descripción se limpia porque es
-- automática por versión; el monto operativo/plazo se refrescan desde CRM.
CREATE OR REPLACE FUNCTION public.mesa_get_infonavit_document_draft(p_expediente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_programa public.programa;
  v_base JSONB;
  v_latest JSONB;
  v_result JSONB;
  v_monto JSONB;
  v_plazo JSONB;
  v_today TEXT;
BEGIN
  IF NOT public.mesa_infonavit_generation_allowed(p_expediente_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT e.programa INTO v_programa
  FROM public.expedientes e
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL;

  IF NOT FOUND OR v_programa IS DISTINCT FROM 'mejoravit'::public.programa THEN
    RAISE EXCEPTION 'La generación INFONAVIT aplica solo a Mejoravit' USING ERRCODE = '22023';
  END IF;

  v_base := public.infonavit_build_submission_payload(p_expediente_id, now());

  SELECT s.payload
  INTO v_latest
  FROM public.expediente_infonavit_submission_snapshots s
  WHERE s.expediente_id = p_expediente_id
    AND s.submission_kind = 'mesa_manual'
  ORDER BY s.submission_version DESC, s.created_at DESC
  LIMIT 1;

  v_result := COALESCE(v_latest, v_base);

  -- Fuente financiera vigente del CRM, sin borrar una corrección anterior si
  -- en un expediente legado el dato actual aún no está disponible.
  v_monto := NULLIF(v_base #> '{credito,montoSolicitado}', 'null'::JSONB);
  IF v_monto IS NOT NULL THEN
    v_result := jsonb_set(v_result, '{credito,montoSolicitado}', v_monto, true);
  END IF;

  v_plazo := NULLIF(v_base #> '{credito,plazoAnios}', 'null'::JSONB);
  IF v_plazo IS NOT NULL THEN
    v_result := jsonb_set(v_result, '{credito,plazoAnios}', v_plazo, true);
  END IF;

  -- Cada generación recibe una propuesta nueva; nunca arrastrar la anterior.
  v_result := jsonb_set(v_result, '{mejora,descripcion}', to_jsonb(''::TEXT), true);
  v_result := jsonb_set(v_result, '{mejora,presupuestoEstimado}', 'null'::JSONB, true);

  v_today := to_char((now() AT TIME ZONE 'America/Monterrey')::DATE, 'YYYY-MM-DD');
  v_result := jsonb_set(v_result, '{fechaDocumento}', to_jsonb(v_today), true);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_get_infonavit_document_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_get_infonavit_document_draft(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.mesa_get_infonavit_document_draft(UUID) IS
  'Mesa: draft Mejoravit desde última edición Mesa o Datos Generales; refresca monto/plazo, limpia mejora automática y no muta cliente_datos.';

-- Cambio de autoridad: ya no crear snapshot/PDF al enviar o reenviar a Mesa.
-- La única generación nueva la ejecuta mesa_generar_infonavit_documentos().
CREATE OR REPLACE FUNCTION public.enqueue_infonavit_pdf_submission(
  p_expediente_id UUID,
  p_organization_id UUID,
  p_submission_version INTEGER,
  p_submission_kind TEXT,
  p_fecha_envio TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_programa public.programa;
BEGIN
  SELECT e.programa
  INTO v_programa
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF v_programa IS DISTINCT FROM 'mejoravit'::public.programa THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'not_mejoravit');
  END IF;

  RETURN jsonb_build_object(
    'enqueued', false,
    'reason', 'mesa_manual_required',
    'submission_version', p_submission_version,
    'submission_kind', p_submission_kind
  );
END;
$$;

COMMENT ON FUNCTION public.enqueue_infonavit_pdf_submission(UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ) IS
  'INFONAVIT v4: envío/reingreso no genera PDFs; Mesa genera desde su pestaña editable. Mantiene firma RPC para no tocar enviar_a_mesa.';

REVOKE ALL ON FUNCTION public.enqueue_infonavit_pdf_submission(UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_infonavit_pdf_submission(UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ)
  TO postgres, service_role;
