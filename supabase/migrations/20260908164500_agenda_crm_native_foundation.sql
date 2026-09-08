-- ConCasa CRM — Agenda CRM-only: foundation + snapshot Septiembre 2026.
-- Fase aditiva: NO corta Google todavía, NO modifica bookings/etapas/expedientes.
-- Copia ocupaciones manuales y resultados operativos del snapshot ya reconciliado.

CREATE TABLE IF NOT EXISTS public.agenda_manual_occupancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  kind public.booking_kind NOT NULL,
  location_id text NOT NULL,
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  display_time time NOT NULL,
  nss text,
  cliente_nombre text,
  asesor_nombre text,
  asesor_id uuid REFERENCES public.profiles(id),
  expediente_id uuid REFERENCES public.expedientes(id),
  reconciled_booking_id uuid REFERENCES public.agenda_bookings(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  counts_toward_capacity boolean NOT NULL DEFAULT true,
  notes text,
  source text NOT NULL DEFAULT 'manual_crm' CHECK (source IN ('manual_crm','legacy_sheet_snapshot')),
  source_inventory_id uuid UNIQUE,
  source_spreadsheet_id text,
  source_sheet_id bigint,
  source_sheet_title text,
  source_sheet_row integer,
  created_by uuid REFERENCES public.profiles(id),
  cancelled_by uuid REFERENCES public.profiles(id),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind::text IN ('biometricos','firmas','inscripcion')),
  CHECK (btrim(location_id) <> ''),
  CHECK (cliente_nombre IS NULL OR btrim(cliente_nombre) <> '')
);

CREATE INDEX IF NOT EXISTS agenda_manual_occupancies_scope_idx
  ON public.agenda_manual_occupancies
  (organization_id, booking_date, kind, location_id, booking_time, status);
CREATE INDEX IF NOT EXISTS agenda_manual_occupancies_exp_idx
  ON public.agenda_manual_occupancies(expediente_id)
  WHERE expediente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_manual_occupancies_reconciled_idx
  ON public.agenda_manual_occupancies(reconciled_booking_id)
  WHERE reconciled_booking_id IS NOT NULL;

ALTER TABLE public.agenda_manual_occupancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_manual_occupancies FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.agenda_manual_occupancies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_manual_occupancies TO service_role, postgres;

DROP TRIGGER IF EXISTS agenda_manual_occupancies_updated_at
  ON public.agenda_manual_occupancies;
CREATE TRIGGER agenda_manual_occupancies_updated_at
BEFORE UPDATE ON public.agenda_manual_occupancies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agenda_manual_occupancies IS
  'Agenda CRM: ocupaciones sin booking operativo. Incluye snapshot manual histórico del Sheet; nunca muta etapa por sí sola.';

