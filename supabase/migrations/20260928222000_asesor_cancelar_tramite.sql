-- ConCasa — asesor cancela trámite desde su propio expediente.
-- Terminal: ciclo_estado=cancelado. Conserva historial, documentos y agenda.
-- Seguridad: solo asesor autenticado que puede operar el expediente; EXECUTE solo authenticated.

create or replace function public.asesor_cancelar_tramite(
  p_expediente_id uuid,
  p_motivo text,
  p_comentario text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid;
  v_actor_role public.app_role;
  v_actor_org uuid;
  v_exp record;
  v_cancelacion_id uuid;
  v_motivo text;
  v_comentario text;
  v_bookings_before integer;
  v_bookings_after integer;
begin
  v_actor_id := public.current_profile_id();
  if v_actor_id is null then
    raise exception 'ASESOR_CANCEL_EXP_UNAUTHORIZED: usuario no autenticado'
      using errcode = '42501';
  end if;

  select p.app_role, p.organization_id
  into v_actor_role, v_actor_org
  from public.profiles p
  where p.id = v_actor_id
    and p.active = true;

  if not found or v_actor_role <> 'asesor' then
    raise exception 'ASESOR_CANCEL_EXP_UNAUTHORIZED: rol no autorizado'
      using errcode = '42501';
  end if;

  if p_expediente_id is null then
    raise exception 'ASESOR_CANCEL_EXP_NOT_FOUND: expediente_id es obligatorio'
      using errcode = '22023';
  end if;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  v_comentario := nullif(btrim(coalesce(p_comentario, '')), '');

  if v_motivo is null then
    raise exception 'ASESOR_CANCEL_EXP_REASON_REQUIRED: motivo es obligatorio'
      using errcode = '22023';
  end if;

  if char_length(v_motivo) > 500 then
    raise exception 'ASESOR_CANCEL_EXP_REASON_TOO_LONG: motivo no puede exceder 500 caracteres'
      using errcode = '22023';
  end if;

  if v_comentario is not null and char_length(v_comentario) > 2000 then
    raise exception 'ASESOR_CANCEL_EXP_COMMENT_TOO_LONG: comentario no puede exceder 2000 caracteres'
      using errcode = '22023';
  end if;

  select
    e.id,
    e.organization_id,
    e.asesor_id,
    e.etapa_actual,
    e.subestado,
    e.submitted_to_mesa,
    e.ciclo_estado,
    e.deleted_at
  into v_exp
  from public.expedientes e
  where e.id = p_expediente_id
  for update;

  if not found or v_exp.deleted_at is not null then
    raise exception 'ASESOR_CANCEL_EXP_NOT_FOUND: expediente no disponible'
      using errcode = 'P0002';
  end if;

  if v_exp.organization_id is distinct from v_actor_org
     or v_exp.asesor_id is distinct from v_actor_id then
    raise exception 'ASESOR_CANCEL_EXP_UNAUTHORIZED: expediente no pertenece al asesor'
      using errcode = '42501';
  end if;

  if v_exp.ciclo_estado = 'cancelado' then
    raise exception 'ASESOR_CANCEL_EXP_ALREADY_CANCELLED: expediente ya cancelado'
      using errcode = '22023';
  end if;

  if v_exp.ciclo_estado <> 'activo' then
    raise exception 'ASESOR_CANCEL_EXP_CYCLE_NOT_ACTIVE: ciclo no activo (%)', v_exp.ciclo_estado
      using errcode = '22023';
  end if;

  select count(*)::integer into v_bookings_before
  from public.agenda_bookings b
  where b.expediente_id = p_expediente_id;

  insert into public.expediente_cancelaciones (
    organization_id,
    expediente_id,
    etapa,
    subestado_anterior,
    motivo,
    comentario,
    decidido_por,
    decidido_por_rol
  ) values (
    v_exp.organization_id,
    p_expediente_id,
    v_exp.etapa_actual,
    v_exp.subestado,
    v_motivo,
    v_comentario,
    v_actor_id,
    v_actor_role
  )
  returning id into v_cancelacion_id;

  update public.expedientes
  set
    ciclo_estado = 'cancelado',
    updated_at = now()
  where id = p_expediente_id;

  select count(*)::integer into v_bookings_after
  from public.agenda_bookings b
  where b.expediente_id = p_expediente_id;

  if v_bookings_after is distinct from v_bookings_before then
    raise exception 'ASESOR_CANCEL_EXP_BOOKING_MUTATION: la cancelación no debe mutar agenda'
      using errcode = 'P0001';
  end if;

  perform public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'expediente.cancelacion_asesor',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'cancelacion_id', v_cancelacion_id,
      'etapa', v_exp.etapa_actual,
      'subestado', v_exp.subestado,
      'submitted_to_mesa', v_exp.submitted_to_mesa,
      'ciclo_estado_anterior', 'activo',
      'ciclo_estado', 'cancelado',
      'motivo', v_motivo,
      'comentario', v_comentario,
      'sin_efectos_agenda', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'cancelacion_id', v_cancelacion_id,
    'ciclo_estado', 'cancelado',
    'subestado', v_exp.subestado,
    'etapa', v_exp.etapa_actual
  );
end;
$function$;

revoke all on function public.asesor_cancelar_tramite(uuid,text,text) from public;
revoke all on function public.asesor_cancelar_tramite(uuid,text,text) from anon;
grant execute on function public.asesor_cancelar_tramite(uuid,text,text) to authenticated;

comment on function public.asesor_cancelar_tramite(uuid,text,text) is
  'Asesor cancela terminalmente un expediente propio. Conserva historial y agenda; ciclo_estado pasa a cancelado.';
