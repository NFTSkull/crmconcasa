-- Agenda CRM-only — reconciliación de filas manuales stale contra booking CRM del mismo día.
-- La hoja puede conservar una fila vieja en otro horario después de una reagenda.
-- Si NSS+fecha+kind+sede encuentran exactamente UN booking activo, la fila histórica
-- se conserva pero deja de ser ocupación manual y apunta al booking canónico.

WITH candidates AS (
  SELECT
    m.id,
    x.booking_id,
    x.expediente_id
  FROM public.agenda_manual_occupancies m
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN count(*) = 1 THEN (array_agg(b.id ORDER BY b.id))[1] END AS booking_id,
      CASE WHEN count(*) = 1 THEN (array_agg(b.expediente_id ORDER BY b.id))[1] END AS expediente_id
    FROM public.agenda_bookings b
    JOIN public.expedientes e ON e.id = b.expediente_id
    WHERE b.organization_id = m.organization_id
      AND b.booking_date = m.booking_date
      AND b.kind = m.kind
      AND lower(btrim(b.location_id)) = lower(btrim(m.location_id))
      AND b.status = 'booked'
      AND regexp_replace(COALESCE(e.nss, ''), '\\D', '', 'g') =
          regexp_replace(COALESCE(m.nss, ''), '\\D', '', 'g')
      AND regexp_replace(COALESCE(m.nss, ''), '\\D', '', 'g') <> ''
  ) x ON true
  WHERE m.source = 'legacy_sheet_snapshot'
    AND m.booking_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'
    AND x.booking_id IS NOT NULL
)
UPDATE public.agenda_manual_occupancies m
SET
  reconciled_booking_id = c.booking_id,
  expediente_id = COALESCE(m.expediente_id, c.expediente_id),
  counts_toward_capacity = false
FROM candidates c
WHERE c.id = m.id
  AND (
    m.reconciled_booking_id IS DISTINCT FROM c.booking_id
    OR m.counts_toward_capacity IS DISTINCT FROM false
  );

-- Reenlazar resultado histórico al booking canónico cuando proceda.
UPDATE public.agenda_operational_results_native r
SET
  booking_id = m.reconciled_booking_id,
  manual_occupancy_id = NULL,
  expediente_id = COALESCE(r.expediente_id, m.expediente_id)
FROM public.agenda_manual_occupancies m
WHERE r.manual_occupancy_id = m.id
  AND m.reconciled_booking_id IS NOT NULL;
