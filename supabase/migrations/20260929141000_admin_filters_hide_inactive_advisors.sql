-- Oculta asesores inactivos de los catálogos/filtros de Admin.
-- No elimina expedientes ni historial; solo el catálogo seleccionable.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_expedientes_overview_asesores()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_items JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_expedientes_overview_asesores: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'asesor_id', x.asesor_id,
        'asesor_nombre', x.asesor_nombre,
        'asesor_email', x.asesor_email
      ) ORDER BY coalesce(x.asesor_nombre, x.asesor_email, x.asesor_id::text)
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT DISTINCT
      e.asesor_id,
      nullif(btrim(p.full_name), '') AS asesor_nombre,
      nullif(btrim(p.email), '') AS asesor_email
    FROM public.expedientes e
    JOIN public.profiles p
      ON p.id = e.asesor_id
     AND p.active = true
     AND p.app_role = 'asesor'
    WHERE e.organization_id = v_org
      AND e.deleted_at IS NULL
      AND e.asesor_id IS NOT NULL
  ) x;

  RETURN jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
END;
$function$;

COMMENT ON FUNCTION public.admin_list_expedientes_overview_asesores() IS
  'Catálogo de asesores activos para filtros Admin. Conserva expedientes/historial de asesores inactivos fuera del selector.';

COMMIT;
