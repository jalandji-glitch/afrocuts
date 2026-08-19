-- =====================================================================
-- AFROCUTS · Update 8 · Sicherheits-Feinschliff (Supabase-Lint-Hinweise)
-- Im Supabase SQL Editor einmal ausführen (New query -> einfügen -> Run)
-- =====================================================================

-- Diese zwei Funktionen sind NUR für eingeloggte Nutzer gedacht.
-- Gäste (anon) sollen sie technisch gar nicht erst aufrufen können,
-- auch wenn die interne Logik bereits vor Missbrauch schützt.
revoke execute on function public.is_admin() from anon;
revoke execute on function public.barber_arrived(uuid) from anon;

-- Zur Sicherheit nochmal explizit bestätigen, dass eingeloggte Nutzer
-- weiterhin normal zugreifen können (ändert nichts, macht es nur explizit):
grant execute on function public.is_admin() to authenticated;
grant execute on function public.barber_arrived(uuid) to authenticated;

-- Die übrigen 8 Funktionen (create_booking, get_booking, checkin_booking,
-- cancel_booking, get_taken_slots, open_dispute, send_message_by_code,
-- get_messages_by_code) bleiben bewusst für Gäste offen — das ist das
-- Grundprinzip der Buchung ohne Login. Kein Änderungsbedarf.
