-- ConCasa 2026-11-05 · Pausa temporal Compra de casas para asesores.
-- No se eliminan tablas, fotos, solicitudes, historial ni la vista Admin.
-- Reactivación: nueva migración que restaure las políticas/grants desde
-- 20261105170000_casas_solicitudes_modulo_seguro.sql y retire el bloqueo UI.
DROP POLICY IF EXISTS casas_solicitudes_create_draft ON public.casas_solicitudes;
DROP POLICY IF EXISTS casas_solicitudes_read ON public.casas_solicitudes;
CREATE POLICY casas_solicitudes_read_admin_during_pause
 ON public.casas_solicitudes FOR SELECT TO authenticated
 USING (EXISTS (
   SELECT 1 FROM public.profiles p
   WHERE p.id=(SELECT auth.uid()) AND p.active
     AND p.app_role='super_admin'
     AND p.organization_id=casas_solicitudes.organization_id
 ));
DROP POLICY IF EXISTS casas_fotos_add_draft ON public.casas_fotos;
DROP POLICY IF EXISTS casas_fotos_delete_draft ON public.casas_fotos;
DROP POLICY IF EXISTS casas_storage_insert ON storage.objects;
DROP POLICY IF EXISTS casas_storage_delete ON storage.objects;
-- Permisos explícitos: una ruta antigua o un cliente externo no pueden continuar.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.casas_solicitudes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.casas_fotos FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.casas_enviar(uuid) FROM authenticated;
COMMENT ON TABLE public.casas_solicitudes IS
 'Compra de casas: pausada temporalmente para asesores desde 2026-11-05; admin conserva consulta y respuestas. No borrar datos.';
