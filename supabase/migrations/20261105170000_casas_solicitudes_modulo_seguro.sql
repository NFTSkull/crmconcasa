-- ConCasa: módulo independiente de Compra de Casas (sin Mesa/Mejoravit).
-- Seguridad: datos e imágenes privados, RLS por organización/asesor,
-- cambios de estado exclusivamente mediante RPC validados.
CREATE TABLE IF NOT EXISTS public.casas_solicitudes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  asesor_id uuid NOT NULL REFERENCES public.profiles(id),
  estado text NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','enviada','ofertada','rechazada')),
  nombre_contacto text,
  telefono_contacto text,
  municipio text,
  colonia text,
  direccion text,
  tipo_inmueble text,
  situacion_inmueble text,
  adeudo_tipo text,
  adeudo_aproximado_mxn numeric(14,2) CHECK (adeudo_aproximado_mxn >= 0),
  precio_esperado_mxn numeric(14,2) CHECK (precio_esperado_mxn >= 0),
  comentarios text,
  oferta_mxn numeric(14,2) CHECK (oferta_mxn > 0),
  motivo_rechazo text,
  nota_admin text,
  enviada_at timestamptz,
  revisada_at timestamptz,
  revisada_por uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT casas_admin_resultado_consistente CHECK (
    (estado='ofertada' AND oferta_mxn IS NOT NULL AND motivo_rechazo IS NULL)
    OR (estado='rechazada' AND motivo_rechazo IS NOT NULL AND oferta_mxn IS NULL)
    OR (estado IN ('borrador','enviada') AND oferta_mxn IS NULL AND motivo_rechazo IS NULL)
  ),
  CONSTRAINT casas_envio_consistente CHECK (
    (estado='borrador' AND enviada_at IS NULL)
    OR (estado<>'borrador' AND enviada_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS casas_solicitudes_asesor_idx
 ON public.casas_solicitudes(asesor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS casas_solicitudes_admin_idx
 ON public.casas_solicitudes(organization_id,estado,enviada_at DESC);

CREATE TABLE IF NOT EXISTS public.casas_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id uuid NOT NULL REFERENCES public.casas_solicitudes(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE,
  nombre_archivo text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes>0 AND size_bytes<=10485760),
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT casas_fotos_path_seguro CHECK (length(storage_path)<=280 AND storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
);
CREATE INDEX IF NOT EXISTS casas_fotos_solicitud_idx
 ON public.casas_fotos(solicitud_id,created_at);

CREATE TABLE IF NOT EXISTS public.casas_historial (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  solicitud_id uuid NOT NULL REFERENCES public.casas_solicitudes(id) ON DELETE RESTRICT,
  accion text NOT NULL CHECK (accion IN ('envio','oferta','rechazo')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  monto_mxn numeric(14,2),
  nota text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS casas_historial_solicitud_idx
 ON public.casas_historial(solicitud_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.casas_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS casas_solicitudes_updated ON public.casas_solicitudes;
CREATE TRIGGER casas_solicitudes_updated BEFORE UPDATE ON public.casas_solicitudes
FOR EACH ROW EXECUTE FUNCTION public.casas_updated_at();

ALTER TABLE public.casas_solicitudes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casas_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casas_historial ENABLE ROW LEVEL SECURITY;

-- El perfil se consulta desde base, nunca desde user_metadata ni desde el navegador.
CREATE POLICY casas_solicitudes_read ON public.casas_solicitudes
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id=(SELECT auth.uid()) AND p.active
    AND p.organization_id=casas_solicitudes.organization_id
    AND (
      (p.app_role='asesor' AND casas_solicitudes.asesor_id=p.id)
      OR p.app_role='super_admin'
    ))
);
CREATE POLICY casas_solicitudes_create_draft ON public.casas_solicitudes
FOR INSERT TO authenticated WITH CHECK (
  estado='borrador' AND enviada_at IS NULL AND revisada_at IS NULL
  AND revisada_por IS NULL AND oferta_mxn IS NULL AND motivo_rechazo IS NULL
  AND asesor_id=(SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id=(SELECT auth.uid()) AND p.active AND p.app_role='asesor'
    AND p.organization_id=casas_solicitudes.organization_id)
);
-- No otorgar UPDATE/DELETE de solicitudes al cliente.
-- Solo la funciones de envío y respuesta pueden cambiar estado.

CREATE POLICY casas_fotos_read ON public.casas_fotos
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.casas_solicitudes s WHERE s.id=casas_fotos.solicitud_id)
);
CREATE POLICY casas_fotos_add_draft ON public.casas_fotos
FOR INSERT TO authenticated WITH CHECK (
  uploaded_by=(SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.casas_solicitudes s
    WHERE s.id=casas_fotos.solicitud_id AND s.estado='borrador'
      AND s.asesor_id=(SELECT auth.uid())
      AND casas_fotos.storage_path LIKE s.organization_id::text||'/'||s.id::text||'/%'
  )
);
CREATE POLICY casas_fotos_delete_draft ON public.casas_fotos
FOR DELETE TO authenticated USING (
  uploaded_by=(SELECT auth.uid()) AND EXISTS(
    SELECT 1 FROM public.casas_solicitudes s WHERE s.id=casas_fotos.solicitud_id
    AND s.asesor_id=(SELECT auth.uid()) AND s.estado='borrador'
  )
);

CREATE POLICY casas_historial_read ON public.casas_historial
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.casas_solicitudes s WHERE s.id=casas_historial.solicitud_id)
);

