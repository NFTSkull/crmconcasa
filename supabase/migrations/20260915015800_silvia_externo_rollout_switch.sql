-- ConCasa CRM — Equipo Silvia: restaurar paquete externo previo + switch de rollout.
--
-- Estado inicial de producción tras esta migración:
--   - Equipo Silvia vuelve al contrato EXTERNO histórico (8 obligatorios):
--     INE frente, comprobante, estado de cuenta, CURP, solicitud de crédito,
--     lista nominal, bajo protesta y presupuesto.
--   - Acta digital, Constancia SAT, Semanas y Vigencia siguen permitidos como opcionales.
--   - Datos Generales vuelven a captura simplificada externa.
--   - Los scoped docs históricos vuelven a mostrarse/subirse para el equipo.
--   - Reasignación dentro del equipo NO se modifica.
--
-- El paquete nuevo de PR #305 queda preparado detrás de un switch persistente.
-- Para activarlo posteriormente basta cambiar `nuevo_paquete_habilitado=true`
-- para leader_email='silvia.reyes@concasa.mx'.
--
-- Sin UPDATE/DELETE/backfill de expedientes, documentos, citas o cupos.

-- =============================================================================
-- 1) Config de rollout (sin acceso directo desde cliente)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.asesor_equipo_paquete_rollout (
  leader_email text PRIMARY KEY,
  nuevo_paquete_habilitado boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.asesor_equipo_paquete_rollout IS
  'Switch interno de rollout por líder para variantes de paquete documental. No contiene datos de expedientes.';

ALTER TABLE public.asesor_equipo_paquete_rollout ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asesor_equipo_paquete_rollout FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.asesor_equipo_paquete_rollout FROM PUBLIC, anon, authenticated;

INSERT INTO public.asesor_equipo_paquete_rollout (
  leader_email,
  nuevo_paquete_habilitado
)
VALUES ('silvia.reyes@concasa.mx', false)
ON CONFLICT (leader_email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.asesor_equipo_silvia_paquete_nuevo_habilitado()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT r.nuevo_paquete_habilitado
      FROM public.asesor_equipo_paquete_rollout r
      WHERE lower(btrim(r.leader_email)) = 'silvia.reyes@concasa.mx'
      LIMIT 1
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.asesor_equipo_silvia_paquete_nuevo_habilitado() IS
  'Switch de rollout: false=contrato externo histórico; true=paquete nuevo Silvia preparado en PR #305.';

REVOKE ALL ON FUNCTION public.asesor_equipo_silvia_paquete_nuevo_habilitado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_equipo_silvia_paquete_nuevo_habilitado()
  TO authenticated, service_role;

-- =============================================================================
-- 2) Perfil de captura: mientras el switch esté OFF, Silvia vuelve a externo
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

  -- Rollout preparado: solo cuando el switch esté ON Silvia captura como interno.
  IF public.asesor_es_equipo_silvia(v_target.id)
     AND public.asesor_equipo_silvia_paquete_nuevo_habilitado() THEN
    RETURN false;
  END IF;

  -- Estado actual: Silvia/Anette/Orlando y externos restantes capturan simplificado.
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
  'Captura por dueño. Equipo Silvia usa simplificado con rollout OFF y completo con rollout ON; resto conserva reglas existentes.';

REVOKE ALL ON FUNCTION public.asesor_usa_captura_simplificada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_usa_captura_simplificada(uuid)
  TO authenticated, service_role;

-- =============================================================================
-- 3) Documentos: OFF = contrato externo histórico; ON = paquete nuevo preparado
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
  -- Anette permanece independiente: 7 obligatorios y Presupuesto opcional.
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

  -- Paquete nuevo Silvia, preparado pero apagado inicialmente.
  IF public.asesor_es_equipo_silvia(p_asesor_id)
     AND public.asesor_equipo_silvia_paquete_nuevo_habilitado() THEN
    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_ine_reverso',
      'cliente_comprobante_domicilio',
      'cliente_acta_nacimiento_digital',
      'cliente_semanas_cotizadas'
    ]::text[];
  END IF;

  -- Externo histórico (Silvia con switch OFF + Orlando): exacto al contrato previo.
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
  'Anette=7; Silvia rollout OFF/Orlando=8 externos históricos; Silvia rollout ON=paquete nuevo 5 slots; resto clásico.';

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

  IF public.asesor_es_equipo_silvia(p_asesor_id)
     AND public.asesor_equipo_silvia_paquete_nuevo_habilitado() THEN
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
    -- Exacto al externo previo: 8 obligatorios + 4 opcionales permitidos.
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
  'Upload por dueño. Silvia rollout OFF conserva allowlist externa previa; rollout ON conserva paquete nuevo preparado.';

-- =============================================================================
-- 4) Scoped docs: visibles con rollout OFF, ocultos solo al activar paquete nuevo
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

  IF public.asesor_es_equipo_silvia(v_actor_id)
     AND public.asesor_equipo_silvia_paquete_nuevo_habilitado() THEN
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
  'Scoped docs externos visibles normalmente; Equipo Silvia los oculta solo cuando su rollout nuevo está ON.';

-- =============================================================================
-- 5) Datos Generales: contrato completo solo cuando el rollout nuevo esté ON
-- =============================================================================

CREATE OR REPLACE FUNCTION public.expedientes_assert_datos_generales_integrity_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tipo_asesor_origen text;
  v_es_silvia_nuevo boolean := false;
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

  v_es_silvia_nuevo := public.asesor_es_equipo_silvia(NEW.asesor_id)
    AND public.asesor_equipo_silvia_paquete_nuevo_habilitado();

  SELECT p.tipo_asesor_origen::text
  INTO v_tipo_asesor_origen
  FROM public.profiles p
  WHERE p.id = NEW.asesor_id;

  v_es_externo := NOT v_es_silvia_nuevo AND (
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
  'Integridad DG: Equipo Silvia rollout OFF conserva excepción externa; rollout ON exige contrato completo. Anette/otros externos intactos.';

-- =============================================================================
-- 6) Grants explícitos de funciones redefinidas
-- =============================================================================

REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.asesor_tipos_documento_visibles() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asesor_tipos_documento_visibles()
  TO authenticated;
