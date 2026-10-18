-- Los eventos (públicos o privados) ya no los ven tus seguidores: solo quien está invitado (o en tu grupo).
-- Solo los momentos pueden ser públicos para tus seguidores. Pedido por Henry el 2026-10-18.

drop policy if exists "eventos: ver publicos de quien sigo" on public.events;
create policy "eventos: ver publicos de quien sigo" on public.events
  for select using (
    kind = 'momento' and is_public and exists (
      select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = events.owner_id
    )
  );

create or replace function public.is_event_viewer(eid uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select public.is_event_member(eid)
      or exists (select 1 from public.events e join public.follows f on f.followee_id = e.owner_id and f.follower_id = auth.uid()
                 where e.id = eid and e.kind = 'momento' and e.is_public);
$$;

-- los eventos que estaban marcados como públicos quedan privados
update public.events set is_public = false where kind = 'evento' and is_public;
