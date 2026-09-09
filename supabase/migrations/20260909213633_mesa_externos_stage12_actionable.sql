-- ConCasa CRM — Mesa externos: Integración/Registro muestran trabajo accionable.
--
-- Incremental sobre 20260909213257_mesa_externos_preserve_filters.
-- Para Kass/Sara, el wrapper ya preserva filtros y fuerza solo origen externo.
-- Este ajuste evita que la vista normal de etapas 1/2 mezcle expedientes que
-- Mesa ya devolvió al asesor y siguen en WAITING_ADVISOR/correccion_requerida.
--
-- Regla:
-- - external_scope + etapa 1/2 + quick=Todos + ops=Todo Mesa -> usa P207 sin_asignar.
-- - vistas explícitas (Esperando al asesor, Rechazos, etc.) se preservan.
-- - etapas 3+ se preservan 1:1.
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
  v_ops_effective text;
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
    v_ops_effective := p_ops_filter;

    -- En Integración/Registro la vista normal debe ser trabajo accionable.
    -- P207 `sin_asignar` excluye WAITING_ADVISOR/correccion_requerida y vuelve
    -- a incluir el expediente cuando el asesor reenvía una corrección pendiente.
    IF p_etapa IN (1, 2)
       AND coalesce(nullif(btrim(p_quick_filter), ''), 'todos') = 'todos'
       AND coalesce(nullif(btrim(p_ops_filter), ''), 'todo_mesa') = 'todo_mesa' THEN
      v_ops_effective := 'sin_asignar';
    END IF;

    RETURN public.mesa_list_bandeja_page_base(
      p_limit => p_limit,
      p_cursor_sort_ts => p_cursor_sort_ts,
      p_cursor_id => p_cursor_id,
      p_quick_filter => p_quick_filter,
      p_ops_filter => v_ops_effective,
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
  'Bandeja Mesa externos: fuerza origen externo, preserva filtros y en etapas 1/2 con vista normal usa Disponibles para no mezclar WAITING_ADVISOR; vistas explícitas y resto de etapas intactas.';

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
