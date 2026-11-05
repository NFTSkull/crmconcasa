-- ConCasa · indicador de casas NUEVAS por administrador.
-- No confundir solicitudes pendientes con notificaciones sin leer:
-- la bandeja conserva las pendientes aunque el contador desaparezca al abrirla.
-- Almacena la última lectura de cada administrador, sin modificar las casas.

CREATE TABLE IF NOT EXISTS public.casas_admin_bandeja_vistas (
  admin_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  vista_hasta timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.casas_admin_bandeja_vistas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.casas_admin_bandeja_vistas FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS casas_solicitudes_pendientes_nuevas_idx
  ON public.casas_solicitudes (organization_id, enviada_at DESC)
  WHERE estado = 'enviada' AND enviada_at IS NOT NULL;

-- Con un JWT autenticado, contar únicamente los envíos todavía pendientes
-- posteriores a la última apertura de ESTA bandeja por ESTE administrador.
CREATE OR REPLACE FUNCTION public.casas_admin_nuevas_count()
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_org uuid;
  v_vista_hasta timestamptz;
  v_total bigint;
BEGIN
  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_admin AND p.active AND p.app_role = 'super_admin';

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Solo Admin puede consultar notificaciones de casas'
      USING ERRCODE = '42501';
  END IF;

  SELECT v.vista_hasta INTO v_vista_hasta
  FROM public.casas_admin_bandeja_vistas v
  WHERE v.admin_id = v_admin AND v.organization_id = v_org;

  SELECT count(*) INTO v_total
  FROM public.casas_solicitudes s
  WHERE s.organization_id = v_org
    AND s.estado = 'enviada'
    AND s.enviada_at IS NOT NULL
    AND s.enviada_at > COALESCE(v_vista_hasta, '-infinity'::timestamptz);

  RETURN v_total;
END $$;

-- Marcar como vistas SOLAMENTE hasta el máximo instante efectivamente
-- cargado por la pantalla. Evita perder avisos de casas que entran DURANTE
-- la carga; la fecha se limita además al reloj del servidor.
CREATE OR REPLACE FUNCTION public.casas_admin_marcar_bandeja_vista(
  p_hasta timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_org uuid;
  v_limite timestamptz;
BEGIN
  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_admin AND p.active AND p.app_role = 'super_admin';

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Solo Admin puede marcar notificaciones de casas'
      USING ERRCODE = '42501';
  END IF;

  v_limite := LEAST(COALESCE(p_hasta, statement_timestamp()), statement_timestamp());

  INSERT INTO public.casas_admin_bandeja_vistas
    (admin_id, organization_id, vista_hasta, updated_at)
  VALUES (v_admin, v_org, v_limite, now())
  ON CONFLICT (admin_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    vista_hasta = CASE
      WHEN public.casas_admin_bandeja_vistas.organization_id <> EXCLUDED.organization_id
        THEN EXCLUDED.vista_hasta
      ELSE GREATEST(public.casas_admin_bandeja_vistas.vista_hasta, EXCLUDED.vista_hasta)
    END,
    updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.casas_admin_nuevas_count()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.casas_admin_marcar_bandeja_vista(timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.casas_admin_nuevas_count()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.casas_admin_marcar_bandeja_vista(timestamptz)
  TO authenticated;
