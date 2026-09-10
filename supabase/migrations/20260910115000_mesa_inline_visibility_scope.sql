-- ConCasa CRM — Mesa: resolver alcance del actor una sola vez por RPC.
-- Performance-only / read-model. 0 UPDATE / DELETE / INSERT de negocio / backfill.
--
-- Motivo:
-- mesa_list_bandeja_page_base y mesa_bandeja_counts_fast son SECURITY DEFINER,
-- ya resuelven el actor al inicio, pero llamaban can_see_expediente(e.id) por cada fila.
-- can_see_expediente vuelve a consultar profiles + expedientes (+ capability), multiplicando
-- el trabajo por cientos de expedientes en cada carga de Mesa.
--
-- Esta migración conserva la semántica ACTUAL de can_see_expediente para roles Mesa:
--   super_admin  -> todos los expedientes que ya cumplen el scope externo de la RPC
--   mesa_admin   -> misma organización, enviados a Mesa
--   mesa_interno -> misma organización, internos; externos solo con ver_externos_mesa
--   mesa_externo -> misma organización, externos enviados a Mesa
-- Los filtros deleted_at/submitted_to_mesa/ciclo_estado permanecen en las RPC.
--
-- Fail-closed: exige firmas y ocurrencias exactas antes de reemplazar.

DO $do$
DECLARE
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
  v_count integer;
BEGIN
  -- ==========================================================================
  -- 1) mesa_list_bandeja_page_base
  -- ==========================================================================
  SELECT p.oid
  INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mesa_list_bandeja_page_base'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_limit integer, p_cursor_sort_ts timestamp with time zone, p_cursor_id uuid, p_quick_filter text, p_ops_filter text, p_buscar text, p_etapa integer, p_subestado text, p_solo_citas_hoy boolean, p_today_ymd text, p_rechazos_sub text, p_origen text, p_include_counts boolean';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: mesa_list_bandeja_page_base signature not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  v_old := '  v_role public.app_role;';
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: list v_role marker count %, expected 1', v_count;
  END IF;
  v_def := replace(
    v_def,
    v_old,
    v_old || E'\n  v_org_id UUID;\n  v_can_externos BOOLEAN := FALSE;'
  );

  v_old := E'  SELECT p.app_role INTO v_role\n  FROM public.profiles p\n  WHERE p.id = v_uid AND p.active = true;';
  v_new := E'  SELECT p.app_role, p.organization_id INTO v_role, v_org_id\n  FROM public.profiles p\n  WHERE p.id = v_uid AND p.active = true;';
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: list actor SELECT count %, expected 1', v_count;
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := '  v_limit := LEAST(100, GREATEST(1, coalesce(p_limit, 25)));';
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: list v_limit marker count %, expected 1', v_count;
  END IF;
  v_def := replace(
    v_def,
    v_old,
    E'  v_can_externos := (v_role = ''mesa_interno'' AND public.profile_has_capability(v_uid, ''ver_externos_mesa''));\n\n' || v_old
  );

  v_old := 'AND public.can_see_expediente(e.id)';
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: list visibility marker count %, expected 2', v_count;
  END IF;

  v_new := E'AND (\n        v_role = ''super_admin''\n        OR (\n          e.organization_id IS NOT DISTINCT FROM v_org_id\n          AND (\n            v_role = ''mesa_admin''\n            OR (\n              v_role = ''mesa_interno''\n              AND (\n                e.origen_mesa = ''interno''\n                OR (e.origen_mesa = ''externo'' AND v_can_externos)\n              )\n            )\n            OR (v_role = ''mesa_externo'' AND e.origen_mesa = ''externo'')\n          )\n        )\n      )';
  v_def := replace(v_def, v_old, v_new);

  IF position('public.can_see_expediente(e.id)' in v_def) > 0 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: list stale can_see_expediente remains';
  END IF;

  EXECUTE v_def;

  -- ==========================================================================
  -- 2) mesa_bandeja_counts_fast
  -- ==========================================================================
  SELECT p.oid
  INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mesa_bandeja_counts_fast'
    AND pg_get_function_identity_arguments(p.oid) = 'p_today_ymd text, p_origen text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: mesa_bandeja_counts_fast signature not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  v_old := '  v_role public.app_role;';
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: counts v_role marker count %, expected 1', v_count;
  END IF;
  v_def := replace(
    v_def,
    v_old,
    v_old || E'\n  v_org_id UUID;\n  v_can_externos BOOLEAN := FALSE;'
  );

  v_old := E'  SELECT p.app_role INTO v_role\n  FROM public.profiles p\n  WHERE p.id = v_uid AND p.active = true;';
  v_new := E'  SELECT p.app_role, p.organization_id INTO v_role, v_org_id\n  FROM public.profiles p\n  WHERE p.id = v_uid AND p.active = true;';
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: counts actor SELECT count %, expected 1', v_count;
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := '  WITH base AS MATERIALIZED (';
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: counts base marker count %, expected 1', v_count;
  END IF;
  v_def := replace(
    v_def,
    v_old,
    E'  v_can_externos := (v_role = ''mesa_interno'' AND public.profile_has_capability(v_uid, ''ver_externos_mesa''));\n\n' || v_old
  );

  v_old := 'AND public.can_see_expediente(e.id)';
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: counts visibility marker count %, expected 1', v_count;
  END IF;

  v_new := E'AND (\n        v_role = ''super_admin''\n        OR (\n          e.organization_id IS NOT DISTINCT FROM v_org_id\n          AND (\n            v_role = ''mesa_admin''\n            OR (\n              v_role = ''mesa_interno''\n              AND (\n                e.origen_mesa = ''interno''\n                OR (e.origen_mesa = ''externo'' AND v_can_externos)\n              )\n            )\n            OR (v_role = ''mesa_externo'' AND e.origen_mesa = ''externo'')\n          )\n        )\n      )';
  v_def := replace(v_def, v_old, v_new);

  IF position('public.can_see_expediente(e.id)' in v_def) > 0 THEN
    RAISE EXCEPTION 'mesa_inline_visibility_scope: counts stale can_see_expediente remains';
  END IF;

  EXECUTE v_def;
END;
$do$;

COMMENT ON FUNCTION public.mesa_list_bandeja_page_base(
  integer, timestamptz, uuid, text, text, text, integer, text, boolean, text, text, text, boolean
) IS 'Mesa read-model: alcance del actor resuelto 1x por RPC; misma semántica de visibilidad vigente, sin can_see_expediente por fila.';

COMMENT ON FUNCTION public.mesa_bandeja_counts_fast(text, text) IS
  'Mesa counts: alcance del actor resuelto 1x por RPC; misma semántica de visibilidad vigente, sin can_see_expediente por fila.';
