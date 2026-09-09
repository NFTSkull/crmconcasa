-- ConCasa CRM — Alta NSS-only para asesores externos.
--
-- Objetivo:
-- - El asesor externo captura únicamente NSS.
-- - El programa técnico de un NSS NUEVO se fija en Mejoravit.
-- - Nombre/teléfono quedan en valores transitorios hasta Datos Generales.
-- - `create_expediente` sigue siendo la única implementación de alta; este RPC
--   es un wrapper autorizado únicamente para profiles.tipo_asesor_origen=externo.
-- - No modifica expedientes existentes ni reglas de envío a Mesa.

CREATE OR REPLACE FUNCTION public.create_expediente_externo_nss(
  p_nss text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_role public.app_role;
  v_origen public.tipo_asesor_origen;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'create_expediente_externo_nss: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.tipo_asesor_origen
  INTO v_role, v_origen
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_expediente_externo_nss: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'asesor'::public.app_role
     OR v_origen <> 'externo'::public.tipo_asesor_origen THEN
    RAISE EXCEPTION 'create_expediente_externo_nss: solo disponible para asesores externos'
      USING ERRCODE = '42501';
  END IF;

  -- `create_expediente` conserva todos los gates existentes: NSS válido,
  -- bloqueo por NSS/programa ya enviado a Mesa, origen desde profile, editor
  -- pendiente, action_log y ciclo/etapa iniciales.
  RETURN public.create_expediente(
    'mejoravit'::public.programa,
    p_nss,
    'POR CAPTURAR',
    '0000000000',
    ''
  );
END;
$$;

COMMENT ON FUNCTION public.create_expediente_externo_nss(text) IS
  'Alta simplificada para asesor externo: recibe solo NSS; nuevo expediente técnico Mejoravit, nombre/teléfono transitorios hasta Datos Generales.';

REVOKE ALL ON FUNCTION public.create_expediente_externo_nss(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expediente_externo_nss(text)
  TO authenticated, postgres, service_role;
