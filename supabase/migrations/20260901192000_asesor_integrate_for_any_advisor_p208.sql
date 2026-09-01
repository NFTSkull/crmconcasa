-- ConCasa CRM — P208: captura delegada Equipo Silvia (Adriana/Hector).
-- Team-scoped via asesor_comparten_equipo_activo + asesor_can_operate_expediente_as.
-- 0 writers tablas; CREATE OR REPLACE helpers/RLS/storage/RPCs.
-- NO editar 20260831205958 (ya aplicada Cloud).


-- =============================================================================
-- Helpers P208 (team-scoped)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.asesor_pertenece_equipo_activo(
  p_team_id uuid,
  p_asesor_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.asesor_equipos t
    WHERE t.id = p_team_id
      AND t.active = true
      AND (
        t.leader_id = p_asesor_id
        OR EXISTS (
          SELECT 1
          FROM public.asesor_equipo_miembros m
          WHERE m.team_id = t.id
            AND m.asesor_id = p_asesor_id
            AND m.active = true
        )
      )
  );
$$;

COMMENT ON FUNCTION public.asesor_pertenece_equipo_activo(uuid, uuid) IS
  'P208: asesor es líder o miembro activo del equipo.';

CREATE OR REPLACE FUNCTION public.asesor_comparten_equipo_activo(
  p_actor_id uuid,
  p_target_asesor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_target_asesor_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_actor_id = p_target_asesor_id THEN
    RETURN true;
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = p_actor_id AND p.active = true;

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = p_target_asesor_id AND p.active = true;

  IF NOT FOUND OR v_actor.app_role <> 'asesor' OR v_target.app_role <> 'asesor' THEN
    RETURN false;
  END IF;

  IF v_actor.organization_id IS DISTINCT FROM v_target.organization_id THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.asesor_equipos t
    WHERE t.active = true
      AND t.organization_id = v_actor.organization_id
      AND public.asesor_pertenece_equipo_activo(t.id, p_actor_id)
      AND public.asesor_pertenece_equipo_activo(t.id, p_target_asesor_id)
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_comparten_equipo_activo(uuid, uuid) IS
  'P208: actor y target asesor activos same-org en el mismo equipo activo (sin hardcode).';

GRANT EXECUTE ON FUNCTION public.asesor_pertenece_equipo_activo(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_comparten_equipo_activo(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.asesor_can_operate_expediente_as(
  p_actor_id uuid,
  p_expediente_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_exp public.expedientes%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_expediente_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = p_actor_id AND p.active = true;

  IF NOT FOUND OR v_actor.app_role <> 'asesor' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_actor.organization_id THEN
    RETURN false;
  END IF;

  IF v_exp.asesor_id = p_actor_id THEN
    RETURN true;
  END IF;

  RETURN public.profile_has_capability(p_actor_id, 'integrate_for_any_advisor')
    AND public.asesor_comparten_equipo_activo(p_actor_id, v_exp.asesor_id);
END;
$$;

COMMENT ON FUNCTION public.asesor_can_operate_expediente_as(uuid, uuid) IS
  'P208: owner OR delegate integrate_for_any_advisor en equipo activo compartido.';

CREATE OR REPLACE FUNCTION public.asesor_can_operate_expediente(p_expediente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.asesor_can_operate_expediente_as(public.current_profile_id(), p_expediente_id);
$$;

COMMENT ON FUNCTION public.asesor_can_operate_expediente(uuid) IS
  'P208: wrapper CAN_OPERATE para actor JWT.';

GRANT EXECUTE ON FUNCTION public.asesor_can_operate_expediente_as(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_can_operate_expediente(uuid) TO authenticated;


-- can_see_expediente P208

CREATE OR REPLACE FUNCTION public.can_see_expediente(p_expediente_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_role, v_org_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_role = 'super_admin' THEN
    RETURN true;
  END IF;

  SELECT e.organization_id, e.asesor_id, e.submitted_to_mesa, e.origen_mesa, e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RETURN false;
  END IF;

  CASE v_role
    WHEN 'asesor' THEN
      RETURN v_exp.asesor_id = auth.uid()
        OR (
          public.profile_has_capability(auth.uid(), 'integrate_for_any_advisor')
          AND public.asesor_comparten_equipo_activo(auth.uid(), v_exp.asesor_id)
        );
    WHEN 'editor' THEN
      RETURN true;
    WHEN 'mesa_admin' THEN
      RETURN v_exp.submitted_to_mesa = true;
    WHEN 'mesa_interno' THEN
      RETURN v_exp.submitted_to_mesa = true AND v_exp.origen_mesa = 'interno';
    WHEN 'mesa_externo' THEN
      RETURN v_exp.submitted_to_mesa = true AND v_exp.origen_mesa = 'externo';
    ELSE
      RETURN false;
  END CASE;
END;
$$;


-- from 20260831205958_asesor_equipo_lider_capabilities.sql

CREATE OR REPLACE FUNCTION public.save_cliente_datos(p_expediente_id uuid, p_rfc text, p_telefono text, p_referencias jsonb DEFAULT '[]'::jsonb, p_imagenes jsonb DEFAULT NULL::jsonb, p_datos jsonb DEFAULT '{}'::jsonb, p_estado cliente_datos_estado DEFAULT 'completo'::cliente_datos_estado, p_porcentaje_cobro numeric DEFAULT NULL::numeric, p_metodo_pago text DEFAULT NULL::text, p_direccion_opcional text DEFAULT NULL::text, p_monto_calculado_manual numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $save_cd$
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

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
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
$save_cd$;



-- from 20260831205958_asesor_equipo_lider_capabilities.sql

CREATE OR REPLACE FUNCTION public.enviar_a_mesa(p_expediente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $enviar_mesa$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_editor public.editor_decisions%ROWTYPE;
  v_cliente public.cliente_datos%ROWTYPE;
  v_docs_count INTEGER;
  v_etapa_anterior SMALLINT;
  v_subestado_anterior public.operativo_subestado;
  v_now TIMESTAMPTZ := NOW();
  v_elig JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'enviar_a_mesa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.programa,
    e.nss,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at,
    e.origen_mesa
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'enviar_a_mesa: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: solo el asesor dueño puede enviar a Mesa'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'enviar_a_mesa: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    RAISE EXCEPTION 'enviar_a_mesa: el expediente ya fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: falta decisión del editor'
      USING ERRCODE = '22023';
  END IF;

  IF v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'enviar_a_mesa: monto aprobado del editor debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cliente
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan datos del cliente'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.porcentaje_cobro IS NULL
     OR v_cliente.porcentaje_cobro <= 0
     OR v_cliente.monto_calculado IS NULL
     OR btrim(COALESCE(v_cliente.metodo_pago, '')) = '' THEN
    RAISE EXCEPTION 'enviar_a_mesa: Faltan datos obligatorios del cliente: porcentaje de cobro, monto calculado, método de pago.'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado NOT IN ('completo', 'validado') THEN
    RAISE EXCEPTION 'enviar_a_mesa: datos del cliente deben estar completos o validados (actual: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  v_elig := public.p189_infonavit_get_eligibility(p_expediente_id);
  IF COALESCE((v_elig->>'required')::boolean, false) THEN
    PERFORM public.assert_mejoravit_infonavit_datos_persistidos(p_expediente_id);
  END IF;

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);

  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'enviar_a_mesa: faltan documentos obligatorios de integración (% de %)', v_docs_count, cardinality(public.integration_doc_tipos_asesor_envio())
      USING ERRCODE = '22023';
  END IF;

  IF public.nss_bloqueado_en_mesa(v_exp.organization_id, v_exp.nss, v_exp.programa, p_expediente_id) THEN
    RAISE EXCEPTION 'NSS_YA_BLOQUEADO: Este NSS ya tiene un expediente enviado a Mesa.'
      USING ERRCODE = '23505';
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;

  UPDATE public.expedientes
  SET
    submitted_to_mesa = true,
    fecha_envio_mesa = v_now,
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    updated_at = v_now
  WHERE id = p_expediente_id;

  IF COALESCE((v_elig->>'should_enqueue')::boolean, false) THEN
    PERFORM public.enqueue_infonavit_pdf_submission(
      p_expediente_id,
      v_exp.organization_id,
      0,
      'initial',
      v_now
    );
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.enviar_a_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'asesor_id', v_exp.asesor_id,
      'organization_id', v_exp.organization_id,
      'etapa_anterior', v_etapa_anterior,
      'etapa_nueva', 1,
      'subestado_anterior', v_subestado_anterior,
      'subestado_nuevo', 'en_validacion_mesa',
      'documentos_obligatorios_count', v_docs_count,
      'documentos_asesor_envio_count', v_docs_count,
      'editor_decision_id', v_editor.expediente_id,
      'origen_mesa', v_exp.origen_mesa
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'etapa_actual', 1,
    'subestado', 'en_validacion_mesa',
    'operativo_subestado', 'en_validacion_mesa',
    'submitted_to_mesa', true,
    'enviado_a_mesa', true,
    'documentos_obligatorios_count', v_docs_count
  );
END;
$enviar_mesa$;



-- from 20260831205958_asesor_equipo_lider_capabilities.sql

CREATE OR REPLACE FUNCTION public.register_expediente_documento(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $reg_doc$
DECLARE
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');

  IF NOT (
    v_tipo = ANY(public.integration_doc_tipos_asesor_upload())
    AND public.es_reingreso_asesor_edicion_activa(p_expediente_id)
  ) THEN
    RETURN public.register_expediente_documento_pre_reingreso(
      p_expediente_id, p_tipo_documento, p_storage_path,
      p_nombre_original, p_mime_type, p_size_bytes
    );
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF v_actor_id IS NULL OR NOT FOUND
     OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR (NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id))
     OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id
     OR v_exp.deleted_at IS NOT NULL
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: solo el asesor dueño puede cargar documentos'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.es_reingreso_asesor_edicion_activa(p_expediente_id) THEN
    RAISE EXCEPTION 'register_expediente_documento: reingreso no válido para este documento'
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = ''
     OR p_nombre_original IS NULL OR btrim(p_nombre_original) = ''
     OR p_size_bytes IS NULL OR p_size_bytes <= 0
     OR p_size_bytes > public.expediente_documento_max_size_bytes()
     OR NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo)
     OR NOT public.expediente_documento_storage_path_valid(
       btrim(p_storage_path), v_exp.organization_id, p_expediente_id, v_tipo
     ) THEN
    RAISE EXCEPTION 'register_expediente_documento: metadata o path inválido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_exp.organization_id, p_expediente_id, v_tipo, btrim(p_storage_path),
    btrim(p_nombre_original), lower(btrim(p_mime_type)), p_size_bytes, v_new_version,
    v_new_estatus, v_actor_id, 'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'expediente.documento.register',
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
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL,
      'reingreso_docs_update', true,
      'reingreso_edicion_completa', true
    )
  );

  IF v_prev_id IS NOT NULL THEN
    PERFORM public.asesor_cambio_record_doc_reemplazo(
      v_exp.organization_id,
      p_expediente_id,
      v_actor_id,
      v_tipo,
      v_prev_id,
      v_new_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'reemplazo', v_prev_id IS NOT NULL,
    'integration_docs_presentes', public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos', public.integration_docs_completos(p_expediente_id)
  );
END;
$reg_doc$;



-- from 20260831205958_asesor_equipo_lider_capabilities.sql

CREATE OR REPLACE FUNCTION public.register_expediente_documento_pre_reingreso(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $reg_pre$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento: tipo_documento no permitido para upload asesor (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(p_mime_type, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'register_expediente_documento: solo el asesor dueño puede registrar documentos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa = true THEN
    IF EXISTS (
      SELECT 1
      FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.tipo_documento = v_tipo
        AND d.deleted_at IS NULL
    ) THEN
      NULL;
    ELSIF v_tipo = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'register_expediente_documento: el expediente ya fue enviado a Mesa'
        USING ERRCODE = '22023';
    END IF;
  END IF;


  -- P132: Notificación canónica (`cliente_notificacion`) solo desde etapa 7+.
  -- `cliente_notificacion_apodaca` («Notificación» compartida) no tiene gate de etapa.
  IF v_tipo = 'cliente_notificacion'
     AND COALESCE(v_exp.etapa_actual, 0) < 7 THEN
    RAISE EXCEPTION 'register_expediente_documento: El documento Notificación solo puede cargarse después de concluir la inscripción.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

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
    v_new_estatus,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.register',
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
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL
    )
  );


  -- P130: reemplazo post-Mesa vía register_expediente_documento (sin rechazo previo)
  IF v_prev_id IS NOT NULL
     AND v_exp.submitted_to_mesa IS TRUE THEN
    PERFORM public.asesor_cambio_record_doc_reemplazo(
      v_exp.organization_id,
      p_expediente_id,
      v_actor_id,
      v_tipo,
      v_prev_id,
      v_new_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'integration_docs_presentes', public.count_integration_docs_presentes(p_expediente_id),
    'integration_docs_completos', public.integration_docs_completos(p_expediente_id)
  );
END;
$reg_pre$;



-- from 151_reingreso_cliente_datos_primer_alta.sql

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

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
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
    IF NOT public.es_reingreso_asesor_edicion_activa(p_expediente_id) THEN
      RAISE EXCEPTION 'save_cliente_datos_correccion: faltan datos del cliente'
        USING ERRCODE = 'P0002';
    END IF;

    -- Primer alta durante reingreso activo (sin fila previa).
    PERFORM public.cliente_datos_assert_payload_formats(
      COALESCE(p_datos, '{}'::JSONB),
      COALESCE(p_referencias, '[]'::JSONB),
      p_telefono,
      p_rfc
    );
    PERFORM set_config(
      'concasa.asesor_cambio_direccion_before',
      COALESCE(v_exp.direccion_opcional, ''),
      true
    );
    PERFORM set_config('concasa.cliente_datos_correccion', '', true);
    PERFORM set_config('concasa.cliente_datos_actualizacion_post_mesa', '1', true);

    v_result := public.save_cliente_datos(
      p_expediente_id,
      p_rfc,
      p_telefono,
      p_referencias,
      p_imagenes,
      p_datos,
      'completo'::public.cliente_datos_estado,
      p_porcentaje_cobro,
      p_metodo_pago,
      p_direccion_opcional,
      p_monto_calculado_manual
    );

    SELECT cd.* INTO v_cd_after
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.cliente_datos.create_reingreso',
      'cliente_datos',
      p_expediente_id,
      jsonb_build_object(
        'expediente_id', p_expediente_id,
        'created', true,
        'estado', COALESCE(v_cd_after.estado::text, 'completo')
      )
    );

    RETURN v_result || jsonb_build_object(
      'estado', COALESCE(v_cd_after.estado::text, 'completo'),
      'created', true
    );
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
$function$
;


REVOKE ALL ON FUNCTION public.save_cliente_datos(uuid, text, text, jsonb, jsonb, jsonb, public.cliente_datos_estado, numeric, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_cliente_datos(uuid, text, text, jsonb, jsonb, jsonb, public.cliente_datos_estado, numeric, text, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_cliente_datos(uuid, text, text, jsonb, jsonb, jsonb, public.cliente_datos_estado, numeric, text, text, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.save_cliente_datos_correccion(uuid, text, text, jsonb, jsonb, jsonb, numeric, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_cliente_datos_correccion(uuid, text, text, jsonb, jsonb, jsonb, numeric, text, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_cliente_datos_correccion(uuid, text, text, jsonb, jsonb, jsonb, numeric, text, text, numeric) TO authenticated;

COMMENT ON FUNCTION public.save_cliente_datos_correccion(uuid, text, text, jsonb, jsonb, jsonb, numeric, text, text, numeric) IS
  'Corrección/actualización post-Mesa. Hotfix 151: permite primer INSERT si reingreso activo (es_reingreso_asesor_edicion_activa).';

-- Restaura gates de checklist al reenviar (contador solo si completo). Conserva auth 143.
-- Hotfix 151b: gates ANTES de idempotencia 5s (evita bypass incompleto).
CREATE OR REPLACE FUNCTION public.asesor_enviar_reingreso_a_mesa(
  p_expediente_id UUID
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
  v_editor public.editor_decisions%ROWTYPE;
  v_cliente public.cliente_datos%ROWTYPE;
  v_etapa_anterior SMALLINT;
  v_subestado_anterior public.operativo_subestado;
  v_count INTEGER;
  v_era_primer_envio BOOLEAN;
  v_docs_count INTEGER;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: solo el asesor dueño puede reingresar a Mesa'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado = 'cancelado' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: el expediente está cancelado y no se puede reingresar'
      USING ERRCODE = '22023';
  END IF;

  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND OR v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTA_MONTO: falta monto aprobado del editor'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cliente
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: faltan Datos Generales del cliente'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado NOT IN ('completo', 'validado') THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: datos del cliente incompletos (estado: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.porcentaje_cobro IS NULL
     OR v_cliente.porcentaje_cobro <= 0
     OR v_cliente.monto_calculado IS NULL
     OR btrim(COALESCE(v_cliente.metodo_pago, '')) = '' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: porcentaje de cobro, monto calculado o método de pago'
      USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(v_exp.direccion_opcional, '')), '') IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: Domicilio real del cliente'
      USING ERRCODE = '22023';
  END IF;

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);
  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DOCS: faltan documentos obligatorios (% de %)',
      v_docs_count, cardinality(public.integration_doc_tipos_asesor_envio())
      USING ERRCODE = '22023';
  END IF;

  -- Idempotencia solo después de gates (evita bypass incompleto por ventana 5s).
  IF v_exp.reingreso_manual_at IS NOT NULL
     AND v_exp.reingreso_manual_by IS NOT DISTINCT FROM v_actor_id
     AND v_exp.reingreso_manual_at > (v_now - INTERVAL '5 seconds') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent', true,
      'expediente_id', v_exp.id,
      'precalificacion_id', v_exp.id,
      'reingreso_manual_count', v_exp.reingreso_manual_count,
      'reingreso_manual_at', v_exp.reingreso_manual_at,
      'reingreso_manual_by', v_exp.reingreso_manual_by,
      'etapa_actual', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'submitted_to_mesa', true,
      'fecha_envio_mesa', v_exp.fecha_envio_mesa,
      'era_primer_envio', false
    );
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;
  v_count := COALESCE(v_exp.reingreso_manual_count, 0) + 1;
  v_era_primer_envio := (v_exp.submitted_to_mesa IS NOT TRUE)
    OR (v_exp.fecha_envio_mesa IS NULL);

  UPDATE public.expedientes
  SET
    submitted_to_mesa = true,
    fecha_envio_mesa = v_now,
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    reingreso_manual_count = v_count,
    reingreso_manual_at = v_now,
    reingreso_manual_by = v_actor_id,
    updated_at = v_now
  WHERE id = p_expediente_id
    AND reingreso_manual_count = v_exp.reingreso_manual_count;

  IF NOT FOUND THEN
    SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent', true,
      'expediente_id', v_exp.id,
      'precalificacion_id', v_exp.id,
      'reingreso_manual_count', v_exp.reingreso_manual_count,
      'reingreso_manual_at', v_exp.reingreso_manual_at,
      'reingreso_manual_by', v_exp.reingreso_manual_by,
      'etapa_actual', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'submitted_to_mesa', true,
      'fecha_envio_mesa', v_exp.fecha_envio_mesa,
      'era_primer_envio', false
    );
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente_reingreso_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'precalificacion_id', p_expediente_id,
      'asesor_id', v_exp.asesor_id,
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'etapa_anterior', v_etapa_anterior,
      'subestado_anterior', v_subestado_anterior,
      'etapa_final', 1,
      'subestado_final', 'en_validacion_mesa',
      'numero_reingreso', v_count,
      'fecha', v_now,
      'reingreso_manual_count', v_count,
      'era_primer_envio', v_era_primer_envio
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'idempotent', false,
    'expediente_id', p_expediente_id,
    'precalificacion_id', p_expediente_id,
    'reingreso_manual_count', v_count,
    'reingreso_manual_at', v_now,
    'reingreso_manual_by', v_actor_id,
    'etapa_anterior', v_etapa_anterior,
    'subestado_anterior', v_subestado_anterior,
    'etapa_actual', 1,
    'subestado', 'en_validacion_mesa',
    'submitted_to_mesa', true,
    'fecha_envio_mesa', v_now,
    'era_primer_envio', v_era_primer_envio
  );
END;
$$;



-- from 115_asesor_cambios_revision_mesa.sql

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

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
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



-- from 211_vigencia_documental_tramo_3_8.sql

CREATE OR REPLACE FUNCTION public.register_expediente_documento_retencion(p_expediente_id uuid, p_tipo_documento text, p_storage_path text, p_nombre_original text, p_mime_type text, p_size_bytes bigint)
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
  v_tipo TEXT;
  v_prev_id UUID;
  v_prev_estatus public.estatus_revision;
  v_new_version INTEGER;
  v_new_estatus public.estatus_revision;
  v_new_id UUID;
  v_mime TEXT;
  v_principal BOOLEAN;
  v_opcion public.retencion_opcion;
  v_etapa_anterior SMALLINT;
  v_etapa_nueva SMALLINT;
  v_avance_8_9 BOOLEAN := false;
  v_fecha_envio TIMESTAMPTZ;
  v_fecha_local DATE;
  v_firma_desde DATE;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_tipo := NULLIF(btrim(COALESCE(p_tipo_documento, '')), '');
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: tipo_documento es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_tipo = ANY(public.retencion_doc_tipos_asesor_upload())) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: tipo_documento no permitido para retención (%)', v_tipo
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: storage_path es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_original IS NULL OR btrim(p_nombre_original) = '' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: nombre_original es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_mime := lower(btrim(COALESCE(p_mime_type, '')));
  IF v_mime = 'image/jpg' THEN
    v_mime := 'image/jpeg';
  END IF;

  IF NOT public.expediente_documento_mime_permitido(v_mime, v_tipo) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: mime_type no permitido (%)', p_mime_type
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: size_bytes debe ser mayor a 0'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: archivo excede tamaño máximo permitido'
      USING ERRCODE = '22023';
  END IF;

  v_principal := v_tipo IN (
    'retencion_acuse_con_sello',
    'retencion_carta_sin_sello'
  );

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at,
    e.firma_agendable_desde
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: solo el asesor dueño puede registrar documentos de retención'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: el expediente aún no fue enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_principal THEN
    IF v_exp.etapa_actual < 8 THEN
      RAISE EXCEPTION 'register_expediente_documento_retencion: expediente debe estar en etapa 8 o posterior (actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_exp.etapa_actual <> 8 THEN
      RAISE EXCEPTION 'register_expediente_documento_retencion: expediente debe estar en etapa 8 (actual: %)', v_exp.etapa_actual
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    btrim(p_storage_path),
    v_exp.organization_id,
    p_expediente_id,
    v_tipo
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: storage_path no coincide con expediente/tipo'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'register_expediente_documento_retencion: objeto no encontrado en storage'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.estatus_revision
  INTO v_prev_id, v_prev_estatus
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo
    AND d.deleted_at IS NULL
  FOR UPDATE;

  -- Hotfix Acuse: el dueño puede reemplazar el archivo activo (incl. validado)
  -- sin exigir rechazo Mesa. Soft-delete deja una sola versión activa.
  IF FOUND THEN
    UPDATE public.expediente_documentos
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = v_prev_id;
  ELSE
    v_prev_estatus := NULL;
  END IF;

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = v_tipo;

  IF v_prev_estatus = 'rechazado' THEN
    v_new_estatus := 'resubido';
  ELSE
    v_new_estatus := 'subido';
  END IF;

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
    v_mime,
    p_size_bytes,
    v_new_version,
    v_new_estatus,
    NULL,
    v_actor_id,
    'asesor'
  )
  RETURNING id INTO v_new_id;

  v_etapa_anterior := v_exp.etapa_actual;
  v_etapa_nueva := v_exp.etapa_actual;
  v_avance_8_9 := false;
  v_opcion := NULL;
  v_fecha_envio := NULL;
  v_firma_desde := v_exp.firma_agendable_desde;

  -- P211: assert antes de cualquier side-effect 8→9
  IF v_principal AND v_exp.etapa_actual = 8 THEN
  PERFORM public.assert_expediente_vigencia_documental_ok(p_expediente_id);
  END IF;

  -- P132-acuse / P117: principal canónico + etapa exacta 8 → avance atómico 8→9
  -- + firma_agendable_desde solo si NULL (= hoy Monterrey; sin mínimo de 5 hábiles).
  IF v_principal AND v_exp.etapa_actual = 8 THEN
    v_opcion := CASE
      WHEN v_tipo = 'retencion_acuse_con_sello' THEN 'con_sello'::public.retencion_opcion
      ELSE 'sin_sello'::public.retencion_opcion
    END;
    v_fecha_envio := NOW();
    v_etapa_nueva := 9;
    v_avance_8_9 := true;
    v_fecha_local := (NOW() AT TIME ZONE 'America/Monterrey')::DATE;
    IF v_exp.firma_agendable_desde IS NULL THEN
      v_firma_desde := v_fecha_local;
    END IF;

    INSERT INTO public.retencion_opciones (
      expediente_id,
      organization_id,
      retencion_opcion,
      updated_by
    ) VALUES (
      p_expediente_id,
      v_exp.organization_id,
      v_opcion,
      v_actor_id
    )
    ON CONFLICT (expediente_id) DO UPDATE SET
      retencion_opcion = EXCLUDED.retencion_opcion,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW();

    INSERT INTO public.retencion_envios (
      expediente_id,
      organization_id,
      enviado,
      fecha_envio_mesa,
      opcion,
      estado
    ) VALUES (
      p_expediente_id,
      v_exp.organization_id,
      true,
      v_fecha_envio,
      v_opcion,
      'enviado'
    )
    ON CONFLICT (expediente_id) DO UPDATE SET
      enviado = true,
      fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
      opcion = EXCLUDED.opcion,
      estado = 'enviado',
      updated_at = NOW();

    UPDATE public.expedientes
    SET
      etapa_actual = 9,
      subestado = 'en_proceso',
      firma_agendable_desde = COALESCE(firma_agendable_desde, v_firma_desde),
      updated_at = NOW()
    WHERE id = p_expediente_id;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.documento.register_retencion',
    'expediente_documento',
    v_new_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'tipo_documento', v_tipo,
      'version', v_new_version,
      'storage_path', btrim(p_storage_path),
      'nombre_original', btrim(p_nombre_original),
      'mime_type', v_mime,
      'size_bytes', p_size_bytes,
      'estatus_revision', v_new_estatus,
      'reemplazo', v_prev_id IS NOT NULL,
      'avance_8_9', v_avance_8_9,
      'etapa_anterior', v_etapa_anterior,
      'etapa_nueva', v_etapa_nueva,
      'retencion_opcion', v_opcion,
      'firma_agendable_desde', v_firma_desde,
      'fecha_carga_local', v_fecha_local
    )
  );

  IF v_avance_8_9 THEN
    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.enviar_retencion_mesa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'retencion_opcion', v_opcion,
        'required_documentos', to_jsonb(public.retencion_doc_tipos_requeridos(v_opcion)),
        'is_resend', false,
        'estado_nuevo', 'enviado',
        'etapa_anterior', v_etapa_anterior,
        'etapa_nueva', v_etapa_nueva,
        'transition', '8_9_acuse',
        'p132_acuse_libera_firma', true,
        'documento_id', v_new_id,
        'tipo_documento', v_tipo,
        'firma_agendable_desde', v_firma_desde,
        'fecha_carga_local', v_fecha_local,
        'timezone', 'America/Monterrey'
      )
    );

    PERFORM public.log_action(
      v_exp.organization_id,
      v_actor_id,
      v_actor_role,
      'expediente.avanzar_etapa_operativa',
      'expediente',
      p_expediente_id,
      jsonb_build_object(
        'actor_id', v_actor_id,
        'actor_role', v_actor_role,
        'etapa_anterior', 8,
        'etapa_nueva', 9,
        'subestado_anterior', v_exp.subestado,
        'subestado_nuevo', 'en_proceso',
        'transition', '8_9_acuse',
        'evento', '8_9_acuse',
        'documento_id', v_new_id,
        'tipo_documento', v_tipo,
        'firma_agendable_desde', v_firma_desde,
        'fecha_carga_local', v_fecha_local,
        'timezone', 'America/Monterrey'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'documento_id', v_new_id,
    'expediente_id', p_expediente_id,
    'tipo_documento', v_tipo,
    'version', v_new_version,
    'estatus_revision', v_new_estatus,
    'storage_path', btrim(p_storage_path),
    'mime_type', v_mime,
    'avance_8_9', v_avance_8_9,
    'etapa_anterior', v_etapa_anterior,
    'etapa_actual', v_etapa_nueva,
    'retencion_opcion', v_opcion,
    'firma_agendable_desde', v_firma_desde
  );
END;
$function$;



-- from 184_infonavit_submission_snapshot_outbox.sql

CREATE OR REPLACE FUNCTION public.asesor_enviar_reingreso_a_mesa(
  p_expediente_id UUID
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
  v_editor public.editor_decisions%ROWTYPE;
  v_cliente public.cliente_datos%ROWTYPE;
  v_etapa_anterior SMALLINT;
  v_subestado_anterior public.operativo_subestado;
  v_count INTEGER;
  v_era_primer_envio BOOLEAN;
  v_docs_count INTEGER;
  v_now TIMESTAMPTZ := NOW();
  v_elig JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: solo el asesor dueño puede reingresar a Mesa'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado = 'cancelado' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: el expediente está cancelado y no se puede reingresar'
      USING ERRCODE = '22023';
  END IF;

  SELECT ed.*
  INTO v_editor
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = p_expediente_id;

  IF NOT FOUND OR v_editor.monto_aprobado IS NULL OR v_editor.monto_aprobado <= 0 THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTA_MONTO: falta monto aprobado del editor'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.*
  INTO v_cliente
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: faltan Datos Generales del cliente'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.estado NOT IN ('completo', 'validado') THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: datos del cliente incompletos (estado: %)', v_cliente.estado
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente.porcentaje_cobro IS NULL
     OR v_cliente.porcentaje_cobro <= 0
     OR v_cliente.monto_calculado IS NULL
     OR btrim(COALESCE(v_cliente.metodo_pago, '')) = '' THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: porcentaje de cobro, monto calculado o método de pago'
      USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(v_exp.direccion_opcional, '')), '') IS NULL THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: Domicilio real del cliente'
      USING ERRCODE = '22023';
  END IF;

  v_elig := public.p189_infonavit_get_eligibility(p_expediente_id);
  IF COALESCE((v_elig->>'required')::boolean, false) THEN
    PERFORM public.assert_mejoravit_infonavit_datos_persistidos(p_expediente_id);
  END IF;

  v_docs_count := public.count_integration_docs_presentes(p_expediente_id);
  IF NOT public.integration_docs_completos(p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_enviar_reingreso_a_mesa: FALTAN_DOCS: faltan documentos obligatorios (% de %)',
      v_docs_count, cardinality(public.integration_doc_tipos_asesor_envio())
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.reingreso_manual_at IS NOT NULL
     AND v_exp.reingreso_manual_by IS NOT DISTINCT FROM v_actor_id
     AND v_exp.reingreso_manual_at > (v_now - INTERVAL '5 seconds') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent', true,
      'expediente_id', v_exp.id,
      'precalificacion_id', v_exp.id,
      'reingreso_manual_count', v_exp.reingreso_manual_count,
      'reingreso_manual_at', v_exp.reingreso_manual_at,
      'reingreso_manual_by', v_exp.reingreso_manual_by,
      'etapa_actual', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'submitted_to_mesa', true,
      'fecha_envio_mesa', v_exp.fecha_envio_mesa,
      'era_primer_envio', false
    );
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_subestado_anterior := v_exp.subestado;
  v_count := COALESCE(v_exp.reingreso_manual_count, 0) + 1;
  v_era_primer_envio := (v_exp.submitted_to_mesa IS NOT TRUE)
    OR (v_exp.fecha_envio_mesa IS NULL);

  UPDATE public.expedientes
  SET
    submitted_to_mesa = true,
    fecha_envio_mesa = v_now,
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    reingreso_manual_count = v_count,
    reingreso_manual_at = v_now,
    reingreso_manual_by = v_actor_id,
    updated_at = v_now
  WHERE id = p_expediente_id
    AND reingreso_manual_count = v_exp.reingreso_manual_count;

  IF NOT FOUND THEN
    SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent', true,
      'expediente_id', v_exp.id,
      'precalificacion_id', v_exp.id,
      'reingreso_manual_count', v_exp.reingreso_manual_count,
      'reingreso_manual_at', v_exp.reingreso_manual_at,
      'reingreso_manual_by', v_exp.reingreso_manual_by,
      'etapa_actual', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'submitted_to_mesa', true,
      'fecha_envio_mesa', v_exp.fecha_envio_mesa,
      'era_primer_envio', false
    );
  END IF;

  IF COALESCE((v_elig->>'should_enqueue')::boolean, false) THEN
    PERFORM public.enqueue_infonavit_pdf_submission(
      p_expediente_id,
      v_exp.organization_id,
      v_count,
      'reingreso',
      v_now
    );
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente_reingreso_mesa',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'precalificacion_id', p_expediente_id,
      'asesor_id', v_exp.asesor_id,
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'etapa_anterior', v_etapa_anterior,
      'subestado_anterior', v_subestado_anterior,
      'etapa_final', 1,
      'subestado_final', 'en_validacion_mesa',
      'numero_reingreso', v_count,
      'fecha', v_now,
      'reingreso_manual_count', v_count,
      'era_primer_envio', v_era_primer_envio
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'idempotent', false,
    'expediente_id', p_expediente_id,
    'precalificacion_id', p_expediente_id,
    'reingreso_manual_count', v_count,
    'reingreso_manual_at', v_now,
    'reingreso_manual_by', v_actor_id,
    'etapa_anterior', v_etapa_anterior,
    'subestado_anterior', v_subestado_anterior,
    'etapa_actual', 1,
    'subestado', 'en_validacion_mesa',
    'submitted_to_mesa', true,
    'fecha_envio_mesa', v_now,
    'era_primer_envio', v_era_primer_envio
  );
