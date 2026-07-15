-- ConCasa CRM — P073: cierre de EXECUTE de service_role sobre internas de reingreso
-- Contexto: en Cloud, ALTER DEFAULT PRIVILEGES otorga EXECUTE a service_role al
-- crear funciones; 072 revocó PUBLIC/anon/authenticated pero no service_role en
-- estas tres funciones internas. Son implementaciones internas de solo lectura y
-- no deben ser invocables directamente por ningún rol de aplicación.
-- Solo REVOKE (idempotente); sin cambios de cuerpo, firma, SECURITY DEFINER,
-- RLS, tablas ni grants de funciones públicas. No toca 071/072.

REVOKE ALL ON FUNCTION public.es_reingreso_post_biometricos_valido(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.reingreso_documentos_reutilizables()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.reingreso_post_biometricos_elegibilidad_interna(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
