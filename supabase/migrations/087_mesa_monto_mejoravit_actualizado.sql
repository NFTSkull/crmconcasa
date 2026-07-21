-- ConCasa CRM — P090: Monto actualizado Mejoravit (Mesa)
-- Columnas operativas en cliente_datos + historial append-only + RPCs escritura/lectura.
-- Integra precedencia en save_cliente_datos y upsert_editor_decision (reingreso).
-- No backfill. No UI. No Pagaré. P087 intacto.

-- =============================================================================
-- A) Helper: parse JSON montoMejoravit + resolve operativo
-- =============================================================================
CREATE OR REPLACE FUNCTION public.parse_monto_mejoravit_json(p_datos JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_txt TEXT;
  v_num NUMERIC(12,2);
BEGIN
  v_txt := NULLIF(
    btrim(COALESCE(p_datos->>'montoMejoravit', p_datos->>'monto_mejoravit', '')),
    ''
  );
  IF v_txt IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_num := replace(replace(v_txt, '$', ''), ',', '')::NUMERIC;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;
  IF v_num IS NULL OR v_num <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN round(v_num, 2);
END;
$$;

COMMENT ON FUNCTION public.parse_monto_mejoravit_json(JSONB) IS
  'P090: parsea datos.montoMejoravit; null si vacío/inválido/<=0.';

REVOKE ALL ON FUNCTION public.parse_monto_mejoravit_json(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parse_monto_mejoravit_json(JSONB) TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.resolve_monto_operativo_mejoravit(
  p_monto_actualizado NUMERIC,
  p_datos JSONB,
  p_monto_aprobado_editor NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_from_json NUMERIC(12,2);
BEGIN
  IF p_monto_actualizado IS NOT NULL AND p_monto_actualizado > 0 THEN
    RETURN round(p_monto_actualizado, 2);
  END IF;

  v_from_json := public.parse_monto_mejoravit_json(p_datos);
  IF v_from_json IS NOT NULL THEN
    RETURN v_from_json;
  END IF;

  IF p_monto_aprobado_editor IS NULL OR p_monto_aprobado_editor <= 0 THEN
    RETURN NULL;
  END IF;

  -- Fallback productivo vigente (igual que save_cliente_datos / reingreso Mejoravit)
  RETURN least(round(p_monto_aprobado_editor * 0.89, 2), 169000);
END;
$$;

COMMENT ON FUNCTION public.resolve_monto_operativo_mejoravit(NUMERIC, JSONB, NUMERIC) IS
  'P090: COALESCE(monto_mejoravit_actualizado, JSON montoMejoravit válido, fallback editor −11%/169000).';

REVOKE ALL ON FUNCTION public.resolve_monto_operativo_mejoravit(NUMERIC, JSONB, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_monto_operativo_mejoravit(NUMERIC, JSONB, NUMERIC)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- B) Columnas operativas en cliente_datos
-- =============================================================================
ALTER TABLE public.cliente_datos
  ADD COLUMN IF NOT EXISTS monto_mejoravit_actualizado NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS monto_mejoravit_actualizado_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS monto_mejoravit_actualizado_by UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS monto_mejoravit_actualizado_motivo TEXT NULL;

ALTER TABLE public.cliente_datos
  DROP CONSTRAINT IF EXISTS cliente_datos_monto_mejoravit_actualizado_pos;
ALTER TABLE public.cliente_datos
  ADD CONSTRAINT cliente_datos_monto_mejoravit_actualizado_pos
  CHECK (
    monto_mejoravit_actualizado IS NULL
    OR monto_mejoravit_actualizado > 0
  );

ALTER TABLE public.cliente_datos
  DROP CONSTRAINT IF EXISTS cliente_datos_monto_mejoravit_actualizado_consistente;
ALTER TABLE public.cliente_datos
  ADD CONSTRAINT cliente_datos_monto_mejoravit_actualizado_consistente
  CHECK (
    (
      monto_mejoravit_actualizado IS NULL
      AND monto_mejoravit_actualizado_at IS NULL
      AND monto_mejoravit_actualizado_by IS NULL
      AND monto_mejoravit_actualizado_motivo IS NULL
    )
    OR (
      monto_mejoravit_actualizado IS NOT NULL
      AND monto_mejoravit_actualizado_at IS NOT NULL
      AND monto_mejoravit_actualizado_by IS NOT NULL
      AND NULLIF(btrim(COALESCE(monto_mejoravit_actualizado_motivo, '')), '') IS NOT NULL
    )
  );

COMMENT ON COLUMN public.cliente_datos.monto_mejoravit_actualizado IS
  'P090: monto operativo Mejoravit actualizado por Mesa. Precedencia sobre datos.montoMejoravit. No es snapshot editorial.';
COMMENT ON COLUMN public.cliente_datos.monto_mejoravit_actualizado_at IS
  'P090: timestamp de la última actualización Mesa del monto operativo.';
COMMENT ON COLUMN public.cliente_datos.monto_mejoravit_actualizado_by IS
  'P090: perfil Mesa que realizó la última actualización operativa.';
COMMENT ON COLUMN public.cliente_datos.monto_mejoravit_actualizado_motivo IS
  'P090: motivo obligatorio de la última actualización operativa.';

-- =============================================================================
-- C) Historial append-only
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.expediente_monto_mejoravit_actualizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  monto_anterior NUMERIC(12,2) NOT NULL,
  monto_nuevo NUMERIC(12,2) NOT NULL,
  diferencia NUMERIC(12,2) NOT NULL,
  porcentaje_cobro NUMERIC(5,2) NOT NULL,
  monto_cobro_anterior NUMERIC(12,2) NULL,
  monto_cobro_nuevo NUMERIC(12,2) NOT NULL,
  motivo TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exp_monto_mej_act_anterior_pos CHECK (monto_anterior > 0),
  CONSTRAINT exp_monto_mej_act_nuevo_pos CHECK (monto_nuevo > 0),
  CONSTRAINT exp_monto_mej_act_distintos CHECK (monto_nuevo <> monto_anterior),
  CONSTRAINT exp_monto_mej_act_diferencia_ok CHECK (
    diferencia = round(monto_nuevo - monto_anterior, 2)
  ),
  CONSTRAINT exp_monto_mej_act_pct_rango CHECK (
    porcentaje_cobro > 0 AND porcentaje_cobro <= 100
  ),
  CONSTRAINT exp_monto_mej_act_cobro_nuevo_nonneg CHECK (monto_cobro_nuevo >= 0),
  CONSTRAINT exp_monto_mej_act_motivo_len CHECK (
    char_length(btrim(motivo)) BETWEEN 1 AND 500
  )
);

CREATE INDEX IF NOT EXISTS expediente_monto_mej_act_exp_created_idx
  ON public.expediente_monto_mejoravit_actualizaciones (expediente_id, created_at DESC);

CREATE INDEX IF NOT EXISTS expediente_monto_mej_act_org_created_idx
  ON public.expediente_monto_mejoravit_actualizaciones (organization_id, created_at DESC);

COMMENT ON TABLE public.expediente_monto_mejoravit_actualizaciones IS
  'P090: historial inmutable de actualizaciones de monto operativo Mejoravit por Mesa. Append-only.';

ALTER TABLE public.expediente_monto_mejoravit_actualizaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expediente_monto_mej_act_select ON public.expediente_monto_mejoravit_actualizaciones;
CREATE POLICY expediente_monto_mej_act_select
  ON public.expediente_monto_mejoravit_actualizaciones
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

-- Sin INSERT/UPDATE/DELETE para authenticated/anon (solo SECURITY DEFINER / owners)
REVOKE ALL ON TABLE public.expediente_monto_mejoravit_actualizaciones FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_monto_mejoravit_actualizaciones FROM anon;
GRANT SELECT ON TABLE public.expediente_monto_mejoravit_actualizaciones TO authenticated;
GRANT ALL ON TABLE public.expediente_monto_mejoravit_actualizaciones TO postgres, service_role;


-- =============================================================================
-- D) RPC escritura: mesa_actualizar_monto_mejoravit
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_actualizar_monto_mejoravit(
  p_expediente_id UUID,
  p_monto_nuevo NUMERIC,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp public.expedientes%ROWTYPE;
  v_cd public.cliente_datos%ROWTYPE;
  v_editor public.editor_decisions%ROWTYPE;
  v_monto_nuevo NUMERIC(12,2);
  v_motivo TEXT;
  v_monto_anterior NUMERIC(12,2);
  v_diferencia NUMERIC(12,2);
  v_cobro_nuevo NUMERIC(12,2);
  v_original NUMERIC(12,2);
  v_hist_id UUID;
  -- clock_timestamp: orden estable entre actualizaciones en la misma transacción (NOW() es fijo)
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_monto_nuevo IS NULL THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: monto nuevo es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_monto_nuevo := round(p_monto_nuevo::NUMERIC, 2);
  IF v_monto_nuevo <= 0 THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: el monto nuevo debe ser mayor que cero'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := btrim(COALESCE(p_motivo, ''));
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: el motivo es obligatorio'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: el motivo no puede exceder 500 caracteres'
      USING ERRCODE = '22023';
  END IF;

  -- Orden de bloqueo estable: expediente → cliente_datos
  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE OF e;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id
  FOR UPDATE OF cd;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: faltan datos del cliente para actualizar el monto'
      USING ERRCODE = '22023';
  END IF;

  IF v_cd.porcentaje_cobro IS NULL THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: falta el porcentaje de cobro'
      USING ERRCODE = '22023';
  END IF;

  IF v_cd.porcentaje_cobro <= 0 OR v_cd.porcentaje_cobro > 100 THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: porcentaje de cobro inválido'
      USING ERRCODE = '22023';
  END IF;

  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  v_monto_anterior := public.resolve_monto_operativo_mejoravit(
    v_cd.monto_mejoravit_actualizado,
    v_cd.datos,
    v_editor.monto_aprobado
  );

  IF v_monto_anterior IS NULL OR v_monto_anterior <= 0 THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: no hay monto operativo vigente resoluble'
      USING ERRCODE = '22023';
  END IF;

  IF v_monto_nuevo = v_monto_anterior THEN
    RAISE EXCEPTION 'mesa_actualizar_monto_mejoravit: El monto nuevo debe ser diferente al monto vigente.'
      USING ERRCODE = '22023';
  END IF;

  v_diferencia := round(v_monto_nuevo - v_monto_anterior, 2);
  v_cobro_nuevo := round(v_monto_nuevo * v_cd.porcentaje_cobro / 100 + 3000, 2);

  SELECT h.monto_anterior
  INTO v_original
  FROM public.expediente_monto_mejoravit_actualizaciones h
  WHERE h.expediente_id = p_expediente_id
  ORDER BY h.created_at ASC, h.id ASC
  LIMIT 1;

  IF v_original IS NULL THEN
    v_original := v_monto_anterior;
  END IF;

  INSERT INTO public.expediente_monto_mejoravit_actualizaciones (
    organization_id,
    expediente_id,
    monto_anterior,
    monto_nuevo,
    diferencia,
    porcentaje_cobro,
    monto_cobro_anterior,
    monto_cobro_nuevo,
    motivo,
    created_by,
    created_at
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_monto_anterior,
    v_monto_nuevo,
    v_diferencia,
    v_cd.porcentaje_cobro,
    v_cd.monto_calculado,
    v_cobro_nuevo,
    v_motivo,
    v_actor_id,
    v_now
  )
  RETURNING id INTO v_hist_id;

  UPDATE public.cliente_datos
  SET
    monto_mejoravit_actualizado = v_monto_nuevo,
    monto_mejoravit_actualizado_at = v_now,
    monto_mejoravit_actualizado_by = v_actor_id,
    monto_mejoravit_actualizado_motivo = v_motivo,
    monto_calculado = v_cobro_nuevo,
    updated_at = v_now
  WHERE expediente_id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'mesa.monto_mejoravit.updated',
    'cliente_datos',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'historial_id', v_hist_id,
      'monto_anterior', v_monto_anterior,
      'monto_nuevo', v_monto_nuevo,
      'diferencia', v_diferencia,
      'porcentaje_cobro', v_cd.porcentaje_cobro,
      'monto_cobro_anterior', v_cd.monto_calculado,
      'monto_cobro_nuevo', v_cobro_nuevo
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'monto_original_operativo', v_original,
    'monto_anterior', v_monto_anterior,
    'monto_nuevo', v_monto_nuevo,
    'diferencia', v_diferencia,
    'porcentaje_cobro', v_cd.porcentaje_cobro,
    'monto_cobro_anterior', v_cd.monto_calculado,
    'monto_cobro_nuevo', v_cobro_nuevo,
    'motivo', v_motivo,
    'updated_by', v_actor_id,
    'updated_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_actualizar_monto_mejoravit(UUID, NUMERIC, TEXT) IS
  'P090: Mesa actualiza monto operativo Mejoravit, historial append-only y recalcula cobro (% + 3000). No toca JSON datos ni snapshots.';

REVOKE ALL ON FUNCTION public.mesa_actualizar_monto_mejoravit(UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_actualizar_monto_mejoravit(UUID, NUMERIC, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_actualizar_monto_mejoravit(UUID, NUMERIC, TEXT)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- E) RPC lectura: get_expediente_monto_mejoravit_context
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_expediente_monto_mejoravit_context(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp public.expedientes%ROWTYPE;
  v_cd public.cliente_datos%ROWTYPE;
  v_editor public.editor_decisions%ROWTYPE;
  v_operativo NUMERIC(12,2);
  v_original NUMERIC(12,2);
  v_json_mej NUMERIC(12,2);
  v_can_update BOOLEAN := false;
  v_hist JSONB := '[]'::JSONB;
  v_ultima JSONB := NULL;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'get_expediente_monto_mejoravit_context: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'get_expediente_monto_mejoravit_context: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'get_expediente_monto_mejoravit_context: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'get_expediente_monto_mejoravit_context: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'get_expediente_monto_mejoravit_context: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'get_expediente_monto_mejoravit_context: no autorizado para ver este expediente'
      USING ERRCODE = '42501';
  END IF;

  SELECT cd.* INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  SELECT ed.* INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  v_json_mej := public.parse_monto_mejoravit_json(COALESCE(v_cd.datos, '{}'::JSONB));
  v_operativo := public.resolve_monto_operativo_mejoravit(
    v_cd.monto_mejoravit_actualizado,
    COALESCE(v_cd.datos, '{}'::JSONB),
    v_editor.monto_aprobado
  );

  SELECT h.monto_anterior INTO v_original
  FROM public.expediente_monto_mejoravit_actualizaciones h
  WHERE h.expediente_id = p_expediente_id
  ORDER BY h.created_at ASC, h.id ASC
  LIMIT 1;

  IF v_original IS NULL THEN
    v_original := v_operativo;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::JSONB ORDER BY x.created_at DESC, x.id DESC), '[]'::JSONB)
  INTO v_hist
  FROM (
    SELECT
      h.id,
      h.monto_anterior,
      h.monto_nuevo,
      h.diferencia,
      h.porcentaje_cobro,
      h.monto_cobro_anterior,
      h.monto_cobro_nuevo,
      h.motivo,
      h.created_at,
      h.created_by,
      NULLIF(btrim(COALESCE(p.full_name, '')), '') AS created_by_name
    FROM public.expediente_monto_mejoravit_actualizaciones h
    LEFT JOIN public.profiles p ON p.id = h.created_by
    WHERE h.expediente_id = p_expediente_id
  ) x;

  IF v_cd.monto_mejoravit_actualizado IS NOT NULL THEN
    v_ultima := jsonb_build_object(
      'monto_nuevo', v_cd.monto_mejoravit_actualizado,
      'motivo', v_cd.monto_mejoravit_actualizado_motivo,
      'updated_by', v_cd.monto_mejoravit_actualizado_by,
      'updated_at', v_cd.monto_mejoravit_actualizado_at,
      'updated_by_name', (
        SELECT NULLIF(btrim(COALESCE(p.full_name, '')), '')
        FROM public.profiles p
        WHERE p.id = v_cd.monto_mejoravit_actualizado_by
      )
    );
  END IF;

  v_can_update :=
    v_actor_role IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin')
    AND v_exp.ciclo_estado = 'activo'
    AND v_exp.deleted_at IS NULL
    AND v_exp.submitted_to_mesa IS TRUE
    AND public.can_see_expediente(p_expediente_id);

  RETURN jsonb_build_object(
    'expediente_id', p_expediente_id,
    'monto_aprobado_editor', v_editor.monto_aprobado,
    'monto_snapshot_primera_aprobacion', v_editor.monto_aprobado_al_aprobar,
    'monto_mejoravit_datos_generales', v_json_mej,
    'monto_mejoravit_actualizado', v_cd.monto_mejoravit_actualizado,
    'monto_operativo_vigente', v_operativo,
    'monto_original_operativo', v_original,
    'porcentaje_cobro', v_cd.porcentaje_cobro,
    'cargo_fijo', 3000,
    'monto_calculado', v_cd.monto_calculado,
    'ultima_actualizacion', v_ultima,
    'historial', v_hist,
    'can_update', v_can_update
  );
END;
$$;

COMMENT ON FUNCTION public.get_expediente_monto_mejoravit_context(UUID) IS
  'P090: contexto RO de monto Mejoravit (editorial/snapshot/operativo/historial). Historial DESC. cargo_fijo=3000.';

REVOKE ALL ON FUNCTION public.get_expediente_monto_mejoravit_context(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_expediente_monto_mejoravit_context(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_expediente_monto_mejoravit_context(UUID)
  TO authenticated, service_role, postgres;


-- =============================================================================
-- F) save_cliente_datos: precedencia P090 (no borra override)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.save_cliente_datos(
  p_expediente_id UUID,
  p_rfc TEXT,
  p_telefono TEXT,
  p_referencias JSONB DEFAULT '[]'::JSONB,
  p_imagenes JSONB DEFAULT NULL,
  p_datos JSONB DEFAULT '{}'::JSONB,
  p_estado public.cliente_datos_estado DEFAULT 'completo',
  p_porcentaje_cobro NUMERIC DEFAULT NULL,
  p_metodo_pago TEXT DEFAULT NULL,
  p_direccion_opcional TEXT DEFAULT NULL,
  p_monto_calculado_manual NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_prev public.cliente_datos%ROWTYPE;
  v_rfc TEXT;
  v_telefono_norm TEXT;
  v_referencias_norm JSONB := '[]'::JSONB;
  v_imagenes_norm JSONB;
  v_imagenes_final JSONB;
  v_datos_final JSONB;
  v_ref JSONB;
  v_img JSONB;
  v_nombre_raw TEXT;
  v_nombre_norm TEXT;
  v_ref_tel_raw TEXT;
  v_ref_tel_norm TEXT;
  v_ruta_imagen TEXT;
  v_mime TEXT;
  v_size NUMERIC;
  v_payload_phones TEXT[] := ARRAY[]::TEXT[];
  v_payload_names TEXT[] := ARRAY[]::TEXT[];
  v_updated_at TIMESTAMPTZ;
  v_referencias_count INTEGER;
  v_imagenes_count INTEGER;
  v_editor public.editor_decisions%ROWTYPE;
  v_monto_aprobado NUMERIC;
  v_porcentaje NUMERIC;
  v_metodo TEXT;
  v_monto_calculado NUMERIC(12,2);
  v_monto_calculado_auto NUMERIC(12,2);
  v_base_cobro NUMERIC(12,2);
  v_monto_mejoravit_actualizado NUMERIC(12,2);
  v_direccion TEXT;
  v_cliente_nombre_datos TEXT;
  v_estado_final public.cliente_datos_estado;
  i INTEGER;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_cliente_datos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'save_cliente_datos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente no encontrado'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente eliminado'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente no activo (%)', v_exp.ciclo_estado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.organization_id <> v_org_id THEN
    RAISE EXCEPTION 'save_cliente_datos: expediente de otra organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id <> v_actor_id THEN
    RAISE EXCEPTION 'save_cliente_datos: solo el asesor dueño puede guardar datos del cliente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa THEN
    IF current_setting('concasa.cliente_datos_correccion', true) IS DISTINCT FROM '1'
       AND current_setting('concasa.cliente_datos_actualizacion_post_mesa', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'save_cliente_datos: expediente ya enviado a Mesa'
        USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.cliente_datos cd
      WHERE cd.expediente_id = p_expediente_id
    ) THEN
      RAISE EXCEPTION 'save_cliente_datos: faltan datos del cliente en expediente enviado a Mesa'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_direccion := NULLIF(btrim(COALESCE(p_direccion_opcional, '')), '');
  v_cliente_nombre_datos := btrim(COALESCE(p_datos->>'nombreCliente', ''));

  UPDATE public.expedientes
  SET direccion_opcional = COALESCE(v_direccion, ''),
      cliente_nombre = CASE
        WHEN v_cliente_nombre_datos <> '' THEN v_cliente_nombre_datos
        ELSE cliente_nombre
      END,
      updated_at = NOW()
  WHERE id = p_expediente_id;

  -- Información de cobro (monto calculado automático)
  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND
     OR v_editor.monto_aprobado IS NULL
     OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'save_cliente_datos: No hay monto aprobado para calcular el cobro.'
      USING ERRCODE = '22023';
  END IF;

  v_monto_aprobado := v_editor.monto_aprobado;

  IF p_porcentaje_cobro IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: porcentaje de cobro es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_porcentaje := p_porcentaje_cobro::NUMERIC;

  IF v_porcentaje <= 0 OR v_porcentaje > 100 THEN
    RAISE EXCEPTION 'save_cliente_datos: porcentaje de cobro inválido'
      USING ERRCODE = '22023';
  END IF;

  v_metodo := btrim(COALESCE(p_metodo_pago, ''));
  IF v_metodo = '' THEN
    RAISE EXCEPTION 'save_cliente_datos: método de pago es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  -- P090: precedencia operativa (override Mesa > JSON > fallback editor)
  SELECT cd.monto_mejoravit_actualizado
  INTO v_monto_mejoravit_actualizado
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF lower(btrim(v_exp.programa::text)) = 'mejoravit' THEN
    v_base_cobro := public.resolve_monto_operativo_mejoravit(
      v_monto_mejoravit_actualizado,
      p_datos,
      v_monto_aprobado
    );
  ELSE
    v_base_cobro := v_monto_aprobado;
  END IF;

  v_monto_calculado_auto := round(v_base_cobro * v_porcentaje / 100 + 3000, 2);

  IF p_monto_calculado_manual IS NOT NULL THEN
    IF p_monto_calculado_manual <= 0 THEN
      RAISE EXCEPTION 'save_cliente_datos: monto calculado manual inválido'
        USING ERRCODE = '22023';
    END IF;
    v_monto_calculado := round(p_monto_calculado_manual, 2);
  ELSE
    v_monto_calculado := v_monto_calculado_auto;
  END IF;

  -- RFC (opcional: vacío permitido; si tiene valor, validar formato)
  v_rfc := upper(btrim(COALESCE(p_rfc, '')));
  IF v_rfc <> '' AND (length(v_rfc) NOT IN (12, 13) OR NOT public.is_rfc_mexico_valido(v_rfc)) THEN
    RAISE EXCEPTION 'save_cliente_datos: RFC inválido'
      USING ERRCODE = '22023';
  END IF;

  -- Teléfono principal
  IF NULLIF(btrim(COALESCE(p_telefono, '')), '') IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos: teléfono obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_telefono_norm := public.normalize_telefono_mexico(p_telefono);
  IF v_telefono_norm IS NULL OR length(v_telefono_norm) <> 10 OR v_telefono_norm !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'save_cliente_datos: teléfono inválido'
      USING ERRCODE = '22023';
  END IF;

  v_payload_phones := array_append(v_payload_phones, v_telefono_norm);

  -- Estado (asesor solo completo o pendiente)
  IF p_estado = 'validado' THEN
    RAISE EXCEPTION 'save_cliente_datos: asesor no puede marcar validado'
      USING ERRCODE = '22023';
  END IF;

  IF p_estado NOT IN ('completo', 'pendiente') THEN
    RAISE EXCEPTION 'save_cliente_datos: estado inválido'
      USING ERRCODE = '22023';
  END IF;

  -- Referencias
  IF p_referencias IS NULL OR jsonb_typeof(p_referencias) <> 'array' THEN
    RAISE EXCEPTION 'save_cliente_datos: referencias debe ser array'
      USING ERRCODE = '22023';
  END IF;

  FOR i IN 0..jsonb_array_length(p_referencias) - 1 LOOP
    v_ref := p_referencias->i;
    v_nombre_raw := btrim(COALESCE(v_ref->>'nombre', ''));
    IF v_nombre_raw = '' THEN
      RAISE EXCEPTION 'save_cliente_datos: nombre de referencia obligatorio'
        USING ERRCODE = '22023';
    END IF;

    v_nombre_norm := public.normalize_nombre_referencia(v_nombre_raw);
    IF v_nombre_norm = ANY(v_payload_names) THEN
      RAISE EXCEPTION 'save_cliente_datos: nombre de referencia repetido'
        USING ERRCODE = '22023';
    END IF;
    v_payload_names := array_append(v_payload_names, v_nombre_norm);

    v_ref_tel_raw := public.referencia_telefono_raw(v_ref);
    IF NULLIF(btrim(COALESCE(v_ref_tel_raw, '')), '') IS NULL THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono de referencia inválido'
        USING ERRCODE = '22023';
    END IF;

    v_ref_tel_norm := public.normalize_telefono_mexico(v_ref_tel_raw);
    IF v_ref_tel_norm IS NULL OR length(v_ref_tel_norm) <> 10 OR v_ref_tel_norm !~ '^[0-9]{10}$' THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono de referencia inválido'
        USING ERRCODE = '22023';
    END IF;

    IF v_ref_tel_norm = v_telefono_norm THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono repetido en referencias'
        USING ERRCODE = '22023';
    END IF;

    IF v_ref_tel_norm = ANY(v_payload_phones) THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono de referencia repetido'
        USING ERRCODE = '22023';
    END IF;
    v_payload_phones := array_append(v_payload_phones, v_ref_tel_norm);

    v_referencias_norm := v_referencias_norm || jsonb_build_array(
      jsonb_build_object(
        'nombre', v_nombre_raw,
        'telefono', v_ref_tel_norm,
        'celular', v_ref_tel_norm
      )
    );
  END LOOP;

  -- Duplicados cross-expediente (con lock por org+teléfono)
  FOR i IN 1..array_length(v_payload_phones, 1) LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext(v_org_id::text || ':' || v_payload_phones[i])
    );

    IF public.cliente_datos_telefono_ocupado_en_org(
      v_org_id,
      p_expediente_id,
      v_payload_phones[i]
    ) THEN
      IF v_payload_phones[i] = v_telefono_norm THEN
        RAISE EXCEPTION 'save_cliente_datos: teléfono repetido'
          USING ERRCODE = '22023';
      ELSE
        RAISE EXCEPTION 'save_cliente_datos: teléfono de referencia repetido'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  -- Imágenes (metadata/rutas; sin binarios)
  SELECT cd.*
  INTO v_prev
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF p_imagenes IS NULL THEN
    v_imagenes_final := COALESCE(v_prev.imagenes, '[]'::JSONB);
  ELSE
    IF jsonb_typeof(p_imagenes) <> 'array' THEN
      RAISE EXCEPTION 'save_cliente_datos: imagenes debe ser array'
        USING ERRCODE = '22023';
    END IF;

    v_imagenes_norm := '[]'::JSONB;
    FOR i IN 0..jsonb_array_length(p_imagenes) - 1 LOOP
      v_img := p_imagenes->i;
      v_ruta_imagen := NULLIF(
        btrim(
          COALESCE(
            v_img->>'storage_path',
            v_img->>'url',
            v_img->>'public_url',
            ''
          )
        ),
        ''
      );

      IF v_ruta_imagen IS NULL THEN
        RAISE EXCEPTION 'save_cliente_datos: imagen sin ruta'
          USING ERRCODE = '22023';
      END IF;

      IF v_img ? 'filename' AND NULLIF(btrim(COALESCE(v_img->>'filename', '')), '') IS NULL THEN
        RAISE EXCEPTION 'save_cliente_datos: imagen sin ruta'
          USING ERRCODE = '22023';
      END IF;

      IF v_img ? 'mime_type' THEN
        v_mime := lower(btrim(COALESCE(v_img->>'mime_type', '')));
        IF v_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
          RAISE EXCEPTION 'save_cliente_datos: mime_type de imagen inválido'
            USING ERRCODE = '22023';
        END IF;
      END IF;

      IF v_img ? 'size_bytes' THEN
        BEGIN
          v_size := (v_img->>'size_bytes')::NUMERIC;
        EXCEPTION
          WHEN OTHERS THEN
            RAISE EXCEPTION 'save_cliente_datos: size_bytes inválido'
              USING ERRCODE = '22023';
        END;

        IF v_size IS NULL OR v_size <= 0 THEN
          RAISE EXCEPTION 'save_cliente_datos: size_bytes inválido'
            USING ERRCODE = '22023';
        END IF;
      END IF;

      v_imagenes_norm := v_imagenes_norm || jsonb_build_array(
        jsonb_strip_nulls(
          jsonb_build_object(
            'storage_path', NULLIF(btrim(COALESCE(v_img->>'storage_path', '')), ''),
            'url', NULLIF(btrim(COALESCE(v_img->>'url', '')), ''),
            'public_url', NULLIF(btrim(COALESCE(v_img->>'public_url', '')), ''),
            'filename', NULLIF(btrim(COALESCE(v_img->>'filename', '')), ''),
            'mime_type', NULLIF(lower(btrim(COALESCE(v_img->>'mime_type', ''))), ''),
            'size_bytes', CASE
              WHEN v_img ? 'size_bytes' THEN (v_img->>'size_bytes')::BIGINT
              ELSE NULL
            END,
            'tipo', NULLIF(btrim(COALESCE(v_img->>'tipo', '')), '')
          )
        )
      );
    END LOOP;

    v_imagenes_final := v_imagenes_norm;
  END IF;

  v_datos_final := COALESCE(p_datos, '{}'::JSONB)
    || jsonb_build_object(
      'rfc', v_rfc,
      'celular', v_telefono_norm,
      'telefono', v_telefono_norm,
      'referencias', v_referencias_norm
    );

  BEGIN
    INSERT INTO public.cliente_datos (
      expediente_id,
      organization_id,
      datos,
      estado,
      telefono_normalizado,
      referencias,
      imagenes,
      updated_by,
      porcentaje_cobro,
      monto_calculado,
      metodo_pago
    ) VALUES (
      p_expediente_id,
      v_exp.organization_id,
      v_datos_final,
      p_estado,
      v_telefono_norm,
      v_referencias_norm,
      v_imagenes_final,
      v_actor_id,
      v_porcentaje,
      v_monto_calculado,
      v_metodo
    )
    ON CONFLICT (expediente_id) DO UPDATE SET
      datos = EXCLUDED.datos,
      estado = CASE
        WHEN current_setting('concasa.cliente_datos_actualizacion_post_mesa', true) = '1'
          THEN public.cliente_datos.estado
        ELSE EXCLUDED.estado
      END,
      telefono_normalizado = EXCLUDED.telefono_normalizado,
      referencias = EXCLUDED.referencias,
      imagenes = EXCLUDED.imagenes,
      updated_by = EXCLUDED.updated_by,
      porcentaje_cobro = EXCLUDED.porcentaje_cobro,
      monto_calculado = EXCLUDED.monto_calculado,
      metodo_pago = EXCLUDED.metodo_pago,
      comentario_rechazo = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.comentario_rechazo
      END,
      rejected_at = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.rejected_at
      END,
      rejected_by = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.rejected_by
      END,
      validated_at = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.validated_at
      END,
      validated_by = CASE
        WHEN current_setting('concasa.cliente_datos_correccion', true) = '1' THEN NULL
        ELSE public.cliente_datos.validated_by
      END,
      updated_at = NOW()
    RETURNING updated_at, estado INTO v_updated_at, v_estado_final;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'save_cliente_datos: teléfono repetido'
        USING ERRCODE = '22023';
  END;

  v_referencias_count := jsonb_array_length(v_referencias_norm);
  v_imagenes_count := jsonb_array_length(v_imagenes_final);

  IF v_estado_final IS NULL THEN
    SELECT cd.estado
    INTO v_estado_final
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    CASE
      WHEN current_setting('concasa.cliente_datos_correccion', true) = '1'
        THEN 'cliente_datos.correccion_post_mesa'
      WHEN current_setting('concasa.cliente_datos_actualizacion_post_mesa', true) = '1'
        THEN 'cliente_datos.actualizado_post_mesa'
      ELSE 'cliente_datos.save'
    END,
    'cliente_datos',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'rfc_anterior', COALESCE(v_prev.datos->>'rfc', NULL),
      'rfc_nuevo', v_rfc,
      'telefono_anterior', COALESCE(v_prev.telefono_normalizado, public.normalize_telefono_mexico(v_prev.datos->>'celular')),
      'telefono_nuevo', v_telefono_norm,
      'estado_anterior', COALESCE(v_prev.estado::TEXT, NULL),
      'estado_nuevo', COALESCE(v_estado_final::TEXT, p_estado::TEXT),
      'referencias_count', v_referencias_count,
      'imagenes_count', v_imagenes_count,
      'actor_id', v_actor_id,
      'direccion_opcional', v_direccion,
      'cliente_nombre_anterior', NULLIF(btrim(COALESCE(v_exp.cliente_nombre, '')), ''),
      'cliente_nombre_nuevo', NULLIF(v_cliente_nombre_datos, '')
    )
  );

  PERFORM set_config('concasa.cliente_datos_correccion', '', true);
  PERFORM set_config('concasa.cliente_datos_actualizacion_post_mesa', '', true);

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'rfc', v_rfc,
    'telefono', v_telefono_norm,
    'estado', COALESCE(v_estado_final, p_estado),
    'referencias_count', v_referencias_count,
    'imagenes_count', v_imagenes_count,
    'porcentaje_cobro', v_porcentaje,
    'monto_calculado', v_monto_calculado,
    'metodo_pago', v_metodo,
    'direccion_opcional', v_direccion,
    'updated_at', v_updated_at
  );
