-- ConCasa CRM — P189 B2.1: unicidad teléfonos intra-payload (datos 100% ficticios)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_cliente_datos_telefonos_unicos_p189.sql
-- NO Cloud. NO --linked.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p189_b21_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P189 B2.1 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b21_expect_dup(
  p_datos JSONB,
  p_referencias JSONB,
  p_telefono TEXT,
  p_msg TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_err TEXT;
BEGIN
  BEGIN
    PERFORM public.cliente_datos_assert_telefonos_unicos(p_datos, p_referencias, p_telefono);
    RAISE EXCEPTION 'P189 B2.1 FAIL: esperaba duplicado (%)', p_msg;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF position('CLIENTE_DATOS_TELEFONO_DUPLICADO' IN v_err) = 0 THEN
        RAISE EXCEPTION 'P189 B2.1 FAIL: % obtuvo: %', p_msg, v_err;
      END IF;
      IF v_err ~ '[0-9]{10}' THEN
        RAISE EXCEPTION 'P189 B2.1 FAIL: error filtró dígitos PII (%)', p_msg;
      END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b21_payload(
  p_a TEXT,
  p_b TEXT,
  p_c TEXT,
  p_d TEXT,
  p_e TEXT,
  p_f TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_c_lada TEXT := '';
  v_c_tel TEXT := '';
  v_e_lada TEXT := '';
  v_e_tel TEXT := '';
BEGIN
  IF p_c IS NOT NULL AND length(p_c) = 10 THEN
    v_c_lada := left(p_c, 2);
    v_c_tel := right(p_c, 8);
  END IF;
  IF p_e IS NOT NULL AND length(p_e) = 10 THEN
    v_e_lada := left(p_e, 2);
    v_e_tel := right(p_e, 8);
  END IF;
  RETURN jsonb_build_object(
    'payload', jsonb_build_object(
      'telefonoEmpresa', COALESCE(p_b, ''),
      'infonavit', jsonb_build_object(
        'schemaVersion', 1,
        'referencias', jsonb_build_array(
          jsonb_build_object(
            'lada', v_c_lada,
            'telefono', v_c_tel,
            'celular', COALESCE(p_d, '')
          ),
          jsonb_build_object(
            'lada', v_e_lada,
            'telefono', v_e_tel,
            'celular', COALESCE(p_f, '')
          )
        )
      )
    ),
    'referencias', jsonb_build_array(
      jsonb_build_object('nombre', 'Ref Uno', 'telefono', COALESCE(p_d, '8100000004')),
      jsonb_build_object('nombre', 'Ref Dos', 'telefono', COALESCE(p_f, '8100000006'))
    ),
    'telefono', COALESCE(p_a, '8100000001')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b21_dup_pair(p_x CHAR, p_y CHAR)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_dup TEXT := '8112345678';
  v_a TEXT := '8100000001';
  v_b TEXT := '8100000002';
  v_c TEXT := '8100000003';
  v_d TEXT := '8100000004';
  v_e TEXT := '8100000005';
  v_f TEXT := '8100000006';
  v_pack JSONB;
BEGIN
  IF p_x = 'A' OR p_y = 'A' THEN v_a := v_dup; END IF;
  IF p_x = 'B' OR p_y = 'B' THEN v_b := v_dup; END IF;
  IF p_x = 'C' OR p_y = 'C' THEN v_c := v_dup; END IF;
  IF p_x = 'D' OR p_y = 'D' THEN v_d := v_dup; END IF;
  IF p_x = 'E' OR p_y = 'E' THEN v_e := v_dup; END IF;
  IF p_x = 'F' OR p_y = 'F' THEN v_f := v_dup; END IF;
  v_pack := public.__p189_b21_payload(v_a, v_b, v_c, v_d, v_e, v_f);
  PERFORM public.__p189_b21_expect_dup(
    v_pack->'payload',
    v_pack->'referencias',
    v_pack->>'telefono',
    format('par %s=%s', p_x, p_y)
  );
END;
$$;

DO $$
DECLARE
  v_pack JSONB;
  v_src TEXT;
  v_corr TEXT;
  v_org UUID := '00000000-0000-4000-9189-000000000010';
  v_asesor UUID := '00000000-0000-4000-9189-000000000011';
  v_exp_ok UUID := '00000000-0000-4000-9189-000000000001';
  v_exp_b UUID := '00000000-0000-4000-9189-000000000002';
  v_exp_corr UUID := '00000000-0000-4000-9189-000000000003';
  v_result JSONB;
  v_row public.cliente_datos%ROWTYPE;
  v_tel_before TEXT;
  v_idx_unique BOOLEAN;
  v_err TEXT;
  v_fail BOOLEAN;
BEGIN
  PERFORM public.__p189_b21_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cliente_datos_assert_telefonos_unicos'
  ), 'helper existe');

  -- Canon + LADA
  PERFORM public.__p189_b21_assert(
    public.cliente_datos_telefono_canonico('+52 81 1234 5678') = '8112345678',
    'canon +52'
  );
  PERFORM public.__p189_b21_assert(
    public.cliente_datos_telefono_canonico('8112345678') = '8112345678',
    'canon 10'
  );
  PERFORM public.__p189_b21_assert(
    public.cliente_datos_lada_telefono_canonico('81', '12345678') = '8112345678',
    'LADA+tel'
  );
  PERFORM public.__p189_b21_assert(
    public.cliente_datos_lada_telefono_canonico('81', '') IS NULL,
    'LADA parcial no canónico'
  );
  PERFORM public.__p189_b21_assert(
    public.cliente_datos_lada_telefono_canonico('52', '8112345678') IS NULL,
    'LADA 52 no es LADA'
  );

  -- Todos distintos → PASS
  v_pack := public.__p189_b21_payload(
    '8100000001', '8100000002', '8100000003',
    '8100000004', '8100000005', '8100000006'
  );
  PERFORM public.cliente_datos_assert_telefonos_unicos(
    v_pack->'payload', v_pack->'referencias', v_pack->>'telefono'
  );

  -- 15 pares
  PERFORM public.__p189_b21_dup_pair('A', 'B');
  PERFORM public.__p189_b21_dup_pair('A', 'C');
  PERFORM public.__p189_b21_dup_pair('A', 'D');
  PERFORM public.__p189_b21_dup_pair('A', 'E');
  PERFORM public.__p189_b21_dup_pair('A', 'F');
  PERFORM public.__p189_b21_dup_pair('B', 'C');
  PERFORM public.__p189_b21_dup_pair('B', 'D');
  PERFORM public.__p189_b21_dup_pair('B', 'E');
  PERFORM public.__p189_b21_dup_pair('B', 'F');
  PERFORM public.__p189_b21_dup_pair('C', 'D');
  PERFORM public.__p189_b21_dup_pair('C', 'E');
  PERFORM public.__p189_b21_dup_pair('C', 'F');
  PERFORM public.__p189_b21_dup_pair('D', 'E');
  PERFORM public.__p189_b21_dup_pair('D', 'F');
  PERFORM public.__p189_b21_dup_pair('E', 'F');

  -- Legacy: A=B sin infonavit
  PERFORM public.__p189_b21_expect_dup(
    jsonb_build_object('telefonoEmpresa', '8112345678'),
    jsonb_build_array(
      jsonb_build_object('nombre', 'Uno', 'telefono', '8100000004'),
      jsonb_build_object('nombre', 'Dos', 'telefono', '8100000006')
    ),
    '8112345678',
    'legacy A=B'
  );

  -- Legacy: no exige LADA; C ausente no choca
  PERFORM public.cliente_datos_assert_telefonos_unicos(
    jsonb_build_object('telefonoEmpresa', '8100000002'),
    jsonb_build_array(
      jsonb_build_object('nombre', 'Uno', 'telefono', '8100000004'),
      jsonb_build_object('nombre', 'Dos', 'telefono', '8100000006')
    ),
    '8100000001'
  );

  -- Normalización equivalencia
  PERFORM public.__p189_b21_expect_dup(
    jsonb_build_object(
      'telefonoEmpresa', '8100000002',
      'infonavit', jsonb_build_object(
        'schemaVersion', 1,
        'referencias', jsonb_build_array(
          jsonb_build_object('lada', '81', 'telefono', '00000003', 'celular', '8112345678'),
          jsonb_build_object('lada', '81', 'telefono', '00000005', 'celular', '8100000006')
        )
      )
    ),
    jsonb_build_array(
      jsonb_build_object('nombre', 'Uno', 'telefono', '8112345678'),
      jsonb_build_object('nombre', 'Dos', 'telefono', '8100000006')
    ),
    '+52 81 1234 5678',
    'norm +52 vs 10 dígitos A=D'
  );

  -- A vs C LADA
  PERFORM public.__p189_b21_expect_dup(
    jsonb_build_object(
      'telefonoEmpresa', '8100000002',
      'infonavit', jsonb_build_object(
        'schemaVersion', 1,
        'referencias', jsonb_build_array(
          jsonb_build_object('lada', '81', 'telefono', '12345678', 'celular', '8100000004'),
          jsonb_build_object('lada', '81', 'telefono', '00000005', 'celular', '8100000006')
        )
      )
    ),
    jsonb_build_array(
      jsonb_build_object('nombre', 'Uno', 'telefono', '8100000004'),
      jsonb_build_object('nombre', 'Dos', 'telefono', '8100000006')
    ),
    '8112345678',
    'A vs C LADA+tel'
  );

  -- Parcial no es falso duplicado
  PERFORM public.cliente_datos_assert_telefonos_unicos(
    jsonb_build_object(
      'telefonoEmpresa', '8100000002',
      'infonavit', jsonb_build_object(
        'schemaVersion', 1,
        'referencias', jsonb_build_array(
          jsonb_build_object('lada', '81', 'telefono', '', 'celular', '8100000004'),
          jsonb_build_object('lada', '81', 'telefono', '00000005', 'celular', '8100000006')
        )
      )
    ),
    jsonb_build_array(
      jsonb_build_object('nombre', 'Uno', 'telefono', '8100000004'),
      jsonb_build_object('nombre', 'Dos', 'telefono', '8100000006')
    ),
    '8100000001'
  );

  -- save + correccion comparten camino
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_cliente_datos'
  LIMIT 1;
  SELECT pg_get_functiondef(p.oid) INTO v_corr
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_cliente_datos_correccion'
  LIMIT 1;
  PERFORM public.__p189_b21_assert(
    position('cliente_datos_assert_telefonos_unicos' IN v_src) > 0,
    'save llama helper'
  );
  PERFORM public.__p189_b21_assert(
    position('cliente_datos_assert_telefonos_unicos' IN v_corr) = 0,
    'correccion no duplica helper'
  );
  PERFORM public.__p189_b21_assert(
    position('public.save_cliente_datos(' IN v_corr) > 0,
    'correccion delega a save'
  );

  -- No unique global
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
  PERFORM public.__p189_b21_assert(NOT v_idx_unique, 'sin unique global de teléfono');

  -- RPC: todos distintos PASS; A=B REJECT; cross-expediente ALLOW; correccion REJECT
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p189-b21-org', 'P189 B2.1 Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_asesor, 'authenticated', 'authenticated', 'p189-b21-asesor@test.local',
    crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES (
    v_asesor, v_org, 'p189-b21-asesor@test.local', 'Asesor P189 B21',
    'asesor', 'interno', NULL, true
  )
  ON CONFLICT (id) DO UPDATE SET
    active = true,
    organization_id = EXCLUDED.organization_id,
    app_role = EXCLUDED.app_role;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp_ok, v_org, v_asesor, 'mejoravit', '91890000001', 'Fixture P189 B21 A',
     '8100000001', 'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_exp_b, v_org, v_asesor, 'mejoravit', '91890000002', 'Fixture P189 B21 B',
     '8100000001', 'interno', false, NULL, 1, 'pendiente', 'activo'),
    (v_exp_corr, v_org, v_asesor, 'mejoravit', '91890000003', 'Fixture P189 B21 C',
     '8100000099', 'interno', true, NOW(), 1, 'en_validacion_mesa', 'activo')
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    updated_at = NOW();

  DELETE FROM public.cliente_datos WHERE expediente_id IN (v_exp_ok, v_exp_b, v_exp_corr);

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES
    (v_exp_ok, v_org, 'aprobado', 15000),
    (v_exp_b, v_org, 'aprobado', 15000),
    (v_exp_corr, v_org, 'aprobado', 15000)
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = 'aprobado',
    monto_aprobado = 15000,
    updated_at = NOW();

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);

  v_pack := public.__p189_b21_payload(
    '8100000001', '8100000002', '8100000003',
    '8100000004', '8100000005', '8100000006'
  );
  SELECT public.save_cliente_datos(
    v_exp_ok, 'XAXX010101000', v_pack->>'telefono',
    v_pack->'referencias', NULL, v_pack->'payload',
    'completo', 10, 'transferencia', 'Calle Ficticia 1'
  ) INTO v_result;
  PERFORM public.__p189_b21_assert((v_result->>'ok')::BOOLEAN, 'RPC todos distintos');

  -- Mismo teléfono en otro expediente
  SELECT public.save_cliente_datos(
    v_exp_b, 'XAXX010101000', '8100000001',
    jsonb_build_array(
      jsonb_build_object('nombre', 'Beta Uno', 'telefono', '8100000014'),
      jsonb_build_object('nombre', 'Beta Dos', 'telefono', '8100000016')
    ),
    NULL,
    jsonb_build_object('telefonoEmpresa', '8100000012'),
    'completo', 10, 'transferencia', 'Calle Ficticia 2'
  ) INTO v_result;
  PERFORM public.__p189_b21_assert((v_result->>'ok')::BOOLEAN, 'CROSS_EXPEDIENT_DUPLICATE_ALLOWED');

  -- Bypass A=B vía RPC
  v_fail := FALSE;
  BEGIN
    PERFORM public.save_cliente_datos(
      v_exp_ok, 'XAXX010101000', '8112345678',
      jsonb_build_array(
        jsonb_build_object('nombre', 'Ref Uno', 'telefono', '8100000004'),
        jsonb_build_object('nombre', 'Ref Dos', 'telefono', '8100000006')
      ),
      NULL,
      jsonb_build_object('telefonoEmpresa', '8112345678'),
      'completo', 10, 'transferencia', 'Calle Ficticia 1'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      v_fail := position('CLIENTE_DATOS_TELEFONO_DUPLICADO' IN v_err) > 0;
  END;
  PERFORM public.__p189_b21_assert(v_fail, 'RPC A=B reject');

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- Corrección: estado previo intacto si duplicado
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, comentario_rechazo,
    telefono_normalizado, referencias, porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    v_exp_corr, v_org,
    jsonb_build_object(
      'rfc', 'XAXX010101000',
      'nombreCliente', 'Fixture Correccion',
      'celular', '8100000099',
      'telefonoEmpresa', '8100000098'
    ),
    'rechazado', 'Fixture rechazo',
    '8100000099',
    jsonb_build_array(
      jsonb_build_object('nombre', 'Ref Uno', 'telefono', '8100000094'),
      jsonb_build_object('nombre', 'Ref Dos', 'telefono', '8100000096')
    ),
    10, 1500, 'transferencia'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    estado = 'rechazado',
    telefono_normalizado = '8100000099',
    comentario_rechazo = 'Fixture rechazo',
    updated_at = NOW();

  SELECT telefono_normalizado INTO v_tel_before
  FROM public.cliente_datos WHERE expediente_id = v_exp_corr;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);

  v_fail := FALSE;
  BEGIN
    PERFORM public.save_cliente_datos_correccion(
      v_exp_corr, 'XAXX010101000', '8112345678',
      jsonb_build_array(
        jsonb_build_object('nombre', 'Ref Uno', 'telefono', '8112345678'),
        jsonb_build_object('nombre', 'Ref Dos', 'telefono', '8100000096')
      ),
      NULL,
      jsonb_build_object(
        'telefonoEmpresa', '8100000098',
        'nombreCliente', 'Fixture Correccion'
      ),
      10, 'transferencia', 'Calle Ficticia 3'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      v_fail := position('CLIENTE_DATOS_TELEFONO_DUPLICADO' IN v_err) > 0;
  END;
  PERFORM public.__p189_b21_assert(v_fail, 'correccion duplicado reject');

  SELECT * INTO v_row FROM public.cliente_datos WHERE expediente_id = v_exp_corr;
  PERFORM public.__p189_b21_assert(
    v_row.telefono_normalizado = v_tel_before,
    'correccion no pierde estado anterior'
  );
  PERFORM public.__p189_b21_assert(v_row.estado = 'rechazado', 'correccion conserva rechazado');

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  RAISE NOTICE 'P189 B2.1 SQL: PASSED';
END;
$$;

DROP FUNCTION IF EXISTS public.__p189_b21_dup_pair(CHAR, CHAR);
DROP FUNCTION IF EXISTS public.__p189_b21_payload(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__p189_b21_expect_dup(JSONB, JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__p189_b21_assert(BOOLEAN, TEXT);
