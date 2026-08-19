-- =====================================================================
-- AFROCUTS · Update 5 · Barber-E-Mail speichern (für Benachrichtigungen)
-- Im Supabase SQL Editor einmal ausführen (New query -> einfügen -> Run)
-- =====================================================================

alter table public.shops add column if not exists owner_email text;

-- Bestehende Shops einmalig nachträglich befüllen (E-Mail aus dem Login-Konto)
update public.shops s
set owner_email = u.email
from auth.users u
where s.owner_id = u.id and s.owner_email is null;

-- Fertig. Neue Registrierungen tragen die E-Mail künftig automatisch ein (app.js).
