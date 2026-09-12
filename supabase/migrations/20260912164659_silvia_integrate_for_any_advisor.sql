DO $$
DECLARE
  v_profile_id uuid;
BEGIN
  SELECT id INTO STRICT v_profile_id
  FROM public.profiles
  WHERE lower(email) = 'silvia.reyes@concasa.mx'
    AND active = true;

  INSERT INTO public.profile_capabilities (profile_id, capability, active, updated_at)
  VALUES (v_profile_id, 'integrate_for_any_advisor', true, now())
  ON CONFLICT (profile_id, capability)
  DO UPDATE SET active = true, updated_at = EXCLUDED.updated_at;
END;
$$;
