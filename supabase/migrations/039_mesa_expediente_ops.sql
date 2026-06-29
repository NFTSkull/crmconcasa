-- ConCasa CRM — Fase 1A: capa operativa Mesa (modo sombra)
-- Tabla mesa_expediente_ops 1:1 con expediente + backfill idempotente.
-- Sin cambios a enviar_a_mesa, avanzar_etapa_operativa ni flujos existentes.

-- =============================================================================
-- Enum estado operativo Mesa
-- =============================================================================
CREATE TYPE public.mesa_expediente_estado AS ENUM (
  'sin_asignar',
  'trabajando',
  'en_espera_asesor',
  'en_espera_cliente',
  'en_espera_reagenda',
  'bloqueado',
  'listo_para_avanzar',
  'completado'
);

-- =============================================================================
-- mesa_expediente_ops
-- =============================================================================
CREATE TABLE public.mesa_expediente_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  estado_mesa public.mesa_expediente_estado NOT NULL DEFAULT 'sin_asignar',
  assigned_to UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NULL,
  last_activity_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mesa_expediente_ops_expediente_unique UNIQUE (expediente_id),
  CONSTRAINT mesa_expediente_ops_assigned_pair_check CHECK (
    (assigned_to IS NULL AND assigned_at IS NULL)
    OR (assigned_to IS NOT NULL AND assigned_at IS NOT NULL)
  ),
  CONSTRAINT mesa_expediente_ops_sin_asignar_check CHECK (
    estado_mesa <> 'sin_asignar' OR assigned_to IS NULL
  )
);

CREATE INDEX mesa_expediente_ops_organization_estado_idx
  ON public.mesa_expediente_ops (organization_id, estado_mesa);

CREATE INDEX mesa_expediente_ops_assigned_to_idx
  ON public.mesa_expediente_ops (assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE TRIGGER mesa_expediente_ops_set_updated_at
  BEFORE UPDATE ON public.mesa_expediente_ops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.mesa_expediente_ops IS
  'Fase 1A: estado operativo Mesa por expediente (1:1). Modo sombra; no bloquea flujos existentes.';

-- =============================================================================
-- RLS (solo SELECT; mutaciones vía RPC SECURITY DEFINER)
-- =============================================================================
ALTER TABLE public.mesa_expediente_ops ENABLE ROW LEVEL SECURITY;

CREATE POLICY mesa_expediente_ops_select
  ON public.mesa_expediente_ops
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

GRANT SELECT ON TABLE public.mesa_expediente_ops TO authenticated;

-- =============================================================================
-- backfill_mesa_expediente_ops
-- =============================================================================
CREATE OR REPLACE FUNCTION public.backfill_mesa_expediente_ops()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.mesa_expediente_ops (
      expediente_id,
      organization_id,
      estado_mesa,
      last_activity_at
    )
    SELECT
      e.id,
      e.organization_id,
      'sin_asignar'::public.mesa_expediente_estado,
      COALESCE(e.fecha_envio_mesa, e.created_at)
    FROM public.expedientes e
    WHERE e.submitted_to_mesa = true
      AND e.ciclo_estado = 'activo'
      AND e.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.mesa_expediente_ops mo
        WHERE mo.expediente_id = e.id
      )
    ON CONFLICT (expediente_id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted
  );
END;
$$;

COMMENT ON FUNCTION public.backfill_mesa_expediente_ops() IS
  'Backfill idempotente: fila sin_asignar para expedientes enviados a Mesa, ciclo activo, sin fila ops.';

REVOKE ALL ON FUNCTION public.backfill_mesa_expediente_ops() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_mesa_expediente_ops() FROM anon;
REVOKE ALL ON FUNCTION public.backfill_mesa_expediente_ops() FROM authenticated;

SELECT public.backfill_mesa_expediente_ops();
