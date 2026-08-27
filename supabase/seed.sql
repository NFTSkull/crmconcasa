-- ConCasa CRM — seed dev (solo local / db reset)
-- Sin PII real. Idempotente vía ON CONFLICT.

-- =============================================================================
-- UUIDs fijos dev (simulan auth.uid() en pruebas RLS)
-- =============================================================================
-- Org
--   00000000-0000-4000-8000-000000000001
-- Perfiles
--   asesor_interno   00000000-0000-4000-8001-000000000001
--   asesor_externo   00000000-0000-4000-8001-000000000002
--   editor           00000000-0000-4000-8002-000000000001
--   mesa_admin       00000000-0000-4000-8003-000000000001
--   mesa_interno     00000000-0000-4000-8004-000000000001
--   mesa_externo     00000000-0000-4000-8005-000000000001
--   super_admin      00000000-0000-4000-8006-000000000001
-- Expedientes fixture
--   exp_int_env_a1   00000000-0000-4000-9001-000000000001
--   exp_ext_env_a2   00000000-0000-4000-9001-000000000002
--   exp_int_draft_a1 00000000-0000-4000-9001-000000000003
--   exp_int_env_a2   00000000-0000-4000-9001-000000000004

-- P078 (Cloud bootstrap) puede haber creado org 50beae49…/slug=concasa antes del seed.
-- Suites locales dependen del id canónico 00000000-…0001; ON CONFLICT(slug) no cambia el id.
DO $$
DECLARE
  seed_org CONSTANT uuid := '00000000-0000-4000-8000-000000000001';
  cloud_org CONSTANT uuid := '50beae49-3961-4163-8e78-2251693f2c19';
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = cloud_org) THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = seed_org) THEN
      INSERT INTO public.organizations (id, slug, name, active)
      VALUES (seed_org, '__concasa_seed_tmp__', 'ConCasa', true);
    END IF;

    UPDATE public.organizations
    SET slug = '__concasa_cloud_old__',
        updated_at = NOW()
    WHERE id = cloud_org
      AND slug = 'concasa';

    FOR r IN
      SELECT c.table_schema, c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'organization_id'
        AND t.table_type = 'BASE TABLE'
    LOOP
      EXECUTE format(
        'UPDATE %I.%I SET organization_id = $1 WHERE organization_id = $2',
        r.table_schema,
        r.table_name
      ) USING seed_org, cloud_org;
    END LOOP;

    DELETE FROM public.organizations WHERE id = cloud_org;
  END IF;
END;
$$;

INSERT INTO public.organizations (id, slug, name, active)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'concasa',
  'ConCasa',
  true
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  active = EXCLUDED.active,
  updated_at = NOW();

