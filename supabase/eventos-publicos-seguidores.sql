-- Los eventos vuelven a poder ser públicos (pedido por Henry el 2026-10-22): botones Público / Privado al crear o editar.
-- Un evento público lo ven tus seguidores en tu perfil (nombre, fecha y lugar). Sus fotos siguen siendo solo para
-- quienes asisten: is_event_viewer no cambia (solo los momentos públicos abren sus fotos a seguidores).
drop policy if exists "eventos: ver publicos de quien sigo" on public.events;
create policy "eventos: ver publicos de quien sigo" on public.events
  for select using (
    is_public and exists (
      select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = events.owner_id
    )
  );
