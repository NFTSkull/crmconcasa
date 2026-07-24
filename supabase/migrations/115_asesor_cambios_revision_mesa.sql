-- ConCasa CRM — P130: lotes de cambios del asesor para revisión Mesa
-- Captura original→final en mutaciones canónicas de corrección:
--   register_expediente_documento_correccion (047)
--   save_cliente_datos_correccion (055, 10 params)
-- Read-model batch/detalle para bandeja; sin redefinir mesa_list_bandeja_page.

-- =============================================================================
-- Enums
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE public.asesor_cambio_lote_status AS ENUM (
    'borrador',
    'pendiente_revision',
    'revisado'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.asesor_cambio_tipo AS ENUM (
    'campo_actualizado',
    'documento_agregado',
    'documento_reemplazado',
    'documento_eliminado'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- Tablas
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.expediente_asesor_cambio_lotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes (id) ON DELETE CASCADE,
  asesor_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  correccion_ciclo_key TEXT NOT NULL DEFAULT 'post_mesa',
  status public.asesor_cambio_lote_status NOT NULL DEFAULT 'borrador',
  submitted_at TIMESTAMPTZ NULL,
  reviewed_by UUID NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS expediente_asesor_cambio_lotes_one_borrador_idx
  ON public.expediente_asesor_cambio_lotes (organization_id, expediente_id, correccion_ciclo_key)
  WHERE status = 'borrador';

CREATE INDEX IF NOT EXISTS expediente_asesor_cambio_lotes_exp_status_idx
  ON public.expediente_asesor_cambio_lotes (expediente_id, status, submitted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS expediente_asesor_cambio_lotes_org_exp_idx
  ON public.expediente_asesor_cambio_lotes (organization_id, expediente_id, created_at DESC);

DROP TRIGGER IF EXISTS expediente_asesor_cambio_lotes_set_updated_at
  ON public.expediente_asesor_cambio_lotes;
CREATE TRIGGER expediente_asesor_cambio_lotes_set_updated_at
  BEFORE UPDATE ON public.expediente_asesor_cambio_lotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.expediente_asesor_cambio_lotes IS
  'P130: lote de cambios del asesor por ciclo de corrección (borrador → pendiente_revision → revisado).';

CREATE TABLE IF NOT EXISTS public.expediente_asesor_cambios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES public.expediente_asesor_cambio_lotes (id) ON DELETE CASCADE,
  change_key TEXT NOT NULL,
  tipo public.asesor_cambio_tipo NOT NULL,
  entidad TEXT NULL,
  campo TEXT NULL,
  document_kind TEXT NULL,
  label TEXT NOT NULL DEFAULT '',
  valor_anterior JSONB NULL,
  valor_nuevo JSONB NULL,
  documento_anterior_id UUID NULL REFERENCES public.expediente_documentos (id) ON DELETE SET NULL,
  documento_nuevo_id UUID NULL REFERENCES public.expediente_documentos (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_asesor_cambios_lote_change_key_unique UNIQUE (lote_id, change_key)
);

CREATE INDEX IF NOT EXISTS expediente_asesor_cambios_lote_created_idx
  ON public.expediente_asesor_cambios (lote_id, created_at ASC);

COMMENT ON TABLE public.expediente_asesor_cambios IS
  'P130: cambios individuales del asesor (original→final) dentro de un lote; escritura solo vía helpers SECURITY DEFINER.';

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.expediente_asesor_cambio_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expediente_asesor_cambios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expediente_asesor_cambio_lotes_select ON public.expediente_asesor_cambio_lotes;
CREATE POLICY expediente_asesor_cambio_lotes_select
  ON public.expediente_asesor_cambio_lotes
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

DROP POLICY IF EXISTS expediente_asesor_cambios_select ON public.expediente_asesor_cambios;
CREATE POLICY expediente_asesor_cambios_select
  ON public.expediente_asesor_cambios
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.expediente_asesor_cambio_lotes l
      WHERE l.id = lote_id
        AND public.can_see_expediente(l.expediente_id)
    )
  );

REVOKE ALL ON TABLE public.expediente_asesor_cambio_lotes FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_asesor_cambio_lotes FROM anon;
REVOKE ALL ON TABLE public.expediente_asesor_cambio_lotes FROM authenticated;
GRANT SELECT ON TABLE public.expediente_asesor_cambio_lotes TO authenticated;
GRANT ALL ON TABLE public.expediente_asesor_cambio_lotes TO service_role;

REVOKE ALL ON TABLE public.expediente_asesor_cambios FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_asesor_cambios FROM anon;
REVOKE ALL ON TABLE public.expediente_asesor_cambios FROM authenticated;
GRANT SELECT ON TABLE public.expediente_asesor_cambios TO authenticated;
GRANT ALL ON TABLE public.expediente_asesor_cambios TO service_role;

-- =============================================================================
-- Helpers internos (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_cambio_doc_label(p_tipo TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(btrim(COALESCE(p_tipo, '')))
    WHEN 'ine' THEN 'INE'
    WHEN 'estado_cuenta' THEN 'Estado de cuenta'
    WHEN 'nss' THEN 'NSS'
    WHEN 'direccion' THEN 'Comprobante de domicilio'
    WHEN 'cliente_ine_frente' THEN 'INE frente'
    WHEN 'cliente_ine_reverso' THEN 'INE reverso'
    WHEN 'cliente_comprobante_domicilio' THEN 'Comprobante de domicilio'
    WHEN 'cliente_estado_cuenta' THEN 'Estado de cuenta'
    WHEN 'cliente_acta_nacimiento' THEN 'Acta de nacimiento'
    WHEN 'cliente_constancia_sat' THEN 'Constancia SAT'
    WHEN 'cliente_semanas_cotizadas' THEN 'Semanas cotizadas'
    WHEN 'cliente_historial_laboral' THEN 'Historial laboral'
    WHEN 'cliente_carta_empresa' THEN 'Carta de la empresa'
    WHEN 'cliente_acta_nacimiento_digital' THEN 'Acta de nacimiento digital'
    WHEN 'cliente_notificacion_apodaca' THEN 'Notificación Apodaca'
    WHEN 'cliente_pagare' THEN 'Pagaré'
    WHEN 'cliente_notificacion' THEN 'Notificación'
    WHEN 'cliente_solicitud' THEN 'Solicitud'
    WHEN 'retencion_acuse_con_sello' THEN 'Acuse con sello'
    WHEN 'retencion_aviso_retencion' THEN 'Aviso de retención'
    WHEN 'retencion_ine_frente' THEN 'Retención INE frente'
    WHEN 'retencion_ine_reverso' THEN 'Retención INE reverso'
    WHEN 'retencion_carta_sin_sello' THEN 'Carta sin sello'
    WHEN 'asesor_ine_frente' THEN 'Asesor INE frente'
    WHEN 'asesor_ine_reverso' THEN 'Asesor INE reverso'
    WHEN 'asesor_estado_cuenta' THEN 'Asesor estado de cuenta'
    WHEN 'asesor_recibo_luz' THEN 'Asesor recibo de luz'
    ELSE COALESCE(NULLIF(btrim(p_tipo), ''), 'Documento')
  END;
$$;

CREATE OR REPLACE FUNCTION public.asesor_cambio_ensure_open_lote(
  p_organization_id UUID,
  p_expediente_id UUID,
  p_asesor_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote_id UUID;
  v_ciclo TEXT := 'post_mesa';
BEGIN
  IF p_organization_id IS NULL OR p_expediente_id IS NULL OR p_asesor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_cambio_ensure_open_lote: parámetros obligatorios'
      USING ERRCODE = '22023';
  END IF;

  SELECT l.id
  INTO v_lote_id
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.organization_id = p_organization_id
    AND l.expediente_id = p_expediente_id
    AND l.correccion_ciclo_key = v_ciclo
    AND l.status = 'borrador'
  ORDER BY l.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_lote_id IS NOT NULL THEN
    RETURN v_lote_id;
  END IF;

  SELECT l.id
  INTO v_lote_id
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.organization_id = p_organization_id
    AND l.expediente_id = p_expediente_id
    AND l.correccion_ciclo_key = v_ciclo
    AND l.status = 'pendiente_revision'
  ORDER BY l.submitted_at DESC NULLS LAST, l.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_lote_id IS NOT NULL THEN
    RETURN v_lote_id;
  END IF;

  INSERT INTO public.expediente_asesor_cambio_lotes (
    organization_id,
    expediente_id,
    asesor_id,
    correccion_ciclo_key,
    status
  ) VALUES (
    p_organization_id,
    p_expediente_id,
    p_asesor_id,
    v_ciclo,
    'borrador'
  )
  RETURNING id INTO v_lote_id;

  RETURN v_lote_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.asesor_cambio_upsert(
  p_lote_id UUID,
  p_change_key TEXT,
  p_tipo public.asesor_cambio_tipo,
  p_entidad TEXT,
  p_campo TEXT,
  p_document_kind TEXT,
  p_label TEXT,
  p_valor_anterior JSONB,
  p_valor_nuevo JSONB,
  p_documento_anterior_id UUID DEFAULT NULL,
  p_documento_nuevo_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.expediente_asesor_cambios%ROWTYPE;
  v_key TEXT;
BEGIN
  v_key := NULLIF(btrim(COALESCE(p_change_key, '')), '');
  IF p_lote_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'asesor_cambio_upsert: lote_id y change_key obligatorios'
      USING ERRCODE = '22023';
  END IF;

  -- Si el campo vuelve al valor original del lote, retirar el cambio.
  IF p_tipo = 'campo_actualizado'
     AND p_valor_nuevo IS NOT DISTINCT FROM p_valor_anterior THEN
    DELETE FROM public.expediente_asesor_cambios c
    WHERE c.lote_id = p_lote_id
      AND c.change_key = v_key;
    RETURN;
  END IF;

  SELECT c.*
  INTO v_existing
  FROM public.expediente_asesor_cambios c
  WHERE c.lote_id = p_lote_id
    AND c.change_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    -- Regresar al original guardado → eliminar
    IF p_tipo = 'campo_actualizado'
       AND p_valor_nuevo IS NOT DISTINCT FROM v_existing.valor_anterior THEN
      DELETE FROM public.expediente_asesor_cambios c
      WHERE c.id = v_existing.id;
      RETURN;
    END IF;

    IF p_tipo IN ('documento_reemplazado', 'documento_agregado', 'documento_eliminado')
       AND p_documento_nuevo_id IS NOT DISTINCT FROM v_existing.documento_anterior_id THEN
      DELETE FROM public.expediente_asesor_cambios c
      WHERE c.id = v_existing.id;
      RETURN;
    END IF;

    UPDATE public.expediente_asesor_cambios
    SET
      tipo = p_tipo,
      entidad = COALESCE(p_entidad, entidad),
      campo = COALESCE(p_campo, campo),
      document_kind = COALESCE(p_document_kind, document_kind),
      label = COALESCE(NULLIF(btrim(p_label), ''), label),
      valor_nuevo = p_valor_nuevo,
      documento_nuevo_id = COALESCE(p_documento_nuevo_id, documento_nuevo_id)
      -- conservar valor_anterior / documento_anterior_id originales
    WHERE id = v_existing.id;
    RETURN;
  END IF;

  INSERT INTO public.expediente_asesor_cambios (
    lote_id,
    change_key,
    tipo,
    entidad,
    campo,
    document_kind,
    label,
    valor_anterior,
    valor_nuevo,
    documento_anterior_id,
    documento_nuevo_id
  ) VALUES (
    p_lote_id,
    v_key,
    p_tipo,
    p_entidad,
    p_campo,
    p_document_kind,
    COALESCE(NULLIF(btrim(p_label), ''), v_key),
    p_valor_anterior,
    p_valor_nuevo,
    p_documento_anterior_id,
    p_documento_nuevo_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.asesor_cambio_freeze_lote(p_lote_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_lote_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.expediente_asesor_cambio_lotes
  SET
    status = 'pendiente_revision',
    submitted_at = COALESCE(submitted_at, NOW()),
    reviewed_by = NULL,
    reviewed_at = NULL,
    updated_at = NOW()
  WHERE id = p_lote_id
    AND status IN ('borrador', 'pendiente_revision', 'revisado');
END;
$$;

CREATE OR REPLACE FUNCTION public.asesor_cambio_record_doc_reemplazo(
  p_organization_id UUID,
  p_expediente_id UUID,
  p_asesor_id UUID,
  p_document_kind TEXT,
  p_documento_anterior_id UUID,
  p_documento_nuevo_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote_id UUID;
  v_kind TEXT;
  v_base TEXT;
  v_label TEXT;
BEGIN
  v_kind := NULLIF(btrim(COALESCE(p_document_kind, '')), '');
  IF v_kind IS NULL OR p_documento_nuevo_id IS NULL THEN
    RETURN;
  END IF;

  v_lote_id := public.asesor_cambio_ensure_open_lote(
    p_organization_id,
    p_expediente_id,
    p_asesor_id
  );

  v_base := public.asesor_cambio_doc_label(v_kind);
  -- Femenino para INE frente/reverso; resto masculino
  IF v_kind IN (
    'cliente_ine_frente', 'cliente_ine_reverso', 'ine',
    'retencion_ine_frente', 'retencion_ine_reverso',
    'asesor_ine_frente', 'asesor_ine_reverso'
  ) THEN
    v_label := v_base || ' reemplazada';
  ELSE
    v_label := v_base || ' reemplazado';
  END IF;

  PERFORM public.asesor_cambio_upsert(
    v_lote_id,
    'doc:' || v_kind,
    'documento_reemplazado'::public.asesor_cambio_tipo,
    'expediente_documento',
    NULL,
    v_kind,
    v_label,
    NULL,
    NULL,
    p_documento_anterior_id,
    p_documento_nuevo_id
  );

  PERFORM public.asesor_cambio_freeze_lote(v_lote_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.asesor_cambio_record_cliente_datos_diff(
  p_before public.cliente_datos,
  p_after public.cliente_datos
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote_id UUID;
  v_asesor_id UUID;
  v_dir_before TEXT;
  v_dir_after TEXT;
  v_before_val JSONB;
  v_after_val JSONB;
  v_rfc_b TEXT;
  v_rfc_a TEXT;
  v_tel_b TEXT;
  v_tel_a TEXT;
BEGIN
  IF p_after.expediente_id IS NULL OR p_after.organization_id IS NULL THEN
    RETURN;
  END IF;

  SELECT e.asesor_id
  INTO v_asesor_id
  FROM public.expedientes e
  WHERE e.id = p_after.expediente_id;

  v_asesor_id := COALESCE(p_after.updated_by, p_before.updated_by, v_asesor_id);
  IF v_asesor_id IS NULL THEN
    RETURN;
  END IF;

  v_lote_id := public.asesor_cambio_ensure_open_lote(
    p_after.organization_id,
    p_after.expediente_id,
    v_asesor_id
  );

  IF v_lote_id IS NULL THEN
    RETURN;
  END IF;

  -- RFC (columna lógica vía datos)
  v_rfc_b := NULLIF(upper(btrim(COALESCE(p_before.datos->>'rfc', ''))), '');
  v_rfc_a := NULLIF(upper(btrim(COALESCE(p_after.datos->>'rfc', ''))), '');
  IF v_rfc_b IS DISTINCT FROM v_rfc_a THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:rfc',
      'campo_actualizado',
      'cliente_datos',
      'rfc',
      NULL,
      'RFC actualizado',
      to_jsonb(v_rfc_b),
      to_jsonb(v_rfc_a),
      NULL,
      NULL
    );
  END IF;

  -- Teléfono
  v_tel_b := NULLIF(btrim(COALESCE(
    p_before.telefono_normalizado,
    p_before.datos->>'telefono',
    p_before.datos->>'celular',
    ''
  )), '');
  v_tel_a := NULLIF(btrim(COALESCE(
    p_after.telefono_normalizado,
    p_after.datos->>'telefono',
    p_after.datos->>'celular',
    ''
  )), '');
  IF v_tel_b IS DISTINCT FROM v_tel_a THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:telefono',
      'campo_actualizado',
      'cliente_datos',
      'telefono',
      NULL,
      'Teléfono actualizado',
      to_jsonb(v_tel_b),
      to_jsonb(v_tel_a),
      NULL,
      NULL
    );
  END IF;

  -- Domicilio (expedientes.direccion_opcional; before vía GUC)
  v_dir_before := NULLIF(btrim(COALESCE(
    NULLIF(current_setting('concasa.asesor_cambio_direccion_before', true), ''),
    ''
  )), '');
  SELECT NULLIF(btrim(COALESCE(e.direccion_opcional, '')), '')
  INTO v_dir_after
  FROM public.expedientes e
  WHERE e.id = p_after.expediente_id;

  IF v_dir_before IS DISTINCT FROM v_dir_after THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:direccion_opcional',
      'campo_actualizado',
      'expediente',
      'direccion_opcional',
      NULL,
      'Dirección actualizada',
      to_jsonb(v_dir_before),
      to_jsonb(v_dir_after),
      NULL,
      NULL
    );
  END IF;

  -- porcentaje_cobro
  IF p_before.porcentaje_cobro IS DISTINCT FROM p_after.porcentaje_cobro THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:porcentaje_cobro',
      'campo_actualizado',
      'cliente_datos',
      'porcentaje_cobro',
      NULL,
      'Porcentaje de cobro actualizado',
      to_jsonb(p_before.porcentaje_cobro),
      to_jsonb(p_after.porcentaje_cobro),
      NULL,
      NULL
    );
  END IF;

  -- metodo_pago
  IF NULLIF(btrim(COALESCE(p_before.metodo_pago, '')), '')
     IS DISTINCT FROM NULLIF(btrim(COALESCE(p_after.metodo_pago, '')), '') THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:metodo_pago',
      'campo_actualizado',
      'cliente_datos',
      'metodo_pago',
      NULL,
      'Método de pago actualizado',
      to_jsonb(NULLIF(btrim(COALESCE(p_before.metodo_pago, '')), '')),
      to_jsonb(NULLIF(btrim(COALESCE(p_after.metodo_pago, '')), '')),
      NULL,
      NULL
    );
  END IF;

  -- monto_calculado_manual (columna monto_calculado)
  IF p_before.monto_calculado IS DISTINCT FROM p_after.monto_calculado THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:monto_calculado_manual',
      'campo_actualizado',
      'cliente_datos',
      'monto_calculado_manual',
      NULL,
      'Monto calculado actualizado',
      to_jsonb(p_before.monto_calculado),
      to_jsonb(p_after.monto_calculado),
      NULL,
      NULL
    );
  END IF;

  -- referencias
  IF COALESCE(p_before.referencias, '[]'::JSONB)
     IS DISTINCT FROM COALESCE(p_after.referencias, '[]'::JSONB) THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:referencias',
      'campo_actualizado',
      'cliente_datos',
      'referencias',
      NULL,
      'Referencias actualizadas',
      COALESCE(p_before.referencias, '[]'::JSONB),
      COALESCE(p_after.referencias, '[]'::JSONB),
      NULL,
      NULL
    );
  END IF;

  -- datos keys: nombreCliente, notaMesa, montoMejoravit, plazo
  -- nombreCliente
  v_before_val := to_jsonb(NULLIF(btrim(COALESCE(p_before.datos->>'nombreCliente', '')), ''));
  v_after_val := to_jsonb(NULLIF(btrim(COALESCE(p_after.datos->>'nombreCliente', '')), ''));
  IF v_before_val IS DISTINCT FROM v_after_val THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:nombreCliente',
      'campo_actualizado',
      'cliente_datos',
      'nombreCliente',
      NULL,
      'Nombre del cliente actualizado',
      v_before_val,
      v_after_val,
      NULL,
      NULL
    );
  END IF;

  -- notaMesa
  v_before_val := to_jsonb(NULLIF(btrim(COALESCE(
    p_before.datos->>'notaMesa',
    p_before.datos->>'notasMesa',
    ''
  )), ''));
  v_after_val := to_jsonb(NULLIF(btrim(COALESCE(
    p_after.datos->>'notaMesa',
    p_after.datos->>'notasMesa',
    ''
  )), ''));
  IF v_before_val IS DISTINCT FROM v_after_val THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:notaMesa',
      'campo_actualizado',
      'cliente_datos',
      'notaMesa',
      NULL,
      'Notas para Mesa actualizadas',
      v_before_val,
      v_after_val,
      NULL,
      NULL
    );
  END IF;

  -- montoMejoravit
  v_before_val := COALESCE(
    p_before.datos->'montoMejoravit',
    p_before.datos->'monto_mejoravit'
  );
  v_after_val := COALESCE(
    p_after.datos->'montoMejoravit',
    p_after.datos->'monto_mejoravit'
  );
  IF v_before_val IS DISTINCT FROM v_after_val THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:montoMejoravit',
      'campo_actualizado',
      'cliente_datos',
      'montoMejoravit',
      NULL,
      'Monto Mejoravit actualizado',
      v_before_val,
      v_after_val,
      NULL,
      NULL
    );
  END IF;

  -- plazo
  v_before_val := COALESCE(p_before.datos->'plazo', to_jsonb(NULLIF(btrim(COALESCE(p_before.datos->>'plazo', '')), '')));
  v_after_val := COALESCE(p_after.datos->'plazo', to_jsonb(NULLIF(btrim(COALESCE(p_after.datos->>'plazo', '')), '')));
  -- Normalize empty string jsonb "" vs null
  IF (CASE WHEN v_before_val = '""'::JSONB OR v_before_val = 'null'::JSONB THEN NULL ELSE v_before_val END)
     IS DISTINCT FROM
     (CASE WHEN v_after_val = '""'::JSONB OR v_after_val = 'null'::JSONB THEN NULL ELSE v_after_val END)
  THEN
    PERFORM public.asesor_cambio_upsert(
      v_lote_id,
      'campo:plazo',
      'campo_actualizado',
      'cliente_datos',
      'plazo',
      NULL,
      'Plazo actualizado',
      NULLIF(v_before_val, '""'::JSONB),
      NULLIF(v_after_val, '""'::JSONB),
      NULL,
      NULL
    );
  END IF;

  PERFORM public.asesor_cambio_freeze_lote(v_lote_id);
