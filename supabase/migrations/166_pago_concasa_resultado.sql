-- ConCasa CRM — Pago ConCasa: resultado operativo Sí pagó / No pagó
-- Firmado (interna 11 / visible 10) → Pago a ConCasa (interna 12 / visible 11)
-- con persistencia canónica `pago_concasa_resultado` ∈ {pagado, no_pagado}.
-- No muta montos, documentos, citas, bookings ni precalificación.
-- `no_pagado` NO es rechazo: no regresa etapas ni cancela el expediente.
-- Ingresos reconocidos (P134) solo cuando resultado = pagado.

-- ---------------------------------------------------------------------------
-- A) Columnas en expedientes
-- ---------------------------------------------------------------------------
ALTER TABLE public.expedientes
  ADD COLUMN IF NOT EXISTS pago_concasa_resultado TEXT,
  ADD COLUMN IF NOT EXISTS pago_concasa_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pago_concasa_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expedientes_pago_concasa_resultado_check'
      AND conrelid = 'public.expedientes'::regclass
  ) THEN
    ALTER TABLE public.expedientes
      ADD CONSTRAINT expedientes_pago_concasa_resultado_check
      CHECK (
        pago_concasa_resultado IS NULL
        OR pago_concasa_resultado IN ('pagado', 'no_pagado')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.expedientes.pago_concasa_resultado IS
  'Resultado operativo final Pago ConCasa: pagado | no_pagado. No implica movimiento bancario.';
COMMENT ON COLUMN public.expedientes.pago_concasa_at IS
  'Timestamp de registro del resultado Pago ConCasa.';
COMMENT ON COLUMN public.expedientes.pago_concasa_by IS
  'Actor Mesa/super_admin que registró el resultado Pago ConCasa.';

-- ---------------------------------------------------------------------------
-- B) Gate: 11→12 exige resultado (bloquea avanzar_etapa_operativa legado)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.__tg_require_pago_concasa_resultado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.etapa_actual IS DISTINCT FROM 11 OR NEW.etapa_actual IS DISTINCT FROM 12 THEN
    RETURN NEW;
  END IF;

  IF NEW.pago_concasa_resultado IS NULL
     OR NEW.pago_concasa_resultado NOT IN ('pagado', 'no_pagado') THEN
    RAISE EXCEPTION
      'decidir_pago_concasa: se requiere resultado pagado|no_pagado para avanzar a Pago ConCasa'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_require_pago_concasa_resultado ON public.expedientes;
CREATE TRIGGER tg_require_pago_concasa_resultado
  BEFORE UPDATE OF etapa_actual ON public.expedientes
  FOR EACH ROW
  EXECUTE FUNCTION public.__tg_require_pago_concasa_resultado();

COMMENT ON FUNCTION public.__tg_require_pago_concasa_resultado() IS
  'Exige pago_concasa_resultado al pasar de etapa 11 a 12; el camino canónico es decidir_pago_concasa.';

