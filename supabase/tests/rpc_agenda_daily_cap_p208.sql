-- P208: daily cap helpers. BEGIN/ROLLBACK. No muta citas reales.
\set ON_ERROR_STOP on
\ir ../migrations/208_agenda_biometricos_monterrey_daily_cap.sql

BEGIN;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8208-000000000001';
  v_cap INTEGER;
  v_occ INTEGER;
  v_rem INTEGER;
BEGIN
  v_cap := public.agenda_daily_capacity(v_org, 'biometricos', DATE '2026-09-01', 'monterrey');
  IF v_cap IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'P208 cap monterrey bio != 15: %', v_cap;
  END IF;
  IF public.agenda_daily_capacity(v_org, 'biometricos', DATE '2026-09-01', 'apodaca') IS NOT NULL THEN
    RAISE EXCEPTION 'P208 apodaca no debe tener cap diario';
  END IF;
  v_cap := public.agenda_daily_capacity(v_org, 'firmas', DATE '2026-09-01', 'monterrey');
  IF v_cap IS NOT NULL AND v_cap IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'P212 firmas cap monterrey != 15: %', v_cap;
  END IF;
  v_occ := public.agenda_daily_active_occupancy(v_org, 'biometricos', DATE '2099-01-01', 'monterrey');
  IF v_occ IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'P208 occupancy fecha vacía != 0: %', v_occ;
  END IF;
  v_rem := public.agenda_daily_remaining(v_org, 'biometricos', DATE '2099-01-01', 'monterrey');
  IF v_rem IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'P208 remaining vacío != 15: %', v_rem;
  END IF;
  RAISE NOTICE 'P208 helper fixtures OK';
END;
$$;

ROLLBACK;