END;
$$;

-- Revoke helpers from PUBLIC / anon / authenticated (invocables solo vía SECURITY DEFINER callers)
REVOKE ALL ON FUNCTION public.asesor_cambio_doc_label(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_cambio_doc_label(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.asesor_cambio_ensure_open_lote(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_cambio_ensure_open_lote(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.asesor_cambio_upsert(UUID, TEXT, public.asesor_cambio_tipo, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_cambio_upsert(UUID, TEXT, public.asesor_cambio_tipo, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.asesor_cambio_freeze_lote(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_cambio_freeze_lote(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.asesor_cambio_record_doc_reemplazo(UUID, UUID, UUID, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_cambio_record_doc_reemplazo(UUID, UUID, UUID, TEXT, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.asesor_cambio_record_cliente_datos_diff(public.cliente_datos, public.cliente_datos) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_cambio_record_cliente_datos_diff(public.cliente_datos, public.cliente_datos) TO service_role;

-- =============================================================================
-- Patch RPCs canónicas
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_expediente_documento_correccion(
  p_expediente_id UUID,
  p_tipo_documento TEXT,
  p_storage_path TEXT,
  p_nombre_original TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
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
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: tipo_documento no permitido (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: solo el asesor dueño puede corregir documentos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_prev_estatus IS DISTINCT FROM 'rechazado' THEN
    RAISE EXCEPTION 'register_expediente_documento_correccion: solo se puede corregir un documento rechazado por Mesa'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.expediente_documentos
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE id = v_prev_id;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    comentario_mesa,
    uploaded_by,
    uploaded_by_role
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_tipo,
    btrim(p_storage_path),
    btrim(p_nombre_original),
    lower(btrim(p_mime_type)),
    p_size_bytes,
    v_new_version,
    'resubido',
    NULL,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.asesor_correccion',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', lower(btrim(p_mime_type)),
      'size_bytes', p_size_bytes,
      'estatus_revision', 'resubido',
      'documento_rechazado_id', v_prev_id
    )
  );

  -- P130: acumular/congelar lote de cambios del asesor (original → final)
  PERFORM public.asesor_cambio_record_doc_reemplazo(
    v_exp.organization_id,
    p_expediente_id,
    v_actor_id,
    v_tipo,
    v_prev_id,
    v_new_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', 'resubido',
    'storage_path', btrim(p_storage_path)
  );
END;
$$;

COMMENT ON FUNCTION public.register_expediente_documento_correccion(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) IS
  'Asesor dueño corrige documento rechazado (resubido). P130: registra documento_reemplazado y congela lote.';

REVOKE ALL ON FUNCTION public.register_expediente_documento_correccion(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_expediente_documento_correccion(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_cliente_datos_correccion(
  p_expediente_id UUID,
  p_rfc TEXT,
  p_telefono TEXT,
  p_referencias JSONB DEFAULT '[]'::JSONB,
  p_imagenes JSONB DEFAULT NULL,
  p_datos JSONB DEFAULT '{}'::JSONB,
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
  v_cd public.cliente_datos%ROWTYPE;
  v_cd_after public.cliente_datos%ROWTYPE;
  v_result JSONB;
  v_estado_final public.cliente_datos_estado;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: solo el asesor dueño puede corregir datos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: expediente no activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: el expediente no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_cliente_datos_correccion: faltan datos del cliente'
      USING ERRCODE = 'P0002';
  END IF;

  -- Snapshot domicilio (vive en expedientes) para diff P130
  PERFORM set_config(
    'concasa.asesor_cambio_direccion_before',
    COALESCE(v_exp.direccion_opcional, ''),
    true
  );

  PERFORM set_config('concasa.cliente_datos_correccion', '', true);
  PERFORM set_config('concasa.cliente_datos_actualizacion_post_mesa', '', true);

  IF v_cd.estado = 'rechazado' THEN
    PERFORM set_config('concasa.cliente_datos_correccion', '1', true);

    v_result := public.save_cliente_datos(
      p_expediente_id,
      p_rfc,
      p_telefono,
      p_referencias,
      p_imagenes,
      p_datos,
      'completo',
      p_porcentaje_cobro,
      p_metodo_pago,
      p_direccion_opcional,
      p_monto_calculado_manual
    );

    SELECT cd.* INTO v_cd_after
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;

    PERFORM public.asesor_cambio_record_cliente_datos_diff(v_cd, v_cd_after);

    RETURN v_result || jsonb_build_object('estado', 'completo');
  END IF;

  PERFORM set_config('concasa.cliente_datos_actualizacion_post_mesa', '1', true);

  v_result := public.save_cliente_datos(
    p_expediente_id,
    p_rfc,
    p_telefono,
    p_referencias,
    p_imagenes,
    p_datos,
    'completo',
    p_porcentaje_cobro,
    p_metodo_pago,
    p_direccion_opcional,
    p_monto_calculado_manual
  );

  SELECT cd.* INTO v_cd_after
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  -- P130: también registrar actualizacion_post_mesa
  PERFORM public.asesor_cambio_record_cliente_datos_diff(v_cd, v_cd_after);

  SELECT cd.estado
  INTO v_estado_final
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  RETURN v_result || jsonb_build_object('estado', COALESCE(v_estado_final::TEXT, v_cd.estado::TEXT));
END;
$$;

COMMENT ON FUNCTION public.save_cliente_datos_correccion(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TEXT, TEXT, NUMERIC) IS
  'Asesor dueño actualiza cliente_datos post-Mesa (corrección o actualizacion_post_mesa). P130: diff original→final + congela lote.';

REVOKE ALL ON FUNCTION public.save_cliente_datos_correccion(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_cliente_datos_correccion(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TEXT, TEXT, NUMERIC) TO authenticated;

-- =============================================================================
-- RPCs públicas Mesa
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mesa_list_asesor_cambios_summary(
  p_expediente_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_items JSONB := '[]'::JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_list_asesor_cambios_summary: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_list_asesor_cambios_summary: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_ids IS NULL OR cardinality(p_expediente_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'items', '[]'::JSONB);
  END IF;

  WITH wanted AS (
    SELECT DISTINCT x AS expediente_id
    FROM unnest(p_expediente_ids) AS x
    WHERE x IS NOT NULL
      AND public.can_see_expediente(x)
  ),
  ranked AS (
    SELECT
      l.id AS batch_id,
      l.expediente_id,
      l.status,
      l.submitted_at,
      ROW_NUMBER() OVER (
        PARTITION BY l.expediente_id
        ORDER BY
          CASE WHEN l.status = 'pendiente_revision' THEN 0 ELSE 1 END,
          l.submitted_at DESC NULLS LAST,
          l.created_at DESC
      ) AS rn
    FROM public.expediente_asesor_cambio_lotes l
    INNER JOIN wanted w ON w.expediente_id = l.expediente_id
    WHERE l.status IN ('pendiente_revision', 'revisado')
  ),
  picked AS (
    SELECT * FROM ranked WHERE rn = 1
  ),
  counts AS (
    SELECT c.lote_id, COUNT(*)::INTEGER AS changes_count
    FROM public.expediente_asesor_cambios c
    INNER JOIN picked p ON p.batch_id = c.lote_id
    GROUP BY c.lote_id
  ),
  summaries AS (
    SELECT
      p.batch_id,
      COALESCE(
        (
          SELECT jsonb_agg(s.label ORDER BY s.ord)
          FROM (
            SELECT c.label, ROW_NUMBER() OVER (ORDER BY c.created_at ASC, c.id ASC) AS ord
            FROM public.expediente_asesor_cambios c
            WHERE c.lote_id = p.batch_id
            ORDER BY c.created_at ASC, c.id ASC
            LIMIT 2
          ) s
        ),
        '[]'::JSONB
      ) AS summary
    FROM picked p
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'expediente_id', p.expediente_id,
        'batch_id', p.batch_id,
        'status', p.status::TEXT,
        'submitted_at', p.submitted_at,
        'changes_count', COALESCE(ct.changes_count, 0),
        'summary', COALESCE(s.summary, '[]'::JSONB)
      )
      ORDER BY p.expediente_id
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM picked p
  LEFT JOIN counts ct ON ct.lote_id = p.batch_id
  LEFT JOIN summaries s ON s.batch_id = p.batch_id;

  RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items, '[]'::JSONB));
END;
$$;

COMMENT ON FUNCTION public.mesa_list_asesor_cambios_summary(UUID[]) IS
  'P130: resumen batch de lotes asesor (pendiente_revision preferido) para bandeja Mesa.';

REVOKE ALL ON FUNCTION public.mesa_list_asesor_cambios_summary(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_list_asesor_cambios_summary(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_list_asesor_cambios_summary(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.mesa_get_asesor_cambio_lote(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_lote public.expediente_asesor_cambio_lotes%ROWTYPE;
  v_asesor_nombre TEXT;
  v_changes JSONB;
  v_count INTEGER;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_get_asesor_cambio_lote: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_get_asesor_cambio_lote: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_get_asesor_cambio_lote: expediente_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_get_asesor_cambio_lote: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.*
  INTO v_lote
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.expediente_id = p_expediente_id
    AND l.status = 'pendiente_revision'
  ORDER BY l.submitted_at DESC NULLS LAST, l.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT l.*
    INTO v_lote
    FROM public.expediente_asesor_cambio_lotes l
    WHERE l.expediente_id = p_expediente_id
      AND l.status = 'revisado'
    ORDER BY l.reviewed_at DESC NULLS LAST, l.submitted_at DESC NULLS LAST, l.created_at DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'lote', NULL, 'changes', '[]'::JSONB);
  END IF;

  SELECT NULLIF(btrim(pr.full_name), '')
  INTO v_asesor_nombre
  FROM public.profiles pr
  WHERE pr.id = v_lote.asesor_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'change_key', c.change_key,
        'tipo', c.tipo::TEXT,
        'entidad', c.entidad,
        'campo', c.campo,
        'document_kind', c.document_kind,
        'label', c.label,
        'valor_anterior', c.valor_anterior,
        'valor_nuevo', c.valor_nuevo,
        'documento_anterior_id', c.documento_anterior_id,
        'documento_nuevo_id', c.documento_nuevo_id,
        'created_at', c.created_at
      )
      ORDER BY c.created_at ASC, c.id ASC
    ),
    '[]'::JSONB
  ),
  COUNT(*)::INTEGER
  INTO v_changes, v_count
  FROM public.expediente_asesor_cambios c
  WHERE c.lote_id = v_lote.id;

  RETURN jsonb_build_object(
    'ok', true,
    'lote', jsonb_build_object(
      'id', v_lote.id,
      'status', v_lote.status::TEXT,
      'submitted_at', v_lote.submitted_at,
      'reviewed_at', v_lote.reviewed_at,
      'asesor_nombre', v_asesor_nombre,
      'changes_count', COALESCE(v_count, 0)
    ),
    'changes', COALESCE(v_changes, '[]'::JSONB)
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_get_asesor_cambio_lote(UUID) IS
  'P130: detalle del lote de cambios del asesor (pendiente_revision o último revisado).';

REVOKE ALL ON FUNCTION public.mesa_get_asesor_cambio_lote(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_get_asesor_cambio_lote(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_get_asesor_cambio_lote(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mesa_marcar_asesor_cambios_revisados(
  p_lote_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_lote public.expediente_asesor_cambio_lotes%ROWTYPE;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_marcar_asesor_cambios_revisados: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_marcar_asesor_cambios_revisados: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_lote_id IS NULL THEN
    RAISE EXCEPTION 'mesa_marcar_asesor_cambios_revisados: lote_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT l.*
  INTO v_lote
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.id = p_lote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_marcar_asesor_cambios_revisados: lote no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_see_expediente(v_lote.expediente_id) THEN
    RAISE EXCEPTION 'mesa_marcar_asesor_cambios_revisados: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF v_lote.status = 'revisado' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'revisado');
  END IF;

  IF v_lote.status <> 'pendiente_revision' THEN
    RAISE EXCEPTION 'mesa_marcar_asesor_cambios_revisados: lote no está pendiente de revisión'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.expediente_asesor_cambio_lotes
  SET
    status = 'revisado',
    reviewed_by = v_actor_id,
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_lote_id;

  RETURN jsonb_build_object('ok', true, 'status', 'revisado');
END;
$$;

COMMENT ON FUNCTION public.mesa_marcar_asesor_cambios_revisados(UUID) IS
  'P130: marca lote de cambios del asesor como revisado (idempotente; no cambia etapa).';

REVOKE ALL ON FUNCTION public.mesa_marcar_asesor_cambios_revisados(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_marcar_asesor_cambios_revisados(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_marcar_asesor_cambios_revisados(UUID) TO authenticated;
