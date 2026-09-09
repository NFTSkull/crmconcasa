-- ConCasa CRM — Mesa externos: vista estable para usuarios con ver_externos_mesa
--
-- Problema:
-- Sara/Kass tienen un alcance backend estricto a externos autorizados, pero los
-- filtros operativos de la bandeja (Disponibles / Mi bandeja / etapa / subestado)
-- pueden ocultar expedientes que SI estan enviados a Mesa y SI pertenecen al
-- alcance permitido. Eso genera una bandeja aparentemente vacia aunque
-- can_see_expediente() autorice correctamente las filas.
--
-- Solucion:
-- - Conservamos la implementacion vigente como mesa_list_bandeja_page_base.
-- - El nombre RPC publico original se convierte en wrapper.
-- - Solo para mesa_interno + capability ver_externos_mesa, el wrapper fuerza:
--     quick = todos
--     ops = todo_mesa
--     etapa/subestado/citas = sin filtro
--     origen = externo
-- - Se conserva busqueda y paginacion.
-- - can_see_expediente() sigue siendo la autoridad de seguridad y limita a
--   Silvia + equipo activo de Silvia + Orlando + Anette, solo enviados externos.
-- - Para cualquier otro actor, la llamada es 1:1 con los parametros originales.
--
-- NO modifica expedientes, documentos, perfiles, equipos, capabilities ni datos
-- de cliente. Es exclusivamente un ajuste de lectura/visibilidad de bandeja.

ALTER FUNCTION public.mesa_list_bandeja_page(
  integer,
  timestamp with time zone,
  uuid,
  text,
  text,
  text,
  integer,
  text,
  boolean,
  text,
  text,
  text,
  boolean
) RENAME TO mesa_list_bandeja_page_base;

CREATE OR REPLACE FUNCTION public.mesa_list_bandeja_page(
  p_limit integer DEFAULT 25,
  p_cursor_sort_ts timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id uuid DEFAULT NULL::uuid,
  p_quick_filter text DEFAULT 'todos'::text,
  p_ops_filter text DEFAULT 'todo_mesa'::text,
  p_buscar text DEFAULT NULL::text,
  p_etapa integer DEFAULT NULL::integer,
  p_subestado text DEFAULT NULL::text,
  p_solo_citas_hoy boolean DEFAULT false,
  p_today_ymd text DEFAULT NULL::text,
  p_rechazos_sub text DEFAULT 'rechazados'::text,
  p_origen text DEFAULT NULL::text,
  p_include_counts boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '25s'
AS $function$
DECLARE
  v_uid uuid;
  v_role public.app_role;
  v_external_scope boolean := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mesa_bandeja: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role
  INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_bandeja: perfil no encontrado o inactivo' USING ERRCODE = '42501';
  END IF;

  v_external_scope :=
    v_role = 'mesa_interno'
    AND public.profile_has_capability(v_uid, 'ver_externos_mesa');

  IF v_external_scope THEN
    RETURN public.mesa_list_bandeja_page_base(
      p_limit => p_limit,
      p_cursor_sort_ts => p_cursor_sort_ts,
      p_cursor_id => p_cursor_id,
      p_quick_filter => 'todos',
      p_ops_filter => 'todo_mesa',
      p_buscar => p_buscar,
      p_etapa => NULL,
      p_subestado => NULL,
      p_solo_citas_hoy => false,
      p_today_ymd => p_today_ymd,
      p_rechazos_sub => p_rechazos_sub,
      p_origen => 'externo',
      p_include_counts => p_include_counts
    );
  END IF;

  RETURN public.mesa_list_bandeja_page_base(
    p_limit => p_limit,
    p_cursor_sort_ts => p_cursor_sort_ts,
    p_cursor_id => p_cursor_id,
    p_quick_filter => p_quick_filter,
    p_ops_filter => p_ops_filter,
    p_buscar => p_buscar,
    p_etapa => p_etapa,
    p_subestado => p_subestado,
    p_solo_citas_hoy => p_solo_citas_hoy,
    p_today_ymd => p_today_ymd,
    p_rechazos_sub => p_rechazos_sub,
    p_origen => p_origen,
    p_include_counts => p_include_counts
  );
END;
$function$;

COMMENT ON FUNCTION public.mesa_list_bandeja_page(
  integer,
  timestamp with time zone,
  uuid,
  text,
  text,
  text,
  integer,
  text,
  boolean,
  text,
  text,
  text,
  boolean
) IS
  'Bandeja Mesa. Para mesa_interno con ver_externos_mesa fuerza Todo Mesa + origen externo para no ocultar expedientes autorizados por filtros operativos; can_see_expediente conserva el alcance estricto.';

REVOKE ALL ON FUNCTION public.mesa_list_bandeja_page(
  integer,
  timestamp with time zone,
  uuid,
  text,
  text,
  text,
  integer,
  text,
  boolean,
  text,
  text,
  text,
  boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mesa_list_bandeja_page(
  integer,
  timestamp with time zone,
  uuid,
  text,
  text,
  text,
  integer,
  text,
  boolean,
  text,
  text,
  text,
  boolean
) TO authenticated, service_role;
