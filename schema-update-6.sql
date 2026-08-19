-- =====================================================================
-- AFROCUTS · Update 6 · Signature-Foto je Barber (für Hero-Galerie)
-- Im Supabase SQL Editor einmal ausführen (New query -> einfügen -> Run)
-- =====================================================================

alter table public.shops add column if not exists portfolio_image text;

-- Kein eigener Bildspeicher nötig: Barber hinterlegen einen Link zu ihrem
-- besten Foto (z. B. ein öffentliches Instagram-Bild), genau wie beim
-- bestehenden Zahlungslink-Feld.
