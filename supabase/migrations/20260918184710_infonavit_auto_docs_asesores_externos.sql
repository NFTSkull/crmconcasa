-- ConCasa CRM — Documentos INFONAVIT automáticos visibles para asesores internos y externos.
-- Alcance: SOLO lectura/descarga de PDFs ya generados.
-- No cambia generación, snapshot, outbox, Storage write, Datos Generales, etapas, citas ni Sheets.
-- Autoridad: perfil activo + rol permitido + can_see_expediente().
-- Editor sigue DENIED. Mesa conserva su semántica actual.

CREATE OR REPLACE FUNCTION public.asesor_puede_ver_infonavit_auto(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role public.app_role;
  v_active BOOLEAN;
BEGIN
  IF v_uid IS NULL OR p_expediente_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.active
    INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  IF v_role IS DISTINCT FROM 'asesor'::public.app_role THEN
    RETURN false;
  END IF;

  RETURN public.can_see_expediente(p_expediente_id);
END;
$$;

COMMENT ON FUNCTION public.asesor_puede_ver_infonavit_auto(UUID) IS
  'UI asesor: true para cualquier asesor activo, interno o externo, con can_see_expediente. Fail-closed.';

REVOKE ALL ON FUNCTION public.asesor_puede_ver_infonavit_auto(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_puede_ver_infonavit_auto(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_read_allowed(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role public.app_role;
  v_active BOOLEAN;
BEGIN
  IF v_uid IS NULL OR p_expediente_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.active
    INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  IF v_role IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RETURN public.can_see_expediente(p_expediente_id);
  END IF;

  IF v_role = 'asesor' THEN
    RETURN public.can_see_expediente(p_expediente_id);
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.infonavit_pdf_read_allowed(UUID) IS
  'P189: Mesa/super_admin + cualquier asesor activo (interno o externo) con can_see_expediente. Editor DENIED.';

REVOKE ALL ON FUNCTION public.infonavit_pdf_read_allowed(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_read_allowed(UUID)
  TO postgres, service_role;
