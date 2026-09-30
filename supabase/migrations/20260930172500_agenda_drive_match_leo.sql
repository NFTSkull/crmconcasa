-- ConCasa CRM — hoja operativa alineada con CITAS 2026:
-- 1) conserva identidad A:D en la proyección operativa;
-- 2) identifica el bloque LEO/HACER PAGARES sin convertirlo en cupo de agenda;
-- 3) lo expone en la vista CRM como sección independiente editable;
-- 4) mantiene LEO fuera de agenda_bookings/inventario/capacidad.

ALTER TABLE public.agenda_sheet_operational_results
  ADD COLUMN IF NOT EXISTS visible_nss TEXT,
  ADD COLUMN IF NOT EXISTS visible_name TEXT,
  ADD COLUMN IF NOT EXISTS visible_advisor TEXT,
  ADD COLUMN IF NOT EXISTS source_block TEXT;

COMMENT ON COLUMN public.agenda_sheet_operational_results.source_block
IS 'Bloque visual auxiliar del Sheet. leo = LEO/HACER PAGARES; no cuenta como agenda/cupo.';

CREATE OR REPLACE FUNCTION public.agenda_sheet_ops_upsert_batch_raw_p250(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_elem JSONB;
  v_count INTEGER := 0;
  v_class_ok TEXT[] := ARRAY[
    'COMPLETED', 'FAILED_OR_NOT_ATTENDED', 'PENDING', 'UNKNOWN'
  ];
  v_color_ok TEXT[] := ARRAY[
    'GREEN', 'RED', 'ORANGE', 'OTHER', 'UNKNOWN'
  ];
  v_eff_ok TEXT[] := ARRAY[
    'COMPLETED_CURRENT', 'COMPLETED_HISTORICAL', 'FAILED',
    'REBOOK_REQUIRED', 'PENDING', 'MANUAL_REVIEW'
  ];
  v_proj_ok TEXT[] := ARRAY[
    'CURRENT', 'STALE', 'IDENTITY_CONFLICT', 'UNLINKED'
  ];
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'agenda_sheet_ops_upsert_batch: p_rows debe ser array JSON'
      USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN
    SELECT e.elem
    FROM jsonb_array_elements(p_rows) AS e(elem)
  LOOP
    IF NULLIF(btrim(COALESCE(v_elem->>'spreadsheet_id', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'sheet_id', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'sheet_row', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'booking_date', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'kind', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'location_id', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'organization_id', '')), '') IS NULL
    THEN
      CONTINUE;
    END IF;

    IF lower(btrim(v_elem->>'kind')) NOT IN ('biometricos', 'firmas') THEN
      CONTINUE;
    END IF;
    IF lower(btrim(v_elem->>'location_id')) NOT IN ('monterrey', 'apodaca') THEN
      CONTINUE;
    END IF;

    IF NOT (
      COALESCE(v_elem->>'biometric_result_class', 'PENDING') = ANY (v_class_ok)
      AND COALESCE(v_elem->>'notification_result_class', 'PENDING') = ANY (v_class_ok)
      AND COALESCE(v_elem->>'signature_result_class', 'PENDING') = ANY (v_class_ok)
    ) THEN
      CONTINUE;
    END IF;

    IF NOT (
      COALESCE(v_elem->>'biometric_color', 'UNKNOWN') = ANY (v_color_ok)
      AND COALESCE(v_elem->>'notification_color', 'UNKNOWN') = ANY (v_color_ok)
      AND COALESCE(v_elem->>'signature_color', 'UNKNOWN') = ANY (v_color_ok)
    ) THEN
      CONTINUE;
    END IF;

    IF NOT (
      COALESCE(v_elem->>'biometric_effective_result', 'PENDING') = ANY (v_eff_ok)
      AND COALESCE(v_elem->>'notification_effective_result', 'PENDING') = ANY (v_eff_ok)
      AND COALESCE(v_elem->>'signature_effective_result', 'PENDING') = ANY (v_eff_ok)
    ) THEN
      CONTINUE;
    END IF;

    IF NOT (
      COALESCE(v_elem->>'projection_status', 'CURRENT') = ANY (v_proj_ok)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.agenda_sheet_operational_results AS t (
      organization_id,
      spreadsheet_id,
      sheet_id,
      sheet_title,
      booking_date,
      sheet_row,
      kind,
      location_id,
      slot_time,
      booking_id,
      expediente_id,
      visible_nss,
      visible_name,
      visible_advisor,
      source_block,
      biometric_result_class,
      biometric_result_raw,
      notification_result_class,
      notification_result_raw,
      signature_result_class,
      signature_result_raw,
      notes_raw,
      biometric_cell_red,
      notification_cell_red,
      signature_cell_red,
      operational_red_veto,
      inscripcion_rebook_required,
      inscripcion_rebook_reason_raw,
      biometric_color,
      notification_color,
      signature_color,
      biometric_effective_result,
      notification_effective_result,
      signature_effective_result,
      projection_status,
      last_seen_at
    ) VALUES (
      (v_elem->>'organization_id')::UUID,
      btrim(v_elem->>'spreadsheet_id'),
      (v_elem->>'sheet_id')::BIGINT,
      COALESCE(NULLIF(btrim(v_elem->>'sheet_title'), ''), '(sin título)'),
      (v_elem->>'booking_date')::DATE,
      (v_elem->>'sheet_row')::INTEGER,
      lower(btrim(v_elem->>'kind')),
      lower(btrim(v_elem->>'location_id')),
      NULLIF(btrim(COALESCE(v_elem->>'slot_time', '')), '')::TIME,
      NULLIF(btrim(COALESCE(v_elem->>'booking_id', '')), '')::UUID,
      NULLIF(btrim(COALESCE(v_elem->>'expediente_id', '')), '')::UUID,
      NULLIF(btrim(COALESCE(v_elem->>'visible_nss', '')), ''),
      NULLIF(btrim(COALESCE(v_elem->>'visible_name', '')), ''),
      NULLIF(btrim(COALESCE(v_elem->>'visible_advisor', '')), ''),
      NULLIF(lower(btrim(COALESCE(v_elem->>'source_block', ''))), ''),
      COALESCE(v_elem->>'biometric_result_class', 'PENDING'),
      NULLIF(btrim(COALESCE(v_elem->>'biometric_result_raw', '')), ''),
      COALESCE(v_elem->>'notification_result_class', 'PENDING'),
      NULLIF(btrim(COALESCE(v_elem->>'notification_result_raw', '')), ''),
      COALESCE(v_elem->>'signature_result_class', 'PENDING'),
      NULLIF(btrim(COALESCE(v_elem->>'signature_result_raw', '')), ''),
      NULLIF(btrim(COALESCE(v_elem->>'notes_raw', '')), ''),
      COALESCE((v_elem->>'biometric_cell_red')::BOOLEAN, false),
      COALESCE((v_elem->>'notification_cell_red')::BOOLEAN, false),
      COALESCE((v_elem->>'signature_cell_red')::BOOLEAN, false),
      COALESCE((v_elem->>'operational_red_veto')::BOOLEAN, false),
      COALESCE((v_elem->>'inscripcion_rebook_required')::BOOLEAN, false),
      NULLIF(btrim(COALESCE(v_elem->>'inscripcion_rebook_reason_raw', '')), ''),
      COALESCE(v_elem->>'biometric_color', 'UNKNOWN'),
      COALESCE(v_elem->>'notification_color', 'UNKNOWN'),
      COALESCE(v_elem->>'signature_color', 'UNKNOWN'),
      COALESCE(v_elem->>'biometric_effective_result', 'PENDING'),
      COALESCE(v_elem->>'notification_effective_result', 'PENDING'),
      COALESCE(v_elem->>'signature_effective_result', 'PENDING'),
      COALESCE(v_elem->>'projection_status', 'CURRENT'),
      COALESCE(
        NULLIF(btrim(COALESCE(v_elem->>'last_seen_at', '')), '')::TIMESTAMPTZ,
        NOW()
      )
    )
    ON CONFLICT (spreadsheet_id, sheet_id, sheet_row) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      sheet_title = EXCLUDED.sheet_title,
      booking_date = EXCLUDED.booking_date,
      kind = EXCLUDED.kind,
      location_id = EXCLUDED.location_id,
      slot_time = EXCLUDED.slot_time,
      booking_id = EXCLUDED.booking_id,
      expediente_id = EXCLUDED.expediente_id,
      visible_nss = EXCLUDED.visible_nss,
      visible_name = EXCLUDED.visible_name,
      visible_advisor = EXCLUDED.visible_advisor,
      source_block = EXCLUDED.source_block,
      biometric_result_class = EXCLUDED.biometric_result_class,
      biometric_result_raw = EXCLUDED.biometric_result_raw,
      notification_result_class = EXCLUDED.notification_result_class,
      notification_result_raw = EXCLUDED.notification_result_raw,
      signature_result_class = EXCLUDED.signature_result_class,
      signature_result_raw = EXCLUDED.signature_result_raw,
      notes_raw = EXCLUDED.notes_raw,
      biometric_cell_red = EXCLUDED.biometric_cell_red,
      notification_cell_red = EXCLUDED.notification_cell_red,
      signature_cell_red = EXCLUDED.signature_cell_red,
      operational_red_veto = EXCLUDED.operational_red_veto,
      inscripcion_rebook_required = EXCLUDED.inscripcion_rebook_required,
      inscripcion_rebook_reason_raw = EXCLUDED.inscripcion_rebook_reason_raw,
      biometric_color = EXCLUDED.biometric_color,
      notification_color = EXCLUDED.notification_color,
      signature_color = EXCLUDED.signature_color,
      biometric_effective_result = EXCLUDED.biometric_effective_result,
      notification_effective_result = EXCLUDED.notification_effective_result,
      signature_effective_result = EXCLUDED.signature_effective_result,
      projection_status = CASE
        WHEN t.projection_status = 'IDENTITY_CONFLICT' THEN 'IDENTITY_CONFLICT'
        ELSE COALESCE(EXCLUDED.projection_status, 'CURRENT')
      END,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = NOW();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('upserted', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_hoja_crm_list(p_date DATE)
RETURNS TABLE(
  row_source TEXT,row_id UUID,manual_occupancy_id UUID,inventory_id UUID,
  booking_id UUID,expediente_id UUID,booking_date DATE,kind TEXT,location_id TEXT,
  logical_time TIME,display_time TIME,row_status TEXT,origin_label TEXT,nss TEXT,
  cliente_nombre TEXT,asesor_nombre TEXT,biometric_result_raw TEXT,
  biometric_color TEXT,notification_result_raw TEXT,notification_color TEXT,
  signature_result_raw TEXT,signature_color TEXT,notes_raw TEXT,sheet_title TEXT,
  sheet_row INTEGER,editable BOOLEAN,available BOOLEAN,crm_override BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_actor UUID; v_org UUID; v_role public.app_role;
BEGIN
  v_actor:=public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'agenda_hoja_crm_list: no autenticado' USING ERRCODE='42501';
  END IF;

  SELECT p.organization_id,p.app_role
  INTO v_org,v_role
  FROM public.profiles p
  WHERE p.id=v_actor AND p.active=TRUE;

  IF v_org IS NULL OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'agenda_hoja_crm_list: rol no autorizado' USING ERRCODE='42501';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'agenda_hoja_crm_list: fecha invalida' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH manual_counts AS (
    SELECT m.kind::text AS k,m.location_id AS loc,m.booking_time AS bt,COUNT(*)::INTEGER AS n
    FROM public.agenda_manual_occupancies m
    WHERE m.organization_id=v_org
      AND m.booking_date=p_date
      AND m.status='active'
      AND m.source='manual_crm'
      AND m.counts_toward_capacity=TRUE
      AND m.reconciled_booking_id IS NULL
    GROUP BY m.kind::text,m.location_id,m.booking_time
  ), inventory_ranked AS (
    SELECT i.*,
      CASE WHEN i.status='available'
        THEN row_number() OVER(PARTITION BY i.kind,i.location_id,i.slot_time,i.status ORDER BY i.sheet_row,i.id)
        ELSE NULL
      END AS available_rank
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id=v_org
      AND i.booking_date=p_date
      AND i.kind IN ('biometricos','firmas','inscripcion')
      AND i.status IS DISTINCT FROM 'disabled'
  ), inventory_visible AS (
    SELECT i.*
    FROM inventory_ranked i
    LEFT JOIN manual_counts mc
      ON mc.k=i.kind AND mc.loc=i.location_id AND mc.bt=i.slot_time
    WHERE i.status<>'available' OR i.available_rank>COALESCE(mc.n,0)
  ), all_rows AS (
    SELECT
      'inventory'::TEXT rs,
      i.id rid,
      mlegacy.id mid,
      i.id iid,
      i.booking_id bid,
      COALESCE(i.expediente_id,b.expediente_id,mlegacy.expediente_id) eid,
      i.booking_date bd,
      i.kind k,
      i.location_id loc,
      i.slot_time lt,
      COALESCE(i.sheet_slot_time,i.slot_time) dt,
      i.status st,
      CASE
        WHEN i.status='available' THEN 'Disponible'
        WHEN i.status='occupied_external' THEN 'Manual Drive'
        ELSE 'CRM → Drive'
      END ol,
      COALESCE(NULLIF(btrim(i.visible_nss),''),NULLIF(btrim(e.nss::TEXT),''),mlegacy.nss) vn,
      COALESCE(NULLIF(btrim(i.visible_name),''),NULLIF(btrim(e.cliente_nombre),''),mlegacy.cliente_nombre) cn,
      COALESCE(NULLIF(btrim(i.visible_advisor),''),NULLIF(btrim(pa.full_name),''),mlegacy.asesor_nombre) an,
      CASE WHEN nr.id IS NOT NULL THEN nr.biometric_result_raw ELSE sr.biometric_result_raw END br,
      CASE WHEN nr.id IS NOT NULL THEN COALESCE(nr.biometric_color,'UNKNOWN') ELSE COALESCE(sr.biometric_color,'UNKNOWN') END bc,
      CASE WHEN nr.id IS NOT NULL THEN nr.notification_result_raw ELSE sr.notification_result_raw END nrw,
      CASE WHEN nr.id IS NOT NULL THEN COALESCE(nr.notification_color,'UNKNOWN') ELSE COALESCE(sr.notification_color,'UNKNOWN') END nc,
      CASE WHEN nr.id IS NOT NULL THEN nr.signature_result_raw ELSE sr.signature_result_raw END srw,
      CASE WHEN nr.id IS NOT NULL THEN COALESCE(nr.signature_color,'UNKNOWN') ELSE COALESCE(sr.signature_color,'UNKNOWN') END sc,
      CASE WHEN nr.id IS NOT NULL THEN nr.notes_raw ELSE sr.notes_raw END note,
      i.sheet_title sht,
      i.sheet_row shr,
      (i.status<>'available') ed,
      (i.status='available') av,
      (nr.id IS NOT NULL) ov
    FROM inventory_visible i
    LEFT JOIN public.agenda_bookings b ON b.id=i.booking_id
    LEFT JOIN public.agenda_manual_occupancies mlegacy
      ON mlegacy.source_inventory_id=i.id AND mlegacy.status='active'
    LEFT JOIN public.expedientes e
      ON e.id=COALESCE(i.expediente_id,b.expediente_id,mlegacy.expediente_id)
     AND e.deleted_at IS NULL
    LEFT JOIN public.profiles pa ON pa.id=e.asesor_id
    LEFT JOIN LATERAL (
      SELECT r.*
      FROM public.agenda_sheet_operational_results r
      WHERE r.organization_id=v_org
        AND r.booking_date=i.booking_date
        AND r.sheet_id=i.sheet_id
        AND r.sheet_row=i.sheet_row
      ORDER BY r.updated_at DESC NULLS LAST,r.id
      LIMIT 1
    ) sr ON TRUE
    LEFT JOIN LATERAL (
      SELECT n.*
      FROM public.agenda_operational_results_native n
      WHERE n.organization_id=v_org
        AND n.source='manual_crm'
        AND (
          (sr.id IS NOT NULL AND n.source_result_id=sr.id)
          OR (i.booking_id IS NOT NULL AND n.booking_id=i.booking_id)
          OR (mlegacy.id IS NOT NULL AND n.manual_occupancy_id=mlegacy.id)
        )
      ORDER BY
        CASE
          WHEN sr.id IS NOT NULL AND n.source_result_id=sr.id THEN 0
          WHEN i.booking_id IS NOT NULL AND n.booking_id=i.booking_id THEN 1
          ELSE 2
        END,
        n.updated_at DESC
      LIMIT 1
    ) nr ON TRUE

    UNION ALL

    SELECT
      'manual'::TEXT,m.id,m.id,NULL::UUID,m.reconciled_booking_id,m.expediente_id,
      m.booking_date,m.kind::text,m.location_id,m.booking_time,m.display_time,
      'occupied_manual_crm'::TEXT,'Manual CRM'::TEXT,m.nss,m.cliente_nombre,m.asesor_nombre,
      nr.biometric_result_raw,COALESCE(nr.biometric_color,'UNKNOWN'),
      nr.notification_result_raw,COALESCE(nr.notification_color,'UNKNOWN'),
      nr.signature_result_raw,COALESCE(nr.signature_color,'UNKNOWN'),
      COALESCE(nr.notes_raw,m.notes),NULL::TEXT,NULL::INTEGER,TRUE,FALSE,(nr.id IS NOT NULL)
    FROM public.agenda_manual_occupancies m
    LEFT JOIN LATERAL (
      SELECT n.*
      FROM public.agenda_operational_results_native n
      WHERE n.organization_id=v_org
        AND n.source='manual_crm'
        AND n.manual_occupancy_id=m.id
      ORDER BY n.updated_at DESC
      LIMIT 1
    ) nr ON TRUE
    WHERE m.organization_id=v_org
      AND m.booking_date=p_date
      AND m.status='active'
      AND m.source='manual_crm'

    UNION ALL

    SELECT
      'leo'::TEXT,
      r.id,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      r.booking_date,
      'biometricos'::TEXT,
      'leo'::TEXT,
      COALESCE(r.slot_time,TIME '00:00'),
      COALESCE(r.slot_time,TIME '00:00'),
      'leo'::TEXT,
      'LEO · Drive'::TEXT,
      r.visible_nss,
      r.visible_name,
      r.visible_advisor,
      CASE WHEN nr.id IS NOT NULL THEN nr.biometric_result_raw ELSE r.biometric_result_raw END,
      CASE WHEN nr.id IS NOT NULL THEN COALESCE(nr.biometric_color,'UNKNOWN') ELSE COALESCE(r.biometric_color,'UNKNOWN') END,
      CASE WHEN nr.id IS NOT NULL THEN nr.notification_result_raw ELSE r.notification_result_raw END,
      CASE WHEN nr.id IS NOT NULL THEN COALESCE(nr.notification_color,'UNKNOWN') ELSE COALESCE(r.notification_color,'UNKNOWN') END,
      NULL::TEXT,
      'UNKNOWN'::TEXT,
      CASE WHEN nr.id IS NOT NULL THEN nr.notes_raw ELSE r.notes_raw END,
      r.sheet_title,
      r.sheet_row,
      TRUE,
      FALSE,
      (nr.id IS NOT NULL)
    FROM public.agenda_sheet_operational_results r
    LEFT JOIN LATERAL (
      SELECT n.*
      FROM public.agenda_operational_results_native n
      WHERE n.organization_id=v_org
        AND n.source='manual_crm'
        AND n.source_result_id=r.id
      ORDER BY n.updated_at DESC
      LIMIT 1
    ) nr ON TRUE
    WHERE r.organization_id=v_org
      AND r.booking_date=p_date
      AND r.source_block='leo'
      AND r.projection_status='CURRENT'
  )
  SELECT
    q.rs,q.rid,q.mid,q.iid,q.bid,q.eid,q.bd,q.k,q.loc,q.lt,q.dt,q.st,q.ol,
    q.vn,q.cn,q.an,q.br,q.bc,q.nrw,q.nc,q.srw,q.sc,q.note,q.sht,q.shr,q.ed,q.av,q.ov
  FROM all_rows q
  ORDER BY
    CASE q.loc
      WHEN 'monterrey' THEN 0
      WHEN 'leo' THEN 1
      WHEN 'apodaca' THEN 2
      ELSE 3
    END,
    CASE q.k
      WHEN 'firmas' THEN 0
      WHEN 'biometricos' THEN 1
      WHEN 'inscripcion' THEN 2
      ELSE 3
    END,
    q.dt,q.shr NULLS LAST,q.rid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_hoja_crm_save_result(
  p_row_source TEXT,
  p_row_id UUID,
  p_biometric_result_raw TEXT DEFAULT NULL,
  p_biometric_color TEXT DEFAULT 'UNKNOWN',
  p_notification_result_raw TEXT DEFAULT NULL,
  p_notification_color TEXT DEFAULT 'UNKNOWN',
  p_signature_result_raw TEXT DEFAULT NULL,
  p_signature_color TEXT DEFAULT 'UNKNOWN',
  p_notes_raw TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;v_org UUID;v_role public.app_role;v_kind TEXT;v_location TEXT;
  v_date DATE;v_time TIME;v_booking_id UUID;v_expediente_id UUID;v_manual_id UUID;
  v_source_result_id UUID;v_source_spreadsheet_id TEXT;v_source_sheet_id BIGINT;
  v_source_sheet_title TEXT;v_source_sheet_row INTEGER;v_native_id UUID;
  v_bio_color TEXT;v_notif_color TEXT;v_sign_color TEXT;
BEGIN
  v_actor:=public.current_profile_id();
  SELECT p.organization_id,p.app_role INTO v_org,v_role
  FROM public.profiles p
  WHERE p.id=v_actor AND p.active=TRUE;

  IF v_actor IS NULL OR v_org IS NULL
     OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'agenda_hoja_crm_save_result: no autorizado' USING ERRCODE='42501';
  END IF;

  IF lower(btrim(COALESCE(p_row_source,'')))='inventory' THEN
    SELECT i.kind,i.location_id,i.booking_date,i.slot_time,i.booking_id,
      COALESCE(i.expediente_id,b.expediente_id),i.spreadsheet_id,i.sheet_id,
      i.sheet_title,i.sheet_row,m.id
    INTO v_kind,v_location,v_date,v_time,v_booking_id,v_expediente_id,
      v_source_spreadsheet_id,v_source_sheet_id,v_source_sheet_title,
      v_source_sheet_row,v_manual_id
    FROM public.agenda_sheet_slot_inventory i
    LEFT JOIN public.agenda_bookings b ON b.id=i.booking_id
    LEFT JOIN public.agenda_manual_occupancies m
      ON m.source_inventory_id=i.id AND m.status='active'
    WHERE i.id=p_row_id
      AND i.organization_id=v_org
      AND i.status NOT IN ('available','disabled')
    FOR UPDATE OF i;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'agenda_hoja_crm_save_result: fila no editable' USING ERRCODE='22023';
    END IF;

    SELECT r.id INTO v_source_result_id
    FROM public.agenda_sheet_operational_results r
    WHERE r.organization_id=v_org
      AND r.booking_date=v_date
      AND r.sheet_id=v_source_sheet_id
      AND r.sheet_row=v_source_sheet_row
    ORDER BY r.updated_at DESC NULLS LAST,r.id
    LIMIT 1;

  ELSIF lower(btrim(COALESCE(p_row_source,'')))='manual' THEN
    SELECT m.kind::text,m.location_id,m.booking_date,m.booking_time,
      m.reconciled_booking_id,m.expediente_id,m.id
    INTO v_kind,v_location,v_date,v_time,v_booking_id,v_expediente_id,v_manual_id
    FROM public.agenda_manual_occupancies m
    WHERE m.id=p_row_id
      AND m.organization_id=v_org
      AND m.status='active'
      AND m.source='manual_crm'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'agenda_hoja_crm_save_result: manual no disponible' USING ERRCODE='22023';
    END IF;

  ELSIF lower(btrim(COALESCE(p_row_source,'')))='leo' THEN
    SELECT
      r.kind,r.location_id,r.booking_date,COALESCE(r.slot_time,TIME '00:00'),
      NULL::UUID,NULL::UUID,r.spreadsheet_id,r.sheet_id,r.sheet_title,r.sheet_row,r.id
    INTO
      v_kind,v_location,v_date,v_time,v_booking_id,v_expediente_id,
      v_source_spreadsheet_id,v_source_sheet_id,v_source_sheet_title,
      v_source_sheet_row,v_source_result_id
    FROM public.agenda_sheet_operational_results r
    WHERE r.id=p_row_id
      AND r.organization_id=v_org
      AND r.source_block='leo'
      AND r.projection_status='CURRENT'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'agenda_hoja_crm_save_result: fila LEO no disponible' USING ERRCODE='22023';
    END IF;

  ELSE
    RAISE EXCEPTION 'agenda_hoja_crm_save_result: origen invalido' USING ERRCODE='22023';
  END IF;

  IF v_source_result_id IS NOT NULL THEN
    SELECT n.id INTO v_native_id
    FROM public.agenda_operational_results_native n
    WHERE n.organization_id=v_org AND n.source_result_id=v_source_result_id
    FOR UPDATE;
  END IF;

  IF v_native_id IS NULL AND v_manual_id IS NOT NULL THEN
    SELECT n.id INTO v_native_id
    FROM public.agenda_operational_results_native n
    WHERE n.organization_id=v_org AND n.manual_occupancy_id=v_manual_id
    ORDER BY n.updated_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_native_id IS NULL AND v_booking_id IS NOT NULL THEN
    SELECT n.id INTO v_native_id
    FROM public.agenda_operational_results_native n
    WHERE n.organization_id=v_org AND n.booking_id=v_booking_id
    ORDER BY n.updated_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  v_bio_color:=public.agenda_hoja_crm_normalize_color(p_biometric_color);
  v_notif_color:=public.agenda_hoja_crm_normalize_color(p_notification_color);
  v_sign_color:=public.agenda_hoja_crm_normalize_color(p_signature_color);

  IF v_native_id IS NULL THEN
    INSERT INTO public.agenda_operational_results_native(
      organization_id,booking_id,manual_occupancy_id,expediente_id,kind,location_id,
      booking_date,booking_time,biometric_result_class,biometric_result_raw,
      biometric_color,notification_result_class,notification_result_raw,
      notification_color,signature_result_class,signature_result_raw,signature_color,
      notes_raw,biometric_cell_red,notification_cell_red,signature_cell_red,
      operational_red_veto,source,source_result_id,source_spreadsheet_id,source_sheet_id,
      source_sheet_title,source_sheet_row,created_by
    )
    VALUES(
      v_org,v_booking_id,v_manual_id,v_expediente_id,v_kind,v_location,v_date,v_time,
      public.agenda_hoja_crm_result_class(p_biometric_result_raw,v_bio_color),
      NULLIF(btrim(COALESCE(p_biometric_result_raw,'')),''),
      v_bio_color,
      public.agenda_hoja_crm_result_class(p_notification_result_raw,v_notif_color),
      NULLIF(btrim(COALESCE(p_notification_result_raw,'')),''),
      v_notif_color,
      public.agenda_hoja_crm_result_class(p_signature_result_raw,v_sign_color),
      NULLIF(btrim(COALESCE(p_signature_result_raw,'')),''),
      v_sign_color,
      NULLIF(btrim(COALESCE(p_notes_raw,'')),''),
      v_bio_color='RED',v_notif_color='RED',v_sign_color='RED',
      (v_bio_color='RED' OR v_notif_color='RED' OR v_sign_color='RED'),
      'manual_crm',v_source_result_id,v_source_spreadsheet_id,v_source_sheet_id,
      v_source_sheet_title,v_source_sheet_row,v_actor
    )
    RETURNING id INTO v_native_id;
  ELSE
    UPDATE public.agenda_operational_results_native n
    SET booking_id=COALESCE(v_booking_id,n.booking_id),
        manual_occupancy_id=COALESCE(v_manual_id,n.manual_occupancy_id),
        expediente_id=COALESCE(v_expediente_id,n.expediente_id),
        kind=v_kind,
        location_id=v_location,
        booking_date=v_date,
        booking_time=v_time,
        biometric_result_class=public.agenda_hoja_crm_result_class(p_biometric_result_raw,v_bio_color),
        biometric_result_raw=NULLIF(btrim(COALESCE(p_biometric_result_raw,'')),''),
        biometric_color=v_bio_color,
        notification_result_class=public.agenda_hoja_crm_result_class(p_notification_result_raw,v_notif_color),
        notification_result_raw=NULLIF(btrim(COALESCE(p_notification_result_raw,'')),''),
        notification_color=v_notif_color,
        signature_result_class=public.agenda_hoja_crm_result_class(p_signature_result_raw,v_sign_color),
        signature_result_raw=NULLIF(btrim(COALESCE(p_signature_result_raw,'')),''),
        signature_color=v_sign_color,
        notes_raw=NULLIF(btrim(COALESCE(p_notes_raw,'')),''),
        biometric_cell_red=(v_bio_color='RED'),
        notification_cell_red=(v_notif_color='RED'),
        signature_cell_red=(v_sign_color='RED'),
        operational_red_veto=(v_bio_color='RED' OR v_notif_color='RED' OR v_sign_color='RED'),
        source='manual_crm',
        source_result_id=COALESCE(v_source_result_id,n.source_result_id),
        source_spreadsheet_id=COALESCE(v_source_spreadsheet_id,n.source_spreadsheet_id),
        source_sheet_id=COALESCE(v_source_sheet_id,n.source_sheet_id),
        source_sheet_title=COALESCE(v_source_sheet_title,n.source_sheet_title),
        source_sheet_row=COALESCE(v_source_sheet_row,n.source_sheet_row),
        created_by=COALESCE(n.created_by,v_actor),
        updated_at=NOW()
    WHERE n.id=v_native_id;
  END IF;

  PERFORM public.log_action(
    v_org,v_actor,v_role,'AGENDA_HOJA_RESULT_UPDATED','agenda_operational_result',
    v_native_id,
    jsonb_build_object(
      'row_source',lower(btrim(p_row_source)),
      'row_id',p_row_id,
      'booking_id',v_booking_id,
      'manual_occupancy_id',v_manual_id,
      'booking_date',v_date,
      'booking_time',v_time,
      'kind',v_kind,
      'location_id',v_location,
      'mutates_stage',false
    )
  );

  RETURN jsonb_build_object('ok',true,'result_id',v_native_id,'mutates_stage',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_hoja_crm_list(DATE) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agenda_hoja_crm_list(DATE) TO authenticated,service_role,postgres;
REVOKE ALL ON FUNCTION public.agenda_hoja_crm_save_result(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agenda_hoja_crm_save_result(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated,service_role,postgres;
