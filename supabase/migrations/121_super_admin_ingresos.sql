-- ConCasa CRM — P134: ingresos proyectados/reales Super Admin
-- Tabla snapshot + reconocimiento atómico 11→12 + RPCs read-only.
-- Fórmula: round(monto_base * porcentaje_cobro / 100, 2)
-- Prioridad monto: monto_mejoravit_actualizado > parse_monto_mejoravit_json(datos).
-- Sin tope $169,000. Sin mutar métricas Admin existentes.

-- =============================================================================
-- A) Tabla histórica de reconocimiento
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.expediente_ingresos_reconocidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL
    REFERENCES public.expedientes(id) ON DELETE RESTRICT,
  monto_base NUMERIC(12,2) NOT NULL,
  monto_fuente TEXT NOT NULL,
  porcentaje_cobro NUMERIC(5,2) NOT NULL,
  ingreso_real NUMERIC(12,2) NOT NULL,
  reconocido_at TIMESTAMPTZ NOT NULL,
  actor_id UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  snapshot_source TEXT NOT NULL,
  is_historical_estimate BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_ingresos_reconocidos_expediente_uidx UNIQUE (expediente_id),
  CONSTRAINT expediente_ingresos_reconocidos_monto_fuente_chk
    CHECK (monto_fuente IN ('mesa_actualizado', 'datos_generales')),
  CONSTRAINT expediente_ingresos_reconocidos_pct_chk
    CHECK (porcentaje_cobro > 0 AND porcentaje_cobro <= 100),
  CONSTRAINT expediente_ingresos_reconocidos_montos_chk
    CHECK (monto_base >= 0 AND ingreso_real >= 0),
  CONSTRAINT expediente_ingresos_reconocidos_source_chk
    CHECK (
      snapshot_source IN (
        'avance_11_12',
        'legacy_backfill_current_values'
      )
    )
);

COMMENT ON TABLE public.expediente_ingresos_reconocidos IS
  'P134: snapshot inmutable de ingreso real al pasar a Pago a ConCasa (11→12). Una fila por expediente.';

CREATE INDEX IF NOT EXISTS expediente_ingresos_reconocidos_org_at_idx
  ON public.expediente_ingresos_reconocidos (organization_id, reconocido_at DESC);

CREATE INDEX IF NOT EXISTS expediente_ingresos_reconocidos_org_exp_idx
  ON public.expediente_ingresos_reconocidos (organization_id, expediente_id);

ALTER TABLE public.expediente_ingresos_reconocidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expediente_ingresos_reconocidos_select
  ON public.expediente_ingresos_reconocidos;
CREATE POLICY expediente_ingresos_reconocidos_select
  ON public.expediente_ingresos_reconocidos
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

REVOKE ALL ON TABLE public.expediente_ingresos_reconocidos FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_ingresos_reconocidos FROM anon;
REVOKE ALL ON TABLE public.expediente_ingresos_reconocidos FROM authenticated;
GRANT SELECT ON TABLE public.expediente_ingresos_reconocidos
  TO authenticated, service_role, postgres;
GRANT ALL ON TABLE public.expediente_ingresos_reconocidos
  TO postgres, service_role;

