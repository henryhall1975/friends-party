-- Recordatorios de eventos por notificación (aplicado el 2026-10-10 como migraciones
-- recordatorios_de_eventos y recordatorios_tarea_diaria). La función que los manda está en
-- supabase/functions/send-reminders.

alter table public.events
  add column if not exists remind_d3 boolean not null default true,
  add column if not exists remind_d1 boolean not null default true,
  add column if not exists remind_d0 boolean not null default true;

create table if not exists public.event_reminders_sent (
  event_id uuid not null references public.events(id) on delete cascade,
  kind text not null check (kind in ('d3','d1','d0')),
  sent_at timestamptz not null default now(),
  primary key (event_id, kind)
);
alter table public.event_reminders_sent enable row level security;

-- A quién toca avisar hoy. La fecha del evento se guarda como la escribió el usuario (hora local, sin zona),
-- y "hoy" se calcula en la zona indicada (por defecto Guatemala).
create or replace function public.reminder_candidates(tz text default 'America/Guatemala')
returns table (event_id uuid, kind text, title text, place text, hhmm text, user_id uuid, token text)
language sql stable security definer set search_path = '' as $$
  with ev as (
    select e.id, e.group_id, e.title, coalesce(e.place_text, '') as place,
           to_char(e.starts_at at time zone 'UTC', 'HH24:MI') as hhmm,
           ((e.starts_at at time zone 'UTC')::date - (now() at time zone tz)::date) as falta,
           e.remind_d3, e.remind_d1, e.remind_d0
    from public.events e
    where e.starts_at is not null
  ), due as (
    select id, group_id, title, place, hhmm,
           case falta when 3 then 'd3' when 1 then 'd1' when 0 then 'd0' end as kind
    from ev
    where (falta = 3 and remind_d3) or (falta = 1 and remind_d1) or (falta = 0 and remind_d0)
  )
  select d.id, d.kind, d.title, d.place, d.hhmm, gm.user_id, dt.token
  from due d
  join public.group_members gm on gm.group_id = d.group_id
  join public.device_tokens dt on dt.user_id = gm.user_id
  where not exists (select 1 from public.event_reminders_sent s where s.event_id = d.id and s.kind = d.kind);
$$;
revoke all on function public.reminder_candidates(text) from public, anon, authenticated;
grant execute on function public.reminder_candidates(text) to service_role;

-- Tarea diaria: 14:00 UTC (8:00 a. m. en Guatemala)
select cron.unschedule(jobid) from cron.job where jobname = 'recordatorios-eventos-diario';
select cron.schedule(
  'recordatorios-eventos-diario',
  '0 14 * * *',
  $job$
  select net.http_post(
    url := 'https://tjsrwipyhrqsvqodrnta.supabase.co/functions/v1/send-reminders',
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
-- Para ver qué mandaría hoy sin mandarlo: llamar a la función con ?dry=1
