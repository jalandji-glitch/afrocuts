-- =====================================================================
-- AFROCUTS · Update 9 · Gruppenbuchung (z. B. Mutter mit 3 Kindern)
-- Im Supabase SQL Editor einmal ausführen (New query -> einfügen -> Run)
-- =====================================================================

-- Atomar: Alle Slots werden in einer Transaktion reserviert.
-- Schlägt einer fehl (z. B. gerade vergeben), wird KEINER gebucht.
create or replace function public.create_group_booking(
  p_shop uuid, p_staff_index int, p_staff_name text,
  p_service text, p_duration int, p_price numeric,
  p_date text, p_times text[],  -- Array von Startzeiten, z. B. ['09:00','09:30','10:00']
  p_name text, p_contact text, p_address text default ''
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_shop public.shops%rowtype;
  v_code text;
  v_codes text[] := '{}';
  v_ids uuid[] := '{}';
  v_t text;
  v_deposit numeric;
  v_link text;
  v_new_id uuid;
begin
  select * into v_shop from public.shops where id = p_shop and status = 'approved';
  if not found then raise exception 'Shop nicht gefunden oder nicht freigegeben'; end if;

  v_deposit := round(p_price * v_shop.deposit_pct / 100.0, 2);
  v_link := case when v_shop.payment_link is not null and v_shop.payment_link <> '' then v_shop.payment_link else null end;

  foreach v_t in array p_times loop
    -- Doppelbuchungs-Prüfung je Slot
    if exists (
      select 1 from public.bookings b
      where b.shop_id = p_shop and b.date = p_date and b.staff_index = p_staff_index
        and b.status in ('booked','checked_in')
        and (
          (b.time <= v_t and (to_timestamp(b.time,'HH24:MI') + (b.duration||' min')::interval)::time > v_t::time)
          or (v_t <= b.time and (to_timestamp(v_t,'HH24:MI') + (p_duration||' min')::interval)::time > b.time::time)
        )
    ) then
      raise exception 'Slot % ist gerade vergeben — bitte andere Startzeit wählen', v_t;
    end if;

    -- Code erzeugen
    v_code := upper(substr(md5(random()::text), 1, 6));
    v_new_id := gen_random_uuid();

    insert into public.bookings (id, shop_id, staff_index, staff_name, service_name, duration, price, date, time, customer_name, customer_contact, customer_address, deposit_amount, deposit_status, status, code)
    values (v_new_id, p_shop, p_staff_index, p_staff_name, p_service, p_duration, p_price, p_date, v_t, p_name, p_contact, p_address, v_deposit, 'pending', 'booked', v_code);

    v_codes := v_codes || v_code;
    v_ids := v_ids || v_new_id;
  end loop;

  return json_build_object('codes', v_codes, 'ids', v_ids, 'count', array_length(p_times, 1), 'payment_link', v_link);
end $$;
grant execute on function public.create_group_booking(uuid, int, text, text, int, numeric, text, text[], text, text, text) to anon, authenticated;
