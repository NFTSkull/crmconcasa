-- ConCasa CRM — Anette: Solicitud de inscripción + Validación INE 60% opcionales.
-- Scope exacto: anette.perez@concasa.mx.
-- NO modifica documentos obligatorios de envío, expedientes ni datos existentes.

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload_para(p_asesor_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_base TEXT[];
  v_is_anette BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_asesor_id
      AND p.active = true
      AND p.app_role = 'asesor'
      AND lower(btrim(p.email)) = 'anette.perez@concasa.mx'
  ) INTO v_is_anette;

  IF public.asesor_paquete_documental_externos(p_asesor_id) THEN
    v_base := public.integration_doc_tipos_asesor_envio_para(p_asesor_id) || ARRAY[
      'cliente_acta_nacimiento_digital',
      'cliente_constancia_situacion_fiscal',
      'cliente_semanas_cotizadas',
      'cliente_vigencia_derechos'
    ]::TEXT[];
  ELSE
    v_base := public.integration_doc_tipos_asesor_upload();
  END IF;

  IF v_is_anette THEN
    IF NOT ('cliente_solicitud_inscripcion' = ANY(v_base)) THEN
      v_base := array_append(v_base, 'cliente_solicitud_inscripcion');
    END IF;
    IF NOT ('cliente_validacion_ine_60' = ANY(v_base)) THEN
      v_base := array_append(v_base, 'cliente_validacion_ine_60');
    END IF;
  END IF;

  RETURN v_base;
END;
$function$;

CREATE OR REPLACE FUNCTION public.asesor_puede_usar_tipo_documento(p_actor_id uuid, p_tipo_documento text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo TEXT;
  v_leader_emails TEXT[];
  v_leader_email TEXT;
  v_actor_org UUID;
  v_team_ids UUID[];
  v_n INTEGER;
  v_team_id UUID;
BEGIN
  v_tipo := NULLIF(lower(btrim(COALESCE(p_tipo_documento, ''))), '');
  IF p_actor_id IS NULL OR v_tipo IS NULL THEN
    RETURN false;
  END IF;

  IF v_tipo IN ('cliente_solicitud_inscripcion', 'cliente_validacion_ine_60') THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = p_actor_id
        AND p.active = true
        AND p.app_role = 'asesor'
        AND lower(btrim(p.email)) = 'anette.perez@concasa.mx'
    );
  END IF;

  SELECT coalesce(
    array_agg(DISTINCT lower(btrim(s.leader_email)) ORDER BY lower(btrim(s.leader_email))),
    ARRAY[]::TEXT[]
  )
  INTO v_leader_emails
  FROM public.documento_tipo_scope_equipo s
  WHERE lower(btrim(s.tipo_documento)) = v_tipo
    AND s.active = true;

  IF coalesce(cardinality(v_leader_emails), 0) = 0 THEN
    RETURN true;
  END IF;

  SELECT p.organization_id
  INTO v_actor_org
  FROM public.profiles p
  WHERE p.id = p_actor_id
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND OR v_actor_org IS NULL THEN
    RETURN false;
  END IF;

  FOREACH v_leader_email IN ARRAY v_leader_emails
  LOOP
    SELECT coalesce(array_agg(t.id), ARRAY[]::uuid[])
    INTO v_team_ids
    FROM public.asesor_equipos t
    INNER JOIN public.profiles lider
      ON lider.id = t.leader_id
     AND lider.active = true
     AND lider.app_role = 'asesor'
    WHERE t.active = true
      AND t.organization_id = v_actor_org
      AND lower(btrim(lider.email)) = v_leader_email;

    v_n := coalesce(cardinality(v_team_ids), 0);
    IF v_n = 1 THEN
      v_team_id := v_team_ids[1];
      IF public.asesor_pertenece_equipo_activo(v_team_id, p_actor_id) THEN
        RETURN true;
      END IF;
    ELSIF v_n <> 0 THEN
      RAISE WARNING 'asesor_puede_usar_tipo_documento: fail-closed tipo=% leader_email=% team_count=% actor=% org=% (más de un equipo activo para ese líder)',
        v_tipo, v_leader_email, v_n, p_actor_id, v_actor_org;
    END IF;
  END LOOP;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.asesor_tipos_documento_visibles()
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_tipos TEXT[] := ARRAY[]::TEXT[];
  v_tipo TEXT;
  v_is_anette BOOLEAN := FALSE;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  SELECT lower(btrim(p.email)) = 'anette.perez@concasa.mx'
  INTO v_is_anette
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  FOR v_tipo IN
    SELECT DISTINCT s.tipo_documento
    FROM public.documento_tipo_scope_equipo s
    WHERE s.active = true
    ORDER BY 1
  LOOP
    IF public.asesor_puede_usar_tipo_documento(v_actor_id, v_tipo) THEN
      v_tipos := array_append(v_tipos, v_tipo);
    END IF;
  END LOOP;

  IF v_is_anette THEN
    v_tipos := array_append(v_tipos, 'cliente_solicitud_inscripcion');
    v_tipos := array_append(v_tipos, 'cliente_validacion_ine_60');
  END IF;

  RETURN v_tipos;
END;
$function$;

DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
  v_count integer;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'register_expediente_documento_pre_reingreso'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'anette_optional_docs: register_expediente_documento_pre_reingreso signature not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_old := E'    ELSIF v_tipo = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN\n      NULL;\n    ELSE';
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'anette_optional_docs: post-Mesa optional marker count %, expected 1', v_count;
  END IF;

  v_new := E'    ELSIF v_tipo = ANY(public.integration_doc_tipos_asesor_opcionales())\n       OR (\n         v_tipo IN (''cliente_solicitud_inscripcion'', ''cliente_validacion_ine_60'')\n         AND EXISTS (\n           SELECT 1 FROM public.profiles p\n           WHERE p.id = v_actor_id\n             AND p.active = true\n             AND p.app_role = ''asesor''\n             AND lower(btrim(p.email)) = ''anette.perez@concasa.mx''\n         )\n       ) THEN\n      NULL;\n    ELSE';

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$do$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) IS
  'Allowlist upload asesor; Anette añade Solicitud de inscripción + Validación INE 60% como opcionales exclusivos.';
COMMENT ON FUNCTION public.asesor_tipos_documento_visibles() IS
  'UI scoped: equipo + dos opcionales exclusivos de Anette (Solicitud inscripción / Validación INE 60%).';
