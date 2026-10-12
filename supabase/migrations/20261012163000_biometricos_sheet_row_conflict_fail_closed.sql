
-- Bloqueo fail-closed para biométricos en fecha/sede con sheet_row_conflict.
-- La reserva no se considera liberada por fallar la sincronización: permanece ocupando cupo.
CREATE OR REPLACE FUNCTION public.agenda_biometricos_sync_conflict_active(
  p_org uuid, p_date date, p_location text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    JOIN public.agenda_sheet_sync_outbox o ON o.booking_id = b.id
    WHERE b.organization_id = p_org
      AND b.kind::text = 'biometricos'
      AND b.status::text = 'booked'
      AND b.booking_date = p_date
      AND lower(btrim(COALESCE(b.location_id, ''))) = lower(btrim(COALESCE(p_location, '')))
      AND o.event_type = 'booking_created'
      AND o.status IN ('dead', 'failed', 'pending')
      AND lower(COALESCE(o.last_error, '')) LIKE 'sheet_row_conflict%'
  );
$fn$;

-- Segunda defensa en servidor (adicional al límite diario existente).
-- Se ejecuta para INSERT y para cambios que incorporan cupo nuevo.
CREATE OR REPLACE FUNCTION public.agenda_biometricos_sync_conflict_guard_biu()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_loc text;
  v_cap integer;
  v_logical integer;
  v_physical integer;
  v_unlinked integer;
  v_manual integer;
  v_strict integer;
BEGIN
  IF NEW.kind::text IS DISTINCT FROM 'biometricos'
     OR NEW.status::text IS DISTINCT FROM 'booked' THEN
    RETURN NEW;
  END IF;

  v_loc := lower(btrim(COALESCE(NEW.location_id,'')));
  IF v_loc NOT IN ('monterrey','apodaca') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.kind::text = 'biometricos'
       AND OLD.status::text = 'booked'
       AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
       AND OLD.booking_date IS NOT DISTINCT FROM NEW.booking_date
       AND lower(btrim(COALESCE(OLD.location_id,''))) = v_loc THEN
      RETURN NEW;
    END IF;
  END IF;

  v_cap := public.agenda_daily_capacity(
    NEW.organization_id,'biometricos',NEW.booking_date,v_loc
  );
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  -- Mismo candado transaccional que los triggers y RPC existentes.
  PERFORM public.agenda_advisory_lock_daily_capacity(
    NEW.organization_id,'biometricos',NEW.booking_date,v_loc
  );

  -- Cualquier cita activa con error de escritura sin resolver congela el día/sede.
  IF public.agenda_biometricos_sync_conflict_active(
    NEW.organization_id,NEW.booking_date,v_loc
  ) THEN
    RAISE EXCEPTION
      'SINCRONIZACION_BIOMETRICOS_BLOQUEADA: sheet_row_conflict pendiente en % para %. Resolver CRM/Drive antes de agendar.',
      NEW.booking_date, v_loc
      USING ERRCODE = '22023';
  END IF;

  -- Ninguna reserva nueva basada en inventario del Drive desactualizado.
  IF public.agenda_sheet_inventory_enforced(NEW.booking_date)
     AND NOT public.agenda_sheet_inventory_scope_fresh(
       NEW.organization_id,'biometricos',NEW.booking_date,v_loc
     ) THEN
    RAISE EXCEPTION
      'SIN_CUPO_REAL_EN_SHEET: inventario de biométricos desactualizado; agendamiento bloqueado.'
      USING ERRCODE = '22023';
  END IF;

  v_manual := public.agenda_crm_manual_daily_count(
    NEW.organization_id,'biometricos',NEW.booking_date,v_loc
  );
  v_logical := public.agenda_daily_active_occupancy(
    NEW.organization_id,'biometricos',NEW.booking_date,v_loc
  ) + v_manual;

  -- Contar también filas físicas ocupadas, incluso cuando aún no existe enlace CRM.
  SELECT count(*)::integer INTO v_physical
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = NEW.organization_id
    AND i.booking_date = NEW.booking_date
    AND i.kind = 'biometricos'
    AND i.location_id = v_loc
    AND i.status IN ('linked','claimed','occupied_external','conflict');

  -- Bookings activos sin fila física consumen cupo y NO desaparecen al fallar Drive.
  SELECT count(*)::integer INTO v_unlinked
  FROM public.agenda_bookings b
  WHERE b.organization_id = NEW.organization_id
    AND b.kind::text = 'biometricos'
    AND b.booking_date = NEW.booking_date
    AND b.status::text = 'booked'
    AND lower(btrim(COALESCE(b.location_id,''))) = v_loc
    AND NOT EXISTS (
      SELECT 1 FROM public.agenda_sheet_slot_inventory i
      WHERE i.booking_id = b.id AND i.status IN ('linked','claimed')
    );

  v_strict := GREATEST(v_logical, v_physical + v_unlinked + v_manual);
  IF v_strict >= v_cap THEN
    RAISE EXCEPTION
      'SIN_CUPO_DIA: biométricos % tiene % de % lugares ocupados (incluye Drive, conflictos y reservas no sincronizadas).',
      v_loc,v_strict,v_cap
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS a00_agenda_biometricos_sync_conflict_guard_biu
  ON public.agenda_bookings;
CREATE TRIGGER a00_agenda_biometricos_sync_conflict_guard_biu
BEFORE INSERT OR UPDATE OF organization_id,kind,status,booking_date,booking_time,location_id
ON public.agenda_bookings
FOR EACH ROW EXECUTE FUNCTION public.agenda_biometricos_sync_conflict_guard_biu();

-- El calendario nunca debe anunciar un hueco en una fecha/sede congelada.
-- Un éxito posterior de otro expediente no borra la alerta: requiere resolver los outbox.
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_available_count(
  p_org uuid,p_kind text,p_date date,p_time time without time zone,p_location text
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  WITH normalized AS (
    SELECT lower(btrim(COALESCE(p_kind,''))) AS kind,
           lower(btrim(COALESCE(p_location,''))) AS location
  ), latest_scope AS (
    SELECT max(i.observed_at) AS latest
    FROM public.agenda_sheet_slot_inventory i CROSS JOIN normalized n
    WHERE i.organization_id = p_org
      AND i.kind = n.kind AND i.booking_date = p_date
      AND i.location_id = n.location
  ), sheet_available AS (
    SELECT count(*)::integer AS n
    FROM public.agenda_sheet_slot_inventory i
    CROSS JOIN normalized n CROSS JOIN latest_scope s
    WHERE i.organization_id = p_org AND i.kind = n.kind
      AND i.booking_date = p_date AND i.slot_time = p_time
      AND i.location_id = n.location AND i.status = 'available'
      AND s.latest IS NOT NULL
      AND i.observed_at >= s.latest - interval '5 minutes'
  )
  SELECT CASE
    WHEN lower(btrim(COALESCE(p_kind,''))) = 'biometricos'
      AND public.agenda_biometricos_sync_conflict_active(p_org,p_date,p_location)
    THEN 0
    ELSE greatest(
      coalesce((SELECT n FROM sheet_available),0)
      - public.agenda_crm_manual_slot_count(p_org,p_kind,p_date,p_time,p_location),
      0
    )
  END::integer;
$fn$;
