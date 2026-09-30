-- Teléfonos registrados para notificaciones push.
create table if not exists public.device_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'ios',
  updated_at timestamptz not null default now()
);
alter table public.device_tokens enable row level security;
-- Nadie lee la tabla desde la app: solo la función de envío (con llave de servicio) y register_device.

create or replace function public.register_device(tok text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sin sesion'; end if;
  insert into public.device_tokens(token, user_id) values (tok, auth.uid())
  on conflict (token) do update set user_id = auth.uid(), updated_at = now();
end; $$;
grant execute on function public.register_device(text) to authenticated;
