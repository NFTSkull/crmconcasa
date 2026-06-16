-- ConCasa CRM — P1 core schema
-- Fase: P1 (sin policies RLS detalladas; deny-by-default)
-- Aplicar solo en entorno controlado. NO ejecutar contra producción sin revisión.

-- =============================================================================
-- Extensions
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- Enums
-- =============================================================================
CREATE TYPE public.app_role AS ENUM (
  'asesor',
  'editor',
  'mesa_admin',
  'mesa_interno',
  'mesa_externo',
  'super_admin'
);

CREATE TYPE public.programa AS ENUM (
  'mejoravit',
  'subcuenta',
  'compro_tu_casa'
);

CREATE TYPE public.origen_mesa AS ENUM (
  'interno',
  'externo'
);

CREATE TYPE public.operativo_subestado AS ENUM (
  'pendiente',
  'en_validacion_mesa',
  'en_proceso',
  'aprobado',
  'rechazado'
);

CREATE TYPE public.editor_decision AS ENUM (
  'pendiente',
  'aprobado',
  'no_cumple'
);

CREATE TYPE public.cliente_datos_estado AS ENUM (
  'pendiente',
  'completo',
  'validado',
  'rechazado'
);

CREATE TYPE public.estatus_revision AS ENUM (
  'subido',
  'validado',
  'rechazado',
  'resubido'
);

CREATE TYPE public.retencion_opcion AS ENUM (
  'con_sello',
  'sin_sello'
);

CREATE TYPE public.retencion_envio_estado AS ENUM (
  'enviado',
  'correccion_requerida'
);

CREATE TYPE public.booking_kind AS ENUM (
  'biometricos',
  'firmas'
);

CREATE TYPE public.booking_status AS ENUM (
  'booked',
  'cancelled'
);

CREATE TYPE public.expediente_ciclo_estado AS ENUM (
  'activo',
  'cerrado',
  'cancelado'
);

CREATE TYPE public.tipo_asesor_origen AS ENUM (
  'interno',
  'externo'
);

-- =============================================================================
-- Helpers: updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 1. organizations
-- =============================================================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organizations_slug_unique UNIQUE (slug)
);

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 2. profiles (extends auth.users — FK added when Auth enabled)
-- =============================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  app_role public.app_role NOT NULL,
  tipo_mesa public.origen_mesa NULL,
  tipo_asesor_origen public.tipo_asesor_origen NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_email_unique UNIQUE (email),
  CONSTRAINT profiles_tipo_mesa_check CHECK (
    (app_role IN ('mesa_interno', 'mesa_externo') AND tipo_mesa IS NOT NULL)
    OR (app_role NOT IN ('mesa_interno', 'mesa_externo'))
  )
);

CREATE INDEX profiles_organization_id_idx ON public.profiles (organization_id);
CREATE INDEX profiles_app_role_idx ON public.profiles (app_role);

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- TODO P2: ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey
--   FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- =============================================================================
-- 3. expedientes
-- =============================================================================
CREATE TABLE public.expedientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  asesor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  expediente_anterior_id UUID NULL REFERENCES public.expedientes(id) ON DELETE SET NULL,
  programa public.programa NOT NULL,
  nss CHAR(11) NOT NULL,
  cliente_nombre TEXT NOT NULL,
  telefono_cliente CHAR(10) NOT NULL,
  direccion_opcional TEXT NOT NULL DEFAULT '',
  origen_mesa public.origen_mesa NOT NULL,
  ciclo_estado public.expediente_ciclo_estado NOT NULL DEFAULT 'activo',
  submitted_to_mesa BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_envio_mesa TIMESTAMPTZ NULL,
  etapa_actual SMALLINT NOT NULL DEFAULT 1,
  subestado public.operativo_subestado NOT NULL DEFAULT 'pendiente',
  motivo_rechazo TEXT NULL,
  comentario_rechazo TEXT NULL,
  fecha_cita TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expedientes_etapa_check CHECK (etapa_actual >= 1 AND etapa_actual <= 12),
  CONSTRAINT expedientes_telefono_check CHECK (telefono_cliente ~ '^[0-9]{10}$'),
  CONSTRAINT expedientes_nss_check CHECK (nss ~ '^[0-9]{11}$')
);

