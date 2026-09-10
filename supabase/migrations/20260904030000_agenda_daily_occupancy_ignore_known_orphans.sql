-- ConCasa CRM — P221: capacidad diaria no cuenta como orphan una fila cuyo
-- booking_id sí existe en agenda_bookings (p.ej. booking cancelado de un reagendo).
--
-- Contexto: 8 SEP tenía 15 personas físicas/activas, pero agenda_daily_active_occupancy
-- devolvía 16 porque una fila Sheet seguía linked al booking cancelado anterior de
-- Leonardo. El booking nuevo activo ya era contado por `crm`, por lo que el histórico
-- viejo se sumaba por segunda vez en `orphan_claims`.
--
-- Seguridad:
-- - no modifica agenda_bookings, inventario ni Google Sheets;
-- - no relaja el gate físico por fila (agenda_sheet_assert_inventory_allows_booking);
-- - claimed sin booking_id y UUIDs realmente inexistentes siguen contando fail-closed.

CREATE OR REPLACE FUNCTION public.agenda_daily_active_occupancy(
  p_org uuid,
  p_kind text,
  p_date date,
  p_location text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH crm AS (
    SELECT b.id, regexp_replace(COALESCE(e.nss, ''), '\D', '', 'g') AS nss_norm
    FROM public.agenda_bookings b
    LEFT JOIN public.expedientes e ON e.id = b.expediente_id
    WHERE b.organization_id = p_org
      AND b.kind::text = lower(btrim(COALESCE(p_kind, '')))
      AND b.booking_date = p_date
      AND b.location_id = lower(btrim(COALESCE(p_location, '')))
      AND b.status = 'booked'
  ),
  scope_snapshot AS (
    SELECT max(i.sheet_last_seen_at) AS max_seen
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = p_org
      AND i.kind = lower(btrim(COALESCE(p_kind, '')))
      AND i.booking_date = p_date
      AND i.location_id = lower(btrim(COALESCE(p_location, '')))
  ),
  external_raw AS (
    SELECT i.id, i.booking_id,
      lower(COALESCE(i.occupancy_source, '')) AS occupancy_source,
      regexp_replace(COALESCE(i.visible_nss, ''), '\D', '', 'g') AS nss_norm,
      COALESCE(
        NULLIF(btrim(COALESCE(i.manual_occupancy_fingerprint, '')), ''),
        NULLIF(regexp_replace(COALESCE(i.visible_nss, ''), '\D', '', 'g'), ''),
        'row:' || i.id::text
      ) AS dedupe_key,
      i.sheet_last_seen_at
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = p_org
      AND i.kind = lower(btrim(COALESCE(p_kind, '')))
      AND i.booking_date = p_date
      AND i.location_id = lower(btrim(COALESCE(p_location, '')))
      AND i.status IN ('occupied_external', 'conflict')
  ),
  external_filtered AS (
    SELECT x.*
    FROM external_raw x
    CROSS JOIN scope_snapshot s
    WHERE (x.booking_id IS NULL OR NOT EXISTS (SELECT 1 FROM crm c WHERE c.id = x.booking_id))
      AND NOT (x.nss_norm <> '' AND EXISTS (SELECT 1 FROM crm c WHERE c.nss_norm <> '' AND c.nss_norm = x.nss_norm))
      AND (
        x.occupancy_source <> 'reconciliation'
        OR s.max_seen IS NULL
        OR x.sheet_last_seen_at IS NULL
        OR x.sheet_last_seen_at >= s.max_seen - interval '5 seconds'
      )
  ),
  external_dedup AS (
    SELECT DISTINCT ON (x.dedupe_key) x.dedupe_key
    FROM external_filtered x
    ORDER BY x.dedupe_key,
      CASE x.occupancy_source WHEN 'sheet_webhook' THEN 0 WHEN 'sheet_legacy' THEN 1 ELSE 2 END,
      x.sheet_last_seen_at DESC NULLS LAST,
      x.id
  ),
  orphan_claims AS (
    SELECT count(*)::INTEGER AS n
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = p_org
      AND i.kind = lower(btrim(COALESCE(p_kind, '')))
      AND i.booking_date = p_date
      AND i.location_id = lower(btrim(COALESCE(p_location, '')))
      AND i.status IN ('claimed', 'linked')
      -- Booking conocido NO es orphan. Si está activo ya lo cuenta `crm`;
      -- si está cancelado/histórico, no debe sumar una persona adicional.
      AND (
        i.booking_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.agenda_bookings b_any
          WHERE b_any.id = i.booking_id
        )
      )
  )
  SELECT ((SELECT count(*)::INTEGER FROM crm)
    + (SELECT count(*)::INTEGER FROM external_dedup)
    + COALESCE((SELECT n FROM orphan_claims), 0))::INTEGER;
$function$;

COMMENT ON FUNCTION public.agenda_daily_active_occupancy(uuid, text, date, text) IS
  'P221: booked CRM + externos deduplicados + claims realmente huérfanos. Booking IDs conocidos no se duplican como orphan; gate físico por fila permanece independiente.';
