-- Protege la convivencia con P166: si ya existen movimientos del nuevo flujo,
-- no se puede cerrar 11→12 por fuera de `registrar_pago_concasa`.
CREATE OR REPLACE FUNCTION public.__tg_pago_concasa_partial_finalization_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_movements BOOLEAN;
  v_has_liquidating_total BOOLEAN;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.etapa_actual IS DISTINCT FROM 11 OR NEW.etapa_actual IS DISTINCT FROM 12 THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.expediente_pagos_concasa p
    WHERE p.expediente_id = NEW.id
  ) INTO v_has_movements;

  IF NOT v_has_movements THEN
    -- Compatibilidad total con P166 histórico: sin movimientos nuevos, no intervenir.
    RETURN NEW;
  END IF;

  IF NEW.pago_concasa_resultado IS DISTINCT FROM 'pagado' THEN
    RAISE EXCEPTION
      'Pago a ConCasa: existen abonos registrados; no se puede cerrar como No pagó.'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.expediente_pagos_concasa p
    WHERE p.expediente_id = NEW.id
      AND p.tipo = 'total'
      AND p.saldo_despues = 0
  ) INTO v_has_liquidating_total;

  IF NOT v_has_liquidating_total THEN
    RAISE EXCEPTION
      'Pago a ConCasa: existen abonos; para cerrar debes liquidar el saldo con Pago total.'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_pago_concasa_partial_finalization_guard ON public.expedientes;
CREATE TRIGGER tg_pago_concasa_partial_finalization_guard
  BEFORE UPDATE OF etapa_actual, pago_concasa_resultado ON public.expedientes
  FOR EACH ROW
  EXECUTE FUNCTION public.__tg_pago_concasa_partial_finalization_guard();

COMMENT ON FUNCTION public.__tg_pago_concasa_partial_finalization_guard() IS
  'Si existen movimientos parciales/total nuevos, exige un movimiento total con saldo 0 antes de cerrar 11→12; P166 sin movimientos permanece intacto.';