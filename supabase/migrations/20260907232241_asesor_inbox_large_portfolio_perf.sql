-- ConCasa CRM — rendimiento inbox asesor para portafolios grandes.
-- Read-model only: 0 UPDATE / 0 backfill / 0 cambios de negocio.
--
-- Causa observada en producción: asesores con >1k expedientes ejecutan
-- categoria_correccion + estado_efectivo sobre todo el universo incluso cuando
-- la página visible solo necesita 25 filas. Esto puede alcanzar statement_timeout.
--
-- Estrategia:
-- 1) quick=todos: aplicar filtros/paginación baratos primero y enriquecer solo la página.
-- 2) quick accionable: estado/pending siguen gobernando el filtro, pero categoría y
--    resumen de corrección se calculan solo después del LIMIT.
-- 3) summary: categoria_correccion solo se evalúa para filas donde una notificación
--    realmente la consulta. El contrato JSON permanece idéntico.

CREATE OR REPLACE FUNCTION public.asesor_list_expedientes_page(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_buscar text DEFAULT NULL::text,
  p_decision text DEFAULT NULL::text,
  p_estatus_operativo text DEFAULT NULL::text,
  p_resultado_real text DEFAULT NULL::text,
  p_programa text DEFAULT NULL::text,
  p_etapa_exacta integer DEFAULT NULL::integer,
  p_fecha_desde date DEFAULT NULL::date,
  p_fecha_hasta date DEFAULT NULL::date,
  p_quick_filter text DEFAULT 'todos'::text,
  p_owner_asesor_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '25s'
AS $function$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_active BOOLEAN;
  v_page INTEGER;
  v_size INTEGER;
  v_from INTEGER;
  v_quick TEXT;
  v_owner UUID;
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

  v_owner := coalesce(p_owner_asesor_id, v_actor);
  IF v_owner IS DISTINCT FROM v_actor THEN
    IF NOT public.profile_has_capability(v_actor, 'integrate_for_any_advisor') THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: sin capability integrate_for_any_advisor'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.asesor_comparten_equipo_activo(v_actor, v_owner) THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: asesor titular fuera de equipo compartido'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- En "todos" ningún quick-filter depende de estado/categoría. Por eso podemos
  -- decidir los 25 visibles antes de invocar los helpers caros.
  IF v_quick = 'todos' THEN
    WITH cheap AS (
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
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN 'pending'
          WHEN last_real.decision = 'aprobado' THEN 'approved'
          WHEN last_real.decision = 'no_cumple' THEN 'no_cumple'
          ELSE NULL
        END AS reprecal_estado,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
          ELSE NULL
        END AS reprecal_solicitada_at,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
          ELSE last_real.decided_at
        END AS reprecal_resuelta_at,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
          ELSE last_real.decided_at
        END AS reprecal_activity_at,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.monto_aprobado_previo
          ELSE last_real.monto_aprobado_previo
        END AS reprecal_monto_previo,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
          WHEN last_real.decision = 'aprobado' THEN last_real.monto_aprobado
          ELSE NULL
        END AS reprecal_monto_resultado,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.programa_solicitado::text
          ELSE last_real.programa_solicitado::text
        END AS reprecal_programa_solicitado,
        coalesce(
          CASE
            WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
            ELSE last_real.decided_at
          END,
          e.created_at
        ) AS inbox_sort_at
      FROM public.expedientes e
      LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
      LEFT JOIN public.expediente_precalificacion_intentos pend
        ON pend.id = e.reprecalificacion_pendiente_id
      LEFT JOIN LATERAL (
        SELECT
          i.decision,
          i.created_at,
          i.decided_at,
          i.monto_aprobado,
          i.monto_aprobado_previo,
          i.programa_solicitado
        FROM public.expediente_precalificacion_intentos i
        WHERE e.reprecalificacion_pendiente_id IS NULL
          AND i.expediente_id = e.id
          AND i.decision IN (
            'aprobado'::public.editor_decision,
            'no_cumple'::public.editor_decision
          )
          AND (
            i.decision_previa IS NOT NULL
            OR nullif(btrim(coalesce(i.idempotency_key, '')), '') IS NOT NULL
          )
        ORDER BY i.decided_at DESC NULLS LAST, i.created_at DESC, i.id DESC
        LIMIT 1
      ) last_real ON TRUE
      WHERE e.deleted_at IS NULL
        AND e.asesor_id = v_owner
    ),
    filtered AS MATERIALIZED (
      SELECT c.*
      FROM cheap c
      WHERE public.asesor_inbox_matches_buscar(
          c.cliente_nombre, c.nss, c.telefono_cliente, c.programa_ui, p_buscar
        )
        AND (
          p_decision IS NULL OR trim(p_decision) = ''
          OR c.decision = trim(p_decision)
        )
        AND (
          p_estatus_operativo IS NULL OR trim(p_estatus_operativo) = ''
          OR coalesce(c.subestado, 'pendiente') = trim(p_estatus_operativo)
        )
        AND (
          p_resultado_real IS NULL OR trim(p_resultado_real) = ''
          OR c.resultado_real = trim(p_resultado_real)
        )
        AND (
          p_programa IS NULL OR trim(p_programa) = ''
          OR c.programa_ui = trim(p_programa)
        )
        AND (
          p_etapa_exacta IS NULL
          OR c.etapa_actual = p_etapa_exacta::smallint
        )
        AND (
          p_fecha_desde IS NULL
          OR c.created_at >= (p_fecha_desde::timestamp AT TIME ZONE 'America/Monterrey')
        )
        AND (
          p_fecha_hasta IS NULL
          OR c.created_at <= (
            (p_fecha_hasta::timestamp + interval '1 day' - interval '1 millisecond')
              AT TIME ZONE 'America/Monterrey'
          )
        )
    ),
    counted AS MATERIALIZED (
      SELECT count(*)::bigint AS total FROM filtered
    ),
    candidate AS MATERIALIZED (
      SELECT f.*
      FROM filtered f
      ORDER BY f.inbox_sort_at DESC, f.id DESC
      OFFSET v_from
      LIMIT v_size
    ),
    enriched AS (
      SELECT
        c.*,
        public.asesor_inbox_categoria_correccion(c.id) AS categoria_correccion,
        eff.estado_efectivo,
        CASE
          WHEN eff.estado_efectivo = 'correccion_requerida'
          THEN public.asesor_inbox_format_correccion_explicacion(
            public.asesor_inbox_correccion_labels_vigentes(c.id)
          )
          ELSE NULL
        END AS correccion_explicacion,
        CASE
          WHEN eff.estado_efectivo = 'correccion_requerida'
          THEN public.asesor_inbox_correccion_resumen(c.id)
          ELSE NULL
        END AS correccion_resumen
      FROM candidate c
      LEFT JOIN LATERAL (
        SELECT public.asesor_inbox_estado_efectivo(c.id) AS estado_efectivo
      ) eff ON TRUE
    ),
    page AS (
      SELECT
        e.id,
        e.programa_ui AS programa,
        e.programa::text AS programa_db,
        e.nss,
        e.cliente_nombre,
        e.telefono_cliente,
        e.direccion_opcional,
        e.asesor_id,
        e.origen_mesa,
        e.submitted_to_mesa,
        e.fecha_envio_mesa,
        e.etapa_actual,
        e.subestado,
        e.ciclo_estado,
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
        e.decision,
        e.monto_aprobado,
        e.notas_revision,
        e.aprobado_at,
        e.monto_aprobado_al_aprobar,
        e.no_cumple_at,
        e.resultado_real,
        e.categoria_correccion,
        e.estado_efectivo,
        e.correccion_explicacion,
        e.correccion_resumen,
        e.reprecal_estado,
        e.reprecal_solicitada_at,
        e.reprecal_resuelta_at,
        e.reprecal_activity_at,
        e.reprecal_monto_previo,
        e.reprecal_monto_resultado,
        e.reprecal_programa_solicitado,
        e.inbox_sort_at
      FROM enriched e
    )
    SELECT
      c.total,
      coalesce(
        (
          SELECT jsonb_agg(
            (to_jsonb(p) - 'inbox_sort_at')
            ORDER BY p.inbox_sort_at DESC, p.id DESC
          )
          FROM page p
        ),
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
  END IF;

  -- Filtros accionables: estado/pending sí forman parte del filtro. Se calculan
  -- sobre el universo, pero categoría/explicación solo para la página resultante.
  WITH cheap AS (
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
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN 'pending'
        WHEN last_real.decision = 'aprobado' THEN 'approved'
        WHEN last_real.decision = 'no_cumple' THEN 'no_cumple'
        ELSE NULL
      END AS reprecal_estado,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
        ELSE NULL
      END AS reprecal_solicitada_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
        ELSE last_real.decided_at
      END AS reprecal_resuelta_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
        ELSE last_real.decided_at
      END AS reprecal_activity_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.monto_aprobado_previo
        ELSE last_real.monto_aprobado_previo
      END AS reprecal_monto_previo,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
        WHEN last_real.decision = 'aprobado' THEN last_real.monto_aprobado
        ELSE NULL
      END AS reprecal_monto_resultado,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.programa_solicitado::text
        ELSE last_real.programa_solicitado::text
      END AS reprecal_programa_solicitado,
      coalesce(
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
          ELSE last_real.decided_at
        END,
        e.created_at
      ) AS inbox_sort_at
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    LEFT JOIN public.expediente_precalificacion_intentos pend
      ON pend.id = e.reprecalificacion_pendiente_id
    LEFT JOIN LATERAL (
      SELECT
        i.decision,
        i.created_at,
        i.decided_at,
        i.monto_aprobado,
        i.monto_aprobado_previo,
        i.programa_solicitado
      FROM public.expediente_precalificacion_intentos i
      WHERE e.reprecalificacion_pendiente_id IS NULL
        AND i.expediente_id = e.id
        AND i.decision IN (
          'aprobado'::public.editor_decision,
          'no_cumple'::public.editor_decision
        )
        AND (
          i.decision_previa IS NOT NULL
          OR nullif(btrim(coalesce(i.idempotency_key, '')), '') IS NOT NULL
        )
      ORDER BY i.decided_at DESC NULLS LAST, i.created_at DESC, i.id DESC
      LIMIT 1
    ) last_real ON TRUE
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_owner
  ),
  classified AS MATERIALIZED (
    SELECT
      c.*,
      eff.estado_efectivo,
      public.asesor_inbox_pendiente_agendar_biometricos(
        c.submitted_to_mesa, c.etapa_actual, c.id
      ) AS pendiente_agendar_biometricos,
      public.asesor_inbox_pendiente_agendar_firma(
        c.submitted_to_mesa, c.etapa_actual, c.id
      ) AS pendiente_agendar_firma,
      public.asesor_inbox_pendiente_subir_acuse(
        c.submitted_to_mesa, c.etapa_actual, c.id
      ) AS pendiente_subir_acuse
    FROM cheap c
    LEFT JOIN LATERAL (
      SELECT public.asesor_inbox_estado_efectivo(c.id) AS estado_efectivo
    ) eff ON TRUE
  ),
  filtered AS MATERIALIZED (
    SELECT b.*
    FROM classified b
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
      AND coalesce(b.ciclo_estado, '') IS DISTINCT FROM 'cerrado'
      AND CASE v_quick
        WHEN 'en_tramite' THEN b.estado_efectivo = 'en_tramite'
        WHEN 'correccion_requerida' THEN b.estado_efectivo = 'correccion_requerida'
        WHEN 'correccion_enviada' THEN b.estado_efectivo = 'correccion_enviada'
        WHEN 'rechazados_mesa' THEN b.estado_efectivo = 'rechazado_mesa'
        WHEN 'cancelados' THEN b.estado_efectivo = 'cancelado'
        WHEN 'agendar_biometricos' THEN b.pendiente_agendar_biometricos
        WHEN 'agendar_firma' THEN b.pendiente_agendar_firma
        WHEN 'subir_acuse' THEN b.pendiente_subir_acuse
        ELSE TRUE
      END
  ),
  counted AS MATERIALIZED (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  candidate AS MATERIALIZED (
    SELECT f.*
    FROM filtered f
    ORDER BY f.inbox_sort_at DESC, f.id DESC
    OFFSET v_from
    LIMIT v_size
  ),
  enriched AS (
    SELECT
      c.*,
      public.asesor_inbox_categoria_correccion(c.id) AS categoria_correccion,
      CASE
        WHEN c.estado_efectivo = 'correccion_requerida'
        THEN public.asesor_inbox_format_correccion_explicacion(
          public.asesor_inbox_correccion_labels_vigentes(c.id)
        )
        ELSE NULL
      END AS correccion_explicacion,
      CASE
        WHEN c.estado_efectivo = 'correccion_requerida'
        THEN public.asesor_inbox_correccion_resumen(c.id)
        ELSE NULL
      END AS correccion_resumen
    FROM candidate c
  ),
  page AS (
    SELECT
      e.id,
      e.programa_ui AS programa,
      e.programa::text AS programa_db,
      e.nss,
      e.cliente_nombre,
      e.telefono_cliente,
      e.direccion_opcional,
      e.asesor_id,
      e.origen_mesa,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.subestado,
      e.ciclo_estado,
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
      e.decision,
      e.monto_aprobado,
      e.notas_revision,
      e.aprobado_at,
      e.monto_aprobado_al_aprobar,
      e.no_cumple_at,
      e.resultado_real,
      e.categoria_correccion,
      e.estado_efectivo,
      e.correccion_explicacion,
      e.correccion_resumen,
      e.reprecal_estado,
      e.reprecal_solicitada_at,
      e.reprecal_resuelta_at,
      e.reprecal_activity_at,
      e.reprecal_monto_previo,
      e.reprecal_monto_resultado,
      e.reprecal_programa_solicitado,
      e.inbox_sort_at
    FROM enriched e
  )
  SELECT
    c.total,
    coalesce(
      (
        SELECT jsonb_agg(
          (to_jsonb(p) - 'inbox_sort_at')
          ORDER BY p.inbox_sort_at DESC, p.id DESC
        )
        FROM page p
      ),
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
$function$;

CREATE OR REPLACE FUNCTION public.asesor_inbox_summary(p_notif_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '25s'
AS $function$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_active BOOLEAN;
  v_limit INTEGER;
  v_today TEXT;
  v_counts JSONB;
  v_programas JSONB;
  v_notifs JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_inbox_summary: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active
  INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_inbox_summary: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  v_limit := LEAST(100, GREATEST(1, coalesce(p_notif_limit, 50)));
  v_today := to_char(
    (now() AT TIME ZONE 'America/Monterrey')::date,
    'YYYY-MM-DD'
  );

  WITH base AS MATERIALIZED (
    SELECT
      e.id,
      e.cliente_nombre,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.fecha_cita,
      e.updated_at,
      public.asesor_inbox_programa_ui(e.programa) AS programa_ui,
      public.asesor_inbox_resultado_real(
        e.submitted_to_mesa,
        e.subestado::text,
        e.ciclo_estado::text,
        ed.decision::text
      ) AS resultado_real,
      public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo,
      public.asesor_inbox_pendiente_agendar_biometricos(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_biometricos,
      public.asesor_inbox_pendiente_agendar_firma(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_firma,
      public.asesor_inbox_pendiente_subir_acuse(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_subir_acuse,
      cd.estado::text AS cliente_datos_estado
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    LEFT JOIN public.cliente_datos cd ON cd.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_actor
  ),
  agg AS (
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE resultado_real = 'aprobado_editor')::bigint AS aprobados_editor,
      count(*) FILTER (WHERE resultado_real = 'no_cumple_editor')::bigint AS no_cumple,
      count(*) FILTER (WHERE estado_efectivo = 'en_tramite')::bigint AS en_tramite,
      count(*) FILTER (WHERE estado_efectivo = 'rechazado_mesa')::bigint AS rechazados_mesa,
      count(*) FILTER (WHERE estado_efectivo = 'cancelado')::bigint AS cancelados,
      count(*) FILTER (WHERE estado_efectivo = 'correccion_requerida')::bigint AS correccion_requerida,
      count(*) FILTER (WHERE estado_efectivo = 'correccion_enviada')::bigint AS correccion_enviada,
      count(*) FILTER (WHERE pendiente_agendar_biometricos)::bigint AS agendar_biometricos,
      count(*) FILTER (WHERE pendiente_agendar_firma)::bigint AS agendar_firma,
      count(*) FILTER (WHERE pendiente_subir_acuse)::bigint AS subir_acuse
    FROM base
  ),
  programas AS (
    SELECT coalesce(
      jsonb_agg(DISTINCT programa_ui ORDER BY programa_ui),
      '[]'::jsonb
    ) AS arr
    FROM base
    WHERE trim(coalesce(programa_ui, '')) <> ''
  ),
  notif_base AS MATERIALIZED (
    SELECT
      b.*,
      CASE
        WHEN b.estado_efectivo = 'correccion_requerida'
          OR (
            b.ciclo_estado IS DISTINCT FROM 'cancelado'
            AND b.submitted_to_mesa
            AND coalesce(b.subestado, '') = 'en_validacion_mesa'
          )
        THEN public.asesor_inbox_categoria_correccion(b.id)
        ELSE NULL
      END AS categoria_correccion
    FROM base b
  ),
  notif_raw AS (
    SELECT
      b.id AS expediente_id,
      b.cliente_nombre,
      cand.kind,
      cand.tipo_label,
      cand.mensaje,
      cand.fecha,
      cand.prioridad,
      '/asesor/expediente/' || b.id::text AS href
    FROM notif_base b
    CROSS JOIN LATERAL (
      SELECT kind, tipo_label, mensaje, fecha, prioridad
      FROM (
        SELECT
          'cancelado'::text AS kind,
          'Expediente cancelado'::text AS tipo_label,
          'Expediente cancelado (terminal) — solo lectura'::text AS mensaje,
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita) AS fecha,
          1 AS prioridad
        WHERE b.ciclo_estado = 'cancelado'

        UNION ALL
        SELECT
          'correccion_requerida',
          'Corrección requerida',
          CASE
            WHEN b.cliente_datos_estado = 'rechazado'
                 AND b.categoria_correccion = 'correccion_requerida'
              THEN 'Datos generales y documentos requieren corrección'
            WHEN b.cliente_datos_estado = 'rechazado'
              THEN 'Datos generales requieren corrección'
            ELSE 'Documentos requieren corrección'
          END,
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita),
          1
        WHERE b.estado_efectivo = 'correccion_requerida'

        UNION ALL
        SELECT
          'rechazado_mesa',
          'Rechazado por Mesa',
          'Expediente rechazado o bloqueado por Mesa',
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita),
          2
        WHERE b.estado_efectivo = 'rechazado_mesa'

        UNION ALL
        SELECT
          'correccion_enviada',
          'Corrección enviada',
          'Corrección enviada — Mesa debe revisar',
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita),
          3
        WHERE b.estado_efectivo = 'correccion_enviada'

        UNION ALL
        SELECT
          'enviado_mesa',
          'En validación Mesa',
          'Expediente enviado a Mesa — en validación',
          coalesce(b.fecha_envio_mesa, b.updated_at, b.fecha_cita),
          5
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.submitted_to_mesa
          AND coalesce(b.subestado, '') = 'en_validacion_mesa'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_requerida'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_enviada'
          AND coalesce(b.cliente_datos_estado, '') IS DISTINCT FROM 'rechazado'

        UNION ALL
        SELECT
          'cita_hoy',
          'Cita hoy',
          'Cita programada para hoy',
          coalesce(b.fecha_cita, b.updated_at),
          6
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.fecha_cita IS NOT NULL
          AND to_char((b.fecha_cita AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD') = v_today

        UNION ALL
        SELECT
          'cita_cambio',
          'Cambio en cita',
          'Cita cancelada o pendiente de reagendar',
          coalesce(b.updated_at, b.fecha_envio_mesa),
          6
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.submitted_to_mesa
          AND b.etapa_actual IN (4, 5, 9, 10)
          AND b.fecha_cita IS NULL

        UNION ALL
        SELECT
          'cita_programada',
          'Cita agendada',
          'Cita agendada (' || to_char((b.fecha_cita AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD') || ')',
          coalesce(b.fecha_cita, b.updated_at),
          7
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.fecha_cita IS NOT NULL
          AND b.etapa_actual IN (4, 5, 9, 10)
          AND to_char((b.fecha_cita AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD')
            IS DISTINCT FROM v_today
      ) cands
      ORDER BY prioridad ASC, fecha DESC NULLS LAST
      LIMIT 1
    ) cand
  ),
  notif_page AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.expediente_id::text || ':' || n.kind,
          'expediente_id', n.expediente_id,
          'cliente_nombre', coalesce(nullif(trim(n.cliente_nombre), ''), '—'),
          'kind', n.kind,
          'tipo_label', n.tipo_label,
          'mensaje', n.mensaje,
          'fecha', n.fecha,
          'prioridad', n.prioridad,
          'href', n.href
        )
        ORDER BY n.prioridad ASC, n.fecha DESC NULLS LAST
      ),
      '[]'::jsonb
    ) AS arr
    FROM (
      SELECT *
      FROM notif_raw
      ORDER BY prioridad ASC, fecha DESC NULLS LAST
      LIMIT v_limit
    ) n
  )
  SELECT
    jsonb_build_object(
      'total', a.total,
      'aprobados_editor', a.aprobados_editor,
      'no_cumple', a.no_cumple,
      'en_tramite', a.en_tramite,
      'rechazados_mesa', a.rechazados_mesa,
      'cancelados', a.cancelados,
      'correccion_requerida', a.correccion_requerida,
      'correccion_enviada', a.correccion_enviada,
      'agendar_biometricos', a.agendar_biometricos,
      'agendar_firma', a.agendar_firma,
      'subir_acuse', a.subir_acuse
    ),
    p.arr,
    np.arr
  INTO v_counts, v_programas, v_notifs
  FROM agg a, programas p, notif_page np;

  RETURN jsonb_build_object(
    'counts', coalesce(v_counts, '{}'::jsonb),
    'programas_unicos', coalesce(v_programas, '[]'::jsonb),
    'notifications', coalesce(v_notifs, '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.asesor_list_expedientes_page(
  integer, integer, text, text, text, text, text, integer, date, date, text, uuid
) IS
  'Perf large-portfolio: quick=todos pagina antes de helpers caros; quick accionable mantiene estado/pending y difiere categoría hasta la página.';

COMMENT ON FUNCTION public.asesor_inbox_summary(integer) IS
  'Perf large-portfolio: estado/pending una vez por expediente; categoria_correccion solo para notificaciones que la requieren. Mismo contrato JSON.';