-- =============================================================================
-- B) Helpers de resolución / cálculo (sin tope 169k; sin +3000)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ingresos_calc_ingreso(
  p_monto_base NUMERIC,
  p_porcentaje NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_monto_base IS NULL OR p_porcentaje IS NULL THEN NULL
    WHEN p_monto_base < 0 OR p_porcentaje <= 0 THEN NULL
    ELSE round(p_monto_base * p_porcentaje / 100, 2)
  END;
$$;

COMMENT ON FUNCTION public.ingresos_calc_ingreso(NUMERIC, NUMERIC) IS
  'P134: ingreso = round(monto_base × porcentaje / 100, 2). Sin cargo fijo ni tope 169k.';

REVOKE ALL ON FUNCTION public.ingresos_calc_ingreso(NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingresos_calc_ingreso(NUMERIC, NUMERIC)
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.ingresos_resolve_monto_base(
  p_monto_actualizado NUMERIC,
  p_datos JSONB
)
RETURNS TABLE (monto_base NUMERIC, monto_fuente TEXT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_general NUMERIC;
BEGIN
  IF p_monto_actualizado IS NOT NULL AND p_monto_actualizado > 0 THEN
    monto_base := round(p_monto_actualizado, 2);
    monto_fuente := 'mesa_actualizado';
    RETURN NEXT;
    RETURN;
  END IF;

  v_general := public.parse_monto_mejoravit_json(COALESCE(p_datos, '{}'::JSONB));
  IF v_general IS NOT NULL AND v_general > 0 THEN
    monto_base := round(v_general, 2);
    monto_fuente := 'datos_generales';
    RETURN NEXT;
    RETURN;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.ingresos_resolve_monto_base(NUMERIC, JSONB) IS
  'P134: prioridad monto_mejoravit_actualizado > montoMejoravit JSON. Sin fallback editor/169k.';

REVOKE ALL ON FUNCTION public.ingresos_resolve_monto_base(NUMERIC, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingresos_resolve_monto_base(NUMERIC, JSONB)
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.ingresos_bio_aprobacion_at(p_expediente_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT MIN(al.created_at)
      FROM public.action_log al
      WHERE al.entity_type = 'expediente'
        AND al.entity_id = p_expediente_id
        AND al.action = 'expediente.avanzar_etapa_operativa'
        AND al.payload->>'transition' IN ('5_8', '5_6', '5_7')
    ),
    (
      SELECT MIN(t.fecha_entrada)
      FROM public.expediente_paso_visual_transiciones t
      WHERE t.expediente_id = p_expediente_id
        AND t.etapa_anterior = 5
        AND t.etapa_nueva IN (6, 7, 8)
    )
  );
$$;

COMMENT ON FUNCTION public.ingresos_bio_aprobacion_at(UUID) IS
  'P134: fecha canónica de aprobación Biometría (action_log 5_8/5_6/5_7 o cruce P114 desde etapa 5).';

REVOKE ALL ON FUNCTION public.ingresos_bio_aprobacion_at(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingresos_bio_aprobacion_at(UUID)
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.ingresos_pago_entrada_at(p_expediente_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT MIN(al.created_at)
      FROM public.action_log al
      WHERE al.entity_type = 'expediente'
        AND al.entity_id = p_expediente_id
        AND al.action = 'expediente.avanzar_etapa_operativa'
        AND al.payload->>'transition' = '11_12'
    ),
    (
      SELECT MIN(t.fecha_entrada)
      FROM public.expediente_paso_visual_transiciones t
      WHERE t.expediente_id = p_expediente_id
        AND t.etapa_nueva = 12
    )
  );
$$;

COMMENT ON FUNCTION public.ingresos_pago_entrada_at(UUID) IS
  'P134: fecha canónica de entrada a Pago a ConCasa (11_12 / P114 etapa 12).';

REVOKE ALL ON FUNCTION public.ingresos_pago_entrada_at(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingresos_pago_entrada_at(UUID)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- C) Reconocer snapshot (idempotente)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ingresos_reconocer_pago_concasa(
  p_expediente_id UUID,
  p_organization_id UUID,
  p_actor_id UUID,
  p_snapshot_source TEXT DEFAULT 'avance_11_12',
  p_reconocido_at TIMESTAMPTZ DEFAULT NULL,
  p_is_historical_estimate BOOLEAN DEFAULT false,
  p_block_if_incomplete BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cd public.cliente_datos%ROWTYPE;
  v_resolved RECORD;
  v_pct NUMERIC(5,2);
  v_ingreso NUMERIC(12,2);
  v_at TIMESTAMPTZ;
  v_existing UUID;
  v_id UUID;
BEGIN
  IF p_expediente_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'ingresos_reconocer: expediente/organización obligatorios'
      USING ERRCODE = '22023';
  END IF;

  IF p_snapshot_source NOT IN ('avance_11_12', 'legacy_backfill_current_values') THEN
    RAISE EXCEPTION 'ingresos_reconocer: snapshot_source inválido'
      USING ERRCODE = '22023';
  END IF;

  SELECT r.id INTO v_existing
  FROM public.expediente_ingresos_reconocidos r
  WHERE r.expediente_id = p_expediente_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'expediente_id', p_expediente_id,
      'id', v_existing
    );
  END IF;

  SELECT cd.* INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  SELECT * INTO v_resolved
  FROM public.ingresos_resolve_monto_base(
    v_cd.monto_mejoravit_actualizado,
    COALESCE(v_cd.datos, '{}'::JSONB)
  );

  v_pct := v_cd.porcentaje_cobro;

  IF v_resolved.monto_base IS NULL
     OR v_pct IS NULL
     OR v_pct <= 0 THEN
    IF p_block_if_incomplete THEN
      RAISE EXCEPTION
        'No se puede registrar Pago a ConCasa porque faltan el monto base o el porcentaje de cobro.'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'ok', false,
      'skipped', true,
      'reason', 'incomplete',
      'expediente_id', p_expediente_id
    );
  END IF;

  v_ingreso := public.ingresos_calc_ingreso(v_resolved.monto_base, v_pct);
  IF v_ingreso IS NULL THEN
    IF p_block_if_incomplete THEN
      RAISE EXCEPTION
        'No se puede registrar Pago a ConCasa porque faltan el monto base o el porcentaje de cobro.'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'ok', false,
      'skipped', true,
      'reason', 'incomplete',
      'expediente_id', p_expediente_id
    );
  END IF;

  v_at := COALESCE(p_reconocido_at, clock_timestamp());

  INSERT INTO public.expediente_ingresos_reconocidos (
    organization_id,
    expediente_id,
    monto_base,
    monto_fuente,
    porcentaje_cobro,
    ingreso_real,
    reconocido_at,
    actor_id,
    snapshot_source,
    is_historical_estimate
  ) VALUES (
    p_organization_id,
    p_expediente_id,
    v_resolved.monto_base,
    v_resolved.monto_fuente,
    v_pct,
    v_ingreso,
    v_at,
    p_actor_id,
    p_snapshot_source,
    COALESCE(p_is_historical_estimate, false)
  )
  ON CONFLICT (expediente_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT r.id INTO v_id
    FROM public.expediente_ingresos_reconocidos r
    WHERE r.expediente_id = p_expediente_id;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'expediente_id', p_expediente_id,
      'id', v_id
    );
  END IF;

  IF v_id IS NOT NULL AND p_actor_id IS NOT NULL THEN
    PERFORM public.log_action(
      p_organization_id,
      p_actor_id,
      COALESCE(
        (SELECT p.app_role FROM public.profiles p WHERE p.id = p_actor_id),
        'super_admin'::public.app_role
      ),
      'expediente.ingreso_real.reconocido',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'ingreso_real', v_ingreso,
        'monto_base', v_resolved.monto_base,
        'monto_fuente', v_resolved.monto_fuente,
        'porcentaje_cobro', v_pct,
        'reconocido_at', v_at,
        'snapshot_source', p_snapshot_source,
        'is_historical_estimate', COALESCE(p_is_historical_estimate, false),
        'snapshot_id', v_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'expediente_id', p_expediente_id,
    'id', v_id,
    'ingreso_real', v_ingreso,
    'monto_base', v_resolved.monto_base,
    'monto_fuente', v_resolved.monto_fuente,
    'porcentaje_cobro', v_pct
  );
END;
$$;

COMMENT ON FUNCTION public.ingresos_reconocer_pago_concasa(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN, BOOLEAN) IS
  'P134: inserta snapshot de ingreso real (idempotente). Bloquea si faltan monto/% cuando p_block_if_incomplete.';

REVOKE ALL ON FUNCTION public.ingresos_reconocer_pago_concasa(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingresos_reconocer_pago_concasa(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.ingresos_reconocer_pago_concasa(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ingresos_reconocer_pago_concasa(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN, BOOLEAN)
  TO service_role, postgres;

-- Trigger: misma transacción que UPDATE 11→12
CREATE OR REPLACE FUNCTION public.__tg_ingresos_on_11_12()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF OLD.etapa_actual IS DISTINCT FROM 11 OR NEW.etapa_actual IS DISTINCT FROM 12 THEN
    RETURN NEW;
  END IF;

  v_actor := public.current_profile_id();

  PERFORM public.ingresos_reconocer_pago_concasa(
    NEW.id,
    NEW.organization_id,
    v_actor,
    'avance_11_12',
    clock_timestamp(),
    false,
    true
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_ingresos_on_11_12 ON public.expedientes;
CREATE TRIGGER tg_ingresos_on_11_12
  BEFORE UPDATE OF etapa_actual ON public.expedientes
  FOR EACH ROW
  EXECUTE FUNCTION public.__tg_ingresos_on_11_12();

COMMENT ON FUNCTION public.__tg_ingresos_on_11_12() IS
  'P134: al avanzar 11→12 reconoce ingreso real en la misma transacción (bloquea si faltan datos).';

-- =============================================================================
-- D) Backfill histórico etapa 12 (idempotente; estimado)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ingresos_backfill_etapa12_legacy(
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_row RECORD;
  v_pago_at TIMESTAMPTZ;
  v_res JSONB;
  v_total INT := 0;
  v_ok INT := 0;
  v_incomplete INT := 0;
  v_no_evidence INT := 0;
  v_already INT := 0;
BEGIN
  v_org := p_organization_id;

  FOR v_row IN
    SELECT e.id, e.organization_id
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.etapa_actual = 12
      AND (v_org IS NULL OR e.organization_id = v_org)
  LOOP
    v_total := v_total + 1;

    IF EXISTS (
      SELECT 1 FROM public.expediente_ingresos_reconocidos r
      WHERE r.expediente_id = v_row.id
    ) THEN
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    v_pago_at := public.ingresos_pago_entrada_at(v_row.id);
    IF v_pago_at IS NULL THEN
      v_no_evidence := v_no_evidence + 1;
      CONTINUE;
    END IF;

    v_res := public.ingresos_reconocer_pago_concasa(
      v_row.id,
      v_row.organization_id,
      NULL,
      'legacy_backfill_current_values',
      v_pago_at,
      true,
      false
    );

    IF (v_res->>'ok')::boolean IS TRUE AND COALESCE((v_res->>'idempotent')::boolean, false) IS FALSE THEN
      v_ok := v_ok + 1;
    ELSIF (v_res->>'skipped')::boolean IS TRUE THEN
      v_incomplete := v_incomplete + 1;
    ELSIF (v_res->>'idempotent')::boolean IS TRUE THEN
      v_already := v_already + 1;
    ELSE
      v_incomplete := v_incomplete + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'total_etapa_12', v_total,
    'snapshotted', v_ok,
    'already_present', v_already,
    'incomplete', v_incomplete,
    'no_canonical_evidence', v_no_evidence
  );
END;
$$;

COMMENT ON FUNCTION public.ingresos_backfill_etapa12_legacy(UUID) IS
  'P134: backfill estimado solo etapa 12 con evidencia canónica 11_12/P114; idempotente.';

REVOKE ALL ON FUNCTION public.ingresos_backfill_etapa12_legacy(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingresos_backfill_etapa12_legacy(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.ingresos_backfill_etapa12_legacy(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ingresos_backfill_etapa12_legacy(UUID)
  TO service_role, postgres;

-- =============================================================================
-- E) Universe helper (SQL view-like via function returning set)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.__ingresos_universe_rows(p_org UUID)
RETURNS TABLE (
  expediente_id UUID,
  organization_id UUID,
  asesor_id UUID,
  cliente_nombre TEXT,
  nss TEXT,
  asesor_nombre TEXT,
  etapa_actual SMALLINT,
  subestado TEXT,
  ciclo_estado TEXT,
  bio_aprobacion_at TIMESTAMPTZ,
  monto_general NUMERIC,
  monto_actualizado NUMERIC,
  monto_base NUMERIC,
  monto_fuente TEXT,
  porcentaje_cobro NUMERIC,
  ingreso_proyectado NUMERIC,
  ingreso_real NUMERIC,
  reconocido_at TIMESTAMPTZ,
  is_historical_estimate BOOLEAN,
  incompleto_reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bio AS (
    SELECT
      e.id AS expediente_id,
      e.organization_id,
      e.asesor_id,
      e.cliente_nombre,
      e.nss,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.submitted_to_mesa,
      e.deleted_at,
      public.ingresos_bio_aprobacion_at(e.id) AS bio_aprobacion_at,
      cd.porcentaje_cobro,
      cd.monto_mejoravit_actualizado,
      public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) AS monto_general,
      r.ingreso_real,
      r.reconocido_at,
      r.is_historical_estimate,
      p.full_name AS asesor_nombre
    FROM public.expedientes e
    LEFT JOIN public.cliente_datos cd ON cd.expediente_id = e.id
    LEFT JOIN public.expediente_ingresos_reconocidos r ON r.expediente_id = e.id
    LEFT JOIN public.profiles p ON p.id = e.asesor_id
    WHERE e.organization_id = p_org
      AND e.deleted_at IS NULL
      AND e.submitted_to_mesa IS TRUE
  ),
  resolved AS (
    SELECT
      b.*,
      res.monto_base,
      res.monto_fuente,
      public.ingresos_calc_ingreso(res.monto_base, b.porcentaje_cobro) AS ingreso_proyectado,
      CASE
        WHEN b.porcentaje_cobro IS NULL OR b.porcentaje_cobro <= 0 THEN
          CASE
            WHEN (b.monto_mejoravit_actualizado IS NULL OR b.monto_mejoravit_actualizado <= 0)
             AND (b.monto_general IS NULL OR b.monto_general <= 0)
            THEN 'sin_ambos'
            ELSE 'sin_porcentaje'
          END
        WHEN (b.monto_mejoravit_actualizado IS NULL OR b.monto_mejoravit_actualizado <= 0)
         AND (b.monto_general IS NULL OR b.monto_general <= 0)
        THEN 'sin_monto'
        ELSE NULL
      END AS incompleto_reason
    FROM bio b
    LEFT JOIN LATERAL public.ingresos_resolve_monto_base(
      b.monto_mejoravit_actualizado,
      jsonb_build_object(
        -- parse already done; pass synthetic via override using actualizado/general
        'montoMejoravit',
        CASE
          WHEN b.monto_mejoravit_actualizado IS NOT NULL AND b.monto_mejoravit_actualizado > 0
            THEN NULL
          ELSE to_jsonb(b.monto_general)#>>'{}'
        END
      )
    ) res ON TRUE
  )
  SELECT
    r.expediente_id,
    r.organization_id,
    r.asesor_id,
    r.cliente_nombre,
    r.nss,
    COALESCE(NULLIF(btrim(r.asesor_nombre), ''), r.asesor_id::text) AS asesor_nombre,
    r.etapa_actual::SMALLINT,
    r.subestado,
    r.ciclo_estado,
    r.bio_aprobacion_at,
    r.monto_general,
    r.monto_mejoravit_actualizado AS monto_actualizado,
    CASE
      WHEN r.monto_mejoravit_actualizado IS NOT NULL AND r.monto_mejoravit_actualizado > 0
        THEN round(r.monto_mejoravit_actualizado, 2)
      WHEN r.monto_general IS NOT NULL AND r.monto_general > 0
        THEN round(r.monto_general, 2)
      ELSE NULL
    END AS monto_base,
    CASE
      WHEN r.monto_mejoravit_actualizado IS NOT NULL AND r.monto_mejoravit_actualizado > 0
        THEN 'mesa_actualizado'
      WHEN r.monto_general IS NOT NULL AND r.monto_general > 0
        THEN 'datos_generales'
      ELSE NULL
    END AS monto_fuente,
    r.porcentaje_cobro,
    CASE
      WHEN r.monto_mejoravit_actualizado IS NOT NULL AND r.monto_mejoravit_actualizado > 0
           AND r.porcentaje_cobro IS NOT NULL AND r.porcentaje_cobro > 0
        THEN public.ingresos_calc_ingreso(r.monto_mejoravit_actualizado, r.porcentaje_cobro)
      WHEN r.monto_general IS NOT NULL AND r.monto_general > 0
           AND r.porcentaje_cobro IS NOT NULL AND r.porcentaje_cobro > 0
        THEN public.ingresos_calc_ingreso(r.monto_general, r.porcentaje_cobro)
      ELSE NULL
    END AS ingreso_proyectado,
    r.ingreso_real,
    r.reconocido_at,
    COALESCE(r.is_historical_estimate, false) AS is_historical_estimate,
    r.incompleto_reason
  FROM resolved r
  WHERE r.bio_aprobacion_at IS NOT NULL;
$$;

COMMENT ON FUNCTION public.__ingresos_universe_rows(UUID) IS
  'P134: universo interno con evidencia canónica de aprobación biométrica.';

REVOKE ALL ON FUNCTION public.__ingresos_universe_rows(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.__ingresos_universe_rows(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.__ingresos_universe_rows(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.__ingresos_universe_rows(UUID)
  TO service_role, postgres;

-- Fix resolved monto: the lateral join with synthetic JSON is awkward.
-- Rewrite universe more simply without broken lateral.
CREATE OR REPLACE FUNCTION public.__ingresos_universe_rows(p_org UUID)
RETURNS TABLE (
  expediente_id UUID,
  organization_id UUID,
  asesor_id UUID,
  cliente_nombre TEXT,
  nss TEXT,
  asesor_nombre TEXT,
  etapa_actual SMALLINT,
  subestado TEXT,
  ciclo_estado TEXT,
  bio_aprobacion_at TIMESTAMPTZ,
  monto_general NUMERIC,
  monto_actualizado NUMERIC,
  monto_base NUMERIC,
  monto_fuente TEXT,
  porcentaje_cobro NUMERIC,
  ingreso_proyectado NUMERIC,
  ingreso_real NUMERIC,
  reconocido_at TIMESTAMPTZ,
  is_historical_estimate BOOLEAN,
  incompleto_reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id AS expediente_id,
    e.organization_id,
    e.asesor_id,
    e.cliente_nombre,
    e.nss,
    COALESCE(NULLIF(btrim(p.full_name), ''), e.asesor_id::text) AS asesor_nombre,
    e.etapa_actual::SMALLINT,
    e.subestado::text,
    e.ciclo_estado::text,
    public.ingresos_bio_aprobacion_at(e.id) AS bio_aprobacion_at,
    public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) AS monto_general,
    cd.monto_mejoravit_actualizado AS monto_actualizado,
    CASE
      WHEN cd.monto_mejoravit_actualizado IS NOT NULL AND cd.monto_mejoravit_actualizado > 0
        THEN round(cd.monto_mejoravit_actualizado, 2)
      WHEN public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) IS NOT NULL
        AND public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) > 0
        THEN round(public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)), 2)
      ELSE NULL
    END AS monto_base,
    CASE
      WHEN cd.monto_mejoravit_actualizado IS NOT NULL AND cd.monto_mejoravit_actualizado > 0
        THEN 'mesa_actualizado'
      WHEN public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) IS NOT NULL
        AND public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) > 0
        THEN 'datos_generales'
      ELSE NULL
    END AS monto_fuente,
    cd.porcentaje_cobro,
    public.ingresos_calc_ingreso(
      CASE
        WHEN cd.monto_mejoravit_actualizado IS NOT NULL AND cd.monto_mejoravit_actualizado > 0
          THEN cd.monto_mejoravit_actualizado
        ELSE public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB))
      END,
      cd.porcentaje_cobro
    ) AS ingreso_proyectado,
    r.ingreso_real,
    r.reconocido_at,
    COALESCE(r.is_historical_estimate, false) AS is_historical_estimate,
    CASE
      WHEN cd.porcentaje_cobro IS NULL OR cd.porcentaje_cobro <= 0 THEN
        CASE
          WHEN (cd.monto_mejoravit_actualizado IS NULL OR cd.monto_mejoravit_actualizado <= 0)
           AND (
             public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) IS NULL
             OR public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) <= 0
           )
          THEN 'sin_ambos'
          ELSE 'sin_porcentaje'
        END
      WHEN (cd.monto_mejoravit_actualizado IS NULL OR cd.monto_mejoravit_actualizado <= 0)
       AND (
         public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) IS NULL
         OR public.parse_monto_mejoravit_json(COALESCE(cd.datos, '{}'::JSONB)) <= 0
       )
      THEN 'sin_monto'
      ELSE NULL
    END AS incompleto_reason
  FROM public.expedientes e
  LEFT JOIN public.cliente_datos cd ON cd.expediente_id = e.id
  LEFT JOIN public.expediente_ingresos_reconocidos r ON r.expediente_id = e.id
  LEFT JOIN public.profiles p ON p.id = e.asesor_id
  WHERE e.organization_id = p_org
    AND e.deleted_at IS NULL
    AND e.submitted_to_mesa IS TRUE
    AND public.ingresos_bio_aprobacion_at(e.id) IS NOT NULL;
