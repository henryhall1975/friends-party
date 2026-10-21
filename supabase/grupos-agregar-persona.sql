-- Meter a una persona en otro de MIS grupos (por ejemplo, de "Amigos" a "Zumba") sin mandarle invitación.
-- Solo vale para gente que ya está en alguno de mis grupos (ya aceptó estar conmigo); a desconocidos se les invita.
-- Para sacarla de un grupo basta la política "miembros_grupo: salir" (el dueño puede quitar). Aplicado el 2026-10-21.
create or replace function public.add_to_my_group(gid uuid, uid uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from public.groups g where g.id = gid and g.owner_id = auth.uid()) then
    raise exception 'Ese grupo no es tuyo';
  end if;
  if not exists (
    select 1 from public.group_members gm join public.groups g on g.id = gm.group_id
    where g.owner_id = auth.uid() and gm.user_id = uid
  ) then
    raise exception 'Solo puedes agregar a personas que ya estan en alguno de tus grupos';
  end if;
  insert into public.group_members(group_id, user_id, role) values (gid, uid, 'miembro') on conflict do nothing;
end; $$;
revoke all on function public.add_to_my_group(uuid, uuid) from public, anon;
grant execute on function public.add_to_my_group(uuid, uuid) to authenticated;
