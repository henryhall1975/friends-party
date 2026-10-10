-- Aviso por notificación cuando alguien te empieza a seguir (aplicado el 2026-10-10 como migración aviso_nuevo_seguidor).
-- La función que lo manda está en supabase/functions/send-follow-push.
-- Para que dejar de seguir y volver a seguir no llene de avisos, se manda como mucho uno por pareja cada 24 horas.

create table if not exists public.follow_notified (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (follower_id, followee_id)
);
alter table public.follow_notified enable row level security;

create or replace function public.notify_new_follower()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://tjsrwipyhrqsvqodrnta.supabase.co/functions/v1/send-follow-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
    ),
    body := jsonb_build_object('follower_id', new.follower_id, 'followee_id', new.followee_id),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new;
end; $$;
revoke all on function public.notify_new_follower() from public, anon, authenticated;

drop trigger if exists follows_push on public.follows;
create trigger follows_push after insert on public.follows
  for each row execute function public.notify_new_follower();

create or replace function public.follow_push_targets(fid uuid, tid uuid)
returns table (token text, quien text, usuario text)
language sql security definer set search_path = '' as $$
  with ok as (
    insert into public.follow_notified (follower_id, followee_id)
    select f.follower_id, f.followee_id from public.follows f
    where f.follower_id = fid and f.followee_id = tid and f.created_at > now() - interval '5 minutes'
      and not exists (select 1 from public.blocks b where b.blocker_id = tid and b.blocked_id = fid)
    on conflict (follower_id, followee_id) do update set sent_at = now()
      where public.follow_notified.sent_at < now() - interval '24 hours'
    returning follower_id, followee_id
  )
  select dt.token, coalesce(p.display_name, p.username, 'Alguien'), coalesce(p.username, '')
  from ok
  join public.device_tokens dt on dt.user_id = ok.followee_id
  left join public.profiles p on p.id = ok.follower_id;
$$;
revoke all on function public.follow_push_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.follow_push_targets(uuid, uuid) to service_role;
