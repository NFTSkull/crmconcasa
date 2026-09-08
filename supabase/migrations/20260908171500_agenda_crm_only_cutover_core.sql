-- ConCasa CRM — Agenda CRM-only cutover CORE.
-- Supabase/CRM pasa a ser única autoridad de cupo.
-- Conserva firmas/RPC/etapas; elimina dependencia de fila física/freshness de Google.

-- 1) Congelar capacidad EFECTIVA restante de Septiembre tal como opera hoy.
-- desired_capacity = ocupación CRM nativa + lugares que el gate actual aún permitiría.
WITH slots AS (
  SELECT
    i.organization_id,
    i.booking_date,
    i.kind,
    i.location_id,
    i.slot_time,
    count(*) FILTER (WHERE i.status = 'available')::integer AS sheet_available
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.booking_date BETWEEN DATE '2026-09-08' AND DATE '2026-09-30'
    AND i.status IS DISTINCT FROM 'disabled'
  GROUP BY 1,2,3,4,5
), base AS (
  SELECT
    s.*,
    (SELECT count(*)::integer
       FROM public.agenda_bookings b
      WHERE b.organization_id=s.organization_id
        AND b.booking_date=s.booking_date
        AND b.kind::text=s.kind
        AND lower(btrim(b.location_id))=lower(btrim(s.location_id))
        AND b.booking_time=s.slot_time
        AND b.status='booked') AS booked_count,
    public.agenda_crm_manual_slot_active_count(
      s.organization_id,s.kind,s.booking_date,s.slot_time,s.location_id
    ) AS manual_count,
    CASE
      WHEN s.kind='inscripcion' THEN NULL::integer
      WHEN s.kind='biometricos' THEN public.agenda_location_explicit_capacity(
        public.agenda_biometricos_normalize_config(ac.config)->'locations'->s.location_id,
        to_char(s.slot_time,'HH24:MI')
      )
      WHEN s.kind='firmas' THEN public.agenda_location_explicit_capacity(
        public.agenda_firmas_normalize_config(ac.config)->'locations'->s.location_id,
        to_char(s.slot_time,'HH24:MI')
      )
      ELSE NULL::integer
    END AS configured_capacity
  FROM slots s
  LEFT JOIN public.agenda_config ac
    ON ac.organization_id=s.organization_id
   AND ac.kind=s.kind
), desired AS (
  SELECT
    b.*,
    GREATEST(
      b.booked_count+b.manual_count,
      b.booked_count+b.manual_count +
      CASE
        WHEN b.kind='inscripcion' THEN GREATEST(b.sheet_available,0)
        WHEN b.configured_capacity IS NULL THEN GREATEST(b.sheet_available,0)
        ELSE LEAST(
          GREATEST(b.sheet_available,0),
          GREATEST(b.configured_capacity-b.booked_count,0)
        )
      END
    )::integer AS desired_capacity
  FROM base b
)
INSERT INTO public.agenda_slot_capacities (
  organization_id,kind,location_id,slot_date,slot_time,capacity,active
)
SELECT
  d.organization_id,
  d.kind::public.booking_kind,
  d.location_id,
  d.booking_date,
  d.slot_time,
  GREATEST(d.desired_capacity,1),
  true
FROM desired d
WHERE d.desired_capacity > 0
ON CONFLICT (organization_id,kind,location_id,slot_date,slot_time)
DO NOTHING;

