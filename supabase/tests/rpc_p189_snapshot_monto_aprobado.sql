-- ConCasa CRM — P189 mappingVersion=2 FINAL: Monto Mejoravit + parsers impresión
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_p189_snapshot_monto_aprobado.sql
\set ON_ERROR_STOP on
\i supabase/tests/_p189_infonavit_datos_fixture.sql

CREATE OR REPLACE FUNCTION public.__p189_m2_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P189 MAPPING V2 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9189-000000000100';
  v_asesor UUID := '00000000-0000-4000-9189-000000000111';
  v_exp UUID := '00000000-0000-4000-9189-000000000001';
  v_exp_fb UUID := '00000000-0000-4000-9189-000000000002';
  v_payload JSONB;
  v_payload2 JSONB;
  v_parsed JSONB;
  v_dir JSONB;
BEGIN
  -- helpers unitarios (impresión, sin PII real)
  v_parsed := public.infonavit_parse_nombre_persona_mx('RUBEN CASTRO QUIÑONES');
  PERFORM public.__p189_m2_assert(v_parsed->>'nombres' = 'RUBEN', 'parse 3 nombres');
  PERFORM public.__p189_m2_assert(v_parsed->>'apellidoPaterno' = 'CASTRO', 'parse 3 paterno');
  PERFORM public.__p189_m2_assert(v_parsed->>'apellidoMaterno' = 'QUIÑONES', 'parse 3 materno');

  v_parsed := public.infonavit_parse_nombre_persona_mx('DEBANHI ABIGAIL CASTRO JUAREZ');
  PERFORM public.__p189_m2_assert(v_parsed->>'nombres' = 'DEBANHI ABIGAIL', 'parse 4 nombres');
  PERFORM public.__p189_m2_assert(v_parsed->>'apellidoPaterno' = 'CASTRO', 'parse 4 paterno');
  PERFORM public.__p189_m2_assert(v_parsed->>'apellidoMaterno' = 'JUAREZ', 'parse 4 materno');

  v_parsed := public.infonavit_parse_nombre_persona_mx('MAYRA ELIZABETH JUAREZ CASTAÑEDA');
  PERFORM public.__p189_m2_assert(v_parsed->>'nombres' = 'MAYRA ELIZABETH', 'parse bene nombres');
  PERFORM public.__p189_m2_assert(v_parsed->>'apellidoPaterno' = 'JUAREZ', 'parse bene paterno');
  PERFORM public.__p189_m2_assert(v_parsed->>'apellidoMaterno' = 'CASTAÑEDA', 'parse bene materno');

  v_parsed := public.infonavit_parse_nombre_persona_mx('JOSE PEREZ');
  PERFORM public.__p189_m2_assert(v_parsed->>'nombres' = 'JOSE PEREZ', '2 tokens no inventa');
  PERFORM public.__p189_m2_assert(v_parsed->>'apellidoPaterno' = '', '2 tokens paterno vacío');

  v_dir := public.infonavit_parse_direccion_mx('CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.');
  PERFORM public.__p189_m2_assert(v_dir->>'cp' = '67250', 'dir cp');
  PERFORM public.__p189_m2_assert(v_dir->>'municipio' = 'JUAREZ', 'dir municipio');
  PERFORM public.__p189_m2_assert(v_dir->>'entidad' = 'NUEVO LEÓN', 'dir entidad');
  PERFORM public.__p189_m2_assert(v_dir->>'colonia' = 'CENTRO', 'dir colonia');
  PERFORM public.__p189_m2_assert(v_dir->>'noExt' = '309', 'dir noExt');
  PERFORM public.__p189_m2_assert(v_dir->>'calle' = 'CALLE PRUEBA', 'dir calle');

  PERFORM public.__p189_m2_assert(
    public.infonavit_build_propuesta_mejoramiento(102529.36) LIKE E'Resanes y aplicación de pintura interior y exterior.\n%',
    'propuesta 102529 empieza línea 1'
  );
  PERFORM public.__p189_m2_assert(
    array_length(string_to_array(public.infonavit_build_propuesta_mejoramiento(102529.36), E'\n'), 1) = 4,
    'propuesta 102529 tiene 4 líneas'
  );

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p189-m2-org', 'P189 Mapping V2 Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES (
    v_asesor, v_org, 'p189-m2-asesor@test.local', 'Asesor P189 M2', 'asesor', 'interno', true
  )
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, active = true;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, etapa_actual, subestado, ciclo_estado,
    direccion_opcional
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '18900000001', 'RUBEN CASTRO QUIÑONES',
    '5518900001', 'interno', 1, 'pendiente', 'activo',
    'CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.'
  )
  ON CONFLICT (id) DO UPDATE SET
    cliente_nombre = EXCLUDED.cliente_nombre,
    direccion_opcional = EXCLUDED.direccion_opcional,
    deleted_at = NULL;

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado
  ) VALUES (v_exp, v_org, 'aprobado', 113921.51)
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = 'aprobado', monto_aprobado = 113921.51;

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, referencias,
    monto_mejoravit_actualizado, monto_mejoravit_actualizado_at,
    monto_mejoravit_actualizado_by, monto_mejoravit_actualizado_motivo,
    porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    v_exp, v_org,
    jsonb_build_object(
      'nombreCliente', 'RUBEN CASTRO QUIÑONES',
      'nss', '18900000001',
      'curp', 'XAXX010101HDFXXX09',
      'rfc', 'XAXX010101000',
      'celular', '5518900001',
      'correo', 'cliente.prueba@test.local',
      'empresa', 'Empresa Prueba P189',
      'registroPatronal', 'Y1890000001',
      'telefonoEmpresa', '8189000001',
      'montoMejoravit', '102529.36',
      'plazo', '10',
      'referencias', jsonb_build_array(
        jsonb_build_object('nombre', 'DEBANHI ABIGAIL CASTRO JUAREZ', 'celular', '8118900001'),
        jsonb_build_object('nombre', 'NALLELY BERENICE CASTRO JUAREZ', 'celular', '8118900002')
      ),
      'beneficiario', jsonb_build_object(
        'nombre', 'MAYRA ELIZABETH JUAREZ CASTAÑEDA',
        'parentesco', 'CONCUBINA'
      )
    ),
    'completo',
    jsonb_build_array(
      jsonb_build_object('nombre', 'DEBANHI ABIGAIL CASTRO JUAREZ', 'celular', '8118900001'),
      jsonb_build_object('nombre', 'NALLELY BERENICE CASTRO JUAREZ', 'celular', '8118900002')
    ),
    NULL,
    NULL,
    NULL,
    NULL,
    10, 11000, 'transferencia'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos,
    referencias = EXCLUDED.referencias,
    monto_mejoravit_actualizado = NULL,
    monto_mejoravit_actualizado_at = NULL,
    monto_mejoravit_actualizado_by = NULL,
    monto_mejoravit_actualizado_motivo = NULL;

  v_payload := public.infonavit_build_submission_payload(v_exp, NOW());

  PERFORM public.__p189_m2_assert((v_payload->>'mappingVersion')::int = 2, 'mappingVersion 2');
  PERFORM public.__p189_m2_assert((v_payload->>'schemaVersion')::int = 1, 'schemaVersion 1');
  PERFORM public.__p189_m2_assert(v_payload->>'localidad' = 'NUEVO LEÓN', 'localidad');
  PERFORM public.__p189_m2_assert(v_payload->>'ciudadCierre' = 'NUEVO LEÓN', 'ciudadCierre');
  PERFORM public.__p189_m2_assert(
    (v_payload #>> '{credito,montoSolicitado}')::numeric = 102529.36,
    'montoSolicitado = Monto Mejoravit JSON'
  );
  PERFORM public.__p189_m2_assert(
    (v_payload #>> '{credito,montoSolicitado}')::numeric <> 113921.51,
    'monto_aprobado NO gana'
  );
  PERFORM public.__p189_m2_assert(
    (v_payload #>> '{mejora,presupuestoEstimado}')::numeric = 102529.36,
    'presupuestoEstimado = Monto Mejoravit'
  );
  PERFORM public.__p189_m2_assert(v_payload #>> '{cliente,nombreCompleto}' = 'RUBEN CASTRO QUIÑONES', 'nombreCompleto');
  PERFORM public.__p189_m2_assert(v_payload #>> '{cliente,nombres}' = 'RUBEN', 'nombres titular');
  PERFORM public.__p189_m2_assert(v_payload #>> '{cliente,apellidoPaterno}' = 'CASTRO', 'apPat titular');
  PERFORM public.__p189_m2_assert(v_payload #>> '{cliente,apellidoMaterno}' = 'QUIÑONES', 'apMat titular');
  PERFORM public.__p189_m2_assert(v_payload #>> '{vivienda,cp}' = '67250', 'vivienda cp');
  PERFORM public.__p189_m2_assert(v_payload #>> '{vivienda,municipio}' = 'JUAREZ', 'vivienda municipio');
  PERFORM public.__p189_m2_assert(v_payload #>> '{vivienda,entidad}' = 'NUEVO LEÓN', 'vivienda entidad');
  PERFORM public.__p189_m2_assert(v_payload #>> '{vivienda,colonia}' = 'CENTRO', 'vivienda colonia');
  PERFORM public.__p189_m2_assert(v_payload #>> '{vivienda,noExt}' = '309', 'vivienda noExt');
  PERFORM public.__p189_m2_assert(v_payload #>> '{vivienda,calle}' = 'CALLE PRUEBA', 'vivienda calle');
  PERFORM public.__p189_m2_assert(v_payload #>> '{referencias,0,nombres}' = 'DEBANHI ABIGAIL', 'ref1 nombres');
  PERFORM public.__p189_m2_assert(v_payload #>> '{referencias,0,apellidoPaterno}' = 'CASTRO', 'ref1 paterno');
  PERFORM public.__p189_m2_assert(v_payload #>> '{referencias,0,apellidoMaterno}' = 'JUAREZ', 'ref1 materno');
  PERFORM public.__p189_m2_assert(v_payload #>> '{referencias,0,celular}' = '8118900001', 'ref1 celular');
  PERFORM public.__p189_m2_assert(v_payload #>> '{referencias,0,telefono}' = '', 'ref1 tel vacío');
  PERFORM public.__p189_m2_assert(v_payload #>> '{referencias,0,lada}' = '', 'ref1 lada vacía');
  PERFORM public.__p189_m2_assert(v_payload #>> '{referencias,1,nombres}' = 'NALLELY BERENICE', 'ref2 nombres');
  PERFORM public.__p189_m2_assert(v_payload #>> '{referencias,1,apellidoPaterno}' = 'CASTRO', 'ref2 paterno');
  PERFORM public.__p189_m2_assert(v_payload #>> '{referencias,1,telefono}' = '', 'ref2 tel vacío');
  PERFORM public.__p189_m2_assert(v_payload #>> '{beneficiario,nombres}' = 'MAYRA ELIZABETH', 'bene nombres');
  PERFORM public.__p189_m2_assert(v_payload #>> '{beneficiario,apellidoPaterno}' = 'JUAREZ', 'bene paterno');
  PERFORM public.__p189_m2_assert(v_payload #>> '{beneficiario,apellidoMaterno}' = 'CASTAÑEDA', 'bene materno');
  PERFORM public.__p189_m2_assert(v_payload #>> '{beneficiario,parentesco}' = 'CONCUBINA', 'bene parentesco');
  PERFORM public.__p189_m2_assert(
    array_length(string_to_array(v_payload #>> '{mejora,descripcion}', E'\n'), 1) = 4,
    'propuesta 4 líneas en snapshot'
  );
  PERFORM public.__p189_m2_assert(v_payload #>> '{cliente,genero}' = '', 'genero blank');
  PERFORM public.__p189_m2_assert(v_payload #>> '{cliente,estadoCivil}' = '', 'estadoCivil blank');
  PERFORM public.__p189_m2_assert(v_payload #>> '{vivienda,tipoPropiedad}' = '', 'propiedad blank');
  PERFORM public.__p189_m2_assert((v_payload #>> '{credito,plazoAnios}')::int = 10, 'plazo 10');

  v_parsed := public.infonavit_parse_nombre_persona_mx('MARIA DEL CARMEN LOPEZ');
  PERFORM public.__p189_m2_assert(v_parsed->>'confidence' = 'none', '4 tokens + DEL → none');
  PERFORM public.__p189_m2_assert(v_parsed->>'nombres' = 'MARIA DEL CARMEN LOPEZ', '4 tokens DEL full name');
  PERFORM public.__p189_m2_assert(v_parsed->>'apellidoPaterno' = '', '4 tokens DEL no paterno');

  v_parsed := public.infonavit_parse_nombre_persona_mx('JUAN DE LA CRUZ PEREZ');
  PERFORM public.__p189_m2_assert(v_parsed->>'confidence' = 'high', '5 tokens DE LA high');
  PERFORM public.__p189_m2_assert(v_parsed->>'apellidoPaterno' = 'DE LA CRUZ', 'DE LA CRUZ paterno');

  -- plazo inválido → vacío + warning (no tragar 12)
  UPDATE public.cliente_datos
  SET datos = datos || jsonb_build_object('plazo', '12')
  WHERE expediente_id = v_exp;
  v_payload := public.infonavit_build_submission_payload(v_exp, NOW());
  PERFORM public.__p189_m2_assert(
    jsonb_typeof(v_payload #> '{credito,plazoAnios}') = 'null',
    'plazo 12 → null'
  );
  PERFORM public.__p189_m2_assert(
    v_payload -> 'mappingWarnings' ? 'plazo_invalido',
    'warning plazo_invalido'
  );
  UPDATE public.cliente_datos
  SET datos = datos || jsonb_build_object('plazo', '10')
  WHERE expediente_id = v_exp;

  -- fallback expediente.cliente_nombre si datos.nombreCliente vacío
  UPDATE public.cliente_datos
  SET datos = datos || jsonb_build_object('nombreCliente', '')
  WHERE expediente_id = v_exp;
  v_payload2 := public.infonavit_build_submission_payload(v_exp, NOW());
  PERFORM public.__p189_m2_assert(
    v_payload2 #>> '{cliente,nombreCompleto}' = 'RUBEN CASTRO QUIÑONES',
    'fallback cliente_nombre'
  );
  PERFORM public.__p189_m2_assert(v_payload2 #>> '{cliente,nombres}' = 'RUBEN', 'fallback parse nombres');

  -- actualizado Mesa gana sobre JSON
  UPDATE public.cliente_datos
  SET
    datos = datos || jsonb_build_object('nombreCliente', 'RUBEN CASTRO QUIÑONES', 'montoMejoravit', '102529.36'),
    monto_mejoravit_actualizado = 99999.12,
    monto_mejoravit_actualizado_at = NOW(),
    monto_mejoravit_actualizado_by = v_asesor,
    monto_mejoravit_actualizado_motivo = 'fixture override P189 m2'
  WHERE expediente_id = v_exp;
  v_payload := public.infonavit_build_submission_payload(v_exp, NOW());
  PERFORM public.__p189_m2_assert(
    (v_payload #>> '{credito,montoSolicitado}')::numeric = 99999.12,
    'monto_mejoravit_actualizado gana'
  );

  -- sin JSON ni actualizado → fallback resolver (editor * 0.89 / 169k)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_fb, v_org, v_asesor, 'mejoravit', '18900000002', 'SIN JSON',
    '5518900002', 'interno', 1, 'pendiente', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET deleted_at = NULL;

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (v_exp_fb, v_org, 'aprobado', 100000)
  ON CONFLICT (expediente_id) DO UPDATE SET monto_aprobado = 100000, decision = 'aprobado';

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado
  ) VALUES (
    v_exp_fb, v_org,
    jsonb_build_object('nombreCliente', 'SIN JSON'),
    'completo'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos,
    monto_mejoravit_actualizado = NULL,
    monto_mejoravit_actualizado_at = NULL,
    monto_mejoravit_actualizado_by = NULL,
    monto_mejoravit_actualizado_motivo = NULL;

  v_payload := public.infonavit_build_submission_payload(v_exp_fb, NOW());
  PERFORM public.__p189_m2_assert(
    (v_payload #>> '{credito,montoSolicitado}')::numeric = 89000,
    'fallback resolver editor*0.89'
  );

  RAISE NOTICE 'rpc_p189_snapshot_monto_aprobado: ALL PASSED';
END;
$$;
