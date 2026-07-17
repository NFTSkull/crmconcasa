-- ConCasa CRM — P078: perfil asesor para Auth user ya existente
-- Auth UID: 6e48ff6b-5bb2-4418-8ffc-8a67df5cc57a
-- Email: asesor.mejoravit@usuarios.concasa.mx
--
-- NO inserta ni modifica auth.users (usuario Auth ya creado y confirmado).
-- Autorización vía public.profiles (app_role/org/active), no user_metadata.
-- Org piloto única: ConCasa (slug concasa).
-- Idempotente: perfil idéntico = no-op; perfil incompatible = error.

DO $$
DECLARE
  v_auth_email TEXT;
  v_existing public.profiles%ROWTYPE;
  v_uid CONSTANT UUID := '6e48ff6b-5bb2-4418-8ffc-8a67df5cc57a';
  v_email CONSTANT TEXT := 'asesor.mejoravit@usuarios.concasa.mx';
  v_org CONSTANT UUID := '50beae49-3961-4163-8e78-2251693f2c19';
BEGIN
  SELECT u.email
  INTO v_auth_email
  FROM auth.users u
  WHERE u.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'P078: auth.users no tiene UID % — no se crea perfil',
      v_uid;
  END IF;

  IF lower(btrim(COALESCE(v_auth_email, ''))) <> lower(v_email) THEN
    RAISE EXCEPTION
      'P078: Auth UID % no corresponde al email esperado',
      v_uid;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = v_org
      AND o.slug = 'concasa'
      AND o.active = true
  ) THEN
    RAISE EXCEPTION
      'P078: organización ConCasa (%) ausente o inactiva',
      v_org;
  END IF;

  SELECT p.*
  INTO v_existing
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF FOUND THEN
    IF v_existing.app_role = 'asesor'::public.app_role
       AND v_existing.organization_id = v_org
       AND v_existing.active IS TRUE
       AND v_existing.tipo_asesor_origen = 'interno'::public.tipo_asesor_origen
       AND lower(btrim(v_existing.email)) = lower(v_email)
       AND v_existing.tipo_mesa IS NULL
    THEN
      RAISE NOTICE 'P078: perfil idéntico ya existe — no-op';
      RETURN;
    END IF;

    RAISE EXCEPTION
      'P078: perfil existente incompatible (app_role=%, org=%, active=%, origen=%) — abortado sin sobrescribir',
      v_existing.app_role,
      v_existing.organization_id,
      v_existing.active,
      v_existing.tipo_asesor_origen;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE lower(btrim(p.email)) = lower(v_email)
      AND p.id <> v_uid
  ) THEN
    RAISE EXCEPTION
      'P078: email % ya pertenece a otro perfil — abortado',
      v_email;
  END IF;

  INSERT INTO public.profiles (
    id,
    organization_id,
    email,
    full_name,
    app_role,
    tipo_mesa,
    tipo_asesor_origen,
    active
  ) VALUES (
    v_uid,
    v_org,
    v_email,
    'Asesor Mejoravit',
    'asesor',
    NULL,
    'interno',
    true
  );
END;
$$;
