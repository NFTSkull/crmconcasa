-- ConCasa CRM — pruebas estructurales inventario Sheet (mig. 131)
-- Uso: psql … -f supabase/tests/rpc_agenda_sheet_slot_inventory.sql
-- Sin fixtures destructivos fuertes (seguro-ish en Cloud si solo asserts estructurales).

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__inv_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'AGENDA SHEET INVENTORY TEST FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_has_ins BOOLEAN;
  v_has_upd BOOLEAN;
  v_has_del BOOLEAN;
  v_con TEXT;
BEGIN
  -- Tabla
  PERFORM public.__inv_assert(
    to_regclass('public.agenda_sheet_slot_inventory') IS NOT NULL,
    'tabla agenda_sheet_slot_inventory existe'
  );

  -- Constraints / checks clave
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agenda_sheet_slot_inventory'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%spreadsheet_id%sheet_id%sheet_row%'
  ), 'UNIQUE (spreadsheet_id, sheet_id, sheet_row)');

  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'agenda_sheet_slot_inventory_booking_uidx'
  ), 'unique partial booking_id');

  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'agenda_sheet_slot_inventory_lookup_idx'
  ), 'lookup index org/date/kind/location/time/status');

  SELECT string_agg(pg_get_constraintdef(oid), ' | ')
  INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'public.agenda_sheet_slot_inventory'::regclass
    AND contype = 'c';
  PERFORM public.__inv_assert(
    v_con ILIKE '%available%' AND v_con ILIKE '%claimed%' AND v_con ILIKE '%biometricos%',
    'check constraints status/kind'
  );

  -- Grants: authenticated NO INSERT/UPDATE/DELETE
  SELECT has_table_privilege('authenticated', 'public.agenda_sheet_slot_inventory', 'INSERT')
  INTO v_has_ins;
  SELECT has_table_privilege('authenticated', 'public.agenda_sheet_slot_inventory', 'UPDATE')
  INTO v_has_upd;
  SELECT has_table_privilege('authenticated', 'public.agenda_sheet_slot_inventory', 'DELETE')
  INTO v_has_del;
  PERFORM public.__inv_assert(NOT COALESCE(v_has_ins, false), 'authenticated NO INSERT');
  PERFORM public.__inv_assert(NOT COALESCE(v_has_upd, false), 'authenticated NO UPDATE');
  PERFORM public.__inv_assert(NOT COALESCE(v_has_del, false), 'authenticated NO DELETE');

  -- enforced dates
  PERFORM public.__inv_assert(
    public.agenda_sheet_inventory_enforced(DATE '2026-07-29') IS FALSE,
    'enforced(2026-07-29)=false'
  );
  PERFORM public.__inv_assert(
    public.agenda_sheet_inventory_enforced(DATE '2026-07-30') IS TRUE,
    'enforced(2026-07-30)=true'
  );
  PERFORM public.__inv_assert(
    public.agenda_sheet_inventory_applies('monterrey') IS TRUE,
    'applies(monterrey)=true'
  );
  PERFORM public.__inv_assert(
    public.agenda_sheet_inventory_applies('sede-centro') IS FALSE,
    'applies(sede-centro)=false (legacy config-only)'
  );

  -- Claim trigger SKIP LOCKED (función + trigger; nombre ordena antes que outbox)
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agenda_sheet_inventory_claim_ai'
  ), 'función claim_ai existe');
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'agenda_sheet_inventory_claim_ai'
      AND tgrelid = 'public.agenda_bookings'::regclass
  ), 'trigger claim_ai existe');
  PERFORM public.__inv_assert(
    'agenda_sheet_inventory_claim_ai' < 'agenda_sheet_outbox_aiud',
    'claim_ai ordena antes que outbox_aiud'
  );
  PERFORM public.__inv_assert(
    pg_get_functiondef('public.agenda_sheet_inventory_claim_ai()'::regprocedure)
      ILIKE '%SKIP LOCKED%',
    'claim usa FOR UPDATE SKIP LOCKED'
  );

  -- Availability RPC
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agenda_sheet_inventory_availability'
  ), 'RPC availability existe');
  PERFORM public.__inv_assert(
    has_function_privilege(
      'authenticated',
      'public.agenda_sheet_inventory_availability(text, date, text)',
      'EXECUTE'
    ),
    'authenticated puede EXECUTE availability'
  );

  -- Gate helper
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'agenda_sheet_inventory_gate_after_config_assert'
  ), 'gate_after_config_assert existe');

  -- Mig. 134: título exacto + requeue
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agenda_sheet_requeue_dead_sync'
  ), 'requeue_dead_sync existe');
  PERFORM public.__inv_assert(
    pg_get_functiondef('public.agenda_sheet_inventory_upsert_batch(jsonb)'::regprocedure)
      ILIKE '%no btrim%',
    'upsert_batch documenta no-btrim sheet_title'
  );
  PERFORM public.__inv_assert(
    NOT has_function_privilege(
      'authenticated',
      'public.agenda_sheet_requeue_dead_sync(uuid)',
      'EXECUTE'
    ),
    'authenticated NO execute requeue'
  );
  PERFORM public.__inv_assert(
    has_function_privilege(
      'service_role',
      'public.agenda_sheet_requeue_dead_sync(uuid)',
      'EXECUTE'
    ),
    'service_role sí execute requeue'
  );

  -- Mig. 137: aliases + sheet_slot_time
  PERFORM public.__inv_assert(
    to_regclass('public.agenda_sheet_time_aliases') IS NOT NULL,
    'tabla agenda_sheet_time_aliases existe'
  );
  PERFORM public.__inv_assert(
    to_regclass('public.agenda_sheet_time_alias_defaults') IS NOT NULL,
    'tabla agenda_sheet_time_alias_defaults existe'
  );
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agenda_sheet_slot_inventory'
      AND column_name = 'sheet_slot_time'
  ), 'columna sheet_slot_time');
  PERFORM public.__inv_assert(
    NOT has_table_privilege('authenticated', 'public.agenda_sheet_time_aliases', 'INSERT'),
    'authenticated NO INSERT aliases'
  );
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agenda_sheet_resolve_logical_time'
  ), 'resolve_logical_time existe');
  PERFORM public.__inv_assert(
    pg_get_functiondef('public.agenda_sheet_inventory_upsert_batch(jsonb)'::regprocedure)
      ILIKE '%sheet_slot_time%',
    'upsert_batch persiste sheet_slot_time'
  );

  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agenda_sheet_time_aliases'::regclass
      AND conname = 'agenda_sheet_time_aliases_sheet_uidx'
  ), 'aliases UNIQUE sheet físico');
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agenda_sheet_time_aliases'::regclass
      AND conname = 'agenda_sheet_time_aliases_logical_uidx'
  ), 'aliases UNIQUE logical');
  PERFORM public.__inv_assert(EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agenda_sheet_time_alias_defaults'::regclass
      AND conname = 'agenda_sheet_time_alias_defaults_sheet_uidx'
  ), 'defaults UNIQUE sheet físico');

  RAISE NOTICE 'rpc_agenda_sheet_slot_inventory OK';
END;
$$;
