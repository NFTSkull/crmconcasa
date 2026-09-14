-- ConCasa CRM — Equipo Silvia: paquete documental nuevo + Datos Generales completos
--
-- Alcance quirúrgico:
-- - Silvia Reyes + miembros ACTIVOS de su equipo activo.
-- - NO toca Anette (su rama sigue primero y con contrato idéntico).
-- - NO UPDATE / NO DELETE / NO backfill de expedientes ni documentos.
-- - Documentos históricos fuera del nuevo paquete permanecen almacenados.
-- - `origen_mesa` permanece externo: no cambia routing de Mesa.
--
-- Nuevo contrato Silvia:
-- obligatorios: INE frente, INE reverso, comprobante, acta digital,
--               semanas cotizadas O vigencia de derechos.
-- opcional: estado de cuenta.
-- Constancia CURP / SAT siguen permitidas como apoyo no obligatorio de la UI completa.

-- =============================================================================
-- 1) Identidad de Equipo Silvia, independiente del JWT
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_es_equipo_silvia(p_asesor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles objetivo
    WHERE objetivo.id = p_asesor_id
      AND objetivo.active = true
      AND objetivo.app_role = 'asesor'
      AND (
        lower(btrim(objetivo.email)) = 'silvia.reyes@concasa.mx'
        OR EXISTS (
          SELECT 1
          FROM public.asesor_equipo_miembros m
          JOIN public.asesor_equipos t
            ON t.id = m.team_id
           AND t.active = true
           AND t.organization_id = objetivo.organization_id
          JOIN public.profiles lider
            ON lider.id = t.leader_id
           AND lider.active = true
           AND lider.app_role = 'asesor'
           AND lider.organization_id = objetivo.organization_id
          WHERE m.asesor_id = objetivo.id
            AND m.active = true
            AND lower(btrim(lider.email)) = 'silvia.reyes@concasa.mx'
        )
      )
  );
$$;

COMMENT ON FUNCTION public.asesor_es_equipo_silvia(uuid) IS
  'true solo para Silvia Reyes activa o miembro activo de su equipo activo. Sin dependencia de auth.uid; no muta datos.';

REVOKE ALL ON FUNCTION public.asesor_es_equipo_silvia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_es_equipo_silvia(uuid) TO postgres, service_role;

-- =============================================================================
-- 2) Clasificación de CAPTURA del dueño (distinta del routing externo)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_usa_captura_simplificada(
  p_asesor_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_target_id uuid;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = public.current_profile_id()
    AND p.active = true;

  IF NOT FOUND THEN
    RETURN true;
  END IF;

  v_target_id := COALESCE(p_asesor_id, v_actor.id);

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = v_target_id
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND OR v_actor.organization_id IS DISTINCT FROM v_target.organization_id THEN
    RETURN true;
  END IF;

  IF v_actor.app_role NOT IN (
    'asesor','mesa_interno','mesa_externo','mesa_admin','editor','super_admin'
  ) THEN
    RETURN true;
  END IF;

  -- Silvia conserva origen externo, pero captura como interno.
  IF public.asesor_es_equipo_silvia(v_target.id) THEN
    RETURN false;
  END IF;

  -- Anette / Orlando / cualquier asesor realmente externo conservan simplificado.
  IF v_target.tipo_asesor_origen IS NOT DISTINCT FROM 'externo'::public.tipo_asesor_origen THEN
    RETURN true;
  END IF;

  IF public.asesor_paquete_documental_externos(v_target.id) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.asesor_usa_captura_simplificada(uuid) IS
  'UI dueño: Equipo Silvia=false (captura completa); externos restantes=true. Same-org, fail-closed.';

REVOKE ALL ON FUNCTION public.asesor_usa_captura_simplificada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_usa_captura_simplificada(uuid) TO authenticated, service_role;

-- =============================================================================
-- 3) Paquete obligatorio / upload por dueño
-- =============================================================================

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_envio_para(
  p_asesor_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ANETTE: contrato vigente intacto. Debe permanecer antes que cualquier genérico.
  IF public.asesor_es_anette_externa(p_asesor_id) THEN
    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta',
      'cliente_constancia_curp',
      'cliente_solicitud_credito',
      'cliente_lista_nominal',
      'cliente_bajo_protesta'
    ]::text[];
  END IF;

  IF public.asesor_es_equipo_silvia(p_asesor_id) THEN
    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_ine_reverso',
      'cliente_comprobante_domicilio',
      'cliente_acta_nacimiento_digital',
      'cliente_semanas_cotizadas'
    ]::text[];
  END IF;

  -- Otros paquetes externos (p.ej. Orlando): intactos.
  IF public.asesor_paquete_documental_externos(p_asesor_id) THEN
    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta',
      'cliente_constancia_curp',
      'cliente_solicitud_credito',
      'cliente_lista_nominal',
      'cliente_bajo_protesta',
      'cliente_presupuesto'
    ]::text[];
  END IF;

  RETURN public.integration_doc_tipos_asesor_envio();
