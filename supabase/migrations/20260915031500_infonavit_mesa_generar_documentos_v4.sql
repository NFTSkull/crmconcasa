-- ConCasa CRM — INFONAVIT mapping v3 + generación manual Mesa
-- Alcance quirúrgico: documentos INFONAVIT únicamente.
-- NO modifica expedientes, etapas, agenda, bookings, cupos, Sheets ni Datos Generales.

-- 1) Snapshot manual versionado sin alterar el histórico automático.
ALTER TABLE public.expediente_infonavit_submission_snapshots
  DROP CONSTRAINT IF EXISTS expediente_infonavit_snapshots_kind_chk;

ALTER TABLE public.expediente_infonavit_submission_snapshots
  ADD CONSTRAINT expediente_infonavit_snapshots_kind_chk
  CHECK (submission_kind IN ('initial', 'reingreso', 'mesa_manual'));

-- 2) Plazo: Datos Generales históricos pueden guardar años (1..10) o meses (12..120).
CREATE OR REPLACE FUNCTION public.infonavit_normalize_plazo_anios_v3(p_raw TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_text TEXT := btrim(COALESCE(p_raw, ''));
  v_digits TEXT;
  v_value INTEGER;
BEGIN
  IF v_text = '' THEN
    RETURN NULL;
  END IF;

  v_digits := regexp_replace(v_text, '\D', '', 'g');
  IF v_digits = '' OR length(v_digits) > 3 THEN
    RETURN NULL;
  END IF;

  v_value := v_digits::INTEGER;
  IF v_value BETWEEN 1 AND 10 THEN
    RETURN v_value;
  END IF;

  IF v_value BETWEEN 12 AND 120 AND mod(v_value, 12) = 0 THEN
    RETURN v_value / 12;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.infonavit_normalize_plazo_anios_v3(TEXT) IS
  'P189 v3: normaliza plazo a años; acepta 1..10 años o 12..120 meses múltiplos de 12.';

-- 3) Propuesta de mejora variada pero determinística/auditable por expediente+fecha/versión.
-- Catálogo inspirado en categorías típicas de mejora del hogar; no asigna precios por concepto.
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
    'Resanes y aplicación de pintura interior y exterior.',
    'Impermeabilización y reparación de áreas con humedad.',
    'Renovación de pisos, azulejos, adhesivos y recubrimientos.',
    'Mejoras de baño: grifería, sanitario y accesorios.',
    'Mejoras de cocina: tarja, mezcladora y recubrimientos.',
    'Mantenimiento de instalaciones hidráulicas y conexiones.',
    'Mantenimiento eléctrico, contactos y luminarias.',
    'Renovación de puertas, cerraduras y herrajes.',
    'Mejora de ventanas y cancelería sin afectación estructural.',
    'Instalación o renovación de tinaco y bomba de agua.',
    'Renovación de calentador y conexiones hidráulicas.',
    'Rehabilitación de fachada con sellador y recubrimiento.',
    'Mejoras de ventilación y confort térmico de la vivienda.'
  ];
  v_target INTEGER;
  v_i INTEGER;
  v_pos INTEGER;
  v_idx INTEGER;
  v_line TEXT;
  v_selected TEXT[] := ARRAY[]::TEXT[];
  v_result TEXT := '';
  v_seed TEXT := COALESCE(NULLIF(p_seed, ''), 'infonavit');
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RETURN '';
  END IF;

  v_target := CASE
    WHEN p_monto <= 40000 THEN 2
    WHEN p_monto <= 90000 THEN 3
    ELSE 4
  END;

  -- Recorre posiciones distintas del MD5; si colisiona, avanza circularmente.
  FOR v_i IN 1..v_target LOOP
    v_pos := 1 + ((v_i - 1) * 2);
    v_idx := 1 + (get_byte(decode(md5(v_seed), 'hex'), v_i - 1) % array_length(v_catalog, 1));

    FOR v_pos IN 0..array_length(v_catalog, 1) - 1 LOOP
      v_line := v_catalog[1 + ((v_idx - 1 + v_pos) % array_length(v_catalog, 1))];
      EXIT WHEN NOT (v_line = ANY(v_selected));
    END LOOP;

    v_selected := array_append(v_selected, v_line);
  END LOOP;

  FOREACH v_line IN ARRAY v_selected LOOP
    v_result := v_result || CASE WHEN v_result = '' THEN '' ELSE E'\n' END || v_line;
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT) IS
  'P189 v3: 2-4 mejoras plausibles según monto; selección determinística por seed y sin precios inventados.';

