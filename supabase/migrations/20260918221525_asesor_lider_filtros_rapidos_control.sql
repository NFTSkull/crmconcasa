-- ConCasa CRM — filtros rápidos visibles para dashboard líder.
-- Objetivo: paridad operativa con inbox asesor interno, sin mutar expedientes.
-- 0 UPDATE / 0 DELETE / 0 backfill / 0 cambios de agenda/cupos/citas.

CREATE OR REPLACE FUNCTION public.asesor_lider_get_dashboard(
  p_asesor_id UUID DEFAULT NULL,
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_team UUID;
  v_activos BIGINT := 0;
  v_enviados BIGINT := 0;
  v_cerrados BIGINT := 0;
  v_total BIGINT := 0;
  v_monto NUMERIC(14, 2) := 0;
  v_by_etapa JSONB;
  v_quick_counts JSONB := '{}'::JSONB;
  v_only_submitted_stages BOOLEAN := false;
BEGIN
  SELECT r.actor_id, r.org_id, r.team_id
  INTO v_actor, v_org, v_team
  FROM public.asesor_lider_require_context() r;

  SELECT lower(coalesce(p.email, '')) = 'silvia.reyes@concasa.mx'
  INTO v_only_submitted_stages
  FROM public.profiles p
  WHERE p.id = v_actor;

  v_only_submitted_stages := coalesce(v_only_submitted_stages, false);

  IF p_asesor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.asesor_lider_scope_asesor_ids(v_team) s
    WHERE s = p_asesor_id
  ) THEN
    RAISE EXCEPTION 'asesor_lider_get_dashboard: asesor_id fuera de alcance del equipo'
      USING ERRCODE = '42501';
  END IF;

  IF p_fecha_desde IS NOT NULL
     AND p_fecha_hasta IS NOT NULL
     AND p_fecha_hasta < p_fecha_desde THEN
    RAISE EXCEPTION 'asesor_lider_get_dashboard: rango de fechas inválido'
      USING ERRCODE = '22023';
  END IF;

  WITH universe AS MATERIALIZED (
    SELECT
      e.id,
      e.etapa_actual,
      e.ciclo_estado,
      e.submitted_to_mesa,
      public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo,
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
    WHERE e.deleted_at IS NULL
      AND e.organization_id = v_org
      AND e.asesor_id IN (
        SELECT public.asesor_lider_scope_asesor_ids(v_team)
      )
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (p_fecha_desde IS NULL OR e.created_at::date >= p_fecha_desde)
      AND (p_fecha_hasta IS NULL OR e.created_at::date <= p_fecha_hasta)
  ),
  counts AS (
    SELECT
      count(*) FILTER (WHERE ciclo_estado = 'activo') AS activos,
      count(*) FILTER (WHERE submitted_to_mesa IS TRUE) AS enviados,
      count(*) FILTER (WHERE ciclo_estado <> 'activo') AS cerrados,
      count(*) AS total,
      count(*) FILTER (
        WHERE submitted_to_mesa IS TRUE
          AND coalesce(estado_efectivo, '') NOT IN (
            'rechazado_mesa',
            'cancelado',
            'correccion_requerida',
            'correccion_enviada'
          )
      ) AS en_mesa,
      count(*) FILTER (WHERE estado_efectivo = 'en_tramite') AS en_tramite,
      count(*) FILTER (WHERE estado_efectivo = 'correccion_requerida') AS correccion_requerida,
      count(*) FILTER (WHERE estado_efectivo = 'correccion_enviada') AS correccion_enviada,
      count(*) FILTER (WHERE estado_efectivo = 'rechazado_mesa') AS rechazados_mesa,
      count(*) FILTER (WHERE estado_efectivo = 'cancelado') AS cancelados,
      count(*) FILTER (WHERE pendiente_agendar_biometricos) AS agendar_biometricos,
      count(*) FILTER (WHERE pendiente_agendar_firma) AS agendar_firma,
      count(*) FILTER (WHERE pendiente_subir_acuse) AS subir_acuse
    FROM universe
  ),
  montos AS (
    SELECT coalesce(
      sum(
        CASE
          WHEN ed.decision = 'aprobado'
               AND e.programa = 'mejoravit'::public.programa
          THEN least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)
          WHEN ed.decision = 'aprobado'
          THEN coalesce(ed.monto_aprobado_al_aprobar, 0)
          ELSE 0
        END
      ),
      0
    )::numeric(14, 2) AS monto_total
    FROM universe u
    JOIN public.expedientes e ON e.id = u.id
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = u.id
  ),
  por_etapa AS (
    SELECT
      u.etapa_actual AS etapa,
      count(*)::bigint AS cnt,
      coalesce(
        sum(
          CASE
            WHEN ed.decision = 'aprobado'
                 AND e.programa = 'mejoravit'::public.programa
            THEN least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)
            WHEN ed.decision = 'aprobado'
            THEN coalesce(ed.monto_aprobado_al_aprobar, 0)
            ELSE 0
          END
        ),
        0
      )::numeric(14, 2) AS monto
    FROM universe u
    JOIN public.expedientes e ON e.id = u.id
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = u.id
    WHERE (NOT v_only_submitted_stages OR u.submitted_to_mesa IS TRUE)
    GROUP BY u.etapa_actual
  ),
  etapas AS (
    SELECT * FROM (VALUES
      (1, 'Integración'),
      (2, 'Registro'),
      (3, 'Listo para cita de biométrico'),
      (4, 'Cita agendada (biométricos)'),
      (5, 'Biometría (resultado)'),
      (6, 'Inscripción'),
      (7, 'Notificación'),
      (8, 'Acuse / Aviso de retención'),
      (9, 'Listo para agendar firma'),
      (10, 'Cita para firma'),
      (11, 'Firmado'),
      (12, 'Pago a ConCasa')
    ) AS t(etapa, nombre)
  )
  SELECT
    c.activos,
    c.enviados,
    c.cerrados,
    c.total,
    m.monto_total,
    jsonb_build_object(
      'todos', c.total,
      'en_mesa', c.en_mesa,
      'en_tramite', c.en_tramite,
      'correccion_requerida', c.correccion_requerida,
      'correccion_enviada', c.correccion_enviada,
      'rechazados_mesa', c.rechazados_mesa,
      'cancelados', c.cancelados,
      'agendar_biometricos', c.agendar_biometricos,
      'agendar_firma', c.agendar_firma,
      'subir_acuse', c.subir_acuse
    ),
    (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'etapa', e.etapa,
            'nombre', e.nombre,
            'count', coalesce(pe.cnt, 0),
            'monto', coalesce(pe.monto, 0)
          )
          ORDER BY e.etapa
        ),
        '[]'::jsonb
      )
      FROM etapas e
      LEFT JOIN por_etapa pe ON pe.etapa = e.etapa
    )
  INTO
    v_activos,
    v_enviados,
    v_cerrados,
    v_total,
    v_monto,
    v_quick_counts,
    v_by_etapa
  FROM counts c
  CROSS JOIN montos m;

  RETURN jsonb_build_object(
    'activos', v_activos,
    'enviados', v_enviados,
    'cerrados', v_cerrados,
    'total', v_total,
    'monto_total_aprobado', v_monto,
    'quick_counts', coalesce(v_quick_counts, '{}'::jsonb),
    'by_etapa', coalesce(v_by_etapa, '[]'::jsonb),
    'filters', jsonb_build_object(
      'asesor_id', p_asesor_id,
      'fecha_desde', p_fecha_desde,
      'fecha_hasta', p_fecha_hasta
    )
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_lider_get_dashboard(UUID, DATE, DATE) IS
  'Dashboard líder + quick_counts operativos del equipo con las mismas señales del inbox asesor.';


CREATE OR REPLACE FUNCTION public.asesor_lider_list_expedientes_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_buscar TEXT DEFAULT NULL,
  p_asesor_id UUID DEFAULT NULL,
  p_etapa_exacta INTEGER DEFAULT NULL,
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_ciclo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_team UUID;
  v_page INT;
  v_size INT;
  v_from INT;
  v_ciclo TEXT;
  v_total BIGINT;
  v_items JSONB;
BEGIN
  SELECT r.actor_id, r.org_id, r.team_id
  INTO v_actor, v_org, v_team
  FROM public.asesor_lider_require_context() r;

  IF p_asesor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.asesor_lider_scope_asesor_ids(v_team) s
    WHERE s = p_asesor_id
  ) THEN
    RAISE EXCEPTION 'asesor_lider_list_expedientes_page: asesor_id fuera de alcance'
      USING ERRCODE = '42501';
  END IF;

  IF p_fecha_desde IS NOT NULL
     AND p_fecha_hasta IS NOT NULL
     AND p_fecha_hasta < p_fecha_desde THEN
    RAISE EXCEPTION 'asesor_lider_list_expedientes_page: rango de fechas inválido'
      USING ERRCODE = '22023';
  END IF;

  IF p_etapa_exacta IS NOT NULL AND (p_etapa_exacta < 1 OR p_etapa_exacta > 12) THEN
    RAISE EXCEPTION 'asesor_lider_list_expedientes_page: etapa_exacta inválida'
      USING ERRCODE = '22023';
  END IF;

  v_ciclo := nullif(lower(btrim(coalesce(p_ciclo, ''))), '');
  IF v_ciclo IS NOT NULL
     AND v_ciclo NOT IN (
       'activo',
       'cerrado',
       'en_mesa',
       'en_tramite',
       'rechazados_mesa',
       'correccion_requerida',
       'correccion_enviada',
       'cancelados',
       'agendar_biometricos',
       'agendar_firma',
       'subir_acuse'
     ) THEN
    RAISE EXCEPTION
      'asesor_lider_list_expedientes_page: filtro inválido'
      USING ERRCODE = '22023';
  END IF;

  v_page := greatest(coalesce(p_page, 1), 1);
  v_size := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_from := (v_page - 1) * v_size;

  WITH scoped_base AS MATERIALIZED (
    SELECT
      e.id,
      e.cliente_nombre,
      e.nss,
      e.telefono_cliente,
      e.asesor_id,
      ap.full_name AS asesor_nombre,
      e.etapa_actual,
      e.ciclo_estado,
      e.subestado,
      e.submitted_to_mesa,
      ed.monto_aprobado,
      ed.monto_aprobado_al_aprobar,
      ed.decision,
      e.created_at,
      e.fecha_envio_mesa,
      public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo,
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
    JOIN public.profiles ap ON ap.id = e.asesor_id
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.organization_id = v_org
      AND e.asesor_id IN (
        SELECT public.asesor_lider_scope_asesor_ids(v_team)
      )
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (p_etapa_exacta IS NULL OR e.etapa_actual = p_etapa_exacta)
      AND (p_fecha_desde IS NULL OR e.created_at::date >= p_fecha_desde)
      AND (p_fecha_hasta IS NULL OR e.created_at::date <= p_fecha_hasta)
      AND public.asesor_inbox_matches_buscar(
        e.cliente_nombre,
        e.nss::text,
        e.telefono_cliente::text,
        NULL,
        p_buscar
      )
  ),
  scoped AS MATERIALIZED (
    SELECT s.*
    FROM scoped_base s
    WHERE
      v_ciclo IS NULL
      OR (v_ciclo = 'activo' AND s.ciclo_estado::text = 'activo')
      OR (v_ciclo = 'cerrado' AND s.ciclo_estado::text <> 'activo')
      OR (
        v_ciclo = 'en_mesa'
        AND s.submitted_to_mesa = true
        AND coalesce(s.estado_efectivo, '') NOT IN (
          'rechazado_mesa',
          'cancelado',
          'correccion_requerida',
          'correccion_enviada'
        )
      )
      OR (v_ciclo = 'en_tramite' AND s.estado_efectivo = 'en_tramite')
      OR (v_ciclo = 'rechazados_mesa' AND s.estado_efectivo = 'rechazado_mesa')
      OR (v_ciclo = 'correccion_requerida' AND s.estado_efectivo = 'correccion_requerida')
      OR (v_ciclo = 'correccion_enviada' AND s.estado_efectivo = 'correccion_enviada')
      OR (v_ciclo = 'cancelados' AND s.estado_efectivo = 'cancelado')
      OR (v_ciclo = 'agendar_biometricos' AND s.pendiente_agendar_biometricos)
      OR (v_ciclo = 'agendar_firma' AND s.pendiente_agendar_firma)
      OR (v_ciclo = 'subir_acuse' AND s.pendiente_subir_acuse)
  ),
  counted AS (
    SELECT count(*)::bigint AS total_count FROM scoped
  ),
  page_rows AS (
    SELECT *
    FROM scoped
    ORDER BY created_at DESC, id DESC
    OFFSET v_from
    LIMIT v_size
  )
  SELECT
    c.total_count,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', pr.id,
            'cliente_nombre', pr.cliente_nombre,
            'nss', pr.nss,
            'telefono_cliente', pr.telefono_cliente,
            'asesor_id', pr.asesor_id,
            'asesor_nombre', pr.asesor_nombre,
            'etapa_actual', pr.etapa_actual,
            'ciclo_estado', pr.ciclo_estado,
            'subestado', pr.subestado,
            'submitted_to_mesa', pr.submitted_to_mesa,
            'estado_efectivo', pr.estado_efectivo,
            'monto_aprobado', pr.monto_aprobado,
            'monto_aprobado_al_aprobar', pr.monto_aprobado_al_aprobar,
            'decision', pr.decision,
            'created_at', pr.created_at,
            'fecha_envio_mesa', pr.fecha_envio_mesa
          )
          ORDER BY pr.created_at DESC, pr.id DESC
        )
        FROM page_rows pr
      ),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM counted c;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', coalesce(v_total, 0),
    'page', v_page,
    'page_size', v_size,
    'has_more', coalesce(v_total, 0) > (v_from + v_size)
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_lider_list_expedientes_page(
  INTEGER, INTEGER, TEXT, UUID, INTEGER, DATE, DATE, TEXT
) IS
  'Dashboard líder: lista equipo con filtros rápidos Mesa y tareas operativas del inbox asesor.';