$$;

-- =============================================================================
-- F) RPC resumen Super Admin
-- =============================================================================
CREATE OR REPLACE FUNCTION public.super_admin_get_ingresos_resumen(
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_asesor_ids UUID[] DEFAULT NULL,
  p_monto_fuente TEXT DEFAULT NULL,
  p_porcentajes NUMERIC[] DEFAULT NULL,
  p_pasos_visuales SMALLINT[] DEFAULT NULL,
  p_estado TEXT DEFAULT 'elegibles',
  p_buscar TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_tz TEXT := 'America/Monterrey';
  v_estado TEXT;
  v_fuente TEXT;
  v_pasos SMALLINT[];
  v_etapas SMALLINT[];
  v_paso SMALLINT;
  v_buscar TEXT;
BEGIN
  v_actor := public.__admin_require_super_admin();
  SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id = v_actor;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_ingresos: organización del actor no disponible'
      USING ERRCODE = '22023';
  END IF;

  IF p_fecha_desde IS NOT NULL AND p_fecha_hasta IS NOT NULL AND p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'admin_ingresos: fecha_desde no puede ser mayor que fecha_hasta'
      USING ERRCODE = '22023';
  END IF;

  v_estado := lower(btrim(COALESCE(p_estado, 'elegibles')));
  IF v_estado NOT IN ('elegibles', 'pendientes', 'pagados') THEN
    RAISE EXCEPTION 'admin_ingresos: p_estado inválido (elegibles|pendientes|pagados)'
      USING ERRCODE = '22023';
  END IF;

  v_fuente := NULLIF(lower(btrim(COALESCE(p_monto_fuente, ''))), '');
  IF v_fuente IS NOT NULL AND v_fuente NOT IN ('mesa_actualizado', 'datos_generales') THEN
    RAISE EXCEPTION 'admin_ingresos: p_monto_fuente inválido'
      USING ERRCODE = '22023';
  END IF;

  v_buscar := NULLIF(btrim(COALESCE(p_buscar, '')), '');

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    v_pasos := ARRAY[1,2,3,4,5,6,7,8,9,10,11]::SMALLINT[];
  ELSE
    v_pasos := (SELECT array_agg(DISTINCT p ORDER BY p) FROM unnest(p_pasos_visuales) AS p);
    IF EXISTS (SELECT 1 FROM unnest(v_pasos) AS p WHERE p < 1 OR p > 11) THEN
      RAISE EXCEPTION 'admin_ingresos: p_pasos_visuales debe estar entre 1 y 11'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_etapas := ARRAY[]::SMALLINT[];
  FOREACH v_paso IN ARRAY v_pasos LOOP
    IF v_paso = 3 THEN
      v_etapas := v_etapas || ARRAY[3, 4]::SMALLINT[];
    ELSIF v_paso <= 2 THEN
      v_etapas := v_etapas || ARRAY[v_paso]::SMALLINT[];
    ELSE
      v_etapas := v_etapas || ARRAY[(v_paso + 1)::SMALLINT];
    END IF;
  END LOOP;
  v_etapas := (SELECT array_agg(DISTINCT e ORDER BY e) FROM unnest(v_etapas) AS e);

  RETURN (
    WITH universe AS (
      SELECT u.*
      FROM public.__ingresos_universe_rows(v_org) u
      WHERE u.ciclo_estado IS DISTINCT FROM 'cancelado'
        AND u.subestado IS DISTINCT FROM 'rechazado'
        AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
             OR u.asesor_id = ANY (p_asesor_ids))
        AND u.etapa_actual = ANY (v_etapas)
        AND (v_fuente IS NULL OR u.monto_fuente = v_fuente)
        AND (p_porcentajes IS NULL OR cardinality(p_porcentajes) IS NULL OR cardinality(p_porcentajes) = 0
             OR u.porcentaje_cobro = ANY (p_porcentajes))
        AND (
          v_buscar IS NULL
          OR u.cliente_nombre ILIKE '%' || v_buscar || '%'
          OR COALESCE(u.nss, '') ILIKE '%' || v_buscar || '%'
        )
    ),
    proyectados AS (
      SELECT *
      FROM universe u
      WHERE u.ingreso_proyectado IS NOT NULL
        AND u.ingreso_proyectado > 0
        AND (
          p_fecha_desde IS NULL
          OR (u.bio_aprobacion_at AT TIME ZONE v_tz)::date >= p_fecha_desde
        )
        AND (
          p_fecha_hasta IS NULL
          OR (u.bio_aprobacion_at AT TIME ZONE v_tz)::date <= p_fecha_hasta
        )
        AND (
          v_estado = 'elegibles'
          OR (v_estado = 'pendientes' AND u.ingreso_real IS NULL)
          OR (v_estado = 'pagados' AND u.ingreso_real IS NOT NULL)
        )
    ),
    reales AS (
      SELECT *
      FROM universe u
      WHERE u.ingreso_real IS NOT NULL
        AND (
          p_fecha_desde IS NULL
          OR (u.reconocido_at AT TIME ZONE v_tz)::date >= p_fecha_desde
        )
        AND (
          p_fecha_hasta IS NULL
          OR (u.reconocido_at AT TIME ZONE v_tz)::date <= p_fecha_hasta
        )
        AND (
          v_estado = 'elegibles'
          OR v_estado = 'pagados'
          OR (v_estado = 'pendientes' AND false)
        )
    ),
    incompletos AS (
      SELECT *
      FROM universe u
      WHERE u.incompleto_reason IS NOT NULL
        AND (
          p_fecha_desde IS NULL
          OR (u.bio_aprobacion_at AT TIME ZONE v_tz)::date >= p_fecha_desde
        )
        AND (
          p_fecha_hasta IS NULL
          OR (u.bio_aprobacion_at AT TIME ZONE v_tz)::date <= p_fecha_hasta
        )
    ),
    agg_proj AS (
      SELECT
        COALESCE(SUM(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ingreso_proyectado,
        COUNT(*)::INT AS expedientes_proyectados,
        COALESCE(AVG(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ticket_promedio_proyectado,
        COUNT(*) FILTER (WHERE p.ingreso_real IS NULL)::INT AS expedientes_pendientes
      FROM proyectados p
    ),
    agg_real AS (
      SELECT
        COALESCE(SUM(r.ingreso_real), 0)::NUMERIC(14,2) AS ingreso_real,
        COUNT(*)::INT AS expedientes_pagados,
        COALESCE(AVG(r.ingreso_real), 0)::NUMERIC(14,2) AS ticket_promedio_real
      FROM reales r
    ),
    por_asesor AS (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.ingreso_proyectado DESC), '[]'::jsonb)
      FROM (
        SELECT
          p.asesor_id,
          MAX(p.asesor_nombre) AS asesor_nombre,
          COUNT(*)::INT AS expedientes,
          COALESCE(SUM(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ingreso_proyectado,
          COALESCE(SUM(p.ingreso_real), 0)::NUMERIC(14,2) AS ingreso_real,
          GREATEST(
            COALESCE(SUM(p.ingreso_proyectado), 0) - COALESCE(SUM(p.ingreso_real), 0),
            0
          )::NUMERIC(14,2) AS pendiente,
          CASE
            WHEN COALESCE(SUM(p.ingreso_proyectado), 0) = 0 THEN 0
            ELSE round(
              COALESCE(SUM(p.ingreso_real), 0) * 100 / SUM(p.ingreso_proyectado),
              2
            )
          END AS cumplimiento_pct
        FROM proyectados p
        GROUP BY p.asesor_id
      ) x
    ),
    por_pct AS (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.porcentaje_cobro), '[]'::jsonb)
      FROM (
        SELECT
          p.porcentaje_cobro,
          COUNT(*)::INT AS expedientes,
          COALESCE(SUM(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ingreso_proyectado,
          COALESCE(SUM(p.ingreso_real), 0)::NUMERIC(14,2) AS ingreso_real
        FROM proyectados p
        GROUP BY p.porcentaje_cobro
      ) x
    ),
    por_fuente AS (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.monto_fuente), '[]'::jsonb)
      FROM (
        SELECT
          p.monto_fuente,
          COUNT(*)::INT AS expedientes,
          COALESCE(SUM(p.ingreso_proyectado), 0)::NUMERIC(14,2) AS ingreso_proyectado,
          COALESCE(SUM(p.ingreso_real), 0)::NUMERIC(14,2) AS ingreso_real
        FROM proyectados p
        WHERE p.monto_fuente IS NOT NULL
        GROUP BY p.monto_fuente
      ) x
    ),
    tendencia AS (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.fecha), '[]'::jsonb)
      FROM (
        SELECT
          d.fecha,
          COALESCE(SUM(d.proyectado), 0)::NUMERIC(14,2) AS proyectado,
          COALESCE(SUM(d.real), 0)::NUMERIC(14,2) AS real
        FROM (
          SELECT
            (p.bio_aprobacion_at AT TIME ZONE v_tz)::date AS fecha,
            p.ingreso_proyectado AS proyectado,
            0::NUMERIC AS real
          FROM proyectados p
          UNION ALL
          SELECT
            (r.reconocido_at AT TIME ZONE v_tz)::date AS fecha,
            0::NUMERIC AS proyectado,
            r.ingreso_real AS real
          FROM reales r
        ) d
        GROUP BY d.fecha
      ) x
    ),
    sin_datos AS (
      SELECT jsonb_build_object(
        'total', COUNT(*)::INT,
        'sin_porcentaje', COUNT(*) FILTER (WHERE i.incompleto_reason = 'sin_porcentaje')::INT,
        'sin_monto', COUNT(*) FILTER (WHERE i.incompleto_reason = 'sin_monto')::INT,
        'sin_ambos', COUNT(*) FILTER (WHERE i.incompleto_reason = 'sin_ambos')::INT,
        'items', COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'expediente_id', i.expediente_id,
              'cliente_nombre', i.cliente_nombre,
              'nss', i.nss,
              'reason', i.incompleto_reason
            )
            ORDER BY i.cliente_nombre
          ) FILTER (WHERE true),
          '[]'::jsonb
        )
      )
      FROM incompletos i
    )
    SELECT jsonb_build_object(
      'ingreso_proyectado', ap.ingreso_proyectado,
      'ingreso_real', ar.ingreso_real,
      'pendiente_por_cobrar', GREATEST(ap.ingreso_proyectado - ar.ingreso_real, 0)::NUMERIC(14,2),
      'cumplimiento_pct', CASE
        WHEN ap.ingreso_proyectado = 0 THEN 0
        ELSE round(ar.ingreso_real * 100 / ap.ingreso_proyectado, 2)
      END,
      'expedientes_proyectados', ap.expedientes_proyectados,
      'expedientes_pagados', ar.expedientes_pagados,
      'expedientes_pendientes', ap.expedientes_pendientes,
      'ticket_promedio_proyectado', ap.ticket_promedio_proyectado,
      'ticket_promedio_real', ar.ticket_promedio_real,
      'sin_datos_cobro', (SELECT * FROM sin_datos),
      'por_asesor', (SELECT * FROM por_asesor),
      'por_porcentaje', (SELECT * FROM por_pct),
      'por_fuente_monto', (SELECT * FROM por_fuente),
      'tendencia', (SELECT * FROM tendencia),
      'meta', jsonb_build_object(
        'organization_id', v_org,
        'fecha_desde', p_fecha_desde,
        'fecha_hasta', p_fecha_hasta,
        'timezone', v_tz,
        'estado', v_estado,
        'nota',
          'La proyección se agrupa por aprobación biométrica y el ingreso real por la fecha de Pago a ConCasa.'
      )
    )
    FROM agg_proj ap, agg_real ar
  );
