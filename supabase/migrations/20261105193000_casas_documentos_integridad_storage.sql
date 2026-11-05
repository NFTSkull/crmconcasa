-- Compra de casas: no permitir referencias ficticias a archivos.
-- Este endurecimiento es aditivo y NO reactiva los permisos del asesor.
CREATE OR REPLACE FUNCTION public.casas_documentos_validar_storage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM storage.objects o
   WHERE o.bucket_id='casas-documentos' AND o.name=NEW.storage_path
 ) THEN
   RAISE EXCEPTION 'El documento no existe en el almacenamiento privado';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS casas_documentos_storage_referenciado ON public.casas_documentos;
CREATE TRIGGER casas_documentos_storage_referenciado
 BEFORE INSERT OR UPDATE OF storage_path ON public.casas_documentos
 FOR EACH ROW EXECUTE FUNCTION public.casas_documentos_validar_storage();
REVOKE ALL ON FUNCTION public.casas_documentos_validar_storage() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.casas_validar_ines_envio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.estado='borrador' AND NEW.estado='enviada' THEN
   IF NOT EXISTS (
     SELECT 1 FROM public.casas_documentos d
     JOIN storage.objects o ON o.bucket_id='casas-documentos'
       AND o.name=d.storage_path
     WHERE d.solicitud_id=NEW.id AND d.tipo_documento='ine_titular'
   ) THEN
     RAISE EXCEPTION 'No se puede enviar sin archivo real de INE del titular';
   END IF;
   IF NEW.conyuge_aplica IS TRUE AND NOT EXISTS (
     SELECT 1 FROM public.casas_documentos d
     JOIN storage.objects o ON o.bucket_id='casas-documentos'
       AND o.name=d.storage_path
     WHERE d.solicitud_id=NEW.id AND d.tipo_documento='ine_conyuge'
   ) THEN
     RAISE EXCEPTION 'Falta archivo real de INE del cónyuge';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS casas_validar_ines_envio_trigger ON public.casas_solicitudes;
CREATE TRIGGER casas_validar_ines_envio_trigger
 BEFORE UPDATE OF estado ON public.casas_solicitudes
 FOR EACH ROW EXECUTE FUNCTION public.casas_validar_ines_envio();
REVOKE ALL ON FUNCTION public.casas_validar_ines_envio() FROM PUBLIC,anon,authenticated;
