-- Reactivar Compra de casas para asesores de ConCasa.
-- Se restauran únicamente los permisos originales acotados al titular,
-- manteniendo la validación documental (INE titular y cónyuge si aplica),
-- el acceso exclusivo de Admin a ofertas y las políticas privadas de Storage.
-- Reversible mediante migración de pausa original 20261105174000.
-- NO toca expedientes, Mesa Control, precalificadora ni estados previos.

DROP POLICY IF EXISTS casas_solicitudes_read_admin_during_pause
 ON public.casas_solicitudes;

DROP POLICY IF EXISTS casas_solicitudes_read
 ON public.casas_solicitudes;
CREATE POLICY casas_solicitudes_read
 ON public.casas_solicitudes FOR SELECT TO authenticated
 USING (
  EXISTS (
   SELECT 1 FROM public.profiles p
   WHERE p.id=(SELECT auth.uid()) AND p.active
    AND p.organization_id=casas_solicitudes.organization_id
    AND (
      (p.app_role='asesor' AND casas_solicitudes.asesor_id=p.id)
      OR p.app_role='super_admin'
    )
  )
 );

DROP POLICY IF EXISTS casas_solicitudes_create_draft
 ON public.casas_solicitudes;
CREATE POLICY casas_solicitudes_create_draft
 ON public.casas_solicitudes FOR INSERT TO authenticated
 WITH CHECK (
  estado='borrador' AND enviada_at IS NULL
  AND revisada_at IS NULL AND revisada_por IS NULL
  AND oferta_mxn IS NULL AND motivo_rechazo IS NULL AND nota_admin IS NULL
  AND asesor_id=(SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=(SELECT auth.uid()) AND p.active AND p.app_role='asesor'
      AND p.organization_id=casas_solicitudes.organization_id
  )
 );

DROP POLICY IF EXISTS casas_fotos_add_draft ON public.casas_fotos;
CREATE POLICY casas_fotos_add_draft
 ON public.casas_fotos FOR INSERT TO authenticated
 WITH CHECK (
  uploaded_by=(SELECT auth.uid())
  AND EXISTS (
   SELECT 1 FROM public.casas_solicitudes s
   WHERE s.id=casas_fotos.solicitud_id AND s.estado='borrador'
    AND s.asesor_id=(SELECT auth.uid())
    AND casas_fotos.storage_path LIKE
      s.organization_id::text||'/'||s.id::text||'/%'
  )
 );

DROP POLICY IF EXISTS casas_fotos_delete_draft ON public.casas_fotos;
CREATE POLICY casas_fotos_delete_draft
 ON public.casas_fotos FOR DELETE TO authenticated
 USING (
  uploaded_by=(SELECT auth.uid())
  AND EXISTS (
   SELECT 1 FROM public.casas_solicitudes s
   WHERE s.id=casas_fotos.solicitud_id
    AND s.asesor_id=(SELECT auth.uid()) AND s.estado='borrador'
  )
 );

DROP POLICY IF EXISTS casas_storage_insert ON storage.objects;
CREATE POLICY casas_storage_insert
 ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (
  bucket_id='casas-fotos'
  AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  AND EXISTS (
   SELECT 1 FROM public.casas_solicitudes s
   WHERE s.id::text=split_part(name,'/',2)
    AND s.organization_id::text=split_part(name,'/',1)
    AND s.asesor_id=(SELECT auth.uid()) AND s.estado='borrador'
  )
 );

DROP POLICY IF EXISTS casas_storage_delete ON storage.objects;
CREATE POLICY casas_storage_delete
 ON storage.objects FOR DELETE TO authenticated
 USING (
  bucket_id='casas-fotos'
  AND EXISTS (
   SELECT 1 FROM public.casas_solicitudes s
   WHERE s.id::text=split_part(name,'/',2)
     AND s.organization_id::text=split_part(name,'/',1)
     AND s.asesor_id=(SELECT auth.uid()) AND s.estado='borrador'
  )
 );

-- El asesor puede crear SU borrador y gestionar fotos, pero jamás
-- actualizar directamente la oferta o el estado de la casa.
REVOKE ALL ON public.casas_solicitudes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.casas_solicitudes TO authenticated;

REVOKE ALL ON public.casas_fotos FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.casas_fotos TO authenticated;

-- El acceso a documentos privados ya está concedido con RLS por titular
-- en la migración 20261105190000. No se alteran permisos de otros buckets.
-- El envío y el selector de cónyuge solo mediante RPC verificadas.
GRANT EXECUTE ON FUNCTION public.casas_enviar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.casas_configurar_conyuge(uuid,boolean)
 TO authenticated;

COMMENT ON TABLE public.casas_solicitudes IS
 'Compra de casas habilitada para asesores activos de su organización; ofertas y rechazos solo mediante RPC de Admin.';
