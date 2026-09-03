-- ConCasa CRM — P216: edición segura de teléfono de casa desde Datos Generales.
-- Autoridad: expedientes.telefono_cliente.
-- No modifica cliente_datos, NSS, etapas, documentos, cobro ni agenda.

CREATE OR REPLACE FUNCTION public.asesor_actualizar_telefono_casa(
  p_expediente_id uuid,
  p_telefono_casa text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role public.app_role;
  v_org_id uuid;
  v_exp public.expedientes%ROWTYPE;
  v_telefono_nuevo text;
  v_telefono_anterior text;
  v_celular text;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: expediente fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: expediente no activo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: solo el asesor dueño puede editar'
      USING ERRCODE = '42501';
  END IF;

  v_telefono_nuevo := public.normalize_telefono_mexico(p_telefono_casa);
  IF v_telefono_nuevo IS NULL OR v_telefono_nuevo !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: TELEFONO_CASA_INVALIDO'
      USING ERRCODE = '22023';
  END IF;

  v_telefono_anterior := public.normalize_telefono_mexico(v_exp.telefono_cliente::text);

  -- No-op seguro: permite legacy aun si antes ya coincidía con el celular.
  IF v_telefono_anterior = v_telefono_nuevo THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'expediente_id', p_expediente_id,
      'telefono_casa', v_telefono_nuevo
    );
  END IF;

  SELECT public.normalize_telefono_mexico(cd.telefono_normalizado)
  INTO v_celular
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF v_celular ~ '^[0-9]{10}$' AND v_celular = v_telefono_nuevo THEN
    RAISE EXCEPTION 'asesor_actualizar_telefono_casa: CLIENTE_DATOS_CELULAR_IGUAL_TELEFONO_CASA'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.expedientes
  SET telefono_cliente = v_telefono_nuevo,
      updated_at = now()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.telefono_casa.actualizado',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'telefono_anterior_last4', CASE WHEN v_telefono_anterior IS NULL THEN NULL ELSE right(v_telefono_anterior, 4) END,
      'telefono_nuevo_last4', right(v_telefono_nuevo, 4)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'expediente_id', p_expediente_id,
    'telefono_casa', v_telefono_nuevo
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_actualizar_telefono_casa(uuid, text) IS
  'P216: permite al asesor dueño editar expedientes.telefono_cliente desde Datos Generales; bloquea igualdad con celular DG.';

REVOKE ALL ON FUNCTION public.asesor_actualizar_telefono_casa(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_actualizar_telefono_casa(uuid, text)
  TO authenticated, postgres, service_role;
