-- ConCasa CRM — blindaje de capacidad diaria Biométricos Monterrey = 15.
-- No mueve/cancela citas existentes. Solo corrige y protege la regla base.

INSERT INTO public.agenda_daily_capacity_rules (kind, location_id, capacity, updated_at)
VALUES ('biometricos', 'monterrey', 15, now())
ON CONFLICT (kind, location_id)
DO UPDATE SET capacity = 15, updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agenda_daily_capacity_rules_bio_mty_max_15'
      AND conrelid = 'public.agenda_daily_capacity_rules'::regclass
  ) THEN
    ALTER TABLE public.agenda_daily_capacity_rules
      ADD CONSTRAINT agenda_daily_capacity_rules_bio_mty_max_15
      CHECK (
        NOT (kind = 'biometricos' AND location_id = 'monterrey')
        OR capacity <= 15
      );
  END IF;
END
$$;

COMMENT ON CONSTRAINT agenda_daily_capacity_rules_bio_mty_max_15
  ON public.agenda_daily_capacity_rules IS
  'Biométricos Monterrey: la regla base no puede superar 15 personas por día. Citas existentes sobre el tope no se modifican.';
