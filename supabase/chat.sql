-- Avisos de chat por notificación (aplicado el 2026-10-10 como migración avisos_de_chat).
-- La función que los manda está en supabase/functions/send-chat-push.

alter table public.messages add column if not exists notified boolean not null default false;

create or replace function public.notify_chat_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://tjsrwipyhrqsvqodrnta.supabase.co/functions/v1/send-chat-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
    ),
    body := jsonb_build_object('id', new.id),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new;  -- un fallo al avisar nunca debe impedir que el mensaje se guarde
end; $$;
revoke all on function public.notify_chat_message() from public, anon, authenticated;

drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages
  for each row execute function public.notify_chat_message();

-- A quién avisar: los demás miembros del grupo (o del grupo del evento) con teléfono registrado,
-- salvo quien tenga bloqueado al autor. Marca el mensaje como avisado para no repetir.
create or replace function public.chat_push_targets(mid uuid)
returns table (token text, autor text, titulo text, cuerpo text)
language sql security definer set search_path = '' as $$
  with m as (
    update public.messages set notified = true
    where id = mid and notified = false and created_at > now() - interval '5 minutes'
    returning id, author_id, body, group_id, event_id
  ), ctx as (
    select m.author_id, coalesce(m.body, '') as body,
           coalesce(m.group_id, e.group_id) as gid, e.title
    from m left join public.events e on e.id = m.event_id
  )
  select dt.token,
         coalesce(p.display_name, p.username, 'Alguien'),
         coalesce(ctx.title, 'Friends Party'),
         ctx.body
  from ctx
  join public.group_members gm on gm.group_id = ctx.gid and gm.user_id <> ctx.author_id
  join public.device_tokens dt on dt.user_id = gm.user_id
  left join public.profiles p on p.id = ctx.author_id
  where not exists (select 1 from public.blocks b where b.blocker_id = gm.user_id and b.blocked_id = ctx.author_id);
$$;
revoke all on function public.chat_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.chat_push_targets(uuid) to service_role;
