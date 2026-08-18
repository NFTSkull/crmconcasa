-- ConCasa CRM — P189 hotfix mappingVersion=2 (regla FINAL)
-- REPLACE infonavit_build_submission_payload + helpers de IMPRESIÓN.
-- NO muta snapshots/outbox/documentos existentes.
-- NO cambia resolve_monto_operativo_mejoravit (cobro/P090 intacto).
-- NO cambia template_version (sigue v1). schemaVersion=1, mappingVersion=2.
-- NO agenda / NO Sheets / NO P170 / NO Datos Generales.
--
-- Monto P189 = resolve_monto_operativo_mejoravit (Monto Mejoravit).
-- NO usa editor_decisions.monto_aprobado como autoridad de documentos.

CREATE OR REPLACE FUNCTION public.infonavit_print_upper(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(btrim(regexp_replace(COALESCE(p_raw, ''), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public.infonavit_print_pop_apellido(p_tokens TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_tokens TEXT[] := COALESCE(p_tokens, ARRAY[]::TEXT[]);
  v_n INTEGER;
  v_apellido TEXT;
  v_pair TEXT;
  v_parts TEXT[];
  v_i INTEGER;
  v_only_particles BOOLEAN;
BEGIN
  v_n := COALESCE(array_length(v_tokens, 1), 0);
  IF v_n < 1 THEN
    RETURN jsonb_build_object('apellido', NULL, 'tokens', v_tokens);
  END IF;

  v_apellido := v_tokens[v_n];
  v_tokens := v_tokens[1:v_n - 1];

  LOOP
    v_n := COALESCE(array_length(v_tokens, 1), 0);
    EXIT WHEN v_n < 1;

    IF v_n >= 2 THEN
      v_pair := v_tokens[v_n - 1] || ' ' || v_tokens[v_n];
      IF v_pair IN ('DE LA', 'DE LAS', 'DE LOS') THEN
        v_apellido := v_pair || ' ' || v_apellido;
        v_tokens := v_tokens[1:v_n - 2];
        CONTINUE;
      END IF;
    END IF;

    IF v_tokens[v_n] IN ('DEL', 'DE', 'SANTA', 'SAN', 'LAS', 'LOS', 'LA') THEN
      v_apellido := v_tokens[v_n] || ' ' || v_apellido;
      v_tokens := v_tokens[1:v_n - 1];
      CONTINUE;
    END IF;

    EXIT;
  END LOOP;

  v_parts := regexp_split_to_array(v_apellido, ' ');
  v_only_particles := true;
  v_i := 1;
  WHILE v_i <= COALESCE(array_length(v_parts, 1), 0) LOOP
    IF v_i < COALESCE(array_length(v_parts, 1), 0)
       AND (v_parts[v_i] || ' ' || v_parts[v_i + 1]) IN ('DE LA', 'DE LAS', 'DE LOS') THEN
      v_i := v_i + 2;
      CONTINUE;
    END IF;
    IF v_parts[v_i] NOT IN ('DEL', 'DE', 'SANTA', 'SAN', 'LAS', 'LOS', 'LA') THEN
      v_only_particles := false;
      EXIT;
    END IF;
    v_i := v_i + 1;
  END LOOP;

  IF v_only_particles THEN
    RETURN jsonb_build_object('apellido', NULL, 'tokens', p_tokens);
  END IF;

  RETURN jsonb_build_object('apellido', v_apellido, 'tokens', v_tokens);
END;
$$;

CREATE OR REPLACE FUNCTION public.infonavit_parse_nombre_persona_mx(p_full TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_norm TEXT;
  v_tokens TEXT[];
  v_n INTEGER;
  v_pop JSONB;
  v_materno TEXT;
  v_paterno TEXT;
  v_nombres TEXT;
  v_unparsed JSONB;
BEGIN
  v_norm := public.infonavit_print_upper(p_full);
  v_unparsed := jsonb_build_object(
    'nombres', COALESCE(v_norm, ''),
    'apellidoPaterno', '',
    'apellidoMaterno', '',
    'parsed', false,
    'confidence', 'none'
  );

  IF v_norm IS NULL OR v_norm = '' THEN
    RETURN jsonb_build_object(
      'nombres', '',
      'apellidoPaterno', '',
      'apellidoMaterno', '',
      'parsed', false,
      'confidence', 'none'
    );
  END IF;

  v_tokens := regexp_split_to_array(v_norm, ' ');
  v_n := COALESCE(array_length(v_tokens, 1), 0);
  IF v_n < 3 THEN
    RETURN v_unparsed;
  END IF;

  v_pop := public.infonavit_print_pop_apellido(v_tokens);
  v_materno := v_pop->>'apellido';
  IF v_materno IS NULL THEN
    RETURN v_unparsed;
  END IF;
  v_tokens := ARRAY(SELECT jsonb_array_elements_text(v_pop->'tokens'));
  IF COALESCE(array_length(v_tokens, 1), 0) < 2 THEN
    RETURN v_unparsed;
  END IF;

  v_pop := public.infonavit_print_pop_apellido(v_tokens);
  v_paterno := v_pop->>'apellido';
  IF v_paterno IS NULL THEN
    RETURN v_unparsed;
  END IF;
  v_tokens := ARRAY(SELECT jsonb_array_elements_text(v_pop->'tokens'));
  IF COALESCE(array_length(v_tokens, 1), 0) < 1 THEN
    RETURN v_unparsed;
  END IF;

  v_nombres := array_to_string(v_tokens, ' ');
  IF v_nombres IS NULL OR btrim(v_nombres) = '' THEN
    RETURN v_unparsed;
  END IF;

  -- 4 tokens + paterno con partícula (MARIA DEL CARMEN LOPEZ): no separar.
  IF v_n <= 4 AND (
    v_paterno ~ '^(DEL|DE|SANTA|SAN|LAS|LOS|LA)( |$)'
    OR v_paterno LIKE 'DE LA %'
    OR v_paterno LIKE 'DE LAS %'
    OR v_paterno LIKE 'DE LOS %'
  ) THEN
    RETURN v_unparsed;
  END IF;

  RETURN jsonb_build_object(
    'nombres', v_nombres,
    'apellidoPaterno', v_paterno,
    'apellidoMaterno', v_materno,
    'parsed', true,
    'confidence', 'high'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.infonavit_parse_direccion_mx(p_raw TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_completa TEXT;
  v_work TEXT;
  v_cp TEXT := '';
  v_colonia TEXT := '';
  v_entidad TEXT := '';
  v_calle TEXT := '';
  v_no_ext TEXT := '';
  v_no_int TEXT := '';
  v_muni TEXT := '';
  v_m TEXT[];
  v_rest TEXT;
  v_rest_tokens TEXT[];
  v_rn INTEGER;
BEGIN
  v_completa := btrim(COALESCE(p_raw, ''));
  IF v_completa = '' THEN
    RETURN jsonb_build_object(
      'direccionCompleta', '',
      'calle', '',
      'noExt', '',
      'noInt', '',
      'colonia', '',
      'municipio', '',
      'entidad', '',
      'cp', ''
    );
  END IF;

  v_work := upper(btrim(regexp_replace(replace(v_completa, ',', ' '), '\s+', ' ', 'g')));

  v_m := regexp_match(v_work, '([^0-9]|^)([0-9]{5})([^0-9]|$)');
  IF v_m IS NOT NULL THEN
    v_cp := v_m[2];
  END IF;

  v_m := regexp_match(v_work, '(INT(?:ERIOR)?\.?)\s+(\S+)');
  IF v_m IS NOT NULL THEN
    v_no_int := v_m[2];
    v_work := replace(v_work, v_m[1] || ' ' || v_no_int, ' ');
  END IF;

  IF v_cp <> '' THEN
    v_m := regexp_match(v_work, '(COL(?:ONIA)?\.?)\s+(.+)\s+' || v_cp);
    IF v_m IS NOT NULL THEN
      v_colonia := btrim(v_m[2]);
      v_work := replace(v_work, v_m[1] || ' ' || v_colonia, ' ');
    END IF;
  END IF;
  IF v_colonia = '' THEN
    v_m := regexp_match(v_work, '(COL(?:ONIA)?\.?)\s+(.+)\s+N\.L');
    IF v_m IS NOT NULL THEN
      v_colonia := btrim(v_m[2]);
      v_work := replace(v_work, v_m[1] || ' ' || v_colonia, ' ');
    END IF;
  END IF;
  IF v_colonia = '' THEN
    v_m := regexp_match(v_work, '(COL(?:ONIA)?\.?)\s+(.+)\s+NUEVO LE');
    IF v_m IS NOT NULL THEN
      v_colonia := btrim(v_m[2]);
      v_work := replace(v_work, v_m[1] || ' ' || v_colonia, ' ');
    END IF;
  END IF;

  IF v_work ~ 'NUEVO LE[OÓ]N' OR v_work ~ 'N\.L\.?' OR v_work ~ '\mNL\M' THEN
    v_entidad := 'NUEVO LEÓN';
    v_work := regexp_replace(v_work, 'NUEVO LE[OÓ]N', ' ', 'g');
    v_work := regexp_replace(v_work, 'N\.L\.?', ' ', 'g');
    v_work := regexp_replace(v_work, '\mNL\M', ' ', 'g');
  END IF;

  IF v_cp <> '' THEN
    v_work := regexp_replace(v_work, '\m' || v_cp || '\M', ' ', 'g');
  END IF;
  v_work := regexp_replace(v_work, '\mC\.?P\.?\M', ' ', 'g');
  v_work := btrim(regexp_replace(v_work, '\s+', ' ', 'g'));

  v_m := regexp_match(v_work, '^(.+?)\s+([0-9]+[A-Z]{0,3})(?:\s+(.+))?$');
  IF v_m IS NOT NULL THEN
    v_calle := btrim(v_m[1]);
    v_no_ext := btrim(v_m[2]);
    v_rest := btrim(COALESCE(v_m[3], ''));
    IF v_rest <> '' AND (v_cp <> '' OR v_entidad <> '') THEN
      v_rest_tokens := regexp_split_to_array(v_rest, ' ');
      v_rn := COALESCE(array_length(v_rest_tokens, 1), 0);
      IF v_rn >= 1 THEN
        v_muni := v_rest_tokens[v_rn];
      END IF;
    END IF;
  ELSIF v_work <> '' THEN
    v_calle := v_work;
  END IF;

  IF v_calle = '' THEN
    v_calle := upper(v_completa);
  END IF;

  RETURN jsonb_build_object(
    'direccionCompleta', v_completa,
    'calle', v_calle,
    'noExt', v_no_ext,
    'noInt', v_no_int,
    'colonia', v_colonia,
    'municipio', v_muni,
    'entidad', v_entidad,
    'cp', v_cp
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.infonavit_build_propuesta_mejoramiento(p_monto NUMERIC)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RETURN '';
  END IF;

  IF p_monto <= 50000 THEN
    RETURN E'Resanes y aplicación de pintura interior y exterior.\nImpermeabilización y reparación de áreas con humedad.\nMantenimiento de instalaciones hidráulicas.';
  END IF;

  IF p_monto <= 90000 THEN
    RETURN E'Resanes y aplicación de pintura interior y exterior.\nImpermeabilización y reparación de áreas con humedad.\nRenovación de pisos, azulejos y recubrimientos.';
  END IF;

  IF p_monto <= 130000 THEN
    RETURN E'Resanes y aplicación de pintura interior y exterior.\nImpermeabilización y reparación de áreas con humedad.\nRenovación de pisos, azulejos y recubrimientos.\nMantenimiento de instalaciones hidráulicas y eléctricas.';
  END IF;

  RETURN E'Resanes y pintura interior y exterior de mayor alcance.\nImpermeabilización integral y reparación de humedad.\nRenovación de pisos, azulejos y recubrimientos.\nMejoras de baño y cocina sin afectación estructural.';
END;
$$;

CREATE OR REPLACE FUNCTION public.infonavit_map_referencia_general(p_ref JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_ref JSONB := COALESCE(p_ref, '{}'::JSONB);
  v_full TEXT;
  v_parsed JSONB;
  v_pat TEXT;
  v_mat TEXT;
  v_nom TEXT;
  v_cel TEXT;
  v_tel TEXT;
  v_lada TEXT;
  v_cel_can TEXT;
  v_tel_can TEXT;
BEGIN
  v_pat := btrim(COALESCE(v_ref->>'apellidoPaterno', ''));
  v_mat := btrim(COALESCE(v_ref->>'apellidoMaterno', ''));
  v_nom := btrim(COALESCE(v_ref->>'nombres', v_ref->>'nombre', ''));
  v_full := btrim(COALESCE(v_ref->>'nombre', v_ref->>'nombres', ''));

  IF v_pat <> '' AND v_mat <> '' AND v_nom <> '' THEN
    v_nom := public.infonavit_print_upper(v_nom);
    v_pat := public.infonavit_print_upper(v_pat);
    v_mat := public.infonavit_print_upper(v_mat);
  ELSE
    v_parsed := public.infonavit_parse_nombre_persona_mx(v_full);
    v_nom := v_parsed->>'nombres';
    v_pat := v_parsed->>'apellidoPaterno';
    v_mat := v_parsed->>'apellidoMaterno';
  END IF;

  v_cel := NULLIF(btrim(COALESCE(v_ref->>'celular', '')), '');
  v_cel_can := public.cliente_datos_telefono_canonico(COALESCE(v_cel, ''));

  v_tel := NULLIF(btrim(COALESCE(v_ref->>'telefono', '')), '');
  v_tel_can := CASE
    WHEN v_tel IS NULL THEN NULL
    ELSE public.cliente_datos_telefono_canonico(v_tel)
  END;
  IF v_tel_can IS NOT NULL AND v_cel_can IS NOT NULL AND v_tel_can = v_cel_can THEN
    v_tel := NULL;
  END IF;

  v_lada := CASE
    WHEN v_tel IS NOT NULL THEN COALESCE(NULLIF(btrim(COALESCE(v_ref->>'lada', '')), ''), '')
    ELSE ''
  END;

  RETURN jsonb_build_object(
    'nombres', COALESCE(v_nom, ''),
    'apellidoPaterno', COALESCE(v_pat, ''),
    'apellidoMaterno', COALESCE(v_mat, ''),
    'lada', v_lada,
    'telefono', COALESCE(v_tel, ''),
    'celular', COALESCE(v_cel_can, '')
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_map_referencia_general(JSONB) IS
  'P189 mapping v2: parseNombrePersonaMx sobre nombre; celular solo de referencias[].celular; LADA/teléfono fijo vacíos salvo fuente distinta.';

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
  v_plazo_raw TEXT;
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
  SELECT e.nss, e.programa, e.cliente_nombre, e.direccion_opcional
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

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

  -- P189 docs: Monto Mejoravit operativo (NO monto_aprobado editorial).
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
    v_desc := public.infonavit_build_propuesta_mejoramiento(v_monto);
  END IF;

  v_plazo := NULL;
  v_plazo_orig := btrim(COALESCE(v_datos->>'plazo', ''));
  v_plazo_raw := regexp_replace(v_plazo_orig, '\D', '', 'g');
  IF v_plazo_orig = '' THEN
    NULL;
  ELSIF v_plazo_raw ~ '^(10|[1-9])$' THEN
    v_plazo := v_plazo_raw::INTEGER;
  ELSE
    v_warnings := v_warnings || jsonb_build_array('plazo_invalido');
  END IF;

  v_ben := COALESCE(v_datos->'beneficiario', '{}'::JSONB);
  v_ben_parsed := public.infonavit_parse_nombre_persona_mx(v_ben->>'nombre');

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'mappingVersion', 2,
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
      'telefono', '',
      'ladaTelefono', '',
      'genero', '',
      'estadoCivil', '',
      'regimenMatrimonial', '',
      'identificacion', jsonb_build_object(
        'tipo', '',
        'numero', '',
        'vigencia', ''
      )
    ),
    'empresa', jsonb_build_object(
      'nombre', btrim(COALESCE(v_datos->>'empresa', '')),
      'registroPatronal', btrim(COALESCE(v_datos->>'registroPatronal', '')),
      'telefono', COALESCE(
        public.cliente_datos_telefono_canonico(COALESCE(v_datos->>'telefonoEmpresa', '')),
        ''
      ),
      'lada', '',
      'extension', ''
    ),
    'vivienda', jsonb_build_object(
      'direccionCompleta', v_dir_parsed->>'direccionCompleta',
      'calle', v_dir_parsed->>'calle',
      'noExt', v_dir_parsed->>'noExt',
      'noInt', v_dir_parsed->>'noInt',
      'lote', '',
      'manzana', '',
      'colonia', v_dir_parsed->>'colonia',
      'entidad', v_dir_parsed->>'entidad',
      'municipio', v_dir_parsed->>'municipio',
      'cp', v_dir_parsed->>'cp',
      'tipoPropiedad', ''
    ),
    'credito', jsonb_build_object(
      'montoSolicitado', v_monto,
      'plazoAnios', v_plazo
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
      'presupuestoEstimado', v_monto
    )
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_build_submission_payload(UUID, TIMESTAMPTZ) IS
  'P189 mappingVersion=2 FINAL: monto=resolve_monto_operativo_mejoravit; parse impresión nombre/dirección; propuesta determinística; localidad=NUEVO LEÓN. No usa monto_aprobado. Templates v1.';
