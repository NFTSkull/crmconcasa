-- Bootstrap LOCAL aislado para migration 078 (prod UID/org).
-- Solo para verify B8; NO Cloud.

INSERT INTO public.organizations (id, slug, name, active)
VALUES (
  '50beae49-3961-4163-8e78-2251693f2c19',
  'concasa',
  'ConCasa',
  true
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  active = true;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '6e48ff6b-5bb2-4418-8ffc-8a67df5cc57a',
  'authenticated',
  'authenticated',
  'asesor.mejoravit@usuarios.concasa.mx',
  crypt('local-p189-b8', gen_salt('bf')),
  NOW(),
  '{}',
  '{}',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  email_confirmed_at = COALESCE(auth.users.email_confirmed_at, EXCLUDED.email_confirmed_at);
