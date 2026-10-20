INSERT INTO public.agenda_blocked_dates(organization_id,blocked_date,reason,active)
VALUES ('50beae49-3961-4163-8e78-2251693f2c19'::uuid,'2026-11-02'::date,
 'Día de Muertos — 2 de noviembre excluido por instrucción operativa; no agendar en ninguna sede ni modalidad.',true)
ON CONFLICT (organization_id,blocked_date)
DO UPDATE SET reason=EXCLUDED.reason, active=true,updated_at=now();
