BEGIN;

ALTER TABLE public.profile_capabilities
  DROP CONSTRAINT IF EXISTS profile_capabilities_capability_check;

ALTER TABLE public.profile_capabilities
  ADD CONSTRAINT profile_capabilities_capability_check
  CHECK (
    capability = ANY (
      ARRAY[
        'team_dashboard_read'::text,
        'create_for_any_advisor'::text,
        'integrate_for_any_advisor'::text,
        'ver_externos_mesa'::text,
        'autofill_nombre_infonavit'::text,
        'auto_precal_retry_priority'::text,
        'precalificador_nss_only'::text
      ]
    )
  );

COMMIT;
