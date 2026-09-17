-- ConCasa CRM — Enviar a Mesa: alinear guard de Datos Generales con equipos externos.
--
-- Problema:
-- `expedientes_assert_datos_generales_integrity_on_submit()` trataba como externo a
-- miembros activos de los equipos Silvia/Orlando, pero omitía al propio líder.
-- El contrato canónico de equipo (`asesor_pertenece_equipo_activo`) sí considera
-- líder + miembros. Para Orlando esto producía una contradicción: UI/documentos
-- externos completos, pero el trigger exigía `telefono_casa` y DG internos.
--
-- Alcance:
-- - Solo reemplaza la función de trigger existente.
-- - No modifica expedientes, documentos, citas, cupos, agenda ni Sheets.
-- - Equipo Silvia con rollout nuevo conserva contrato completo (`v_es_silvia_nuevo`).
-- - Asesores internos fuera de esos equipos conservan exactamente el mismo guard.

CREATE OR REPLACE FUNCTION public.expedientes_assert_datos_generales_integrity_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tipo_asesor_origen text;
  v_es_silvia_nuevo boolean := false;
  v_es_externo boolean := false;
  v_cd public.cliente_datos%ROWTYPE;
  v_refs jsonb;
  v_dir jsonb;
  v_ref jsonb;
  v_ref_phone text;
  i integer;
BEGIN
  IF TG_OP <> 'UPDATE'
     OR OLD.submitted_to_mesa IS TRUE
     OR NEW.submitted_to_mesa IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  v_es_silvia_nuevo := public.asesor_es_equipo_silvia(NEW.asesor_id)
    AND public.asesor_equipo_silvia_paquete_nuevo_habilitado();

  SELECT p.tipo_asesor_origen::text
  INTO v_tipo_asesor_origen
  FROM public.profiles p
  WHERE p.id = NEW.asesor_id;

  v_es_externo := NOT v_es_silvia_nuevo AND (
    lower(btrim(COALESCE(NEW.origen_mesa::text, ''))) = 'externo'
    OR lower(btrim(COALESCE(v_tipo_asesor_origen, ''))) = 'externo'
    OR EXISTS (
      SELECT 1
      FROM public.asesor_equipos t
      JOIN public.profiles lider
        ON lider.id = t.leader_id
       AND lider.active = true
      WHERE t.active = true
        AND t.organization_id = NEW.organization_id
        AND lower(btrim(lider.email)) IN (
          'silvia.reyes@concasa.mx',
          'orlando.solis@concasa.mx'
        )
        -- Helper canónico: true para el líder y para miembros activos.
        AND public.asesor_pertenece_equipo_activo(t.id, NEW.asesor_id)
    )
  );

  IF v_es_externo THEN
    RETURN NEW;
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.telefono_casa, '')), '') IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_TELEFONO_CASA_FALTANTE'
      USING ERRCODE = '22023';
  END IF;

  SELECT cd.* INTO v_cd
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = NEW.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_FALTANTES'
      USING ERRCODE = '22023';
  END IF;

  v_refs := COALESCE(v_cd.referencias, '[]'::jsonb);
  IF jsonb_typeof(v_refs) <> 'array' OR jsonb_array_length(v_refs) < 2 THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_REFERENCIAS_FALTANTES'
      USING ERRCODE = '22023';
  END IF;

  FOR i IN 0..1 LOOP
    v_ref := COALESCE(v_refs->i, '{}'::jsonb);
    v_ref_phone := NULLIF(
      btrim(COALESCE(v_ref->>'celular', v_ref->>'telefono', '')),
      ''
    );
    IF NULLIF(btrim(COALESCE(v_ref->>'nombre', '')), '') IS NULL
       OR v_ref_phone IS NULL THEN
      RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_REFERENCIAS_INCOMPLETAS'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_dir := CASE
    WHEN jsonb_typeof(v_cd.datos->'direccionEmpresa') = 'object'
      THEN v_cd.datos->'direccionEmpresa'
    ELSE '{}'::jsonb
  END;

  IF NULLIF(btrim(COALESCE(v_dir->>'calle', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_dir->>'colonia', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_dir->>'municipio', '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(v_dir->>'cp', '')), '') IS NULL THEN
    RAISE EXCEPTION 'enviar_a_mesa: DATOS_GENERALES_DIRECCION_EMPRESA_FALTANTE'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.expedientes_assert_datos_generales_integrity_on_submit() IS
  'Integridad DG al enviar: externos por origen/tipo o equipo Silvia/Orlando (líder + miembros) quedan exentos del contrato interno; Silvia rollout ON conserva contrato completo.';
