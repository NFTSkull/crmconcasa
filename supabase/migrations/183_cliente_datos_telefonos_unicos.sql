-- ConCasa CRM — P189 B2.1: unicidad de teléfonos intra-expediente (LOCAL)
-- Rechaza números canónicos MX de 10 dígitos repetidos en el mismo payload
-- de save_cliente_datos (cubre corrección: delega a la misma RPC).
-- NO unique global. NO otros expedientes. NO enviar_a_mesa / reingreso.
-- No muta 001–182. Cloud apply fuera de este bloque.

-- =============================================================================
-- Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cliente_datos_telefono_canonico(p_input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v TEXT;
BEGIN
  IF NULLIF(btrim(COALESCE(p_input, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;
  v := public.normalize_telefono_mexico(p_input);
  IF v IS NOT NULL AND v ~ '^[0-9]{10}$' THEN
    RETURN v;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.cliente_datos_telefono_canonico(text) IS
  'P189 B2.1: 10 dígitos MX canónicos o NULL si incompleto/inequívoco. Sin PII en errores.';

CREATE OR REPLACE FUNCTION public.cliente_datos_lada_telefono_canonico(p_lada text, p_telefono text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lada TEXT;
  v_tel TEXT;
BEGIN
  v_lada := regexp_replace(COALESCE(p_lada, ''), '\D', '', 'g');
  v_tel := regexp_replace(COALESCE(p_telefono, ''), '\D', '', 'g');
  IF v_lada = '' AND v_tel = '' THEN
    RETURN NULL;
  END IF;
  -- Código país ≠ LADA (no tratar 52 como LADA).
  IF v_lada IN ('52', '521') THEN
    RETURN NULL;
  END IF;
  IF length(v_lada) NOT IN (2, 3) THEN
    RETURN NULL;
  END IF;
  IF v_tel = '' THEN
    RETURN NULL;
  END IF;
  RETURN public.cliente_datos_telefono_canonico(v_lada || v_tel);
END;
$$;

COMMENT ON FUNCTION public.cliente_datos_lada_telefono_canonico(text, text) IS
  'P189 B2.1: LADA 2–3 dígitos + local → 10 dígitos, o NULL si parcial/inválido.';

CREATE OR REPLACE FUNCTION public.cliente_datos_assert_telefonos_unicos(
  p_datos jsonb,
  p_referencias jsonb,
  p_telefono text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_datos JSONB := COALESCE(p_datos, '{}'::JSONB);
  v_refs JSONB := COALESCE(p_referencias, '[]'::JSONB);
  v_is_v1 BOOLEAN := FALSE;
  v_seen TEXT[] := ARRAY[]::TEXT[];
  v_group TEXT;
  v_a TEXT;
  v_b TEXT;
  v_c TEXT;
  v_d TEXT;
  v_e TEXT;
  v_f TEXT;
  v_alt TEXT;
BEGIN
  v_is_v1 := NULLIF(btrim(COALESCE(v_datos #>> '{infonavit,schemaVersion}', '')), '') = '1';

  v_a := public.cliente_datos_telefono_canonico(p_telefono);
  v_b := public.cliente_datos_telefono_canonico(v_datos->>'telefonoEmpresa');

  v_d := NULL;
  IF jsonb_typeof(v_refs) = 'array' AND jsonb_array_length(v_refs) > 0 THEN
    v_d := public.cliente_datos_telefono_canonico(
      public.referencia_telefono_raw(v_refs->0)
    );
  END IF;
  IF v_is_v1 THEN
    v_alt := public.cliente_datos_telefono_canonico(
      v_datos #>> '{infonavit,referencias,0,celular}'
    );
    IF v_d IS NULL THEN
      v_d := v_alt;
    ELSIF v_alt IS NOT NULL AND v_alt IS DISTINCT FROM v_d THEN
      RAISE EXCEPTION 'save_cliente_datos: CLIENTE_DATOS_TELEFONO_DUPLICADO'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_f := NULL;
  IF jsonb_typeof(v_refs) = 'array' AND jsonb_array_length(v_refs) > 1 THEN
    v_f := public.cliente_datos_telefono_canonico(
      public.referencia_telefono_raw(v_refs->1)
    );
  END IF;
  IF v_is_v1 THEN
    v_alt := public.cliente_datos_telefono_canonico(
      v_datos #>> '{infonavit,referencias,1,celular}'
    );
    IF v_f IS NULL THEN
      v_f := v_alt;
    ELSIF v_alt IS NOT NULL AND v_alt IS DISTINCT FROM v_f THEN
      RAISE EXCEPTION 'save_cliente_datos: CLIENTE_DATOS_TELEFONO_DUPLICADO'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_c := NULL;
  v_e := NULL;
  IF v_is_v1 THEN
    v_c := public.cliente_datos_lada_telefono_canonico(
      v_datos #>> '{infonavit,referencias,0,lada}',
      v_datos #>> '{infonavit,referencias,0,telefono}'
    );
    v_e := public.cliente_datos_lada_telefono_canonico(
      v_datos #>> '{infonavit,referencias,1,lada}',
      v_datos #>> '{infonavit,referencias,1,telefono}'
    );
  END IF;

  FOREACH v_group IN ARRAY ARRAY[v_a, v_b, v_c, v_d, v_e, v_f]
  LOOP
    IF v_group IS NULL THEN
      CONTINUE;
    END IF;
    IF v_group = ANY (v_seen) THEN
      RAISE EXCEPTION 'save_cliente_datos: CLIENTE_DATOS_TELEFONO_DUPLICADO'
        USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_group);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.cliente_datos_assert_telefonos_unicos(jsonb, jsonb, text) IS
  'P189 B2.1: rechaza teléfonos canónicos repetidos en el mismo payload. Legacy: celular/empresa/refs celular. schemaVersion=1: + LADA+tel. Parciales ignorados. Sin unique global.';

REVOKE ALL ON FUNCTION public.cliente_datos_telefono_canonico(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_datos_lada_telefono_canonico(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_datos_assert_telefonos_unicos(jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_datos_telefono_canonico(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cliente_datos_lada_telefono_canonico(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cliente_datos_assert_telefonos_unicos(jsonb, jsonb, text) TO service_role;

-- =============================================================================
-- Patch save_cliente_datos (dump 151 + assert unicidad). Correccion NO se redefine.
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
      -- Hotfix 151: primer alta solo con reingreso activo + flag post_mesa.
      IF current_setting('concasa.cliente_datos_actualizacion_post_mesa', true) IS DISTINCT FROM '1'
         OR NOT public.es_reingreso_asesor_edicion_activa(p_expediente_id) THEN
        RAISE EXCEPTION 'save_cliente_datos: faltan datos del cliente en expediente enviado a Mesa'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;


  -- P133: formatos de payload entrante (no muta filas existentes)
  PERFORM public.cliente_datos_assert_payload_formats(
    COALESCE(p_datos, '{}'::JSONB),
    COALESCE(p_referencias, '[]'::JSONB),
    p_telefono,
    p_rfc
  );

  -- P189 B2.1: unicidad intra-payload (no unique global / no otros expedientes)
  PERFORM public.cliente_datos_assert_telefonos_unicos(
    COALESCE(p_datos, '{}'::JSONB),
    COALESCE(p_referencias, '[]'::JSONB),
    p_telefono
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
$function$
;


REVOKE ALL ON FUNCTION public.save_cliente_datos(uuid, text, text, jsonb, jsonb, jsonb, public.cliente_datos_estado, numeric, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_cliente_datos(uuid, text, text, jsonb, jsonb, jsonb, public.cliente_datos_estado, numeric, text, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_cliente_datos(uuid, text, text, jsonb, jsonb, jsonb, public.cliente_datos_estado, numeric, text, text, numeric) TO authenticated;
