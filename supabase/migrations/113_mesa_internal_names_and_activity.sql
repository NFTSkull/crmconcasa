-- ConCasa CRM — P127: nombres Mesa Interna + actividad (Visto por / Actualizado por)
-- A) Actualiza full_name de 5 perfiles mesa_interno inequívocos (sin tocar email/rol/org).
-- B) Tabla expediente_mesa_actividad + RPC vista + trigger desde action_log.
-- C) Amplía mesa_list_bandeja_page con nombres/fechas en batch (JOIN, sin N+1).
-- No muta expedientes ni bookings.

-- =============================================================================
-- A) Nombres visibles (abortar si falta alguno o hay ambigüedad)
-- =============================================================================
DO $$
DECLARE
  v_org UUID;
  v_id01 UUID;
  v_id02 UUID;
  v_id03 UUID;
  v_id04 UUID;
  v_id05 UUID;
  v_role public.app_role;
  v_cnt INTEGER;
BEGIN
  SELECT count(*)::INTEGER INTO v_cnt
  FROM public.profiles p
  WHERE lower(p.email) IN (
    'mesa.interno01@concasa.mx',
    'mesa.interno02@concasa.mx',
    'mesa.interno03@concasa.mx',
    'mesa4@concasa.mx',
    'mesa5@concasa.mx'
  );

  IF v_cnt = 0 THEN
    RAISE NOTICE 'P127: sin perfiles Cloud objetivo; se omite actualización de nombres (entorno local/fixture).';
    RETURN;
  END IF;

  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'P127: se esperaban 5 perfiles objetivo, encontrados % (ambigüedad o faltantes)', v_cnt;
  END IF;

  SELECT p.id, p.organization_id, p.app_role
  INTO v_id01, v_org, v_role
  FROM public.profiles p
  WHERE lower(p.email) = 'mesa.interno01@concasa.mx';
  IF v_id01 IS NULL OR v_role IS DISTINCT FROM 'mesa_interno' THEN
    RAISE EXCEPTION 'P127: perfil 01 no encontrado o no es mesa_interno';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.profiles p
  WHERE lower(p.email) = 'mesa.interno01@concasa.mx';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'P127: ambigüedad email mesa.interno01@concasa.mx (count=%)', v_cnt;
  END IF;

  SELECT p.id, p.app_role INTO v_id02, v_role
  FROM public.profiles p WHERE lower(p.email) = 'mesa.interno02@concasa.mx';
  IF v_id02 IS NULL OR v_role IS DISTINCT FROM 'mesa_interno' THEN
    RAISE EXCEPTION 'P127: perfil 02 no encontrado o no es mesa_interno';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.profiles p WHERE lower(p.email) = 'mesa.interno02@concasa.mx';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'P127: ambigüedad email mesa.interno02@concasa.mx (count=%)', v_cnt;
  END IF;

  SELECT p.id, p.app_role INTO v_id03, v_role
  FROM public.profiles p WHERE lower(p.email) = 'mesa.interno03@concasa.mx';
  IF v_id03 IS NULL OR v_role IS DISTINCT FROM 'mesa_interno' THEN
    RAISE EXCEPTION 'P127: perfil 03 no encontrado o no es mesa_interno';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.profiles p WHERE lower(p.email) = 'mesa.interno03@concasa.mx';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'P127: ambigüedad email mesa.interno03@concasa.mx (count=%)', v_cnt;
  END IF;

  SELECT p.id, p.app_role INTO v_id04, v_role
  FROM public.profiles p WHERE lower(p.email) = 'mesa4@concasa.mx';
  IF v_id04 IS NULL OR v_role IS DISTINCT FROM 'mesa_interno' THEN
    RAISE EXCEPTION 'P127: perfil mesa4@ no encontrado o no es mesa_interno';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.profiles p WHERE lower(p.email) = 'mesa4@concasa.mx';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'P127: ambigüedad email mesa4@concasa.mx (count=%)', v_cnt;
  END IF;

  SELECT p.id, p.app_role INTO v_id05, v_role
  FROM public.profiles p WHERE lower(p.email) = 'mesa5@concasa.mx';
  IF v_id05 IS NULL OR v_role IS DISTINCT FROM 'mesa_interno' THEN
    RAISE EXCEPTION 'P127: perfil mesa5@ no encontrado o no es mesa_interno';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.profiles p WHERE lower(p.email) = 'mesa5@concasa.mx';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'P127: ambigüedad email mesa5@concasa.mx (count=%)', v_cnt;
  END IF;

  -- Misma organización (canónica Cloud ConCasa)
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id IN (v_id01, v_id02, v_id03, v_id04, v_id05)
      AND p.organization_id IS DISTINCT FROM v_org
  ) THEN
    RAISE EXCEPTION 'P127: los cinco perfiles no comparten organization_id';
  END IF;

  IF v_org IS DISTINCT FROM '50beae49-3961-4163-8e78-2251693f2c19'::UUID THEN
    RAISE EXCEPTION 'P127: organization_id inesperada %', v_org;
  END IF;

  UPDATE public.profiles SET full_name = 'Keyla', updated_at = NOW()
  WHERE id = v_id01 AND app_role = 'mesa_interno' AND organization_id = v_org;

  UPDATE public.profiles SET full_name = 'Jorge', updated_at = NOW()
  WHERE id = v_id02 AND app_role = 'mesa_interno' AND organization_id = v_org;

  UPDATE public.profiles SET full_name = 'Sara', updated_at = NOW()
  WHERE id = v_id03 AND app_role = 'mesa_interno' AND organization_id = v_org;

  UPDATE public.profiles SET full_name = 'July', updated_at = NOW()
  WHERE id = v_id04 AND app_role = 'mesa_interno' AND organization_id = v_org;

  UPDATE public.profiles SET full_name = 'Mirna', updated_at = NOW()
  WHERE id = v_id05 AND app_role = 'mesa_interno' AND organization_id = v_org;

  -- Verificar nombres finales
  IF (
    SELECT count(*) FROM public.profiles p
    WHERE p.id IN (v_id01, v_id02, v_id03, v_id04, v_id05)
      AND p.full_name IN ('Keyla', 'Jorge', 'Sara', 'July', 'Mirna')
      AND p.app_role = 'mesa_interno'
  ) <> 5 THEN
    RAISE EXCEPTION 'P127: verificación de nombres finales falló';
  END IF;
