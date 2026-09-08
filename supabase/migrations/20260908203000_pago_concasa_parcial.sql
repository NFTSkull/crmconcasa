-- ConCasa CRM — Pago a ConCasa total/parcial con historial append-only.
-- Aditivo: conserva P166 (`decidir_pago_concasa`) y todos los expedientes históricos.
-- Un pago parcial NO avanza etapa. Un pago total liquida el saldo y usa P166 para 11→12.

CREATE TABLE IF NOT EXISTS public.expediente_pago_concasa_cuentas (
  expediente_id UUID PRIMARY KEY
    REFERENCES public.expedientes(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  monto_base NUMERIC(12,2) NOT NULL CHECK (monto_base > 0),
  monto_fuente TEXT NOT NULL CHECK (monto_fuente IN ('mesa_actualizado', 'datos_generales')),
  porcentaje_cobro NUMERIC(5,2) NOT NULL CHECK (porcentaje_cobro > 0 AND porcentaje_cobro <= 100),
  monto_objetivo NUMERIC(12,2) NOT NULL CHECK (monto_objetivo > 0),
  created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.expediente_pago_concasa_cuentas IS
  'Congela el total esperado de Pago a ConCasa al registrar el primer movimiento parcial/total.';

CREATE TABLE IF NOT EXISTS public.expediente_pagos_concasa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL
    REFERENCES public.expedientes(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN ('parcial', 'total')),
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  notas TEXT NULL CHECK (notas IS NULL OR char_length(notas) <= 2000),
  monto_objetivo_snapshot NUMERIC(12,2) NOT NULL CHECK (monto_objetivo_snapshot > 0),
  acumulado_antes NUMERIC(12,2) NOT NULL CHECK (acumulado_antes >= 0),
  saldo_despues NUMERIC(12,2) NOT NULL CHECK (saldo_despues >= 0),
  actor_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT expediente_pagos_concasa_parcial_notas_chk
    CHECK (tipo <> 'parcial' OR length(btrim(COALESCE(notas, ''))) > 0)
);

COMMENT ON TABLE public.expediente_pagos_concasa IS
  'Historial append-only de movimientos Pago a ConCasa. Parcial exige notas; total liquida saldo.';

CREATE INDEX IF NOT EXISTS expediente_pagos_concasa_exp_at_idx
  ON public.expediente_pagos_concasa (expediente_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS expediente_pagos_concasa_org_at_idx
  ON public.expediente_pagos_concasa (organization_id, created_at DESC);

ALTER TABLE public.expediente_pago_concasa_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expediente_pagos_concasa ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.expediente_pago_concasa_cuentas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.expediente_pagos_concasa FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.expediente_pago_concasa_cuentas TO postgres, service_role;
GRANT ALL ON TABLE public.expediente_pagos_concasa TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- Estado/read-model Mesa: total, acumulado, saldo e historial.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pago_concasa_estado(p_expediente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp RECORD;
  v_cuenta public.expediente_pago_concasa_cuentas%ROWTYPE;
  v_cd public.cliente_datos%ROWTYPE;
  v_resolved RECORD;
  v_objetivo NUMERIC(12,2);
  v_total_pagado NUMERIC(12,2) := 0;
  v_saldo NUMERIC(12,2);
  v_movimientos JSONB := '[]'::JSONB;
  v_legacy BOOLEAN := false;
  v_reconocido RECORD;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'pago_concasa_estado: usuario no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'pago_concasa_estado: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT e.id, e.organization_id, e.etapa_actual, e.subestado, e.ciclo_estado,
         e.submitted_to_mesa, e.pago_concasa_resultado, e.pago_concasa_at, e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'pago_concasa_estado: expediente no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org AND v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'pago_concasa_estado: expediente fuera de organización' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cuenta
  FROM public.expediente_pago_concasa_cuentas c
  WHERE c.expediente_id = p_expediente_id;

  IF FOUND THEN
    v_objetivo := v_cuenta.monto_objetivo;
  ELSE
    -- Para P166 histórico pagado, preferir el snapshot real ya reconocido.
    SELECT r.ingreso_real, r.monto_base, r.monto_fuente, r.porcentaje_cobro
    INTO v_reconocido
    FROM public.expediente_ingresos_reconocidos r
    WHERE r.expediente_id = p_expediente_id;

    IF FOUND AND v_reconocido.ingreso_real IS NOT NULL AND v_reconocido.ingreso_real > 0 THEN
      v_objetivo := round(v_reconocido.ingreso_real, 2);
    ELSE
      SELECT cd.* INTO v_cd
      FROM public.cliente_datos cd
      WHERE cd.expediente_id = p_expediente_id;

      IF FOUND THEN
        SELECT * INTO v_resolved
        FROM public.ingresos_resolve_monto_base(
          v_cd.monto_mejoravit_actualizado,
          COALESCE(v_cd.datos, '{}'::JSONB)
        );
        IF v_resolved.monto_base IS NOT NULL
           AND v_cd.porcentaje_cobro IS NOT NULL
           AND v_cd.porcentaje_cobro > 0 THEN
          v_objetivo := public.ingresos_calc_ingreso(
            v_resolved.monto_base,
            v_cd.porcentaje_cobro
          )::NUMERIC(12,2);
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT COALESCE(round(sum(pg.monto), 2), 0)::NUMERIC(12,2)
  INTO v_total_pagado
  FROM public.expediente_pagos_concasa pg
  WHERE pg.expediente_id = p_expediente_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'tipo', x.tipo,
        'monto', x.monto,
        'notas', x.notas,
        'monto_objetivo_snapshot', x.monto_objetivo_snapshot,
        'acumulado_antes', x.acumulado_antes,
        'saldo_despues', x.saldo_despues,
        'actor_id', x.actor_id,
        'actor_nombre', x.actor_nombre,
        'actor_email', x.actor_email,
        'created_at', x.created_at
      )
      ORDER BY x.created_at DESC, x.id DESC
    ),
    '[]'::JSONB
  )
  INTO v_movimientos
  FROM (
    SELECT pg.*,
           NULLIF(btrim(COALESCE(p.full_name, '')), '') AS actor_nombre,
           NULLIF(btrim(COALESCE(p.email, '')), '') AS actor_email
    FROM public.expediente_pagos_concasa pg
    LEFT JOIN public.profiles p ON p.id = pg.actor_id
    WHERE pg.expediente_id = p_expediente_id
  ) x;

  -- Compatibilidad: un P166 histórico pagado sin movimientos representa pago total legado.
  IF v_exp.etapa_actual = 12
     AND v_exp.pago_concasa_resultado = 'pagado'
     AND jsonb_array_length(v_movimientos) = 0
     AND v_objetivo IS NOT NULL THEN
    v_total_pagado := v_objetivo;
    v_legacy := true;
  END IF;

  v_saldo := CASE
    WHEN v_objetivo IS NULL THEN NULL
    ELSE greatest(round(v_objetivo - v_total_pagado, 2), 0)::NUMERIC(12,2)
  END;

  RETURN jsonb_build_object(
    'expediente_id', p_expediente_id,
    'etapa_actual', v_exp.etapa_actual,
    'resultado_final', v_exp.pago_concasa_resultado,
    'resultado_at', v_exp.pago_concasa_at,
    'monto_objetivo', v_objetivo,
    'pagado_acumulado', v_total_pagado,
    'saldo_pendiente', v_saldo,
    'puede_registrar',
      v_exp.etapa_actual = 11
      AND v_exp.subestado = 'en_proceso'
      AND v_exp.ciclo_estado = 'activo'
      AND v_exp.submitted_to_mesa IS TRUE
      AND v_exp.pago_concasa_resultado IS NULL
      AND v_objetivo IS NOT NULL
      AND v_objetivo > 0,
    'finalizado', v_exp.etapa_actual = 12 AND v_exp.pago_concasa_resultado = 'pagado',
    'legacy', v_legacy,
    'movimientos', v_movimientos
  );
