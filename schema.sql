-- =====================================================================
-- AFROCUTS · Testversion · Datenbank-Schema für Supabase (PostgreSQL)
-- Im Supabase-Dashboard: SQL Editor -> New query -> alles einfügen -> Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Admins (App-Manager) ----------
create table if not exists public.admins (
  email text primary key
);
-- >>> HIER DEINE E-MAIL EINTRAGEN (dieselbe, mit der du dich später einloggst):
insert into public.admins (email) values ('j.alandji@googlemail.com') on conflict do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email','')));
$$;

-- ---------- Shops ----------
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','paused')),
  name text not null,
  type text not null default 'shop' check (type in ('shop','mobile')),
  city text not null default '',
  address text default '',
  area text default '',
  phone text default '',
  instagram text default '',
  tiktok text default '',
  whatsapp text default '',
  specialties text[] default '{}',
  services jsonb not null default '[]',        -- [{name,duration,price}]
  staff jsonb not null default '[]',           -- [{name}]  (leer = Solo)
  hours jsonb not null default '{}',           -- {"1":{"open":true,"from":"09:00","to":"19:00"}, ... 0=So..6=Sa}
  slot_step int not null default 30,
  deposit_pct int not null default 30,
  payment_link text default '',                -- optionaler Stripe-Payment-Link für die Anzahlung (Testphase)
  shop_code text not null unique default upper(substr(encode(gen_random_bytes(4),'hex'),1,6)),
  unavail jsonb not null default '{}'          -- {"0":{"2026-08-17":[10,11]}} staffIndex -> date -> gesperrte Stunden
);
create index if not exists shops_status_idx on public.shops(status);
create unique index if not exists shops_owner_idx on public.shops(owner_id);

-- ---------- Buchungen ----------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  staff_index int not null default 0,
  staff_name text default '',
  service_name text not null,
  duration int not null,
  price numeric(8,2) not null,
  deposit_amount numeric(8,2) not null,
  deposit_status text not null default 'pending' check (deposit_status in ('pending','paid','refunded','waived')),
  date date not null,
  time text not null,                          -- "HH:MM"
  customer_name text not null,
  customer_contact text not null,
  customer_address text default '',
  status text not null default 'booked' check (status in ('booked','checked_in','completed','cancelled_customer','cancelled_barber','no_show_barber','no_show_customer')),
  checked_in_at timestamptz,
  code text not null unique default upper(substr(encode(gen_random_bytes(3),'hex'),1,6)),
  unique (shop_id, staff_index, date, time)
);
create index if not exists bookings_shop_date_idx on public.bookings(shop_id, date);

-- ---------- Streitfälle ----------
create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  reason text not null,                        -- 'barber_absent' | 'barber_cancelled' | 'other'
  note text default '',
  status text not null default 'open' check (status in ('open','refunded','rejected')),
  resolved_at timestamptz
);

-- ---------- Row Level Security ----------
alter table public.shops enable row level security;
alter table public.bookings enable row level security;
alter table public.disputes enable row level security;
alter table public.admins enable row level security;

-- admins: nur lesen für sich selbst (is_admin läuft als security definer)
drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));

-- shops
drop policy if exists shops_public_read on public.shops;
create policy shops_public_read on public.shops for select using (status = 'approved' or owner_id = auth.uid() or public.is_admin());
drop policy if exists shops_owner_insert on public.shops;
create policy shops_owner_insert on public.shops for insert with check (owner_id = auth.uid());
drop policy if exists shops_owner_update on public.shops;
create policy shops_owner_update on public.shops for update using (owner_id = auth.uid() or public.is_admin());

-- bookings: Barber sieht eigene Shop-Buchungen, Admin alles; Kunden gehen über RPCs
drop policy if exists bookings_owner_read on public.bookings;
create policy bookings_owner_read on public.bookings for select
  using (exists (select 1 from public.shops s where s.id = shop_id and (s.owner_id = auth.uid() or public.is_admin())));
drop policy if exists bookings_owner_update on public.bookings;
create policy bookings_owner_update on public.bookings for update
  using (exists (select 1 from public.shops s where s.id = shop_id and (s.owner_id = auth.uid() or public.is_admin())));

-- disputes: Admin + Shop-Owner lesen/ändern
drop policy if exists disputes_read on public.disputes;
create policy disputes_read on public.disputes for select
  using (public.is_admin() or exists (select 1 from public.bookings b join public.shops s on s.id=b.shop_id where b.id=booking_id and s.owner_id=auth.uid()));
drop policy if exists disputes_update on public.disputes;
create policy disputes_update on public.disputes for update using (public.is_admin());

-- ---------- RPCs für Kunden (ohne Login) ----------

-- belegte Slots eines Shops an einem Tag (nur Zeit + Friseur, keine Kundendaten)
create or replace function public.get_taken_slots(p_shop uuid, p_date date)
returns table (staff_index int, "time" text, duration int)
language sql stable security definer set search_path = public as $$
  select b.staff_index, b.time, b.duration from public.bookings b
  where b.shop_id = p_shop and b.date = p_date
    and b.status in ('booked','checked_in','completed');
$$;

