-- ConCasa CRM — P189 B3 + B7: snapshot inmutable + outbox transaccional (LOCAL)
-- Envío/reingreso Mejoravit: misma TX → 1 snapshot + 3 outbox pending.
-- B7: flag Vault DEFAULT OFF + elegibilidad created_at vs activation.
-- NO genera PDFs. NO Storage. NO Edge. NO cron. NO claim/mark.
-- NO muta 183. NO Cloud apply.
-- NO vault.create_secret en esta migration (valores solo ops/local tests).

-- =============================================================================
-- A) Tablas
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.expediente_infonavit_submission_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  submission_version INTEGER NOT NULL,
  submission_kind TEXT NOT NULL,
  template_version TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  fecha_documento DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_infonavit_snapshots_version_chk
    CHECK (submission_version >= 0),
  CONSTRAINT expediente_infonavit_snapshots_kind_chk
    CHECK (submission_kind IN ('initial', 'reingreso')),
  CONSTRAINT expediente_infonavit_snapshots_template_chk
    CHECK (template_version = 'v1'),
  CONSTRAINT expediente_infonavit_snapshots_hash_chk
    CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT expediente_infonavit_snapshots_exp_ver_uidx
    UNIQUE (expediente_id, submission_version)
);

CREATE INDEX IF NOT EXISTS expediente_infonavit_snapshots_org_idx
  ON public.expediente_infonavit_submission_snapshots (organization_id, created_at DESC);

COMMENT ON TABLE public.expediente_infonavit_submission_snapshots IS
  'P189 B3: snapshot inmutable de Datos Generales Infonavit al confirmar envío/reingreso Mejoravit. PII solo en payload. Sin SELECT authenticated.';

CREATE TABLE IF NOT EXISTS public.infonavit_pdf_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL
    REFERENCES public.expediente_infonavit_submission_snapshots(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  submission_version INTEGER NOT NULL,
  template_version TEXT NOT NULL,
  template_sha256 TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ NULL,
  processed_at TIMESTAMPTZ NULL,
  last_error_code TEXT NULL,
  documento_id UUID NULL
    REFERENCES public.expediente_documentos(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT infonavit_pdf_outbox_version_chk CHECK (submission_version >= 0),
  CONSTRAINT infonavit_pdf_outbox_attempts_chk CHECK (attempts >= 0),
  CONSTRAINT infonavit_pdf_outbox_max_attempts_chk CHECK (max_attempts > 0),
  CONSTRAINT infonavit_pdf_outbox_template_chk CHECK (template_version = 'v1'),
  CONSTRAINT infonavit_pdf_outbox_sha_chk CHECK (template_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT infonavit_pdf_outbox_hash_chk CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT infonavit_pdf_outbox_status_chk
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  CONSTRAINT infonavit_pdf_outbox_type_chk
    CHECK (document_type IN (
      'infonavit_carta_bajo_protesta',
      'infonavit_presupuesto_mejoramiento',
      'infonavit_solicitud_inscripcion'
    )),
  CONSTRAINT infonavit_pdf_outbox_idem_uidx UNIQUE (
    expediente_id,
    document_type,
    submission_version,
    template_version,
    snapshot_hash
  )
);

CREATE INDEX IF NOT EXISTS infonavit_pdf_outbox_pending_idx
  ON public.infonavit_pdf_outbox (available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS infonavit_pdf_outbox_exp_idx
  ON public.infonavit_pdf_outbox (expediente_id, submission_version);

COMMENT ON TABLE public.infonavit_pdf_outbox IS
  'P189 B3: outbox PER_DOCUMENT (3 filas/submission). NO es agenda_sheet_sync_outbox. B4 reclamará; B3 solo pending.';

DROP TRIGGER IF EXISTS infonavit_pdf_outbox_set_updated_at ON public.infonavit_pdf_outbox;
CREATE TRIGGER infonavit_pdf_outbox_set_updated_at
  BEFORE UPDATE ON public.infonavit_pdf_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- B) Inmutabilidad snapshot
-- =============================================================================

CREATE OR REPLACE FUNCTION public.expediente_infonavit_snapshot_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('infonavit.snapshot_mutable', true) = '1' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'INFONAVIT_SNAPSHOT_IMMUTABLE'
    USING ERRCODE = '22023';
END;
$$;

DROP TRIGGER IF EXISTS expediente_infonavit_snapshot_immutable_tg
  ON public.expediente_infonavit_submission_snapshots;
CREATE TRIGGER expediente_infonavit_snapshot_immutable_tg
  BEFORE UPDATE OR DELETE ON public.expediente_infonavit_submission_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.expediente_infonavit_snapshot_immutable();

REVOKE ALL ON FUNCTION public.expediente_infonavit_snapshot_immutable() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- C) RLS / grants (PII)
-- =============================================================================

ALTER TABLE public.expediente_infonavit_submission_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expediente_infonavit_submission_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.infonavit_pdf_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.infonavit_pdf_outbox FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.expediente_infonavit_submission_snapshots
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.infonavit_pdf_outbox
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.expediente_infonavit_submission_snapshots
  TO postgres, service_role;
GRANT ALL ON TABLE public.infonavit_pdf_outbox
  TO postgres, service_role;

-- =============================================================================
-- D) Helpers P189
-- =============================================================================