-- ---------------------------------------------------------------------------
-- C) Ingresos P134: no reconocer ingreso si No pagó
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.__tg_ingresos_on_11_12()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF OLD.etapa_actual IS DISTINCT FROM 11 OR NEW.etapa_actual IS DISTINCT FROM 12 THEN
    RETURN NEW;
  END IF;

  -- Solo `pagado` cuenta como ingreso reconocido. `no_pagado` avanza etapa sin snapshot.
  IF NEW.pago_concasa_resultado IS DISTINCT FROM 'pagado' THEN
    RETURN NEW;
  END IF;

  v_actor := public.current_profile_id();

  PERFORM public.ingresos_reconocer_pago_concasa(
    NEW.id,
    NEW.organization_id,
    v_actor,
    'avance_11_12',
    clock_timestamp(),
    false,
    true
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.__tg_ingresos_on_11_12() IS
  'P134+P166: al avanzar 11→12 con resultado=pagado reconoce ingreso; no_pagado no crea snapshot.';

-- ---------------------------------------------------------------------------
-- D) RPC canónica
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decidir_pago_concasa(
  p_expediente_id UUID,
  p_resultado TEXT,
  p_comentario TEXT DEFAULT NULL
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
  v_resultado TEXT;
  v_comentario_final TEXT;
  v_subestado_anterior public.operativo_subestado;
  v_subestado_nuevo public.operativo_subestado := 'en_proceso';
  v_action TEXT;
  v_at TIMESTAMPTZ := clock_timestamp();
  v_monto_before NUMERIC;
  v_docs_before INTEGER;
  v_booking_before INTEGER;
  v_asesor_before UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'decidir_pago_concasa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decidir_pago_concasa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'decidir_pago_concasa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'decidir_pago_concasa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_resultado := lower(btrim(COALESCE(p_resultado, '')));
  IF v_resultado NOT IN ('pagado', 'no_pagado') THEN
    RAISE EXCEPTION 'decidir_pago_concasa: resultado inválido (use pagado|no_pagado)'
      USING ERRCODE = '22023';
  END IF;

  v_comentario_final := NULLIF(btrim(COALESCE(p_comentario, '')), '');

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.pago_concasa_resultado,
    e.pago_concasa_at,
    e.pago_concasa_by,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decidir_pago_concasa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'decidir_pago_concasa: expediente eliminado'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id
     AND v_actor_role <> 'super_admin' THEN
    RAISE EXCEPTION 'decidir_pago_concasa: expediente fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'decidir_pago_concasa: expediente no activo (ciclo: %)', v_exp.ciclo_estado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'decidir_pago_concasa: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotencia: ya finalizado con el mismo resultado
  IF v_exp.etapa_actual = 12
     AND v_exp.pago_concasa_resultado IS NOT DISTINCT FROM v_resultado THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'expediente_id', p_expediente_id,
      'etapa_anterior', 11,
      'etapa_actual', 12,
      'subestado', v_exp.subestado,
      'pago_concasa_resultado', v_exp.pago_concasa_resultado,
      'pago_concasa_at', v_exp.pago_concasa_at,
      'pago_concasa_by', v_exp.pago_concasa_by,
      'transition', '11_12'
    );
  END IF;

  -- No permitir cambio silencioso de resultado
  IF v_exp.etapa_actual = 12
     AND v_exp.pago_concasa_resultado IS NOT NULL
     AND v_exp.pago_concasa_resultado IS DISTINCT FROM v_resultado THEN
    RAISE EXCEPTION
      'decidir_pago_concasa: el expediente ya tiene resultado %; no se puede cambiar a %',
      v_exp.pago_concasa_resultado, v_resultado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual IS DISTINCT FROM 11 THEN
    RAISE EXCEPTION 'decidir_pago_concasa: etapa incorrecta (actual: %, se requiere 11)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado IS DISTINCT FROM 'en_proceso' THEN
    RAISE EXCEPTION 'decidir_pago_concasa: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  -- Snapshots de no-mutación (asserts en tests)
  SELECT cd.monto_mejoravit_actualizado INTO v_monto_before
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  SELECT COUNT(*)::int INTO v_docs_before
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.deleted_at IS NULL;

  SELECT COUNT(*)::int INTO v_booking_before
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id;

  v_asesor_before := v_exp.asesor_id;
  v_subestado_anterior := v_exp.subestado;

  UPDATE public.expedientes
  SET
    etapa_actual = 12,
    subestado = v_subestado_nuevo,
    pago_concasa_resultado = v_resultado,
    pago_concasa_at = v_at,
    pago_concasa_by = v_actor_id,
    updated_at = v_at
  WHERE id = p_expediente_id
    AND etapa_actual = 11
    AND ciclo_estado = 'activo'
    AND pago_concasa_resultado IS NULL;

  IF NOT FOUND THEN
    -- Carrera: releer
    SELECT
      e.etapa_actual,
      e.subestado,
      e.pago_concasa_resultado,
      e.pago_concasa_at,
      e.pago_concasa_by
    INTO
      v_exp.etapa_actual,
      v_exp.subestado,
      v_exp.pago_concasa_resultado,
      v_exp.pago_concasa_at,
      v_exp.pago_concasa_by
    FROM public.expedientes e
    WHERE e.id = p_expediente_id;

    IF v_exp.etapa_actual = 12
       AND v_exp.pago_concasa_resultado IS NOT DISTINCT FROM v_resultado THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'expediente_id', p_expediente_id,
        'etapa_anterior', 11,
        'etapa_actual', 12,
        'subestado', v_exp.subestado,
        'pago_concasa_resultado', v_exp.pago_concasa_resultado,
        'pago_concasa_at', v_exp.pago_concasa_at,
        'pago_concasa_by', v_exp.pago_concasa_by,
        'transition', '11_12'
      );
    END IF;

    RAISE EXCEPTION 'decidir_pago_concasa: no se pudo registrar el resultado (estado actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  v_action := CASE
    WHEN v_resultado = 'pagado' THEN 'expediente.pago_concasa.pagado'
    ELSE 'expediente.pago_concasa.no_pagado'
  END;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    v_action,
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'etapa_anterior', 11,
      'etapa_nueva', 12,
      'subestado_anterior', v_subestado_anterior,
      'subestado_nuevo', v_subestado_nuevo,
      'resultado', v_resultado,
      'pago_concasa_at', v_at,
      'comentario', v_comentario_final,
      'transition', '11_12',
      'monto_before', v_monto_before,
      'docs_before', v_docs_before,
      'bookings_before', v_booking_before,
      'asesor_before', v_asesor_before
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'expediente_id', p_expediente_id,
    'etapa_anterior', 11,
    'etapa_actual', 12,
    'subestado', v_subestado_nuevo,
    'pago_concasa_resultado', v_resultado,
    'pago_concasa_at', v_at,
    'pago_concasa_by', v_actor_id,
    'transition', '11_12'
  );
