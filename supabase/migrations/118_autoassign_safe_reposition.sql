-- 118 Fix auto-assign: never silently assign a long/unmeasurable reposition.
-- ONLY a proven short move (<=100km) auto-assigns; >100km OR null distance (unknown
-- driver city / unknown route pair) raises a reposition approval instead of assigning,
-- so drivers stay free for local work. Nearest eligible driver chosen first. Adds
-- transport_drivers.base_city as a location fallback. (Applied via Supabase MCP;
-- full transport_auto_assign body lives on remote / see 109+113 history.)
alter table transport_drivers add column if not exists base_city text;