CREATE INDEX expedientes_organization_id_idx ON public.expedientes (organization_id);
CREATE INDEX expedientes_asesor_id_created_at_idx ON public.expedientes (asesor_id, created_at DESC);
CREATE INDEX expedientes_mesa_bandaja_idx ON public.expedientes (organization_id, submitted_to_mesa, etapa_actual)
  WHERE deleted_at IS NULL;
CREATE INDEX expedientes_origen_mesa_idx ON public.expedientes (origen_mesa)
  WHERE deleted_at IS NULL AND submitted_to_mesa = TRUE;
CREATE INDEX expedientes_anterior_idx ON public.expedientes (expediente_anterior_id)
  WHERE expediente_anterior_id IS NOT NULL;

-- Un solo ciclo activo por NSS + programa + org (historial permitido en cerrado/cancelado)
CREATE UNIQUE INDEX expedientes_nss_programa_activo_unique
  ON public.expedientes (organization_id, nss, programa)
  WHERE ciclo_estado = 'activo' AND deleted_at IS NULL;

CREATE TRIGGER expedientes_set_updated_at
  BEFORE UPDATE ON public.expedientes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 4. editor_decisions
-- =============================================================================
CREATE TABLE public.editor_decisions (
  expediente_id UUID PRIMARY KEY REFERENCES public.expedientes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  decision public.editor_decision NOT NULL DEFAULT 'pendiente',
  monto_aprobado NUMERIC(14, 2) NULL,
  notas_revision TEXT NOT NULL DEFAULT '',
  decided_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX editor_decisions_organization_id_idx ON public.editor_decisions (organization_id);

CREATE TRIGGER editor_decisions_set_updated_at
  BEFORE UPDATE ON public.editor_decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 5. cliente_datos
-- =============================================================================
CREATE TABLE public.cliente_datos (
  expediente_id UUID PRIMARY KEY REFERENCES public.expedientes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  datos JSONB NOT NULL DEFAULT '{}'::JSONB,
  estado public.cliente_datos_estado NOT NULL DEFAULT 'pendiente',
  comentario_rechazo TEXT NULL,
  validated_at TIMESTAMPTZ NULL,
  validated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ NULL,
  rejected_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX cliente_datos_organization_id_idx ON public.cliente_datos (organization_id);
CREATE INDEX cliente_datos_datos_rfc_idx ON public.cliente_datos ((datos->>'rfc'));

CREATE TRIGGER cliente_datos_set_updated_at
  BEFORE UPDATE ON public.cliente_datos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 6. expediente_documentos
-- =============================================================================
CREATE TABLE public.expediente_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  tipo_documento TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  nombre_original TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  estatus_revision public.estatus_revision NOT NULL DEFAULT 'subido',
  comentario_mesa TEXT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_by_role TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_documentos_size_nonneg CHECK (size_bytes >= 0),
  CONSTRAINT expediente_documentos_version_pos CHECK (version >= 1)
);

CREATE INDEX expediente_documentos_expediente_id_idx ON public.expediente_documentos (expediente_id);
CREATE INDEX expediente_documentos_org_expediente_idx ON public.expediente_documentos (organization_id, expediente_id);

-- Un documento activo por tipo y expediente
CREATE UNIQUE INDEX expediente_documentos_active_tipo_unique
  ON public.expediente_documentos (expediente_id, tipo_documento)
  WHERE deleted_at IS NULL;

CREATE TRIGGER expediente_documentos_set_updated_at
  BEFORE UPDATE ON public.expediente_documentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 7. documento_revisiones (historial inmutable)
-- =============================================================================
CREATE TABLE public.documento_revisiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  documento_id UUID NOT NULL REFERENCES public.expediente_documentos(id) ON DELETE CASCADE,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  estatus_anterior public.estatus_revision NULL,
  estatus_nuevo public.estatus_revision NOT NULL,
  comentario_mesa TEXT NULL,
  actor_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX documento_revisiones_documento_id_idx ON public.documento_revisiones (documento_id, created_at DESC);
CREATE INDEX documento_revisiones_expediente_id_idx ON public.documento_revisiones (expediente_id, created_at DESC);

-- =============================================================================
-- 8. retencion_opciones
-- =============================================================================
CREATE TABLE public.retencion_opciones (
  expediente_id UUID PRIMARY KEY REFERENCES public.expedientes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  retencion_opcion public.retencion_opcion NOT NULL,
  updated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER retencion_opciones_set_updated_at
  BEFORE UPDATE ON public.retencion_opciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 9. retencion_envios
-- =============================================================================
CREATE TABLE public.retencion_envios (
  expediente_id UUID PRIMARY KEY REFERENCES public.expedientes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  enviado BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_envio_mesa TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opcion public.retencion_opcion NOT NULL,
  estado public.retencion_envio_estado NOT NULL DEFAULT 'enviado',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER retencion_envios_set_updated_at
  BEFORE UPDATE ON public.retencion_envios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 10. agenda_config
-- =============================================================================
CREATE TABLE public.agenda_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  kind public.booking_kind NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_config_org_kind_unique UNIQUE (organization_id, kind)
);

CREATE TRIGGER agenda_config_set_updated_at
  BEFORE UPDATE ON public.agenda_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 11. agenda_bookings
-- =============================================================================
CREATE TABLE public.agenda_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  kind public.booking_kind NOT NULL,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  location_id TEXT NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'booked',
  note TEXT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cancelled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agenda_bookings_expediente_kind_status_idx
  ON public.agenda_bookings (expediente_id, kind, status);
CREATE INDEX agenda_bookings_slot_idx
  ON public.agenda_bookings (organization_id, kind, booking_date, location_id, booking_time)
  WHERE status = 'booked';

CREATE TRIGGER agenda_bookings_set_updated_at
  BEFORE UPDATE ON public.agenda_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 12. expediente_notas
-- =============================================================================
CREATE TABLE public.expediente_notas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  etapa_id SMALLINT NOT NULL,
  nota TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_notas_etapa_check CHECK (etapa_id >= 1 AND etapa_id <= 12)
);

CREATE INDEX expediente_notas_expediente_id_idx ON public.expediente_notas (expediente_id, created_at DESC);

-- =============================================================================
-- 13. action_log
-- =============================================================================
CREATE TABLE public.action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role public.app_role NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX action_log_entity_idx ON public.action_log (entity_type, entity_id, created_at DESC);
CREATE INDEX action_log_organization_created_idx ON public.action_log (organization_id, created_at DESC);

-- =============================================================================
-- 14. audit_events (inmutable)
-- =============================================================================
CREATE TABLE public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  actor_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  expediente_id UUID NULL REFERENCES public.expedientes(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address INET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_events_organization_created_idx ON public.audit_events (organization_id, created_at DESC);
CREATE INDEX audit_events_expediente_id_idx ON public.audit_events (expediente_id)
  WHERE expediente_id IS NOT NULL;

-- =============================================================================
-- Row Level Security — enabled, deny-by-default (policies en P2/P6)
-- =============================================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_datos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expediente_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documento_revisiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retencion_opciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retencion_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expediente_notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- TODO P2/P6: CREATE POLICY ... (ver docs/ARQUITECTURA_PRODUCCION.md)
-- TODO P2: trigger documento_revisiones ON UPDATE expediente_documentos.estatus_revision
-- TODO P2: RPC avanzar_etapa_operativa con validaciones de negocio
-- TODO P5: Storage bucket expediente-documentos + policies

-- =============================================================================
-- Seed mínimo (solo entornos dev/staging controlados)
-- Descomentar manualmente si se desea org ConCasa en local Supabase:
-- =============================================================================
-- INSERT INTO public.organizations (id, slug, name)
-- VALUES ('00000000-0000-4000-8000-000000000001', 'concasa', 'ConCasa')
-- ON CONFLICT (slug) DO NOTHING;
