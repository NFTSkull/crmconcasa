-- ConCasa CRM — P216: performance de cancelaciones para cohorte Super Admin
-- Sin cambios de datos ni semántica. La consulta vigente usa action ILIKE '%cancel%'.

CREATE INDEX IF NOT EXISTS action_log_cancel_entity_created_idx
  ON public.action_log (entity_id, created_at)
  WHERE action ILIKE '%cancel%';

COMMENT ON INDEX public.action_log_cancel_entity_created_idx IS
  'P216: lookup parcial para cancelaciones en cohorte de reportes Super Admin.';
