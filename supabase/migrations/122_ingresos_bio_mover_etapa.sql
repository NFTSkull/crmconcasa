-- ConCasa CRM — P135: Ingresos reconoce movimientos Mesa post-Biometría
-- Solo REPLACE de ingresos_bio_aprobacion_at. Sin tablas, triggers ni cambios operativos.
-- No toca mesa.expediente.mover_etapa ni etapas/citas/docs/quick actions.

CREATE OR REPLACE FUNCTION public.ingresos_bio_aprobacion_at(p_expediente_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  -- Fecha canónica = evidencia válida más antigua entre:
  --   1) action_log avanzar 5_8 / 5_6 / 5_7
  --   2) P114 tracking etapa_anterior=5 → 6|7|8
  --   3) mesa.expediente.mover_etapa estructurado 3|4|5 → etapa_nueva >= 6
  SELECT MIN(ev.ts)
  FROM (
    SELECT al.created_at AS ts
    FROM public.action_log al
    WHERE al.entity_type = 'expediente'
      AND al.entity_id = p_expediente_id
      AND al.action = 'expediente.avanzar_etapa_operativa'
      AND al.payload->>'transition' IN ('5_8', '5_6', '5_7')

    UNION ALL

    SELECT t.fecha_entrada AS ts
    FROM public.expediente_paso_visual_transiciones t
    WHERE t.expediente_id = p_expediente_id
      AND t.etapa_anterior = 5
      AND t.etapa_nueva IN (6, 7, 8)

    UNION ALL

    SELECT al.created_at AS ts
    FROM public.action_log al
    INNER JOIN public.expedientes e
      ON e.id = al.entity_id
     AND e.organization_id IS NOT NULL
    WHERE al.entity_type = 'expediente'
      AND al.entity_id = p_expediente_id
      AND al.action = 'mesa.expediente.mover_etapa'
      AND NULLIF(btrim(al.payload->>'etapa_anterior'), '') ~ '^[0-9]+$'
      AND NULLIF(btrim(al.payload->>'etapa_nueva'), '') ~ '^[0-9]+$'
      AND (btrim(al.payload->>'etapa_anterior'))::SMALLINT IN (3, 4, 5)
      AND (btrim(al.payload->>'etapa_nueva'))::SMALLINT >= 6
  ) ev;
$$;

COMMENT ON FUNCTION public.ingresos_bio_aprobacion_at(UUID) IS
  'P134/P135: fecha canónica aprobación Biometría (5_8/5_6/5_7, P114 desde 5, o mesa.mover_etapa 3|4|5→>=6). MIN de evidencias.';

REVOKE ALL ON FUNCTION public.ingresos_bio_aprobacion_at(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingresos_bio_aprobacion_at(UUID)
  TO authenticated, service_role, postgres;