CREATE OR REPLACE FUNCTION public.infonavit_pdf_template_sha256(p_document_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_document_type
    WHEN 'infonavit_carta_bajo_protesta' THEN
      'bfff2e484ca40e96aef3cb86fb3c6303d37afdbf795556688e96ed3307689ea4'
    WHEN 'infonavit_presupuesto_mejoramiento' THEN
      '8402f7e6cae5d569dcff1afd3dd41cd24203fd164d9c8e5ab88d337f2d3e0581'
    WHEN 'infonavit_solicitud_inscripcion' THEN
      'f091c744a30c269bfbf9a534544838e214eb9cad56602a3dc3e2d603a55d90a6'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.infonavit_pdf_template_sha256(TEXT) IS
  'P189 B1 SHA256 congelado por document_type. Sin PII.';

CREATE OR REPLACE FUNCTION public.infonavit_json_trimmed(p_obj JSONB, VARIADIC p_path TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(btrim(COALESCE(p_obj #>> p_path, '')), '');
$$;

CREATE OR REPLACE FUNCTION public.infonavit_parse_positive_monto(p_raw JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_txt TEXT;
  v_num NUMERIC(12, 2);
BEGIN
  IF p_raw IS NULL OR p_raw = 'null'::JSONB THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_raw) = 'number' THEN
    v_num := (p_raw #>> '{}')::NUMERIC;
  ELSE
    v_txt := NULLIF(btrim(replace(replace(p_raw #>> '{}', '$', ''), ',', '')), '');
    IF v_txt IS NULL THEN
      RETURN NULL;
    END IF;
    BEGIN
      v_num := v_txt::NUMERIC;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN NULL;
    END;
  END IF;
  IF v_num IS NULL OR v_num <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN round(v_num, 2);
END;
$$;

-- =============================================================================
-- D2) P189 B7: feature flag Vault (DEFAULT OFF) + elegibilidad
-- Nombres Vault (valores NUNCA en esta migration):
--   p189_infonavit_enqueue_enabled
--   p189_infonavit_activation_at
-- =============================================================================

CREATE OR REPLACE FUNCTION public.p189_infonavit_vault_trimmed(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_txt TEXT;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN NULL;
  END IF;
  SELECT NULLIF(btrim(ds.decrypted_secret), '')
    INTO v_txt
  FROM vault.decrypted_secrets ds
  WHERE ds.name = p_name
  LIMIT 1;
  RETURN v_txt;
END;
$$;

COMMENT ON FUNCTION public.p189_infonavit_vault_trimmed(TEXT) IS
  'P189 B7 interno: lee Vault trimmed. No GRANT authenticated. No loguea valores.';

CREATE OR REPLACE FUNCTION public.p189_infonavit_activation_at()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_raw TEXT;
  v_at TIMESTAMPTZ;
BEGIN
  v_raw := public.p189_infonavit_vault_trimmed('p189_infonavit_activation_at');
  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_at := v_raw::TIMESTAMPTZ;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;
  RETURN v_at;
END;
$$;

COMMENT ON FUNCTION public.p189_infonavit_activation_at() IS
  'P189 B7 interno: timestamptz de activación o NULL si missing/malformed.';

CREATE OR REPLACE FUNCTION public.p189_infonavit_feature_enabled()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_en TEXT;
  v_at TIMESTAMPTZ;
BEGIN
  v_en := lower(COALESCE(public.p189_infonavit_vault_trimmed('p189_infonavit_enqueue_enabled'), ''));
  IF v_en IS DISTINCT FROM 'true' THEN
    RETURN false;
  END IF;
  v_at := public.p189_infonavit_activation_at();
  IF v_at IS NULL THEN
    RETURN false;
  END IF;
  RETURN NOW() >= v_at;
END;
$$;

COMMENT ON FUNCTION public.p189_infonavit_feature_enabled() IS
  'P189 B7: TRUE solo si enabled=true (trim/ci) + activation parseable + now>=activation. DEFAULT OFF.';

CREATE OR REPLACE FUNCTION public.mejoravit_infonavit_datos_persistidos_diagnostico(
  p_expediente_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp RECORD;
  v_cd public.cliente_datos%ROWTYPE;
  v_datos JSONB;
  v_inf JSONB;
  v_ver TEXT;
  v_nss_datos TEXT;
  v_nss_exp TEXT;
  v_civil TEXT;
  v_regimen TEXT;
  v_prop TEXT;
  v_cp TEXT;
  v_plazo TEXT;
  v_plazo_n INTEGER;
  v_i INTEGER;
  v_ref JSONB;
  v_lada_combo TEXT;
  v_cel TEXT;
  v_monto_credito NUMERIC;
  v_presupuesto NUMERIC;
  v_desc TEXT;
  v_vig TEXT;
  v_curp TEXT;
  v_editor public.editor_decisions%ROWTYPE;
BEGIN
  SELECT e.id, e.programa, e.nss, e.organization_id
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RETURN 'incomplete';
  END IF;

  IF v_exp.programa IS DISTINCT FROM 'mejoravit'::public.programa THEN
    RETURN 'not_mejoravit';
  END IF;

  SELECT cd.*
  INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RETURN 'incomplete';
  END IF;

  v_datos := COALESCE(v_cd.datos, '{}'::JSONB);
  v_inf := v_datos->'infonavit';

  IF v_inf IS NULL OR jsonb_typeof(v_inf) <> 'object' THEN
    RETURN 'incomplete';
  END IF;

  v_ver := btrim(COALESCE(v_inf->>'schemaVersion', ''));
  IF v_ver IS NULL OR v_ver = '' THEN
    RETURN 'incomplete';
  END IF;
  IF v_ver <> '1' THEN
    RETURN 'version_invalid';
  END IF;

  IF public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'nombres']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'apellidoPaterno']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'apellidoMaterno']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'identificacion', 'tipo']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'identificacion', 'numero']) IS NULL THEN
    RETURN 'incomplete';
  END IF;

  v_vig := public.infonavit_json_trimmed(
    v_inf, VARIADIC ARRAY['titular', 'identificacion', 'vigencia']
  );
  IF v_vig IS NULL OR v_vig !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN 'incomplete';
  END IF;
  BEGIN
    PERFORM v_vig::DATE;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN 'incomplete';
  END;

  IF public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'genero'])
       NOT IN ('M', 'F') THEN
    RETURN 'incomplete';
  END IF;

  v_civil := public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'estadoCivil']);
  IF v_civil NOT IN ('soltero', 'casado') THEN
    RETURN 'incomplete';
  END IF;
  v_regimen := public.infonavit_json_trimmed(
    v_inf, VARIADIC ARRAY['titular', 'regimenMatrimonial']
  );
  IF v_civil = 'casado'
     AND v_regimen NOT IN ('separacion_bienes', 'sociedad_conyugal') THEN
    RETURN 'incomplete';
  END IF;

  v_prop := public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'tipoPropiedad']);
  IF v_prop NOT IN ('propia', 'conyuge_concubino', 'familiar') THEN
    RETURN 'incomplete';
  END IF;

  IF public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'localidad']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'calle']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'numeroExterior']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'colonia']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'entidad']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'municipio']) IS NULL THEN
    RETURN 'incomplete';
  END IF;

  v_cp := public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'cp']);
  IF v_cp IS NULL OR v_cp !~ '^\d{5}$' THEN
    RETURN 'incomplete';
  END IF;

  IF jsonb_typeof(v_inf->'referencias') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_inf->'referencias') < 2 THEN
    RETURN 'incomplete';
  END IF;

  FOR v_i IN 0..1 LOOP
    v_ref := v_inf->'referencias'->v_i;
    IF public.infonavit_json_trimmed(v_ref, VARIADIC ARRAY['nombres']) IS NULL
       OR public.infonavit_json_trimmed(v_ref, VARIADIC ARRAY['apellidoPaterno']) IS NULL
       OR public.infonavit_json_trimmed(v_ref, VARIADIC ARRAY['apellidoMaterno']) IS NULL THEN
      RETURN 'incomplete';
    END IF;
    v_lada_combo := public.cliente_datos_lada_telefono_canonico(
      COALESCE(v_ref->>'lada', ''),
      COALESCE(v_ref->>'telefono', '')
    );
    v_cel := public.cliente_datos_telefono_canonico(COALESCE(v_ref->>'celular', ''));
    IF v_lada_combo IS NULL OR v_cel IS NULL THEN
      RETURN 'incomplete';
    END IF;
  END LOOP;

  IF public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['beneficiario', 'nombres']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['beneficiario', 'apellidoPaterno']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['beneficiario', 'apellidoMaterno']) IS NULL
     OR public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['beneficiario', 'parentesco']) IS NULL THEN
    RETURN 'incomplete';
  END IF;

  v_desc := public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['mejora', 'descripcion']);
  IF v_desc IS NULL OR char_length(v_desc) > 240 THEN
    RETURN 'incomplete';
  END IF;
  v_presupuesto := public.infonavit_parse_positive_monto(v_inf->'mejora'->'presupuestoEstimado');
  IF v_presupuesto IS NULL THEN
    RETURN 'incomplete';
  END IF;

  v_nss_datos := public.normalize_nss_mexico(v_datos->>'nss');
  v_nss_exp := public.normalize_nss_mexico(v_exp.nss::TEXT);
  IF v_nss_datos IS NULL OR length(v_nss_datos) <> 11 THEN
    RETURN 'incomplete';
  END IF;
  IF v_nss_exp IS NULL OR length(v_nss_exp) <> 11 THEN
    RETURN 'incomplete';
  END IF;
  IF v_nss_datos IS DISTINCT FROM v_nss_exp THEN
    RETURN 'nss_mismatch';
  END IF;

  v_curp := upper(btrim(COALESCE(v_datos->>'curp', '')));
  IF v_curp !~ '^[A-Z0-9]{18}$' THEN
    RETURN 'incomplete';
  END IF;

  IF public.cliente_datos_telefono_canonico(COALESCE(v_datos->>'celular', '')) IS NULL
     OR NULLIF(btrim(COALESCE(v_datos->>'correo', '')), '') IS NULL
     OR position('@' IN v_datos->>'correo') = 0
     OR NULLIF(btrim(COALESCE(v_datos->>'empresa', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_datos->>'registroPatronal', '')), '') IS NULL
     OR public.cliente_datos_telefono_canonico(COALESCE(v_datos->>'telefonoEmpresa', '')) IS NULL THEN
    RETURN 'incomplete';
  END IF;

  IF public.parse_monto_mejoravit_json(v_datos) IS NULL THEN
    RETURN 'incomplete';
  END IF;

  v_plazo := regexp_replace(btrim(COALESCE(v_datos->>'plazo', '')), '\D', '', 'g');
  IF v_plazo IS NULL OR v_plazo = '' THEN
    RETURN 'incomplete';
  END IF;
  BEGIN
    v_plazo_n := v_plazo::INTEGER;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN 'incomplete';
  END;
  IF v_plazo_n < 1 OR v_plazo_n > 10 THEN
    RETURN 'incomplete';
  END IF;

  SELECT ed.* INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  v_monto_credito := public.resolve_monto_operativo_mejoravit(
    v_cd.monto_mejoravit_actualizado,
    v_datos,
    v_editor.monto_aprobado
  );
  IF v_monto_credito IS NULL OR v_monto_credito <= 0 THEN
    RETURN 'incomplete';
  END IF;

  RETURN 'ok';
