-- ConCasa CRM — P189 B8 HOTFIX: PDFs INFONAVIT Mesa-only
-- required=FALSE siempre; should_enqueue=Mejoravit+feature ON en send/reingreso.
-- Snapshot desde Datos Generales históricos (campos ausentes → blank/null).
-- Asesor DENIED en read model P189. NO edita 183–187.

CREATE OR REPLACE FUNCTION public.p189_infonavit_get_eligibility(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_exp RECORD;
  v_feature BOOLEAN;
  v_activation TIMESTAMPTZ;
  v_aplica BOOLEAN;
  v_legacy BOOLEAN;
  v_complete BOOLEAN;
  v_diag TEXT;
BEGIN
  SELECT e.id, e.programa, e.created_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'aplica_mejoravit', false,
      'feature_active', false,
      'legacy', false,
      'required', false,
      'has_complete_v1', false,
      'should_enqueue', false
    );
  END IF;

  v_aplica := v_exp.programa IS NOT DISTINCT FROM 'mejoravit'::public.programa;
  v_feature := public.p189_infonavit_feature_enabled();
  v_activation := public.p189_infonavit_activation_at();
  v_legacy := (v_activation IS NOT NULL AND v_exp.created_at < v_activation);

  v_diag := public.mejoravit_infonavit_datos_persistidos_diagnostico(p_expediente_id);
  v_complete := v_aplica AND v_diag = 'ok';

  RETURN jsonb_build_object(
    'aplica_mejoravit', v_aplica,
    'feature_active', v_feature,
    'legacy', v_legacy,
    'required', false,
    'has_complete_v1', v_complete,
    'should_enqueue', (v_aplica AND v_feature)
  );
END;
$$;

COMMENT ON FUNCTION public.p189_infonavit_get_eligibility(UUID) IS
  'P189 B8: required=false siempre. should_enqueue=Mejoravit+feature ON (sin v1/legacy).';

