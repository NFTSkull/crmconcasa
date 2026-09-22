-- ConCasa CRM — Biométricos: cambio de horario efectivo 2026-09-23.
-- Alcance:
--   Drive/CRM 08:30 -> 08:00
--   Drive/CRM 10:00 -> 09:00
-- No agrega filas/cupos, no mueve de fecha/sede, no toca Firmas/Inscripción.
-- Los bookings activos existentes permanecen con el mismo id/expediente/fila; solo cambia la hora.

-- 1) Config CRM: mismos cupos, nueva llave horaria.
UPDATE public.agenda_config ac
SET config = jsonb_set(
  jsonb_set(
    ac.config,
    '{slots}',
    '["08:00","09:00"]'::jsonb,
    true
  ),
  '{locations}',
  COALESCE(
    (
      SELECT jsonb_object_agg(
        e.key,
        CASE
          WHEN jsonb_typeof(e.value->'capacity_by_time') = 'object'
               AND (e.value->'capacity_by_time') ? '10:00'
          THEN jsonb_set(
            e.value,
            '{capacity_by_time}',
            ((e.value->'capacity_by_time') - '10:00')
              || jsonb_build_object(
                '09:00',
                e.value->'capacity_by_time'->'10:00'
              ),
            true
          )
          ELSE e.value
        END
      )
      FROM jsonb_each(COALESCE(ac.config->'locations', '{}'::jsonb)) e
    ),
    '{}'::jsonb
  ),
  true
)
WHERE ac.kind = 'biometricos';

-- 2) Alias por fecha: conservar historia hasta 22/09 y usar identidad 08/09 desde 23/09.
UPDATE public.agenda_sheet_time_aliases a
SET effective_to = DATE '2026-09-22'
WHERE a.kind = 'biometricos'
  AND a.organization_id IN (
    SELECT organization_id
    FROM public.agenda_config
    WHERE kind = 'biometricos'
  )
  AND (a.effective_from IS NULL OR a.effective_from <= DATE '2026-09-22')
  AND (a.effective_to IS NULL OR a.effective_to > DATE '2026-09-22');

INSERT INTO public.agenda_sheet_time_aliases (
  organization_id,
  location_id,
  kind,
  logical_start_time,
  sheet_start_time,
  active,
  effective_from,
  effective_to
)
SELECT
  ac.organization_id,
  v.location_id,
  'biometricos',
  v.logical_time,
  v.sheet_time,
  TRUE,
  DATE '2026-09-23',
  NULL
FROM public.agenda_config ac
CROSS JOIN (
  VALUES
    ('monterrey'::text, TIME '08:00', TIME '08:00'),
    ('monterrey'::text, TIME '09:00', TIME '09:00'),
    ('apodaca'::text,   TIME '08:00', TIME '08:00'),
    ('apodaca'::text,   TIME '09:00', TIME '09:00')
) AS v(location_id, logical_time, sheet_time)
WHERE ac.kind = 'biometricos'
ON CONFLICT (
  organization_id,
  location_id,
  kind,
  logical_start_time,
  sheet_start_time
)
DO UPDATE SET
  active = TRUE,
  effective_from = DATE '2026-09-23',
  effective_to = NULL,
  updated_at = NOW();

-- 3) Citas activas existentes: cambio in-place 10:00 -> 09:00.
-- Se deshabilitan únicamente los guards que convertirían este cambio administrativo
-- en una reagenda/outbox. ALTER TABLE mantiene lock durante la migración.
ALTER TABLE public.agenda_bookings
  DISABLE TRIGGER a_agenda_booking_biometricos_no_inplace_move_bu;
ALTER TABLE public.agenda_bookings
  DISABLE TRIGGER agenda_sheet_outbox_aiud;
ALTER TABLE public.agenda_bookings
  DISABLE TRIGGER agenda_bookings_set_updated_at;

UPDATE public.agenda_bookings
SET booking_time = TIME '09:00'
WHERE kind = 'biometricos'
  AND status = 'booked'
  AND booking_date >= DATE '2026-09-23'
  AND booking_time = TIME '10:00';

ALTER TABLE public.agenda_bookings
  ENABLE TRIGGER agenda_bookings_set_updated_at;
ALTER TABLE public.agenda_bookings
  ENABLE TRIGGER agenda_sheet_outbox_aiud;
ALTER TABLE public.agenda_bookings
  ENABLE TRIGGER a_agenda_booking_biometricos_no_inplace_move_bu;

-- 4) Read-model físico/lógico ya existente: mismas filas, nueva hora.
UPDATE public.agenda_sheet_slot_inventory
SET
  slot_time = CASE
    WHEN slot_time = TIME '10:00' THEN TIME '09:00'
    ELSE slot_time
  END,
  sheet_slot_time = CASE
    WHEN sheet_slot_time = TIME '08:30' THEN TIME '08:00'
    WHEN sheet_slot_time = TIME '10:00' THEN TIME '09:00'
    ELSE sheet_slot_time
  END,
  slot_key = replace(
    replace(
      replace(slot_key, '|10:00|', '|09:00|'),
      'sheet=10:00',
      'sheet=09:00'
    ),
    'sheet=08:30',
    'sheet=08:00'
  ),
  updated_at = NOW()
WHERE kind = 'biometricos'
  AND booking_date >= DATE '2026-09-23'
  AND (
    slot_time = TIME '10:00'
    OR sheet_slot_time IN (TIME '08:30', TIME '10:00')
  );

UPDATE public.agenda_sheet_slot_links
SET
  slot_time = TIME '09:00',
  updated_at = NOW()
WHERE kind = 'biometricos'
  AND sheet_date >= DATE '2026-09-23'
  AND deleted_at IS NULL
  AND slot_time = TIME '10:00';

-- Proyecciones de la hoja: solo hora, sin tocar resultado/estado/notas.
UPDATE public.agenda_sheet_operational_results
SET slot_time = CASE
  WHEN slot_time = TIME '08:30' THEN TIME '08:00'
  WHEN slot_time = TIME '10:00' THEN TIME '09:00'
  ELSE slot_time
END
WHERE kind = 'biometricos'
  AND booking_date >= DATE '2026-09-23'
  AND slot_time IN (TIME '08:30', TIME '10:00');

UPDATE public.agenda_operational_results_native
SET booking_time = CASE
  WHEN booking_time = TIME '08:30' THEN TIME '08:00'
  WHEN booking_time = TIME '10:00' THEN TIME '09:00'
  ELSE booking_time
END
WHERE kind = 'biometricos'
  AND booking_date >= DATE '2026-09-23'
  AND booking_time IN (TIME '08:30', TIME '10:00');

-- Overrides puntuales, si existieran: conservar cantidad/semántica y mover solo la hora.
UPDATE public.agenda_slot_capacities
SET slot_time = TIME '09:00'
WHERE kind = 'biometricos'
  AND slot_date >= DATE '2026-09-23'
  AND slot_time = TIME '10:00';

UPDATE public.agenda_manual_occupancies
SET booking_time = CASE
  WHEN booking_time = TIME '08:30' THEN TIME '08:00'
  WHEN booking_time = TIME '10:00' THEN TIME '09:00'
  ELSE booking_time
END
WHERE kind = 'biometricos'
  AND booking_date >= DATE '2026-09-23'
  AND booking_time IN (TIME '08:30', TIME '10:00');