CREATE TABLE IF NOT EXISTS public.agenda_operational_results_native (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  booking_id uuid REFERENCES public.agenda_bookings(id),
  manual_occupancy_id uuid REFERENCES public.agenda_manual_occupancies(id),
  expediente_id uuid REFERENCES public.expedientes(id),
  kind text NOT NULL CHECK (kind IN ('biometricos','firmas','inscripcion')),
  location_id text NOT NULL,
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  biometric_result_class text,
  biometric_result_raw text,
  biometric_color text,
  notification_result_class text,
  notification_result_raw text,
  notification_color text,
  signature_result_class text,
  signature_result_raw text,
  signature_color text,
  notes_raw text,
  biometric_cell_red boolean NOT NULL DEFAULT false,
  notification_cell_red boolean NOT NULL DEFAULT false,
  signature_cell_red boolean NOT NULL DEFAULT false,
  operational_red_veto boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual_crm' CHECK (source IN ('manual_crm','legacy_sheet_snapshot')),
  source_result_id uuid UNIQUE,
  source_spreadsheet_id text,
  source_sheet_id bigint,
  source_sheet_title text,
  source_sheet_row integer,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agenda_operational_results_native_scope_idx
  ON public.agenda_operational_results_native
  (organization_id, booking_date, kind, location_id, booking_time);
CREATE INDEX IF NOT EXISTS agenda_operational_results_native_booking_idx
  ON public.agenda_operational_results_native(booking_id)
  WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_operational_results_native_manual_idx
  ON public.agenda_operational_results_native(manual_occupancy_id)
  WHERE manual_occupancy_id IS NOT NULL;

ALTER TABLE public.agenda_operational_results_native ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_operational_results_native FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.agenda_operational_results_native FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_operational_results_native TO service_role, postgres;

DROP TRIGGER IF EXISTS agenda_operational_results_native_updated_at
  ON public.agenda_operational_results_native;
CREATE TRIGGER agenda_operational_results_native_updated_at
BEFORE UPDATE ON public.agenda_operational_results_native
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agenda_operational_results_native IS
  'Agenda CRM: resultado/nota/color semántico nativo. Snapshot septiembre conserva la lectura histórica de CITAS 2026 sin depender del Drive.';

-- -----------------------------------------------------------------------------
-- Snapshot Septiembre: ocupaciones manuales.
-- 28 filas que coinciden 1:1 con booking CRM se conservan como evidencia,
-- pero reconciled_booking_id evita doble visualización/cupo.
-- -----------------------------------------------------------------------------
WITH src AS (
  SELECT
    i.*,
    regexp_replace(COALESCE(i.visible_nss, ''), '\\D', '', 'g') AS nss_norm
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.booking_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'
    AND i.status = 'occupied_external'
), resolved AS (
  SELECT
    s.*,
    rb.booking_id AS matched_booking_id,
    rb.expediente_id AS matched_booking_exp,
    ex.expediente_id AS unique_nss_exp
  FROM src s
  LEFT JOIN LATERAL (
    SELECT b.id AS booking_id, b.expediente_id
    FROM public.agenda_bookings b
    JOIN public.expedientes e ON e.id = b.expediente_id
    WHERE b.organization_id = s.organization_id
      AND b.booking_date = s.booking_date
      AND b.kind::text = s.kind
      AND lower(btrim(b.location_id)) = lower(btrim(s.location_id))
      AND b.booking_time = s.slot_time
      AND b.status = 'booked'
      AND s.nss_norm <> ''
      AND regexp_replace(COALESCE(e.nss, ''), '\\D', '', 'g') = s.nss_norm
    ORDER BY b.created_at DESC, b.id
    LIMIT 1
  ) rb ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN (array_agg(e.id ORDER BY e.id))[1] END AS expediente_id
    FROM public.expedientes e
    WHERE e.organization_id = s.organization_id
      AND e.deleted_at IS NULL
      AND s.nss_norm <> ''
      AND regexp_replace(COALESCE(e.nss, ''), '\\D', '', 'g') = s.nss_norm
  ) ex ON true
)
INSERT INTO public.agenda_manual_occupancies (
  organization_id, kind, location_id, booking_date, booking_time, display_time,
  nss, cliente_nombre, asesor_nombre, expediente_id, reconciled_booking_id,
  status, counts_toward_capacity, source, source_inventory_id,
  source_spreadsheet_id, source_sheet_id, source_sheet_title, source_sheet_row,
  created_at, updated_at
)
SELECT
  r.organization_id,
  r.kind::public.booking_kind,
  lower(btrim(r.location_id)),
  r.booking_date,
  r.slot_time,
  COALESCE(r.sheet_slot_time, r.slot_time),
  NULLIF(btrim(r.visible_nss), ''),
  NULLIF(btrim(r.visible_name), ''),
  NULLIF(btrim(r.visible_advisor), ''),
  COALESCE(r.matched_booking_exp, r.unique_nss_exp),
  r.matched_booking_id,
  'active',
  r.matched_booking_id IS NULL,
  'legacy_sheet_snapshot',
  r.id,
  r.spreadsheet_id,
  r.sheet_id,
  r.sheet_title,
  r.sheet_row,
  COALESCE(r.created_at, now()),
  COALESCE(r.updated_at, now())