-- 4) Snapshot automático v3. Datos de empresa/NRPP se toman literalmente de Datos Generales.
CREATE OR REPLACE FUNCTION public.infonavit_build_submission_payload(
  p_expediente_id UUID,
  p_fecha_envio TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp RECORD;
  v_cd public.cliente_datos%ROWTYPE;
  v_editor public.editor_decisions%ROWTYPE;
  v_datos JSONB;
  v_refs JSONB;
  v_ref1 JSONB;
  v_ref2 JSONB;
  v_fecha DATE;
  v_nss TEXT;
  v_monto NUMERIC;
  v_plazo INTEGER;
  v_nombre TEXT;
  v_nombre_parsed JSONB;
  v_dir TEXT;
  v_dir_parsed JSONB;
  v_desc TEXT;
  v_ben JSONB;
  v_ben_parsed JSONB;
  v_ciudad TEXT := 'NUEVO LEÓN';
  v_warnings JSONB := '[]'::JSONB;
  v_plazo_orig TEXT;
BEGIN
  SELECT e.id, e.nss, e.programa, e.cliente_nombre, e.direccion_opcional
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expediente no encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT cd.* INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  SELECT ed.* INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  v_datos := COALESCE(v_cd.datos, '{}'::JSONB);
  v_fecha := (p_fecha_envio AT TIME ZONE 'America/Monterrey')::DATE;

  v_nss := public.normalize_nss_mexico(
    COALESCE(
      NULLIF(btrim(COALESCE(v_exp.nss::text, '')), ''),
      NULLIF(btrim(COALESCE(v_datos->>'nss', '')), ''),
      ''
    )
  );

  v_refs := CASE
    WHEN v_cd.referencias IS NOT NULL AND jsonb_typeof(v_cd.referencias) = 'array'
      THEN v_cd.referencias
    WHEN jsonb_typeof(v_datos->'referencias') = 'array'
      THEN v_datos->'referencias'
    ELSE '[]'::JSONB
  END;

  v_ref1 := public.infonavit_map_referencia_general(COALESCE(v_refs->0, '{}'::JSONB));
  v_ref2 := public.infonavit_map_referencia_general(COALESCE(v_refs->1, '{}'::JSONB));

  -- Mantiene la autoridad financiera existente: monto operativo Mejoravit, no monto editorial.
  v_monto := public.resolve_monto_operativo_mejoravit(
    v_cd.monto_mejoravit_actualizado,
    v_datos,
    v_editor.monto_aprobado
  );
  IF v_monto IS NOT NULL THEN
    v_monto := round(v_monto, 2);
  END IF;

  v_nombre := NULLIF(btrim(COALESCE(v_datos->>'nombreCliente', '')), '');
  IF v_nombre IS NULL THEN
    v_nombre := NULLIF(btrim(COALESCE(v_exp.cliente_nombre, '')), '');
  END IF;
  v_nombre := COALESCE(v_nombre, '');
  v_nombre_parsed := public.infonavit_parse_nombre_persona_mx(v_nombre);

  v_dir := COALESCE(NULLIF(btrim(COALESCE(v_exp.direccion_opcional, '')), ''), '');
  v_dir_parsed := public.infonavit_parse_direccion_mx(v_dir);

  v_desc := NULLIF(btrim(COALESCE(v_datos #>> '{infonavit,mejora,descripcion}', '')), '');
  IF v_desc IS NULL THEN
    v_desc := public.infonavit_build_propuesta_mejoramiento_v3(
      v_monto,
      p_expediente_id::TEXT || '|' || to_char(v_fecha, 'YYYY-MM-DD') || '|' || COALESCE(v_monto::TEXT, '')
    );
  END IF;

  v_plazo_orig := btrim(COALESCE(v_datos->>'plazo', ''));
  v_plazo := public.infonavit_normalize_plazo_anios_v3(v_plazo_orig);
  IF v_plazo_orig <> '' AND v_plazo IS NULL THEN
    v_warnings := v_warnings || jsonb_build_array('plazo_invalido');
  END IF;

  v_ben := COALESCE(v_datos->'beneficiario', '{}'::JSONB);
  v_ben_parsed := public.infonavit_parse_nombre_persona_mx(v_ben->>'nombre');

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'mappingVersion', 3,
    'fechaDocumento', to_char(v_fecha, 'YYYY-MM-DD'),
    'localidad', v_ciudad,
    'ciudadCierre', v_ciudad,
    'mappingWarnings', v_warnings,
    'cliente', jsonb_build_object(
      'nombreCompleto', public.infonavit_print_upper(v_nombre),
      'nombres', v_nombre_parsed->>'nombres',
      'apellidoPaterno', v_nombre_parsed->>'apellidoPaterno',
      'apellidoMaterno', v_nombre_parsed->>'apellidoMaterno',
      'nss', COALESCE(v_nss, ''),
      'curp', upper(btrim(COALESCE(v_datos->>'curp', ''))),
      'rfc', upper(btrim(COALESCE(v_datos->>'rfc', ''))),
      'celular', COALESCE(public.cliente_datos_telefono_canonico(COALESCE(v_datos->>'celular', '')), ''),
      'correo', btrim(COALESCE(v_datos->>'correo', '')),
      'telefono', COALESCE(public.cliente_datos_telefono_canonico(COALESCE(v_datos->>'telefonoCasa', '')), ''),
      'ladaTelefono', '',
      'genero', NULLIF(v_datos->>'genero', ''),
      'estadoCivil', NULLIF(v_datos->>'estadoCivil', ''),
      'regimenMatrimonial', NULLIF(v_datos->>'regimenMatrimonial', ''),
      'identificacion', jsonb_build_object(
        'tipo', COALESCE(v_datos #>> '{identificacion,tipo}', ''),
        'numero', COALESCE(v_datos #>> '{identificacion,numero}', ''),
        'vigencia', COALESCE(v_datos #>> '{identificacion,vigencia}', '')
      )
    ),
    'empresa', jsonb_build_object(
      'nombre', btrim(COALESCE(v_datos->>'empresa', '')),
      'registroPatronal', btrim(COALESCE(v_datos->>'registroPatronal', '')),
      'telefono', COALESCE(public.cliente_datos_telefono_canonico(COALESCE(v_datos->>'telefonoEmpresa', '')), ''),
      'lada', COALESCE(v_datos->>'ladaEmpresa', ''),
      'extension', COALESCE(v_datos->>'extensionEmpresa', '')
    ),
    'vivienda', jsonb_build_object(
      'direccionCompleta', v_dir_parsed->>'direccionCompleta',
      'calle', v_dir_parsed->>'calle',
      'noExt', v_dir_parsed->>'noExt',
      'noInt', v_dir_parsed->>'noInt',
      'lote', COALESCE(v_dir_parsed->>'lote', ''),
      'manzana', COALESCE(v_dir_parsed->>'manzana', ''),
      'colonia', v_dir_parsed->>'colonia',
      'entidad', v_dir_parsed->>'entidad',
      'municipio', v_dir_parsed->>'municipio',
      'cp', v_dir_parsed->>'cp',
      'tipoPropiedad', NULLIF(v_datos #>> '{infonavit,vivienda,tipoPropiedad}', '')
    ),
    'credito', jsonb_build_object(
      'montoSolicitado', v_monto,
      'plazoAnios', v_plazo
    ),
    'destinoRecursos', jsonb_build_object(
      'porcentajeTitulacion', '',
      'clabeNotaria', '',
      'clabeDerechohabiente', ''
    ),
    'referencias', jsonb_build_array(v_ref1, v_ref2),
    'beneficiario', jsonb_build_object(
      'nombres', v_ben_parsed->>'nombres',
      'apellidoPaterno', v_ben_parsed->>'apellidoPaterno',
      'apellidoMaterno', v_ben_parsed->>'apellidoMaterno',
      'parentesco', public.infonavit_print_upper(COALESCE(v_ben->>'parentesco', ''))
    ),
    'mejora', jsonb_build_object(
      'descripcion', COALESCE(v_desc, ''),
      -- El formato oficial conserva el rótulo, pero v3 NO imprime monto ni fecha en Presupuesto.
      'presupuestoEstimado', NULL
    )
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_build_submission_payload(UUID, TIMESTAMPTZ) IS
  'P189 v3: mapping desde Datos Generales; empresa/NRPP exactos, plazo años/meses, mejora variada, presupuesto estimado no autoimpreso.';

-- 5) Gate Mesa: solo roles Mesa/super_admin activos y con visibilidad del expediente.
CREATE OR REPLACE FUNCTION public.mesa_infonavit_generation_allowed(p_expediente_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role public.app_role;
  v_active BOOLEAN;
BEGIN
  IF v_uid IS NULL OR p_expediente_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.active INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  IF v_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RETURN false;
  END IF;

  RETURN public.can_see_expediente(p_expediente_id);
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_infonavit_generation_allowed(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_infonavit_generation_allowed(UUID) TO postgres, service_role;

-- 6) Draft siempre fresco desde Datos Generales; no muta nada.
CREATE OR REPLACE FUNCTION public.mesa_get_infonavit_document_draft(p_expediente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_programa public.programa;
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

  RETURN public.infonavit_build_submission_payload(p_expediente_id, now());
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_get_infonavit_document_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_get_infonavit_document_draft(UUID) TO authenticated, service_role;

-- 7) Generación manual: nueva versión inmutable; NO escribe de regreso a Datos Generales.
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
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL;

  IF NOT FOUND OR v_exp.programa IS DISTINCT FROM 'mejoravit'::public.programa THEN
    RAISE EXCEPTION 'La generación INFONAVIT aplica solo a Mejoravit' USING ERRCODE = '22023';
  END IF;

  IF NOT public.p189_infonavit_feature_enabled() THEN
    RAISE EXCEPTION 'Generación INFONAVIT desactivada' USING ERRCODE = '55000';
  END IF;

  -- Serializa dos clicks/concurrencia del mismo expediente para no duplicar versión.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_expediente_id::TEXT, 189));

  v_base := public.infonavit_build_submission_payload(p_expediente_id, now());

  -- Whitelist por secciones. Las claves extra de nivel raíz se descartan.
  v_cliente := COALESCE(v_base->'cliente', '{}'::JSONB) || COALESCE(p_payload->'cliente', '{}'::JSONB);
  v_empresa := COALESCE(v_base->'empresa', '{}'::JSONB) || COALESCE(p_payload->'empresa', '{}'::JSONB);
  v_vivienda := COALESCE(v_base->'vivienda', '{}'::JSONB) || COALESCE(p_payload->'vivienda', '{}'::JSONB);
  v_credito := COALESCE(v_base->'credito', '{}'::JSONB) || COALESCE(p_payload->'credito', '{}'::JSONB);
  v_destino := COALESCE(v_base->'destinoRecursos', '{}'::JSONB) || COALESCE(p_payload->'destinoRecursos', '{}'::JSONB);
  v_refs := CASE WHEN jsonb_typeof(p_payload->'referencias') = 'array' THEN p_payload->'referencias' ELSE v_base->'referencias' END;
  v_ben := COALESCE(v_base->'beneficiario', '{}'::JSONB) || COALESCE(p_payload->'beneficiario', '{}'::JSONB);
  v_mejora := COALESCE(v_base->'mejora', '{}'::JSONB) || COALESCE(p_payload->'mejora', '{}'::JSONB);

  BEGIN
    v_monto := NULLIF(btrim(COALESCE(v_credito->>'montoSolicitado', '')), '')::NUMERIC;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Monto solicitado inválido' USING ERRCODE = '22023';
  END;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'Monto solicitado requerido' USING ERRCODE = '22023';
  END IF;
  v_monto := round(v_monto, 2);

  BEGIN
    v_plazo := NULLIF(regexp_replace(COALESCE(v_credito->>'plazoAnios', ''), '\D', '', 'g'), '')::INTEGER;
  EXCEPTION WHEN invalid_text_representation THEN
    v_plazo := NULL;
  END;
  IF v_plazo IS NOT NULL AND (v_plazo < 1 OR v_plazo > 10) THEN
    RAISE EXCEPTION 'Plazo debe estar entre 1 y 10 años' USING ERRCODE = '22023';
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

  v_credito := jsonb_set(v_credito, '{montoSolicitado}', to_jsonb(v_monto), true);
  v_credito := jsonb_set(v_credito, '{plazoAnios}', COALESCE(to_jsonb(v_plazo), 'null'::JSONB), true);
  v_mejora := jsonb_set(v_mejora, '{descripcion}', to_jsonb(v_desc), true);
  -- Regla explícita: Presupuesto de Mejoramiento nunca recibe monto estimado automático.
  v_mejora := jsonb_set(v_mejora, '{presupuestoEstimado}', 'null'::JSONB, true);

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'mappingVersion', 3,
    'fechaDocumento', to_char(v_fecha, 'YYYY-MM-DD'),
    'localidad', COALESCE(NULLIF(btrim(p_payload->>'localidad'), ''), v_base->>'localidad', 'NUEVO LEÓN'),
    'ciudadCierre', COALESCE(NULLIF(btrim(p_payload->>'ciudadCierre'), ''), v_base->>'ciudadCierre', 'NUEVO LEÓN'),
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

  v_hash := encode(extensions.digest(convert_to(v_payload::TEXT, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.expediente_infonavit_submission_snapshots (
    organization_id, expediente_id, submission_version, submission_kind,
    template_version, snapshot_hash, payload, fecha_documento
  ) VALUES (
    v_exp.organization_id, p_expediente_id, v_version, 'mesa_manual',
    'v1', v_hash, v_payload, v_fecha
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
      organization_id, expediente_id, snapshot_id, document_type,
      submission_version, template_version, template_sha256, snapshot_hash,
      status, attempts, max_attempts, available_at
    ) VALUES (
      v_exp.organization_id, p_expediente_id, v_snapshot_id, v_tipo,
      v_version, 'v1', v_sha, v_hash,
      'pending', 0, 5, now()
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

COMMENT ON FUNCTION public.mesa_generar_infonavit_documentos(UUID, JSONB) IS
  'Mesa: crea snapshot mesa_manual + 3 outbox. No muta Datos Generales, expediente, etapa ni agenda.';

REVOKE ALL ON FUNCTION public.mesa_generar_infonavit_documentos(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_generar_infonavit_documentos(UUID, JSONB) TO authenticated, service_role;

-- Helpers internos no expuestos al navegador.
REVOKE ALL ON FUNCTION public.infonavit_normalize_plazo_anios_v3(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_normalize_plazo_anios_v3(TEXT) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_build_propuesta_mejoramiento_v3(NUMERIC, TEXT) TO postgres, service_role;