END;
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) IS
  'Por dueño. Silvia=INE F/R+comprobante+acta+(semanas|vigencia). Anette/otros externos preservados.';

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload_para(
  p_asesor_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_envio text[];
BEGIN
  -- ANETTE: exacto al contrato previo.
  IF public.asesor_es_anette_externa(p_asesor_id) THEN
    v_envio := public.integration_doc_tipos_asesor_envio_para(p_asesor_id);
    RETURN v_envio || ARRAY[
      'cliente_presupuesto',
      'cliente_acta_nacimiento_digital',
      'cliente_constancia_situacion_fiscal',
      'cliente_semanas_cotizadas',
      'cliente_vigencia_derechos'
    ]::text[];
  END IF;

  IF public.asesor_es_equipo_silvia(p_asesor_id) THEN
    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_ine_reverso',
      'cliente_comprobante_domicilio',
      'cliente_acta_nacimiento_digital',
      'cliente_semanas_cotizadas',
      'cliente_vigencia_derechos',
      'cliente_estado_cuenta',
      'cliente_constancia_curp',
      'cliente_constancia_situacion_fiscal'
    ]::text[];
  END IF;

  IF public.asesor_paquete_documental_externos(p_asesor_id) THEN
    v_envio := public.integration_doc_tipos_asesor_envio_para(p_asesor_id);
    RETURN v_envio || ARRAY[
      'cliente_acta_nacimiento_digital',
      'cliente_constancia_situacion_fiscal',
      'cliente_semanas_cotizadas',
      'cliente_vigencia_derechos'
    ]::text[];
  END IF;

  RETURN public.integration_doc_tipos_asesor_upload();
END;
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) IS
  'Upload por dueño. Silvia limitado al paquete nuevo + estado opcional + CURP/SAT auxiliares. Sin borrar históricos.';

-- =============================================================================
-- 4) Equivalencia obligatoria Semanas O Vigencia
-- =============================================================================

CREATE OR REPLACE FUNCTION public.count_integration_docs_presentes(p_expediente_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM unnest(public.integration_doc_tipos_requeridos_para_expediente(p_expediente_id)) AS req(tipo)
  WHERE EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND (
        d.tipo_documento = req.tipo
        OR (
          req.tipo = 'cliente_semanas_cotizadas'
          AND d.tipo_documento = 'cliente_vigencia_derechos'
        )
      )
      AND d.deleted_at IS NULL
      AND d.estatus_revision IN ('subido','resubido','validado')
  );
$$;

CREATE OR REPLACE FUNCTION public.integration_docs_completos(p_expediente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.count_integration_docs_presentes(p_expediente_id)
    = cardinality(public.integration_doc_tipos_requeridos_para_expediente(p_expediente_id));
$$;

CREATE OR REPLACE FUNCTION public.count_integration_docs_validados(p_expediente_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM unnest(public.integration_doc_tipos_requeridos_para_expediente(p_expediente_id)) AS req(tipo)
  WHERE EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND (
        d.tipo_documento = req.tipo
        OR (
          req.tipo = 'cliente_semanas_cotizadas'
          AND d.tipo_documento = 'cliente_vigencia_derechos'
        )
      )
      AND d.deleted_at IS NULL
      AND d.estatus_revision = 'validado'
  );
$$;

CREATE OR REPLACE FUNCTION public.integration_docs_todos_validados(p_expediente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.count_integration_docs_validados(p_expediente_id)
    = cardinality(public.integration_doc_tipos_requeridos_para_expediente(p_expediente_id));
$$;

-- =============================================================================
-- 5) Retirar UI de scoped docs viejos SOLO a Equipo Silvia
--    (no DELETE de expediente_documentos; Mesa/histórico permanecen intactos)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_tipos_documento_visibles()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_tipos text[] := ARRAY[]::text[];
  v_tipo text;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor_id
      AND p.active = true
      AND p.app_role = 'asesor'
  ) THEN
    RETURN ARRAY[]::text[];
  END IF;

  IF public.asesor_es_equipo_silvia(v_actor_id) THEN
    RETURN ARRAY[]::text[];
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

  RETURN v_tipos;