CREATE OR REPLACE FUNCTION public.assert_mejoravit_infonavit_datos_persistidos(
  p_expediente_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- P189 B8: no gate documental del asesor.
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.assert_mejoravit_infonavit_datos_persistidos(UUID) IS
  'P189 B8: no-op. P189 nunca bloquea enviar_a_mesa/reingreso.';

CREATE OR REPLACE FUNCTION public.infonavit_map_referencia_general(p_ref JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'nombres', COALESCE(
      NULLIF(btrim(COALESCE(p_ref->>'nombre', p_ref->>'nombres', '')), ''),
      ''
    ),
    'apellidoPaterno', COALESCE(
      public.infonavit_json_trimmed(p_ref, VARIADIC ARRAY['apellidoPaterno']),
      ''
    ),
    'apellidoMaterno', COALESCE(
      public.infonavit_json_trimmed(p_ref, VARIADIC ARRAY['apellidoMaterno']),
      ''
    ),
    'lada', COALESCE(NULLIF(btrim(COALESCE(p_ref->>'lada', '')), ''), ''),
    'telefono', COALESCE(NULLIF(btrim(COALESCE(p_ref->>'telefono', '')), ''), ''),
    'celular', COALESCE(
      public.cliente_datos_telefono_canonico(
        COALESCE(NULLIF(btrim(COALESCE(p_ref->>'celular', '')), ''), p_ref->>'telefono', '')
      ),
      ''
    )
  );
$$;

COMMENT ON FUNCTION public.infonavit_map_referencia_general(JSONB) IS
  'P189 B8: referencia desde datos generales ({nombre,celular}) sin heurísticas.';

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
BEGIN
  SELECT e.nss, e.programa
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

  v_monto := public.resolve_monto_operativo_mejoravit(
    v_cd.monto_mejoravit_actualizado,
    v_datos,
    v_editor.monto_aprobado
  );

  v_plazo := NULL;
  v_plazo_raw := regexp_replace(btrim(COALESCE(v_datos->>'plazo', '')), '\D', '', 'g');
  IF v_plazo_raw ~ '^(10|[1-9])$' THEN
    v_plazo := v_plazo_raw::INTEGER;
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'fechaDocumento', to_char(v_fecha, 'YYYY-MM-DD'),
    'localidad', '',
    'cliente', jsonb_build_object(
      'nombres', '',
      'apellidoPaterno', '',
      'apellidoMaterno', '',
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
      'calle', '',
      'noExt', '',
      'noInt', '',
      'lote', '',
      'manzana', '',
      'colonia', '',
      'entidad', '',
      'municipio', '',
      'cp', '',
      'tipoPropiedad', ''
    ),
    'credito', jsonb_build_object(
      'montoSolicitado', v_monto,
      'plazoAnios', v_plazo
    ),
    'referencias', jsonb_build_array(v_ref1, v_ref2),
    'beneficiario', jsonb_build_object(
      'nombres', btrim(COALESCE(v_datos->'beneficiario'->>'nombre', '')),
      'apellidoPaterno', '',
      'apellidoMaterno', '',
      'parentesco', btrim(COALESCE(v_datos->'beneficiario'->>'parentesco', ''))
    ),
    'mejora', jsonb_build_object(
      'descripcion', '',
      'presupuestoEstimado', NULL
    )
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_build_submission_payload(UUID, TIMESTAMPTZ) IS
  'P189 B8: snapshot inmutable solo desde Datos Generales CRM. Ausentes → blank/null.';

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
SET search_path = public, extensions
AS $$
DECLARE
  v_programa public.programa;
  v_payload JSONB;
  v_hash TEXT;
  v_fecha DATE;
  v_snapshot_id UUID;
  v_tipo TEXT;
  v_sha TEXT;
BEGIN
  SELECT e.programa
  INTO v_programa
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF v_programa IS DISTINCT FROM 'mejoravit'::public.programa THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'not_mejoravit');
  END IF;

  IF NOT public.p189_infonavit_feature_enabled() THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'feature_off');
  END IF;

  v_payload := public.infonavit_build_submission_payload(p_expediente_id, p_fecha_envio);
  v_hash := encode(
    extensions.digest(convert_to(v_payload::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );
  v_fecha := (p_fecha_envio AT TIME ZONE 'America/Monterrey')::DATE;

  INSERT INTO public.expediente_infonavit_submission_snapshots (
    organization_id,
    expediente_id,
    submission_version,
    submission_kind,
    template_version,
    snapshot_hash,
    payload,
    fecha_documento
  ) VALUES (
    p_organization_id,
    p_expediente_id,
    p_submission_version,
    p_submission_kind,
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
    ) VALUES (
      p_organization_id,
      p_expediente_id,
      v_snapshot_id,
      v_tipo,
      p_submission_version,
      'v1',
      v_sha,
      v_hash,
      'pending',
      0,
      5,
      p_fecha_envio
    );
  END LOOP;

  RETURN jsonb_build_object(
    'enqueued', true,
    'snapshot_id', v_snapshot_id,
    'submission_version', p_submission_version,
    'submission_kind', p_submission_kind,
    'outbox_count', 3
  );
END;
$$;

COMMENT ON FUNCTION public.enqueue_infonavit_pdf_submission(UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ) IS
  'P189 B8: snapshot+3 outbox sin assert v1. No-op si no Mejoravit o feature OFF.';

CREATE OR REPLACE FUNCTION public.infonavit_pdf_read_allowed(p_expediente_id UUID)
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

  SELECT p.app_role, p.active
    INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  IF v_role IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RETURN public.can_see_expediente(p_expediente_id);
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.infonavit_pdf_read_allowed(UUID) IS
  'P189 B8: Mesa/super_admin únicamente. Asesor/editor DENIED.';

REVOKE ALL ON FUNCTION public.infonavit_map_referencia_general(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_map_referencia_general(JSONB)
  TO postgres, service_role;

COMMENT ON FUNCTION public.enviar_a_mesa(UUID) IS
  'P189 B8: envío Mesa. Snapshot/outbox Mejoravit si should_enqueue (feature ON). required=false. Sin PDF sync.';

COMMENT ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID) IS
  'Reingreso 152 + P189 B8. Enqueue Mejoravit+feature ON sin gate v1. Idempotencia intacta.';

COMMENT ON FUNCTION public.get_p189_infonavit_feature_status(UUID) IS
  'P189 B8: status UI. required siempre false. Sin PII.';
