-- Limpieza de archivos: historias en video vencidas y archivos que ya no pertenecen a ninguna foto o historia.
-- La hace la Edge Function "cleanup-storage" (supabase/functions/cleanup-storage); aquí va lo que necesita de la base.
-- Ya está aplicado en el servidor (2026-10-08). Se guarda aquí como referencia.

-- 1) Clave que deben presentar quienes llaman a la función (la tarea diaria). Vive en Vault, nunca en el código.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cleanup_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'cleanup_secret',
      'Clave para llamar a la Edge Function cleanup-storage'
    );
  end if;
end $$;

create or replace function public.check_cleanup_secret(s text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cleanup_secret' and decrypted_secret = s);
$$;
revoke all on function public.check_cleanup_secret(text) from public, anon, authenticated;
grant execute on function public.check_cleanup_secret(text) to service_role;

-- 2) Qué archivos toca borrar:
--    a) historias en video cuya fecha de vencimiento ya pasó (las de Premium no tienen fecha y no entran)
--    b) archivos de fotos y videos con más de 24 horas que ya no pertenecen a ninguna foto, mensaje ni historia
--       (lo que queda cuando alguien elimina su cuenta o un evento)
create or replace function public.cleanup_candidates()
returns table (kind text, bucket text, path text, clip_id uuid)
language sql stable security definer set search_path = '' as $$
  select 'historia_vencida', 'clips', c.storage_path, c.id
    from public.event_clips c where c.expires_at < now()
  union all
  select 'historia_vencida', 'clips', c.thumb_path, c.id
    from public.event_clips c where c.expires_at < now() and c.thumb_path is not null
  union all
  select 'sin_dueno', o.bucket_id, o.name, null::uuid
    from storage.objects o
   where o.bucket_id in ('photos', 'clips')
     and o.created_at < now() - interval '24 hours'
     and not exists (select 1 from public.photos p where p.storage_path = o.name)
     and not exists (select 1 from public.messages m where m.photo_storage_path = o.name)
     and not exists (select 1 from public.event_clips c where c.storage_path = o.name or c.thumb_path = o.name)
  limit 2000;
$$;
revoke all on function public.cleanup_candidates() from public, anon, authenticated;
grant execute on function public.cleanup_candidates() to service_role;

-- 3) Tarea diaria: llama a la Edge Function con la clave guardada en Vault.
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'limpieza-storage-diaria';

select cron.schedule(
  'limpieza-storage-diaria',
  '0 9 * * *',  -- todos los días a las 09:00 UTC (3:00 a. m. en Guatemala)
  $job$
  select net.http_post(
    url := 'https://tjsrwipyhrqsvqodrnta.supabase.co/functions/v1/cleanup-storage',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- Para ver si corrió:  select * from cron.job_run_details order by start_time desc limit 5;

-- 2026-10-08 · Eventos públicos para seguidores (aplicado como migración eventos_publicos_para_seguidores)
-- alter table public.events add column if not exists is_public boolean not null default false;
-- create policy "eventos: ver publicos de quien sigo" on public.events for select to authenticated
--   using (is_public and exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = events.owner_id));
-- create index if not exists events_owner_public_idx on public.events (owner_id) where is_public;