-- 2) Capacidad canónica CRM por slot: override fecha > agenda_config > inscripción 4.
CREATE OR REPLACE FUNCTION public.agenda_crm_slot_capacity(
  p_org uuid,p_kind text,p_date date,p_time time,p_location text
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_kind text := lower(btrim(COALESCE(p_kind,'')));
  v_loc text := lower(btrim(COALESCE(p_location,'')));
  v_cap integer;
  v_cfg jsonb;
BEGIN
  SELECT c.capacity INTO v_cap
  FROM public.agenda_slot_capacities c
  WHERE c.organization_id=p_org
    AND c.kind::text=v_kind
    AND c.location_id=v_loc
    AND c.slot_date=p_date
    AND c.slot_time=p_time
    AND c.active=true
  LIMIT 1;
  IF FOUND THEN RETURN GREATEST(v_cap,0); END IF;

  IF v_kind='inscripcion' THEN
    IF v_loc='monterrey' AND p_time=TIME '11:00' THEN RETURN 4; END IF;
    RETURN 0;
  END IF;

  SELECT ac.config INTO v_cfg
  FROM public.agenda_config ac
  WHERE ac.organization_id=p_org AND ac.kind=v_kind;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF v_kind='biometricos' THEN
    v_cfg := public.agenda_biometricos_normalize_config(v_cfg);
  ELSIF v_kind='firmas' THEN
    v_cfg := public.agenda_firmas_normalize_config(v_cfg);
  ELSE
    RETURN 0;
  END IF;

  IF COALESCE((v_cfg->>'enabled')::boolean,true) IS NOT TRUE THEN RETURN 0; END IF;
  IF NOT (v_cfg->'locations' ? v_loc) THEN RETURN 0; END IF;
  IF COALESCE((v_cfg->'locations'->v_loc->>'enabled')::boolean,true) IS NOT TRUE THEN RETURN 0; END IF;

  v_cap := public.agenda_location_explicit_capacity(
    v_cfg->'locations'->v_loc,
    to_char(p_time,'HH24:MI')
  );
  RETURN GREATEST(COALESCE(v_cap,0),0);
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_crm_display_time(
  p_kind text,p_time time,p_location text
)
RETURNS time
LANGUAGE sql
IMMUTABLE
SET search_path=public
AS $$
  SELECT CASE
    WHEN lower(btrim(COALESCE(p_kind,'')))='biometricos'
     AND p_time=TIME '08:00' THEN TIME '08:30'
    ELSE p_time
  END;
$$;

-- 3) Ocupación diaria ahora = bookings CRM + manuales CRM (ya deduplicados).
CREATE OR REPLACE FUNCTION public.agenda_daily_active_occupancy(
  p_org uuid,p_kind text,p_date date,p_location text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
  SELECT (
    (SELECT count(*)::integer
       FROM public.agenda_bookings b
      WHERE b.organization_id=p_org
        AND b.kind::text=lower(btrim(COALESCE(p_kind,'')))
        AND b.booking_date=p_date
        AND lower(btrim(b.location_id))=lower(btrim(COALESCE(p_location,'')))
        AND b.status='booked')
    + public.agenda_crm_daily_manual_count(p_org,p_kind,p_date,p_location)
  )::integer;
$$;

CREATE OR REPLACE FUNCTION public.agenda_firmas_daily_active_occupancy(
  p_org uuid,p_date date,p_canonical_location text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
  SELECT (
    (SELECT count(*)::integer
       FROM public.agenda_bookings b
      WHERE b.organization_id=p_org
        AND b.kind='firmas'
        AND b.booking_date=p_date
        AND b.status='booked'
        AND public.agenda_firmas_canonical_location_id(b.location_id)=lower(btrim(COALESCE(p_canonical_location,''))))
    + (SELECT count(*)::integer
       FROM public.agenda_manual_occupancies m
      WHERE m.organization_id=p_org
        AND m.kind='firmas'
        AND m.booking_date=p_date
        AND m.status='active'
        AND m.counts_toward_capacity=true
        AND public.agenda_firmas_canonical_location_id(m.location_id)=lower(btrim(COALESCE(p_canonical_location,''))))
  )::integer;
$$;

-- 4) Compatibilidad: nombres legacy `agenda_sheet_*` ahora responden desde CRM.
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_fresh(p_org uuid,p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT true; $$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_physical_total(
  p_org uuid,p_kind text,p_date date,p_time time,p_location text
)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.agenda_crm_slot_capacity(p_org,p_kind,p_date,p_time,p_location);
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_available_count(
  p_org uuid,p_kind text,p_date date,p_time time,p_location text
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT GREATEST(
    public.agenda_crm_slot_capacity(p_org,p_kind,p_date,p_time,p_location)
    - (SELECT count(*)::integer FROM public.agenda_bookings b
       WHERE b.organization_id=p_org
         AND b.kind::text=lower(btrim(COALESCE(p_kind,'')))
         AND b.booking_date=p_date
         AND b.booking_time=p_time
         AND lower(btrim(b.location_id))=lower(btrim(COALESCE(p_location,'')))
         AND b.status='booked')
    - public.agenda_crm_manual_slot_active_count(p_org,p_kind,p_date,p_time,p_location),
    0
  )::integer;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_assert_inventory_allows_booking(
  p_org uuid,p_kind text,p_date date,p_time time,p_location text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_available integer;
BEGIN
  v_available := public.agenda_sheet_inventory_available_count(
    p_org,p_kind,p_date,p_time,p_location
  );
  IF COALESCE(v_available,0)<1 THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_CRM: Ese horario está completo. Selecciona otro disponible.'
      USING ERRCODE='22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_gate_after_config_assert(
  p_org uuid,p_kind text,p_date date,p_time time,p_location text,
  p_config_capacity integer,p_booked_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_manual integer;
  v_effective_capacity integer;
  v_daily integer;
  v_canonical text;
BEGIN
  v_manual := public.agenda_crm_manual_slot_active_count(
    p_org,p_kind,p_date,p_time,p_location
  );
  v_effective_capacity := LEAST(
    GREATEST(COALESCE(p_config_capacity,0),0),
    GREATEST(public.agenda_crm_slot_capacity(p_org,p_kind,p_date,p_time,p_location),0)
  );

  IF v_effective_capacity<1 OR COALESCE(p_booked_count,0)+COALESCE(v_manual,0)>=v_effective_capacity THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_CRM: Ese horario está completo. Selecciona otro disponible.'
      USING ERRCODE='22023';
  END IF;

  IF lower(btrim(COALESCE(p_kind,'')))='firmas' THEN
    IF public.agenda_firmas_daily_cap_contract_enabled(p_date) THEN
      v_canonical:=public.agenda_firmas_canonical_location_id(p_location);
      IF v_canonical IS NOT NULL THEN
        v_daily:=public.agenda_firmas_daily_remaining(p_org,p_date,v_canonical);
        IF v_daily IS NOT NULL AND v_daily<1 THEN
          RAISE EXCEPTION 'SIN_CUPO_DIA: El cupo diario de firmas está completo.' USING ERRCODE='22023';
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  v_daily:=public.agenda_daily_remaining(p_org,p_kind,p_date,p_location);
  IF v_daily IS NOT NULL AND v_daily<1 THEN
    RAISE EXCEPTION 'SIN_CUPO_DIA: El cupo diario de biométricos Monterrey está completo (máximo 15 personas).'
      USING ERRCODE='22023';
  END IF;
END;
$$;

-- 5) Availability JSON mantiene contrato FE, pero `fresh=true` significa CRM nativo.
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_availability(
  p_kind text,p_date date,p_location_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor uuid;
  v_org uuid;
  v_kind text:=lower(btrim(COALESCE(p_kind,'')));
  v_loc text:=lower(btrim(COALESCE(p_location_id,'')));
  v_cfg jsonb;
  v_slots jsonb:='[]'::jsonb;
  v_capacity integer:=0;
  v_available integer:=0;
  v_occupied integer:=0;
BEGIN
  v_actor:=public.current_profile_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'agenda_availability: usuario no autenticado' USING ERRCODE='42501'; END IF;
  SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id=v_actor AND p.active=true;
  IF v_org IS NULL THEN RAISE EXCEPTION 'agenda_availability: organización no encontrada' USING ERRCODE='42501'; END IF;
  IF v_kind NOT IN ('biometricos','firmas','inscripcion') THEN RAISE EXCEPTION 'agenda_availability: kind inválido' USING ERRCODE='22023'; END IF;
  IF v_loc NOT IN ('monterrey','apodaca') OR p_date IS NULL THEN RAISE EXCEPTION 'agenda_availability: fecha/sede inválida' USING ERRCODE='22023'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'slot_time',to_char(x.slot_time,'HH24:MI:SS'),
    'sheet_slot_time',to_char(public.agenda_crm_display_time(v_kind,x.slot_time,v_loc),'HH24:MI:SS'),
    'available',x.available,
    'physical_total',x.capacity,
    'capacity',x.capacity,
    'occupied',x.occupied,
    'occupied_external',x.manual_count,
    'claimed',0,
    'linked',x.booked_count,
    'disabled',0
  ) ORDER BY x.slot_time),'[]'::jsonb)
  INTO v_slots
  FROM (
    WITH override_slots AS (
      SELECT c.slot_time
      FROM public.agenda_slot_capacities c
      WHERE c.organization_id=v_org AND c.kind::text=v_kind AND c.location_id=v_loc
        AND c.slot_date=p_date AND c.active=true
    ), config_slots AS (
      SELECT (s #>> '{}')::time AS slot_time
      FROM public.agenda_config ac
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN v_kind='biometricos' THEN public.agenda_biometricos_normalize_config(ac.config)->'slots'
             WHEN v_kind='firmas' THEN public.agenda_firmas_normalize_config(ac.config)->'slots'
             ELSE '[]'::jsonb END
      ) s
      WHERE ac.organization_id=v_org AND ac.kind=v_kind
        AND NOT EXISTS (SELECT 1 FROM override_slots)
    ), candidate AS (
      SELECT slot_time FROM override_slots
      UNION
      SELECT slot_time FROM config_slots
      UNION
      SELECT TIME '11:00' WHERE v_kind='inscripcion' AND v_loc='monterrey'
        AND NOT EXISTS (SELECT 1 FROM override_slots)
    )
    SELECT
      c.slot_time,
      public.agenda_crm_slot_capacity(v_org,v_kind,p_date,c.slot_time,v_loc) AS capacity,
      (SELECT count(*)::integer FROM public.agenda_bookings b
        WHERE b.organization_id=v_org AND b.kind::text=v_kind AND b.booking_date=p_date
          AND b.booking_time=c.slot_time AND lower(btrim(b.location_id))=v_loc AND b.status='booked') AS booked_count,
      public.agenda_crm_manual_slot_active_count(v_org,v_kind,p_date,c.slot_time,v_loc) AS manual_count,
      GREATEST(public.agenda_sheet_inventory_available_count(v_org,v_kind,p_date,c.slot_time,v_loc),0) AS available,
      (SELECT count(*)::integer FROM public.agenda_bookings b
        WHERE b.organization_id=v_org AND b.kind::text=v_kind AND b.booking_date=p_date
          AND b.booking_time=c.slot_time AND lower(btrim(b.location_id))=v_loc AND b.status='booked')
       + public.agenda_crm_manual_slot_active_count(v_org,v_kind,p_date,c.slot_time,v_loc) AS occupied
    FROM candidate c
    WHERE public.agenda_crm_slot_capacity(v_org,v_kind,p_date,c.slot_time,v_loc)>0
  ) x;

  SELECT COALESCE(sum((s->>'capacity')::integer),0),COALESCE(sum((s->>'available')::integer),0)
    INTO v_capacity,v_available FROM jsonb_array_elements(v_slots) s;
  v_occupied:=GREATEST(v_capacity-v_available,0);

  RETURN jsonb_build_object(
    'ok',true,'fresh',true,'enforced',true,'source','crm',
    'slots',v_slots,'capacity',v_capacity,'available',v_available,'occupied',v_occupied,
    'daily_capacity',public.agenda_daily_capacity(v_org,v_kind,p_date,v_loc),
    'daily_occupancy',public.agenda_daily_active_occupancy(v_org,v_kind,p_date,v_loc),
    'daily_remaining',public.agenda_daily_remaining(v_org,v_kind,p_date,v_loc),
    'daily_overcapacity',COALESCE(public.agenda_daily_active_occupancy(v_org,v_kind,p_date,v_loc),0)>
      COALESCE(public.agenda_daily_capacity(v_org,v_kind,p_date,v_loc),2147483647),
    'fixed_time',CASE WHEN v_kind='inscripcion' THEN '11:00' ELSE NULL END,
    'kind',v_kind,'booking_date',p_date,'location_id',v_loc
  );
END;
$$;

-- 6) Los triggers legacy siguen presentes para compatibilidad de esquema, pero dejan
-- de reclamar/liberar filas o generar outbox hacia Google.
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_claim_ai()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_release_au()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.agenda_sheet_outbox_on_booking_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN NEW; END; $$;

COMMENT ON FUNCTION public.agenda_sheet_inventory_availability(text,date,text) IS
  'CRM-only: contrato FE legacy conservado; source=crm, sin lectura/freshness de Google Sheets.';
COMMENT ON FUNCTION public.agenda_sheet_inventory_claim_ai() IS 'CRM-only: no-op; bookings ya no reclaman filas Google.';
COMMENT ON FUNCTION public.agenda_sheet_inventory_release_au() IS 'CRM-only: no-op; cancelaciones ya no liberan filas Google.';
COMMENT ON FUNCTION public.agenda_sheet_outbox_on_booking_change() IS 'CRM-only: no-op; bookings ya no generan sync CRM→Google.';

-- 7) Detener cron automáticos de Google agenda, sin tocar otros cron del proyecto.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE command IN (
      'SELECT public.agenda_sheet_invoke_sync_worker();',
      'SELECT public.agenda_sheet_invoke_reconcile();',
      'SELECT public.agenda_sheet_invoke_availability_refresh();'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;
