-- ConCasa CRM — P2B RLS base (SELECT conservador; mutaciones vía RPC P2C)
-- Helpers SECURITY DEFINER evitan recursión en policies de profiles.

-- =============================================================================
-- Grants base (RLS sigue aplicando)
-- =============================================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- =============================================================================
-- Helpers RLS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.app_role
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.organization_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.app_role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_mesa_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.app_role = 'mesa_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_mesa_interno()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.app_role = 'mesa_interno'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_mesa_externo()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.app_role = 'mesa_externo'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_see_expediente(p_expediente_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_role = 'super_admin' THEN
    RETURN true;
  END IF;

  SELECT e.organization_id, e.asesor_id, e.submitted_to_mesa, e.origen_mesa, e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RETURN false;
  END IF;

  CASE v_role
    WHEN 'asesor' THEN
      RETURN v_exp.asesor_id = auth.uid();
    WHEN 'editor' THEN
      RETURN true;
    WHEN 'mesa_admin' THEN
      RETURN v_exp.submitted_to_mesa = true;
    WHEN 'mesa_interno' THEN
      RETURN v_exp.submitted_to_mesa = true AND v_exp.origen_mesa = 'interno';
    WHEN 'mesa_externo' THEN
      RETURN v_exp.submitted_to_mesa = true AND v_exp.origen_mesa = 'externo';
    ELSE
      RETURN false;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_action_log()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin() OR public.is_mesa_admin();
$$;

CREATE OR REPLACE FUNCTION public.can_read_audit_events()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin() OR public.is_mesa_admin();
$$;

GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_mesa_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_mesa_interno() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_mesa_externo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_expediente(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_action_log() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_audit_events() TO authenticated;

-- =============================================================================
-- organizations
-- =============================================================================
CREATE POLICY organizations_select_own_org
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR id = public.current_organization_id()
  );

-- =============================================================================
-- profiles (sin recursión: own row + super_admin)
-- =============================================================================
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.is_super_admin()
  );

-- =============================================================================
-- expedientes
-- =============================================================================
CREATE POLICY expedientes_select
  ON public.expedientes
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND public.can_see_expediente(id)
  );

-- =============================================================================
-- Tablas hijas por expediente (SELECT)
-- =============================================================================
CREATE POLICY editor_decisions_select
  ON public.editor_decisions
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

CREATE POLICY cliente_datos_select
  ON public.cliente_datos
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

CREATE POLICY expediente_documentos_select
  ON public.expediente_documentos
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND public.can_see_expediente(expediente_id)
  );

CREATE POLICY documento_revisiones_select
  ON public.documento_revisiones
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

CREATE POLICY retencion_opciones_select
  ON public.retencion_opciones
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

CREATE POLICY retencion_envios_select
  ON public.retencion_envios
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

CREATE POLICY agenda_bookings_select
  ON public.agenda_bookings
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

CREATE POLICY expediente_notas_select
  ON public.expediente_notas
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

-- =============================================================================
-- action_log / audit_events (restringidos)
-- =============================================================================
CREATE POLICY action_log_select
  ON public.action_log
  FOR SELECT
  TO authenticated
  USING (public.can_read_action_log());

CREATE POLICY audit_events_select
  ON public.audit_events
  FOR SELECT
  TO authenticated
  USING (public.can_read_audit_events());

-- =============================================================================
-- agenda_config
-- =============================================================================
CREATE POLICY agenda_config_select
  ON public.agenda_config
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_mesa_admin()
    OR (
      public.current_app_role() = 'asesor'
      AND organization_id = public.current_organization_id()
    )
  );

-- =============================================================================
-- P2C TODO: INSERT/UPDATE/DELETE vía RPC security definer + action_log
-- =============================================================================
