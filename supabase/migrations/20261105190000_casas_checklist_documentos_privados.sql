-- ConCasa / Compra de casas: checklist documental de propietarios.
-- La operación de asesores permanece PAUSADA: no restaura accesos, menú,
-- permisos de creación/expedición ni ruta de asesores previamente desactivada.
-- Admin puede consultar cada documento como adjunto privado de una casa.
ALTER TABLE public.casas_solicitudes
  ADD COLUMN IF NOT EXISTS conyuge_aplica boolean;

CREATE TABLE IF NOT EXISTS public.casas_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id uuid NOT NULL REFERENCES public.casas_solicitudes(id) ON DELETE RESTRICT,
  tipo_documento text NOT NULL CHECK (tipo_documento IN ('escritura','estado_cuenta_infonavit','ine_titular','acta_nacimiento_titular','curp_titular','rfc_titular','acta_matrimonio','acta_divorcio','ine_conyuge','acta_nacimiento_conyuge','curp_conyuge','rfc_conyuge','predial','agua_drenaje','cfe','gas','factura_2014_calculo_impuesto')),
  storage_path text NOT NULL UNIQUE,
  nombre_archivo text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 12582912),
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT casas_documentos_storage_path_check CHECK (
    length(storage_path) <= 285
    AND storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$'
  )
);

CREATE INDEX IF NOT EXISTS casas_documentos_solicitud_tipo_idx
  ON public.casas_documentos(solicitud_id,tipo_documento,created_at DESC);

ALTER TABLE public.casas_documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY casas_documentos_read ON public.casas_documentos
FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.casas_solicitudes s
 WHERE s.id=casas_documentos.solicitud_id)
);

CREATE POLICY casas_documentos_upload_draft ON public.casas_documentos
FOR INSERT TO authenticated WITH CHECK (
 uploaded_by=(SELECT auth.uid())
 AND EXISTS (
  SELECT 1 FROM public.casas_solicitudes s
  WHERE s.id=casas_documentos.solicitud_id
   AND s.estado='borrador'
   AND s.asesor_id=(SELECT auth.uid())
   AND casas_documentos.storage_path LIKE
       s.organization_id::text||'/'||s.id::text||'/%'
 )
);

CREATE POLICY casas_documentos_delete_draft ON public.casas_documentos
FOR DELETE TO authenticated USING (
 uploaded_by=(SELECT auth.uid())
 AND EXISTS (
  SELECT 1 FROM public.casas_solicitudes s
  WHERE s.id=casas_documentos.solicitud_id
    AND s.estado='borrador'
    AND s.asesor_id=(SELECT auth.uid())
 )
);

REVOKE ALL ON TABLE public.casas_documentos FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON TABLE public.casas_documentos TO authenticated;

-- Evitar demasiados documentos para un mismo apartado, con bloqueo concurrente.
CREATE OR REPLACE FUNCTION public.casas_documentos_limit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count int;
BEGIN
 PERFORM 1 FROM public.casas_solicitudes s WHERE s.id=NEW.solicitud_id FOR UPDATE;
 SELECT count(*) INTO v_count FROM public.casas_documentos
 WHERE solicitud_id=NEW.solicitud_id AND tipo_documento=NEW.tipo_documento;
 IF v_count >= 4 THEN
  RAISE EXCEPTION 'Máximo 4 archivos por tipo de documento';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS casas_documentos_limit ON public.casas_documentos;
CREATE TRIGGER casas_documentos_limit
  BEFORE INSERT ON public.casas_documentos
  FOR EACH ROW EXECUTE FUNCTION public.casas_documentos_limit_guard();
REVOKE ALL ON FUNCTION public.casas_documentos_limit_guard() FROM PUBLIC,anon,authenticated;

-- Documentos privados: nunca publicURL. Se accede con sesión y URL firmada.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES (
 'casas-documentos','casas-documentos',false,12582912,
 ARRAY['application/pdf','image/jpeg','image/png','image/webp']
)
ON CONFLICT(id) DO NOTHING;

CREATE POLICY casas_documentos_storage_read ON storage.objects
FOR SELECT TO authenticated USING (
 bucket_id='casas-documentos'
 AND EXISTS (
  SELECT 1 FROM public.casas_solicitudes s
  WHERE s.id::text=split_part(name,'/',2)
    AND s.organization_id::text=split_part(name,'/',1)
 )
);

