-- ConCasa CRM — P133: formatos de campos en Datos Generales (nombres / dígitos).
-- Valida payload entrante en save_cliente_datos(+correccion). Sin CHECK en tablas.
-- Sin backfill ni mutación de filas existentes. No modifica migraciones 001–118.

-- =============================================================================
-- Helpers internos (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cliente_datos_normalize_person_name(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT regexp_replace(btrim(COALESCE(p_input, '')), '\s+', ' ', 'g');
$$;

COMMENT ON FUNCTION public.cliente_datos_normalize_person_name(text) IS
  'P133: trim + colapsa espacios; no quita acentos ni fuerza mayúsculas.';

CREATE OR REPLACE FUNCTION public.cliente_datos_is_valid_person_name(p_input text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t TEXT;
BEGIN
  v_t := btrim(COALESCE(p_input, ''));
  IF v_t = '' THEN
    RETURN true;
  END IF;
  -- Letras Unicode ([[:alpha:]]), espacios, guion, apóstrofe ' / ’
  RETURN v_t ~ '^[[:alpha:][:space:]''’\-]+$';
END;
$$;

COMMENT ON FUNCTION public.cliente_datos_is_valid_person_name(text) IS
  'P133: vacío=true; letras Unicode + espacio/guion/apóstrofe; rechaza dígitos/símbolos.';

CREATE OR REPLACE FUNCTION public.cliente_datos_assert_payload_formats(
  p_datos jsonb,
  p_referencias jsonb,
  p_telefono text,
  p_rfc text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_datos JSONB := COALESCE(p_datos, '{}'::JSONB);
  v_refs JSONB := COALESCE(p_referencias, '[]'::JSONB);
  v_nombre TEXT;
  v_parentesco TEXT;
  v_nss TEXT;
  v_nss_digits TEXT;
  v_cp TEXT;
  v_cp_digits TEXT;
  v_plazo TEXT;
  v_plazo_digits TEXT;
  v_tel_norm TEXT;
  v_rfc TEXT;
  v_ref JSONB;
  v_i INTEGER;
BEGIN
  v_nombre := COALESCE(v_datos->>'nombreCliente', '');
  IF NOT public.cliente_datos_is_valid_person_name(v_nombre) THEN
    RAISE EXCEPTION 'cliente_datos: el nombre del cliente solo admite letras, espacios, guiones y apóstrofes.'
      USING ERRCODE = '22023';
  END IF;

  v_nombre := COALESCE(v_datos #>> '{beneficiario,nombre}', COALESCE(v_datos->'beneficiario'->>'nombre', ''));
  IF NOT public.cliente_datos_is_valid_person_name(v_nombre) THEN
    RAISE EXCEPTION 'cliente_datos: el nombre del beneficiario solo admite letras, espacios, guiones y apóstrofes.'
      USING ERRCODE = '22023';
  END IF;

  v_parentesco := COALESCE(v_datos #>> '{beneficiario,parentesco}', COALESCE(v_datos->'beneficiario'->>'parentesco', ''));
  IF NOT public.cliente_datos_is_valid_person_name(v_parentesco) THEN
    RAISE EXCEPTION 'cliente_datos: el parentesco solo admite letras, espacios, guiones y apóstrofes.'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_refs) = 'array' THEN
    FOR v_i IN 0..GREATEST(jsonb_array_length(v_refs) - 1, -1) LOOP
      v_ref := v_refs->v_i;
      v_nombre := COALESCE(v_ref->>'nombre', '');
      IF NOT public.cliente_datos_is_valid_person_name(v_nombre) THEN
        RAISE EXCEPTION 'cliente_datos: el nombre de referencia solo admite letras, espacios, guiones y apóstrofes.'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  v_nss := NULLIF(btrim(COALESCE(v_datos->>'nss', '')), '');
  IF v_nss IS NOT NULL THEN
    v_nss_digits := regexp_replace(v_nss, '\D', '', 'g');
    IF v_nss_digits IS DISTINCT FROM v_nss OR length(v_nss_digits) <> 11 THEN
      RAISE EXCEPTION 'cliente_datos: NSS debe tener 11 dígitos.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NULLIF(btrim(COALESCE(p_telefono, '')), '') IS NOT NULL THEN
    v_tel_norm := public.normalize_telefono_mexico(p_telefono);
    IF v_tel_norm IS NULL OR length(v_tel_norm) <> 10 OR v_tel_norm !~ '^[0-9]{10}$' THEN
      RAISE EXCEPTION 'cliente_datos: el teléfono debe tener 10 dígitos.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_cp := NULLIF(btrim(COALESCE(
    v_datos #>> '{direccionEmpresa,cp}',
    COALESCE(v_datos->'direccionEmpresa'->>'cp', '')
  )), '');
  IF v_cp IS NOT NULL THEN
    v_cp_digits := regexp_replace(v_cp, '\D', '', 'g');
    IF v_cp_digits IS DISTINCT FROM v_cp OR length(v_cp_digits) <> 5 THEN
      RAISE EXCEPTION 'cliente_datos: CP debe tener 5 dígitos.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_plazo := NULLIF(btrim(COALESCE(v_datos->>'plazo', '')), '');
  IF v_plazo IS NOT NULL THEN
    v_plazo_digits := regexp_replace(v_plazo, '\D', '', 'g');
    IF v_plazo_digits IS DISTINCT FROM v_plazo OR v_plazo_digits = '' THEN
      RAISE EXCEPTION 'cliente_datos: el plazo solo admite números.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_rfc := upper(btrim(COALESCE(p_rfc, '')));
  IF v_rfc = '' THEN
    v_rfc := upper(btrim(COALESCE(v_datos->>'rfc', '')));
  END IF;
  IF v_rfc <> '' AND (length(v_rfc) NOT IN (12, 13) OR NOT public.is_rfc_mexico_valido(v_rfc)) THEN
    RAISE EXCEPTION 'cliente_datos: RFC inválido'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.cliente_datos_assert_payload_formats(jsonb, jsonb, text, text) IS
  'P133: valida formatos del payload entrante (nombres, nss, teléfono, cp, plazo, rfc). Sin mutar filas.';

REVOKE ALL ON FUNCTION public.cliente_datos_normalize_person_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_datos_is_valid_person_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_datos_assert_payload_formats(jsonb, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_datos_normalize_person_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cliente_datos_is_valid_person_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cliente_datos_assert_payload_formats(jsonb, jsonb, text, text) TO service_role;

-- =============================================================================
-- Patch save_cliente_datos / save_cliente_datos_correccion (dump Cloud + assert)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_cliente_datos(p_expediente_id uuid, p_rfc text, p_telefono text, p_referencias jsonb DEFAULT '[]'::jsonb, p_imagenes jsonb DEFAULT NULL::jsonb, p_datos jsonb DEFAULT '{}'::jsonb, p_estado cliente_datos_estado DEFAULT 'completo'::cliente_datos_estado, p_porcentaje_cobro numeric DEFAULT NULL::numeric, p_metodo_pago text DEFAULT NULL::text, p_direccion_opcional text DEFAULT NULL::text, p_monto_calculado_manual numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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


  -- P133: formatos de payload entrante (no muta filas existentes)
  PERFORM public.cliente_datos_assert_payload_formats(
    COALESCE(p_datos, '{}'::JSONB),
    COALESCE(p_referencias, '[]'::JSONB),
    p_telefono,
    p_rfc
  );

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
$function$;

CREATE OR REPLACE FUNCTION public.save_cliente_datos_correccion(p_expediente_id uuid, p_rfc text, p_telefono text, p_referencias jsonb DEFAULT '[]'::jsonb, p_imagenes jsonb DEFAULT NULL::jsonb, p_datos jsonb DEFAULT '{}'::jsonb, p_porcentaje_cobro numeric DEFAULT NULL::numeric, p_metodo_pago text DEFAULT NULL::text, p_direccion_opcional text DEFAULT NULL::text, p_monto_calculado_manual numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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


  -- P133: formatos de payload entrante (no muta filas existentes)
  PERFORM public.cliente_datos_assert_payload_formats(
    COALESCE(p_datos, '{}'::JSONB),
    COALESCE(p_referencias, '[]'::JSONB),
    p_telefono,
    p_rfc
  );

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
$function$;

COMMENT ON FUNCTION public.save_cliente_datos(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, public.cliente_datos_estado, NUMERIC, TEXT, TEXT, NUMERIC) IS
  'Asesor dueño guarda cliente_datos. P133: assert formatos payload antes de upsert.';

COMMENT ON FUNCTION public.save_cliente_datos_correccion(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TEXT, TEXT, NUMERIC) IS
  'Asesor dueño corrige/actualiza cliente_datos post-Mesa. P133: assert formatos payload.';

REVOKE ALL ON FUNCTION public.save_cliente_datos(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, public.cliente_datos_estado, NUMERIC, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_cliente_datos(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, public.cliente_datos_estado, NUMERIC, TEXT, TEXT, NUMERIC) TO authenticated;

REVOKE ALL ON FUNCTION public.save_cliente_datos_correccion(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_cliente_datos_correccion(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TEXT, TEXT, NUMERIC) TO authenticated;
