-- ConCasa CRM — KPI enviados a Mesa para dashboard de líder.
-- Read-model only: no muta expedientes ni cambia etapas/estados.
-- Mantiene el contrato existente y agrega `enviados` al JSON.

CREATE OR REPLACE FUNCTION public.asesor_lider_get_dashboard(
  p_asesor_id uuid DEFAULT NULL,
  p_fecha_desde date DEFAULT NULL,
  p_fecha_hasta date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_org uuid;
  v_team uuid;
  v_activos bigint := 0;
  v_enviados bigint := 0;
  v_cerrados bigint := 0;
  v_total bigint := 0;
  v_monto numeric(14, 2) := 0;
  v_by_etapa jsonb;
BEGIN
  SELECT r.actor_id, r.org_id, r.team_id
  INTO v_actor, v_org, v_team
  FROM public.asesor_lider_require_context() r;

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

  WITH universe AS (
    SELECT e.id, e.etapa_actual, e.ciclo_estado, e.submitted_to_mesa
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.organization_id = v_org
      AND e.asesor_id IN (SELECT public.asesor_lider_scope_asesor_ids(v_team))
      AND (p_asesor_id IS NULL OR e.asesor_id = p_asesor_id)
      AND (p_fecha_desde IS NULL OR e.created_at::date >= p_fecha_desde)
      AND (p_fecha_hasta IS NULL OR e.created_at::date <= p_fecha_hasta)
  ),
  counts AS (
    SELECT
      count(*) FILTER (WHERE ciclo_estado = 'activo') AS activos,
      count(*) FILTER (WHERE submitted_to_mesa IS TRUE) AS enviados,
      count(*) FILTER (WHERE ciclo_estado <> 'activo') AS cerrados,
      count(*) AS total
    FROM universe
  ),
  montos AS (
    -- Fuente canónica Admin P082/P087/P091:
    -- Mejoravit: LEAST(monto_aprobado_al_aprobar, 169000).
    -- Otros programas: snapshot sin tope 169k (el tope es exclusivo Mejoravit).
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
  INTO v_activos, v_enviados, v_cerrados, v_total, v_monto, v_by_etapa
  FROM counts c
  CROSS JOIN montos m;

  RETURN jsonb_build_object(
    'activos', v_activos,
    'enviados', v_enviados,
    'cerrados', v_cerrados,
    'total', v_total,
    'monto_total_aprobado', v_monto,
    'by_etapa', coalesce(v_by_etapa, '[]'::jsonb),
    'filters', jsonb_build_object(
      'asesor_id', p_asesor_id,
      'fecha_desde', p_fecha_desde,
      'fecha_hasta', p_fecha_hasta
    )
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_lider_get_dashboard(uuid, date, date) IS
  'KPIs equipo líder: activos/enviados a Mesa/cerrados/total/monto (cap 169k) + by_etapa 1-12. Scope = equipo del líder.';