END;
$$;

COMMENT ON FUNCTION public.pago_concasa_estado(UUID) IS
  'Mesa RO: total objetivo, acumulado, saldo e historial de pagos ConCasa; compatible con P166 legado.';

REVOKE ALL ON FUNCTION public.pago_concasa_estado(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pago_concasa_estado(UUID)
  TO authenticated, service_role, postgres;

-- ---------------------------------------------------------------------------
-- Escritura canónica de movimiento parcial/total.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_pago_concasa(
  p_expediente_id UUID,
  p_tipo TEXT,
  p_monto NUMERIC DEFAULT NULL,
  p_notas TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_notas TEXT;
  v_cd public.cliente_datos%ROWTYPE;
  v_resolved RECORD;
  v_cuenta public.expediente_pago_concasa_cuentas%ROWTYPE;
  v_objetivo NUMERIC(12,2);
  v_pagado NUMERIC(12,2) := 0;
  v_saldo NUMERIC(12,2);
  v_monto NUMERIC(12,2);
  v_saldo_despues NUMERIC(12,2);
  v_movimiento_id UUID;
  v_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'registrar_pago_concasa: usuario no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'registrar_pago_concasa: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  v_tipo := lower(btrim(COALESCE(p_tipo, '')));
  IF v_tipo NOT IN ('parcial', 'total') THEN
    RAISE EXCEPTION 'registrar_pago_concasa: tipo inválido (use parcial|total)' USING ERRCODE = '22023';
  END IF;

  v_notas := NULLIF(btrim(COALESCE(p_notas, '')), '');
  IF v_notas IS NOT NULL AND char_length(v_notas) > 2000 THEN
    RAISE EXCEPTION 'registrar_pago_concasa: las notas no pueden exceder 2000 caracteres' USING ERRCODE = '22023';
  END IF;
  IF v_tipo = 'parcial' AND v_notas IS NULL THEN
    RAISE EXCEPTION 'registrar_pago_concasa: las notas son obligatorias para pago parcial' USING ERRCODE = '22023';
  END IF;

  SELECT e.id, e.organization_id, e.etapa_actual, e.subestado, e.ciclo_estado,
         e.submitted_to_mesa, e.pago_concasa_resultado, e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'registrar_pago_concasa: expediente no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org AND v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'registrar_pago_concasa: expediente fuera de organización' USING ERRCODE = '42501';
  END IF;
  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.etapa_actual IS DISTINCT FROM 11
     OR v_exp.subestado IS DISTINCT FROM 'en_proceso'
     OR v_exp.pago_concasa_resultado IS NOT NULL THEN
    RAISE EXCEPTION 'registrar_pago_concasa: expediente no disponible para registrar pago (se requiere Firmado/etapa 11 activo)' USING ERRCODE = '22023';
  END IF;

  -- Crear/fijar la cuenta en el primer movimiento.
  SELECT * INTO v_cuenta
  FROM public.expediente_pago_concasa_cuentas c
  WHERE c.expediente_id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT cd.* INTO v_cd
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se puede registrar Pago a ConCasa porque faltan los datos de cobro.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_resolved
    FROM public.ingresos_resolve_monto_base(
      v_cd.monto_mejoravit_actualizado,
      COALESCE(v_cd.datos, '{}'::JSONB)
    );

    IF v_resolved.monto_base IS NULL
       OR v_cd.porcentaje_cobro IS NULL
       OR v_cd.porcentaje_cobro <= 0 THEN
      RAISE EXCEPTION 'No se puede registrar Pago a ConCasa porque faltan el monto base o el porcentaje de cobro.' USING ERRCODE = '22023';
    END IF;

    v_objetivo := public.ingresos_calc_ingreso(
      v_resolved.monto_base,
      v_cd.porcentaje_cobro
    )::NUMERIC(12,2);

    IF v_objetivo IS NULL OR v_objetivo <= 0 THEN
      RAISE EXCEPTION 'No se puede registrar Pago a ConCasa porque el total calculado no es válido.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.expediente_pago_concasa_cuentas (
      expediente_id, organization_id, monto_base, monto_fuente,
      porcentaje_cobro, monto_objetivo, created_by, created_at
    ) VALUES (
      p_expediente_id, v_exp.organization_id, round(v_resolved.monto_base, 2),
      v_resolved.monto_fuente, v_cd.porcentaje_cobro, v_objetivo, v_actor, v_at
    )
    ON CONFLICT (expediente_id) DO NOTHING;

    SELECT * INTO v_cuenta
    FROM public.expediente_pago_concasa_cuentas c
    WHERE c.expediente_id = p_expediente_id
    FOR UPDATE;
  END IF;

  v_objetivo := v_cuenta.monto_objetivo;

  SELECT COALESCE(round(sum(pg.monto), 2), 0)::NUMERIC(12,2)
  INTO v_pagado
  FROM public.expediente_pagos_concasa pg
  WHERE pg.expediente_id = p_expediente_id;

  v_saldo := greatest(round(v_objetivo - v_pagado, 2), 0)::NUMERIC(12,2);
  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'registrar_pago_concasa: el saldo ya está liquidado' USING ERRCODE = '22023';
  END IF;

  IF v_tipo = 'parcial' THEN
    IF p_monto IS NULL OR p_monto <= 0 THEN
      RAISE EXCEPTION 'registrar_pago_concasa: captura un monto parcial mayor a cero' USING ERRCODE = '22023';
    END IF;
    v_monto := round(p_monto, 2)::NUMERIC(12,2);
    IF v_monto >= v_saldo THEN
      RAISE EXCEPTION 'registrar_pago_concasa: el pago parcial debe ser menor al saldo; para liquidar usa Pago total' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- Pago total siempre liquida exactamente el saldo pendiente; no permite sobrepago.
    v_monto := v_saldo;
  END IF;

  v_saldo_despues := greatest(round(v_saldo - v_monto, 2), 0)::NUMERIC(12,2);

  INSERT INTO public.expediente_pagos_concasa (
    organization_id, expediente_id, tipo, monto, notas,
    monto_objetivo_snapshot, acumulado_antes, saldo_despues,
    actor_id, created_at
  ) VALUES (
    v_exp.organization_id, p_expediente_id, v_tipo, v_monto, v_notas,
    v_objetivo, v_pagado, v_saldo_despues, v_actor, v_at
  )
  RETURNING id INTO v_movimiento_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor,
    v_role,
    CASE WHEN v_tipo = 'parcial'
      THEN 'expediente.pago_concasa.parcial'
      ELSE 'expediente.pago_concasa.total'
    END,
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'movimiento_id', v_movimiento_id,
      'tipo', v_tipo,
      'monto', v_monto,
      'notas', v_notas,
      'monto_objetivo', v_objetivo,
      'acumulado_antes', v_pagado,
      'saldo_despues', v_saldo_despues,
      'created_at', v_at
    )
  );

  IF v_tipo = 'total' THEN
    -- P166 sigue siendo la única autoridad para cerrar 11→12 y reconocer ingreso.
    PERFORM public.decidir_pago_concasa(
      p_expediente_id,
      'pagado',
      COALESCE(v_notas, 'Pago total registrado desde Mesa')
    );
  END IF;

  RETURN public.pago_concasa_estado(p_expediente_id);
END;
$$;

COMMENT ON FUNCTION public.registrar_pago_concasa(UUID, TEXT, NUMERIC, TEXT) IS
  'Mesa: registra parcial (monto+notas, permanece 11) o total (saldo exacto y P166 11→12). Append-only.';

REVOKE ALL ON FUNCTION public.registrar_pago_concasa(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pago_concasa(UUID, TEXT, NUMERIC, TEXT)
  TO authenticated, service_role, postgres;