END;
$$;

COMMENT ON FUNCTION public.decidir_pago_concasa(UUID, TEXT, TEXT) IS
  'Mesa: decide Sí pagó / No pagó y avanza Firmado(11)→Pago ConCasa(12). Idempotente; no cambia resultado previo.';

REVOKE ALL ON FUNCTION public.decidir_pago_concasa(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decidir_pago_concasa(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.decidir_pago_concasa(UUID, TEXT, TEXT)
  TO authenticated, service_role, postgres;


-- E) Bandeja Mesa: incluir pago_concasa_resultado en items
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
      e.reingreso_manual_by,
      e.pago_concasa_resultado
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
            'pago_concasa_resultado', p.pago_concasa_resultado,
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


-- F) Inbox asesor: exponer resultado Pago ConCasa
CREATE OR REPLACE FUNCTION public.asesor_list_expedientes_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_buscar TEXT DEFAULT NULL,
  p_decision TEXT DEFAULT NULL,
  p_estatus_operativo TEXT DEFAULT NULL,
  p_resultado_real TEXT DEFAULT NULL,
  p_programa TEXT DEFAULT NULL,
  p_etapa_exacta INTEGER DEFAULT NULL,
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_quick_filter TEXT DEFAULT 'todos'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_active BOOLEAN;
  v_page INTEGER;
  v_size INTEGER;
  v_from INTEGER;
  v_quick TEXT;
  v_total BIGINT;
  v_items JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_list_expedientes_page: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active
  INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_list_expedientes_page: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_from := (v_page - 1) * v_size;
  v_quick := lower(trim(coalesce(nullif(p_quick_filter, ''), 'todos')));

  WITH base AS (
    SELECT
      e.id,
      e.programa,
      public.asesor_inbox_programa_ui(e.programa) AS programa_ui,
      e.nss::text AS nss,
      e.cliente_nombre,
      e.telefono_cliente::text AS telefono_cliente,
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
      e.firma_agendable_desde,
      e.pago_concasa_resultado,
      e.pago_concasa_at,
      e.created_at,
      e.updated_at,
      e.expediente_anterior_id,
      e.reingreso_rechazo_id,
      e.reingreso_manual_count,
      e.reingreso_manual_at,
      e.reingreso_manual_by,
      e.reprecalificacion_pendiente_id,
      coalesce(ed.decision::text, 'pendiente') AS decision,
      ed.monto_aprobado,
      coalesce(ed.notas_revision, '') AS notas_revision,
      ed.aprobado_at,
      ed.monto_aprobado_al_aprobar,
      ed.no_cumple_at,
      public.asesor_inbox_resultado_real(
        e.submitted_to_mesa,
        e.subestado::text,
        e.ciclo_estado::text,
        ed.decision::text
      ) AS resultado_real,
      public.asesor_inbox_categoria_correccion(e.id) AS categoria_correccion,
      public.asesor_inbox_pendiente_agendar_biometricos(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_biometricos,
      public.asesor_inbox_pendiente_agendar_firma(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_firma,
      public.asesor_inbox_pendiente_subir_acuse(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_subir_acuse
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_actor
  ),
  filtered AS (
    SELECT b.*
    FROM base b
    WHERE public.asesor_inbox_matches_buscar(
        b.cliente_nombre, b.nss, b.telefono_cliente, b.programa_ui, p_buscar
      )
      AND (
        p_decision IS NULL OR trim(p_decision) = ''
        OR b.decision = trim(p_decision)
      )
      AND (
        p_estatus_operativo IS NULL OR trim(p_estatus_operativo) = ''
        OR coalesce(b.subestado, 'pendiente') = trim(p_estatus_operativo)
      )
      AND (
        p_resultado_real IS NULL OR trim(p_resultado_real) = ''
        OR b.resultado_real = trim(p_resultado_real)
      )
      AND (
        p_programa IS NULL OR trim(p_programa) = ''
        OR b.programa_ui = trim(p_programa)
      )
      AND (
        p_etapa_exacta IS NULL
        OR b.etapa_actual = p_etapa_exacta::smallint
      )
      AND (
        p_fecha_desde IS NULL
        OR b.created_at >= (p_fecha_desde::timestamp AT TIME ZONE 'America/Monterrey')
      )
      AND (
        p_fecha_hasta IS NULL
        OR b.created_at <= (
          (p_fecha_hasta::timestamp + interval '1 day' - interval '1 millisecond')
            AT TIME ZONE 'America/Monterrey'
        )
      )
      AND (
        v_quick = 'todos'
        OR coalesce(b.ciclo_estado, '') IS DISTINCT FROM 'cerrado'
      )
      AND CASE v_quick
        WHEN 'todos' THEN TRUE
        WHEN 'en_tramite' THEN
          b.resultado_real = 'en_tramite'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_requerida'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_enviada'
        WHEN 'correccion_requerida' THEN b.categoria_correccion = 'correccion_requerida'
        WHEN 'correccion_enviada' THEN b.categoria_correccion = 'correccion_enviada'
        WHEN 'rechazados_mesa' THEN b.resultado_real = 'rechazado_mesa'
        WHEN 'cancelados' THEN b.resultado_real = 'cancelado'
        WHEN 'agendar_biometricos' THEN b.pendiente_agendar_biometricos
        WHEN 'agendar_firma' THEN b.pendiente_agendar_firma
        WHEN 'subir_acuse' THEN b.pendiente_subir_acuse
        ELSE TRUE
      END
  ),
  counted AS (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  page AS (
    SELECT
      f.id,
      f.programa_ui AS programa,
      f.programa::text AS programa_db,
      f.nss,
      f.cliente_nombre,
      f.telefono_cliente,
      f.direccion_opcional,
      f.asesor_id,
      f.origen_mesa,
      f.submitted_to_mesa,
      f.fecha_envio_mesa,
      f.etapa_actual,
      f.subestado,
      f.ciclo_estado,
      f.motivo_rechazo,
      f.comentario_rechazo,
      f.fecha_cita,
      f.firma_agendable_desde,
      f.pago_concasa_resultado,
      f.pago_concasa_at,
      f.created_at,
      f.updated_at,
      f.expediente_anterior_id,
      f.reingreso_rechazo_id,
      f.reingreso_manual_count,
      f.reingreso_manual_at,
      f.reingreso_manual_by,
      f.reprecalificacion_pendiente_id,
      f.decision,
      f.monto_aprobado,
      f.notas_revision,
      f.aprobado_at,
      f.monto_aprobado_al_aprobar,
      f.no_cumple_at,
      f.resultado_real,
      f.categoria_correccion
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    OFFSET v_from
    LIMIT v_size
  )
  SELECT
    c.total,
    coalesce(
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC, p.id DESC) FROM page p),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM counted c;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', v_total,
    'page', v_page,
    'page_size', v_size,
    'has_more', (v_from + v_size) < v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT
) TO authenticated;
