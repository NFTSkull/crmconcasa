-- ConCasa CRM — Mesa externos: preservar filtros de bandeja sin abrir internos
--
-- Contexto:
-- `20260909192000_mesa_externos_force_todo_mesa.sql` estabilizó la visibilidad
-- de Kass/Sara forzando origen externo, pero también anuló quick/ops/etapa/
-- subestado/citas. Resultado: al elegir "Integración" el backend devolvía
-- expedientes de otras etapas e incluso rechazados.
--
-- Este hotfix mantiene el aislamiento estricto:
--   mesa_interno + capability ver_externos_mesa => SIEMPRE p_origen='externo'
-- y vuelve a respetar todos los demás filtros solicitados por la UI.
--
-- Read-model only: 0 UPDATE / 0 DELETE / 0 backfill / 0 writers.

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
      p_quick_filter => p_quick_filter,
      p_ops_filter => p_ops_filter,
      p_buscar => p_buscar,
      p_etapa => p_etapa,
      p_subestado => p_subestado,
      p_solo_citas_hoy => p_solo_citas_hoy,
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
  'Bandeja Mesa. Kass/Sara (mesa_interno + ver_externos_mesa) conservan todos los filtros de UI pero el backend fuerza origen externo; can_see_expediente mantiene el alcance estricto.';

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
