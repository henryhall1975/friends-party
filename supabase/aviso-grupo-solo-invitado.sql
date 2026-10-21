-- Avisos al entrar a un grupo (cambio pedido por Henry el 2026-10-21): ya no se avisa a TODOS los del grupo.
--  * Si el dueño mete a alguien (botón Agregar): el aviso le llega solo a esa persona ("Henry te agregó al grupo Familia").
--  * Si alguien entra solo (QR, código o aceptando invitación): el aviso le llega solo al dueño del grupo.
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
    -- quién hizo la unión: el dueño (si agregó a alguien) o la misma persona (si entró sola)
    body := jsonb_build_object('group_id', new.group_id, 'user_id', new.user_id, 'adder', auth.uid()),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new;  -- un fallo al avisar nunca debe impedir la unión
end; $$;
revoke all on function public.notify_group_join() from public, anon, authenticated;

create or replace function public.group_join_push_targets(gid uuid, uid uuid, adder uuid)
returns table (token text, cuerpo text)
language sql stable security definer set search_path = '' as $$
  select dt.token,
         case when adder is not null and adder <> uid
           then coalesce(pa.display_name, pa.username, 'Alguien') || ' te agregó al grupo ' || coalesce(nullif(g.name, 'Mi grupo'), 'Amigos') || '. Ya ves sus eventos.'
           else coalesce(pu.display_name, pu.username, 'Alguien') || ' se unió a tu grupo ' || coalesce(nullif(g.name, 'Mi grupo'), 'Amigos') || '.'
         end
  from public.groups g
  join public.device_tokens dt on dt.user_id = (case when adder is not null and adder <> uid then uid else g.owner_id end)
  left join public.profiles pa on pa.id = adder
  left join public.profiles pu on pu.id = uid
  where g.id = gid
    and g.owner_id <> uid
    and exists (select 1 from public.group_members gm where gm.group_id = gid and gm.user_id = uid and gm.joined_at > now() - interval '5 minutes');
$$;
revoke all on function public.group_join_push_targets(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.group_join_push_targets(uuid, uuid, uuid) to service_role;
