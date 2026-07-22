-- P098 — Permitir el mismo teléfono en varios expedientes / precalificaciones.
-- Identidad canónica: expediente_id (PK de cliente_datos) y reglas NSS vigentes.
-- El teléfono NO es llave única, criterio de upsert ni identificador del cliente.
-- No modifica NSS ni propiedad de expedientes. Sin aplicar Cloud en este bloque.

-- 1) Quitar unicidad org+teléfono (conserva columna y datos)
DROP INDEX IF EXISTS public.cliente_datos_org_telefono_normalizado_unique_idx;

-- Índice no único para búsquedas / reportes (sin constraint)
CREATE INDEX IF NOT EXISTS cliente_datos_org_telefono_normalizado_idx
  ON public.cliente_datos (organization_id, telefono_normalizado)
  WHERE telefono_normalizado IS NOT NULL
    AND telefono_normalizado <> '';

-- 2) Helper de ocupación cross-expediente: siempre libre (firma conservada).
--    save_cliente_datos sigue validando unicidad INTRA-payload
--    (cliente ≠ referencias; referencias entre sí).
CREATE OR REPLACE FUNCTION public.cliente_datos_telefono_ocupado_en_org(
  p_org_id UUID,
  p_exclude_expediente_id UUID,
  p_telefono_normalizado TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT false;
$$;

COMMENT ON FUNCTION public.cliente_datos_telefono_ocupado_en_org(UUID, UUID, TEXT) IS
  'P098: siempre false. Teléfonos pueden repetirse entre expedientes; '
  'unicidad solo intra-payload en save_cliente_datos.';
