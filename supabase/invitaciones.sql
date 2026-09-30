-- Invitaciones directas entre usuarios (bandeja de invitaciones recibidas).
-- Pegar completo en Supabase > SQL Editor y ejecutar una sola vez.

create table if not exists public.user_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user uuid not null default auth.uid() references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (group_id, to_user)
);

alter table public.user_invites enable row level security;

create policy "invitaciones_usuario: crear" on public.user_invites
  for insert with check (from_user = auth.uid() and is_group_member(group_id) and to_user <> auth.uid());
create policy "invitaciones_usuario: ver las mias" on public.user_invites
  for select using (from_user = auth.uid() or to_user = auth.uid());

-- Aceptar: agrega a quien recibe al grupo (la función corre con permisos propios y solo actúa sobre el usuario que la llama)
create or replace function public.accept_user_invite(inv uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  select group_id into gid from public.user_invites where id = inv and to_user = auth.uid() and status = 'pending';
  if gid is null then raise exception 'Invitacion no valida'; end if;
  insert into public.group_members(group_id, user_id, role) values (gid, auth.uid(), 'miembro') on conflict do nothing;
  update public.user_invites set status = 'accepted' where id = inv;
  return gid;
end; $$;

create or replace function public.decline_user_invite(inv uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.user_invites set status = 'declined' where id = inv and to_user = auth.uid() and status = 'pending';
end; $$;

grant execute on function public.accept_user_invite(uuid) to authenticated;
grant execute on function public.decline_user_invite(uuid) to authenticated;