END;
$$;

COMMENT ON FUNCTION public.mejoravit_infonavit_datos_persistidos_diagnostico(UUID) IS
  'P189 B7: diagnostico v1 sin RAISE. ok|incomplete|version_invalid|nss_mismatch|not_mejoravit.';

CREATE OR REPLACE FUNCTION public.mejoravit_infonavit_datos_persistidos_completos(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.mejoravit_infonavit_datos_persistidos_diagnostico(p_expediente_id) = 'ok';
$$;

COMMENT ON FUNCTION public.mejoravit_infonavit_datos_persistidos_completos(UUID) IS
  'P189 B7: TRUE solo si diagnostico=ok (v1 completo + NSS consistente).';

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
  v_required BOOLEAN;
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

  v_required := v_aplica AND v_feature AND NOT v_legacy;

  RETURN jsonb_build_object(
    'aplica_mejoravit', v_aplica,
    'feature_active', v_feature,
    'legacy', v_legacy,
    'required', v_required,
    'has_complete_v1', v_complete,
    'should_enqueue', (v_aplica AND v_feature AND v_complete)
  );
END;
$$;

COMMENT ON FUNCTION public.p189_infonavit_get_eligibility(UUID) IS
  'P189 B7: matriz required/should_enqueue. Fail-open solo legacy (created_at < activation).';

CREATE OR REPLACE FUNCTION public.assert_mejoravit_infonavit_datos_persistidos(
  p_expediente_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_diag TEXT;
BEGIN
  v_diag := public.mejoravit_infonavit_datos_persistidos_diagnostico(p_expediente_id);
  IF v_diag = 'not_mejoravit' THEN
    RETURN;
  END IF;
  IF v_diag = 'ok' THEN
    RETURN;
  END IF;
  IF v_diag = 'version_invalid' THEN
    RAISE EXCEPTION 'INFONAVIT_DATOS_VERSION_INVALIDA'
      USING ERRCODE = '22023';
  END IF;
  IF v_diag = 'nss_mismatch' THEN
    RAISE EXCEPTION 'INFONAVIT_NSS_MISMATCH'
      USING ERRCODE = '22023';
  END IF;
  RAISE EXCEPTION 'INFONAVIT_DATOS_INCOMPLETOS'
    USING ERRCODE = '22023';
END;
$$;

COMMENT ON FUNCTION public.assert_mejoravit_infonavit_datos_persistidos(UUID) IS
  'P189 B7: wrapper RAISE sobre diagnostico. No-op si programa ≠ mejoravit. Sin PII en errores.';

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
  v_inf JSONB;
  v_fecha DATE;
  v_civil TEXT;
  v_regimen TEXT;
  v_ref1 JSONB;
  v_ref2 JSONB;
  v_monto NUMERIC;
  v_presupuesto NUMERIC;
  v_plazo INTEGER;
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
  v_inf := COALESCE(v_datos->'infonavit', '{}'::JSONB);
  v_fecha := (p_fecha_envio AT TIME ZONE 'America/Monterrey')::DATE;

  v_civil := COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'estadoCivil']), '');
  v_regimen := COALESCE(
    public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'regimenMatrimonial']),
    ''
  );
  IF v_civil IS DISTINCT FROM 'casado' THEN
    v_regimen := '';
  END IF;

  v_ref1 := COALESCE(v_inf->'referencias'->0, '{}'::JSONB);
  v_ref2 := COALESCE(v_inf->'referencias'->1, '{}'::JSONB);

  v_monto := public.resolve_monto_operativo_mejoravit(
    v_cd.monto_mejoravit_actualizado,
    v_datos,
    v_editor.monto_aprobado
  );
  v_presupuesto := public.infonavit_parse_positive_monto(v_inf->'mejora'->'presupuestoEstimado');
  v_plazo := regexp_replace(btrim(COALESCE(v_datos->>'plazo', '')), '\D', '', 'g')::INTEGER;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'fechaDocumento', to_char(v_fecha, 'YYYY-MM-DD'),
    'localidad', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'localidad']), ''),
    'cliente', jsonb_build_object(
      'nombres', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'nombres']), ''),
      'apellidoPaterno', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'apellidoPaterno']), ''),
      'apellidoMaterno', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'apellidoMaterno']), ''),
      'nss', public.normalize_nss_mexico(v_datos->>'nss'),
      'curp', upper(btrim(COALESCE(v_datos->>'curp', ''))),
      'rfc', upper(btrim(COALESCE(v_datos->>'rfc', ''))),
      'celular', public.cliente_datos_telefono_canonico(COALESCE(v_datos->>'celular', '')),
      'correo', btrim(COALESCE(v_datos->>'correo', '')),
      'telefono', '',
      'ladaTelefono', '',
      'genero', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'genero']), ''),
      'estadoCivil', v_civil,
      'regimenMatrimonial', v_regimen,
      'identificacion', jsonb_build_object(
        'tipo', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'identificacion', 'tipo']), ''),
        'numero', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'identificacion', 'numero']), ''),
        'vigencia', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['titular', 'identificacion', 'vigencia']), '')
      )
    ),
    'empresa', jsonb_build_object(
      'nombre', btrim(COALESCE(v_datos->>'empresa', '')),
      'registroPatronal', btrim(COALESCE(v_datos->>'registroPatronal', '')),
      'telefono', public.cliente_datos_telefono_canonico(COALESCE(v_datos->>'telefonoEmpresa', '')),
      'lada', '',
      'extension', ''
    ),
    'vivienda', jsonb_build_object(
      'calle', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'calle']), ''),
      'noExt', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'numeroExterior']), ''),
      'noInt', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'numeroInterior']), ''),
      'lote', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'lote']), ''),
      'manzana', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'manzana']), ''),
      'colonia', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'colonia']), ''),
      'entidad', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'entidad']), ''),
      'municipio', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'municipio']), ''),
      'cp', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'cp']), ''),
      'tipoPropiedad', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['vivienda', 'tipoPropiedad']), '')
    ),
    'credito', jsonb_build_object(
      'montoSolicitado', v_monto,
      'plazoAnios', v_plazo
    ),
    'referencias', jsonb_build_array(
      jsonb_build_object(
        'nombres', COALESCE(public.infonavit_json_trimmed(v_ref1, VARIADIC ARRAY['nombres']), ''),
        'apellidoPaterno', COALESCE(public.infonavit_json_trimmed(v_ref1, VARIADIC ARRAY['apellidoPaterno']), ''),
        'apellidoMaterno', COALESCE(public.infonavit_json_trimmed(v_ref1, VARIADIC ARRAY['apellidoMaterno']), ''),
        'lada', btrim(COALESCE(v_ref1->>'lada', '')),
        'telefono', btrim(COALESCE(v_ref1->>'telefono', '')),
        'celular', public.cliente_datos_telefono_canonico(COALESCE(v_ref1->>'celular', ''))
      ),
      jsonb_build_object(
        'nombres', COALESCE(public.infonavit_json_trimmed(v_ref2, VARIADIC ARRAY['nombres']), ''),
        'apellidoPaterno', COALESCE(public.infonavit_json_trimmed(v_ref2, VARIADIC ARRAY['apellidoPaterno']), ''),
        'apellidoMaterno', COALESCE(public.infonavit_json_trimmed(v_ref2, VARIADIC ARRAY['apellidoMaterno']), ''),
        'lada', btrim(COALESCE(v_ref2->>'lada', '')),
        'telefono', btrim(COALESCE(v_ref2->>'telefono', '')),
        'celular', public.cliente_datos_telefono_canonico(COALESCE(v_ref2->>'celular', ''))
      )
    ),
    'beneficiario', jsonb_build_object(
      'nombres', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['beneficiario', 'nombres']), ''),
      'apellidoPaterno', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['beneficiario', 'apellidoPaterno']), ''),
      'apellidoMaterno', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['beneficiario', 'apellidoMaterno']), ''),
      'parentesco', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['beneficiario', 'parentesco']), '')
    ),
    'mejora', jsonb_build_object(
      'descripcion', COALESCE(public.infonavit_json_trimmed(v_inf, VARIADIC ARRAY['mejora', 'descripcion']), ''),
      'presupuestoEstimado', v_presupuesto
    )
  );
