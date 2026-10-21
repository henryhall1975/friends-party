-- Aviso a todo el grupo cuando alguien crea un evento (por ejemplo, la clase de zumba de la semana),
-- y eventos que se repiten cada semana (series). Aplicado el 2026-10-20.
-- La función que manda el aviso está en supabase/functions/send-new-event-push.

-- una serie = varios eventos creados juntos que se repiten cada semana (mismo series_id);
-- series_days es el texto para el aviso, por ejemplo "martes y jueves"
alter table public.events add column if not exists series_id uuid;
alter table public.events add column if not exists series_days text;
create index if not exists events_series_id on public.events (series_id) where series_id is not null;

create or replace function public.notify_new_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind <> 'evento' then return new; end if;
  -- de una serie se avisa una sola vez (con la primera clase), no por cada fecha
  if new.series_id is not null and exists (
    select 1 from public.events e where e.series_id = new.series_id and e.id <> new.id and e.created_at <= new.created_at
  ) then
    return new;
  end if;
  perform net.http_post(
    url := 'https://tjsrwipyhrqsvqodrnta.supabase.co/functions/v1/send-new-event-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
    ),
    body := jsonb_build_object('event_id', new.id),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new;  -- un fallo al avisar nunca debe impedir crear el evento
end; $$;
revoke all on function public.notify_new_event() from public, anon, authenticated;

drop trigger if exists events_new_push on public.events;
create trigger events_new_push after insert on public.events
  for each row execute function public.notify_new_event();

-- A quién avisar: los del grupo del evento (menos quien lo creó y quien lo bloqueó) con teléfono registrado.
-- Solo para eventos creados en los últimos 5 minutos.
create or replace function public.new_event_push_targets(eid uuid)
returns table (token text, quien text, titulo text, cuando text, lugar text, dias text)
language sql stable security definer set search_path = '' as $$
  select dt.token,
         coalesce(p.display_name, p.username, 'Alguien'),
         e.title,
         to_char(e.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
         e.place_text,
         e.series_days
  from public.events e
  join public.group_members gm on gm.group_id = e.group_id and gm.user_id <> e.owner_id
  join public.device_tokens dt on dt.user_id = gm.user_id
  left join public.profiles p on p.id = e.owner_id
  where e.id = eid and e.kind = 'evento'
    and e.created_at > now() - interval '5 minutes'
    and not exists (select 1 from public.blocks b where b.blocker_id = gm.user_id and b.blocked_id = e.owner_id);
$$;
revoke all on function public.new_event_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.new_event_push_targets(uuid) to service_role;
