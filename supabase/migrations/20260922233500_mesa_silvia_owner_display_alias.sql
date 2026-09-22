-- ConCasa CRM — Mesa: alias visual del dueño para Equipo Silvia.
-- SOLO read-model/presentación de Mesa. No muta expedientes, perfiles, equipos,
-- métricas, routing, permisos, etapas, agenda ni datos históricos.

CREATE OR REPLACE FUNCTION public.mesa_get_asesor_display_batch(p_asesor_ids uuid[])
RETURNS TABLE(asesor_id uuid, full_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    CASE
      WHEN public.asesor_es_equipo_silvia(p.id) THEN 'SILVIA REYES'::text
      ELSE NULLIF(btrim(p.full_name), '')
    END AS full_name,
    NULLIF(btrim(p.email), '') AS email
  FROM public.profiles p
  WHERE p.id = ANY(COALESCE(p_asesor_ids, ARRAY[]::uuid[]))
    AND p.active = true
    AND (
      p.id = auth.uid()
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.expedientes e
        WHERE e.asesor_id = p.id
          AND e.deleted_at IS NULL
          AND public.can_see_expediente(e.id)
      )
    );
$$;

COMMENT ON FUNCTION public.mesa_get_asesor_display_batch(uuid[]) IS
  'Mesa UI only: nombre visible del dueño; Silvia Reyes y miembros activos de su equipo se proyectan como SILVIA REYES. No altera datos ni métricas.';

REVOKE ALL ON FUNCTION public.mesa_get_asesor_display_batch(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_get_asesor_display_batch(uuid[]) TO authenticated, service_role;
