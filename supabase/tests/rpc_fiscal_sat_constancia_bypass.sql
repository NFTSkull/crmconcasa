-- ConCasa CRM — La Constancia de Situación Fiscal NO omite SAT externo pre-Mesa.
-- Solo local/CI. Todo corre en transacción y ROLLBACK.
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__fiscal_constancia_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'FISCAL CONSTANCIA GATE FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9281-000000000001';
  v_asesor UUID := '00000000-0000-4000-9281-000000000011';
  v_exp UUID := '00000000-0000-4000-9281-000000000021';
  v_doc UUID := '00000000-0000-4000-9281-000000000031';
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'fiscal-constancia-gate', 'Fiscal Constancia Gate', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_asesor, 'authenticated', 'authenticated',
    'fiscal-constancia-gate@test.local',
    crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES (
    v_asesor, v_org, 'fiscal-constancia-gate@test.local',
    'Asesor Fiscal Constancia', 'asesor', 'interno', true
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    active = true,
    app_role = 'asesor';

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, telefono_casa, origen_mesa,
    submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '92810000021',
    'Fixture Constancia Fiscal', '5511118121', '5592810021',
    'interno', false, 1, 'pendiente', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    submitted_to_mesa = false;

  INSERT INTO public.app_settings (key, value)
  VALUES ('fiscal_sat_gate_enabled', 'true'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  PERFORM public.__fiscal_constancia_assert(
    public.fiscal_sat_gate_applies_to_expediente(v_exp),
    'sin constancia y gate global ON debe aplicar'
  );

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES (
    v_doc, v_org, v_exp, 'cliente_constancia_situacion_fiscal',
    v_org::text || '/' || v_exp::text || '/cliente_constancia_situacion_fiscal/constancia.pdf',
    'constancia.pdf', 'application/pdf', 100, 1, v_asesor, 'asesor'
  );

  PERFORM public.__fiscal_constancia_assert(
    public.fiscal_sat_constancia_uploaded(v_exp),
    'constancia activa debe detectarse'
  );
  PERFORM public.__fiscal_constancia_assert(
    public.fiscal_sat_gate_applies_to_expediente(v_exp),
    'constancia activa NO debe omitir gate SAT con global ON'
  );

  UPDATE public.expediente_documentos
  SET deleted_at = now()
  WHERE id = v_doc;

  PERFORM public.__fiscal_constancia_assert(
    NOT public.fiscal_sat_constancia_uploaded(v_exp),
    'constancia eliminada no debe contar'
  );
  PERFORM public.__fiscal_constancia_assert(
    public.fiscal_sat_gate_applies_to_expediente(v_exp),
    'al quitar constancia el gate debe seguir aplicando'
  );

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_constancia_sat',
    v_org::text || '/' || v_exp::text || '/cliente_constancia_sat/mesa.pdf',
    'mesa.pdf', 'application/pdf', 100, 1, v_asesor, 'asesor'
  );

  PERFORM public.__fiscal_constancia_assert(
    public.fiscal_sat_gate_applies_to_expediente(v_exp),
    'cliente_constancia_sat de Mesa tampoco debe desactivar SAT pre-Mesa'
  );
END;
$$;

ROLLBACK;
