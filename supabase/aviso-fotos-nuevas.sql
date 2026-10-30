-- Aviso a los del evento (y a su grupo, por ejemplo las alumnas de zumba) cuando alguien sube fotos.
-- Si la misma persona sube varias seguidas, se avisa una sola vez (con la primera).
-- La función que manda el aviso está en supabase/functions/send-photo-push.
create or replace function public.notify_new_photo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.photos p
    where p.event_id = new.event_id and p.author_id = new.author_id and p.id <> new.id
      and p.created_at > new.created_at - interval '10 minutes' and p.created_at <= new.created_at
  ) then
    return new;
  end if;
  perform net.http_post(
    url := 'https://tjsrwipyhrqsvqodrnta.supabase.co/functions/v1/send-photo-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
    ),
    body := jsonb_build_object('photo_id', new.id),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new;  -- un fallo al avisar nunca debe impedir subir la foto
end; $$;
revoke all on function public.notify_new_photo() from public, anon, authenticated;

drop trigger if exists photos_new_push on public.photos;
create trigger photos_new_push after insert on public.photos
  for each row execute function public.notify_new_photo();

-- A quién avisar: los que van al evento, su dueño y, si es un evento (no un momento), su grupo;
-- menos quien subió la foto y quien la bloqueó. Solo fotos de los últimos 5 minutos.
create or replace function public.photo_push_targets(pid uuid)
returns table (token text, quien text, titulo text)
language sql stable security definer set search_path = '' as $$
  with ctx as (
    select ph.author_id, e.id as eid, e.title, e.kind, e.group_id, e.owner_id
    from public.photos ph join public.events e on e.id = ph.event_id
    where ph.id = pid and ph.created_at > now() - interval '5 minutes'
  ), dest as (
    select em.user_id from ctx join public.event_members em on em.event_id = ctx.eid
    union
    select ctx.owner_id from ctx
    union
    select gm.user_id from ctx join public.group_members gm on gm.group_id = ctx.group_id where ctx.kind = 'evento'
  )
  select dt.token, coalesce(p.display_name, p.username, 'Alguien'), ctx.title
  from ctx
  join dest on dest.user_id is not null and dest.user_id <> ctx.author_id
  join public.device_tokens dt on dt.user_id = dest.user_id
  left join public.profiles p on p.id = ctx.author_id
  where not exists (select 1 from public.blocks b where b.blocker_id = dest.user_id and b.blocked_id = ctx.author_id);
$$;
revoke all on function public.photo_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.photo_push_targets(uuid) to service_role;
