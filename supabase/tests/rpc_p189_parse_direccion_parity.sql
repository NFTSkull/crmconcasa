-- ConCasa CRM — P189 mig 190: paridad parser dirección + snapshot vivienda
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_p189_parse_direccion_parity.sql
\set ON_ERROR_STOP on
\i supabase/tests/_p189_infonavit_datos_fixture.sql

CREATE OR REPLACE FUNCTION public.__p189_dir_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P189 DIR PARITY FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_dir_eq(p_raw TEXT, p_exp JSONB, p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v JSONB;
  v_keys TEXT[] := ARRAY[
    'direccionCompleta','calle','noExt','noInt','lote','manzana','colonia','cp','municipio','entidad'
  ];
  v_k TEXT;
BEGIN
  v := public.infonavit_parse_direccion_mx(p_raw);
  FOREACH v_k IN ARRAY v_keys LOOP
    PERFORM public.__p189_dir_assert(
      COALESCE(v->>v_k, '') = COALESCE(p_exp->>v_k, ''),
      p_id || '.' || v_k || ' sql=' || COALESCE(v->>v_k, '<null>') || ' exp=' || COALESCE(p_exp->>v_k, '<null>')
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9190-000000000100';
  v_asesor UUID := '00000000-0000-4000-9190-000000000111';
  v_exp UUID := '00000000-0000-4000-9190-000000000001';
  v_payload JSONB;
  v_viv JSONB;
  n INT := 0;
BEGIN
  PERFORM public.__p189_dir_eq(
    'CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.',
    '{"direccionCompleta":"CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.","calle":"CALLE PRUEBA","noExt":"309","noInt":"","lote":"","manzana":"","colonia":"CENTRO","cp":"67250","municipio":"JUAREZ","entidad":"NUEVO LEÓN"}'::jsonb,
    '1-col-cp-nl'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ, N.L.',
    '{"direccionCompleta":"C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ, N.L.","calle":"C CERRO DEL TEPEYAC","noExt":"309","noInt":"","lote":"","manzana":"","colonia":"CERRO DE LA SILLA","cp":"67250","municipio":"JUAREZ","entidad":"NUEVO LEÓN"}'::jsonb,
    '2-col-dot-comma-nl'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'AV REFORMA 100 COLONIA CENTRO 64000 MONTERREY NUEVO LEON',
    '{"direccionCompleta":"AV REFORMA 100 COLONIA CENTRO 64000 MONTERREY NUEVO LEON","calle":"AV REFORMA","noExt":"100","noInt":"","lote":"","manzana":"","colonia":"CENTRO","cp":"64000","municipio":"MONTERREY","entidad":"NUEVO LEÓN"}'::jsonb,
    '3-colonia-nuevo-leon'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'CALLE SOL 10 COL CENTRO 64000 MONTERREY NUEVO LEÓN',
    '{"direccionCompleta":"CALLE SOL 10 COL CENTRO 64000 MONTERREY NUEVO LEÓN","calle":"CALLE SOL","noExt":"10","noInt":"","lote":"","manzana":"","colonia":"CENTRO","cp":"64000","municipio":"MONTERREY","entidad":"NUEVO LEÓN"}'::jsonb,
    '4-nuevo-leon-acento'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'CALLE SOL 10 COL CENTRO 64000 MONTERREY NL',
    '{"direccionCompleta":"CALLE SOL 10 COL CENTRO 64000 MONTERREY NL","calle":"CALLE SOL","noExt":"10","noInt":"","lote":"","manzana":"","colonia":"CENTRO","cp":"64000","municipio":"MONTERREY","entidad":"NUEVO LEÓN"}'::jsonb,
    '5-nl-sin-puntos'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'C LOMA DEL TESORO 100 COL. LOMAS DEL SUR 64000 MONTERREY N.L.',
    '{"direccionCompleta":"C LOMA DEL TESORO 100 COL. LOMAS DEL SUR 64000 MONTERREY N.L.","calle":"C LOMA DEL TESORO","noExt":"100","noInt":"","lote":"","manzana":"","colonia":"LOMAS DEL SUR","cp":"64000","municipio":"MONTERREY","entidad":"NUEVO LEÓN"}'::jsonb,
    '6-sin-coma'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'CALLE PRUEBA 309A COL CENTRO 67250 JUAREZ N.L.',
    '{"direccionCompleta":"CALLE PRUEBA 309A COL CENTRO 67250 JUAREZ N.L.","calle":"CALLE PRUEBA","noExt":"309A","noInt":"","lote":"","manzana":"","colonia":"CENTRO","cp":"67250","municipio":"JUAREZ","entidad":"NUEVO LEÓN"}'::jsonb,
    '7-noext-alfanumerico'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'CALLE SOL 10 COL CENTRO N.L.',
    '{"direccionCompleta":"CALLE SOL 10 COL CENTRO N.L.","calle":"CALLE SOL","noExt":"10","noInt":"","lote":"","manzana":"","colonia":"CENTRO","cp":"","municipio":"","entidad":"NUEVO LEÓN"}'::jsonb,
    '8-sin-cp'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'CALLE SOL 10 64000 MONTERREY N.L.',
    '{"direccionCompleta":"CALLE SOL 10 64000 MONTERREY N.L.","calle":"CALLE SOL","noExt":"10","noInt":"","lote":"","manzana":"","colonia":"","cp":"64000","municipio":"MONTERREY","entidad":"NUEVO LEÓN"}'::jsonb,
    '9-sin-col'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'DOMICILIO SIN ESTRUCTURA CLARA',
    '{"direccionCompleta":"DOMICILIO SIN ESTRUCTURA CLARA","calle":"DOMICILIO SIN ESTRUCTURA CLARA","noExt":"","noInt":"","lote":"","manzana":"","colonia":"","cp":"","municipio":"","entidad":""}'::jsonb,
    '10-sin-numero'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'CALLE SOL 10 INT 2 COL CENTRO 64000 MONTERREY N.L.',
    '{"direccionCompleta":"CALLE SOL 10 INT 2 COL CENTRO 64000 MONTERREY N.L.","calle":"CALLE SOL","noExt":"10","noInt":"2","lote":"","manzana":"","colonia":"CENTRO","cp":"64000","municipio":"MONTERREY","entidad":"NUEVO LEÓN"}'::jsonb,
    '11-int-etiquetado'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    '  ',
    '{"direccionCompleta":"","calle":"","noExt":"","noInt":"","lote":"","manzana":"","colonia":"","cp":"","municipio":"","entidad":""}'::jsonb,
    '12-vacio'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'C PRUEBA 123 COL. COLONIA EJEMPLO 64000 MONTERREY N.L.',
    '{"direccionCompleta":"C PRUEBA 123 COL. COLONIA EJEMPLO 64000 MONTERREY N.L.","calle":"C PRUEBA","noExt":"123","noInt":"","lote":"","manzana":"","colonia":"COLONIA EJEMPLO","cp":"64000","municipio":"MONTERREY","entidad":"NUEVO LEÓN"}'::jsonb,
    'A-colonia-ejemplo'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ NL',
    '{"direccionCompleta":"CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ NL","calle":"CALLE PRUEBA","noExt":"309","noInt":"","lote":"","manzana":"","colonia":"CENTRO","cp":"67250","municipio":"JUAREZ","entidad":"NUEVO LEÓN"}'::jsonb,
    'B-col-centro-nl'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'CALLE SOL 10 COL. LAS TORRES INT 4 64000 MONTERREY N.L.',
    '{"direccionCompleta":"CALLE SOL 10 COL. LAS TORRES INT 4 64000 MONTERREY N.L.","calle":"CALLE SOL","noExt":"10","noInt":"4","lote":"","manzana":"","colonia":"LAS TORRES","cp":"64000","municipio":"MONTERREY","entidad":"NUEVO LEÓN"}'::jsonb,
    'C-col-int'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ N.L.',
    '{"direccionCompleta":"C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ N.L.","calle":"C CERRO DEL TEPEYAC","noExt":"309","noInt":"","lote":"","manzana":"","colonia":"CERRO DE LA SILLA","cp":"67250","municipio":"JUAREZ","entidad":"NUEVO LEÓN"}'::jsonb,
    'D-cerro-de-la-silla'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'CALLE SOL 10 COL CENTRO N.L.',
    '{"direccionCompleta":"CALLE SOL 10 COL CENTRO N.L.","calle":"CALLE SOL","noExt":"10","noInt":"","lote":"","manzana":"","colonia":"CENTRO","cp":"","municipio":"","entidad":"NUEVO LEÓN"}'::jsonb,
    'E-sin-cp-municipio-conservador'
  );
  n := n + 1;

  PERFORM public.__p189_dir_eq(
    'AV SIEMPRE VIVA # 214. COL. LOMAS DEL VALLE APODACA C.P. 66635',
    '{"direccionCompleta":"AV SIEMPRE VIVA # 214. COL. LOMAS DEL VALLE APODACA C.P. 66635","calle":"AV SIEMPRE VIVA","noExt":"214","noInt":"","lote":"","manzana":"","colonia":"LOMAS DEL VALLE","cp":"66635","municipio":"APODACA","entidad":""}'::jsonb,
    'c27-sintetico-cp-hash'
  );
  n := n + 1;

  PERFORM public.__p189_dir_assert(n = 18, 'esperaba 18 fixtures SQL, got ' || n);

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p189-dir-org', 'P189 Dir Parity Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES (
    v_asesor, v_org, 'p189-dir-asesor@test.local', 'Asesor P189 Dir', 'asesor', 'interno', true
  )
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, active = true;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, etapa_actual, subestado, ciclo_estado,
    direccion_opcional
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '19000000001', 'CLIENTE PRUEBA PARITY',
    '5519000001', 'interno', 1, 'pendiente', 'activo',
    'AV SIEMPRE VIVA # 214. COL. LOMAS DEL VALLE APODACA C.P. 66635'
  )
  ON CONFLICT (id) DO UPDATE SET
    direccion_opcional = EXCLUDED.direccion_opcional,
    deleted_at = NULL;

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado
  ) VALUES (v_exp, v_org, 'aprobado', 113921.51)
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = 'aprobado', monto_aprobado = 113921.51;

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, referencias,
    monto_mejoravit_actualizado, porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    v_exp, v_org,
    jsonb_build_object(
      'nombreCliente', 'CLIENTE PRUEBA PARITY',
      'nss', '19000000001',
      'curp', 'XAXX010101HDFXXX09',
      'rfc', 'XAXX010101000',
      'celular', '5519000001',
      'correo', 'parity@test.local',
      'empresa', 'Empresa Parity',
      'registroPatronal', 'Y1900000001',
      'telefonoEmpresa', '8189000001',
      'montoMejoravit', '30224.62',
      'plazo', '2',
      'referencias', jsonb_build_array(
        jsonb_build_object('nombre', 'REF UNO PRUEBA APELLIDO', 'celular', '8119000001'),
        jsonb_build_object('nombre', 'REF DOS PRUEBA APELLIDO', 'celular', '8119000002')
      ),
      'beneficiario', jsonb_build_object(
        'nombre', 'BENE PRUEBA APELLIDO EXTRA',
        'parentesco', 'CONCUBINA'
      )
    ),
    'completo',
    jsonb_build_array(
      jsonb_build_object('nombre', 'REF UNO PRUEBA APELLIDO', 'celular', '8119000001'),
      jsonb_build_object('nombre', 'REF DOS PRUEBA APELLIDO', 'celular', '8119000002')
    ),
    NULL, 10, 3000, 'transferencia'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos,
    referencias = EXCLUDED.referencias,
    monto_mejoravit_actualizado = NULL;

  v_payload := public.infonavit_build_submission_payload(v_exp, NOW());
  v_viv := v_payload->'vivienda';

  PERFORM public.__p189_dir_assert((v_payload->>'mappingVersion')::int = 2, 'snapshot mappingVersion 2');
  PERFORM public.__p189_dir_assert((v_payload->>'schemaVersion')::int = 1, 'snapshot schemaVersion 1');
  PERFORM public.__p189_dir_assert(
    (v_payload #>> '{credito,montoSolicitado}')::numeric = 30224.62,
    'snapshot monto Mejoravit'
  );
  PERFORM public.__p189_dir_assert(
    (v_payload #>> '{credito,montoSolicitado}')::numeric <> 113921.51,
    'snapshot no usa monto_aprobado'
  );
  PERFORM public.__p189_dir_assert(v_viv->>'calle' = 'AV SIEMPRE VIVA', 'snapshot calle');
  PERFORM public.__p189_dir_assert(v_viv->>'noExt' = '214', 'snapshot noExt');
  PERFORM public.__p189_dir_assert(v_viv->>'colonia' = 'LOMAS DEL VALLE', 'snapshot colonia limpia');
  PERFORM public.__p189_dir_assert(v_viv->>'cp' = '66635', 'snapshot cp');
  PERFORM public.__p189_dir_assert(v_viv->>'municipio' = 'APODACA', 'snapshot municipio');
  PERFORM public.__p189_dir_assert(COALESCE(v_viv->>'entidad', '') = '', 'snapshot entidad vacía');
  PERFORM public.__p189_dir_assert(
    v_viv->>'direccionCompleta' = 'AV SIEMPRE VIVA # 214. COL. LOMAS DEL VALLE APODACA C.P. 66635',
    'snapshot direccionCompleta intacta'
  );
  PERFORM public.__p189_dir_assert(v_viv->>'colonia' !~ 'C\.P|66635|APODACA', 'snapshot colonia sin residuos');
END;
$$;

SELECT 'P189 DIR PARITY SQL: PASSED (18/18 + snapshot)' AS status;
