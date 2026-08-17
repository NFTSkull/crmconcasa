-- ConCasa CRM — P189 B5: read model UI Documentos INFONAVIT (LOCAL)
-- RPC get_expediente_infonavit_pdf_estado. NO muta 183–186.
-- NO expone snapshot payload / PII / outbox interno / secrets.
-- NO amplia Storage policies (SELECT existente via can_see_expediente).
-- Editor y roles no listados: DENIED aunque can_see_expediente sea true.

CREATE OR REPLACE FUNCTION public.infonavit_pdf_auto_document_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'infonavit_carta_bajo_protesta',
    'infonavit_presupuesto_mejoramiento',
    'infonavit_solicitud_inscripcion'
  ]::TEXT[];
$$;

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

  IF v_role = 'asesor' THEN
    RETURN public.can_see_expediente(p_expediente_id);
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_documento_meta(p_documento_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta JSONB;
BEGIN
  IF p_documento_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', d.id,
    'tipo_documento', d.tipo_documento,
    'nombre_original', d.nombre_original,
    'mime_type', d.mime_type,
    'size_bytes', d.size_bytes,
    'version', d.version,
    'created_at', d.created_at
  )
  INTO v_meta
  FROM public.expediente_documentos d
  WHERE d.id = p_documento_id
    AND d.deleted_at IS NULL;

  RETURN v_meta;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_expediente_infonavit_pdf_estado(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prog public.programa;
  v_ver INTEGER;
  v_kind TEXT;
  v_tipo TEXT;
  v_status TEXT;
  v_doc_id UUID;
  v_prev_id UUID;
  v_latest JSONB;
  v_prev JSONB;
  v_docs JSONB := '[]'::JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.infonavit_pdf_read_allowed(p_expediente_id) THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT e.programa
    INTO v_prog
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_prog IS DISTINCT FROM 'mejoravit' THEN
    RETURN jsonb_build_object(
      'aplica', false,
      'has_submission', false,
      'submission_version', NULL,
      'submission_kind', NULL,
      'documents', '[]'::JSONB
    );
  END IF;

  SELECT s.submission_version, s.submission_kind
    INTO v_ver, v_kind
  FROM public.expediente_infonavit_submission_snapshots s
  WHERE s.expediente_id = p_expediente_id
  ORDER BY s.submission_version DESC
  LIMIT 1;

  IF v_ver IS NULL THEN
    RETURN jsonb_build_object(
      'aplica', true,
      'has_submission', false,
      'submission_version', NULL,
      'submission_kind', NULL,
      'documents', '[]'::JSONB
    );
  END IF;

  FOREACH v_tipo IN ARRAY public.infonavit_pdf_auto_document_types()
  LOOP
    v_status := NULL;
    v_doc_id := NULL;
    v_prev_id := NULL;
    v_latest := NULL;
    v_prev := NULL;

    SELECT o.status, o.documento_id
      INTO v_status, v_doc_id
    FROM public.infonavit_pdf_outbox o
    WHERE o.expediente_id = p_expediente_id
      AND o.document_type = v_tipo
      AND o.submission_version = v_ver
    LIMIT 1;

    IF v_status IS NULL THEN
      v_status := 'pending';
    END IF;

    IF v_status = 'done' THEN
      v_latest := public.infonavit_pdf_documento_meta(v_doc_id);
    ELSIF v_status IN ('pending', 'processing', 'failed') THEN
      SELECT o.documento_id
        INTO v_prev_id
      FROM public.infonavit_pdf_outbox o
      WHERE o.expediente_id = p_expediente_id
        AND o.document_type = v_tipo
        AND o.status = 'done'
        AND o.submission_version < v_ver
        AND o.documento_id IS NOT NULL
      ORDER BY o.submission_version DESC
      LIMIT 1;
      v_prev := public.infonavit_pdf_documento_meta(v_prev_id);
    END IF;

    v_docs := v_docs || jsonb_build_array(
      jsonb_build_object(
        'document_type', v_tipo,
        'status', v_status,
        'latest_document', v_latest,
        'previous_document', v_prev
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'aplica', true,
    'has_submission', true,
    'submission_version', v_ver,
    'submission_kind', v_kind,
    'documents', v_docs
  );
END;
$$;

COMMENT ON FUNCTION public.get_expediente_infonavit_pdf_estado(UUID) IS
  'P189 B5: estado UI de PDFs auto. Sin payload/PII. Mesa visible o asesor dueño. Editor denied.';

REVOKE ALL ON FUNCTION public.infonavit_pdf_auto_document_types() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_read_allowed(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_documento_meta(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_expediente_infonavit_pdf_estado(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.infonavit_pdf_auto_document_types() TO postgres;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_read_allowed(UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_documento_meta(UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_expediente_infonavit_pdf_estado(UUID) TO postgres, authenticated;