END;
$$;


COMMENT ON FUNCTION public.save_cliente_datos(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, public.cliente_datos_estado, NUMERIC, TEXT, TEXT, NUMERIC) IS
  'Asesor dueño guarda/actualiza cliente_datos. RFC opcional; domicilio opcional; nombre en p_datos actualiza expedientes.cliente_nombre; cobro automático (+$3,000) o manual vía p_monto_calculado_manual; Mejoravit usa monto_mejoravit_actualizado (P090) > montoMejoravit JSON > fallback −11% tope 169000. No borra override Mesa.';

REVOKE ALL ON FUNCTION public.save_cliente_datos(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, public.cliente_datos_estado, NUMERIC, TEXT, TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_cliente_datos(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, public.cliente_datos_estado, NUMERIC, TEXT, TEXT, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_cliente_datos(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, public.cliente_datos_estado, NUMERIC, TEXT, TEXT, NUMERIC)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- G) upsert_editor_decision (reingreso): respeta monto_mejoravit_actualizado
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_editor_decision(
  p_expediente_id UUID,
  p_decision public.editor_decision,
  p_monto_aprobado NUMERIC DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_prev public.editor_decisions%ROWTYPE;
  v_monto NUMERIC(14, 2);
  v_motivo TEXT;
  v_base NUMERIC(12, 2);
  v_aprobado_at TIMESTAMPTZ;
  v_monto_al_aprobar NUMERIC(14, 2);
  v_no_cumple_at TIMESTAMPTZ;
  v_override NUMERIC(12, 2);
  v_datos JSONB;
  v_pct NUMERIC(5, 2);
BEGIN
  IF NOT public.es_reingreso_post_biometricos_valido(p_expediente_id) THEN
    RETURN public.upsert_editor_decision_pre_reingreso(
      p_expediente_id, p_decision, p_monto_aprobado, p_motivo
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'editor' THEN
    RAISE EXCEPTION 'upsert_editor_decision: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  JOIN public.expediente_rechazos_operativos r
    ON r.id = e.reingreso_rechazo_id
   AND r.expediente_id = e.expediente_anterior_id
  WHERE e.id = p_expediente_id
    AND e.organization_id = v_actor.organization_id
    AND e.etapa_actual = 6
    AND e.ciclo_estado = 'activo'
    AND e.subestado = 'en_proceso'
    AND e.submitted_to_mesa = true
    AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_editor_decision: reingreso no válido'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision IS NULL THEN
    RAISE EXCEPTION 'upsert_editor_decision: decision es obligatoria'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'aprobado' AND (p_monto_aprobado IS NULL OR p_monto_aprobado <= 0) THEN
    RAISE EXCEPTION 'REENTRY_AMOUNT_PENDING: monto aprobado debe ser mayor a cero'
      USING ERRCODE = '22023';
  END IF;

  v_monto := CASE WHEN p_decision = 'aprobado'
    THEN round(p_monto_aprobado::NUMERIC, 2) ELSE NULL END;
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  SELECT ed.* INTO v_prev
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF p_decision = 'aprobado'
     AND (NOT FOUND OR v_prev.aprobado_at IS NULL)
     AND (NOT FOUND OR v_prev.decision IS DISTINCT FROM 'aprobado'::public.editor_decision)
  THEN
    v_aprobado_at := NOW();
    v_monto_al_aprobar := v_monto;
  ELSIF FOUND THEN
    v_aprobado_at := v_prev.aprobado_at;
    v_monto_al_aprobar := v_prev.monto_aprobado_al_aprobar;
  ELSE
    v_aprobado_at := NULL;
    v_monto_al_aprobar := NULL;
  END IF;

  IF p_decision = 'no_cumple'
     AND (NOT FOUND OR v_prev.no_cumple_at IS NULL)
     AND (NOT FOUND OR v_prev.decision IS DISTINCT FROM 'no_cumple'::public.editor_decision)
  THEN
    v_no_cumple_at := NOW();
  ELSIF FOUND THEN
    v_no_cumple_at := v_prev.no_cumple_at;
  ELSE
    v_no_cumple_at := NULL;
  END IF;

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision, decided_by,
    aprobado_at, monto_aprobado_al_aprobar, no_cumple_at
  ) VALUES (
    p_expediente_id, v_exp.organization_id, p_decision, v_monto,
    COALESCE(v_motivo, ''), v_actor_id,
    v_aprobado_at, v_monto_al_aprobar, v_no_cumple_at
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    notas_revision = CASE WHEN v_motivo IS NOT NULL
      THEN EXCLUDED.notas_revision ELSE public.editor_decisions.notas_revision END,
    decided_by = EXCLUDED.decided_by,
    updated_at = NOW(),
    aprobado_at = CASE
      WHEN public.editor_decisions.aprobado_at IS NULL
           AND EXCLUDED.decision = 'aprobado'::public.editor_decision
           AND public.editor_decisions.decision IS DISTINCT FROM 'aprobado'::public.editor_decision
      THEN NOW()
      ELSE public.editor_decisions.aprobado_at
    END,
    monto_aprobado_al_aprobar = CASE
      WHEN public.editor_decisions.aprobado_at IS NULL
           AND EXCLUDED.decision = 'aprobado'::public.editor_decision
           AND public.editor_decisions.decision IS DISTINCT FROM 'aprobado'::public.editor_decision
      THEN EXCLUDED.monto_aprobado
      ELSE public.editor_decisions.monto_aprobado_al_aprobar
    END,
    no_cumple_at = CASE
      WHEN public.editor_decisions.no_cumple_at IS NULL
           AND EXCLUDED.decision = 'no_cumple'::public.editor_decision
           AND public.editor_decisions.decision IS DISTINCT FROM 'no_cumple'::public.editor_decision
      THEN NOW()
      ELSE public.editor_decisions.no_cumple_at
    END;

  IF p_decision = 'aprobado' THEN
    SELECT cd.monto_mejoravit_actualizado, cd.datos, cd.porcentaje_cobro
    INTO v_override, v_datos, v_pct
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;

    IF v_exp.programa = 'mejoravit' THEN
      v_base := public.resolve_monto_operativo_mejoravit(v_override, v_datos, v_monto);
    ELSE
      v_base := v_monto;
    END IF;

    UPDATE public.cliente_datos
    SET monto_calculado = CASE
          WHEN porcentaje_cobro IS NULL THEN NULL
          WHEN v_base IS NULL THEN NULL
          ELSE round(v_base * porcentaje_cobro / 100 + 3000, 2)
        END,
        updated_at = NOW()
    WHERE expediente_id = p_expediente_id;
    -- No toca monto_mejoravit_actualizado / at / by / motivo
  ELSE
    UPDATE public.cliente_datos
    SET monto_calculado = NULL, updated_at = NOW()
    WHERE expediente_id = p_expediente_id;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'editor.decision.upsert',
    'editor_decision',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'decision_anterior', v_prev.decision,
      'decision_nueva', p_decision,
      'monto_anterior', v_prev.monto_aprobado,
      'monto_nuevo', v_monto,
      'motivo', v_motivo,
      'reingreso', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'decision', p_decision,
    'monto_aprobado', v_monto,
    'editor_id', v_actor_id
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_editor_decision(UUID, public.editor_decision, NUMERIC, TEXT) IS
  'P081/P083/P090: editor reingreso. Snapshots intactos. Cobro Mejoravit respeta monto_mejoravit_actualizado si existe.';

REVOKE ALL ON FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_editor_decision(
  UUID, public.editor_decision, NUMERIC, TEXT
) TO authenticated, service_role, postgres;
