-- ConCasa CRM — Anette Perez: origen externo en Mesa
-- Cambio mínimo: perfil de Anette + sus expedientes existentes pasan a externo.
-- No toca otros asesores ni otros datos del expediente.

DO $$
DECLARE
  v_anette_id uuid;
  v_count integer;
BEGIN
  SELECT p.id
  INTO v_anette_id
  FROM public.profiles p
  WHERE lower(btrim(p.email)) = 'anette.perez@concasa.mx'
    AND p.active = true
    AND p.app_role = 'asesor';

  IF v_anette_id IS NULL THEN
    RAISE EXCEPTION 'Anette Perez activa/asesor no encontrada';
  END IF;

  UPDATE public.profiles
  SET tipo_asesor_origen = 'externo'::public.tipo_asesor_origen,
      updated_at = now()
  WHERE id = v_anette_id
    AND tipo_asesor_origen IS DISTINCT FROM 'externo'::public.tipo_asesor_origen;

  UPDATE public.expedientes
  SET origen_mesa = 'externo'::public.origen_mesa,
      updated_at = now()
  WHERE asesor_id = v_anette_id
    AND origen_mesa IS DISTINCT FROM 'externo'::public.origen_mesa;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Anette Perez expedientes actualizados a externo=%', v_count;
END;
$$;
