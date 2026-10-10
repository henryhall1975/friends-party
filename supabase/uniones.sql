-- Aviso por notificación cuando alguien se une a un grupo (aplicado el 2026-10-10 como migración aviso_al_unirse_al_grupo).
-- La función que lo manda está en supabase/functions/send-join-push.

create or replace function public.notify_group_join()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- el dueño entrando a su propio grupo recién creado no es una "unión"
  if exists (select 1 from public.groups g where g.id = new.group_id and g.owner_id = new.user_id) then
    return new;
  end if;
  perform net.http_post(
    url := 'https://tjsrwipyhrqsvqodrnta.supabase.co/functions/v1/send-join-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
    ),
    body := jsonb_build_object('group_id', new.group_id, 'user_id', new.user_id),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new;  -- un fallo al avisar nunca debe impedir la unión
end; $$;
revoke all on function public.notify_group_join() from public, anon, authenticated;

drop trigger if exists group_members_push on public.group_members;
create trigger group_members_push after insert on public.group_members
  for each row execute function public.notify_group_join();

-- A quién avisar: los demás miembros del grupo con teléfono registrado. Solo vale para uniones de los últimos 5 minutos.
create or replace function public.join_push_targets(gid uuid, uid uuid)
returns table (token text, quien text, eventos bigint)
language sql stable security definer set search_path = '' as $$
  select dt.token,
         coalesce(p.display_name, p.username, 'Alguien'),
         (select count(*) from public.events e where e.group_id = gid)
  from public.group_members nuevo
  join public.group_members gm on gm.group_id = nuevo.group_id and gm.user_id <> nuevo.user_id
  join public.device_tokens dt on dt.user_id = gm.user_id
  left join public.profiles p on p.id = nuevo.user_id
  where nuevo.group_id = gid and nuevo.user_id = uid
    and nuevo.joined_at > now() - interval '5 minutes'
    and not exists (select 1 from public.blocks b where b.blocker_id = gm.user_id and b.blocked_id = nuevo.user_id);
$$;
revoke all on function public.join_push_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_push_targets(uuid, uuid) to service_role;