END;
$$;

-- =============================================================================
-- B) Tabla actividad Mesa (una fila por expediente)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.expediente_mesa_actividad (
  organization_id UUID NOT NULL REFERENCES public.organizations (id),
  expediente_id UUID NOT NULL REFERENCES public.expedientes (id) ON DELETE CASCADE,
  last_viewed_by UUID NULL REFERENCES public.profiles (id),
  last_viewed_at TIMESTAMPTZ NULL,
  last_updated_by UUID NULL REFERENCES public.profiles (id),
  last_updated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, expediente_id),
  CONSTRAINT expediente_mesa_actividad_org_exp_unique UNIQUE (organization_id, expediente_id)
);

CREATE INDEX IF NOT EXISTS expediente_mesa_actividad_viewed_at_idx
  ON public.expediente_mesa_actividad (last_viewed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS expediente_mesa_actividad_updated_at_idx
  ON public.expediente_mesa_actividad (last_updated_at DESC NULLS LAST);

ALTER TABLE public.expediente_mesa_actividad ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expediente_mesa_actividad_select ON public.expediente_mesa_actividad;
CREATE POLICY expediente_mesa_actividad_select
  ON public.expediente_mesa_actividad
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

-- Sin INSERT/UPDATE/DELETE directos a authenticated
REVOKE ALL ON TABLE public.expediente_mesa_actividad FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_mesa_actividad FROM anon;
REVOKE ALL ON TABLE public.expediente_mesa_actividad FROM authenticated;
GRANT SELECT ON TABLE public.expediente_mesa_actividad TO authenticated;
GRANT ALL ON TABLE public.expediente_mesa_actividad TO service_role;

COMMENT ON TABLE public.expediente_mesa_actividad IS
  'P127: última vista y última mutación Mesa por expediente (escritura solo vía RPC/trigger).';

-- =============================================================================
-- RPC: registrar vista (solo al abrir detalle)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_registrar_vista_expediente(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp_org UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_registrar_vista_expediente: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_registrar_vista_expediente: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_registrar_vista_expediente: expediente requerido' USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_registrar_vista_expediente: expediente no visible' USING ERRCODE = '42501';
  END IF;

  SELECT e.organization_id INTO v_exp_org
  FROM public.expedientes e
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL;

  IF v_exp_org IS NULL THEN
    RAISE EXCEPTION 'mesa_registrar_vista_expediente: expediente no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_role <> 'super_admin' AND v_exp_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'mesa_registrar_vista_expediente: organización distinta' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.expediente_mesa_actividad (
    organization_id, expediente_id,
    last_viewed_by, last_viewed_at,
    created_at, updated_at
  ) VALUES (
    v_exp_org, p_expediente_id,
    v_actor_id, v_now,
    v_now, v_now
  )
  ON CONFLICT (organization_id, expediente_id) DO UPDATE SET
    last_viewed_by = EXCLUDED.last_viewed_by,
    last_viewed_at = EXCLUDED.last_viewed_at,
    updated_at = EXCLUDED.updated_at;

  -- No escribe action_log (vista ≠ actualización)
  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'last_viewed_by', v_actor_id,
    'last_viewed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_registrar_vista_expediente(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_registrar_vista_expediente(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_registrar_vista_expediente(UUID) TO authenticated;

COMMENT ON FUNCTION public.mesa_registrar_vista_expediente(UUID) IS
  'P127: registra Visto por al abrir detalle Mesa. No muta expediente ni Actualizado por.';

CREATE OR REPLACE FUNCTION public.get_mesa_expediente_actividad(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_row public.expediente_mesa_actividad%ROWTYPE;
  v_view_name TEXT;
  v_upd_name TEXT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'get_mesa_expediente_actividad: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'get_mesa_expediente_actividad: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL OR NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'get_mesa_expediente_actividad: expediente no visible' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.expediente_mesa_actividad a
  WHERE a.expediente_id = p_expediente_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'expediente_id', p_expediente_id,
      'last_viewed_by_name', NULL,
      'last_viewed_at', NULL,
      'last_updated_by_name', NULL,
      'last_updated_at', NULL
    );
  END IF;

  SELECT nullif(btrim(p.full_name), '') INTO v_view_name
  FROM public.profiles p WHERE p.id = v_row.last_viewed_by;
  SELECT nullif(btrim(p.full_name), '') INTO v_upd_name
  FROM public.profiles p WHERE p.id = v_row.last_updated_by;

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'last_viewed_by_name', v_view_name,
    'last_viewed_at', v_row.last_viewed_at,
    'last_updated_by_name', v_upd_name,
    'last_updated_at', v_row.last_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mesa_expediente_actividad(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_mesa_expediente_actividad(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_mesa_expediente_actividad(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_mesa_expediente_actividad(UUID) IS
  'P127: lee Visto/Actualizado por con nombres (batch-safe en detalle).';

-- =============================================================================
-- Trigger: Actualizado por desde action_log (solo actores Mesa)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.expediente_mesa_actividad_from_action_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp_id UUID;
  v_org UUID;
  v_now TIMESTAMPTZ;
BEGIN
  IF NEW.actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.actor_role IS NULL OR NEW.actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RETURN NEW;
  END IF;

  -- Excluir vistas / lecturas
  IF NEW.action ILIKE '%view%'
     OR NEW.action ILIKE '%.list%'
     OR NEW.action ILIKE '%.get%'
     OR NEW.action = 'mesa.expediente.view'
     OR NEW.action = 'mesa_registrar_vista_expediente' THEN
    RETURN NEW;
  END IF;

  IF NEW.entity_type = 'expediente' THEN
    v_exp_id := NEW.entity_id;
  ELSIF NEW.payload ? 'expediente_id'
        AND nullif(btrim(NEW.payload->>'expediente_id'), '') IS NOT NULL THEN
    BEGIN
      v_exp_id := (NEW.payload->>'expediente_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_exp_id := NULL;
    END;
  ELSE
    v_exp_id := NULL;
  END IF;

  IF v_exp_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.organization_id INTO v_org
  FROM public.expedientes e
  WHERE e.id = v_exp_id AND e.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RETURN NEW;
  END IF;

  v_now := COALESCE(NEW.created_at, clock_timestamp());

  INSERT INTO public.expediente_mesa_actividad (
    organization_id, expediente_id,
    last_updated_by, last_updated_at,
    created_at, updated_at
  ) VALUES (
    v_org, v_exp_id,
    NEW.actor_id, v_now,
    v_now, v_now
  )
  ON CONFLICT (organization_id, expediente_id) DO UPDATE SET
    last_updated_by = EXCLUDED.last_updated_by,
    last_updated_at = EXCLUDED.last_updated_at,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expediente_mesa_actividad_action_log ON public.action_log;
CREATE TRIGGER trg_expediente_mesa_actividad_action_log
  AFTER INSERT ON public.action_log
  FOR EACH ROW
  EXECUTE FUNCTION public.expediente_mesa_actividad_from_action_log();

COMMENT ON FUNCTION public.expediente_mesa_actividad_from_action_log() IS
  'P127: propaga mutaciones Mesa desde action_log → last_updated_* (excluye vistas/asesor).';

-- =============================================================================
-- Helpers bandeja (idempotentes; ya existen desde 094 en Cloud)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_bandeja_doc_estatus(
  p_expediente_id UUID,
  p_tipo TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT d.estatus_revision::text
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.deleted_at IS NULL
    AND d.tipo_documento::text = p_tipo
  ORDER BY d.created_at DESC NULLS LAST, d.id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.mesa_bandeja_categoria_resumen(
  p_expediente_id UUID,
  p_fecha_envio_mesa TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cd_estado TEXT;
  v_cd_updated TIMESTAMPTZ;
  v_cd_validated TIMESTAMPTZ;
  v_ine TEXT;
  v_ec TEXT;
  v_nss TEXT;
  v_dir TEXT;
  v_doc TEXT;
BEGIN
  SELECT cd.estado::text, cd.updated_at, cd.validated_at
  INTO v_cd_estado, v_cd_updated, v_cd_validated
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id
  LIMIT 1;

  IF v_cd_estado = 'rechazado' THEN
    RETURN 'correccion_requerida';
  END IF;

  v_ine := public.mesa_bandeja_doc_estatus(p_expediente_id, 'ine');
  v_ec := public.mesa_bandeja_doc_estatus(p_expediente_id, 'estado_cuenta');
  v_nss := public.mesa_bandeja_doc_estatus(p_expediente_id, 'nss');
  v_dir := public.mesa_bandeja_doc_estatus(p_expediente_id, 'direccion');

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
$$;

CREATE OR REPLACE FUNCTION public.mesa_bandeja_sort_ts(
  p_expediente_id UUID,
  p_fecha_envio_mesa TIMESTAMPTZ,
  p_created_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN v_doc IS NULL AND v_cd IS NULL THEN NULL
        WHEN v_doc IS NULL THEN v_cd
        WHEN v_cd IS NULL THEN v_doc
        ELSE GREATEST(v_doc, v_cd)
      END
      FROM (
        SELECT
          (
            SELECT MAX(d.created_at)
            FROM public.expediente_documentos d
            WHERE d.expediente_id = p_expediente_id
              AND d.deleted_at IS NULL
              AND d.estatus_revision::text = 'resubido'
          ) AS v_doc,
          (
            SELECT cd.updated_at
            FROM public.cliente_datos cd
            WHERE cd.expediente_id = p_expediente_id
              AND cd.estado::text = 'completo'
              AND cd.validated_at IS NULL
              AND p_fecha_envio_mesa IS NOT NULL
              AND cd.updated_at > p_fecha_envio_mesa
            LIMIT 1
          ) AS v_cd
      ) s
    ),
    p_fecha_envio_mesa,
    p_created_at
  );
$$;

CREATE OR REPLACE FUNCTION public.mesa_list_bandeja_page(
  p_limit INTEGER DEFAULT 25,
  p_cursor_sort_ts TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_quick_filter TEXT DEFAULT 'todos',
  p_ops_filter TEXT DEFAULT 'todo_mesa',
  p_buscar TEXT DEFAULT NULL,
  p_etapa INTEGER DEFAULT NULL,
  p_subestado TEXT DEFAULT NULL,
  p_solo_citas_hoy BOOLEAN DEFAULT FALSE,
  p_today_ymd TEXT DEFAULT NULL,
  p_rechazos_sub TEXT DEFAULT 'rechazados',
  p_origen TEXT DEFAULT NULL,
  p_include_counts BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_q TEXT;
  v_q_digits TEXT;
  v_role public.app_role;
  v_uid UUID;
  v_total BIGINT;
  v_items JSONB;
  v_counts JSONB := NULL;
  v_last_sort TIMESTAMPTZ;
  v_last_id UUID;
  v_page_len INTEGER;
  v_has_more BOOLEAN;
  v_quick TEXT;
  v_ops TEXT;
  v_rech TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mesa_bandeja: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_bandeja: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  v_limit := LEAST(100, GREATEST(1, coalesce(p_limit, 25)));
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');
  v_q_digits := nullif(regexp_replace(coalesce(v_q, ''), '\D', '', 'g'), '');
  v_quick := coalesce(nullif(btrim(p_quick_filter), ''), 'todos');
  v_ops := coalesce(nullif(btrim(p_ops_filter), ''), 'todo_mesa');
  v_rech := coalesce(nullif(btrim(p_rechazos_sub), ''), 'rechazados');

  WITH enriched AS (
    SELECT
      e.id,
      public.mesa_bandeja_sort_ts(e.id, e.fecha_envio_mesa, e.created_at) AS sort_ts,
      public.mesa_bandeja_categoria_resumen(e.id, e.fecha_envio_mesa) AS categoria,
      ops.assigned_to,
      ops.assigned_at,
      ops.estado_mesa::text AS estado_mesa,
      ops.last_activity_at,
      act.last_viewed_at,
      act.last_updated_at,
      nullif(btrim(pv.full_name), '') AS last_viewed_by_name,
      nullif(btrim(pu.full_name), '') AS last_updated_by_name,
      e.programa::text AS programa,
      e.nss::text AS nss,
      e.cliente_nombre,
      e.telefono_cliente,
      e.direccion_opcional,
      e.asesor_id,
      e.origen_mesa::text AS origen_mesa,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.motivo_rechazo,
      e.comentario_rechazo,
      e.fecha_cita,
      e.created_at,
      e.updated_at,
      e.expediente_anterior_id,
      e.reingreso_rechazo_id
    FROM public.expedientes e
    LEFT JOIN public.mesa_expediente_ops ops ON ops.expediente_id = e.id
    LEFT JOIN public.expediente_mesa_actividad act
      ON act.expediente_id = e.id
     AND act.organization_id = e.organization_id
    LEFT JOIN public.profiles pv ON pv.id = act.last_viewed_by
    LEFT JOIN public.profiles pu ON pu.id = act.last_updated_by
    WHERE e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND e.ciclo_estado IN ('activo', 'cancelado')
      AND public.can_see_expediente(e.id)
      AND (
        p_origen IS NULL OR p_origen = '' OR p_origen = 'todos'
        OR (p_origen = 'interno' AND coalesce(e.origen_mesa::text, 'interno') = 'interno')
        OR (p_origen = 'externo' AND e.origen_mesa::text = 'externo')
      )
      AND (
        v_q IS NULL
        OR e.cliente_nombre ILIKE '%' || v_q || '%'
        OR (
          v_q_digits IS NOT NULL
          AND regexp_replace(coalesce(e.telefono_cliente, ''), '\D', '', 'g')
            LIKE '%' || v_q_digits || '%'
        )
        OR (
          v_q_digits IS NOT NULL
          AND regexp_replace(coalesce(e.nss::text, ''), '\D', '', 'g')
            LIKE '%' || v_q_digits || '%'
        )
        OR coalesce(e.nss::text, '') ILIKE '%' || v_q || '%'
      )
      AND (p_etapa IS NULL OR e.etapa_actual = p_etapa::smallint)
      AND (
        p_subestado IS NULL OR p_subestado = '' OR p_subestado = 'todas'
        OR e.subestado::text = p_subestado
      )
      AND (
        NOT coalesce(p_solo_citas_hoy, false)
        OR (
          p_today_ymd IS NOT NULL
          AND to_char(
            (e.fecha_cita AT TIME ZONE 'America/Monterrey'),
            'YYYY-MM-DD'
          ) = p_today_ymd
        )
      )
  ),
  filtered AS (
    SELECT en.*
    FROM enriched en
    WHERE
      CASE v_quick
        WHEN 'todos' THEN en.ciclo_estado = 'activo'
        WHEN 'correccion_enviada' THEN
          en.ciclo_estado = 'activo' AND en.categoria = 'correccion_enviada'
        WHEN 'nuevos' THEN
          en.ciclo_estado = 'activo'
          AND en.etapa_actual IN (1, 2)
          AND en.subestado IN ('pendiente', 'en_validacion_mesa', 'en_proceso')
        WHEN 'en_proceso' THEN
          en.ciclo_estado = 'activo' AND en.subestado = 'en_proceso'
        WHEN 'rechazos_cancelaciones' THEN
          CASE v_rech
            WHEN 'cancelados' THEN en.ciclo_estado = 'cancelado'
            ELSE en.subestado = 'rechazado' AND en.ciclo_estado = 'activo'
          END
        ELSE en.ciclo_estado = 'activo'
      END
      AND CASE v_ops
        WHEN 'todo_mesa' THEN TRUE
        WHEN 'en_espera_asesor' THEN en.categoria = 'correccion_requerida'
        WHEN 'sin_asignar' THEN
          en.assigned_to IS NULL
          AND (en.estado_mesa IS NULL OR en.estado_mesa = 'sin_asignar')
          AND en.categoria IS DISTINCT FROM 'correccion_requerida'
        WHEN 'mi_bandeja' THEN
          en.assigned_to = v_uid AND en.categoria IS DISTINCT FROM 'correccion_requerida'
        WHEN 'en_trabajo' THEN
          en.assigned_to IS NOT NULL AND en.categoria IS DISTINCT FROM 'correccion_requerida'
        ELSE TRUE
      END
  ),
  counted AS (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  page AS (
    SELECT f.*
    FROM filtered f
    WHERE
      p_cursor_sort_ts IS NULL
      OR (f.sort_ts, f.id) > (p_cursor_sort_ts, p_cursor_id)
    ORDER BY f.sort_ts ASC, f.id ASC
    LIMIT (v_limit + 1)
  ),
  page_trim AS (
    SELECT * FROM (
      SELECT p.*, row_number() OVER (ORDER BY p.sort_ts ASC, p.id ASC) AS rn
      FROM page p
    ) x
    WHERE x.rn <= v_limit
  )
  SELECT
    c.total,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'programa', p.programa,
            'nss', p.nss,
            'cliente_nombre', p.cliente_nombre,
            'telefono_cliente', p.telefono_cliente,
            'direccion_opcional', p.direccion_opcional,
            'asesor_id', p.asesor_id,
            'origen_mesa', p.origen_mesa,
            'submitted_to_mesa', p.submitted_to_mesa,
            'fecha_envio_mesa', p.fecha_envio_mesa,
            'etapa_actual', p.etapa_actual,
            'subestado', p.subestado,
            'ciclo_estado', p.ciclo_estado,
            'motivo_rechazo', p.motivo_rechazo,
            'comentario_rechazo', p.comentario_rechazo,
            'fecha_cita', p.fecha_cita,
            'created_at', p.created_at,
            'updated_at', p.updated_at,
            'expediente_anterior_id', p.expediente_anterior_id,
            'reingreso_rechazo_id', p.reingreso_rechazo_id,
            'sort_ts', p.sort_ts,
            'categoria_resumen', p.categoria,
            'ops_assigned_to', p.assigned_to,
            'ops_assigned_at', p.assigned_at,
            'ops_estado_mesa', p.estado_mesa,
            'ops_last_activity_at', p.last_activity_at,
            'last_viewed_by_name', p.last_viewed_by_name,
            'last_viewed_at', p.last_viewed_at,
            'last_updated_by_name', p.last_updated_by_name,
            'last_updated_at', p.last_updated_at
          )
          ORDER BY p.sort_ts ASC, p.id ASC
        )
        FROM page_trim p
      ),
      '[]'::jsonb
    ),
    (SELECT p.sort_ts FROM page_trim p ORDER BY p.sort_ts DESC, p.id DESC LIMIT 1),
    (SELECT p.id FROM page_trim p ORDER BY p.sort_ts DESC, p.id DESC LIMIT 1),
    (SELECT count(*)::int FROM page)
  INTO v_total, v_items, v_last_sort, v_last_id, v_page_len
  FROM counted c;

  v_has_more := coalesce(v_page_len, 0) > v_limit;
  IF NOT v_has_more THEN
    v_last_sort := NULL;
    v_last_id := NULL;
  END IF;

  IF coalesce(p_include_counts, true) THEN
    SELECT jsonb_build_object(
      'correccionesEnviadas', count(*) FILTER (
        WHERE ciclo_estado = 'activo' AND categoria = 'correccion_enviada'
      ),
      'nuevos', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND etapa_actual IN (1, 2)
          AND subestado IN ('pendiente', 'en_validacion_mesa', 'en_proceso')
      ),
      'enProceso', count(*) FILTER (
        WHERE ciclo_estado = 'activo' AND subestado = 'en_proceso'
      ),
      'citasHoy', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND p_today_ymd IS NOT NULL
          AND to_char(
            (fecha_cita AT TIME ZONE 'America/Monterrey'),
            'YYYY-MM-DD'
          ) = p_today_ymd
      ),
      'rechazosCancelaciones', count(*) FILTER (
        WHERE (subestado = 'rechazado' AND ciclo_estado = 'activo')
           OR ciclo_estado = 'cancelado'
      ),
      'rechazados', count(*) FILTER (
        WHERE subestado = 'rechazado' AND ciclo_estado = 'activo'
      ),
      'cancelados', count(*) FILTER (WHERE ciclo_estado = 'cancelado'),
      'bloqueadosRechazados', count(*) FILTER (
        WHERE (subestado = 'rechazado' AND ciclo_estado = 'activo')
           OR (ciclo_estado = 'activo' AND categoria = 'correccion_requerida')
      ),
      'enValidacionMesa', count(*) FILTER (
        WHERE ciclo_estado = 'activo'
          AND subestado = 'en_validacion_mesa'
          AND categoria IS DISTINCT FROM 'correccion_enviada'
          AND categoria IS DISTINCT FROM 'correccion_requerida'
      ),
      'enEsperaAsesor', count(*) FILTER (
        WHERE ciclo_estado = 'activo' AND categoria = 'correccion_requerida'
      ),
      'totalBandeja', count(*) FILTER (WHERE ciclo_estado = 'activo')
    )
    INTO v_counts
    FROM (
      SELECT
        e.etapa_actual,
        e.subestado::text AS subestado,
        e.ciclo_estado::text AS ciclo_estado,
        e.fecha_cita,
        public.mesa_bandeja_categoria_resumen(e.id, e.fecha_envio_mesa) AS categoria
      FROM public.expedientes e
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.ciclo_estado IN ('activo', 'cancelado')
        AND public.can_see_expediente(e.id)
        AND (
          p_origen IS NULL OR p_origen = '' OR p_origen = 'todos'
          OR (p_origen = 'interno' AND coalesce(e.origen_mesa::text, 'interno') = 'interno')
          OR (p_origen = 'externo' AND e.origen_mesa::text = 'externo')
        )
    ) c;
  END IF;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', coalesce(v_total, 0),
    'has_more', v_has_more,
    'next_cursor', CASE
      WHEN v_has_more AND v_last_id IS NOT NULL THEN
        jsonb_build_object('sort_ts', v_last_sort, 'id', v_last_id)
      ELSE NULL
    END,
    'counts', v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_bandeja_doc_estatus(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_bandeja_categoria_resumen(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_bandeja_sort_ts(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_list_bandeja_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mesa_bandeja_doc_estatus(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_bandeja_categoria_resumen(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_bandeja_sort_ts(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_list_bandeja_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;

COMMENT ON FUNCTION public.mesa_list_bandeja_page(INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN) IS
  'P102/P127: bandeja paginada + last_viewed/last_updated Mesa (JOIN batch).';
