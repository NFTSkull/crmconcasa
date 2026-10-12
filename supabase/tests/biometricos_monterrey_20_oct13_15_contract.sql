-- Contract test: ONLY Monterrey October 13,14,15 2026 gets 20 biometric appointments.
DO $test$
DECLARE
  org uuid := '50beae49-3961-4163-8e78-2251693f2c19';
  d date;
BEGIN
  FOREACH d IN ARRAY ARRAY['2026-10-13'::date,'2026-10-14'::date,'2026-10-15'::date] LOOP
    IF public.agenda_daily_capacity(org,'biometricos',d,'monterrey') IS DISTINCT FROM 20 THEN
      RAISE EXCEPTION 'Monterrey % must permit 20 biometric bookings', d;
    END IF;
    IF public.agenda_daily_capacity(org,'biometricos',d,'apodaca') IS DISTINCT FROM 15 THEN
      RAISE EXCEPTION 'Apodaca % must remain at 15', d;
    END IF;
  END LOOP;
  FOREACH d IN ARRAY ARRAY['2026-10-12'::date,'2026-10-16'::date,'2026-10-19'::date] LOOP
    IF public.agenda_daily_capacity(org,'biometricos',d,'monterrey') IS DISTINCT FROM 15 THEN
      RAISE EXCEPTION 'Monterrey % must retain normal 15 cap', d;
    END IF;
  END LOOP;
END $test$;
