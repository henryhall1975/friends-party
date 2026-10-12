-- El dueño de un evento puede borrarlo. Sus fotos, mensajes, canciones, historias,
-- invitaciones y miembros se van con él (las llaves foráneas ya son ON DELETE CASCADE);
-- los archivos sueltos los recoge la limpieza diaria (cleanup_candidates).
create policy "eventos: borrar si soy dueno" on public.events
  for delete to authenticated using (owner_id = (select auth.uid()));