-- Máximo 12 archivos registrados por casa, con bloqueo de la fila padre.
CREATE OR REPLACE FUNCTION public.casas_foto_limit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  PERFORM 1 FROM public.casas_solicitudes WHERE id=NEW.solicitud_id FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.casas_fotos WHERE solicitud_id=NEW.solicitud_id;
  IF v_count>=12 THEN RAISE EXCEPTION 'Máximo 12 fotos por propiedad'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS casas_foto_limit ON public.casas_fotos;
CREATE TRIGGER casas_foto_limit BEFORE INSERT ON public.casas_fotos
FOR EACH ROW EXECUTE FUNCTION public.casas_foto_limit_guard();
REVOKE ALL ON FUNCTION public.casas_foto_limit_guard() FROM PUBLIC;

-- Envío al administrador, NO a Mesa Control.
CREATE OR REPLACE FUNCTION public.casas_enviar(p_solicitud_id uuid)
RETURNS public.casas_solicitudes LANGUAGE plpgsql
SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_row public.casas_solicitudes%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesión requerida' USING ERRCODE='42501'; END IF;
  SELECT s.* INTO v_row FROM public.casas_solicitudes s
  JOIN public.profiles p ON p.id=v_actor
  WHERE s.id=p_solicitud_id AND s.asesor_id=v_actor
    AND p.active AND p.app_role='asesor'
    AND p.organization_id=s.organization_id
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Casa no encontrada o sin permiso' USING ERRCODE='42501'; END IF;
  IF v_row.estado<>'borrador' THEN RAISE EXCEPTION 'La casa ya fue enviada'; END IF;
  UPDATE public.casas_solicitudes SET estado='enviada',enviada_at=now()
   WHERE id=v_row.id RETURNING * INTO v_row;
  INSERT INTO public.casas_historial(solicitud_id,accion,actor_id)
   VALUES (v_row.id,'envio',v_actor);
  RETURN v_row;
END $$;

