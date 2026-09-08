-- Agenda CRM-only — dedupe capacidad del snapshot manual.
-- Conserva TODAS las filas históricas; solo una por persona/fingerprint consume cupo.
-- Si la fila ya reconcilia con agenda_bookings, ninguna copia manual consume cupo.

WITH ranked AS (
  SELECT
    m.id,
    m.reconciled_booking_id,
    row_number() OVER (
      PARTITION BY
        m.organization_id,
        m.booking_date,
        m.kind,
        m.location_id,
        COALESCE(
          NULLIF(btrim(i.manual_occupancy_fingerprint), ''),
          NULLIF(regexp_replace(COALESCE(m.nss, ''), '\\D', '', 'g'), ''),
          'row:' || m.source_inventory_id::text
        )
      ORDER BY m.source_sheet_row NULLS LAST, m.id
    ) AS rn,
    bool_or(m.reconciled_booking_id IS NOT NULL) OVER (
      PARTITION BY
        m.organization_id,
        m.booking_date,
        m.kind,
        m.location_id,
        COALESCE(
          NULLIF(btrim(i.manual_occupancy_fingerprint), ''),
          NULLIF(regexp_replace(COALESCE(m.nss, ''), '\\D', '', 'g'), ''),
          'row:' || m.source_inventory_id::text
        )
    ) AS group_has_booking
  FROM public.agenda_manual_occupancies m
  LEFT JOIN public.agenda_sheet_slot_inventory i
    ON i.id = m.source_inventory_id
  WHERE m.source = 'legacy_sheet_snapshot'
    AND m.booking_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'
)
UPDATE public.agenda_manual_occupancies m
SET counts_toward_capacity = (
  r.group_has_booking IS NOT TRUE
  AND r.reconciled_booking_id IS NULL
  AND r.rn = 1
)
FROM ranked r
WHERE r.id = m.id
  AND m.counts_toward_capacity IS DISTINCT FROM (
    r.group_has_booking IS NOT TRUE
    AND r.reconciled_booking_id IS NULL
    AND r.rn = 1
  );