-- Buchung anlegen (Gast). Gibt id + code zurück. Prüft Doppelbelegung via unique-Constraint.
create or replace function public.create_booking(
  p_shop uuid, p_staff_index int, p_staff_name text, p_service text, p_duration int, p_price numeric,
  p_date date, p_time text, p_name text, p_contact text, p_address text default ''
) returns json language plpgsql security definer set search_path = public as $$
declare v_shop public.shops%rowtype; v_id uuid; v_code text; v_dep numeric;
begin
  select * into v_shop from public.shops where id = p_shop and status = 'approved';
  if not found then raise exception 'Shop nicht verfügbar'; end if;
  if length(trim(p_name)) < 2 or length(trim(p_contact)) < 5 then raise exception 'Name und Kontakt erforderlich'; end if;
  v_dep := round(p_price * v_shop.deposit_pct / 100.0, 2);
  insert into public.bookings (shop_id, staff_index, staff_name, service_name, duration, price, deposit_amount, date, time, customer_name, customer_contact, customer_address)
  values (p_shop, p_staff_index, p_staff_name, p_service, p_duration, p_price, v_dep, p_date, p_time, trim(p_name), trim(p_contact), coalesce(p_address,''))
  returning id, code into v_id, v_code;
  return json_build_object('id', v_id, 'code', v_code, 'deposit', v_dep, 'payment_link', v_shop.payment_link, 'shop_code', v_shop.shop_code);
exception when unique_violation then
  raise exception 'Dieser Termin wurde gerade vergeben — bitte anderen Slot wählen';
end $$;

-- Buchung per Code lesen (Kunde)
create or replace function public.get_booking(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', b.id, 'code', b.code, 'status', b.status, 'date', b.date, 'time', b.time, 'service_name', b.service_name,
    'staff_name', b.staff_name, 'price', b.price, 'deposit_amount', b.deposit_amount, 'deposit_status', b.deposit_status,
    'checked_in_at', b.checked_in_at, 'customer_name', b.customer_name,
    'shop', json_build_object('id', s.id, 'name', s.name, 'type', s.type, 'address', s.address, 'area', s.area, 'city', s.city, 'phone', s.phone, 'payment_link', s.payment_link)
  ) from public.bookings b join public.shops s on s.id = b.shop_id where upper(b.code) = upper(p_code);
$$;

-- Check-in: Kunde gibt Shop-Code ein (per QR/URL oder manuell). Zeitfenster: 15 Min vor bis 60 Min nach Termin.
create or replace function public.checkin_booking(p_code text, p_shop_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_b public.bookings%rowtype; v_s public.shops%rowtype; v_start timestamptz; v_now timestamptz := now();
begin
  select * into v_b from public.bookings where upper(code) = upper(p_code);
  if not found then raise exception 'Buchung nicht gefunden'; end if;
  select * into v_s from public.shops where id = v_b.shop_id;
  if upper(v_s.shop_code) <> upper(p_shop_code) then raise exception 'Falscher Shop-Code — bist du im richtigen Laden?'; end if;
  if v_b.status <> 'booked' then raise exception 'Buchung ist bereits % ', v_b.status; end if;
  v_start := (v_b.date::text || ' ' || v_b.time)::timestamp at time zone 'Europe/Berlin';
  if v_now < v_start - interval '15 minutes' then raise exception 'Check-in ist erst 15 Minuten vor deinem Termin möglich'; end if;
  if v_now > v_start + interval '60 minutes' then raise exception 'Das Check-in-Zeitfenster ist abgelaufen — bitte beim Barber melden'; end if;
  update public.bookings set status = 'checked_in', checked_in_at = v_now where id = v_b.id;
  return json_build_object('ok', true, 'checked_in_at', v_now);
end $$;

-- Kunde storniert selbst
create or replace function public.cancel_booking(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_b public.bookings%rowtype;
begin
  select * into v_b from public.bookings where upper(code) = upper(p_code);
  if not found then raise exception 'Buchung nicht gefunden'; end if;
  if v_b.status <> 'booked' then raise exception 'Buchung kann nicht mehr storniert werden'; end if;
  update public.bookings set status = 'cancelled_customer' where id = v_b.id;
  return json_build_object('ok', true);
end $$;

-- Kunde meldet Problem (Barber nicht da / hat abgesagt / sonstiges)
create or replace function public.open_dispute(p_code text, p_reason text, p_note text default '')
returns json language plpgsql security definer set search_path = public as $$
declare v_b public.bookings%rowtype; v_id uuid;
begin
  select * into v_b from public.bookings where upper(code) = upper(p_code);
  if not found then raise exception 'Buchung nicht gefunden'; end if;
  if v_b.status = 'checked_in' and p_reason in ('barber_absent','barber_cancelled') then
    raise exception 'Du bist bereits eingecheckt — bitte Support kontaktieren';
  end if;
  insert into public.disputes (booking_id, reason, note) values (v_b.id, p_reason, coalesce(p_note,'')) returning id into v_id;
  return json_build_object('ok', true, 'dispute_id', v_id);
end $$;

-- Für Admin/Barber: Aufruf-Berechtigung der RPCs
grant execute on function public.get_taken_slots(uuid,date) to anon, authenticated;
grant execute on function public.create_booking(uuid,int,text,text,int,numeric,date,text,text,text,text) to anon, authenticated;
grant execute on function public.get_booking(text) to anon, authenticated;
grant execute on function public.checkin_booking(text,text) to anon, authenticated;
grant execute on function public.cancel_booking(text) to anon, authenticated;
grant execute on function public.open_dispute(text,text,text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- Fertig. Danach in Supabase: Authentication -> Providers -> Email aktivieren (Magic Link).
