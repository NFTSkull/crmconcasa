-- ConCasa CRM — P114: trazabilidad canónica de entrada a paso visual (11)
-- Sin backfill. Históricos conservan fecha NULL. Sin action_log.

ALTER TABLE public.expedientes
  ADD COLUMN IF NOT EXISTS fecha_entrada_paso_visual_actual TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.expedientes.fecha_entrada_paso_visual_actual IS
  'P114: instante canónico de entrada al paso visual actual (11). NULL = desconocido (histórico pre-migración). Solo mantenido por trigger.';

CREATE OR REPLACE FUNCTION public.__map_etapa_interna_a_paso_visual(p_etapa INTEGER)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    WHEN p_etapa IS NULL OR p_etapa < 1 OR p_etapa > 12 THEN NULL
    WHEN p_etapa <= 3 THEN p_etapa::SMALLINT
    WHEN p_etapa = 4 THEN 3::SMALLINT
    ELSE (p_etapa - 1)::SMALLINT
  END;
$$;

COMMENT ON FUNCTION public.__map_etapa_interna_a_paso_visual(INTEGER) IS
  'P114: etapa interna 1–12 → paso visual 1–11 (4→3).';

REVOKE ALL ON FUNCTION public.__map_etapa_interna_a_paso_visual(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.__map_etapa_interna_a_paso_visual(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.__map_etapa_interna_a_paso_visual(INTEGER)
  TO authenticated, service_role, postgres;

CREATE TABLE IF NOT EXISTS public.expediente_paso_visual_transiciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expediente_id UUID NOT NULL
    REFERENCES public.expedientes(id) ON DELETE RESTRICT,
  etapa_anterior SMALLINT NULL
    CONSTRAINT expediente_paso_visual_transiciones_etapa_ant_chk
    CHECK (etapa_anterior IS NULL OR etapa_anterior BETWEEN 1 AND 12),
  etapa_nueva SMALLINT NOT NULL
    CONSTRAINT expediente_paso_visual_transiciones_etapa_nueva_chk
    CHECK (etapa_nueva BETWEEN 1 AND 12),
  paso_visual_anterior SMALLINT NULL
    CONSTRAINT expediente_paso_visual_transiciones_paso_ant_chk
    CHECK (paso_visual_anterior IS NULL OR paso_visual_anterior BETWEEN 1 AND 11),
  paso_visual_nuevo SMALLINT NOT NULL
    CONSTRAINT expediente_paso_visual_transiciones_paso_nuevo_chk
    CHECK (paso_visual_nuevo BETWEEN 1 AND 11),
  fecha_entrada TIMESTAMPTZ NOT NULL,
  actor_user_id UUID NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_paso_visual_transiciones_cruce_chk
    CHECK (
      paso_visual_anterior IS NULL
      OR paso_visual_anterior IS DISTINCT FROM paso_visual_nuevo
    )
);

COMMENT ON TABLE public.expediente_paso_visual_transiciones IS
  'P114: historial append-only de creación y cruces entre pasos visuales. No registra 3→4 (mismo paso 3). Solo inserta el trigger canónico.';

CREATE INDEX IF NOT EXISTS expediente_paso_visual_transiciones_exp_fecha_idx
  ON public.expediente_paso_visual_transiciones (expediente_id, fecha_entrada DESC);

CREATE INDEX IF NOT EXISTS expediente_paso_visual_transiciones_exp_created_idx
  ON public.expediente_paso_visual_transiciones (expediente_id, created_at DESC);

ALTER TABLE public.expediente_paso_visual_transiciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expediente_paso_visual_transiciones_select
  ON public.expediente_paso_visual_transiciones;
CREATE POLICY expediente_paso_visual_transiciones_select
  ON public.expediente_paso_visual_transiciones
  FOR SELECT
  TO authenticated
  USING (public.can_see_expediente(expediente_id));

REVOKE ALL ON TABLE public.expediente_paso_visual_transiciones FROM PUBLIC;
REVOKE ALL ON TABLE public.expediente_paso_visual_transiciones FROM anon;
REVOKE ALL ON TABLE public.expediente_paso_visual_transiciones FROM authenticated;
REVOKE ALL ON TABLE public.expediente_paso_visual_transiciones FROM service_role;
GRANT SELECT ON TABLE public.expediente_paso_visual_transiciones
  TO authenticated, service_role, postgres;

-- BEFORE: solo fecha canónica en la fila
CREATE OR REPLACE FUNCTION public.__tg_expediente_paso_visual_fecha()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paso_old SMALLINT;
  v_paso_new SMALLINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.fecha_entrada_paso_visual_actual := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.etapa_actual IS NOT DISTINCT FROM OLD.etapa_actual THEN
    NEW.fecha_entrada_paso_visual_actual := OLD.fecha_entrada_paso_visual_actual;
    RETURN NEW;
  END IF;

  v_paso_old := public.__map_etapa_interna_a_paso_visual(OLD.etapa_actual);
  v_paso_new := public.__map_etapa_interna_a_paso_visual(NEW.etapa_actual);

  IF v_paso_old IS NOT DISTINCT FROM v_paso_new THEN
    NEW.fecha_entrada_paso_visual_actual := OLD.fecha_entrada_paso_visual_actual;
    RETURN NEW;
  END IF;

  NEW.fecha_entrada_paso_visual_actual := clock_timestamp();
  RETURN NEW;
END;
$$;

-- AFTER: historial (FK ya existe)
CREATE OR REPLACE FUNCTION public.__tg_expediente_paso_visual_historial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paso_old SMALLINT;
  v_paso_new SMALLINT;
  v_actor UUID;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    v_paso_new := public.__map_etapa_interna_a_paso_visual(NEW.etapa_actual);
    INSERT INTO public.expediente_paso_visual_transiciones (
      expediente_id, etapa_anterior, etapa_nueva,
      paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
    ) VALUES (
      NEW.id, NULL, NEW.etapa_actual,
      NULL, v_paso_new, NEW.fecha_entrada_paso_visual_actual, v_actor
    );
    RETURN NEW;
  END IF;

  IF NEW.etapa_actual IS NOT DISTINCT FROM OLD.etapa_actual THEN
    RETURN NEW;
  END IF;

  v_paso_old := public.__map_etapa_interna_a_paso_visual(OLD.etapa_actual);
  v_paso_new := public.__map_etapa_interna_a_paso_visual(NEW.etapa_actual);
  IF v_paso_old IS NOT DISTINCT FROM v_paso_new THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.expediente_paso_visual_transiciones (
    expediente_id, etapa_anterior, etapa_nueva,
    paso_visual_anterior, paso_visual_nuevo, fecha_entrada, actor_user_id
  ) VALUES (
    NEW.id, OLD.etapa_actual, NEW.etapa_actual,
    v_paso_old, v_paso_new, NEW.fecha_entrada_paso_visual_actual, v_actor
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expedientes_paso_visual_tracking ON public.expedientes;
DROP TRIGGER IF EXISTS expedientes_paso_visual_tracking_bi ON public.expedientes;
DROP TRIGGER IF EXISTS expedientes_paso_visual_tracking_bu ON public.expedientes;
DROP TRIGGER IF EXISTS expedientes_paso_visual_tracking_bu_fecha ON public.expedientes;
DROP TRIGGER IF EXISTS expedientes_paso_visual_fecha ON public.expedientes;
DROP TRIGGER IF EXISTS expedientes_paso_visual_historial ON public.expedientes;
DROP FUNCTION IF EXISTS public.__tg_expediente_paso_visual_tracking();

CREATE TRIGGER expedientes_paso_visual_fecha
  BEFORE INSERT OR UPDATE ON public.expedientes
  FOR EACH ROW
  EXECUTE FUNCTION public.__tg_expediente_paso_visual_fecha();

CREATE TRIGGER expedientes_paso_visual_historial
  AFTER INSERT OR UPDATE ON public.expedientes
  FOR EACH ROW
  EXECUTE FUNCTION public.__tg_expediente_paso_visual_historial();

COMMENT ON FUNCTION public.__tg_expediente_paso_visual_fecha() IS
  'P114: asigna/conserva fecha_entrada_paso_visual_actual. Ignora 3→4 y mutaciones directas.';
COMMENT ON FUNCTION public.__tg_expediente_paso_visual_historial() IS
  'P114: append-only de creación y cruces de paso visual (no 3→4).';
