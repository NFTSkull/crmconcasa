-- ConCasa CRM — P2C-1 auditoría base + historial documental
-- log_action para RPCs futuras; trigger documento_revisiones en UPDATE de documentos.

-- =============================================================================
-- A) log_action — escritura centralizada en action_log
-- =============================================================================
CREATE OR REPLACE FUNCTION public.log_action(
  p_organization_id UUID,
  p_actor_id UUID,
  p_actor_role public.app_role,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'log_action: organization_id es obligatorio';
  END IF;
  IF p_action IS NULL OR btrim(p_action) = '' THEN
    RAISE EXCEPTION 'log_action: action es obligatorio';
  END IF;
  IF p_entity_type IS NULL OR btrim(p_entity_type) = '' THEN
    RAISE EXCEPTION 'log_action: entity_type es obligatorio';
  END IF;
  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'log_action: entity_id es obligatorio';
  END IF;

  INSERT INTO public.action_log (
    organization_id,
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    payload
  ) VALUES (
    p_organization_id,
    p_actor_id,
    p_actor_role,
    p_action,
    p_entity_type,
    p_entity_id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_action(UUID, UUID, public.app_role, TEXT, TEXT, UUID, JSONB) IS
  'Inserta en action_log. Solo para RPCs SECURITY DEFINER; no exponer a authenticated.';

REVOKE ALL ON FUNCTION public.log_action(UUID, UUID, public.app_role, TEXT, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_action(UUID, UUID, public.app_role, TEXT, TEXT, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.log_action(UUID, UUID, public.app_role, TEXT, TEXT, UUID, JSONB) FROM authenticated;

-- service_role y postgres (owner) pueden invocar; RPCs definer del mismo owner también.
GRANT EXECUTE ON FUNCTION public.log_action(UUID, UUID, public.app_role, TEXT, TEXT, UUID, JSONB) TO service_role;

-- Denegar INSERT directo en action_log a roles de cliente (mutaciones vía log_action / RPC).
REVOKE INSERT ON TABLE public.action_log FROM anon;
REVOKE INSERT ON TABLE public.action_log FROM authenticated;

-- =============================================================================
-- B) Trigger historial documento_revisiones
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_expediente_documentos_revision_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.estatus_revision IS NOT DISTINCT FROM NEW.estatus_revision
     AND OLD.comentario_mesa IS NOT DISTINCT FROM NEW.comentario_mesa THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.documento_revisiones (
    organization_id,
    documento_id,
    expediente_id,
    estatus_anterior,
    estatus_nuevo,
    comentario_mesa,
    actor_id
  ) VALUES (
    NEW.organization_id,
    NEW.id,
    NEW.expediente_id,
    OLD.estatus_revision,
    NEW.estatus_revision,
    NEW.comentario_mesa,
    public.current_profile_id()
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_expediente_documentos_revision_history() IS
  'Registra historial en documento_revisiones cuando cambia estatus_revision o comentario_mesa.';

DROP TRIGGER IF EXISTS expediente_documentos_revision_history ON public.expediente_documentos;

CREATE TRIGGER expediente_documentos_revision_history
  AFTER UPDATE ON public.expediente_documentos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_expediente_documentos_revision_history();

-- Trigger inserta vía SECURITY DEFINER; clientes no escriben historial directo.
REVOKE INSERT ON TABLE public.documento_revisiones FROM anon;
REVOKE INSERT ON TABLE public.documento_revisiones FROM authenticated;

-- =============================================================================
-- C) Notas P2C-2
-- =============================================================================
-- INSERT/UPDATE en expediente_documentos seguirá bloqueado para authenticated
-- hasta RPC update_documento_revision y upload vía SECURITY DEFINER.
