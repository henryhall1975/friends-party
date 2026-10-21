-- "Mi gente": las personas que ya conozco en la app, para meterlas en mis grupos (Familia, Zumba…) sin invitación.
-- Son quienes están conmigo en algún grupo (mío o de otro), en algún evento, o me siguen.
-- A alguien que solo sigo yo, o a un desconocido, se le manda invitación. Aplicado el 2026-10-21.
create or replace function public.my_people()
returns table (id uuid, nombre text, de text)
language sql stable security definer set search_path to '' as $$
  select distinct on (p.id) p.id, coalesce(p.display_name, p.username), x.de
  from (
    select gm2.user_id,
           case when g.owner_id = auth.uid() then coalesce(nullif(g.name, 'Mi grupo'), 'Amigos')
                else 'Grupo de ' || coalesce(op.display_name, op.username, 'alguien') end as de,
           1 as pri
    from public.group_members gm1
    join public.group_members gm2 on gm2.group_id = gm1.group_id
    join public.groups g on g.id = gm1.group_id
    left join public.profiles op on op.id = g.owner_id
    where gm1.user_id = auth.uid()
    union all
    select em2.user_id, e.title, 2
    from public.event_members em1
    join public.event_members em2 on em2.event_id = em1.event_id
    join public.events e on e.id = em1.event_id
    where em1.user_id = auth.uid()
    union all
    select f.follower_id, 'Te sigue', 3 from public.follows f where f.followee_id = auth.uid()
  ) x
  join public.profiles p on p.id = x.user_id
  where x.user_id <> auth.uid()
    and not exists (select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = auth.uid()))
  order by p.id, x.pri;
$$;
revoke all on function public.my_people() from public, anon;
grant execute on function public.my_people() to authenticated;

-- meter a alguien de "mi gente" en uno de mis grupos
create or replace function public.add_to_my_group(gid uuid, uid uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from public.groups g where g.id = gid and g.owner_id = auth.uid()) then
    raise exception 'Ese grupo no es tuyo';
  end if;
  if not exists (select 1 from public.my_people() m where m.id = uid) then
    raise exception 'Solo puedes agregar a personas que ya conoces en la app';
  end if;
  insert into public.group_members(group_id, user_id, role) values (gid, uid, 'miembro') on conflict do nothing;
end; $$;
revoke all on function public.add_to_my_group(uuid, uuid) from public, anon;
grant execute on function public.add_to_my_group(uuid, uuid) to authenticated;