END;
$$;



-- from 156_cliente_constancia_curp_validaciones.sql

CREATE OR REPLACE FUNCTION public.asesor_registrar_validacion_identidad(
  p_expediente_id UUID,
  p_tipo TEXT,
  p_estado TEXT,
  p_metodo TEXT,
  p_resultado_resumido JSONB DEFAULT '{}'::jsonb,
  p_documento_id UUID DEFAULT NULL,
  p_documento_version INT DEFAULT NULL,
  p_input_fingerprint TEXT DEFAULT '',
  p_proveedor TEXT DEFAULT 'local'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp public.expedientes%ROWTYPE;
  v_id UUID;
  v_prev UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_registrar_validacion_identidad: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_registrar_validacion_identidad: solo asesor'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exp FROM public.expedientes e
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_exp.organization_id IS DISTINCT FROM v_org OR NOT public.asesor_can_operate_expediente_as(v_actor, p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_registrar_validacion_identidad: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_tipo IS NULL OR p_estado IS NULL OR p_metodo IS NULL THEN
    RAISE EXCEPTION 'asesor_registrar_validacion_identidad: tipo/estado/metodo obligatorios'
      USING ERRCODE = '22023';
  END IF;

  -- Invalidar vigente previa del mismo tipo
  UPDATE public.cliente_validaciones_identidad
  SET vigente = false,
      invalidado_at = now(),
      invalidado_motivo = 'reemplazo',
      updated_at = now()
  WHERE expediente_id = p_expediente_id
    AND tipo = p_tipo
    AND vigente = true
  RETURNING id INTO v_prev;

  INSERT INTO public.cliente_validaciones_identidad (
    organization_id, expediente_id, tipo, estado, metodo, proveedor,
    documento_id, documento_version, input_fingerprint, resultado_resumido,
    realizado_por, realizado_por_rol, vigente
  ) VALUES (
    v_org, p_expediente_id, p_tipo, p_estado, p_metodo, coalesce(nullif(btrim(p_proveedor), ''), 'local'),
    p_documento_id, p_documento_version, coalesce(p_input_fingerprint, ''),
    coalesce(p_resultado_resumido, '{}'::jsonb),
    v_actor, v_role, true
  ) RETURNING id INTO v_id;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'identidad.validacion.registrar',
    'expediente', p_expediente_id,
    jsonb_build_object(
      'validacion_id', v_id,
      'prev_id', v_prev,
      'tipo', p_tipo,
      'estado', p_estado,
      'metodo', p_metodo,
      'documento_id', p_documento_id,
      'documento_version', p_documento_version
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'tipo', p_tipo,
    'estado', p_estado
  );
END;
$$;



-- from 156_cliente_constancia_curp_validaciones.sql

CREATE OR REPLACE FUNCTION public.asesor_list_validaciones_identidad(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp public.expedientes%ROWTYPE;
  v_items JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: perfil inactivo'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
  IF NOT FOUND OR v_exp.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_role = 'asesor' AND NOT public.asesor_can_operate_expediente_as(v_actor, p_expediente_id) THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('asesor', 'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin', 'editor') THEN
    RAISE EXCEPTION 'asesor_list_validaciones_identidad: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.tipo), '[]'::jsonb)
  INTO v_items
  FROM public.cliente_validaciones_identidad v
  WHERE v.expediente_id = p_expediente_id AND v.vigente = true;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;



-- from 156_cliente_constancia_curp_validaciones.sql

CREATE OR REPLACE FUNCTION public.asesor_invalidar_validaciones_identidad(
  p_expediente_id UUID,
  p_motivo TEXT DEFAULT 'datos_cambiaron',
  p_tipos TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp public.expedientes%ROWTYPE;
  v_count INT;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_invalidar_validaciones_identidad: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_invalidar_validaciones_identidad: solo asesor'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exp FROM public.expedientes e
  WHERE e.id = p_expediente_id AND e.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR NOT public.asesor_can_operate_expediente_as(v_actor, p_expediente_id) OR v_exp.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'asesor_invalidar_validaciones_identidad: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  -- p_tipos NULL → todas las vigentes; si array → solo esos tipos (historial intacto)
  UPDATE public.cliente_validaciones_identidad
  SET vigente = false,
      invalidado_at = now(),
      invalidado_motivo = coalesce(nullif(btrim(p_motivo), ''), 'datos_cambiaron'),
      updated_at = now()
  WHERE expediente_id = p_expediente_id
    AND vigente = true
    AND (p_tipos IS NULL OR tipo = ANY (p_tipos));

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'identidad.validacion.invalidar',
    'expediente', p_expediente_id,
    jsonb_build_object(
      'count', v_count,
      'motivo', coalesce(p_motivo, 'datos_cambiaron'),
      'tipos', to_jsonb(p_tipos)
    )
  );

  RETURN jsonb_build_object('ok', true, 'invalidated', v_count, 'tipos', to_jsonb(p_tipos));
END;
$$;



-- from 028_integration_doc_tipos_sin_duplicados.sql

CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_upload_allowed(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
BEGIN
  SELECT *
  INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RETURN false;
  END IF;

  IF v_actor_org IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
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
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id) THEN
    RETURN false;
  END IF;

  IF v_exp.ciclo_estado <> 'activo' OR v_exp.submitted_to_mesa = true THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;



-- from 150_reingreso_edicion_completa_asesor.sql

CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_post_mesa_upload_allowed(
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor RECORD;
  v_exp RECORD;
BEGIN
  SELECT * INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL
     OR NOT (v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  SELECT p.app_role, p.organization_id, p.active
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id IS NULL OR NOT FOUND OR v_actor.active IS NOT TRUE
     OR v_actor.app_role <> 'asesor'
     OR v_actor.organization_id IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
  END IF;

  SELECT e.*
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL
     OR NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id)
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.expediente_documentos d
    WHERE d.expediente_id = v_exp.id
      AND d.tipo_documento = v_parsed.tipo_documento
      AND d.deleted_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  IF v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_opcionales()) THEN
    RETURN true;
  END IF;

  RETURN public.es_reingreso_asesor_edicion_activa(v_exp.id);
END;
$function$;



-- from 031_rpc_correcciones_asesor_post_mesa.sql

CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_correccion_allowed(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
BEGIN
  SELECT *
  INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (v_parsed.tipo_documento = ANY(public.integration_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RETURN false;
  END IF;

  IF v_actor_org IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
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
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id) THEN
    RETURN false;
  END IF;

  IF v_exp.ciclo_estado <> 'activo' OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = v_parsed.expediente_id
      AND d.tipo_documento = v_parsed.tipo_documento
      AND d.deleted_at IS NULL
      AND d.estatus_revision = 'rechazado'
  );
END;
$$;



-- from 102_acuse_mime_avance_8_9_y_firmado_10_11.sql

CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_retencion_upload_allowed(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_principal BOOLEAN;
BEGIN
  SELECT *
  INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (v_parsed.tipo_documento = ANY(public.retencion_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RETURN false;
  END IF;

  IF v_actor_org IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id) THEN
    RETURN false;
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RETURN false;
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RETURN false;
  END IF;

  v_principal := v_parsed.tipo_documento IN (
    'retencion_acuse_con_sello',
    'retencion_carta_sin_sello'
  );

  IF v_exp.etapa_actual = 8 THEN
    RETURN true;
  END IF;

  -- P117: reemplazo del principal en etapa 9+ sin re-avanzar
  IF v_principal AND v_exp.etapa_actual >= 9 THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;



-- create_expediente_for_asesor P208 team scope

CREATE OR REPLACE FUNCTION public.create_expediente_for_asesor(
  p_asesor_id uuid,
  p_programa public.programa,
  p_nss text,
  p_cliente_nombre text,
  p_telefono_cliente text,
  p_direccion_opcional text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role public.app_role;
  v_org_id uuid;
  v_target public.profiles%ROWTYPE;
  v_origen_mesa public.origen_mesa;
  v_nss text;
  v_telefono text;
  v_nombre text;
  v_direccion text;
  v_expediente_id uuid;
  v_created_at timestamptz;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.profile_has_capability(v_actor_id, 'create_for_any_advisor') THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: sin capability create_for_any_advisor'
      USING ERRCODE = '42501';
  END IF;

  IF p_asesor_id IS NULL THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: p_asesor_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = p_asesor_id
    AND p.active = true
    AND p.app_role = 'asesor'
    AND p.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: asesor destino inválido o fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF p_asesor_id IS DISTINCT FROM v_actor_id
     AND NOT public.asesor_comparten_equipo_activo(v_actor_id, p_asesor_id) THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: asesor destino fuera de equipo compartido'
      USING ERRCODE = '42501';
  END IF;

  IF p_programa IS NULL THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: programa es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_nombre := btrim(COALESCE(p_cliente_nombre, ''));
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: el nombre del cliente es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_nss := public.normalize_nss_mexico(p_nss);
  IF v_nss IS NULL OR v_nss !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: el NSS debe tener exactamente 11 dígitos'
      USING ERRCODE = '22023';
  END IF;

  v_telefono := btrim(COALESCE(p_telefono_cliente, ''));
  IF v_telefono !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: el teléfono debe tener exactamente 10 dígitos'
      USING ERRCODE = '22023';
  END IF;

  v_direccion := COALESCE(btrim(COALESCE(p_direccion_opcional, '')), '');

  -- origen_mesa desde el TARGET (no el actor)
  v_origen_mesa := COALESCE(v_target.tipo_asesor_origen::text, 'interno')::public.origen_mesa;

  IF public.nss_bloqueado_en_mesa(v_org_id, v_nss, p_programa, NULL) THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: Este NSS ya tiene un expediente enviado a Mesa.'
      USING ERRCODE = '23505';
  END IF;

  -- Duplicado activo NSS+programa (misma regla que índice único / create_expediente)
  IF EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.organization_id = v_org_id
      AND e.nss = v_nss
      AND e.programa = p_programa
      AND e.ciclo_estado = 'activo'
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: ya existe un expediente activo con ese NSS y programa'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.expedientes (
    organization_id,
    asesor_id,
    programa,
    nss,
    cliente_nombre,
    telefono_cliente,
    direccion_opcional,
    origen_mesa,
    ciclo_estado,
    submitted_to_mesa,
    etapa_actual,
    subestado,
    deleted_at
  ) VALUES (
    v_org_id,
    p_asesor_id,
    p_programa,
    v_nss,
    v_nombre,
    v_telefono,
    v_direccion,
    v_origen_mesa,
    'activo',
    false,
    1,
    'pendiente',
    NULL
  )
  RETURNING id, created_at INTO v_expediente_id, v_created_at;

  INSERT INTO public.editor_decisions (
    expediente_id,
    organization_id,
    decision,
    monto_aprobado,
    notas_revision
  ) VALUES (
    v_expediente_id,
    v_org_id,
    'pendiente',
    NULL,
    ''
  );

  PERFORM public.log_action(
    v_org_id,
    v_actor_id,
    v_actor_role,
    'expediente.create',
    'expediente',
    v_expediente_id,
    jsonb_build_object(
      'programa', p_programa,
      -- Sin NSS completo (requisito alta delegada); solo sufijo de auditoría.
      'nss_sufijo', right(v_nss, 4),
      'origen_mesa', v_origen_mesa,
      'asesor_id', p_asesor_id,
      'target_asesor_id', p_asesor_id,
      'organization_id', v_org_id,
      'etapa_actual', 1,
      'subestado', 'pendiente',
      'ciclo_estado', 'activo',
      'created_for_any_advisor', true
    )
  );

  RETURN jsonb_build_object(
    'id', v_expediente_id,
    'organization_id', v_org_id,
    'asesor_id', p_asesor_id,
    'origen_mesa', v_origen_mesa,
    'programa', p_programa,
    'nss', v_nss,
    'cliente_nombre', v_nombre,
    'telefono_cliente', v_telefono,
    'direccion_opcional', v_direccion,
    'etapa_actual', 1,
    'subestado', 'pendiente',
    'ciclo_estado', 'activo',
    'submitted_to_mesa', false,
    'created_at', v_created_at
  );
END;
$$;



-- list_asesores_activos_org P208 team scope

CREATE OR REPLACE FUNCTION public.list_asesores_activos_org()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role public.app_role;
  v_org_id uuid;
  v_items jsonb;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'list_asesores_activos_org: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'list_asesores_activos_org: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'list_asesores_activos_org: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.profile_has_capability(v_actor_id, 'create_for_any_advisor') THEN
    RAISE EXCEPTION 'list_asesores_activos_org: sin capability create_for_any_advisor'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'email', p.email
      )
      ORDER BY p.full_name ASC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.profiles p
  WHERE p.organization_id = v_org_id
    AND p.active = true
    AND p.app_role = 'asesor'
    AND public.asesor_comparten_equipo_activo(v_actor_id, p.id);

  RETURN jsonb_build_object('asesores', coalesce(v_items, '[]'::jsonb));
END;
$$;



-- asesor_list_expedientes_page P208 p_owner_asesor_id

CREATE OR REPLACE FUNCTION public.asesor_list_expedientes_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_buscar TEXT DEFAULT NULL,
  p_decision TEXT DEFAULT NULL,
  p_estatus_operativo TEXT DEFAULT NULL,
  p_resultado_real TEXT DEFAULT NULL,
  p_programa TEXT DEFAULT NULL,
  p_etapa_exacta INTEGER DEFAULT NULL,
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_quick_filter TEXT DEFAULT 'todos',
  p_owner_asesor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_active BOOLEAN;
  v_page INTEGER;
  v_size INTEGER;
  v_from INTEGER;
  v_quick TEXT;
  v_owner UUID;
  v_total BIGINT;
  v_items JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_list_expedientes_page: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active
  INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_list_expedientes_page: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_from := (v_page - 1) * v_size;
  v_quick := lower(trim(coalesce(nullif(p_quick_filter, ''), 'todos')));

  v_owner := coalesce(p_owner_asesor_id, v_actor);
  IF v_owner IS DISTINCT FROM v_actor THEN
    IF NOT public.profile_has_capability(v_actor, 'integrate_for_any_advisor') THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: sin capability integrate_for_any_advisor'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.asesor_comparten_equipo_activo(v_actor, v_owner) THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: asesor titular fuera de equipo compartido'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  WITH base AS (
    SELECT
      e.id,
      e.programa,
      public.asesor_inbox_programa_ui(e.programa) AS programa_ui,
      e.nss::text AS nss,
      e.cliente_nombre,
      e.telefono_cliente::text AS telefono_cliente,
      e.direccion_opcional,
      e.asesor_id,
      e.origen_mesa::text AS origen_mesa,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.motivo_rechazo,
      e.comentario_rechazo,
      e.fecha_cita,
      e.firma_agendable_desde,
      e.pago_concasa_resultado,
      e.pago_concasa_at,
      e.created_at,
      e.updated_at,
      e.expediente_anterior_id,
      e.reingreso_rechazo_id,
      e.reingreso_manual_count,
      e.reingreso_manual_at,
      e.reingreso_manual_by,
      e.reprecalificacion_pendiente_id,
      coalesce(ed.decision::text, 'pendiente') AS decision,
      ed.monto_aprobado,
      coalesce(ed.notas_revision, '') AS notas_revision,
      ed.aprobado_at,
      ed.monto_aprobado_al_aprobar,
      ed.no_cumple_at,
      public.asesor_inbox_resultado_real(
        e.submitted_to_mesa,
        e.subestado::text,
        e.ciclo_estado::text,
        ed.decision::text
      ) AS resultado_real,
      public.asesor_inbox_categoria_correccion(e.id) AS categoria_correccion,
      eff.estado_efectivo,
      CASE
        WHEN eff.estado_efectivo = 'correccion_requerida'
        THEN public.asesor_inbox_format_correccion_explicacion(
          public.asesor_inbox_correccion_labels_vigentes(e.id)
        )
        ELSE NULL
      END AS correccion_explicacion,
      CASE
        WHEN eff.estado_efectivo = 'correccion_requerida'
        THEN public.asesor_inbox_correccion_resumen(e.id)
        ELSE NULL
      END AS correccion_resumen,
      public.asesor_inbox_pendiente_agendar_biometricos(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_biometricos,
      public.asesor_inbox_pendiente_agendar_firma(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_firma,
      public.asesor_inbox_pendiente_subir_acuse(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_subir_acuse,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN 'pending'
        WHEN last_real.decision = 'aprobado' THEN 'approved'
        WHEN last_real.decision = 'no_cumple' THEN 'no_cumple'
        ELSE NULL
      END AS reprecal_estado,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
        ELSE NULL
      END AS reprecal_solicitada_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
        ELSE last_real.decided_at
      END AS reprecal_resuelta_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
        ELSE last_real.decided_at
      END AS reprecal_activity_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.monto_aprobado_previo
        ELSE last_real.monto_aprobado_previo
      END AS reprecal_monto_previo,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
        WHEN last_real.decision = 'aprobado' THEN last_real.monto_aprobado
        ELSE NULL
      END AS reprecal_monto_resultado,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.programa_solicitado::text
        ELSE last_real.programa_solicitado::text
      END AS reprecal_programa_solicitado,
      coalesce(
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
          ELSE last_real.decided_at
        END,
        e.created_at
      ) AS inbox_sort_at
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    LEFT JOIN LATERAL (
      SELECT public.asesor_inbox_estado_efectivo(e.id) AS estado_efectivo
    ) eff ON TRUE
    LEFT JOIN public.expediente_precalificacion_intentos pend
      ON pend.id = e.reprecalificacion_pendiente_id
    LEFT JOIN LATERAL (
      SELECT
        i.decision,
        i.created_at,
        i.decided_at,
        i.monto_aprobado,
        i.monto_aprobado_previo,
        i.programa_solicitado
      FROM public.expediente_precalificacion_intentos i
      WHERE e.reprecalificacion_pendiente_id IS NULL
        AND i.expediente_id = e.id
        AND i.decision IN (
          'aprobado'::public.editor_decision,
          'no_cumple'::public.editor_decision
        )
        AND (
          i.decision_previa IS NOT NULL
          OR nullif(btrim(coalesce(i.idempotency_key, '')), '') IS NOT NULL
        )
      ORDER BY i.decided_at DESC NULLS LAST, i.created_at DESC, i.id DESC
      LIMIT 1
    ) last_real ON TRUE
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_owner
  ),
  filtered AS (
    SELECT b.*
    FROM base b
    WHERE public.asesor_inbox_matches_buscar(
        b.cliente_nombre, b.nss, b.telefono_cliente, b.programa_ui, p_buscar
      )
      AND (
        p_decision IS NULL OR trim(p_decision) = ''
        OR b.decision = trim(p_decision)
      )
      AND (
        p_estatus_operativo IS NULL OR trim(p_estatus_operativo) = ''
        OR coalesce(b.subestado, 'pendiente') = trim(p_estatus_operativo)
      )
      AND (
        p_resultado_real IS NULL OR trim(p_resultado_real) = ''
        OR b.resultado_real = trim(p_resultado_real)
      )
      AND (
        p_programa IS NULL OR trim(p_programa) = ''
        OR b.programa_ui = trim(p_programa)
      )
      AND (
        p_etapa_exacta IS NULL
        OR b.etapa_actual = p_etapa_exacta::smallint
      )
      AND (
        p_fecha_desde IS NULL
        OR b.created_at >= (p_fecha_desde::timestamp AT TIME ZONE 'America/Monterrey')
      )
      AND (
        p_fecha_hasta IS NULL
        OR b.created_at <= (
          (p_fecha_hasta::timestamp + interval '1 day' - interval '1 millisecond')
            AT TIME ZONE 'America/Monterrey'
        )
      )
      AND (
        v_quick = 'todos'
        OR coalesce(b.ciclo_estado, '') IS DISTINCT FROM 'cerrado'
      )
      AND CASE v_quick
        WHEN 'todos' THEN TRUE
        WHEN 'en_tramite' THEN b.estado_efectivo = 'en_tramite'
        WHEN 'correccion_requerida' THEN b.estado_efectivo = 'correccion_requerida'
        WHEN 'correccion_enviada' THEN b.estado_efectivo = 'correccion_enviada'
        WHEN 'rechazados_mesa' THEN b.estado_efectivo = 'rechazado_mesa'
        WHEN 'cancelados' THEN b.estado_efectivo = 'cancelado'
        WHEN 'agendar_biometricos' THEN b.pendiente_agendar_biometricos
        WHEN 'agendar_firma' THEN b.pendiente_agendar_firma
        WHEN 'subir_acuse' THEN b.pendiente_subir_acuse
        ELSE TRUE
      END
  ),
  counted AS (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  page AS (
    SELECT
      f.id,
      f.programa_ui AS programa,
      f.programa::text AS programa_db,
      f.nss,
      f.cliente_nombre,
      f.telefono_cliente,
      f.direccion_opcional,
      f.asesor_id,
      f.origen_mesa,
      f.submitted_to_mesa,
      f.fecha_envio_mesa,
      f.etapa_actual,
      f.subestado,
      f.ciclo_estado,
      f.motivo_rechazo,
      f.comentario_rechazo,
      f.fecha_cita,
      f.firma_agendable_desde,
      f.pago_concasa_resultado,
      f.pago_concasa_at,
      f.created_at,
      f.updated_at,
      f.expediente_anterior_id,
      f.reingreso_rechazo_id,
      f.reingreso_manual_count,
      f.reingreso_manual_at,
      f.reingreso_manual_by,
      f.reprecalificacion_pendiente_id,
      f.decision,
      f.monto_aprobado,
      f.notas_revision,
      f.aprobado_at,
      f.monto_aprobado_al_aprobar,
      f.no_cumple_at,
      f.resultado_real,
      f.categoria_correccion,
      f.estado_efectivo,
      f.correccion_explicacion,
      f.correccion_resumen,
      f.reprecal_estado,
      f.reprecal_solicitada_at,
      f.reprecal_resuelta_at,
      f.reprecal_activity_at,
      f.reprecal_monto_previo,
      f.reprecal_monto_resultado,
      f.reprecal_programa_solicitado,
      f.inbox_sort_at
    FROM filtered f
    ORDER BY f.inbox_sort_at DESC, f.id DESC
    OFFSET v_from
    LIMIT v_size
  )
  SELECT
    c.total,
    coalesce(
      (SELECT jsonb_agg((to_jsonb(p) - 'inbox_sort_at') ORDER BY p.inbox_sort_at DESC, p.id DESC) FROM page p),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM counted c;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', v_total,
    'page', v_page,
    'page_size', v_size,
    'has_more', (v_from + v_size) < v_total
  );
END;
$$;

