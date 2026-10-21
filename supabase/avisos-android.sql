-- Notificaciones push también en Android (Firebase Cloud Messaging). Aplicado el 2026-10-20.
-- La app de Android registra su teléfono con platform = 'android'; las funciones de aviso
-- mandan por APNs a 'ios' y por FCM a 'android' (ver supabase/functions/_shared/push.ts).
create or replace function public.register_device(tok text, plat text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then raise exception 'Sin sesion'; end if;
  if plat not in ('ios', 'android') then raise exception 'Plataforma no valida'; end if;
  insert into public.device_tokens(token, user_id, platform) values (tok, auth.uid(), plat)
  on conflict (token) do update set user_id = auth.uid(), platform = plat, updated_at = now();
end; $$;
revoke all on function public.register_device(text, text) from public, anon;
grant execute on function public.register_device(text, text) to authenticated;
