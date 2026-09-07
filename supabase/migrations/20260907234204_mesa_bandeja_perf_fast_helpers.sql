-- ConCasa CRM — Mesa read-model performance helpers.
-- Read-only DDL: 0 UPDATE / 0 DELETE / 0 business INSERT / 0 backfill.

CREATE OR REPLACE FUNCTION public.mesa_bandeja_categoria_resumen_fast(
  p_expediente_id uuid,
  p_fecha_envio_mesa timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_cd_estado text;
  v_cd_updated timestamptz;
  v_cd_validated timestamptz;
  v_ine text;
  v_ec text;
  v_nss text;
  v_dir text;
  v_doc text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.expediente_asesor_cambio_lotes l
    WHERE l.expediente_id = p_expediente_id
      AND l.status = 'pendiente_revision'
      AND l.submitted_at IS NOT NULL
  ) THEN
    RETURN 'correccion_enviada';
  END IF;

  SELECT cd.estado::text, cd.updated_at, cd.validated_at
  INTO v_cd_estado, v_cd_updated, v_cd_validated
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id
  LIMIT 1;

  IF v_cd_estado = 'rechazado' THEN
    RETURN 'correccion_requerida';
  END IF;

  SELECT
    max(d.estatus_revision::text) FILTER (WHERE d.tipo_documento::text = 'ine'),
    max(d.estatus_revision::text) FILTER (WHERE d.tipo_documento::text = 'estado_cuenta'),
    max(d.estatus_revision::text) FILTER (WHERE d.tipo_documento::text = 'nss'),
    max(d.estatus_revision::text) FILTER (WHERE d.tipo_documento::text = 'direccion')
  INTO v_ine, v_ec, v_nss, v_dir
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.deleted_at IS NULL
    AND d.tipo_documento::text IN ('ine', 'estado_cuenta', 'nss', 'direccion');

  IF v_ine IS NULL OR v_ec IS NULL OR v_nss IS NULL OR v_dir IS NULL
     OR v_ine = 'faltante' OR v_ec = 'faltante' OR v_nss = 'faltante' OR v_dir = 'faltante' THEN
    v_doc := 'faltantes';
  ELSIF v_ine = 'rechazado' OR v_ec = 'rechazado' OR v_nss = 'rechazado' OR v_dir = 'rechazado' THEN
    v_doc := 'correccion_requerida';
  ELSIF v_ine = 'resubido' OR v_ec = 'resubido' OR v_nss = 'resubido' OR v_dir = 'resubido' THEN
    v_doc := 'correccion_enviada';
  ELSIF v_ine = 'subido' OR v_ec = 'subido' OR v_nss = 'subido' OR v_dir = 'subido' THEN
    v_doc := 'pendiente_revision_documental';
  ELSIF v_ine = 'validado' AND v_ec = 'validado' AND v_nss = 'validado' AND v_dir = 'validado' THEN
    v_doc := 'documentos_validados';
  ELSE
    v_doc := 'pendiente_revision_documental';
  END IF;

  IF v_doc IN ('correccion_requerida', 'correccion_enviada') THEN
    RETURN v_doc;
  END IF;

  IF v_cd_estado = 'completo'
     AND v_cd_validated IS NULL
     AND v_cd_updated IS NOT NULL
     AND p_fecha_envio_mesa IS NOT NULL
     AND v_cd_updated > p_fecha_envio_mesa THEN
    RETURN 'correccion_enviada';
  END IF;

  RETURN v_doc;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mesa_cambio_revision_estado_bandeja_fast(
  p_expediente_id uuid
)
RETURNS TABLE(
  estado text,
  origin text,
  request_type text,
  request_at timestamptz,
  batch_id uuid,
  batch_submitted_at timestamptz,
  actionable_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_latest record;
  v_envio timestamptz;
  v_has_pending boolean := false;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN;
  END IF;

  SELECT e.fecha_envio_mesa
  INTO v_envio
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT t.latest_request_at, t.latest_request_type, t.latest_response_at, t.latest_batch_id
  INTO v_latest
  FROM public.mesa_cambio_episodio_latest(p_expediente_id) t
  LIMIT 1;

  IF v_latest.latest_request_at IS NOT NULL
     AND (
       v_latest.latest_response_at IS NULL
       OR v_latest.latest_request_at > v_latest.latest_response_at
     )
  THEN
    estado := 'WAITING_ADVISOR';
    origin := NULL;
    request_type := v_latest.latest_request_type;
    request_at := v_latest.latest_request_at;
    batch_id := NULL;
    batch_submitted_at := v_latest.latest_response_at;
    actionable_at := v_latest.latest_request_at;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.expediente_asesor_cambio_lotes l
    WHERE l.expediente_id = p_expediente_id
      AND l.status = 'pendiente_revision'
      AND l.submitted_at IS NOT NULL
      AND (v_envio IS NULL OR l.submitted_at >= v_envio)
  )
  INTO v_has_pending;

  IF v_has_pending THEN
    RETURN QUERY
    SELECT s.estado, s.origin, s.request_type, s.request_at,
           s.batch_id, s.batch_submitted_at, s.actionable_at
    FROM public.mesa_cambio_revision_estado_efectivo(p_expediente_id) s
    LIMIT 1;
    RETURN;
  END IF;

  estado := 'CLOSED';
  origin := NULL;
  request_type := v_latest.latest_request_type;
  request_at := v_latest.latest_request_at;
  batch_id := NULL;
  batch_submitted_at := v_latest.latest_response_at;
  actionable_at := NULL;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.mesa_bandeja_categoria_resumen_fast(uuid, timestamptz) IS
  'Mesa perf helper: misma categoria que mesa_bandeja_categoria_resumen, una sola lectura agregada de docs.';
COMMENT ON FUNCTION public.mesa_cambio_revision_estado_bandeja_fast(uuid) IS
  'Mesa perf helper: fast path latest episode; delega P198/P202 canonical cuando existe lote pendiente del ciclo.';

REVOKE ALL ON FUNCTION public.mesa_bandeja_categoria_resumen_fast(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mesa_cambio_revision_estado_bandeja_fast(uuid) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mesa_bandeja_counts_fast'
    AND pg_get_function_identity_arguments(p.oid) = 'p_today_ymd text, p_origen text';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mesa_bandeja_counts_fast signature not found';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  v_def := replace(v_def,
    'public.mesa_bandeja_categoria_resumen(',
    'public.mesa_bandeja_categoria_resumen_fast('
  );
  v_def := replace(v_def,
    'public.mesa_cambio_revision_estado_efectivo(',
    'public.mesa_cambio_revision_estado_bandeja_fast('
  );
  EXECUTE v_def;

  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mesa_list_bandeja_page'
    AND pg_get_function_identity_arguments(p.oid) = 'p_limit integer, p_cursor_sort_ts timestamp with time zone, p_cursor_id uuid, p_quick_filter text, p_ops_filter text, p_buscar text, p_etapa integer, p_subestado text, p_solo_citas_hoy boolean, p_today_ymd text, p_rechazos_sub text, p_origen text, p_include_counts boolean';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mesa_list_bandeja_page signature not found';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  v_def := replace(v_def,
    'public.mesa_bandeja_categoria_resumen(',
    'public.mesa_bandeja_categoria_resumen_fast('
  );
  v_def := replace(v_def,
    'public.mesa_cambio_revision_estado_efectivo(',
    'public.mesa_cambio_revision_estado_bandeja_fast('
  );
  EXECUTE v_def;
END;
$do$;