END;
$$;

COMMENT ON FUNCTION public.super_admin_get_ingresos_resumen(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT) IS
  'P134: resumen ingresos Super Admin (proyectado/real/pendiente). Solo super_admin.';

REVOKE ALL ON FUNCTION public.super_admin_get_ingresos_resumen(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_get_ingresos_resumen(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_get_ingresos_resumen(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- G) RPC detalle paginado
-- =============================================================================
CREATE OR REPLACE FUNCTION public.super_admin_list_ingresos_page(
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_asesor_ids UUID[] DEFAULT NULL,
  p_monto_fuente TEXT DEFAULT NULL,
  p_porcentajes NUMERIC[] DEFAULT NULL,
  p_pasos_visuales SMALLINT[] DEFAULT NULL,
  p_estado TEXT DEFAULT 'elegibles',
  p_buscar TEXT DEFAULT NULL,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_tz TEXT := 'America/Monterrey';
  v_estado TEXT;
  v_fuente TEXT;
  v_pasos SMALLINT[];
  v_etapas SMALLINT[];
  v_paso SMALLINT;
  v_buscar TEXT;
  v_page INT;
  v_size INT;
  v_offset INT;
BEGIN
  v_actor := public.__admin_require_super_admin();
  SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id = v_actor;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'admin_ingresos: organización del actor no disponible'
      USING ERRCODE = '22023';
  END IF;

  IF p_fecha_desde IS NOT NULL AND p_fecha_hasta IS NOT NULL AND p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'admin_ingresos: fecha_desde no puede ser mayor que fecha_hasta'
      USING ERRCODE = '22023';
  END IF;

  v_estado := lower(btrim(COALESCE(p_estado, 'elegibles')));
  IF v_estado NOT IN ('elegibles', 'pendientes', 'pagados') THEN
    RAISE EXCEPTION 'admin_ingresos: p_estado inválido (elegibles|pendientes|pagados)'
      USING ERRCODE = '22023';
  END IF;

  v_fuente := NULLIF(lower(btrim(COALESCE(p_monto_fuente, ''))), '');
  IF v_fuente IS NOT NULL AND v_fuente NOT IN ('mesa_actualizado', 'datos_generales') THEN
    RAISE EXCEPTION 'admin_ingresos: p_monto_fuente inválido'
      USING ERRCODE = '22023';
  END IF;

  v_buscar := NULLIF(btrim(COALESCE(p_buscar, '')), '');
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 25), 1), 100);
  v_offset := (v_page - 1) * v_size;

  IF p_pasos_visuales IS NULL OR cardinality(p_pasos_visuales) IS NULL
     OR cardinality(p_pasos_visuales) = 0 THEN
    v_pasos := ARRAY[1,2,3,4,5,6,7,8,9,10,11]::SMALLINT[];
  ELSE
    v_pasos := (SELECT array_agg(DISTINCT p ORDER BY p) FROM unnest(p_pasos_visuales) AS p);
  END IF;

  v_etapas := ARRAY[]::SMALLINT[];
  FOREACH v_paso IN ARRAY v_pasos LOOP
    IF v_paso = 3 THEN
      v_etapas := v_etapas || ARRAY[3, 4]::SMALLINT[];
    ELSIF v_paso <= 2 THEN
      v_etapas := v_etapas || ARRAY[v_paso]::SMALLINT[];
    ELSE
      v_etapas := v_etapas || ARRAY[(v_paso + 1)::SMALLINT];
    END IF;
  END LOOP;
  v_etapas := (SELECT array_agg(DISTINCT e ORDER BY e) FROM unnest(v_etapas) AS e);

  RETURN (
    WITH filtered AS (
      SELECT
        u.*,
        public.__map_etapa_interna_a_paso_visual(u.etapa_actual::INT) AS paso_visual
      FROM public.__ingresos_universe_rows(v_org) u
      WHERE u.ciclo_estado IS DISTINCT FROM 'cancelado'
        AND u.subestado IS DISTINCT FROM 'rechazado'
        AND u.ingreso_proyectado IS NOT NULL
        AND u.ingreso_proyectado > 0
        AND (p_asesor_ids IS NULL OR cardinality(p_asesor_ids) IS NULL OR cardinality(p_asesor_ids) = 0
             OR u.asesor_id = ANY (p_asesor_ids))
        AND u.etapa_actual = ANY (v_etapas)
        AND (v_fuente IS NULL OR u.monto_fuente = v_fuente)
        AND (p_porcentajes IS NULL OR cardinality(p_porcentajes) IS NULL OR cardinality(p_porcentajes) = 0
             OR u.porcentaje_cobro = ANY (p_porcentajes))
        AND (
          v_buscar IS NULL
          OR u.cliente_nombre ILIKE '%' || v_buscar || '%'
          OR COALESCE(u.nss, '') ILIKE '%' || v_buscar || '%'
        )
        AND (
          p_fecha_desde IS NULL
          OR (u.bio_aprobacion_at AT TIME ZONE v_tz)::date >= p_fecha_desde
        )
        AND (
          p_fecha_hasta IS NULL
          OR (u.bio_aprobacion_at AT TIME ZONE v_tz)::date <= p_fecha_hasta
        )
        AND (
          v_estado = 'elegibles'
          OR (v_estado = 'pendientes' AND u.ingreso_real IS NULL)
          OR (v_estado = 'pagados' AND u.ingreso_real IS NOT NULL)
        )
    ),
    counted AS (
      SELECT COUNT(*)::INT AS total FROM filtered
    ),
    page_rows AS (
      SELECT *
      FROM filtered f
      ORDER BY f.bio_aprobacion_at DESC NULLS LAST, f.expediente_id
      LIMIT v_size OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', c.total,
      'page', v_page,
      'page_size', v_size,
      'items', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'expediente_id', p.expediente_id,
              'cliente_nombre', p.cliente_nombre,
              'nss', p.nss,
              'asesor_id', p.asesor_id,
              'asesor_nombre', p.asesor_nombre,
              'etapa_actual', p.etapa_actual,
              'paso_visual', p.paso_visual,
              'subestado', p.subestado,
              'ciclo_estado', p.ciclo_estado,
              'bio_aprobacion_at', p.bio_aprobacion_at,
              'pago_concasa_at', p.reconocido_at,
              'monto_general', p.monto_general,
              'monto_actualizado', p.monto_actualizado,
              'monto_base', p.monto_base,
              'monto_fuente', p.monto_fuente,
              'porcentaje_cobro', p.porcentaje_cobro,
              'ingreso_proyectado', p.ingreso_proyectado,
              'ingreso_real', p.ingreso_real,
              'pendiente', GREATEST(
                COALESCE(p.ingreso_proyectado, 0) - COALESCE(p.ingreso_real, 0),
                0
              ),
              'is_historical_estimate', p.is_historical_estimate,
              'calculo',
                CASE
                  WHEN p.monto_base IS NOT NULL AND p.porcentaje_cobro IS NOT NULL THEN
                    format(
                      '%s × %s%% = %s',
                      to_char(p.monto_base, 'FM999,999,999,990.00'),
                      trim(to_char(p.porcentaje_cobro, 'FM999990.##')),
                      to_char(p.ingreso_proyectado, 'FM999,999,999,990.00')
                    )
                  ELSE NULL
                END
            )
            ORDER BY p.bio_aprobacion_at DESC NULLS LAST, p.expediente_id
          )
          FROM page_rows p
        ),
        '[]'::jsonb
      )
    )
    FROM counted c
  );
END;
$$;

COMMENT ON FUNCTION public.super_admin_list_ingresos_page(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT, INT, INT) IS
  'P134: detalle paginado de ingresos Super Admin. Solo super_admin. Sin N+1.';

REVOKE ALL ON FUNCTION public.super_admin_list_ingresos_page(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.super_admin_list_ingresos_page(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_list_ingresos_page(DATE, DATE, UUID[], TEXT, NUMERIC[], SMALLINT[], TEXT, TEXT, INT, INT)
  TO authenticated, service_role, postgres;