CREATE POLICY casas_documentos_storage_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
 bucket_id='casas-documentos'
 AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$'
 AND EXISTS (
  SELECT 1 FROM public.casas_solicitudes s
  WHERE s.id::text=split_part(name,'/',2)
    AND s.organization_id::text=split_part(name,'/',1)
    AND s.asesor_id=(SELECT auth.uid()) AND s.estado='borrador'
 )
);

CREATE POLICY casas_documentos_storage_delete ON storage.objects
FOR DELETE TO authenticated USING (
 bucket_id='casas-documentos'
 AND EXISTS (
  SELECT 1 FROM public.casas_solicitudes s
  WHERE s.id::text=split_part(name,'/',2)
    AND s.organization_id::text=split_part(name,'/',1)
    AND s.asesor_id=(SELECT auth.uid()) AND s.estado='borrador'
 )
);

-- Permite corregir la condición del cónyuge solo mientras sea borrador.
-- Durante la pausa de asesores se conserva SIN EXECUTE para authenticated.
CREATE OR REPLACE FUNCTION public.casas_configurar_conyuge(
 p_solicitud_id uuid,p_conyuge_aplica boolean
) RETURNS public.casas_solicitudes
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_casa public.casas_solicitudes%ROWTYPE;
BEGIN
 IF v_actor IS NULL THEN
   RAISE EXCEPTION 'Sesión requerida' USING ERRCODE='42501';
 END IF;
 SELECT s.* INTO v_casa FROM public.casas_solicitudes s
 JOIN public.profiles p ON p.id=v_actor
 WHERE s.id=p_solicitud_id AND s.asesor_id=v_actor
  AND p.active AND p.app_role='asesor'
  AND p.organization_id=s.organization_id
 FOR UPDATE OF s;
 IF NOT FOUND OR v_casa.estado <> 'borrador' THEN
  RAISE EXCEPTION 'Solo el asesor titular puede editar un borrador'
    USING ERRCODE='42501';
 END IF;
 UPDATE public.casas_solicitudes
  SET conyuge_aplica=p_conyuge_aplica
  WHERE id=v_casa.id RETURNING * INTO v_casa;
 RETURN v_casa;
END $$;
REVOKE ALL ON FUNCTION public.casas_configurar_conyuge(uuid,boolean)
 FROM PUBLIC,anon,authenticated;

-- El envío existente sigue INHABILITADO por los GRANT de la pausa.
-- Cuando se reactive, INE titular y (si aplica) INE cónyuge son los 2 controles.
CREATE OR REPLACE FUNCTION public.casas_enviar(p_solicitud_id uuid)
RETURNS public.casas_solicitudes LANGUAGE plpgsql
SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_row public.casas_solicitudes%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sesión requerida' USING ERRCODE='42501';
  END IF;
  SELECT s.* INTO v_row FROM public.casas_solicitudes s
  JOIN public.profiles p ON p.id=v_actor
  WHERE s.id=p_solicitud_id AND s.asesor_id=v_actor
    AND p.active AND p.app_role='asesor'
    AND p.organization_id=s.organization_id
  FOR UPDATE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Casa no encontrada o sin permiso' USING ERRCODE='42501';
  END IF;
  IF v_row.estado<>'borrador' THEN
    RAISE EXCEPTION 'La casa ya fue enviada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.casas_documentos d
    WHERE d.solicitud_id=v_row.id AND d.tipo_documento='ine_titular'
  ) THEN
    RAISE EXCEPTION 'Para enviar a Admin, agrega la INE del titular';
  END IF;
  IF v_row.conyuge_aplica IS TRUE AND NOT EXISTS (
    SELECT 1 FROM public.casas_documentos d
    WHERE d.solicitud_id=v_row.id AND d.tipo_documento='ine_conyuge'
  ) THEN
    RAISE EXCEPTION 'Falta la INE del cónyuge porque marcaste que aplica';
  END IF;
  UPDATE public.casas_solicitudes
   SET estado='enviada',enviada_at=now()
  WHERE id=v_row.id RETURNING * INTO v_row;
  INSERT INTO public.casas_historial(solicitud_id,accion,actor_id)
   VALUES (v_row.id,'envio',v_actor);
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.casas_enviar(uuid) FROM PUBLIC,anon,authenticated;
