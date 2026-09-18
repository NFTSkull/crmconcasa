-- ConCasa CRM — visibilidad clara de rechazados para Equipo Silvia.
-- Solo read-model/RPC: 0 UPDATE, 0 DELETE, 0 backfill, 0 cambios a citas/cupos/agenda.
-- 1) El dashboard líder puede filtrar por estado efectivo de Mesa.
-- 2) Los operadores delegados pueden leer KPIs del asesor titular seleccionado.

CREATE OR REPLACE FUNCTION public.asesor_inbox_counts_for_owner(
  p_owner_asesor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '25s'
AS $$
DECLARE
  v_actor UUID;
  v_owner UUID;
  v_role public.app_role;
  v_active BOOLEAN;
  v_counts JSONB;
  v_programas JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_inbox_counts_for_owner: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active
  INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_inbox_counts_for_owner: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  v_owner := coalesce(p_owner_asesor_id, v_actor);

  IF v_owner IS DISTINCT FROM v_actor THEN
    IF NOT public.profile_has_capability(v_actor, 'integrate_for_any_advisor') THEN
      RAISE EXCEPTION 'asesor_inbox_counts_for_owner: sin capability integrate_for_any_advisor'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.asesor_comparten_equipo_activo(v_actor, v_owner) THEN
      RAISE EXCEPTION 'asesor_inbox_counts_for_owner: asesor titular fuera de equipo compartido'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  WITH base AS MATERIALIZED (
    SELECT
      e.id,
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
      ) AS pendiente_subir_acuse
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_owner
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
      jsonb_agg(p.programa_ui ORDER BY p.programa_ui),
      '[]'::jsonb
    ) AS arr
    FROM (
      SELECT DISTINCT programa_ui
      FROM base
      WHERE trim(coalesce(programa_ui, '')) <> ''
    ) p
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
    p.arr
  INTO v_counts, v_programas
  FROM agg a, programas p;

  RETURN jsonb_build_object(
    'counts', coalesce(v_counts, '{}'::jsonb),
    'programas_unicos', coalesce(v_programas, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_counts_for_owner(UUID) IS
  'KPIs del inbox para actor o titular delegado del mismo equipo activo; read-only.';

REVOKE ALL ON FUNCTION public.asesor_inbox_counts_for_owner(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_counts_for_owner(UUID)
  TO authenticated;


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
       'rechazados_mesa',
       'correccion_requerida',
       'correccion_enviada',
       'cancelados'
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
      public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo
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
      OR (v_ciclo = 'rechazados_mesa' AND s.estado_efectivo = 'rechazado_mesa')
      OR (v_ciclo = 'correccion_requerida' AND s.estado_efectivo = 'correccion_requerida')
      OR (v_ciclo = 'correccion_enviada' AND s.estado_efectivo = 'correccion_enviada')
      OR (v_ciclo = 'cancelados' AND s.estado_efectivo = 'cancelado')
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
  'Dashboard líder: lista equipo con filtros de estado efectivo Mesa (En Mesa/Rechazados/Correcciones/Cancelados).';

REVOKE ALL ON FUNCTION public.asesor_lider_list_expedientes_page(
  INTEGER, INTEGER, TEXT, UUID, INTEGER, DATE, DATE, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_lider_list_expedientes_page(
  INTEGER, INTEGER, TEXT, UUID, INTEGER, DATE, DATE, TEXT
) TO authenticated;
