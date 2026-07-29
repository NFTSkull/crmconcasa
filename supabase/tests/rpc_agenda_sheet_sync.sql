-- ConCasa CRM — pruebas focales integración Google Sheets agenda (mig. 129)
-- Uso local: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_agenda_sheet_sync.sql
-- NO ejecutar contra Cloud.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__sheet_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'AGENDA SHEET TEST FAIL: %', p_msg; END IF;
END; $$;

DO $$
DECLARE
  v_has_table BOOLEAN;
  v_has_rpc BOOLEAN;
  v_grant_auth BOOLEAN;
  v_grant_anon BOOLEAN;
  v_grant_service BOOLEAN;
BEGIN
  SELECT to_regclass('public.agenda_sheet_slot_links') IS NOT NULL INTO v_has_table;
  PERFORM public.__sheet_assert(v_has_table, 'tabla agenda_sheet_slot_links');

  SELECT to_regclass('public.agenda_sheet_sync_outbox') IS NOT NULL INTO v_has_table;
  PERFORM public.__sheet_assert(v_has_table, 'tabla agenda_sheet_sync_outbox');

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agenda_sheet_book_by_nss'
  ) INTO v_has_rpc;
  PERFORM public.__sheet_assert(v_has_rpc, 'RPC agenda_sheet_book_by_nss');

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agenda_sheet_claim_outbox'
  ) INTO v_has_rpc;
  PERFORM public.__sheet_assert(v_has_rpc, 'RPC agenda_sheet_claim_outbox');

  SELECT has_function_privilege('authenticated', 'public.agenda_sheet_book_by_nss(uuid,text,bigint,text,date,integer,text,public.booking_kind,time,integer,text,timestamptz,text)', 'EXECUTE')
  INTO v_grant_auth;
  PERFORM public.__sheet_assert(NOT COALESCE(v_grant_auth, false), 'authenticated NO execute book');

  SELECT has_function_privilege('anon', 'public.agenda_sheet_book_by_nss(uuid,text,bigint,text,date,integer,text,public.booking_kind,time,integer,text,timestamptz,text)', 'EXECUTE')
  INTO v_grant_anon;
  PERFORM public.__sheet_assert(NOT COALESCE(v_grant_anon, false), 'anon NO execute book');

  SELECT has_function_privilege('service_role', 'public.agenda_sheet_book_by_nss(uuid,text,bigint,text,date,integer,text,public.booking_kind,time,integer,text,timestamptz,text)', 'EXECUTE')
  INTO v_grant_service;
  PERFORM public.__sheet_assert(COALESCE(v_grant_service, false), 'service_role SÍ execute book');

  -- Índices de unicidad presentes
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'agenda_sheet_slot_links_active_booking_uidx'
  ), 'unique booking activo');

  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'agenda_sheet_slot_links_slot_ordinal_uidx'
  ), 'unique ordinal activo');

  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'agenda_sheet_outbox_aiud'
  ), 'trigger outbox en agenda_bookings');

  -- NSS normalizer
  PERFORM public.__sheet_assert(
    public.agenda_sheet_normalize_nss('´03179461821') = '03179461821',
    'nss apóstrofe'
  );
  PERFORM public.__sheet_assert(
    public.agenda_sheet_normalize_nss('031-794-61821') = '03179461821',
    'nss guiones'
  );
  PERFORM public.__sheet_assert(
    public.agenda_sheet_normalize_nss('123') IS NULL,
    'nss inválido'
  );

  RAISE NOTICE 'AGENDA SHEET STRUCTURAL TESTS OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__sheet_assert(BOOLEAN, TEXT);
