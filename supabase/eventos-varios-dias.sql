-- Eventos de varios días (por ejemplo, un mes de prácticas en la clínica): fecha de fin opcional.
-- Si está vacía, el evento es de un solo día (el de starts_at).
alter table public.events add column if not exists ends_on date;
