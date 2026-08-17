-- Fixture JSON Datos Generales P189 (ficticio, reutilizable en tests SQL).
CREATE OR REPLACE FUNCTION public.__p189_infonavit_datos_completo(p_nss TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'nss', public.normalize_nss_mexico(p_nss),
    'curp', 'GAVF850101HDFRRL09',
    'rfc', 'XAXX010101000',
    'celular', '5511111111',
    'correo', 'p189.fixture@test.local',
    'empresa', 'Empresa Fixture P189',
    'registroPatronal', 'Y1234567890',
    'telefonoEmpresa', '8187654321',
    'nombreCliente', 'Ana Lopez Perez',
    'montoMejoravit', '80000',
    'plazo', '5',
    'infonavit', jsonb_build_object(
      'schemaVersion', 1,
      'titular', jsonb_build_object(
        'nombres', 'Ana',
        'apellidoPaterno', 'Lopez',
        'apellidoMaterno', 'Perez',
        'genero', 'F',
        'estadoCivil', 'soltero',
        'regimenMatrimonial', '',
        'identificacion', jsonb_build_object(
          'tipo', 'INE',
          'numero', '123456789',
          'vigencia', '2030-12-31'
        )
      ),
      'vivienda', jsonb_build_object(
        'tipoPropiedad', 'propia',
        'localidad', 'Monterrey',
        'calle', 'Av Siempre Viva',
        'numeroExterior', '123',
        'numeroInterior', '',
        'lote', '',
        'manzana', '',
        'colonia', 'Centro',
        'entidad', 'Nuevo Leon',
        'municipio', 'Monterrey',
        'cp', '64000'
      ),
      'referencias', jsonb_build_array(
        jsonb_build_object(
          'nombres', 'Luis',
          'apellidoPaterno', 'Garcia',
          'apellidoMaterno', 'Ruiz',
          'lada', '81',
          'telefono', '12345678',
          'celular', '5522222222'
        ),
        jsonb_build_object(
          'nombres', 'Maria',
          'apellidoPaterno', 'Sanchez',
          'apellidoMaterno', 'Ortiz',
          'lada', '55',
          'telefono', '44444444',
          'celular', '5533333333'
        )
      ),
      'beneficiario', jsonb_build_object(
        'nombres', 'Pedro',
        'apellidoPaterno', 'Lopez',
        'apellidoMaterno', 'Perez',
        'parentesco', 'Hijo'
      ),
      'mejora', jsonb_build_object(
        'descripcion', 'Impermeabilizacion de losa y cambio de ventanas',
        'presupuestoEstimado', '25000'
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.__p189_purge_submission(p_expediente_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('infonavit.snapshot_mutable', '1', true);
  DELETE FROM public.infonavit_pdf_outbox WHERE expediente_id = p_expediente_id;
  DELETE FROM public.expediente_infonavit_submission_snapshots
  WHERE expediente_id = p_expediente_id;
  PERFORM set_config('infonavit.snapshot_mutable', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_patch_cliente_datos_completo(p_expediente_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_nss TEXT;
BEGIN
  SELECT public.normalize_nss_mexico(e.nss::text)
  INTO v_nss
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  UPDATE public.cliente_datos
  SET datos = public.__p189_infonavit_datos_completo(COALESCE(v_nss, '00000000000'))
    || jsonb_build_object(
      'rfc', COALESCE(datos->>'rfc', ''),
      'celular', COALESCE(NULLIF(btrim(datos->>'celular'), ''), '5511111111')
    )
  WHERE expediente_id = p_expediente_id;
END;
$$;

-- Vault P189 flag helpers (LOCAL tests only; never in migrations).
CREATE OR REPLACE FUNCTION public.__p189_clear_feature_vault()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM vault.secrets
  WHERE name IN (
    'p189_infonavit_enqueue_enabled',
    'p189_infonavit_activation_at'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_set_feature_vault(
  p_enabled TEXT,
  p_activation TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p189_clear_feature_vault();
  IF p_enabled IS NOT NULL THEN
    PERFORM vault.create_secret(
      p_enabled,
      'p189_infonavit_enqueue_enabled',
      'P189 B7 SQL fixture flag'
    );
  END IF;
  IF p_activation IS NOT NULL THEN
    PERFORM vault.create_secret(
      p_activation,
      'p189_infonavit_activation_at',
      'P189 B7 SQL fixture activation'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_enable_feature_active()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p189_set_feature_vault(
    'true',
    (NOW() - INTERVAL '1 day')::TEXT
  );
END;
$$;
