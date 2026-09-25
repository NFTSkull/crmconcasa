-- Scoped SAT pilot by expediente. Keeps global gate behavior unchanged.
insert into public.app_settings (key, value, updated_at)
values ('fiscal_sat_gate_pilot_expedientes', '[]'::jsonb, now())
on conflict (key) do nothing;

create or replace function public.fiscal_sat_gate_applies_to_expediente(p_expediente_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_asesor uuid;
  v_pilot_asesores jsonb;
  v_pilot_expedientes jsonb;
begin
  if public.app_setting_bool('fiscal_sat_gate_enabled', false) then
    return true;
  end if;

  select s.value into v_pilot_expedientes
  from public.app_settings s
  where s.key = 'fiscal_sat_gate_pilot_expedientes';

  if v_pilot_expedientes is not null
     and jsonb_typeof(v_pilot_expedientes) = 'array'
     and exists (
       select 1
       from jsonb_array_elements_text(v_pilot_expedientes) as x(val)
       where x.val = p_expediente_id::text
     ) then
    return true;
  end if;

  select e.asesor_id into v_asesor
  from public.expedientes e
  where e.id = p_expediente_id
    and e.deleted_at is null;

  if v_asesor is null then
    return false;
  end if;

  select s.value into v_pilot_asesores
  from public.app_settings s
  where s.key = 'fiscal_sat_gate_pilot_asesores';

  if v_pilot_asesores is null or jsonb_typeof(v_pilot_asesores) <> 'array' then
    return false;
  end if;

  return exists (
    select 1
    from jsonb_array_elements_text(v_pilot_asesores) as x(val)
    where x.val = v_asesor::text
  );
end;
$$;

revoke all on function public.fiscal_sat_gate_applies_to_expediente(uuid) from public;
grant execute on function public.fiscal_sat_gate_applies_to_expediente(uuid) to authenticated;
grant execute on function public.fiscal_sat_gate_applies_to_expediente(uuid) to service_role;
