-- Invitar a UN evento (no a todo el grupo): quien entra con el código del evento queda en event_members
-- y desde ahí puede ver ese evento, sus fotos, chat, canciones e historias.
create or replace function public.is_event_invitee(eid uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.event_members where event_id = eid and user_id = auth.uid());
$$;

create policy "eventos: ver si me invitaron al evento" on public.events
  for select to authenticated using (public.is_event_invitee(id));

drop policy if exists "clips: ver los de mi grupo" on public.event_clips;
create policy "clips: ver los de mis eventos" on public.event_clips
  for select using (((expires_at is null) or (expires_at > now())) and public.is_event_member(event_id));

drop policy if exists "clips: subir" on public.event_clips;
create policy "clips: subir" on public.event_clips
  for insert with check ((author_id = auth.uid()) and public.is_event_member(event_id));

-- al unirse con el código del evento, entra como "va"
create or replace function public.join_event_by_code(code text)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  eid uuid;
begin
  select id into eid from public.events where invite_code = code;
  if eid is null then
    raise exception 'Codigo de evento invalido';
  end if;
  insert into public.event_members(event_id, user_id, rsvp)
  values (eid, auth.uid(), 'va')
  on conflict do nothing;
  return eid;
end;
$$;
