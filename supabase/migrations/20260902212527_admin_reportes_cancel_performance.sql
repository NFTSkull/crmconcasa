-- ConCasa CRM — reportes Super Admin: performance de cohorte
-- Sin cambios de datos ni semántica. Optimiza el lookup de acciones de cancelación.

CREATE INDEX IF NOT EXISTS action_log_cancel_entity_created_idx
  ON public.action_log (entity_id, created_at)
  WHERE action ILIKE '%cancel%';

COMMENT ON INDEX public.action_log_cancel_entity_created_idx IS
  'Lookup parcial para cancelaciones en cohorte de reportes Super Admin.';
