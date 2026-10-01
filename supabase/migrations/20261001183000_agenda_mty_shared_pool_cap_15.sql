-- ConCasa CRM — Monterrey: Firmas + Inscripción + Notificación comparten máximo 15 personas/día.
-- Drive físico manda cuando existe snapshot fresco; CRM protege bookings todavía no proyectados.
-- Inscripción conserva además su límite propio. Apodaca queda fuera de este pool.

BEGIN;

CREATE TABLE IF NOT EXISTS public.agenda_mty_shared_pool_snapshot (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  physical_occupancy INTEGER NOT NULL CHECK (physical_occupancy >= 0),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'sheet',
  PRIMARY KEY (organization_id, booking_date)
);

ALTER TABLE public.agenda_mty_shared_pool_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_mty_shared_pool_snapshot FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agenda_mty_shared_pool_snapshot
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_mty_shared_pool_snapshot_upsert(
  p_organization_id UUID,
  p_booking_date DATE,
  p_physical_occupancy INTEGER,
  p_source TEXT DEFAULT 'sheet'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_organization_id IS NULL
     OR p_booking_date IS NULL
     OR p_physical_occupancy IS NULL
     OR p_physical_occupancy < 0 THEN
    RAISE EXCEPTION 'agenda_mty_shared_pool_snapshot_upsert: parámetros inválidos'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_mty_shared_pool_snapshot (
    organization_id, booking_date, physical_occupancy, observed_at, source
  )
  VALUES (
    p_organization_id,
    p_booking_date,
    p_physical_occupancy,
    NOW(),
    left(COALESCE(NULLIF(btrim(p_source), ''), 'sheet'), 80)
  )
  ON CONFLICT (organization_id, booking_date) DO UPDATE SET
    physical_occupancy = EXCLUDED.physical_occupancy,
    observed_at = NOW(),
    source = EXCLUDED.source;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_date', p_booking_date,
    'physical_occupancy', p_physical_occupancy
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_mty_shared_pool_snapshot_upsert(UUID,DATE,INTEGER,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_mty_shared_pool_snapshot_upsert(UUID,DATE,INTEGER,TEXT)
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_mty_shared_pool_crm_occupancy(
  p_org UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT count(DISTINCT COALESCE(
    NULLIF(public.agenda_sheet_normalize_nss(e.nss::TEXT), ''),
    e.id::TEXT,
    b.id::TEXT
  ))::INTEGER
  FROM public.agenda_bookings b
  LEFT JOIN public.expedientes e ON e.id = b.expediente_id
  WHERE b.organization_id = p_org
    AND b.booking_date = p_date
    AND b.status = 'booked'::public.booking_status
    AND (
      (
        b.kind = 'firmas'::public.booking_kind
        AND public.agenda_firmas_canonical_location_id(b.location_id) = 'monterrey'
      )
      OR (
        b.kind IN ('inscripcion'::public.booking_kind, 'notificacion'::public.booking_kind)
        AND lower(btrim(COALESCE(b.location_id, ''))) = 'monterrey'
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.agenda_mty_shared_pool_crm_occupancy(UUID,DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_mty_shared_pool_crm_occupancy(UUID,DATE)
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_mty_shared_pool_occupancy(
  p_org UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_snapshot INTEGER;
  v_inventory INTEGER := 0;
  v_crm INTEGER := 0;
BEGIN
  IF p_org IS NULL OR p_date IS NULL THEN
    RETURN 0;
  END IF;

  SELECT s.physical_occupancy
  INTO v_snapshot
  FROM public.agenda_mty_shared_pool_snapshot s
  WHERE s.organization_id = p_org
    AND s.booking_date = p_date
    AND s.observed_at >= NOW() - interval '6 hours';

  v_crm := COALESCE(public.agenda_mty_shared_pool_crm_occupancy(p_org, p_date), 0);

  IF v_snapshot IS NOT NULL THEN
    RETURN GREATEST(v_snapshot, v_crm);
  END IF;

  v_inventory :=
    COALESCE(public.agenda_daily_active_occupancy(
      p_org, 'firmas', p_date, 'monterrey'
    ), 0)
    +
    COALESCE(public.agenda_daily_active_occupancy(
      p_org, 'inscripcion', p_date, 'monterrey'
    ), 0);

  RETURN GREATEST(v_inventory, v_crm);
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_mty_shared_pool_occupancy(UUID,DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_mty_shared_pool_occupancy(UUID,DATE)
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_mty_shared_pool_remaining(
  p_org UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT GREATEST(
    0,
    15 - public.agenda_mty_shared_pool_occupancy(p_org, p_date)
  )::INTEGER;
$function$;

REVOKE ALL ON FUNCTION public.agenda_mty_shared_pool_remaining(UUID,DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_mty_shared_pool_remaining(UUID,DATE)
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_guard_mty_shared_pool_biu()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_new_shared BOOLEAN := false;
  v_old_shared BOOLEAN := false;
  v_occupancy INTEGER := 0;
BEGIN
  v_new_shared :=
    NEW.status = 'booked'::public.booking_status
    AND (
      (
        NEW.kind = 'firmas'::public.booking_kind
        AND public.agenda_firmas_canonical_location_id(NEW.location_id) = 'monterrey'
      )
      OR (
        NEW.kind IN ('inscripcion'::public.booking_kind, 'notificacion'::public.booking_kind)
        AND lower(btrim(COALESCE(NEW.location_id, ''))) = 'monterrey'
      )
    );

  IF NOT v_new_shared THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_shared :=
      OLD.status = 'booked'::public.booking_status
      AND (
        (
          OLD.kind = 'firmas'::public.booking_kind
          AND public.agenda_firmas_canonical_location_id(OLD.location_id) = 'monterrey'
        )
        OR (
          OLD.kind IN ('inscripcion'::public.booking_kind, 'notificacion'::public.booking_kind)
          AND lower(btrim(COALESCE(OLD.location_id, ''))) = 'monterrey'
        )
      );

    IF v_old_shared
       AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
       AND OLD.booking_date IS NOT DISTINCT FROM NEW.booking_date THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        COALESCE(NEW.organization_id::TEXT, ''),
        'monterrey_shared_firmas_inscripcion_notificacion',
        COALESCE(NEW.booking_date::TEXT, '')
      ),
      0
    )
  );

  v_occupancy := public.agenda_mty_shared_pool_occupancy(
    NEW.organization_id,
    NEW.booking_date
  );

  IF v_occupancy >= 15 THEN
    RAISE EXCEPTION
      'SIN_CUPO_COMBINADO_MTY_15: Firmas + Inscripción + Notificación ya tienen % de 15 lugares para %',
      v_occupancy,
      NEW.booking_date
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS a0_agenda_guard_mty_shared_pool_biu
  ON public.agenda_bookings;
CREATE TRIGGER a0_agenda_guard_mty_shared_pool_biu
BEFORE INSERT OR UPDATE OF organization_id, kind, status, booking_date, location_id
ON public.agenda_bookings
FOR EACH ROW
EXECUTE FUNCTION public.agenda_guard_mty_shared_pool_biu();

COMMENT ON FUNCTION public.agenda_mty_shared_pool_occupancy(UUID,DATE) IS
  'Monterrey Firmas+Inscripción+Notificación: snapshot físico Drive fresco manda; CRM protege bookings aún no proyectados; inventario es fallback si snapshot >6h.';
COMMENT ON FUNCTION public.agenda_guard_mty_shared_pool_biu() IS
  'Hard-cap DB: bloquea la persona #16 del pool compartido Monterrey Firmas + Inscripción + Notificación.';

-- Auditoría física del Drive CITAS 2026 realizada el 2026-10-01.
WITH org AS (
  SELECT p.organization_id
  FROM public.profiles p
  WHERE lower(p.email) = 'admin@concasa.mx'
    AND p.active = true
  LIMIT 1
),
audit(booking_date, physical_occupancy) AS (
  VALUES
    (DATE '2026-10-01',13),
    (DATE '2026-10-02',15),
    (DATE '2026-10-05',16),
    (DATE '2026-10-06',9),
    (DATE '2026-10-07',3),
    (DATE '2026-10-08',0),
    (DATE '2026-10-09',0),
    (DATE '2026-10-12',0),
    (DATE '2026-10-13',0),
    (DATE '2026-10-14',0),
    (DATE '2026-10-15',0),
    (DATE '2026-10-16',0),
    (DATE '2026-10-19',1),
    (DATE '2026-10-20',0),
    (DATE '2026-10-21',0),
    (DATE '2026-10-22',0),
    (DATE '2026-10-23',0),
    (DATE '2026-10-26',0),
    (DATE '2026-10-27',0),
    (DATE '2026-10-28',0),
    (DATE '2026-10-29',0),
    (DATE '2026-10-30',0)
)
INSERT INTO public.agenda_mty_shared_pool_snapshot (
  organization_id, booking_date, physical_occupancy, observed_at, source
)
SELECT
  org.organization_id,
  audit.booking_date,
  audit.physical_occupancy,
  NOW(),
  'drive_october_2026_audit'
FROM org
CROSS JOIN audit
ON CONFLICT (organization_id, booking_date) DO UPDATE SET
  physical_occupancy = EXCLUDED.physical_occupancy,
  observed_at = NOW(),
  source = EXCLUDED.source;

COMMIT;