INSERT INTO public.profiles (
  id, organization_id, email, full_name, app_role, tipo_mesa, tipo_asesor_origen, active
) VALUES
  (
    '00000000-0000-4000-8001-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'dev.asesor.interno@concasa.local',
    'Dev Asesor Interno',
    'asesor',
    NULL,
    'interno',
    true
  ),
  (
    '00000000-0000-4000-8001-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'dev.asesor.externo@concasa.local',
    'Dev Asesor Externo',
    'asesor',
    NULL,
    'externo',
    true
  ),
  (
    '00000000-0000-4000-8002-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'dev.editor@concasa.local',
    'Dev Editor',
    'editor',
    NULL,
    NULL,
    true
  ),
  (
    '00000000-0000-4000-8003-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'dev.mesa.admin@concasa.local',
    'Dev Mesa Admin',
    'mesa_admin',
    NULL,
    NULL,
    true
  ),
  (
    '00000000-0000-4000-8004-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'dev.mesa.interno@concasa.local',
    'Dev Mesa Interno',
    'mesa_interno',
    'interno',
    NULL,
    true
  ),
  (
    '00000000-0000-4000-8005-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'dev.mesa.externo@concasa.local',
    'Dev Mesa Externo',
    'mesa_externo',
    'externo',
    NULL,
    true
  ),
  (
    '00000000-0000-4000-8006-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'dev.super@concasa.local',
    'Dev Super Admin',
    'super_admin',
    NULL,
    NULL,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  app_role = EXCLUDED.app_role,
  tipo_mesa = EXCLUDED.tipo_mesa,
  tipo_asesor_origen = EXCLUDED.tipo_asesor_origen,
  active = EXCLUDED.active,
  updated_at = NOW();

-- Expedientes fixture (sin documentos ni datos cliente reales)
INSERT INTO public.expedientes (
  id, organization_id, asesor_id, programa, nss, cliente_nombre,
  telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
  etapa_actual, subestado
) VALUES
  (
    '00000000-0000-4000-9001-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8001-000000000001',
    'mejoravit',
    '11111111111',
    'Cliente Dev Interno Enviado A1',
    '5511111111',
    'interno',
    true,
    NOW(),
    1,
    'en_validacion_mesa'
  ),
  (
    '00000000-0000-4000-9001-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8001-000000000002',
    'mejoravit',
    '22222222222',
    'Cliente Dev Externo Enviado A2',
    '5522222222',
    'externo',
    true,
    NOW(),
    1,
    'en_validacion_mesa'
  ),
  (
    '00000000-0000-4000-9001-000000000003',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8001-000000000001',
    'subcuenta',
    '33333333333',
    'Cliente Dev Borrador A1',
    '5533333333',
    'interno',
    false,
    NULL,
    1,
    'pendiente'
  ),
  (
    '00000000-0000-4000-9001-000000000004',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8001-000000000002',
    'subcuenta',
    '44444444444',
    'Cliente Dev Interno Enviado A2',
    '5544444444',
    'interno',
    true,
    NOW(),
    1,
    'en_validacion_mesa'
  )
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  asesor_id = EXCLUDED.asesor_id,
  programa = EXCLUDED.programa,
  nss = EXCLUDED.nss,
  cliente_nombre = EXCLUDED.cliente_nombre,
  telefono_cliente = EXCLUDED.telefono_cliente,
  origen_mesa = EXCLUDED.origen_mesa,
  submitted_to_mesa = EXCLUDED.submitted_to_mesa,
  fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
  etapa_actual = EXCLUDED.etapa_actual,
  subestado = EXCLUDED.subestado,
  updated_at = NOW();

-- Hijo mínimo para probar visibilidad en tablas relacionadas
INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
VALUES (
  '00000000-0000-4000-9001-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'pendiente'
)
ON CONFLICT (expediente_id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  decision = EXCLUDED.decision,
  updated_at = NOW();

INSERT INTO public.action_log (
  id, organization_id, actor_id, actor_role, action, entity_type, entity_id, payload
) VALUES (
  '00000000-0000-4000-9003-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8003-000000000001',
  'mesa_admin',
  'expediente.fixture_seed',
  'expediente',
  '00000000-0000-4000-9001-000000000001',
  '{"source":"seed.sql"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  action = EXCLUDED.action,
  payload = EXCLUDED.payload;

INSERT INTO public.agenda_config (id, organization_id, kind, config)
VALUES (
  '00000000-0000-4000-9002-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'biometricos',
  '{"minLeadDays":2,"slotsPerDay":4}'::jsonb
)
ON CONFLICT (organization_id, kind) DO UPDATE SET
  config = EXCLUDED.config,
  updated_at = NOW();
-- Firmas config mínima (org seed nace post-mig 024; backfill no la ve)
INSERT INTO public.agenda_config (id, organization_id, kind, config)
VALUES (
  '00000000-0000-4000-9002-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'firmas',
  '{"enabled":true,"timezone":"America/Monterrey","min_lead_hours":1,"allowed_weekdays":[1,2,3,4,5],"slots":["10:00","11:00"],"locations":{"mty-centro":{"enabled":true,"capacity_per_slot":3},"san-nicolas":{"enabled":true,"capacity_per_slot":2}}}'::jsonb
)
ON CONFLICT (organization_id, kind) DO UPDATE SET
  config = EXCLUDED.config,
  updated_at = NOW();
