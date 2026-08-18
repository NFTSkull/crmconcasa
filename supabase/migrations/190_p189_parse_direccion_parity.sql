-- P189 hotfix: paridad SQL ↔ TS de infonavit_parse_direccion_mx
-- Cloud max actual = 189 (mapping v2). Esta 190 solo alinea el parser de domicilio.
-- CREATE OR REPLACE: misma firma (p_raw text) RETURNS jsonb, IMMUTABLE, search_path=public.
-- Grants existentes (PUBLIC EXECUTE) se conservan. Sin tablas, RLS, backfill, agenda.

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
  v_lote TEXT := '';
  v_manzana TEXT := '';
  v_muni TEXT := '';
  v_m TEXT[];
  v_after TEXT;
  v_toks TEXT[];
  v_last TEXT;
  v_rest TEXT;
  v_rest_tokens TEXT[];
  v_rn INTEGER;
  v_i INTEGER;
  v_n INTEGER;
  v_tok TEXT;
  v_col_acc TEXT[] := ARRAY[]::TEXT[];
  v_col_raw TEXT := '';
  v_nxt TEXT;
BEGIN
  v_completa := btrim(COALESCE(p_raw, ''));
  IF v_completa = '' THEN
    RETURN jsonb_build_object(
      'direccionCompleta', '',
      'calle', '',
      'noExt', '',
      'noInt', '',
      'lote', '',
      'manzana', '',
      'colonia', '',
      'municipio', '',
      'entidad', '',
      'cp', ''
    );
  END IF;

  v_work := upper(btrim(regexp_replace(replace(v_completa, ',', ' '), '\s+', ' ', 'g')));

  v_m := regexp_match(v_work, '(\y(?:LOTE|LT)\.?\s+(\S+))');
  IF v_m IS NOT NULL THEN
    v_lote := v_m[2];
    v_work := replace(v_work, v_m[1], ' ');
  END IF;

  v_m := regexp_match(v_work, '(\y(?:MANZANA|MZ)\.?\s+(\S+))');
  IF v_m IS NOT NULL THEN
    v_manzana := v_m[2];
    v_work := replace(v_work, v_m[1], ' ');
  END IF;

  v_m := regexp_match(v_work, '(?<![0-9])([0-9]{5})(?![0-9])');
  IF v_m IS NOT NULL THEN
    v_cp := v_m[1];
  END IF;

  v_m := regexp_match(v_work, '(\y(?:INT(?:ERIOR)?\.?)\s+(\S+))');
  IF v_m IS NOT NULL THEN
    v_no_int := v_m[2];
    v_work := replace(v_work, v_m[1], ' ');
  END IF;

  -- Tokenizar tras COL/COL./COLONIA: PG es leftmost-longest y un .+(stop1|stop2)
  -- absorbería municipio/C.P./CP5. Cortar token a token como el TS certificado.
  v_m := regexp_match(v_work, '(COL(?:ONIA)?\.?)\s+(.*)$');
  IF v_m IS NOT NULL THEN
    v_toks := regexp_split_to_array(btrim(v_m[2]), '\s+');
    v_n := COALESCE(array_length(v_toks, 1), 0);
    v_i := 1;
    WHILE v_i <= v_n LOOP
      v_tok := v_toks[v_i];
      v_nxt := CASE WHEN v_i < v_n THEN v_toks[v_i + 1] ELSE '' END;
      IF v_tok ~ '^[0-9]{5}$'
         OR v_tok ~ '^C\.P\.?$'
         OR v_tok = 'CP'
         OR v_tok ~ '^N\.L\.?$'
         OR v_tok = 'NL'
         OR (v_tok = 'NUEVO' AND v_nxt ~ '^LE[OÓ]N$')
         OR v_tok ~ '^INT(?:ERIOR)?\.?$'
         OR v_tok ~ '^LOTE$'
         OR v_tok ~ '^LT\.?$'
         OR v_tok ~ '^MANZANA$'
         OR v_tok ~ '^MZA?\.?$'
      THEN
        EXIT;
      END IF;
      v_col_acc := v_col_acc || v_tok;
      v_i := v_i + 1;
    END LOOP;
    v_col_raw := btrim(array_to_string(v_col_acc, ' '));
    v_colonia := v_col_raw;
    v_after := btrim(array_to_string(v_toks[v_i:v_n], ' '));
    IF v_after ~ '^(C\.P\.?|CP)(\s|$)' THEN
      v_rn := COALESCE(array_length(v_col_acc, 1), 0);
      IF v_rn >= 2 THEN
        v_last := v_col_acc[v_rn];
        IF v_last <> '' AND v_last NOT IN ('DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'Y') THEN
          v_muni := v_last;
          v_colonia := btrim(array_to_string(v_col_acc[1:v_rn - 1], ' '));
        END IF;
      END IF;
    END IF;
    v_colonia := btrim(regexp_replace(v_colonia, '\yC\.P\.?\y', ' ', 'g'));
    v_colonia := btrim(regexp_replace(v_colonia, '\s+', ' ', 'g'));
    IF v_col_raw <> '' THEN
      v_work := replace(v_work, v_m[1] || ' ' || v_col_raw, ' ');
    ELSE
      v_work := replace(v_work, v_m[1], ' ');
    END IF;
  END IF;

  IF v_work ~ '\yNUEVO LE[OÓ]N\y' OR v_work ~ 'N\.L\.?' OR v_work ~ '\yNL\y' THEN
    v_entidad := 'NUEVO LEÓN';
    v_work := regexp_replace(v_work, '\yNUEVO LE[OÓ]N\y', ' ', 'g');
    v_work := regexp_replace(v_work, 'N\.L\.?', ' ', 'g');
    v_work := regexp_replace(v_work, '\yNL\y', ' ', 'g');
  END IF;

  IF v_cp <> '' THEN
    v_work := regexp_replace(v_work, '\y' || v_cp || '\y', ' ', '');
  END IF;
  v_work := regexp_replace(v_work, '\yC\.P\.?\y', ' ', 'g');
  v_work := regexp_replace(v_work, '\yCP\y', ' ', 'g');
  v_work := replace(v_work, '#', ' ');
  v_work := regexp_replace(v_work, '\y([0-9]+[A-Z]{0,3})\.(?=\s|$)', '\1', 'g');
  v_work := btrim(regexp_replace(v_work, '\s+', ' ', 'g'));

  v_m := regexp_match(v_work, '^(.+?)\s+([0-9]+[A-Z]{0,3})(?:\s+(.+))?$');
  IF v_m IS NOT NULL THEN
    v_calle := btrim(v_m[1]);
    v_no_ext := btrim(v_m[2]);
    v_rest := btrim(COALESCE(v_m[3], ''));
    IF v_rest <> '' AND v_muni = '' AND (v_cp <> '' OR v_entidad <> '') THEN
      v_rest_tokens := regexp_split_to_array(v_rest, ' ');
      v_rn := COALESCE(array_length(v_rest_tokens, 1), 0);
      IF v_rn >= 1 THEN
        v_last := v_rest_tokens[v_rn];
        IF v_last <> '' AND v_last !~ '^[0-9]' THEN
          v_muni := v_last;
        END IF;
      END IF;
    END IF;
  ELSIF v_work <> '' THEN
    v_calle := v_work;
  END IF;

  IF v_calle = '' THEN
    v_calle := upper(btrim(regexp_replace(replace(v_completa, ',', ' '), '\s+', ' ', 'g')));
  END IF;

  RETURN jsonb_build_object(
    'direccionCompleta', v_completa,
    'calle', v_calle,
    'noExt', v_no_ext,
    'noInt', v_no_int,
    'lote', v_lote,
    'manzana', v_manzana,
    'colonia', v_colonia,
    'municipio', v_muni,
    'entidad', v_entidad,
    'cp', v_cp
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_parse_direccion_mx(TEXT) IS
  'P189 mig 190: parser de impresión alineado a parseDireccionMxParaSolicitud. direccionCompleta=raw. Colonia corta ante C.P./CP/CP5/INT/LOTE/MZ/entidad. Entidad solo NL/N.L./NUEVO LEÓN. No muta direccion_opcional.';

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
      'lote', COALESCE(v_dir_parsed->>'lote', ''),
      'manzana', COALESCE(v_dir_parsed->>'manzana', ''),
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
  'P189 mappingVersion=2 FINAL: monto=resolve_monto_operativo_mejoravit; parse impresión nombre/dirección (mig 190 parity); propuesta determinística; localidad=NUEVO LEÓN. No usa monto_aprobado. Templates v1.';
