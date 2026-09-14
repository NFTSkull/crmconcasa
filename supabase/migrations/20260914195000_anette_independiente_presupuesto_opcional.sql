-- ConCasa CRM — Anette independiente + Presupuesto opcional
-- Objetivo:
-- 1) Anette NO pertenece al Equipo Silvia.
-- 2) Conserva paquete documental externo por identidad propia (email + origen externo).
-- 3) Solicitud de crédito, Lista Nominal y Bajo Protesta siguen obligatorios.
-- 4) Presupuesto sigue visible/subible pero NO bloquea envío a Mesa.
-- 5) Silvia / Orlando conservan su comportamiento actual.

-- -----------------------------------------------------------------------------
-- 0. Desactivar la membresía de Anette en Equipo Silvia sin borrar historial.
-- -----------------------------------------------------------------------------
UPDATE public.asesor_equipo_miembros m
SET active = false
FROM public.asesor_equipos t,
     public.profiles lider,
     public.profiles anette
WHERE m.team_id = t.id
  AND t.leader_id = lider.id
  AND m.asesor_id = anette.id
  AND t.active = true
  AND lower(btrim(lider.email)) = 'silvia.reyes@concasa.mx'
  AND lower(btrim(anette.email)) = 'anette.perez@concasa.mx';

-- -----------------------------------------------------------------------------
-- 1. Identidad explícita: Anette externa independiente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asesor_es_anette_externa(p_asesor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_asesor_id
      AND p.active = true
      AND p.app_role = 'asesor'
      AND lower(btrim(p.email)) = 'anette.perez@concasa.mx'
      AND p.tipo_asesor_origen = 'externo'
  );
$$;

REVOKE ALL ON FUNCTION public.asesor_es_anette_externa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_es_anette_externa(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.asesor_es_anette_externa(uuid) IS
  'true solo para Anette Perez activa, rol asesor y origen externo. No depende de membresía a ningún equipo.';

-- -----------------------------------------------------------------------------
-- 2. Paquete externo: Anette directa O equipos Silvia/Orlando.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asesor_paquete_documental_externos(p_asesor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_asesor_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.asesor_es_anette_externa(p_asesor_id) THEN
    RETURN true;
  END IF;

  IF public.asesor_en_equipo_por_lider_email('silvia.reyes@concasa.mx', p_asesor_id) THEN
    RETURN true;
  END IF;

  IF public.asesor_en_equipo_por_lider_email('orlando.solis@concasa.mx', p_asesor_id) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_paquete_documental_externos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_paquete_documental_externos(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Obligatorios por dueño.
--    Anette: 7 obligatorios, Presupuesto fuera del denominador.
--    Equipos externos: continúan con sus 8 obligatorios actuales.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_envio_para(p_asesor_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) IS
  'Docs requeridos por asesor: Anette externa=7 (Presupuesto opcional); Silvia/Orlando externos=8; resto=lista clásica.';

-- -----------------------------------------------------------------------------
-- 4. Upload: Presupuesto sigue permitido a Anette como opcional.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload_para(p_asesor_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_envio text[];
BEGIN
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

REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) IS
  'Allowlist upload: Anette puede subir Presupuesto como opcional además de su paquete externo; otros externos conservan reglas actuales.';

-- -----------------------------------------------------------------------------
-- 5. Los 4 documentos scoped deben ser utilizables por Anette sin equipo.
-- -----------------------------------------------------------------------------
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
  v_tipo text;
  v_leader_emails text[];
  v_leader_email text;
  v_actor_org uuid;
  v_actor_email text;
  v_actor_origen text;
  v_team_ids uuid[];
  v_n integer;
  v_team_id uuid;
BEGIN
  v_tipo := NULLIF(lower(btrim(COALESCE(p_tipo_documento, ''))), '');
  IF p_actor_id IS NULL OR v_tipo IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.organization_id, lower(btrim(p.email)), p.tipo_asesor_origen::text
  INTO v_actor_org, v_actor_email, v_actor_origen
  FROM public.profiles p
  WHERE p.id = p_actor_id
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND OR v_actor_org IS NULL THEN
    RETURN false;
  END IF;

  -- Anette usa estos cuatro documentos por identidad propia, no por equipo.
  IF v_actor_email = 'anette.perez@concasa.mx'
     AND v_actor_origen = 'externo'
     AND v_tipo = ANY(ARRAY[
       'cliente_solicitud_credito',
       'cliente_lista_nominal',
       'cliente_bajo_protesta',
       'cliente_presupuesto'
     ]::text[])
  THEN
    RETURN true;
  END IF;

  SELECT coalesce(
    array_agg(DISTINCT lower(btrim(s.leader_email)) ORDER BY lower(btrim(s.leader_email))),
    ARRAY[]::text[]
  )
  INTO v_leader_emails
  FROM public.documento_tipo_scope_equipo s
  WHERE lower(btrim(s.tipo_documento)) = v_tipo
    AND s.active = true;

  IF coalesce(cardinality(v_leader_emails), 0) = 0 THEN
    RETURN true;
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
      RAISE WARNING 'asesor_puede_usar_tipo_documento: fail-closed tipo=% leader_email=% team_count=% actor=% org=%',
        v_tipo, v_leader_email, v_n, p_actor_id, v_actor_org;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_puede_usar_tipo_documento(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_puede_usar_tipo_documento(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.asesor_puede_usar_tipo_documento(uuid, text) IS
  'Tipos no scoped=true; scoped por equipo exige membresía, excepto los 4 documentos externos permitidos directamente a Anette externa.';
