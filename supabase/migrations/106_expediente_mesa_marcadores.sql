-- ConCasa CRM — P119: marcadores Mesa (tiene_datos) + RPC set
-- No modifica 001–105 ni citas/cupos/agenda.

-- =============================================================================
-- Tabla append-friendly de marcadores por expediente
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.expediente_mesa_marcadores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_mesa_marcadores_tipo_check
    CHECK (tipo = ANY (ARRAY['tiene_datos'::text])),
  CONSTRAINT expediente_mesa_marcadores_org_exp_tipo_unique
    UNIQUE (organization_id, expediente_id, tipo)
);

CREATE INDEX IF NOT EXISTS expediente_mesa_marcadores_expediente_active_idx
  ON public.expediente_mesa_marcadores (expediente_id)
  WHERE active = true;

COMMENT ON TABLE public.expediente_mesa_marcadores IS
  'P119: marcadores operativos Mesa (p.ej. tiene_datos). Estado actual; no action_log.';

ALTER TABLE public.expediente_mesa_marcadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expediente_mesa_marcadores_select ON public.expediente_mesa_marcadores;
CREATE POLICY expediente_mesa_marcadores_select
  ON public.expediente_mesa_marcadores
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

GRANT SELECT ON TABLE public.expediente_mesa_marcadores TO authenticated;
-- Mutaciones solo vía RPC SECURITY DEFINER
REVOKE INSERT, UPDATE, DELETE ON TABLE public.expediente_mesa_marcadores FROM authenticated;
REVOKE ALL ON TABLE public.expediente_mesa_marcadores FROM anon;

-- =============================================================================
-- RPC mesa_set_expediente_marcador
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_set_expediente_marcador(
  p_expediente_id UUID,
  p_tipo TEXT,
  p_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_active BOOLEAN;
  v_prev BOOLEAN;
  v_row public.expediente_mesa_marcadores;
  v_idempotent BOOLEAN := false;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'mesa_set_expediente_marcador: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_set_expediente_marcador: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  v_tipo := lower(btrim(coalesce(p_tipo, '')));
  IF v_tipo IS DISTINCT FROM 'tiene_datos' THEN
    RAISE EXCEPTION 'mesa_set_expediente_marcador: tipo no permitido (%)', coalesce(p_tipo, '')
      USING ERRCODE = '22023';
  END IF;

  IF p_active IS NULL THEN
    RAISE EXCEPTION 'mesa_set_expediente_marcador: p_active obligatorio'
      USING ERRCODE = '22023';
  END IF;
  v_active := p_active;

  SELECT
    e.id,
    e.organization_id,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_set_expediente_marcador: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'mesa_set_expediente_marcador: organización distinta'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_set_expediente_marcador: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT m.active INTO v_prev
  FROM public.expediente_mesa_marcadores m
  WHERE m.organization_id = v_org
    AND m.expediente_id = p_expediente_id
    AND m.tipo = v_tipo
  FOR UPDATE;

  IF FOUND AND v_prev IS NOT DISTINCT FROM v_active THEN
    v_idempotent := true;
    SELECT * INTO v_row
    FROM public.expediente_mesa_marcadores m
    WHERE m.organization_id = v_org
      AND m.expediente_id = p_expediente_id
      AND m.tipo = v_tipo;
  ELSE
    INSERT INTO public.expediente_mesa_marcadores (
      organization_id,
      expediente_id,
      tipo,
      active,
      created_by,
      updated_by
    ) VALUES (
      v_org,
      p_expediente_id,
      v_tipo,
      v_active,
      v_actor,
      v_actor
    )
    ON CONFLICT (organization_id, expediente_id, tipo) DO UPDATE
    SET
      active = EXCLUDED.active,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING * INTO v_row;

    PERFORM public.log_action(
      v_org,
      v_actor,
      v_role,
      'mesa.expediente.marcador_set',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'tipo', v_tipo,
        'active', v_active,
        'previous_active', v_prev
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', v_idempotent,
    'expediente_id', p_expediente_id,
    'tipo', v_tipo,
    'active', v_row.active,
    'updated_at', v_row.updated_at
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_set_expediente_marcador(UUID, TEXT, BOOLEAN) IS
  'P119: activa/desactiva marcador Mesa (allowlist tiene_datos). Idempotente; action_log.';

REVOKE ALL ON FUNCTION public.mesa_set_expediente_marcador(UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_set_expediente_marcador(UUID, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_set_expediente_marcador(UUID, TEXT, BOOLEAN) TO authenticated;
