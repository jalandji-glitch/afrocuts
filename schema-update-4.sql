-- =====================================================================
-- AFROCUTS · Update 4 · Chat zwischen Kunde und Barber
-- Im Supabase SQL Editor einmal ausführen (New query -> einfügen -> Run)
-- =====================================================================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender text not null check (sender in ('customer','barber')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_booking_idx on public.messages(booking_id, created_at);

alter table public.messages enable row level security;

-- Barber (eingeloggt) sieht/schreibt Nachrichten nur zu eigenen Buchungen — direkter Tabellenzugriff
drop policy if exists messages_owner_read on public.messages;
create policy messages_owner_read on public.messages for select
  using (exists (select 1 from public.bookings b join public.shops s on s.id=b.shop_id where b.id=booking_id and s.owner_id=auth.uid()) or public.is_admin());

drop policy if exists messages_owner_insert on public.messages;
create policy messages_owner_insert on public.messages for insert
  with check (sender='barber' and exists (select 1 from public.bookings b join public.shops s on s.id=b.shop_id where b.id=booking_id and s.owner_id=auth.uid()));

-- Kunde (nicht eingeloggt) nutzt Funktionen mit Buchungscode statt direktem Tabellenzugriff
create or replace function public.get_messages_by_code(p_code text)
returns setof public.messages language sql stable security definer set search_path = public as $$
  select m.* from public.messages m join public.bookings b on b.id = m.booking_id
  where upper(b.code) = upper(p_code) order by m.created_at asc;
$$;

create or replace function public.send_message_by_code(p_code text, p_body text)
returns public.messages language plpgsql security definer set search_path = public as $$
declare v_b public.bookings%rowtype; v_row public.messages%rowtype;
begin
  select * into v_b from public.bookings where upper(code) = upper(p_code);
  if not found then raise exception 'Buchung nicht gefunden'; end if;
  if length(trim(p_body)) < 1 then raise exception 'Nachricht darf nicht leer sein'; end if;
  if length(p_body) > 1000 then raise exception 'Nachricht zu lang'; end if;
  insert into public.messages (booking_id, sender, body) values (v_b.id, 'customer', trim(p_body)) returning * into v_row;
  return v_row;
end $$;

grant execute on function public.get_messages_by_code(text) to anon, authenticated;
grant execute on function public.send_message_by_code(text, text) to anon, authenticated;

-- Fertig. Barber-Seite nutzt normale Supabase-Tabellenzugriffe (RLS-geschützt),
-- Kunden-Seite nutzt ausschließlich die beiden Funktionen oben.
