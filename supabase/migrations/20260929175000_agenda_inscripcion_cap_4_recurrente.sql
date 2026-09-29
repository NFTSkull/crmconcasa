-- ConCasa CRM — Agenda: cupos recurrentes de octubre y meses futuros.
-- Objetivo: conservar el contrato operativo usado al cierre de septiembre:
--   - Biométricos: hard-cap existente <=15 por sede (no se modifica aquí).
--   - Inscripción Monterrey: máximo 4 por día, 11:00, sin fecha de caducidad.
-- No mueve/cancela/crea citas ni modifica Google Sheets.

INSERT INTO public.agenda_daily_capacity_rules (
  kind,
  location_id,
  capacity,
  updated_at
)
VALUES (
  'inscripcion',
  'monterrey',
  4,
  NOW()
)
ON CONFLICT (kind, location_id)
DO UPDATE SET
  capacity = EXCLUDED.capacity,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.agenda_inscripcion_guard_daily_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cap INTEGER;
  v_remaining INTEGER;
BEGIN
  IF NEW.kind::TEXT IS DISTINCT FROM 'inscripcion'
     OR NEW.status::TEXT IS DISTINCT FROM 'booked'
     OR lower(btrim(COALESCE(NEW.location_id, ''))) IS DISTINCT FROM 'monterrey'
     OR NEW.booking_date < DATE '2026-09-01' THEN
    RETURN NEW;
  END IF;

  -- Actualizar una cita ya booked sin moverla de fecha/sede no consume otro lugar.
  IF TG_OP = 'UPDATE'
     AND OLD.kind::TEXT = 'inscripcion'
     AND OLD.status::TEXT = 'booked'
     AND OLD.booking_date IS NOT DISTINCT FROM NEW.booking_date
     AND lower(btrim(COALESCE(OLD.location_id, ''))) = 'monterrey' THEN
    RETURN NEW;
  END IF;

  v_cap := public.agenda_daily_capacity(
    NEW.organization_id,
    'inscripcion',
    NEW.booking_date,
    'monterrey'
  );

  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serializa carreras del último lugar: dos reservas simultáneas no pueden crear 5/4.
  PERFORM public.agenda_advisory_lock_daily_capacity(
    NEW.organization_id,
    'inscripcion',
    NEW.booking_date,
    'monterrey'
  );

  -- Fail-closed contra el inventario físico de Sheets.
  PERFORM public.agenda_sheet_assert_inventory_allows_booking(
    NEW.organization_id,
    'inscripcion',
    NEW.booking_date,
    TIME '11:00',
    'monterrey'
  );

  v_remaining := public.agenda_daily_remaining(
    NEW.organization_id,
    'inscripcion',
    NEW.booking_date,
    'monterrey'
  );

  IF COALESCE(v_remaining, 0) < 1 THEN
    RAISE EXCEPTION
      'CUPO_INSCRIPCION_AGOTADO: máximo 4 citas de inscripción por día'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.agenda_inscripcion_guard_daily_capacity() IS
  'Desde 2026-09-01: hard-cap recurrente de 4 inscripciones diarias en Monterrey; serializa último cupo y exige inventario Sheet disponible/fresco.';

REVOKE ALL ON FUNCTION public.agenda_inscripcion_guard_daily_capacity()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_inscripcion_guard_daily_capacity()
  TO postgres, service_role;

-- Blindaje: ni la regla recurrente ni un override futuro pueden abrir >4.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agenda_daily_capacity_rules_inscripcion_mty_max_4'
      AND conrelid = 'public.agenda_daily_capacity_rules'::regclass
  ) THEN
    ALTER TABLE public.agenda_daily_capacity_rules
      ADD CONSTRAINT agenda_daily_capacity_rules_inscripcion_mty_max_4
      CHECK (
        NOT (
          lower(btrim(kind)) = 'inscripcion'
          AND lower(btrim(location_id)) = 'monterrey'
        )
        OR capacity <= 4
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agenda_daily_capacity_overrides_inscripcion_mty_max_4'
      AND conrelid = 'public.agenda_daily_capacity_overrides'::regclass
  ) THEN
    ALTER TABLE public.agenda_daily_capacity_overrides
      ADD CONSTRAINT agenda_daily_capacity_overrides_inscripcion_mty_max_4
      CHECK (
        NOT (
          lower(btrim(kind)) = 'inscripcion'
          AND lower(btrim(location_id)) = 'monterrey'
          AND slot_date >= DATE '2026-09-01'
        )
        OR capacity <= 4
      );
  END IF;
END
$$;