END;
$$;

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

  PERFORM public.assert_mejoravit_infonavit_datos_persistidos(p_expediente_id);

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
  'P189 B3: inserta snapshot + 3 outbox pending. No-op si no Mejoravit. Sin PII en el return.';

REVOKE ALL ON FUNCTION public.infonavit_pdf_template_sha256(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_template_sha256(TEXT)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.infonavit_json_trimmed(JSONB, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_json_trimmed(JSONB, TEXT[])
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.infonavit_parse_positive_monto(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_parse_positive_monto(JSONB)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.assert_mejoravit_infonavit_datos_persistidos(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_mejoravit_infonavit_datos_persistidos(UUID)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.infonavit_build_submission_payload(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_build_submission_payload(UUID, TIMESTAMPTZ)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.enqueue_infonavit_pdf_submission(UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_infonavit_pdf_submission(UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.p189_infonavit_vault_trimmed(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p189_infonavit_vault_trimmed(TEXT)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.p189_infonavit_activation_at()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p189_infonavit_activation_at()
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.p189_infonavit_feature_enabled()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p189_infonavit_feature_enabled()
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.mejoravit_infonavit_datos_persistidos_diagnostico(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mejoravit_infonavit_datos_persistidos_diagnostico(UUID)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.mejoravit_infonavit_datos_persistidos_completos(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mejoravit_infonavit_datos_persistidos_completos(UUID)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.p189_infonavit_get_eligibility(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p189_infonavit_get_eligibility(UUID)
  TO postgres, service_role;

-- =============================================================================
-- E) Patch enviar_a_mesa (mínimo: FOR UPDATE + gate + hook)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enviar_a_mesa(p_expediente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_editor public.editor_decisions%ROWTYPE;
  v_cliente public.cliente_datos%ROWTYPE;
  v_docs_count INTEGER;
  v_etapa_anterior SMALLINT;
  v_subestado_anterior public.operativo_subestado;
  v_now TIMESTAMPTZ := NOW();
  v_elig JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'enviar_a_mesa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.programa,
    e.nss,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at,
    e.origen_mesa
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'enviar_a_mesa: solo el asesor dueño puede enviar a Mesa'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'enviar_a_mesa: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    RAISE EXCEPTION 'enviar_a_mesa: el expediente ya fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: falta decisión del editor'
      USING ERRCODE = '22023';
  END IF;

  IF v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'enviar_a_mesa: monto aprobado del editor debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cliente
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan datos del cliente'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.porcentaje_cobro IS NULL
     OR v_cliente.porcentaje_cobro <= 0
     OR v_cliente.monto_calculado IS NULL
     OR btrim(COALESCE(v_cliente.metodo_pago, '')) = '' THEN
    RAISE EXCEPTION 'enviar_a_mesa: Faltan datos obligatorios del cliente: porcentaje de cobro, monto calculado, método de pago.'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado NOT IN ('completo', 'validado') THEN
    RAISE EXCEPTION 'enviar_a_mesa: datos del cliente deben estar completos o validados (actual: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  v_elig := public.p189_infonavit_get_eligibility(p_expediente_id);
  IF COALESCE((v_elig->>'required')::boolean, false) THEN
    PERFORM public.assert_mejoravit_infonavit_datos_persistidos(p_expediente_id);
  END IF;

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);

  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan documentos obligatorios de integración (% de %)', v_docs_count, cardinality(public.integration_doc_tipos_asesor_envio())
      USING ERRCODE = '22023';
  END IF;

  IF public.nss_bloqueado_en_mesa(v_exp.organization_id, v_exp.nss, v_exp.programa, p_expediente_id) THEN
    RAISE EXCEPTION 'NSS_YA_BLOQUEADO: Este NSS ya tiene un expediente enviado a Mesa.'
      USING ERRCODE = '23505';
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;

  UPDATE public.expedientes
  SET
    submitted_to_mesa = true,
    fecha_envio_mesa = v_now,
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    updated_at = v_now
  WHERE id = p_expediente_id;

  IF COALESCE((v_elig->>'should_enqueue')::boolean, false) THEN
    PERFORM public.enqueue_infonavit_pdf_submission(
      p_expediente_id,
      v_exp.organization_id,
      0,
      'initial',
      v_now
    );
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.enviar_a_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'asesor_id', v_exp.asesor_id,
      'organization_id', v_exp.organization_id,
      'etapa_anterior', v_etapa_anterior,
      'etapa_nueva', 1,
      'subestado_anterior', v_subestado_anterior,
      'subestado_nuevo', 'en_validacion_mesa',
      'documentos_obligatorios_count', v_docs_count,
      'documentos_asesor_envio_count', v_docs_count,
      'editor_decision_id', v_editor.expediente_id,
      'origen_mesa', v_exp.origen_mesa
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'etapa_actual', 1,
    'subestado', 'en_validacion_mesa',
    'operativo_subestado', 'en_validacion_mesa',
    'submitted_to_mesa', true,
    'enviado_a_mesa', true,
    'documentos_obligatorios_count', v_docs_count
  );
END;
$$;

-- =============================================================================
-- F) Patch asesor_enviar_reingreso_a_mesa (152 + hook P189)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_enviar_reingreso_a_mesa(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp public.expedientes%ROWTYPE;
  v_editor public.editor_decisions%ROWTYPE;
  v_cliente public.cliente_datos%ROWTYPE;
  v_etapa_anterior SMALLINT;
  v_subestado_anterior public.operativo_subestado;
  v_count INTEGER;
  v_era_primer_envio BOOLEAN;
  v_docs_count INTEGER;
  v_now TIMESTAMPTZ := NOW();
  v_elig JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: solo el asesor dueño puede reingresar a Mesa'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado = 'cancelado' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: el expediente está cancelado y no se puede reingresar'
      USING ERRCODE = '22023';
  END IF;

  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND OR v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTA_MONTO: falta monto aprobado del editor'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cliente
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: faltan Datos Generales del cliente'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado NOT IN ('completo', 'validado') THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: datos del cliente incompletos (estado: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.porcentaje_cobro IS NULL
     OR v_cliente.porcentaje_cobro <= 0
     OR v_cliente.monto_calculado IS NULL
     OR btrim(COALESCE(v_cliente.metodo_pago, '')) = '' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: porcentaje de cobro, monto calculado o método de pago'
      USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(v_exp.direccion_opcional, '')), '') IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: Domicilio real del cliente'
      USING ERRCODE = '22023';
  END IF;

  v_elig := public.p189_infonavit_get_eligibility(p_expediente_id);
  IF COALESCE((v_elig->>'required')::boolean, false) THEN
    PERFORM public.assert_mejoravit_infonavit_datos_persistidos(p_expediente_id);
  END IF;

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);
  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DOCS: faltan documentos obligatorios (% de %)',
      v_docs_count, cardinality(public.integration_doc_tipos_asesor_envio())
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.reingreso_manual_at IS NOT NULL
     AND v_exp.reingreso_manual_by IS NOT DISTINCT FROM v_actor_id
     AND v_exp.reingreso_manual_at > (v_now - INTERVAL '5 seconds') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent', true,
      'expediente_id', v_exp.id,
      'precalificacion_id', v_exp.id,
      'reingreso_manual_count', v_exp.reingreso_manual_count,
      'reingreso_manual_at', v_exp.reingreso_manual_at,
      'reingreso_manual_by', v_exp.reingreso_manual_by,
      'etapa_actual', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'submitted_to_mesa', true,
      'fecha_envio_mesa', v_exp.fecha_envio_mesa,
      'era_primer_envio', false
    );
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;
  v_count := COALESCE(v_exp.reingreso_manual_count, 0) + 1;
  v_era_primer_envio := (v_exp.submitted_to_mesa IS NOT TRUE)
    OR (v_exp.fecha_envio_mesa IS NULL);

  UPDATE public.expedientes
  SET
    submitted_to_mesa = true,
    fecha_envio_mesa = v_now,
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    reingreso_manual_count = v_count,
    reingreso_manual_at = v_now,
    reingreso_manual_by = v_actor_id,
    updated_at = v_now
  WHERE id = p_expediente_id
    AND reingreso_manual_count = v_exp.reingreso_manual_count;

  IF NOT FOUND THEN
    SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent', true,
      'expediente_id', v_exp.id,
      'precalificacion_id', v_exp.id,
      'reingreso_manual_count', v_exp.reingreso_manual_count,
      'reingreso_manual_at', v_exp.reingreso_manual_at,
      'reingreso_manual_by', v_exp.reingreso_manual_by,
      'etapa_actual', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'submitted_to_mesa', true,
      'fecha_envio_mesa', v_exp.fecha_envio_mesa,
      'era_primer_envio', false
    );
  END IF;

  IF COALESCE((v_elig->>'should_enqueue')::boolean, false) THEN
    PERFORM public.enqueue_infonavit_pdf_submission(
      p_expediente_id,
      v_exp.organization_id,
      v_count,
      'reingreso',
      v_now
    );
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente_reingreso_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'precalificacion_id', p_expediente_id,
      'asesor_id', v_exp.asesor_id,
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'etapa_anterior', v_etapa_anterior,
      'subestado_anterior', v_subestado_anterior,
      'etapa_final', 1,
      'subestado_final', 'en_validacion_mesa',
      'numero_reingreso', v_count,
      'fecha', v_now,
      'reingreso_manual_count', v_count,
      'era_primer_envio', v_era_primer_envio
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'idempotent', false,
    'expediente_id', p_expediente_id,
    'precalificacion_id', p_expediente_id,
    'reingreso_manual_count', v_count,
    'reingreso_manual_at', v_now,
    'reingreso_manual_by', v_actor_id,
    'etapa_anterior', v_etapa_anterior,
    'subestado_anterior', v_subestado_anterior,
    'etapa_actual', 1,
    'subestado', 'en_validacion_mesa',
    'submitted_to_mesa', true,
    'fecha_envio_mesa', v_now,
    'era_primer_envio', v_era_primer_envio
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enviar_a_mesa(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enviar_a_mesa(UUID)
  TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID)
  TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.enviar_a_mesa(UUID) IS
  'P189 B7: envío Mesa. Snapshot/outbox Mejoravit solo si should_enqueue (flag ON + v1 completo). required=nuevos post-activation. DEFAULT OFF. Sin PDF.';

COMMENT ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID) IS
  'Reingreso 152 + P189 B7. Legacy/flag OFF: 0 assert/enqueue. changed=false: 0 filas P189. Idempotencia 5s intacta.';

-- =============================================================================
-- G) P189 B7: status RPC para frontend (sin Vault values / sin PII)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_p189_infonavit_feature_status(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_elig JSONB;
BEGIN
  IF public.current_profile_id() IS NULL THEN
    RAISE EXCEPTION 'get_p189_infonavit_feature_status: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL OR NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'get_p189_infonavit_feature_status: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  v_elig := public.p189_infonavit_get_eligibility(p_expediente_id);

  RETURN jsonb_build_object(
    'aplica', COALESCE((v_elig->>'aplica_mejoravit')::boolean, false),
    'feature_active', COALESCE((v_elig->>'feature_active')::boolean, false),
    'legacy', COALESCE((v_elig->>'legacy')::boolean, false),
    'required', COALESCE((v_elig->>'required')::boolean, false),
    'has_complete_v1', COALESCE((v_elig->>'has_complete_v1')::boolean, false)
  );
END;
$$;

COMMENT ON FUNCTION public.get_p189_infonavit_feature_status(UUID) IS
  'P189 B7: status UI. Sin activation_at, Vault names/values, snapshot ni PII. SQL es autoridad del envío.';

REVOKE ALL ON FUNCTION public.get_p189_infonavit_feature_status(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_p189_infonavit_feature_status(UUID)
  TO authenticated, service_role, postgres;
