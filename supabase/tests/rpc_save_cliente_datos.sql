-- ConCasa CRM — pruebas P2C-10 RPC save_cliente_datos
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_save_cliente_datos.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC SCD TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_call_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_rfc TEXT,
  p_telefono TEXT,
  p_referencias JSONB DEFAULT '[]'::JSONB,
  p_imagenes JSONB DEFAULT NULL,
  p_datos JSONB DEFAULT '{}'::JSONB,
  p_estado public.cliente_datos_estado DEFAULT 'completo',
  p_porcentaje_cobro NUMERIC DEFAULT 10,
  p_metodo_pago TEXT DEFAULT 'transferencia',
  p_monto_calculado NUMERIC DEFAULT 1500
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_scd_test_set_auth(p_user_id);
  SELECT public.save_cliente_datos(
    p_expediente_id, p_rfc, p_telefono, p_referencias,
    p_imagenes, p_datos, p_estado, p_porcentaje_cobro, p_metodo_pago, p_monto_calculado
  ) INTO v_result;
  PERFORM public.__rpc_scd_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_rfc TEXT,
  p_telefono TEXT,
  p_referencias JSONB DEFAULT '[]'::JSONB,
  p_imagenes JSONB DEFAULT NULL,
  p_datos JSONB DEFAULT '{}'::JSONB,
  p_estado public.cliente_datos_estado DEFAULT 'completo',
  p_msg_contains TEXT DEFAULT NULL,
  p_porcentaje_cobro NUMERIC DEFAULT 10,
  p_metodo_pago TEXT DEFAULT 'transferencia',
  p_monto_calculado NUMERIC DEFAULT 1500
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_err TEXT;
BEGIN
  PERFORM public.__rpc_scd_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.save_cliente_datos(
      p_expediente_id, p_rfc, p_telefono, p_referencias,
      p_imagenes, p_datos, p_estado, p_porcentaje_cobro, p_metodo_pago, p_monto_calculado
    );
    PERFORM public.__rpc_scd_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      PERFORM public.__rpc_scd_test_reset_auth();
      IF p_msg_contains IS NOT NULL AND position(p_msg_contains IN v_err) = 0 THEN
        RAISE EXCEPTION 'RPC SCD TEST FAIL: esperaba mensaje con "%", obtuvo: %', p_msg_contains, v_err;
      END IF;
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_submitted BOOLEAN DEFAULT false,
  p_ciclo public.expediente_ciclo_estado DEFAULT 'activo',
  p_deleted_at TIMESTAMPTZ DEFAULT NULL,
  p_etapa SMALLINT DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado, deleted_at
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture Save Cliente Datos', '5500000000', 'interno',
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, 'pendiente', p_ciclo, p_deleted_at
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    ciclo_estado = EXCLUDED.ciclo_estado,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = NOW();

  DELETE FROM public.cliente_datos WHERE expediente_id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_insert_editor(
  p_expediente_id UUID,
  p_org_id UUID,
  p_monto NUMERIC DEFAULT 15000
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado
  ) VALUES (
    p_expediente_id, p_org_id, 'aprobado', p_monto
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_insert_docs(
  p_expediente_id UUID,
  p_org_id UUID,
  p_asesor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo TEXT;
BEGIN
  DELETE FROM public.expediente_documentos
  WHERE expediente_id = p_expediente_id
    AND tipo_documento = ANY(public.integration_doc_tipos_obligatorios());

  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_obligatorios()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org_id, p_expediente_id, v_tipo,
      'dev/scd/' || p_expediente_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor_id, 'asesor'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_call_enviar_as(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_scd_test_set_auth(p_user_id);
  SELECT public.enviar_a_mesa(p_expediente_id) INTO v_result;
  PERFORM public.__rpc_scd_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_scd_test_expect_enviar_fail(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_scd_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.enviar_a_mesa(p_expediente_id);
    PERFORM public.__rpc_scd_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_scd_test_reset_auth();
      RETURN true;
  END;
END;
$$;

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_org_other UUID := '00000000-0000-4000-8000-000000000099';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_mesa UUID := '00000000-0000-4000-8004-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';

  v_exp_create UUID := '00000000-0000-4000-9012-000000000010';
  v_exp_update UUID := '00000000-0000-4000-9012-000000000020';
  v_exp_rfc UUID := '00000000-0000-4000-9012-000000000030';
  v_exp_tel UUID := '00000000-0000-4000-9012-000000000040';
  v_exp_dup_a UUID := '00000000-0000-4000-9012-000000000050';
  v_exp_dup_b UUID := '00000000-0000-4000-9012-000000000051';
  v_exp_idem UUID := '00000000-0000-4000-9012-000000000060';
  v_exp_ref UUID := '00000000-0000-4000-9012-000000000070';
  v_exp_img UUID := '00000000-0000-4000-9012-000000000080';
  v_exp_roles UUID := '00000000-0000-4000-9012-000000000090';
  v_exp_other_asesor UUID := '00000000-0000-4000-9012-000000000100';
  v_exp_other_org UUID := '00000000-0000-4000-9012-000000000110';
  v_exp_deleted UUID := '00000000-0000-4000-9012-000000000120';
  v_exp_ciclo UUID := '00000000-0000-4000-9012-000000000130';
  v_exp_sent UUID := '00000000-0000-4000-9012-000000000140';
  v_exp_log UUID := '00000000-0000-4000-9012-000000000150';
  v_exp_side UUID := '00000000-0000-4000-9012-000000000160';
  v_exp_enviar_ok UUID := '00000000-0000-4000-9012-000000000170';
  v_exp_enviar_rfc UUID := '00000000-0000-4000-9012-000000000180';
  v_exp_enviar_est UUID := '00000000-0000-4000-9012-000000000190';
  v_exp_ref_dup_org UUID := '00000000-0000-4000-9012-000000000200';
  v_exp_unique_holder UUID := '00000000-0000-4000-9012-000000000210';
  v_exp_unique_new UUID := '00000000-0000-4000-9012-000000000211';
  v_exp_db_unique UUID := '00000000-0000-4000-9012-000000000220';
  v_exp_db_unique_b UUID := '00000000-0000-4000-9012-000000000221';

  v_result JSONB;
  v_row public.cliente_datos%ROWTYPE;
  v_etapa_before SMALLINT;
  v_submitted_before BOOLEAN;
  v_log_count INTEGER;
  v_roles_revisor INTEGER;
  v_idx_unique BOOLEAN;
  v_db_unique_blocked BOOLEAN;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org_other, 'org-fixture-99', 'Org Fixture 99', true)
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_create, v_org_id, v_asesor_a1, '91201000001');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_update, v_org_id, v_asesor_a1, '91202000002');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_rfc, v_org_id, v_asesor_a1, '91203000003');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_tel, v_org_id, v_asesor_a1, '91204000004');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_dup_a, v_org_id, v_asesor_a1, '91205000005');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_dup_b, v_org_id, v_asesor_a1, '91205000006');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_idem, v_org_id, v_asesor_a1, '91206000007');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_ref, v_org_id, v_asesor_a1, '91207000008');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_img, v_org_id, v_asesor_a1, '91208000009');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_roles, v_org_id, v_asesor_a1, '91209000010');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_other_asesor, v_org_id, v_asesor_a2, '91210000011');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_other_org, v_org_other, v_asesor_a1, '91211000012');
  PERFORM public.__rpc_scd_test_insert_expediente(
    v_exp_deleted, v_org_id, v_asesor_a1, '91212000013', false, 'activo', NOW()
  );
  PERFORM public.__rpc_scd_test_insert_expediente(
    v_exp_ciclo, v_org_id, v_asesor_a1, '91213000014', false, 'cerrado'
  );
  PERFORM public.__rpc_scd_test_insert_expediente(
    v_exp_sent, v_org_id, v_asesor_a1, '91214000015', true
  );
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_log, v_org_id, v_asesor_a1, '91215000016');
  PERFORM public.__rpc_scd_test_insert_expediente(
    v_exp_side, v_org_id, v_asesor_a1, '91216000017',
    false, 'activo'::public.expediente_ciclo_estado, NULL::TIMESTAMPTZ, 2::SMALLINT
  );
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_enviar_ok, v_org_id, v_asesor_a1, '91217000018');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_enviar_rfc, v_org_id, v_asesor_a1, '91218000019');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_enviar_est, v_org_id, v_asesor_a1, '91219000020');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_ref_dup_org, v_org_id, v_asesor_a1, '91220000021');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_unique_holder, v_org_id, v_asesor_a1, '91221000022');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_unique_new, v_org_id, v_asesor_a1, '91221000023');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_db_unique, v_org_id, v_asesor_a1, '91222000024');
  PERFORM public.__rpc_scd_test_insert_expediente(v_exp_db_unique_b, v_org_id, v_asesor_a1, '91222000025');

  PERFORM public.__rpc_scd_test_insert_editor(v_exp_create, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_update, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_rfc, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_tel, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_dup_a, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_dup_b, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_idem, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_ref, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_img, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_roles, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_other_asesor, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_other_org, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_deleted, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_ciclo, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_sent, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_log, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_side, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_enviar_ok, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_enviar_rfc, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_enviar_est, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_ref_dup_org, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_unique_holder, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_unique_new, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_db_unique, v_org_id);
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_db_unique_b, v_org_id);

  -- 0. Índice UNIQUE parcial en telefono_normalizado por organización
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'cliente_datos'
      AND c.relname = 'cliente_datos_org_telefono_normalizado_unique_idx'
      AND i.indisunique
  ) INTO v_idx_unique;
  PERFORM public.__rpc_scd_test_assert(v_idx_unique, 'test 0 index unique');

  -- 0b. La base rechaza INSERT directo con teléfono principal duplicado
  PERFORM public.__rpc_scd_test_call_as(v_asesor_a1, v_exp_db_unique, 'XAXX010101000', '5521212121');
  v_db_unique_blocked := false;
  BEGIN
    INSERT INTO public.cliente_datos (
      expediente_id, organization_id, datos, estado, telefono_normalizado
    ) VALUES (
      v_exp_db_unique_b, v_org_id, '{}'::JSONB, 'completo', '5521212121'
    );
  EXCEPTION
    WHEN unique_violation THEN
      v_db_unique_blocked := true;
  END;
  PERFORM public.__rpc_scd_test_assert(v_db_unique_blocked, 'test 0b db unique violation');

  -- 1. Asesor dueño crea cliente_datos
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_create, 'XAXX010101000', '5512345678'
  );
  PERFORM public.__rpc_scd_test_assert((v_result->>'ok')::BOOLEAN, 'test 1 ok');
  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_create;
  PERFORM public.__rpc_scd_test_assert(v_row.expediente_id IS NOT NULL, 'test 1 row');

  -- 2. Asesor dueño actualiza existente
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_update, 'XAXX010101000', '5587654321',
  jsonb_build_array(jsonb_build_object('nombre', 'Ref Uno', 'telefono', '5599999999'))
  );
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_update, 'XAXX010101AAA', '5587654321',
    jsonb_build_array(jsonb_build_object('nombre', 'Ref Dos', 'telefono', '5599999998'))
  );
  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_update;
  PERFORM public.__rpc_scd_test_assert(v_row.datos->>'rfc' = 'XAXX010101AAA', 'test 2 rfc');

  -- 3. RFC uppercase y trim
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_rfc, '  xaxx010101000  ', '5511111111'
  );
  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_rfc;
  PERFORM public.__rpc_scd_test_assert(v_row.datos->>'rfc' = 'XAXX010101000', 'test 3 uppercase');

  -- 4. RFC vacío permitido
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_rfc, '', '5511111111'
  );
  PERFORM public.__rpc_scd_test_assert((v_result->>'ok')::BOOLEAN, 'test 4 rfc vacío ok');
  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_rfc;
  PERFORM public.__rpc_scd_test_assert(COALESCE(v_row.datos->>'rfc', '') = '', 'test 4 rfc vacío en datos');

  -- 5. RFC longitud inválida
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_rfc, 'XAXX01010', '5511111111', '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'RFC inválido'),
    'test 5'
  );

  -- 6. RFC formato inválido
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_rfc, '1234567890123', '5511111111', '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'RFC inválido'),
    'test 6'
  );

  -- 7. Teléfono normalizado 10 dígitos
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_tel, 'XAXX010101000', '(55) 7000-0007'
  );
  PERFORM public.__rpc_scd_test_assert(v_result->>'telefono' = '5570000007', 'test 7 tel');
  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_tel;
  PERFORM public.__rpc_scd_test_assert(v_row.telefono_normalizado = '5570000007', 'test 7 col');

  -- 8. Teléfono vacío
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_tel, 'XAXX010101000', '', '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'teléfono obligatorio'),
    'test 8'
  );

  -- 9. Teléfono longitud distinta
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_tel, 'XAXX010101000', '12345', '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'teléfono inválido'),
    'test 9'
  );

  -- 10. Teléfono no numérico (tras normalizar queda corto)
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_tel, 'XAXX010101000', 'abcdefghij', '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'teléfono inválido'),
    'test 10'
  );

  -- 11. Teléfono repetido otro expediente activo
  PERFORM public.__rpc_scd_test_call_as(v_asesor_a1, v_exp_dup_a, 'XAXX010101000', '5520202020');
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_dup_b, 'XAXX010101000', '5520202020', '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'teléfono repetido'),
    'test 11'
  );

  -- 11b. unique_violation controlado si pre-check no ve expediente inactivo con el mismo teléfono
  PERFORM public.__rpc_scd_test_call_as(v_asesor_a1, v_exp_unique_holder, 'XAXX010101000', '5522222222');
  UPDATE public.expedientes
  SET ciclo_estado = 'cerrado', updated_at = NOW()
  WHERE id = v_exp_unique_holder;
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_unique_new, 'XAXX010101000', '5522222222',
      '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'teléfono repetido'
    ),
    'test 11b unique_violation'
  );

  -- 12. Mismo expediente idempotente
  PERFORM public.__rpc_scd_test_call_as(v_asesor_a1, v_exp_idem, 'XAXX010101000', '5530303030');
  v_result := public.__rpc_scd_test_call_as(v_asesor_a1, v_exp_idem, 'XAXX010101000', '5530303030');
  PERFORM public.__rpc_scd_test_assert((v_result->>'ok')::BOOLEAN, 'test 12');

  -- 13. Referencias debe ser array
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_ref, 'XAXX010101000', '5540404040',
      '{"nombre":"x"}'::JSONB, NULL, '{}'::JSONB, 'completo', 'referencias debe ser array'
    ),
    'test 13'
  );

  -- 14. Referencia sin nombre
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_ref, 'XAXX010101000', '5540404040',
      jsonb_build_array(jsonb_build_object('telefono', '5555555555')),
      NULL, '{}'::JSONB, 'completo', 'nombre de referencia obligatorio'
    ),
    'test 14'
  );

  -- 15. Referencia teléfono inválido
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_ref, 'XAXX010101000', '5540404040',
      jsonb_build_array(jsonb_build_object('nombre', 'Ana', 'telefono', '123')),
      NULL, '{}'::JSONB, 'completo', 'teléfono de referencia inválido'
    ),
    'test 15'
  );

  -- 16. Nombres repetidos
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_ref, 'XAXX010101000', '5540404040',
      jsonb_build_array(
        jsonb_build_object('nombre', 'Juan Pérez', 'telefono', '5560606060'),
        jsonb_build_object('nombre', '  juan   pérez ', 'telefono', '5570707070')
      ),
      NULL, '{}'::JSONB, 'completo', 'nombre de referencia repetido'
    ),
    'test 16'
  );

  -- 17. Teléfonos referencias repetidos entre sí
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_ref, 'XAXX010101000', '5540404040',
      jsonb_build_array(
        jsonb_build_object('nombre', 'Uno', 'telefono', '5561616161'),
        jsonb_build_object('nombre', 'Dos', 'telefono', '5561616161')
      ),
      NULL, '{}'::JSONB, 'completo', 'teléfono de referencia repetido'
    ),
    'test 17'
  );

  -- 18. Tel ref igual al principal
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_ref, 'XAXX010101000', '5540404040',
      jsonb_build_array(jsonb_build_object('nombre', 'Ref', 'telefono', '5540404040')),
      NULL, '{}'::JSONB, 'completo', 'teléfono repetido en referencias'
    ),
    'test 18'
  );

  -- 19. Tel ref repetido otro expediente
  PERFORM public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_ref_dup_org, 'XAXX010101000', '5541414141',
    jsonb_build_array(jsonb_build_object('nombre', 'Otro', 'telefono', '5581818181'))
  );
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_ref, 'XAXX010101000', '5542424242',
      jsonb_build_array(jsonb_build_object('nombre', 'Nuevo', 'telefono', '5581818181')),
      NULL, '{}'::JSONB, 'completo', 'teléfono de referencia repetido'
    ),
    'test 19'
  );

  -- 20. Imágenes válidas
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_img, 'XAXX010101000', '5543434343',
    '[]'::JSONB,
    jsonb_build_array(
      jsonb_build_object(
        'storage_path', 'dev/scd/ine.jpg',
        'filename', 'ine.jpg',
        'mime_type', 'image/jpeg',
        'size_bytes', 1024,
        'tipo', 'ine'
      )
    )
  );
  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_img;
  PERFORM public.__rpc_scd_test_assert(jsonb_array_length(v_row.imagenes) = 1, 'test 20');

  -- 21. p_imagenes NULL conserva existentes
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_img, 'XAXX010101000', '5543434343',
    '[]'::JSONB, NULL
  );
  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_img;
  PERFORM public.__rpc_scd_test_assert(jsonb_array_length(v_row.imagenes) = 1, 'test 21');

  -- 22. p_imagenes [] limpia
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_img, 'XAXX010101000', '5543434343',
    '[]'::JSONB, '[]'::JSONB
  );
  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_img;
  PERFORM public.__rpc_scd_test_assert(jsonb_array_length(v_row.imagenes) = 0, 'test 22');

  -- 23. Imagen sin ruta
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_img, 'XAXX010101000', '5543434343',
      '[]'::JSONB,
      jsonb_build_array(jsonb_build_object('filename', 'x.jpg')),
      '{}'::JSONB, 'completo', 'imagen sin ruta'
    ),
    'test 23'
  );

  -- 24. mime_type inválido
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_img, 'XAXX010101000', '5543434343',
      '[]'::JSONB,
      jsonb_build_array(jsonb_build_object(
        'url', 'https://x/y.gif', 'filename', 'y.gif', 'mime_type', 'image/gif'
      )),
      '{}'::JSONB, 'completo', 'mime_type de imagen inválido'
    ),
    'test 24'
  );

  -- 25. size_bytes inválido
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_img, 'XAXX010101000', '5543434343',
      '[]'::JSONB,
      jsonb_build_array(jsonb_build_object(
        'public_url', 'https://x/z.png', 'filename', 'z.png', 'mime_type', 'image/png', 'size_bytes', 0
      )),
      '{}'::JSONB, 'completo', 'size_bytes inválido'
    ),
    'test 25'
  );

  -- 26. Otro asesor
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_other_asesor, 'XAXX010101000', '5544444444'),
    'test 26'
  );

  -- 27. Editor bloqueado
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_editor, v_exp_roles, 'XAXX010101000', '5544444444'),
    'test 27'
  );

  -- 28. Mesa bloqueada
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_mesa, v_exp_roles, 'XAXX010101000', '5544444444'),
    'test 28'
  );

  -- 29. Super_admin bloqueado
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_super, v_exp_roles, 'XAXX010101000', '5544444444'),
    'test 29'
  );

  -- 30. Otra organización
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_other_org, 'XAXX010101000', '5544444444'),
    'test 30'
  );

  -- 31. Soft-deleted
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_deleted, 'XAXX010101000', '5544444444'),
    'test 31'
  );

  -- 32. ciclo_estado distinto activo
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_ciclo, 'XAXX010101000', '5544444444'),
    'test 32'
  );

  -- 33. submitted_to_mesa
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(v_asesor_a1, v_exp_sent, 'XAXX010101000', '5544444444', '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'enviado a Mesa'),
    'test 33'
  );

  -- 34. action_log
  PERFORM public.__rpc_scd_test_call_as(v_asesor_a1, v_exp_log, 'XAXX010101000', '5545454545');
  SELECT COUNT(*) INTO v_log_count
  FROM public.action_log al
  WHERE al.entity_id = v_exp_log
    AND al.action = 'cliente_datos.save';
  PERFORM public.__rpc_scd_test_assert(v_log_count >= 1, 'test 34');

  -- 35. No cambia etapa
  SELECT etapa_actual INTO v_etapa_before FROM public.expedientes WHERE id = v_exp_side;
  PERFORM public.__rpc_scd_test_call_as(v_asesor_a1, v_exp_side, 'XAXX010101000', '5546464646');
  PERFORM public.__rpc_scd_test_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp_side) = v_etapa_before,
    'test 35'
  );

  -- 36. No cambia submitted_to_mesa
  SELECT submitted_to_mesa INTO v_submitted_before FROM public.expedientes WHERE id = v_exp_side;
  PERFORM public.__rpc_scd_test_assert(
    (SELECT submitted_to_mesa FROM public.expedientes WHERE id = v_exp_side) = v_submitted_before,
    'test 36'
  );

  -- 37. enviar_a_mesa OK tras save + editor + docs
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_enviar_ok, v_org_id);
  PERFORM public.__rpc_scd_test_insert_docs(v_exp_enviar_ok, v_org_id, v_asesor_a1);
  PERFORM public.__rpc_scd_test_call_as(v_asesor_a1, v_exp_enviar_ok, 'XAXX010101000', '5547474747');
  v_result := public.__rpc_scd_test_call_enviar_as(v_asesor_a1, v_exp_enviar_ok);
  PERFORM public.__rpc_scd_test_assert((v_result->>'ok')::BOOLEAN, 'test 37');

  -- 38. enviar_a_mesa permite RFC vacío (mutación directa post-save)
  PERFORM public.__rpc_scd_test_call_as(v_asesor_a1, v_exp_enviar_rfc, 'XAXX010101000', '5548484848');
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_enviar_rfc, v_org_id);
  PERFORM public.__rpc_scd_test_insert_docs(v_exp_enviar_rfc, v_org_id, v_asesor_a1);
  UPDATE public.cliente_datos
  SET datos = datos - 'rfc' || jsonb_build_object('rfc', '')
  WHERE expediente_id = v_exp_enviar_rfc;
  v_result := public.__rpc_scd_test_call_enviar_as(v_asesor_a1, v_exp_enviar_rfc);
  PERFORM public.__rpc_scd_test_assert((v_result->>'ok')::BOOLEAN, 'test 38 enviar sin RFC');

  -- 39. enviar_a_mesa falla estado pendiente
  PERFORM public.__rpc_scd_test_insert_editor(v_exp_enviar_est, v_org_id);
  PERFORM public.__rpc_scd_test_insert_docs(v_exp_enviar_est, v_org_id, v_asesor_a1);
  PERFORM public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_enviar_est, 'XAXX010101000', '5549494949',
    '[]'::JSONB, NULL, '{}'::JSONB, 'pendiente'
  );
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_enviar_fail(v_asesor_a1, v_exp_enviar_est),
    'test 39'
  );

  -- 40. No existe rol revisor en app_role
  SELECT COUNT(*) INTO v_roles_revisor
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__rpc_scd_test_assert(v_roles_revisor = 0, 'test 40 no revisor');

  -- 41. Cobro: sin porcentaje falla
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_create, 'XAXX010101000', '5512345678',
      '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'porcentaje de cobro es obligatorio', NULL, 'transferencia'
    ),
    'test 41 sin porcentaje'
  );

  -- 42. Cobro: porcentaje 0 falla
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_create, 'XAXX010101000', '5512345678',
      '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'porcentaje de cobro inválido', 0, 'transferencia'
    ),
    'test 42 porcentaje cero'
  );

  -- 43. Cobro: porcentaje >100 falla
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_create, 'XAXX010101000', '5512345678',
      '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'porcentaje de cobro inválido', 101, 'transferencia'
    ),
    'test 43 porcentaje mayor 100'
  );

  -- 44. Cobro: sin método de pago falla
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_create, 'XAXX010101000', '5512345678',
      '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'método de pago es obligatorio', 10, ''
    ),
    'test 44 sin metodo pago'
  );

  -- 45. Cobro: guarda monto_calculado enviado por asesor
  v_result := public.__rpc_scd_test_call_as(
    v_asesor_a1, v_exp_create, '', '5512345678', '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 12.5, 'efectivo', 2500
  );
  PERFORM public.__rpc_scd_test_assert((v_result->>'ok')::BOOLEAN, 'test 45 cobro ok');
  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_create;
  PERFORM public.__rpc_scd_test_assert(v_row.monto_calculado = 2500.00, 'test 45 monto calculado manual');
  PERFORM public.__rpc_scd_test_assert(v_row.metodo_pago = 'efectivo', 'test 45 metodo pago');

  -- 46. Cobro: sin monto aprobado falla
  DELETE FROM public.editor_decisions WHERE expediente_id = v_exp_side;
  PERFORM public.__rpc_scd_test_assert(
    public.__rpc_scd_test_expect_fail(
      v_asesor_a1, v_exp_side, 'XAXX010101000', '5511111111',
      '[]'::JSONB, NULL, '{}'::JSONB, 'completo', 'No hay monto aprobado', 10, 'transferencia'
    ),
    'test 46 sin monto aprobado'
  );

  RAISE NOTICE 'RPC save_cliente_datos: 46 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_scd_test_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_scd_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_scd_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_scd_test_call_as(UUID, UUID, TEXT, TEXT, JSONB, JSONB, JSONB, public.cliente_datos_estado, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_scd_test_expect_fail(UUID, UUID, TEXT, TEXT, JSONB, JSONB, JSONB, public.cliente_datos_estado, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_scd_test_insert_expediente(UUID, UUID, UUID, CHAR(11), BOOLEAN, public.expediente_ciclo_estado, TIMESTAMPTZ, SMALLINT);
DROP FUNCTION IF EXISTS public.__rpc_scd_test_insert_editor(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.__rpc_scd_test_insert_docs(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_scd_test_call_enviar_as(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_scd_test_expect_enviar_fail(UUID, UUID);
