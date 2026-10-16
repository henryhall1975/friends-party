-- MOMENTOS: álbumes que no son de un evento. Viven en la misma tabla events con kind = 'momento'.
-- Un momento privado solo lo ve su dueño y quien entre con su código; uno público lo ven también sus seguidores.
-- A diferencia de los eventos, los momentos NO los ve todo el grupo del dueño.
-- (Aplicado en Supabase el 2026-10-15 como migración "momentos"; ver allí el texto completo de
--  is_event_member, is_event_viewer, chat_push_targets y reminder_candidates.)
alter table public.events add column if not exists kind text not null default 'evento';
alter table public.events add constraint events_kind_check check (kind in ('evento', 'momento'));
-- eventos: ver si soy miembro del grupo  -> solo kind = 'evento'
-- eventos: ver los mios                  -> owner_id = auth.uid()
-- fotos y archivos de fotos              -> is_event_viewer(): miembros, dueño y, si es público, sus seguidores
-- avisos de chat y recordatorios         -> a quienes son parte del evento o momento (no a todo el grupo)
