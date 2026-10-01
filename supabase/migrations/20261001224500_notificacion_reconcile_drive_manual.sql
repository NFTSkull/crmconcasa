-- ConCasa CRM — reconciliar Notificación CRM con cita ya capturada manualmente en Drive.
-- Caso: Drive ya ocupa una fila física de Inscripción 11:00 para el mismo NSS,
-- pero el CRM no tiene booking de Notificación activo.
-- Esa reconciliación NO agrega una persona al pool físico y por tanto no debe
-- disparar el hard-cap como si fuera una alta nueva.

CREATE OR REPLACE FUNCTION public.agenda_guard_mty_shared_pool_biu()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_new_shared BOOLEAN := false;
  v_old_shared BOOLEAN := false;
  v_occupancy INTEGER := 0;
  v_exp_nss TEXT;
  v_existing_drive_row BOOLEAN := false;
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

  -- Reconciliación estricta: Notificación en Monterrey que ya existe físicamente
  -- como fila externa de Inscripción 11:00 para el MISMO NSS y MISMO día.
  -- No suma una persona al Drive; solo convierte esa ocupación externa en booking CRM.
  IF NEW.kind = 'notificacion'::public.booking_kind
     AND NEW.expediente_id IS NOT NULL
     AND lower(btrim(COALESCE(NEW.location_id, ''))) = 'monterrey' THEN
    SELECT NULLIF(public.agenda_sheet_normalize_nss(e.nss::TEXT), '')
    INTO v_exp_nss
    FROM public.expedientes e
    WHERE e.id = NEW.expediente_id;

    IF v_exp_nss IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.agenda_sheet_slot_inventory i
        WHERE i.organization_id = NEW.organization_id
          AND i.booking_date = NEW.booking_date
          AND i.kind = 'inscripcion'
          AND i.location_id = 'monterrey'
          AND i.status = 'occupied_external'
          AND NULLIF(public.agenda_sheet_normalize_nss(i.visible_nss), '') = v_exp_nss
          AND (
            i.sheet_slot_time = TIME '11:00'
            OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
          )
      )
      INTO v_existing_drive_row;

      IF v_existing_drive_row THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

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

COMMENT ON FUNCTION public.agenda_guard_mty_shared_pool_biu() IS
  'Hard-cap 15 del pool Monterrey. Permite únicamente reconciliar una Notificación CRM cuando ya existe en Drive una fila física externa de Inscripción 11:00 para el mismo NSS/día.';

CREATE OR REPLACE FUNCTION public.agenda_notificacion_claim_inscripcion_ai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv_id UUID;
  v_location TEXT;
  v_exp_nss TEXT;
BEGIN
  IF NEW.kind::TEXT <> 'notificacion' OR NEW.status::TEXT <> 'booked' THEN
    RETURN NEW;
  END IF;

  v_location := lower(btrim(COALESCE(NEW.location_id, '')));

  IF v_location <> 'monterrey' THEN
    RETURN NEW;
  END IF;

  IF NOT public.agenda_sheet_inventory_enforced(NEW.booking_date) THEN
    RETURN NEW;
  END IF;

  IF NOT public.agenda_sheet_inventory_applies(v_location) THEN
    RETURN NEW;
  END IF;

  SELECT NULLIF(public.agenda_sheet_normalize_nss(e.nss::TEXT), '')
  INTO v_exp_nss
  FROM public.expedientes e
  WHERE e.id = NEW.expediente_id;

  -- Primero intenta reconciliar la fila manual ya ocupada por el mismo NSS.
  IF v_exp_nss IS NOT NULL THEN
    SELECT i.id
    INTO v_inv_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = NEW.organization_id
      AND i.booking_date = NEW.booking_date
      AND i.kind = 'inscripcion'
      AND i.location_id = v_location
      AND i.status = 'occupied_external'
      AND NULLIF(public.agenda_sheet_normalize_nss(i.visible_nss), '') = v_exp_nss
      AND (
        i.sheet_slot_time = TIME '11:00'
        OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
      )
    ORDER BY i.sheet_row
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
  END IF;

  -- Si no existe captura manual coincidente, conserva el flujo normal:
  -- reclama la siguiente fila realmente disponible.
  IF v_inv_id IS NULL THEN
    SELECT i.id
    INTO v_inv_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = NEW.organization_id
      AND i.booking_date = NEW.booking_date
      AND i.kind = 'inscripcion'
      AND i.location_id = v_location
      AND i.status = 'available'
      AND (
        i.sheet_slot_time = TIME '11:00'
        OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
      )
    ORDER BY i.sheet_row
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
  END IF;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'claimed',
    booking_id = NEW.id,
    expediente_id = NEW.expediente_id,
    claimed_at = NOW(),
    linked_at = NULL,
    occupancy_source = 'crm',
    manual_occupancy_fingerprint = NULL,
    last_error = NULL,
    updated_at = NOW()
  WHERE i.id = v_inv_id;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.agenda_notificacion_claim_inscripcion_ai() IS
  'Notificación Monterrey reclama primero la fila externa de Inscripción 11:00 del mismo NSS si ya existe en Drive; si no, usa una fila available.';
