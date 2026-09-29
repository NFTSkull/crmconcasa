-- Anette: conservar contacto/domicilio y mantener sincronizados los datos frescos de Infonavit.
-- Alcance deliberadamente quirúrgico: solo expedientes cuyo dueño es anette.perez@concasa.mx.

create or replace function public.anette_preservar_contacto_expediente()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_es_anette boolean;
  v_old_tel text;
  v_new_tel text;
  v_old_casa text;
  v_new_casa text;
begin
  select exists (
    select 1
    from public.profiles p
    where p.id = new.asesor_id
      and p.active = true
      and lower(btrim(p.email)) = 'anette.perez@concasa.mx'
  )
  into v_es_anette;

  if not v_es_anette then
    return new;
  end if;

  if nullif(btrim(coalesce(old.direccion_opcional, '')), '') is not null
     and nullif(btrim(coalesce(new.direccion_opcional, '')), '') is null then
    new.direccion_opcional := old.direccion_opcional;
  end if;

  v_old_tel := regexp_replace(coalesce(old.telefono_cliente::text, ''), '\D', '', 'g');
  v_new_tel := regexp_replace(coalesce(new.telefono_cliente::text, ''), '\D', '', 'g');
  if v_old_tel ~ '^[0-9]{10}$'
     and v_old_tel <> '0000000000'
     and (v_new_tel !~ '^[0-9]{10}$' or v_new_tel = '0000000000') then
    new.telefono_cliente := old.telefono_cliente;
  end if;

  v_old_casa := regexp_replace(coalesce(old.telefono_casa, ''), '\D', '', 'g');
  v_new_casa := regexp_replace(coalesce(new.telefono_casa, ''), '\D', '', 'g');
  if v_old_casa ~ '^[0-9]{10}$'
     and v_old_casa <> '0000000000'
     and (v_new_casa !~ '^[0-9]{10}$' or v_new_casa = '0000000000') then
    new.telefono_casa := old.telefono_casa;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_anette_preservar_contacto_expediente on public.expedientes;
create trigger trg_anette_preservar_contacto_expediente
before update of direccion_opcional, telefono_cliente, telefono_casa
on public.expedientes
for each row
execute function public.anette_preservar_contacto_expediente();

create or replace function public.anette_sync_telefono_cliente_desde_datos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text;
begin
  v_tel := public.normalize_telefono_mexico(new.telefono_normalizado);

  if v_tel is null
     or v_tel !~ '^[0-9]{10}$'
     or v_tel = '0000000000' then
    return new;
  end if;

  update public.expedientes e
  set telefono_cliente = v_tel,
      updated_at = greatest(e.updated_at, new.updated_at)
  where e.id = new.expediente_id
    and e.deleted_at is null
    and exists (
      select 1
      from public.profiles p
      where p.id = e.asesor_id
        and p.active = true
        and lower(btrim(p.email)) = 'anette.perez@concasa.mx'
    )
    and regexp_replace(coalesce(e.telefono_cliente::text, ''), '\D', '', 'g')
        is distinct from v_tel;

  return new;
end;
$$;

drop trigger if exists trg_anette_sync_telefono_cliente_desde_datos on public.cliente_datos;
create trigger trg_anette_sync_telefono_cliente_desde_datos
after insert or update of telefono_normalizado
on public.cliente_datos
for each row
execute function public.anette_sync_telefono_cliente_desde_datos();

create or replace function public.anette_sync_infonavit_desde_editor_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := '{}'::jsonb;
  v_changed boolean := false;
  v_org uuid;
  v_actor uuid;
begin
  if not exists (
    select 1
    from public.expedientes e
    join public.profiles p on p.id = e.asesor_id
    where e.id = new.expediente_id
      and e.deleted_at is null
      and p.active = true
      and lower(btrim(p.email)) = 'anette.perez@concasa.mx'
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.rfc_infonavit is not distinct from new.rfc_infonavit
     and old.registro_patronal_infonavit is not distinct from new.registro_patronal_infonavit
     and old.empresa_infonavit is not distinct from new.empresa_infonavit then
    return new;
  end if;

  if nullif(btrim(coalesce(new.rfc_infonavit, '')), '') is not null then
    v_patch := v_patch || jsonb_build_object('rfc', upper(btrim(new.rfc_infonavit)));
  end if;
  if nullif(btrim(coalesce(new.registro_patronal_infonavit, '')), '') is not null then
    v_patch := v_patch || jsonb_build_object('registroPatronal', btrim(new.registro_patronal_infonavit));
  end if;
  if nullif(btrim(coalesce(new.empresa_infonavit, '')), '') is not null then
    v_patch := v_patch || jsonb_build_object('empresa', btrim(new.empresa_infonavit));
  end if;

  if v_patch = '{}'::jsonb then
    return new;
  end if;

  update public.cliente_datos cd
  set datos = coalesce(cd.datos, '{}'::jsonb) || v_patch,
      estado = case when cd.estado = 'validado' then 'completo'::public.cliente_datos_estado else cd.estado end,
      validated_at = case when cd.estado = 'validado' then null else cd.validated_at end,
      validated_by = case when cd.estado = 'validado' then null else cd.validated_by end,
      updated_by = coalesce(new.decided_by, cd.updated_by),
      updated_at = now()
  where cd.expediente_id = new.expediente_id
    and not (coalesce(cd.datos, '{}'::jsonb) @> v_patch)
  returning true into v_changed;

  if v_changed then
    select e.organization_id into v_org
    from public.expedientes e
    where e.id = new.expediente_id;

    v_actor := new.decided_by;
    if v_actor is not null then
      perform public.log_action(
        v_org,
        v_actor,
        'editor'::public.app_role,
        'cliente_datos.infonavit_sync_reprecal',
        'cliente_datos',
        new.expediente_id,
        jsonb_build_object(
          'expediente_id', new.expediente_id,
          'rfc_actualizado', v_patch ? 'rfc',
          'registro_patronal_actualizado', v_patch ? 'registroPatronal',
          'empresa_actualizada', v_patch ? 'empresa',
          'fuente', 'editor_decisions_infonavit'
        )
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_anette_sync_infonavit_desde_editor_decision on public.editor_decisions;
create trigger trg_anette_sync_infonavit_desde_editor_decision
after insert or update of rfc_infonavit, registro_patronal_infonavit, empresa_infonavit
on public.editor_decisions
for each row
execute function public.anette_sync_infonavit_desde_editor_decision();

comment on function public.anette_preservar_contacto_expediente() is
  'Anette: evita que payloads vacíos/placeholder borren domicilio, celular o teléfono de casa ya capturados.';
comment on function public.anette_sync_telefono_cliente_desde_datos() is
  'Anette: sincroniza cliente_datos.telefono_normalizado hacia expedientes.telefono_cliente.';
comment on function public.anette_sync_infonavit_desde_editor_decision() is
  'Anette: una nueva precalificación Infonavit refresca RFC/registro patronal/empresa en cliente_datos sin tocar otros campos.';
