-- INFONAVIT: la propuesta/presupuesto nunca debe congelar un snapshot sin domicilio.
-- Defensa en profundidad: el frontend compone direccionCompleta, y el writer SQL
-- vuelve a componerla desde los campos estructurados antes de insertar el snapshot.
-- No backfill, no UPDATE de expedientes, no citas/cupos/agenda.

CREATE OR REPLACE FUNCTION public.infonavit_compose_vivienda_direccion_v4(
  p_vivienda JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_calle TEXT;
  v_no_ext TEXT;
  v_no_int TEXT;
  v_lote TEXT;
  v_manzana TEXT;
  v_colonia TEXT;
  v_municipio TEXT;
  v_entidad TEXT;
  v_cp TEXT;
  v_structured TEXT;
  v_legacy TEXT;
BEGIN
  IF p_vivienda IS NULL OR jsonb_typeof(p_vivienda) <> 'object' THEN
    RETURN '';
  END IF;

  v_calle := NULLIF(btrim(regexp_replace(COALESCE(p_vivienda->>'calle', ''), '\s+', ' ', 'g')), '');
  v_no_ext := NULLIF(btrim(regexp_replace(COALESCE(p_vivienda->>'noExt', ''), '\s+', ' ', 'g')), '');
  v_no_int := NULLIF(btrim(regexp_replace(COALESCE(p_vivienda->>'noInt', ''), '\s+', ' ', 'g')), '');
  v_lote := NULLIF(btrim(regexp_replace(COALESCE(p_vivienda->>'lote', ''), '\s+', ' ', 'g')), '');
  v_manzana := NULLIF(btrim(regexp_replace(COALESCE(p_vivienda->>'manzana', ''), '\s+', ' ', 'g')), '');
  v_colonia := NULLIF(btrim(regexp_replace(COALESCE(p_vivienda->>'colonia', ''), '\s+', ' ', 'g')), '');
  v_municipio := NULLIF(btrim(regexp_replace(COALESCE(p_vivienda->>'municipio', ''), '\s+', ' ', 'g')), '');
  v_entidad := NULLIF(btrim(regexp_replace(COALESCE(p_vivienda->>'entidad', ''), '\s+', ' ', 'g')), '');
  v_cp := NULLIF(btrim(regexp_replace(COALESCE(p_vivienda->>'cp', ''), '\s+', ' ', 'g')), '');

  v_structured := concat_ws(
    ', ',
    v_calle,
    CASE WHEN v_no_ext IS NOT NULL THEN 'No. ' || v_no_ext END,
    CASE WHEN v_no_int IS NOT NULL THEN 'Int. ' || v_no_int END,
    CASE WHEN v_lote IS NOT NULL THEN 'Lote ' || v_lote END,
    CASE WHEN v_manzana IS NOT NULL THEN 'Mz. ' || v_manzana END,
    CASE WHEN v_colonia IS NOT NULL THEN 'Col. ' || v_colonia END,
    v_municipio,
    v_entidad,
    CASE WHEN v_cp IS NOT NULL THEN 'CP ' || v_cp END
  );

  v_structured := NULLIF(
    btrim(regexp_replace(COALESCE(v_structured, ''), '\s+', ' ', 'g')),
    ''
  );

  IF v_structured IS NOT NULL THEN
    RETURN v_structured;
  END IF;

  v_legacy := NULLIF(
    btrim(
      regexp_replace(
        COALESCE(
          NULLIF(p_vivienda->>'direccionCompleta', ''),
          NULLIF(p_vivienda->>'direccionLibre', ''),
          ''
        ),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  );

  RETURN COALESCE(v_legacy, '');
END;
$$;

COMMENT ON FUNCTION public.infonavit_compose_vivienda_direccion_v4(JSONB) IS
  'Compone domicilio INFONAVIT desde campos estructurados; fallback direccionCompleta/direccionLibre.';

REVOKE ALL ON FUNCTION public.infonavit_compose_vivienda_direccion_v4(JSONB)
  FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.mesa_generar_infonavit_documentos_single_base(
  p_expediente_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_exp RECORD;
  v_base JSONB;
  v_payload JSONB;
  v_cliente JSONB;
  v_empresa JSONB;
  v_vivienda JSONB;
  v_credito JSONB;
  v_destino JSONB;
  v_refs JSONB;
  v_ben JSONB;
  v_mejora JSONB;
  v_version INTEGER;
  v_snapshot_id UUID;
  v_hash TEXT;
  v_tipo TEXT;
  v_sha TEXT;
  v_fecha DATE;
  v_monto NUMERIC;
  v_plazo INTEGER;
  v_desc TEXT;
  v_direccion TEXT;
BEGIN
  IF NOT public.mesa_infonavit_generation_allowed(p_expediente_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(COALESCE(p_payload, '{}'::JSONB)) <> 'object' THEN
    RAISE EXCEPTION 'Payload inválido' USING ERRCODE = '22023';
  END IF;

  SELECT e.id, e.organization_id, e.programa
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL;

  IF NOT FOUND OR v_exp.programa IS DISTINCT FROM 'mejoravit'::public.programa THEN
    RAISE EXCEPTION 'La generación INFONAVIT aplica solo a Mejoravit'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.p189_infonavit_feature_enabled() THEN
    RAISE EXCEPTION 'Generación INFONAVIT desactivada' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_expediente_id::TEXT, 189));

  v_base := public.infonavit_build_submission_payload(p_expediente_id, now());
  v_cliente := COALESCE(v_base->'cliente', '{}'::JSONB)
    || COALESCE(p_payload->'cliente', '{}'::JSONB);
  v_empresa := COALESCE(v_base->'empresa', '{}'::JSONB)
    || COALESCE(p_payload->'empresa', '{}'::JSONB);
  v_vivienda := COALESCE(v_base->'vivienda', '{}'::JSONB)
    || COALESCE(p_payload->'vivienda', '{}'::JSONB);
  v_credito := COALESCE(v_base->'credito', '{}'::JSONB)
    || COALESCE(p_payload->'credito', '{}'::JSONB);
  v_destino := COALESCE(v_base->'destinoRecursos', '{}'::JSONB)
    || COALESCE(p_payload->'destinoRecursos', '{}'::JSONB);
  v_refs := CASE
    WHEN jsonb_typeof(p_payload->'referencias') = 'array'
      THEN p_payload->'referencias'
    ELSE v_base->'referencias'
  END;
  v_ben := COALESCE(v_base->'beneficiario', '{}'::JSONB)
    || COALESCE(p_payload->'beneficiario', '{}'::JSONB);
  v_mejora := COALESCE(v_base->'mejora', '{}'::JSONB)
    || COALESCE(p_payload->'mejora', '{}'::JSONB);

  -- P0 dirección: nunca permitir que campos vacíos del draft borren una dirección
  -- existente. Primero manda lo visible/editado en Mesa; si viene totalmente vacío,
  -- se recupera el domicilio base de Datos Generales.
  v_direccion := public.infonavit_compose_vivienda_direccion_v4(v_vivienda);
  IF NULLIF(btrim(COALESCE(v_direccion, '')), '') IS NULL THEN
    v_direccion := public.infonavit_compose_vivienda_direccion_v4(v_base->'vivienda');
  END IF;

  IF NULLIF(btrim(COALESCE(v_direccion, '')), '') IS NULL THEN
    RAISE EXCEPTION
      'INFONAVIT_DIRECCION_REQUERIDA: falta la dirección de la vivienda; completa Vivienda a mejorar antes de generar la propuesta'
      USING ERRCODE = '22023';
  END IF;

  v_vivienda := jsonb_set(
    v_vivienda,
    '{direccionCompleta}',
    to_jsonb(v_direccion),
    true
  );

  BEGIN
    v_monto := NULLIF(
      btrim(COALESCE(v_credito->>'montoSolicitado', '')),
      ''
    )::NUMERIC;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Monto solicitado inválido' USING ERRCODE = '22023';
  END;

  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'Monto solicitado requerido' USING ERRCODE = '22023';
  END IF;
  v_monto := round(v_monto, 2);

  BEGIN
    v_plazo := NULLIF(
      regexp_replace(COALESCE(v_credito->>'plazoAnios', ''), '\D', '', 'g'),
      ''
    )::INTEGER;
  EXCEPTION WHEN invalid_text_representation THEN
    v_plazo := NULL;
  END;

  IF v_plazo IS NOT NULL AND (v_plazo < 1 OR v_plazo > 10) THEN
    RAISE EXCEPTION 'Plazo debe estar entre 1 y 10 años'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(s.submission_version), -1) + 1
  INTO v_version
  FROM public.expediente_infonavit_submission_snapshots s
  WHERE s.expediente_id = p_expediente_id;

  v_desc := NULLIF(btrim(COALESCE(v_mejora->>'descripcion', '')), '');
  IF v_desc IS NULL THEN
    v_desc := public.infonavit_build_propuesta_mejoramiento_v3(
      v_monto,
      p_expediente_id::TEXT || '|mesa|' || v_version::TEXT || '|' || v_monto::TEXT
    );
  END IF;

  v_fecha := (now() AT TIME ZONE 'America/Monterrey')::DATE;
  IF COALESCE(p_payload->>'fechaDocumento', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      v_fecha := (p_payload->>'fechaDocumento')::DATE;
    EXCEPTION WHEN datetime_field_overflow THEN
      v_fecha := (now() AT TIME ZONE 'America/Monterrey')::DATE;
    END;
  END IF;

  v_credito := jsonb_set(
    v_credito,
    '{montoSolicitado}',
    to_jsonb(v_monto),
    true
  );
  v_credito := jsonb_set(
    v_credito,
    '{plazoAnios}',
    COALESCE(to_jsonb(v_plazo), 'null'::JSONB),
    true
  );
  v_mejora := jsonb_set(v_mejora, '{descripcion}', to_jsonb(v_desc), true);
  v_mejora := jsonb_set(
    v_mejora,
    '{presupuestoEstimado}',
    'null'::JSONB,
    true
  );

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'mappingVersion', 3,
    'fechaDocumento', to_char(v_fecha, 'YYYY-MM-DD'),
    'localidad', COALESCE(
      NULLIF(btrim(p_payload->>'localidad'), ''),
      v_base->>'localidad',
      'NUEVO LEÓN'
    ),
    'ciudadCierre', COALESCE(
      NULLIF(btrim(p_payload->>'ciudadCierre'), ''),
      v_base->>'ciudadCierre',
      'NUEVO LEÓN'
    ),
    'mappingWarnings', COALESCE(v_base->'mappingWarnings', '[]'::JSONB),
    'cliente', v_cliente,
    'empresa', v_empresa,
    'vivienda', v_vivienda,
    'credito', v_credito,
    'destinoRecursos', v_destino,
    'referencias', v_refs,
    'beneficiario', v_ben,
    'mejora', v_mejora
  );

  v_hash := encode(
    extensions.digest(convert_to(v_payload::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.expediente_infonavit_submission_snapshots (
    organization_id,
    expediente_id,
    submission_version,
    submission_kind,
    template_version,
    snapshot_hash,
    payload,
    fecha_documento
  )
  VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_version,
    'mesa_manual',
    'v1',
    v_hash,
    v_payload,
    v_fecha
  )
  RETURNING id INTO v_snapshot_id;

  FOREACH v_tipo IN ARRAY ARRAY[
    'infonavit_carta_bajo_protesta',
    'infonavit_presupuesto_mejoramiento',
    'infonavit_solicitud_inscripcion'
  ]::TEXT[]
  LOOP
    v_sha := public.infonavit_pdf_template_sha256(v_tipo);
    INSERT INTO public.infonavit_pdf_outbox (
      organization_id,
      expediente_id,
      snapshot_id,
      document_type,
      submission_version,
      template_version,
      template_sha256,
      snapshot_hash,
      status,
      attempts,
      max_attempts,
      available_at
    )
    VALUES (
      v_exp.organization_id,
      p_expediente_id,
      v_snapshot_id,
      v_tipo,
      v_version,
      'v1',
      v_sha,
      v_hash,
      'pending',
      0,
      5,
      now()
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'submission_version', v_version,
    'snapshot_id', v_snapshot_id,
    'outbox_count', 3
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_generar_infonavit_documentos_single_base(UUID, JSONB) IS
  'Mesa genera snapshot INFONAVIT v3; exige y congela direccionCompleta compuesta antes de crear propuesta/PDF/DOCX.';
