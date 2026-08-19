-- =====================================================================
-- AFROCUTS · Update 7 · Mitarbeiter-Logins (eigene Konten je Friseur)
-- Im Supabase SQL Editor einmal ausführen (New query -> einfügen -> Run)
-- =====================================================================

-- ---------- Mitarbeiter-Konten ----------
create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  staff_index int not null,              -- Position im shops.staff-Array (steuert, welche Termine sichtbar sind)
  name text not null,
  email text not null,
  user_id uuid references auth.users(id),
  status text not null default 'invited' check (status in ('invited','active')),
  can_view_shop_stats boolean not null default false,   -- sieht Auswertung des GANZEN Shops statt nur eigene Zahlen
  can_manage_all_bookings boolean not null default false, -- sieht/verwaltet Termine ALLER Kolleg:innen, nicht nur eigene
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (shop_id, staff_index)
);

alter table public.staff_members enable row level security;

-- Inhaber sieht/verwaltet die Mitarbeiter seines eigenen Shops
drop policy if exists staff_owner_all on public.staff_members;
create policy staff_owner_all on public.staff_members for all
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));

-- Mitarbeiter sieht die eigene Zeile (um Status/Rechte zu erkennen)
drop policy if exists staff_self_read on public.staff_members;
create policy staff_self_read on public.staff_members for select
  using (user_id = auth.uid());

-- ---------- Buchungen: Mitarbeiter-Zugriff ergänzen (Inhaber-Zugriff bleibt wie bisher) ----------
drop policy if exists bookings_staff_read on public.bookings;
create policy bookings_staff_read on public.bookings for select
  using (exists (
    select 1 from public.staff_members sm
    where sm.shop_id = bookings.shop_id and sm.user_id = auth.uid() and sm.status = 'active'
      and (sm.can_manage_all_bookings or sm.staff_index = bookings.staff_index)
  ));

drop policy if exists bookings_staff_update on public.bookings;
create policy bookings_staff_update on public.bookings for update
  using (exists (
    select 1 from public.staff_members sm
    where sm.shop_id = bookings.shop_id and sm.user_id = auth.uid() and sm.status = 'active'
      and (sm.can_manage_all_bookings or sm.staff_index = bookings.staff_index)
  ));

-- ---------- Hilfsfunktion: eigene Mitarbeiter-Zeile abrufen ----------
create or replace function public.my_staff_role()
returns table (shop_id uuid, staff_index int, name text, status text, can_view_shop_stats boolean, can_manage_all_bookings boolean)
language sql stable security definer set search_path = public as $$
  select shop_id, staff_index, name, status, can_view_shop_stats, can_manage_all_bookings
  from public.staff_members where user_id = auth.uid() and status = 'active' limit 1;
$$;
grant execute on function public.my_staff_role() to authenticated;

-- Mitarbeiter darf sich selbst als "aktiv" markieren, NACHDEM er sein Passwort gesetzt hat
create or replace function public.activate_my_staff_invite()
returns json language plpgsql security definer set search_path = public as $$
declare v_row public.staff_members%rowtype;
begin
  select * into v_row from public.staff_members where user_id = auth.uid() and status = 'invited' limit 1;
  if not found then raise exception 'Keine offene Einladung gefunden'; end if;
  update public.staff_members set status = 'active', activated_at = now() where id = v_row.id;
  return json_build_object('ok', true, 'shop_id', v_row.shop_id, 'name', v_row.name);
end $$;
grant execute on function public.activate_my_staff_invite() to authenticated;

-- Fertig. Die Einladungs-Mail selbst verschickt die Edge Function "invite-staff" (siehe supabase-functions/).
