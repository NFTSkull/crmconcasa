-- Tests aislados: sync firmas slots desde inventario (hotfix 09:30 / P158).
-- Capacidad al abrir = filas físicas (MAX), NUNCA available. Open-only. Idempotente.

BEGIN;
SELECT plan(14);

CREATE TEMP TABLE _org AS
SELECT gen_random_uuid() AS id;

CREATE TEMP TABLE _bio_cfg AS
SELECT
  gen_random_uuid() AS id,
  (SELECT id FROM _org) AS organization_id,
  jsonb_build_object(
    'slots', jsonb_build_array('08:00', '09:00'),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object(
        'enabled', true,
        'capacity_by_time', jsonb_build_object('08:00', 7, '09:00', 7)
      )
    )
  ) AS config;

INSERT INTO public.agenda_config (organization_id, kind, config)
SELECT
  id,
  'firmas',
  jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Mexico_City',
    'min_lead_hours', 3,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5),
    'slots', jsonb_build_array('08:30', '09:00', '10:00'),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 5,
        'capacity_by_time', jsonb_build_object(
          '08:30', 3,
          '09:00', 3,
          '10:00', 0
        )
      ),
      'apodaca', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 5,
        'capacity_by_time', jsonb_build_object('10:00', 5)
      )
    )
  )
FROM _org;

INSERT INTO public.agenda_config (organization_id, kind, config)
SELECT organization_id, 'biometricos', config FROM _bio_cfg;

INSERT INTO public.agenda_sheet_slot_inventory (
  organization_id, spreadsheet_id, sheet_id, sheet_title, sheet_row,
  booking_date, kind, location_id, slot_time, sheet_slot_time, slot_key, status,
  occupancy_source, observed_at
)
SELECT
  o.id,
  '1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA',
  195044516,
  '07 AGOSTO',
  g.sheet_row,
  DATE '2026-08-07',
  'firmas',
  'monterrey',
  g.t::time,
  g.t::time,
  format('firmas|2026-08-07|%s|monterrey|sheet=%s|sheetId=195044516|row=%s', g.t, g.t, g.sheet_row),
  g.st,
  'sheet',
  NOW()
FROM _org o
CROSS JOIN (
  VALUES
    (9,  '08:30', 'linked'),
    (10, '08:30', 'linked'),
    (11, '08:30', 'linked'),
    (12, '09:00', 'linked'),
    (13, '09:00', 'linked'),
    (14, '09:00', 'occupied_external'),
    (15, '09:30', 'available'),
    (16, '09:30', 'available'),
    (17, '09:30', 'available'),
    (18, '10:00', 'available'),
    (19, '10:00', 'available'),
    (20, '10:00', 'available')
) AS g(sheet_row, t, st);

CREATE TEMP TABLE _booking_count AS
SELECT COUNT(*)::bigint AS n FROM public.agenda_bookings;

SELECT is(
  (public.agenda_firmas_sync_slots_from_sheet_inventory((SELECT id FROM _org))->>'orgs_touched')::int,
  1,
  'sync toca 1 org'
);

SELECT ok(
  (
    SELECT c.config->'slots'
    FROM public.agenda_config c, _org o
    WHERE c.organization_id = o.id AND c.kind = 'firmas'
  ) = '["08:30","09:00","09:30","10:00"]'::jsonb,
  'slots ordenados con 09:30'
);

-- Caso obligatorio: physical=3 available=0 existing=3 → capacity=3 (nunca 0)
SELECT is(
  (
    SELECT (c.config->'locations'->'monterrey'->'capacity_by_time'->>'08:30')::int
    FROM public.agenda_config c, _org o
    WHERE c.organization_id = o.id AND c.kind = 'firmas'
  ),
  3,
  '08:30 ocupado conserva capacidad física 3'
);

SELECT is(
  (
    SELECT (c.config->'locations'->'monterrey'->'capacity_by_time'->>'09:00')::int
    FROM public.agenda_config c, _org o
    WHERE c.organization_id = o.id AND c.kind = 'firmas'
  ),
  3,
  '09:00 ocupado conserva capacidad física 3'
);

SELECT is(
  (
    SELECT (c.config->'locations'->'monterrey'->'capacity_by_time'->>'09:30')::int
    FROM public.agenda_config c, _org o
    WHERE c.organization_id = o.id AND c.kind = 'firmas'
  ),
  3,
  '09:30 vacío → capacidad 3'
);

SELECT is(
  (
    SELECT (c.config->'locations'->'monterrey'->'capacity_by_time'->>'10:00')::int
    FROM public.agenda_config c, _org o
    WHERE c.organization_id = o.id AND c.kind = 'firmas'
  ),
  3,
  '10:00 config 0 sube a capacidad física 3'
);

SELECT is(
  (
    SELECT (c.config->'locations'->'apodaca'->'capacity_by_time'->>'10:00')::int
    FROM public.agenda_config c, _org o
    WHERE c.organization_id = o.id AND c.kind = 'firmas'
  ),
  5,
  'Apodaca capacity 10:00 intacta (sin inventario apodaca en fixture)'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.agenda_config c, _org o, jsonb_object_keys(c.config->'locations'->'apodaca'->'capacity_by_time') k
    WHERE c.organization_id = o.id AND c.kind = 'firmas' AND k = '09:30'
  ),
  'Apodaca no recibe 09:30 sin inventario propio'
);

SELECT ok(
  (
    SELECT c.config
    FROM public.agenda_config c, _org o
    WHERE c.organization_id = o.id AND c.kind = 'biometricos'
  ) = (SELECT config FROM _bio_cfg),
  'no modifica biométricos'
);

SELECT is(
  (
    SELECT COUNT(*)::int
    FROM public.agenda_sheet_slot_inventory i, _org o
    WHERE i.organization_id = o.id AND i.booking_date = DATE '2026-08-07'
  ),
  12,
  'inventario intacto (12 filas físicas)'
);

SELECT is(
  (
    SELECT COUNT(DISTINCT slot_key)::int
    FROM public.agenda_sheet_slot_inventory i, _org o
    WHERE i.organization_id = o.id
      AND i.booking_date = DATE '2026-08-07'
      AND to_char(i.slot_time, 'HH24:MI') = '09:30'
  ),
  3,
  '09:30 conserva 3 slot_key distintos'
);

SELECT is(
  (SELECT COUNT(*)::bigint FROM public.agenda_bookings),
  (SELECT n FROM _booking_count),
  'no modifica agenda_bookings'
);

SELECT is(
  (public.agenda_firmas_sync_slots_from_sheet_inventory((SELECT id FROM _org))->>'orgs_touched')::int,
  0,
  'segunda corrida sin cambios'
);

-- Aditivo open-only: existente 5 > 0 → no reduce aunque físico=3
UPDATE public.agenda_config c
SET config = jsonb_set(
  config,
  '{locations,monterrey,capacity_by_time,08:30}',
  '5'::jsonb,
  true
)
FROM _org o
WHERE c.organization_id = o.id AND c.kind = 'firmas';

SELECT is(
  (
    SELECT (c.config->'locations'->'monterrey'->'capacity_by_time'->>'08:30')::int
    FROM public.agenda_config c, _org o
    WHERE c.organization_id = o.id AND c.kind = 'firmas'
  ),
  5,
  'precondicion capacity 5'
);

SELECT is(
  (public.agenda_firmas_sync_slots_from_sheet_inventory((SELECT id FROM _org))->>'orgs_touched')::int,
  0,
  'existente >0 no se toca (idempotente)'
);

SELECT * FROM finish();
ROLLBACK;
