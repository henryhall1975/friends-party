-- Historias en video, límite de fotos del plan gratis y plan Premium.
-- Pegar completo en Supabase > SQL Editor (query nueva y vacía) y ejecutar una sola vez.

-- 1) Quién es Premium. Nadie puede cambiarlo desde la app (solo lo escribe el servidor).
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  premium_until timestamptz not null
);
alter table public.subscriptions enable row level security;
drop policy if exists "premium: ver el mio" on public.subscriptions;
create policy "premium: ver el mio" on public.subscriptions for select using (user_id = auth.uid());

create or replace function public.is_premium(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select premium_until > now() from public.subscriptions where user_id = uid), false);
$$;

-- 2) Videos cortos de cada evento (dan la vuelta a los 7 días si la persona no es Premium)
create table if not exists public.event_clips (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null,
  thumb_path text,
  duration real,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
alter table public.event_clips enable row level security;

drop policy if exists "clips: ver los de mi grupo" on public.event_clips;
create policy "clips: ver los de mi grupo" on public.event_clips for select using (
  (expires_at is null or expires_at > now())
  and exists (select 1 from public.events e where e.id = event_id and public.is_group_member(e.group_id))
);
drop policy if exists "clips: subir" on public.event_clips;
create policy "clips: subir" on public.event_clips for insert with check (
  author_id = auth.uid()
  and exists (select 1 from public.events e where e.id = event_id and public.is_group_member(e.group_id))
);
drop policy if exists "clips: borrar los mios" on public.event_clips;
create policy "clips: borrar los mios" on public.event_clips for delete using (author_id = auth.uid());

create or replace function public.set_clip_expiry() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.expires_at := case when public.is_premium(new.author_id) then null else now() + interval '7 days' end;
  return new;
end; $$;
drop trigger if exists event_clips_expiry on public.event_clips;
create trigger event_clips_expiry before insert on public.event_clips
  for each row execute function public.set_clip_expiry();

-- 3) Espacio de almacenamiento privado para los videos (máx. 50 MB cada uno)
insert into storage.buckets (id, name, public, file_size_limit)
values ('clips', 'clips', false, 52428800)
on conflict (id) do nothing;
drop policy if exists "clips: leer archivos" on storage.objects;
create policy "clips: leer archivos" on storage.objects for select to authenticated using (bucket_id = 'clips');
drop policy if exists "clips: subir archivos" on storage.objects;
create policy "clips: subir archivos" on storage.objects for insert to authenticated with check (bucket_id = 'clips');
drop policy if exists "clips: borrar mis archivos" on storage.objects;
create policy "clips: borrar mis archivos" on storage.objects for delete to authenticated using (bucket_id = 'clips' and owner_id = auth.uid()::text);

-- 4) Plan gratis: máximo 10 fotos por persona en cada evento
create or replace function public.limit_free_photos() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_premium(new.author_id)
     and (select count(*) from public.photos where event_id = new.event_id and author_id = new.author_id) >= 10 then
    raise exception 'limite_fotos';
  end if;
  return new;
end; $$;
drop trigger if exists photos_free_limit on public.photos;
create trigger photos_free_limit before insert on public.photos
  for each row execute function public.limit_free_photos();
