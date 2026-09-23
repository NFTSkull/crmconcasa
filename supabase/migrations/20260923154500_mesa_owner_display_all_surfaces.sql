-- ConCasa CRM — Mesa: resolver nombre visible del asesor dueño por expediente.
-- SOLO presentación/read-model de Mesa.
-- No muta expedientes, perfiles, equipos, métricas, etapas, agenda ni auditoría.

CREATE OR REPLACE FUNCTION public.mesa_get_expediente_owner_display_batch(
  p_expediente_ids uuid[]
)
RETURNS TABLE(
  expediente_id uuid,
  asesor_id uuid,
  full_name text,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visible AS (
    SELECT e.id, e.asesor_id
    FROM public.expedientes e
    WHERE e.id = ANY(COALESCE(p_expediente_ids, ARRAY[]::uuid[]))
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa = TRUE
      AND public.can_see_expediente(e.id)
  ),
  display AS (
    SELECT d.*
    FROM public.mesa_get_asesor_display_batch(
      ARRAY(
        SELECT DISTINCT v.asesor_id
        FROM visible v
        WHERE v.asesor_id IS NOT NULL
      )
    ) d
  )
  SELECT
    v.id AS expediente_id,
    v.asesor_id,
    d.full_name,
    d.email
  FROM visible v
  LEFT JOIN display d ON d.asesor_id = v.asesor_id;
$$;

COMMENT ON FUNCTION public.mesa_get_expediente_owner_display_batch(uuid[]) IS
  'Mesa UI only: resuelve nombre visible del asesor dueño por expediente; Equipo Silvia se proyecta como SILVIA REYES. Sin mutaciones.';

REVOKE ALL ON FUNCTION public.mesa_get_expediente_owner_display_batch(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_get_expediente_owner_display_batch(uuid[])
  TO authenticated, service_role;