END;
$$;

COMMENT ON FUNCTION public.asesor_tipos_documento_visibles() IS
  'Scoped docs UI. Equipo Silvia=[] desde paquete nuevo; no borra archivos existentes. Anette/otros conservan semántica.';

-- =============================================================================
-- 6) Datos Generales: Silvia usa gate completo aunque origen_mesa siga externo
-- =============================================================================

CREATE OR REPLACE FUNCTION public.expedientes_assert_datos_generales_integrity_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tipo_asesor_origen text;
  v_es_silvia boolean := false;
  v_es_externo boolean := false;
  v_cd public.cliente_datos%ROWTYPE;
  v_refs jsonb;
  v_dir jsonb;
  v_ref jsonb;
  v_ref_phone text;
  i integer;
BEGIN
  IF TG_OP <> 'UPDATE'
     OR OLD.submitted_to_mesa IS TRUE
     OR NEW.submitted_to_mesa IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  v_es_silvia := public.asesor_es_equipo_silvia(NEW.asesor_id);

  SELECT p.tipo_asesor_origen::text
  INTO v_tipo_asesor_origen
  FROM public.profiles p
  WHERE p.id = NEW.asesor_id;

  v_es_externo := NOT v_es_silvia AND (
    lower(btrim(COALESCE(NEW.origen_mesa::text, ''))) = 'externo'
    OR lower(btrim(COALESCE(v_tipo_asesor_origen, ''))) = 'externo'
    OR EXISTS (
      SELECT 1
      FROM public.asesor_equipo_miembros m
      JOIN public.asesor_equipos t ON t.id = m.team_id AND t.active = true
      JOIN public.profiles lider ON lider.id = t.leader_id AND lider.active = true
      WHERE m.asesor_id = NEW.asesor_id
        AND m.active = true
        AND lower(btrim(lider.email)) IN (
          'silvia.reyes@concasa.mx',
          'orlando.solis@concasa.mx'
        )
    )
  );

  IF v_es_externo THEN
    RETURN NEW;
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.telefono_casa, '')), '') IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_TELEFONO_CASA_FALTANTE'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.* INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = NEW.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_FALTANTES'
      USING ERRCODE = '22023';
  END IF;

  v_refs := COALESCE(v_cd.referencias, '[]'::jsonb);
  IF jsonb_typeof(v_refs) <> 'array' OR jsonb_array_length(v_refs) < 2 THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_REFERENCIAS_FALTANTES'
      USING ERRCODE = '22023';
  END IF;

  FOR i IN 0..1 LOOP
    v_ref := COALESCE(v_refs->i, '{}'::jsonb);
    v_ref_phone := NULLIF(
      btrim(COALESCE(v_ref->>'celular', v_ref->>'telefono', '')),
      ''
    );
    IF NULLIF(btrim(COALESCE(v_ref->>'nombre', '')), '') IS NULL
       OR v_ref_phone IS NULL THEN
      RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_REFERENCIAS_INCOMPLETAS'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_dir := CASE
    WHEN jsonb_typeof(v_cd.datos->'direccionEmpresa') = 'object'
      THEN v_cd.datos->'direccionEmpresa'
    ELSE '{}'::jsonb
  END;

  IF NULLIF(btrim(COALESCE(v_dir->>'calle', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_dir->>'colonia', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_dir->>'municipio', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_dir->>'cp', '')), '') IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_DIRECCION_EMPRESA_FALTANTE'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.expedientes_assert_datos_generales_integrity_on_submit() IS
  'Submit DG integrity: Equipo Silvia usa contrato completo aun con origen_mesa externo; Anette/otros externos continúan exentos.';
