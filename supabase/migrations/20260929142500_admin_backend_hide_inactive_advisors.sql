-- ConCasa CRM — Admin: ocultar asesores inactivos desde el backend.
--
-- Refuerzo del catálogo visual: admin_list_production_by_asesor_v2 deja de
-- devolver filas de perfiles inactivos. Esto evita que aparezcan en el selector
-- "Todos los asesores" incluso si el navegador conserva una versión anterior
-- del frontend. No elimina expedientes ni historial.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_production_by_asesor_v2(
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_estado text DEFAULT NULL,
  p_asesor_id uuid DEFAULT NULL,
  p_etapas smallint[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.__admin_require_super_admin();

  IF p_from IS NULL OR p_to_exclusive IS NULL OR p_to_exclusive <= p_from THEN
    RAISE EXCEPTION 'admin_production: rango inválido' USING ERRCODE = '22023';
  END IF;

  RETURN coalesce((
    WITH envios AS (
      SELECT
        public.admin_reporting_asesor_id(e.asesor_id) AS asesor_id,
        e.etapa_actual,
        count(*)::bigint AS cnt
      FROM public.expedientes e
      WHERE e.deleted_at IS NULL
        AND e.submitted_to_mesa = TRUE
        AND e.fecha_envio_mesa IS NOT NULL
        AND e.fecha_envio_mesa >= p_from
        AND e.fecha_envio_mesa < p_to_exclusive
        AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
        AND (p_etapas IS NULL OR cardinality(p_etapas) = 0 OR e.etapa_actual = ANY(p_etapas))
        AND (
          p_estado IS NULL
          OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
          OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
        )
      GROUP BY 1, e.etapa_actual
    ),
    envios_tot AS (
      SELECT asesor_id, sum(cnt)::bigint AS enviados
      FROM envios
      GROUP BY asesor_id
    ),
    aprob AS (
      SELECT
        public.admin_reporting_asesor_id(e.asesor_id) AS asesor_id,
        count(*) FILTER (
          WHERE ed.decision = 'aprobado'
            AND ed.aprobado_at IS NOT NULL
            AND ed.aprobado_at >= p_from
            AND ed.aprobado_at < p_to_exclusive
        )::bigint AS aprobadas,
        count(*) FILTER (
          WHERE ed.decision = 'no_cumple'
            AND ed.no_cumple_at IS NOT NULL
            AND ed.no_cumple_at >= p_from
            AND ed.no_cumple_at < p_to_exclusive
        )::bigint AS no_cumple,
        count(*) FILTER (
          WHERE ed.decision = 'aprobado'
            AND ed.aprobado_at IS NOT NULL
            AND ed.aprobado_at >= p_from
            AND ed.aprobado_at < p_to_exclusive
            AND ed.monto_aprobado_al_aprobar > 20000
        )::bigint AS mayor,
        coalesce(
          sum(least(coalesce(ed.monto_aprobado_al_aprobar, 0), 169000)) FILTER (
            WHERE ed.decision = 'aprobado'
              AND ed.aprobado_at IS NOT NULL
              AND ed.aprobado_at >= p_from
              AND ed.aprobado_at < p_to_exclusive
              AND lower(btrim(e.programa::text)) = 'mejoravit'
              AND ed.monto_aprobado_al_aprobar IS NOT NULL
              AND ed.monto_aprobado_al_aprobar > 0
          ),
          0
        )::numeric(14,2) AS monto_total
      FROM public.editor_decisions ed
      JOIN public.expedientes e ON e.id = ed.expediente_id
      WHERE e.deleted_at IS NULL
        AND (p_asesor_id IS NULL OR e.asesor_id = ANY (public.admin_expand_asesor_ids(p_asesor_id)))
        AND (p_etapas IS NULL OR cardinality(p_etapas) = 0 OR e.etapa_actual = ANY(p_etapas))
        AND (
          p_estado IS NULL
          OR (p_estado = 'activos' AND e.ciclo_estado = 'activo' AND e.subestado <> 'rechazado')
          OR (p_estado = 'finalizados' AND (e.ciclo_estado = 'cerrado' OR e.etapa_actual >= 11))
          OR (p_estado = 'rechazados' AND e.subestado = 'rechazado' AND e.ciclo_estado = 'activo')
          OR (p_estado = 'cancelados' AND e.ciclo_estado = 'cancelado')
        )
      GROUP BY 1
    ),
    asesores AS (
      SELECT DISTINCT asesor_id FROM envios_tot
      UNION
      SELECT DISTINCT asesor_id FROM aprob
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'asesor_id', a.asesor_id,
        'asesor_nombre', nullif(btrim(p.full_name), ''),
        'asesor_email', p.email,
        'enviados_a_mesa', coalesce(et.enviados, 0),
        'precalificaciones_aprobadas', coalesce(ap.aprobadas, 0),
        'precalificaciones_no_cumple', coalesce(ap.no_cumple, 0),
        'aprobadas_mayor_a_20000', coalesce(ap.mayor, 0),
        'monto_aprobado_total', coalesce(ap.monto_total, 0),
        'etapas', coalesce((
          SELECT jsonb_object_agg(en.etapa_actual::text, en.cnt)
          FROM envios en
          WHERE en.asesor_id = a.asesor_id
        ), '{}'::jsonb)
      )
      ORDER BY coalesce(et.enviados, 0) DESC, coalesce(ap.monto_total, 0) DESC
    )
    FROM asesores a
    LEFT JOIN envios_tot et ON et.asesor_id = a.asesor_id
    LEFT JOIN aprob ap ON ap.asesor_id = a.asesor_id
    JOIN public.profiles p
      ON p.id = a.asesor_id
     AND p.active = true
     AND p.app_role = 'asesor'
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_production_by_asesor_v2(timestamptz,timestamptz,text,uuid,smallint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_production_by_asesor_v2(timestamptz,timestamptz,text,uuid,smallint[]) TO authenticated;

COMMENT ON FUNCTION public.admin_list_production_by_asesor_v2(timestamptz,timestamptz,text,uuid,smallint[]) IS
  'Admin producción por asesor: devuelve solo perfiles asesor activos; conserva historial y expedientes de inactivos fuera del catálogo/panel.';

COMMIT;
