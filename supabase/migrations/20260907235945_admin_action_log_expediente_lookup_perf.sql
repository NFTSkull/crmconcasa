CREATE INDEX IF NOT EXISTS action_log_payload_expediente_created_idx
ON public.action_log ((payload->>'expediente_id'), created_at DESC, id DESC)
WHERE payload ? 'expediente_id';

COMMENT ON INDEX public.action_log_payload_expediente_created_idx IS
  'Perf Admin/Mesa: lookup de actividad por payload.expediente_id sin seq scan de action_log.';