-- Administración: decisión auditable y visible al asesor titular.
CREATE OR REPLACE FUNCTION public.casas_responder(
 p_solicitud_id uuid,p_accion text,p_monto_mxn numeric DEFAULT NULL,
 p_motivo text DEFAULT NULL,p_nota text DEFAULT NULL
) RETURNS public.casas_solicitudes LANGUAGE plpgsql
SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_row public.casas_solicitudes%ROWTYPE;
BEGIN
 IF v_actor IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id=v_actor AND p.active
    AND p.app_role='super_admin'
 ) THEN RAISE EXCEPTION 'Solo el administrador puede responder' USING ERRCODE='42501'; END IF;
 SELECT s.* INTO v_row FROM public.casas_solicitudes s
 JOIN public.profiles p ON p.id=v_actor
 WHERE s.id=p_solicitud_id AND p.active AND p.app_role='super_admin'
   AND s.organization_id=p.organization_id
 FOR UPDATE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'Casa no encontrada o sin permiso' USING ERRCODE='42501'; END IF;
 IF v_row.estado NOT IN ('enviada','ofertada','rechazada') THEN
  RAISE EXCEPTION 'Primero debe enviarse la casa al administrador';
 END IF;
 IF p_accion='oferta' THEN
  IF p_monto_mxn IS NULL OR p_monto_mxn<=0 OR p_monto_mxn>999999999999.99 THEN
   RAISE EXCEPTION 'Ingresa una oferta válida mayor que cero';
  END IF;
  UPDATE public.casas_solicitudes
   SET estado='ofertada',oferta_mxn=round(p_monto_mxn,2),
      motivo_rechazo=NULL,nota_admin=NULLIF(btrim(left(coalesce(p_nota,''),2000)),''),
      revisada_at=now(),revisada_por=v_actor
   WHERE id=v_row.id RETURNING * INTO v_row;
  INSERT INTO public.casas_historial(solicitud_id,accion,actor_id,monto_mxn,nota)
   VALUES(v_row.id,'oferta',v_actor,v_row.oferta_mxn,v_row.nota_admin);
 ELSIF p_accion='rechazo' THEN
  IF btrim(coalesce(p_motivo,''))='' OR length(p_motivo)>2000 THEN
   RAISE EXCEPTION 'El motivo de rechazo es obligatorio (máximo 2000 caracteres)';
  END IF;
  UPDATE public.casas_solicitudes
   SET estado='rechazada',oferta_mxn=NULL,motivo_rechazo=btrim(p_motivo),
      nota_admin=NULL, revisada_at=now(),revisada_por=v_actor
   WHERE id=v_row.id RETURNING * INTO v_row;
  INSERT INTO public.casas_historial(solicitud_id,accion,actor_id,nota)
   VALUES(v_row.id,'rechazo',v_actor,v_row.motivo_rechazo);
 ELSE
  RAISE EXCEPTION 'Acción inválida';
 END IF;
 RETURN v_row;
END $$;

REVOKE ALL ON TABLE public.casas_solicitudes,public.casas_fotos,public.casas_historial FROM PUBLIC,anon;
GRANT SELECT,INSERT ON public.casas_solicitudes TO authenticated;
GRANT SELECT,INSERT,DELETE ON public.casas_fotos TO authenticated;
GRANT SELECT ON public.casas_historial TO authenticated;
REVOKE ALL ON FUNCTION public.casas_enviar(uuid),
 public.casas_responder(uuid,text,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.casas_enviar(uuid),
 public.casas_responder(uuid,text,numeric,text,text) TO authenticated;

-- Bucket privado con MIME de imágenes; no exponer URLs públicas.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('casas-fotos','casas-fotos',false,10485760,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY casas_storage_read ON storage.objects
FOR SELECT TO authenticated USING (
 bucket_id='casas-fotos' AND EXISTS(
  SELECT 1 FROM public.casas_solicitudes s
  WHERE s.id::text=split_part(name,'/',2)
    AND s.organization_id::text=split_part(name,'/',1)
 )
);
CREATE POLICY casas_storage_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
 bucket_id='casas-fotos'
 AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
 AND EXISTS (
  SELECT 1 FROM public.casas_solicitudes s
  WHERE s.id::text=split_part(name,'/',2)
    AND s.organization_id::text=split_part(name,'/',1)
    AND s.asesor_id=(SELECT auth.uid()) AND s.estado='borrador'
 )
);
CREATE POLICY casas_storage_delete ON storage.objects
FOR DELETE TO authenticated USING (
 bucket_id='casas-fotos' AND EXISTS(
  SELECT 1 FROM public.casas_solicitudes s
  WHERE s.id::text=split_part(name,'/',2)
    AND s.organization_id::text=split_part(name,'/',1)
    AND s.asesor_id=(SELECT auth.uid()) AND s.estado='borrador'
 )
);
