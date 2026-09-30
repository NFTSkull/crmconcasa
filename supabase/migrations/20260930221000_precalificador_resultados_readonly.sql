-- ConCasa CRM — precalificador ligado: resultados propios en solo lectura.
-- Alcance:
-- * El precalificador ligado únicamente puede consultar precalificaciones creadas por él.
-- * No expone expediente_id, cliente, teléfono, documentos, Datos Generales ni notas.
-- * El expediente sigue perteneciendo al asesor titular (Anette) y conserva su flujo normal.
-- * Solo lectura; no modifica expedientes ni decisiones.

BEGIN;

CREATE OR REPLACE FUNCTION public.asesor_precalificador_resultados(
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := public.current_profile_id();
  v_link public.asesor_precalificadores_ligados%ROWTYPE;
  v_limit INTEGER;
  v_items JSONB;
  v_total INTEGER;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_precalificador_resultados: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_actor
      AND p.active = true
      AND p.app_role = 'asesor'
  )
  OR NOT public.profile_has_capability(v_actor, 'precalificador_nss_only') THEN
    RAISE EXCEPTION 'asesor_precalificador_resultados: usuario no habilitado'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.*
  INTO v_link
  FROM public.asesor_precalificadores_ligados l
  JOIN public.profiles titular
    ON titular.id = l.asesor_titular_id
   AND titular.active = true
   AND titular.app_role = 'asesor'
  WHERE l.precalificador_id = v_actor
    AND l.active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_precalificador_resultados: no existe asesor titular ligado'
      USING ERRCODE = '42501';
  END IF;

  v_limit := LEAST(200, GREATEST(1, COALESCE(p_limit, 100)));

  SELECT count(*)::INTEGER
  INTO v_total
  FROM public.expedientes e
  WHERE e.deleted_at IS NULL
    AND e.precalificador_origen_id = v_actor
    AND e.asesor_id = v_link.asesor_titular_id;

  WITH latest AS (
    SELECT
      e.nss::TEXT AS nss,
      coalesce(ed.decision::TEXT, 'pendiente') AS resultado,
      CASE
        WHEN ed.decision = 'aprobado'
          THEN coalesce(ed.monto_aprobado_al_aprobar, ed.monto_aprobado)
        ELSE NULL
      END AS monto_aprobado,
      e.created_at,
      greatest(
        e.updated_at,
        coalesce(ed.updated_at, e.updated_at)
      ) AS actualizado_at
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed
      ON ed.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.precalificador_origen_id = v_actor
      AND e.asesor_id = v_link.asesor_titular_id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT v_limit
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nss', r.nss,
        'resultado', r.resultado,
        'monto_aprobado', r.monto_aprobado,
        'created_at', r.created_at,
        'actualizado_at', r.actualizado_at
      )
      ORDER BY r.created_at DESC
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM latest r;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::JSONB),
    'total_count', coalesce(v_total, 0),
    'limit', v_limit
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.asesor_precalificador_resultados(INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_precalificador_resultados(INTEGER)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.asesor_precalificador_resultados(INTEGER) IS
  'Solo lectura para precalificador ligado: devuelve únicamente NSS, resultado, monto aprobado y fechas de sus propias precalificaciones; no expone expediente ni datos operativos.';

COMMIT;
