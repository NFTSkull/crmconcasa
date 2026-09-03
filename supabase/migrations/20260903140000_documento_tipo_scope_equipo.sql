-- ConCasa CRM — Documentos opcionales asesor scoped por equipo (líder email)
-- Tipos: cliente_solicitud_credito, cliente_lista_nominal, cliente_bajo_protesta, cliente_presupuesto
-- Distintos de Mesa cliente_solicitud e Infonavit infonavit_*.
-- SQL es autoridad; FE catalogo espejo. SIN UI en este bloque.
-- Candado: register + register_correccion + storage asesor upload/post_mesa/correccion.
-- P208 helpers de expediente intactos. Cardinalidad opc 13 / upload 17.

CREATE TABLE IF NOT EXISTS public.documento_tipo_scope_equipo (
  tipo_documento TEXT PRIMARY KEY,
  leader_email TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT documento_tipo_scope_equipo_email_chk CHECK (btrim(leader_email) <> '')
);

COMMENT ON TABLE public.documento_tipo_scope_equipo IS
  'Política: tipo documental asesor restringido al equipo activo cuyo líder tiene este email. Sin UUID de equipo.';

ALTER TABLE public.documento_tipo_scope_equipo ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.documento_tipo_scope_equipo FROM PUBLIC;
GRANT SELECT ON TABLE public.documento_tipo_scope_equipo TO authenticated, service_role;

INSERT INTO public.documento_tipo_scope_equipo (tipo_documento, leader_email, active)
VALUES
  ('cliente_solicitud_credito', 'silvia.reyes@concasa.mx', true),
  ('cliente_lista_nominal', 'silvia.reyes@concasa.mx', true),
  ('cliente_bajo_protesta', 'silvia.reyes@concasa.mx', true),
  ('cliente_presupuesto', 'silvia.reyes@concasa.mx', true)
ON CONFLICT (tipo_documento) DO UPDATE
SET leader_email = EXCLUDED.leader_email,
    active = EXCLUDED.active;

