-- Quién vio cada foto (el ojito) y a quién le gustó (el corazón).
-- Pegar completo en Supabase > SQL Editor (query nueva y vacía) y ejecutar una sola vez.
create table if not exists public.photo_reactions (
  photo_id uuid not null references public.photos(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('view', 'like')),
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id, kind)
);
alter table public.photo_reactions enable row level security;

-- las ve quien puede ver la foto
drop policy if exists "reacciones: ver" on public.photo_reactions;
create policy "reacciones: ver" on public.photo_reactions for select using (
  exists (select 1 from public.photos p where p.id = photo_id and public.is_event_viewer(p.event_id))
);
drop policy if exists "reacciones: dar" on public.photo_reactions;
create policy "reacciones: dar" on public.photo_reactions for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.photos p where p.id = photo_id and public.is_event_viewer(p.event_id))
);
-- quitar mi me gusta
drop policy if exists "reacciones: quitar la mia" on public.photo_reactions;
create policy "reacciones: quitar la mia" on public.photo_reactions for delete using (user_id = auth.uid());
