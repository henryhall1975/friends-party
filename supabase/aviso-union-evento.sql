-- Aviso por notificación a los que ya están en un evento o momento cuando alguien nuevo entra
-- (aceptando la invitación por usuario o con el QR/código del evento). Aplicado el 2026-10-18.
-- Usa la misma función que el aviso de grupos: supabase/functions/send-join-push (con event_id en vez de group_id).

create or replace function public.notify_event_join()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- el dueño entrando a su propio evento recién creado no es una "unión"
  if exists (select 1 from public.events e where e.id = new.event_id and e.owner_id = new.user_id) then
    return new;
  end if;
  perform net.http_post(
    url := 'https://tjsrwipyhrqsvqodrnta.supabase.co/functions/v1/send-join-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
    ),
    body := jsonb_build_object('event_id', new.event_id, 'user_id', new.user_id),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new;  -- un fallo al avisar nunca debe impedir la unión
end; $$;
revoke all on function public.notify_event_join() from public, anon, authenticated;

drop trigger if exists event_members_push on public.event_members;
create trigger event_members_push after insert on public.event_members
  for each row execute function public.notify_event_join();

-- A quién avisar: los demás del evento con teléfono registrado (no quien entró, ni quien lo bloqueó).
-- Solo vale para uniones de los últimos 5 minutos.
create or replace function public.event_join_push_targets(eid uuid, uid uuid)
returns table (token text, quien text, titulo text, tipo text)
language sql stable security definer set search_path = '' as $$
  select dt.token,
         coalesce(p.display_name, p.username, 'Alguien'),
         e.title,
         e.kind
  from public.event_members nuevo
  join public.events e on e.id = nuevo.event_id
  join public.event_members em on em.event_id = nuevo.event_id and em.user_id <> nuevo.user_id
  join public.device_tokens dt on dt.user_id = em.user_id
  left join public.profiles p on p.id = nuevo.user_id
  where nuevo.event_id = eid and nuevo.user_id = uid
    and nuevo.joined_at > now() - interval '5 minutes'
    and not exists (select 1 from public.blocks b where b.blocker_id = em.user_id and b.blocked_id = nuevo.user_id);
$$;
revoke all on function public.event_join_push_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.event_join_push_targets(uuid, uuid) to service_role;
