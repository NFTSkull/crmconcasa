-- ConCasa CRM — RPC UI: tipos scoped visibles para el asesor JWT
-- Depende de mig 20260903140000 (documento_tipo_scope_equipo + asesor_puede_usar_tipo_documento).
-- Fail-closed: no asesor activo → {}. Solo tipos con fila active en scope + helper true.

CREATE OR REPLACE FUNCTION public.asesor_tipos_documento_visibles()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_tipos TEXT[] := ARRAY[]::TEXT[];
  v_tipo TEXT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_actor_id
      AND p.active = true
      AND p.app_role = 'asesor'
  ) THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  FOR v_tipo IN
    SELECT s.tipo_documento
    FROM public.documento_tipo_scope_equipo s
    WHERE s.active = true
    ORDER BY s.tipo_documento
  LOOP
    IF public.asesor_puede_usar_tipo_documento(v_actor_id, v_tipo) THEN
      v_tipos := array_append(v_tipos, v_tipo);
    END IF;
  END LOOP;

  RETURN v_tipos;
END;
$$;

COMMENT ON FUNCTION public.asesor_tipos_documento_visibles() IS
  'UI asesor: tipos de documento_tipo_scope_equipo visibles/subibles para el JWT actual. Vacío si no es asesor activo o fail-closed de membresía.';

REVOKE ALL ON FUNCTION public.asesor_tipos_documento_visibles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_tipos_documento_visibles() TO authenticated;
