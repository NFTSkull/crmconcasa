-- El trigger de integridad de Datos Generales corre como invocador y llama este helper.
-- Exponer solo el booleano de pertenencia al equipo permite que el trigger funcione
-- para authenticated sin abrir tablas ni mutaciones.
REVOKE ALL ON FUNCTION public.asesor_es_equipo_silvia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_es_equipo_silvia(uuid)
  TO authenticated, service_role;
