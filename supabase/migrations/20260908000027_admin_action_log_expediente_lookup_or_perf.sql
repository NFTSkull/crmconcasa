CREATE INDEX IF NOT EXISTS action_log_payload_expediente_lookup_idx
ON public.action_log ((payload->>'expediente_id'), created_at DESC, id DESC);

COMMENT ON INDEX public.action_log_payload_expediente_lookup_idx IS
  'Perf Admin: permite combinar lookup payload.expediente_id con entity_id en consultas OR.';
