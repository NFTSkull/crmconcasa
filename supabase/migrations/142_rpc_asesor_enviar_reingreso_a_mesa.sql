-- ConCasa CRM — Reingreso manual del mismo expediente a Mesa (sin duplicar)
-- Migración 142. Campos genéricos separados de P071/P072 (reingreso_rechazo_id).
-- Transición operativa = misma que enviar_a_mesa (etapa 1 + en_validacion_mesa).

-- =============================================================================
-- 1. Columnas
-- =============================================================================
ALTER TABLE public.expedientes
  ADD COLUMN IF NOT EXISTS reingreso_manual_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reingreso_manual_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reingreso_manual_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.expedientes
  DROP CONSTRAINT IF EXISTS expedientes_reingreso_manual_count_chk;

ALTER TABLE public.expedientes
  ADD CONSTRAINT expedientes_reingreso_manual_count_chk
  CHECK (reingreso_manual_count >= 0);

COMMENT ON COLUMN public.expedientes.reingreso_manual_count IS
  'Contador de reingresos manuales del mismo expediente a Mesa (no P072).';
COMMENT ON COLUMN public.expedientes.reingreso_manual_at IS
  'Fecha/hora del último reingreso manual a Mesa.';
COMMENT ON COLUMN public.expedientes.reingreso_manual_by IS
  'Perfil (asesor) que ejecutó el último reingreso manual.';

CREATE INDEX IF NOT EXISTS expedientes_reingreso_manual_at_idx
  ON public.expedientes (organization_id, reingreso_manual_at DESC NULLS LAST)
  WHERE reingreso_manual_count > 0;

-- =============================================================================
-- 2. RPC asesor_enviar_reingreso_a_mesa
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
  v_docs_count INTEGER;
  v_etapa_anterior SMALLINT;
  v_subestado_anterior public.operativo_subestado;
  v_count INTEGER;
  v_now TIMESTAMPTZ := NOW();
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

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  -- Debe haber sido enviado antes (nunca en expediente nuevo).
  IF v_exp.submitted_to_mesa IS NOT TRUE OR v_exp.fecha_envio_mesa IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: el expediente nunca fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotencia doble clic / carrera: misma TX actor en ventana corta.
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
      'fecha_envio_mesa', v_exp.fecha_envio_mesa
    );
  END IF;

  -- Mismos gates de negocio que enviar_a_mesa (049), salvo el bloqueo «ya enviado».
  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: falta decisión del editor'
      USING ERRCODE = '22023';
  END IF;

  IF v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: monto aprobado del editor debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cliente
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: faltan datos del cliente'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.porcentaje_cobro IS NULL
     OR v_cliente.porcentaje_cobro <= 0
     OR v_cliente.monto_calculado IS NULL
     OR btrim(COALESCE(v_cliente.metodo_pago, '')) = '' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: Faltan datos obligatorios del cliente: porcentaje de cobro, monto calculado, método de pago.'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado NOT IN ('completo', 'validado') THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: datos del cliente deben estar completos o validados (actual: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);

  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: faltan documentos obligatorios de integración (% de %)', v_docs_count, cardinality(public.integration_doc_tipos_asesor_envio())
      USING ERRCODE = '22023';
  END IF;

  IF public.nss_bloqueado_en_mesa(v_exp.organization_id, v_exp.nss, v_exp.programa, p_expediente_id) THEN
    RAISE EXCEPTION 'NSS_YA_BLOQUEADO: Este NSS ya tiene un expediente enviado a Mesa.'
      USING ERRCODE = '23505';
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;
  v_count := v_exp.reingreso_manual_count + 1;

  -- Misma transición que enviar_a_mesa + marca de reingreso manual. Sin INSERT.
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
    -- Carrera: otra TX ya incrementó; releer y responder idempotente.
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
      'fecha_envio_mesa', v_exp.fecha_envio_mesa
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
      'documentos_obligatorios_count', v_docs_count
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
    'fecha_envio_mesa', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID)
  TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.asesor_enviar_reingreso_a_mesa(UUID) IS
  'Reingreso manual del mismo expediente a Mesa; incrementa reingreso_manual_* y aplica transición de enviar_a_mesa. No crea expediente.';

-- =============================================================================
-- 3. Bandeja Mesa: exponer campos de reingreso manual
-- =============================================================================
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
      e.reingreso_rechazo_id,
      e.reingreso_manual_count,
      e.reingreso_manual_at,
      e.reingreso_manual_by
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
            'reingreso_manual_count', p.reingreso_manual_count,
            'reingreso_manual_at', p.reingreso_manual_at,
            'reingreso_manual_by', p.reingreso_manual_by,
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


REVOKE ALL ON FUNCTION public.mesa_list_bandeja_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesa_list_bandeja_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;