FROM resolved r
ON CONFLICT (source_inventory_id) DO NOTHING;

-- Snapshot Septiembre: resultados/textos/notas/colores.
INSERT INTO public.agenda_operational_results_native (
  organization_id, booking_id, manual_occupancy_id, expediente_id,
  kind, location_id, booking_date, booking_time,
  biometric_result_class, biometric_result_raw, biometric_color,
  notification_result_class, notification_result_raw, notification_color,
  signature_result_class, signature_result_raw, signature_color,
  notes_raw,
  biometric_cell_red, notification_cell_red, signature_cell_red,
  operational_red_veto,
  source, source_result_id,
  source_spreadsheet_id, source_sheet_id, source_sheet_title, source_sheet_row,
  created_at, updated_at
)
SELECT
  r.organization_id,
  COALESCE(r.booking_id, mo.reconciled_booking_id),
  CASE WHEN mo.reconciled_booking_id IS NULL THEN mo.id ELSE NULL END,
  COALESCE(r.expediente_id, mo.expediente_id),
  r.kind,
  lower(btrim(r.location_id)),
  r.booking_date,
  r.slot_time,
  r.biometric_result_class,
  r.biometric_result_raw,
  r.biometric_color,
  r.notification_result_class,
  r.notification_result_raw,
  r.notification_color,
  r.signature_result_class,
  r.signature_result_raw,
  r.signature_color,
  r.notes_raw,
  COALESCE(r.biometric_cell_red, false),
  COALESCE(r.notification_cell_red, false),
  COALESCE(r.signature_cell_red, false),
  COALESCE(r.operational_red_veto, false),
  'legacy_sheet_snapshot',
  r.id,
  r.spreadsheet_id,
  r.sheet_id,
  r.sheet_title,
  r.sheet_row,
  COALESCE(r.created_at, now()),
  COALESCE(r.updated_at, now())
FROM public.agenda_sheet_operational_results r
LEFT JOIN public.agenda_sheet_slot_inventory i
  ON i.organization_id = r.organization_id
 AND i.spreadsheet_id = r.spreadsheet_id
 AND i.sheet_id = r.sheet_id
 AND i.sheet_row = r.sheet_row
LEFT JOIN public.agenda_manual_occupancies mo
  ON mo.source_inventory_id = i.id
WHERE r.booking_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'
ON CONFLICT (source_result_id) DO NOTHING;

-- Helpers nativos (todavía no conectan el flujo de reserva en esta fase).
CREATE OR REPLACE FUNCTION public.agenda_crm_manual_slot_active_count(
  p_org uuid,
  p_kind text,
  p_date date,
  p_time time,
  p_location text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.agenda_manual_occupancies m
  WHERE m.organization_id = p_org
    AND m.kind::text = lower(btrim(COALESCE(p_kind, '')))
    AND m.booking_date = p_date
    AND m.booking_time = p_time
    AND lower(btrim(m.location_id)) = lower(btrim(COALESCE(p_location, '')))
    AND m.status = 'active'
    AND m.counts_toward_capacity = true;
$$;

CREATE OR REPLACE FUNCTION public.agenda_crm_daily_manual_count(
  p_org uuid,
  p_kind text,
  p_date date,
  p_location text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.agenda_manual_occupancies m
  WHERE m.organization_id = p_org
    AND m.kind::text = lower(btrim(COALESCE(p_kind, '')))
    AND m.booking_date = p_date
    AND lower(btrim(m.location_id)) = lower(btrim(COALESCE(p_location, '')))
    AND m.status = 'active'
    AND m.counts_toward_capacity = true;
$$;

REVOKE ALL ON FUNCTION public.agenda_crm_manual_slot_active_count(uuid,text,date,time,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_crm_daily_manual_count(uuid,text,date,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_crm_manual_slot_active_count(uuid,text,date,time,text)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_crm_daily_manual_count(uuid,text,date,text)
  TO service_role, postgres;
