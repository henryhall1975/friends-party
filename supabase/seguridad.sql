-- Reportes de contenido (requisito de Apple). Usa la tabla "reports" que ya existe.
-- La función delete_my_account() ya existe en el servidor, no se toca.
-- Pegar completo en Supabase > SQL Editor y ejecutar una sola vez.

create or replace function public.report_content(p_name text, p_kind text, p_reason text, p_details text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesion'; end if;
  select id into tid from public.profiles where display_name = p_name or username = p_name limit 1;
  insert into public.reports(reporter_id, target_user_id, reason)
  values (auth.uid(), tid, left(coalesce(p_kind, '') || ' | ' || coalesce(p_name, '') || ' | ' || coalesce(p_reason, '') || ' | ' || coalesce(p_details, ''), 500));
end; $$;

grant execute on function public.report_content(text, text, text, text) to authenticated;