CREATE OR REPLACE FUNCTION public.asesor_puede_usar_tipo_documento(
  p_actor_id uuid,
  p_tipo_documento text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo TEXT;
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

  SELECT lower(btrim(s.leader_email))
  INTO v_leader_email
  FROM public.documento_tipo_scope_equipo s
  WHERE lower(btrim(s.tipo_documento)) = v_tipo
    AND s.active = true;

  IF NOT FOUND THEN
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
  IF v_n <> 1 THEN
    RAISE WARNING 'asesor_puede_usar_tipo_documento: fail-closed tipo=% leader_email=% team_count=% actor=% org=% (equipo ausente, inactivo, email de líder distinto, o más de un equipo activo)',
      v_tipo, v_leader_email, v_n, p_actor_id, v_actor_org;
    RETURN false;
  END IF;

  v_team_id := v_team_ids[1];
  RETURN public.asesor_pertenece_equipo_activo(v_team_id, p_actor_id);
END;
$$;

COMMENT ON FUNCTION public.asesor_puede_usar_tipo_documento(uuid, text) IS
  'Tipos sin fila en documento_tipo_scope_equipo: true. Tipos scoped: membresía del único equipo activo del líder (email). 0 o >1 equipos → WARNING + false.';

REVOKE ALL ON FUNCTION public.asesor_puede_usar_tipo_documento(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_puede_usar_tipo_documento(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_opcionales()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_semanas_cotizadas',
    'cliente_carta_empresa',
    'cliente_acta_nacimiento_digital',
    'cliente_notificacion_apodaca',
    'cliente_notificacion',
    'asesor_evidencia',
    'cliente_constancia_curp',
    'cliente_vigencia_derechos',
    'cliente_constancia_situacion_fiscal',
    'cliente_solicitud_credito',
    'cliente_lista_nominal',
    'cliente_bajo_protesta',
    'cliente_presupuesto'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.integration_doc_tipos_asesor_envio()
      || public.integration_doc_tipos_asesor_opcionales();
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_opcionales() IS
  'Allowlist opcionales asesor; + 4 scoped equipo (solicitud crédito, lista nominal, bajo protesta, presupuesto). Scope extra vía asesor_puede_usar_tipo_documento.';

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload() IS
  'Tipos permitidos upload/register asesor (4 oblig + opcionales incl. scoped equipo).';

CREATE OR REPLACE FUNCTION public.register_expediente_documento(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $reg_doc$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');

  IF NOT (
    v_tipo = ANY(public.integration_doc_tipos_asesor_upload())
    AND public.es_reingreso_asesor_edicion_activa(p_expediente_id)
  ) THEN
    RETURN public.register_expediente_documento_pre_reingreso(
      p_expediente_id, p_tipo_documento, p_storage_path,
      p_nombre_original, p_mime_type, p_size_bytes
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF v_actor_id IS NULL OR NOT FOUND
     OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR (NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id))
     OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id
     OR v_exp.deleted_at IS NOT NULL
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: solo el asesor dueño puede cargar documentos'
      USING ERRCODE = '42501';
  END IF;


  IF NOT public.asesor_puede_usar_tipo_documento(v_actor_id, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento no permitido para este asesor (%)', v_tipo
      USING ERRCODE = '42501';
  END IF;


  IF NOT public.es_reingreso_asesor_edicion_activa(p_expediente_id) THEN
    RAISE EXCEPTION 'register_expediente_documento: reingreso no válido para este documento'
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = ''
     OR p_nombre_original IS NULL OR btrim(p_nombre_original) = ''
     OR p_size_bytes IS NULL OR p_size_bytes <= 0
     OR p_size_bytes > public.expediente_documento_max_size_bytes()
     OR NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo)
     OR NOT public.expediente_documento_storage_path_valid(
       btrim(p_storage_path), v_exp.organization_id, p_expediente_id, v_tipo
     ) THEN
    RAISE EXCEPTION 'register_expediente_documento: metadata o path inválido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_exp.organization_id, p_expediente_id, v_tipo, btrim(p_storage_path),
    btrim(p_nombre_original), lower(btrim(p_mime_type)), p_size_bytes, v_new_version,
    v_new_estatus, v_actor_id, 'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'expediente.documento.register',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', lower(btrim(p_mime_type)),
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL,
      'reingreso_docs_update', true,
      'reingreso_edicion_completa', true
    )
  );

  IF v_prev_id IS NOT NULL THEN
    PERFORM public.asesor_cambio_record_doc_reemplazo(
      v_exp.organization_id,
      p_expediente_id,
      v_actor_id,
      v_tipo,
      v_prev_id,
      v_new_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'reemplazo', v_prev_id IS NOT NULL,
    'integration_docs_presentes', public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos', public.integration_docs_completos(p_expediente_id)
  );
END;
$reg_doc$;



-- from 20260831205958_asesor_equipo_lider_capabilities.sql

CREATE OR REPLACE FUNCTION public.register_expediente_documento_pre_reingreso(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $reg_pre$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento no permitido para upload asesor (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;


  IF NOT public.asesor_puede_usar_tipo_documento(v_actor_id, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento no permitido para este asesor (%)', v_tipo
      USING ERRCODE = '42501';
  END IF;


  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'register_expediente_documento: solo el asesor dueño puede registrar documentos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    IF EXISTS (
      SELECT 1
      FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.tipo_documento = v_tipo
        AND d.deleted_at IS NULL
    ) THEN
      NULL;
    ELSIF v_tipo = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'register_expediente_documento: el expediente ya fue enviado a Mesa'
        USING ERRCODE = '22023';
    END IF;
  END IF;


  -- P132: Notificación canónica (`cliente_notificacion`) solo desde etapa 7+.
  -- `cliente_notificacion_apodaca` («Notificación» compartida) no tiene gate de etapa.
  IF v_tipo = 'cliente_notificacion'
     AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_expediente_documento: El documento Notificación solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    uploaded_by,
    uploaded_by_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_tipo,
    btrim(p_storage_path),
    btrim(p_nombre_original),
    lower(btrim(p_mime_type)),
    p_size_bytes,
    v_new_version,
    v_new_estatus,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.register',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', lower(btrim(p_mime_type)),
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL
    )
  );


  -- P130: reemplazo post-Mesa vía register_expediente_documento (sin rechazo previo)
  IF v_prev_id IS NOT NULL
     AND v_exp.submitted_to_mesa IS TRUE THEN
    PERFORM public.asesor_cambio_record_doc_reemplazo(
      v_exp.organization_id,
      p_expediente_id,
      v_actor_id,
      v_tipo,
      v_prev_id,
      v_new_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'integration_docs_presentes', public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos', public.integration_docs_completos(p_expediente_id)
  );
END;
$reg_pre$;




CREATE OR REPLACE FUNCTION public.register_expediente_documento_correccion(
  p_expediente_id UUID,
  p_tipo_documento TEXT,
  p_storage_path TEXT,
  p_nombre_original TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
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
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: tipo_documento no permitido (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;


  IF NOT public.asesor_puede_usar_tipo_documento(v_actor_id, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: tipo_documento no permitido para este asesor (%)', v_tipo
      USING ERRCODE = '42501';
  END IF;


  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: solo el asesor dueño puede corregir documentos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_prev_estatus IS DISTINCT FROM 'rechazado' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: solo se puede corregir un documento rechazado por Mesa'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.expediente_documentos
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE id = v_prev_id;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    comentario_mesa,
    uploaded_by,
    uploaded_by_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_tipo,
    btrim(p_storage_path),
    btrim(p_nombre_original),
    lower(btrim(p_mime_type)),
    p_size_bytes,
    v_new_version,
    'resubido',
    NULL,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.asesor_correccion',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', lower(btrim(p_mime_type)),
      'size_bytes', p_size_bytes,
      'estatus_revision', 'resubido',
      'documento_rechazado_id', v_prev_id
    )
  );

  -- P130: acumular/congelar lote de cambios del asesor (original → final)
  PERFORM public.asesor_cambio_record_doc_reemplazo(
    v_exp.organization_id,
    p_expediente_id,
    v_actor_id,
    v_tipo,
    v_prev_id,
    v_new_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', 'resubido',
    'storage_path', btrim(p_storage_path)
  );
END;
$$;



-- from 211_vigencia_documental_tramo_3_8.sql


CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_upload_allowed(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
BEGIN
  SELECT *
  INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RETURN false;
  END IF;

  IF NOT public.asesor_puede_usar_tipo_documento(v_actor_id, v_parsed.tipo_documento) THEN
    RETURN false;
  END IF;

  IF v_actor_org IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id) THEN
    RETURN false;
  END IF;

  IF v_exp.ciclo_estado <> 'activo' OR v_exp.submitted_to_mesa = true THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;



-- from 150_reingreso_edicion_completa_asesor.sql

CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
BEGIN
  SELECT * INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL
     OR NOT (v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR v_actor.organization_id IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
  END IF;


  IF NOT public.asesor_puede_usar_tipo_documento(v_actor_id, v_parsed.tipo_documento) THEN
    RETURN false;
  END IF;


  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL
     OR NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id)
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.expediente_documentos d
    WHERE d.expediente_id = v_exp.id
      AND d.tipo_documento = v_parsed.tipo_documento
      AND d.deleted_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  IF v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
    RETURN true;
  END IF;

  RETURN public.es_reingreso_asesor_edicion_activa(v_exp.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_correccion_allowed(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
BEGIN
  SELECT *
  INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RETURN false;
  END IF;

  IF NOT public.asesor_puede_usar_tipo_documento(v_actor_id, v_parsed.tipo_documento) THEN
    RETURN false;
  END IF;

  IF v_actor_org IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id) THEN
    RETURN false;
  END IF;

  IF v_exp.ciclo_estado <> 'activo' OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = v_parsed.expediente_id
      AND d.tipo_documento = v_parsed.tipo_documento
      AND d.deleted_at IS NULL
      AND d.estatus_revision = 'rechazado'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expediente_documento_storage_asesor_upload_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expediente_documento_storage_asesor_upload_allowed(TEXT)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(TEXT)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.expediente_documento_storage_asesor_correccion_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expediente_documento_storage_asesor_correccion_allowed(TEXT)
  TO authenticated, service_role;
