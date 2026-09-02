-- ConCasa CRM — P215: performance segura para reportes Super Admin
-- Sin cambios de datos ni semántica. Optimiza el lookup histórico de rechazos operativos.

CREATE INDEX IF NOT EXISTS action_log_rechazo_operativo_entity_created_idx
  ON public.action_log (entity_id, created_at)
  WHERE action = 'expediente.rechazo_operativo';

COMMENT ON INDEX public.action_log_rechazo_operativo_entity_created_idx IS
  'P215: lookup parcial para clasificación de rechazos en reportes históricos Super Admin.';
