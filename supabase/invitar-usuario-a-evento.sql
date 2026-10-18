-- "Invitar por usuario" dentro de un evento o momento: la invitación es a ESE evento, no al grupo de quien invita.
-- Antes, user_invites solo sabía de grupos; por eso @creppy terminó en el grupo de Henry y no en "Cumple nao".

alter table public.user_invites add column if not exists event_id uuid references public.events(id) on delete cascade;
alter table public.user_invites alter column group_id drop not null;
alter table public.user_invites drop constraint if exists user_invites_destino;
alter table public.user_invites add constraint user_invites_destino check (group_id is not null or event_id is not null);
create unique index if not exists user_invites_event_id_to_user_key on public.user_invites (event_id, to_user) where event_id is not null;

-- invita a un evento quien ya está en él (dueño o invitado); a un grupo, quien es miembro del grupo
drop policy if exists "invitaciones_usuario: crear" on public.user_invites;
create policy "invitaciones_usuario: crear" on public.user_invites
  for insert with check (
    from_user = auth.uid() and to_user <> auth.uid() and (
      (event_id is null and public.is_group_member(group_id)) or
      (event_id is not null and public.is_event_member(event_id))
    )
  );

-- aceptar: si es de evento, entra al evento como "va" (igual que con el QR); si es de grupo, al grupo
create or replace function public.accept_user_invite(inv uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare gid uuid; eid uuid;
begin
  select group_id, event_id into gid, eid from public.user_invites where id = inv and to_user = auth.uid() and status = 'pending';
  if not found then raise exception 'Invitacion no valida'; end if;
  if eid is not null then
    insert into public.event_members(event_id, user_id, rsvp) values (eid, auth.uid(), 'va') on conflict do nothing;
  else
    insert into public.group_members(group_id, user_id, role) values (gid, auth.uid(), 'miembro') on conflict do nothing;
  end if;
  update public.user_invites set status = 'accepted' where id = inv;
  return coalesce(eid, gid);
end; $$;

-- mis invitaciones pendientes, con el nombre del evento (quien aún no entra al evento no puede leerlo directamente)
create or replace function public.my_pending_invites()
returns table (id uuid, from_user uuid, created_at timestamptz, event_id uuid, event_title text, event_kind text)
language sql stable security definer set search_path to '' as $$
  select i.id, i.from_user, i.created_at, i.event_id, e.title, e.kind
  from public.user_invites i left join public.events e on e.id = i.event_id
  where i.to_user = auth.uid() and i.status = 'pending'
  order by i.created_at desc;
$$;
grant execute on function public.my_pending_invites() to authenticated;
