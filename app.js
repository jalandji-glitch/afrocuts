/* =====================================================================
   AFROCUTS · Testversion (PWA) · app.js
   Rollen: Kunde (ohne Login) · Barber (Magic-Link-Login) · Admin
   Backend: Supabase (siehe schema.sql). Konfiguration: config.js
   ===================================================================== */
(function(){
'use strict';
const C = window.AFRO_CONFIG || {};
const $ = s => document.querySelector(s);
const app = $('#app');
const DOW = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const DOW2 = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const MON = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const SPECIALTIES = ['Fades','Locs','Bart','Waves','Kids','Design','Twists','Braids'];
const AREAS = ['Mitte','Kreuzberg','Neukölln','Friedrichshain','Wedding','Charlottenburg','Schöneberg','Moabit'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = n => (Number(n)||0).toFixed(2).replace('.',',') + ' €';
const pad = n => String(n).padStart(2,'0');
const dkey = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const fmtD = d => DOW2[d.getDay()]+', '+d.getDate()+'. '+MON[d.getMonth()];
const fromKey = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y,m-1,d); };
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const nowMin = () => { const d = new Date(); return d.getHours()*60 + d.getMinutes(); };
const t2m = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
const m2t = m => pad(Math.floor(m/60))+':'+pad(m%60);

// ---------- Supabase ----------
let sb = null, session = null, isAdmin = false, myShop = null, authError = null;
const APP_VERSION = 'v15';
function edgeUrl(fn){ return C.SUPABASE_URL.replace(/\/$/,'') + '/functions/v1/' + fn; }
async function callEdge(fn, body, withAuth){
  const headers = { 'Content-Type': 'application/json' };
  if (withAuth && session) headers['Authorization'] = 'Bearer ' + session.access_token;
  const r = await fetch(edgeUrl(fn), { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Fehler (' + r.status + ')'));
  return j;
}
function initSb(){
  if (!C.SUPABASE_URL || C.SUPABASE_URL.includes('DEIN-PROJEKT')){
    app.innerHTML = '<div class="view"><div class="hero"><div class="h1">AFROCUTS</div></div><div class="err"><b>Noch nicht konfiguriert.</b><br>Bitte in <code>config.js</code> SUPABASE_URL und SUPABASE_ANON_KEY eintragen (siehe Einrichtungsanleitung).</div></div>';
    return false;
  }
  sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit' }
  });
  return true;
}

// ---------- Toast ----------
let toastT;
function toast(msg, bad){ const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', 2600); }
function errMsg(e){ return (e && (e.message || e.error_description || e.msg)) || String(e); }

// ---------- Local storage (Kunde: eigene Buchungscodes) ----------
const LS = 'afro_my_bookings';
function myCodes(){ try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } }
function saveCode(o){ const a = myCodes().filter(x => x.code !== o.code); a.unshift(o); localStorage.setItem(LS, JSON.stringify(a.slice(0, 30))); }

// ---------- Router ----------
function route(){ return location.hash.replace(/^#\/?/, '') || 'home'; }
function nav(h){ location.hash = '#/' + h; }
window.addEventListener('hashchange', render);

function topbar(title, back, right){
  return `<div class="topbar">${back ? `<div class="back" onclick="location.hash='#/${back}'">←</div>` : `<div class="logo">AFROCUTS${C.TEST_MODE ? '<span class="testtag">TEST ' + APP_VERSION + '</span>' : ''}</div>`}
    ${title ? `<div class="title">${esc(title)}</div>` : ''}<div>${right || (back ? '<div style="width:34px"></div>' : '')}</div></div>`;
}
function bottomNav(active){
  const it = (k, ic, l) => `<div class="it ${active===k?'on':''}" onclick="location.hash='#/${k}'"><div>${ic}</div>${l}</div>`;
  return `<div class="nav"><div class="in">${it('home','🗺️','Barber')}${it('my','📅','Meine Termine')}${it('barber','💈','Für Barber')}</div></div>`;
}

// =====================================================================
// KUNDE
// =====================================================================
let shopsCache = null;
async function loadShops(){
  const { data, error } = await sb.from('shops').select('*').eq('status','approved').order('created_at');
  if (error) throw error;
  shopsCache = data || [];
  return shopsCache;
}
function shopMeta(s){
  const t = s.type === 'mobile' ? '🚗 Kommt zu dir · ' + (s.area || s.city) : (s.address || s.city);
  const staff = (s.staff||[]).length;
  return t + (staff > 1 ? ' · ' + staff + ' Friseure' : '') + (s.specialties?.length ? ' · ' + s.specialties.slice(0,3).join(', ') : '');
}
let cityFilter = (typeof localStorage!=='undefined' && localStorage.getItem('afro_city')) || '';
function setCity(v){ cityFilter = v.trim(); try{ localStorage.setItem('afro_city', cityFilter); }catch{} viewHome(); }
async function useLocation(){
  const btn = document.getElementById('locBtn');
  if (!navigator.geolocation){ toast('Standort wird von diesem Browser nicht unterstützt', true); return; }
  if (btn) btn.innerHTML = '<span class="spinner"></span> Standort wird ermittelt …';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const { latitude, longitude } = pos.coords;
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=10&accept-language=de`);
      const j = await r.json();
      const city = j?.address?.city || j?.address?.town || j?.address?.village || j?.address?.county || j?.address?.municipality;
      if (!city){ toast('Stadt konnte nicht ermittelt werden — bitte manuell eingeben', true); if (btn) btn.innerHTML = '📍 Meinen Standort verwenden'; return; }
      setCity(city);
      toast('📍 Standort erkannt: ' + city);
    } catch(e){ toast('Standort konnte nicht aufgelöst werden', true); if (btn) btn.innerHTML = '📍 Meinen Standort verwenden'; }
  }, (err) => {
    toast(err.code === 1 ? 'Standortzugriff wurde nicht erlaubt' : 'Standort konnte nicht ermittelt werden', true);
    if (btn) btn.innerHTML = '📍 Meinen Standort verwenden';
  }, { timeout: 8000 });
}
async function viewHome(){
  const loggedInBanner = session ? `<div class="lock" style="cursor:pointer" onclick="location.hash='#/barber'">✓ Du bist als Barber angemeldet. <b style="color:var(--gold-l)">Tippe hier, um zu deinem Profil / Dashboard zu gehen →</b></div>` : '';
  app.innerHTML = topbar() + `<div class="view">
    <div class="hero2"><div class="h1b">Der Look, der dich verändert.<br>Der Barber, der ihn kennt.</div><p>Entdecke die besten Afro-Barber in deiner Stadt — verbindlich buchbar, ohne Anmeldung.</p></div>
    <div id="gallery"><div class="gal-loading"><span class="spinner"></span></div></div>
    ${loggedInBanner}
    <label class="l" style="margin-top:18px">📍 In welcher Stadt suchst du?</label><div class="row"><input id="cityIn" placeholder="z. B. Berlin, Köln, Hamburg …" value="${esc(cityFilter)}"><button class="btn small" onclick="AF.setCity(document.getElementById('cityIn').value)">Suchen</button></div>
    <div style="margin-top:8px"><span class="locbtn" onclick="AF.useLocation()" id="locBtn">📍 Meinen Standort verwenden</span></div>
    ${cityFilter ? `<div class="note" style="margin-top:6px">Zeige Barber in „${esc(cityFilter)}“. <span style="color:var(--gold-l);cursor:pointer" onclick="AF.setCity('')">✕ Filter entfernen</span></div>` : ''}
    <div id="list"><span class="spinner"></span> Lade Barber …</div></div>` + bottomNav('home');
  try {
    const shops = await loadShops();
    const withPhoto = shops.filter(s => s.portfolio_image);
    const gal = $('#gallery');
    if (withPhoto.length){
      gal.innerHTML = `<div class="gal-scroll">${withPhoto.map(s => `<div class="gal-card" onclick="location.hash='#/shop/${s.id}'"><img src="${esc(s.portfolio_image)}" loading="lazy" onerror="this.closest('.gal-card').style.display='none'"><div class="gal-cap"><b>${esc(s.name)}</b><span>${esc(s.city||'')}</span></div></div>`).join('')}</div>`;
    } else {
      gal.innerHTML = '';
    }
    const list = $('#list');
    let filtered = shops;
    if (cityFilter){ const cf = cityFilter.toLowerCase(); filtered = shops.filter(s => (s.city||'').toLowerCase().includes(cf) || (s.area||'').toLowerCase().includes(cf) || (s.address||'').toLowerCase().includes(cf)); }
    if (!shops.length){ list.innerHTML = '<div class="card"><div class="name">Noch keine Barber freigeschaltet</div><div class="meta">Sobald der erste Shop geprüft ist, erscheint er hier.</div></div>'; return; }
    if (!filtered.length){ list.innerHTML = `<div class="card"><div class="name">Keine Barber in „${esc(cityFilter)}“</div><div class="meta">Versuch eine andere Stadt, oder <span style="color:var(--gold-l);cursor:pointer" onclick="AF.setCity('')">zeige alle Barber</span>.</div></div>`; return; }
    list.innerHTML = '<div class="sec">Verfügbare Barber</div>' + filtered.map(s => `<div class="card click" onclick="location.hash='#/shop/${s.id}'"><div class="row">${s.portfolio_image ? `<img class="thumb-ph" src="${esc(s.portfolio_image)}" onerror="this.outerHTML='<div class=\\'thumb\\'>${s.type==='mobile'?'🚗':'💈'}</div>'">` : `<div class="thumb">${s.type==='mobile'?'🚗':'💈'}</div>`}<div style="flex:1;min-width:0"><div class="name">${esc(s.name)}</div><div class="meta">${esc(shopMeta(s))}</div><span class="badge">✓ Direktbuchung</span></div><div style="color:var(--muted)">›</div></div></div>`).join('');
  } catch(e){ $('#list').innerHTML = `<div class="err">Fehler beim Laden: ${esc(errMsg(e))}</div>`; }
}

// ---------- Buchungs-Flow-State ----------
const B = { shop:null, service:null, staff:'any', dayIdx:0, time:null, staffIdx:null };

async function getShop(id){
  if (shopsCache){ const s = shopsCache.find(x => x.id === id); if (s) return s; }
  const { data, error } = await sb.from('shops').select('*').eq('id', id).single();
  if (error) throw error; return data;
}
function mapsLink(s){ return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((s.address||'') + ' ' + (s.city||'')); }

async function viewShop(id){
  app.innerHTML = topbar('', 'home') + '<div class="view"><span class="spinner"></span> Lade …</div>';
  try {
    const s = await getShop(id); B.shop = s; B.service = null; B.staff = 'any'; B.time = null; B.dayIdx = 0;
    const socials = [s.instagram && `<a class="chip" href="https://instagram.com/${esc(s.instagram.replace('@',''))}" target="_blank">📸 Instagram</a>`, s.tiktok && `<a class="chip" href="https://tiktok.com/@${esc(s.tiktok.replace('@',''))}" target="_blank">🎵 TikTok</a>`, s.whatsapp && `<a class="chip" href="https://wa.me/${esc(s.whatsapp.replace(/[^0-9]/g,''))}" target="_blank">💬 WhatsApp</a>`].filter(Boolean).join('');
    app.innerHTML = topbar('', 'home') + `<div class="view">
      ${s.portfolio_image ? `<div class="profile-hero"><img src="${esc(s.portfolio_image)}" onerror="this.parentElement.style.display='none'"></div>` : ''}
      <div class="h1">${esc(s.name)}</div>
      <div class="meta" style="font-size:13px">${s.type==='mobile' ? '🚗 Bedient: ' + esc(s.area||s.city) : esc(s.address||'') + ' · ' + esc(s.city||'')}${s.type!=='mobile' && s.address ? ` · <a href="${mapsLink(s)}" target="_blank">Karte</a>` : ''}</div>
      <span class="badge">${s.type==='mobile' ? '✓ Freelancer · kommt zu dir nach Hause' : '✓ Nimmt App-Buchungen an'}</span>
      ${socials ? `<div class="chips" style="margin-top:12px">${socials}</div>` : ''}
      ${s.specialties?.length ? `<div class="sec">Spezialisiert auf</div><div class="chips">${s.specialties.map(x=>`<span class="chip on">${esc(x)}</span>`).join('')}</div>` : ''}
      <div class="sec">Service wählen</div>
      <div id="svcs">${(s.services||[]).map((v,i)=>`<div class="svc" data-i="${i}" onclick="AF.pickService(${i})"><div><div style="font-weight:600">${esc(v.name)}</div><div class="meta">${v.duration} min</div></div><div class="p">${eur(v.price)}</div></div>`).join('') || '<div class="note">Dieser Barber hat noch keine Services eingetragen.</div>'}</div>
      <div style="height:80px"></div></div>
      <div class="sticky"><div class="in"><button class="btn" id="nextBtn" disabled onclick="AF.afterService()">Weiter</button></div></div>`;
  } catch(e){ app.innerHTML = topbar('', 'home') + `<div class="view"><div class="err">${esc(errMsg(e))}</div></div>`; }
}
function pickService(i){ B.service = B.shop.services[i]; document.querySelectorAll('#svcs .svc').forEach(el => el.classList.toggle('on', +el.dataset.i === i)); $('#nextBtn').disabled = false; }
function afterService(){ if ((B.shop.staff||[]).length > 1) nav('stylist'); else { B.staff = 'any'; nav('time'); } }

function viewStylist(){
  if (!B.shop || !B.service) return nav('home');
  const st = B.shop.staff;
  const card = (k, name, sub) => `<div class="stylist ${B.staff===k?'on':''}" onclick="AF.pickStaff('${k}')"><div class="av">${name[0]}</div><div><div style="font-weight:700">${esc(name)}</div><div class="meta">${sub}</div></div></div>`;
  app.innerHTML = topbar('Friseur wählen', 'shop/' + B.shop.id) + `<div class="view"><div class="sec">Bei wem?</div>${card('any','Beliebig','Schnellster Termin — alle freien Zeiten im Team')}${st.map((x,i)=>card(String(i), x.name, 'Nur dieser Kalender')).join('')}<div style="height:80px"></div></div><div class="sticky"><div class="in"><button class="btn" onclick="location.hash='#/time'">Weiter · Termin wählen</button></div></div>`;
}
function pickStaff(k){ B.staff = k; viewStylist(); }

// ---------- Verfügbarkeit berechnen ----------
function hoursFor(shop, date){ const h = (shop.hours||{})[String(date.getDay())]; return (h && h.open) ? h : null; }

// ---------- Verpasster Umsatz durch leere Stühle (Verlust-Aversion) ----------
// Schätzt, wie viel Umsatz in der Vergangenheit durch nicht gebuchte Kapazität entgangen ist.
// Rate (€/Minute) wird aus den EIGENEN, tatsächlich abgeschlossenen Terminen im selben Zeitraum
// abgeleitet — keine erfundene Pauschale, sondern die reale Leistung des jeweiligen Shops.
function missedRevenueEstimate(shop, bookingsForShop, rangeKey){
  const t = today();
  const start = new Date(t);
  if (rangeKey === 'week') start.setDate(t.getDate() - 6);
  else if (rangeKey === 'month') start.setDate(t.getDate() - 29);
  else if (rangeKey === 'all') start.setDate(t.getDate() - 89); // Schätzung auf 90 Tage gedeckelt
  // 'today' -> start bleibt heute
  const end = t;
  const staffN = Math.max(1, (shop.staff||[]).length);
  let capacityMin = 0, bookedRealizedMin = 0, realizedRevenue = 0, realizedMin = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)){
    const h = hoursFor(shop, d);
    if (!h) continue;
    const dk = dkey(d);
    const isToday = dk === dkey(t);
    const fromM = t2m(h.from), toM = isToday ? Math.min(t2m(h.to), nowMin()) : t2m(h.to);
    if (toM <= fromM) continue;
    for (let si = 0; si < staffN; si++){
      const blocked = new Set((((shop.unavail||{})[String(si)]||{})[dk]) || []);
      for (let hh = Math.floor(fromM/60); hh < Math.ceil(toM/60); hh++){
        if (blocked.has(hh)) continue;
        const hs = Math.max(hh*60, fromM), he = Math.min((hh+1)*60, toM);
        if (he > hs) capacityMin += (he - hs);
      }
    }
  }
  (bookingsForShop || []).forEach(b => {
    const bd = fromKey(b.date);
    if (bd < start || bd > end) return;
    if (['checked_in','completed'].includes(b.status)){
      const dur = Number(b.duration) || 0;
      bookedRealizedMin += dur; realizedRevenue += Number(b.price) || 0; realizedMin += dur;
    }
  });
  const missedMin = Math.max(0, capacityMin - bookedRealizedMin);
  if (realizedMin < 60) return { missedMin, missedRevenue: null }; // zu wenig eigene Daten für eine verlässliche Rate
  const rate = realizedRevenue / realizedMin;
  return { missedMin, missedRevenue: Math.round(missedMin * rate * 100) / 100 };
}
function missedRevenueBox(est){
  if (est.missedRevenue === null){
    return `<div class="lossbox">📉 <b>Verpasster Umsatz:</b> noch nicht genug eigene Termine für eine verlässliche Schätzung.</div>`;
  }
  const hrs = Math.round(est.missedMin/60*10)/10;
  return `<div class="lossbox">📉 <b>Verpasster Umsatz (Schätzung):</b> <span style="font-size:17px;font-weight:800">${eur(est.missedRevenue)}</span> durch ${hrs} Std. ungebuchte Kapazität — geschätzt anhand der eigenen Ø-Auslastung, keine Garantie.</div>`;
}
function computeSlots(shop, date, duration, taken){
  const h = hoursFor(shop, date); if (!h) return null;
  const from = t2m(h.from), to = t2m(h.to), step = shop.slot_step || 30;
  const staffN = Math.max(1, (shop.staff||[]).length);
  const dk = dkey(date), isToday = dk === dkey(today());
  const minStart = isToday ? nowMin() + 30 : -1;
  const per = {};
  for (let si = 0; si < staffN; si++){
    const blocked = new Set(((shop.unavail||{})[String(si)]||{})[dk] || []);
    const mine = taken.filter(t => t.staff_index === si);
    const free = [];
    for (let t = from; t + duration <= to; t += step){
      if (t <= minStart) continue;
      let ok = true;
      for (let hh = Math.floor(t/60); hh < Math.ceil((t+duration)/60); hh++){ if (blocked.has(hh)) { ok = false; break; } }
      if (ok) for (const b of mine){ const bs = t2m(b.time), be = bs + b.duration; if (t < be && t + duration > bs){ ok = false; break; } }
      if (ok) free.push(m2t(t));
    }
    per[si] = free;
  }
  return per;
}
async function viewTime(){
  if (!B.shop || !B.service) return nav('home');
  const d = new Date(today()); d.setDate(d.getDate() + B.dayIdx);
  const back = (B.shop.staff||[]).length > 1 ? 'stylist' : 'shop/' + B.shop.id;
  const who = B.staff === 'any' ? ((B.shop.staff||[]).length > 1 ? 'Beliebiger Friseur' : '') : B.shop.staff[+B.staff].name;
  app.innerHTML = topbar('Termin wählen', back) + `<div class="view">
    <div class="daynav"><div class="arrow ${B.dayIdx===0?'dis':''}" onclick="AF.day(-1)">‹</div><div class="lbl"><b>${DOW[d.getDay()]}</b><span>${d.getDate()}. ${MON[d.getMonth()]}${B.dayIdx===0?' · heute':''}</span></div><div class="arrow ${B.dayIdx>=13?'dis':''}" onclick="AF.day(1)">›</div></div>
    <div class="sec">Freie Uhrzeiten${who?' · '+esc(who):''}</div><div class="slots" id="slots"><div class="empty"><span class="spinner"></span> Lade …</div></div>
    <div class="summary" id="sum"><b>${esc(B.shop.name)}</b> · ${esc(B.service.name)} · ${B.service.duration} min<br>Wähle Tag &amp; Uhrzeit</div><div style="height:80px"></div></div>
    <div class="sticky"><div class="in"><button class="btn" id="toPay" disabled onclick="location.hash='#/pay'">Weiter zur Zahlung</button></div></div>`;
  try {
    const { data, error } = await sb.rpc('get_taken_slots', { p_shop: B.shop.id, p_date: dkey(d) });
    if (error) throw error;
    const per = computeSlots(B.shop, d, B.service.duration, data || []);
    const box = $('#slots');
    if (per === null){ box.innerHTML = '<div class="empty">🔒 Geschlossen an diesem Tag<br>Bitte einen anderen Tag wählen</div>'; return; }
    let times;
    if (B.staff === 'any'){ const set = new Set(); Object.values(per).forEach(a => a.forEach(t => set.add(t))); times = [...set].sort(); }
    else times = per[+B.staff] || [];
    if (!times.length){ box.innerHTML = '<div class="empty">📭 Keine freien Termine an diesem Tag<br>Schau beim nächsten Tag vorbei</div>'; return; }
    box.innerHTML = times.map(t => `<div class="opt" onclick="AF.pickTime('${t}')">${t}</div>`).join('');
    B._per = per; B._date = dkey(d);
  } catch(e){ $('#slots').innerHTML = `<div class="empty">Fehler: ${esc(errMsg(e))}</div>`; }
}
function day(n){ const x = B.dayIdx + n; if (x < 0 || x > 13) return; B.dayIdx = x; B.time = null; viewTime(); }
function pickTime(t){
  B.time = t;
  if (B.staff === 'any'){ B.staffIdx = Object.keys(B._per).map(Number).find(si => B._per[si].includes(t)); } else B.staffIdx = +B.staff;
  document.querySelectorAll('#slots .opt').forEach(el => el.classList.toggle('on', el.textContent === t));
  const d = fromKey(B._date);
  const sn = (B.shop.staff||[])[B.staffIdx]?.name;
  $('#sum').innerHTML = `<b>${esc(B.shop.name)}</b> · ${esc(B.service.name)} · ${B.service.duration} min<br>${fmtD(d)} · ${t} Uhr${sn && (B.shop.staff||[]).length>1 ? ' · bei ' + esc(sn) : ''}`;
  $('#toPay').disabled = false;
}

function viewPay(){
  if (!B.shop || !B.service || !B.time) return nav('home');
  const dep = Math.round(B.service.price * B.shop.deposit_pct) / 100;
  const rest = B.service.price - dep;
  const d = fromKey(B._date);
  app.innerHTML = topbar('Anzahlung', 'time') + `<div class="view">
    <div class="card"><div class="prow"><span>Barber</span><b>${esc(B.shop.name)}</b></div><div class="prow"><span>Service</span><b>${esc(B.service.name)}</b></div><div class="prow"><span>Termin</span><b>${fmtD(d)} · ${B.time}</b></div><div class="prow"><span>Gesamtpreis</span><b>${eur(B.service.price)}</b></div><div class="hr"></div>
    <div class="prow"><span>Anzahlung jetzt (${B.shop.deposit_pct} %)</span><span class="big">${eur(dep)}</span></div><div class="hr"></div><div class="prow"><span>Rest beim Barber</span><b>${eur(rest)}</b></div></div>
    <div class="lock">🔒 Die Anzahlung sichert deinen Termin und wird beim Besuch auf den Gesamtpreis angerechnet. Erscheint der Barber nicht, bekommst du sie vollständig zurück.</div>
    ${B.shop.stripe_charges_enabled ? '<div class="warnbox">💳 Nach der Reservierung wirst du zur sicheren Stripe-Zahlungsseite weitergeleitet. Deine Kartendaten laufen nie über AFROCUTS.</div>' : B.shop.payment_link ? '<div class="warnbox">💳 Nach der Reservierung öffnet sich die Zahlungsseite des Barbers für die Anzahlung.</div>' : C.TEST_MODE ? '<div class="warnbox">🧪 Testphase: Die Anzahlung wird jetzt noch nicht abgebucht — du zahlst sie beim Barber vor Ort. Der Termin ist trotzdem verbindlich reserviert.</div>' : ''}
    ${B.shop.type==='mobile' ? `<div class="sec">🚗 Deine Adresse für den Hausbesuch</div><input id="addr" placeholder="Straße, Hausnummer, PLZ, Etage">` : ''}
    <div class="sec">Deine Kontaktdaten</div>
    <label class="l">Name</label><input id="cname" placeholder="Vor- und Nachname" autocomplete="name">
    <label class="l">Handynummer oder E-Mail</label><input id="ccontact" placeholder="Für Rückfragen &amp; Bestätigung" autocomplete="tel">
    <div id="perr"></div><div style="height:90px"></div></div>
    <div class="sticky"><div class="in"><button class="btn" id="bookBtn" onclick="AF.book()">Termin verbindlich reservieren</button></div></div>`;
}
async function book(){
  const name = $('#cname').value.trim(), contact = $('#ccontact').value.trim(), addr = $('#addr') ? $('#addr').value.trim() : '';
  const perr = $('#perr'); perr.innerHTML = '';
  if (name.length < 2 || contact.length < 5){ perr.innerHTML = '<div class="err">Bitte Name und Kontakt angeben.</div>'; return; }
  if (B.shop.type === 'mobile' && addr.length < 5){ perr.innerHTML = '<div class="err">Bitte deine Adresse für den Hausbesuch angeben.</div>'; return; }
  const btn = $('#bookBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Reserviere …';
  try {
    const { data, error } = await sb.rpc('create_booking', { p_shop: B.shop.id, p_staff_index: B.staffIdx || 0, p_staff_name: (B.shop.staff||[])[B.staffIdx||0]?.name || '', p_service: B.service.name, p_duration: B.service.duration, p_price: B.service.price, p_date: B._date, p_time: B.time, p_name: name, p_contact: contact, p_address: addr });
    if (error) throw error;
    saveCode({ code: data.code, shop: B.shop.name, date: B._date, time: B.time });
    // Bevorzugt: echte Stripe-Zahlung, falls der Barber sein Konto verbunden hat
    if (B.shop.stripe_charges_enabled){
      try {
        btn.innerHTML = '<span class="spinner"></span> Weiter zur sicheren Zahlung …';
        const { url } = await callEdge('create-checkout-session', { booking_id: data.id, return_base: location.origin + location.pathname });
        window.location.href = url; return;
      } catch(stripeErr){ /* Fallback unten, falls Stripe-Aufruf scheitert */ }
    }
    if (data.payment_link){ window.open(data.payment_link, '_blank'); }
    nav('b/' + data.code + '?new=1');
  } catch(e){ perr.innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; btn.disabled = false; btn.textContent = 'Termin verbindlich reservieren'; }
}

// ---------- Meine Termine / Buchungsdetail ----------
function viewMy(){
  const codes = myCodes();
  app.innerHTML = topbar() + `<div class="view"><div class="h2">Meine Termine</div>
    ${codes.length ? codes.map(c => `<div class="card click" onclick="location.hash='#/b/${c.code}'"><div class="name">${esc(c.shop)}</div><div class="meta">${fmtD(fromKey(c.date))} · ${c.time} Uhr · Code ${c.code}</div></div>`).join('') : '<div class="card"><div class="meta">Noch keine Termine auf diesem Gerät. Nach einer Buchung erscheint sie hier — oder gib deinen Buchungscode ein:</div></div>'}
    <div class="sec">Buchung per Code öffnen</div><div class="row"><input id="ccode" placeholder="z. B. A1B2C3" style="text-transform:uppercase"><button class="btn small" onclick="location.hash='#/b/'+document.getElementById('ccode').value.trim().toUpperCase()">Öffnen</button></div>
    <div class="note">Tipp: Wenn du die App zum Homescreen hinzufügst, bleiben deine Termine hier gespeichert.</div></div>` + bottomNav('my');
}
const STATUS = { booked:['● Reserviert',''], checked_in:['✓ Eingecheckt',''], completed:['✓ Abgeschlossen',''], cancelled_customer:['Von dir storniert','red'], cancelled_barber:['Barber hat abgesagt','red'], no_show_barber:['Barber nicht erschienen','red'], no_show_customer:['Nicht erschienen','red'] };
async function viewBooking(code, isNew, justPaid){
  app.innerHTML = topbar('Deine Buchung', 'my') + '<div class="view"><span class="spinner"></span> Lade …</div>';
  try {
    const { data: b, error } = await sb.rpc('get_booking', { p_code: code });
    if (error) throw error; if (!b) throw new Error('Buchung nicht gefunden');
    const s = b.shop, d = fromKey(b.date), st = STATUS[b.status] || [b.status,''];
    const start = new Date(d); const [hh,mm] = b.time.split(':').map(Number); start.setHours(hh,mm,0,0);
    const now = new Date(); const winOpen = now >= new Date(start - 15*60000) && now <= new Date(start.getTime() + 60*60000);
    const canCheckin = b.status === 'booked' && winOpen;
    const canDispute = ['booked','no_show_barber'].includes(b.status) && now > start;
    app.innerHTML = topbar('Deine Buchung', 'my') + `<div class="view">
      ${isNew ? '<div class="check">✓</div><div class="center h2">Termin reserviert</div><div class="center note" style="margin-bottom:14px">Merk dir deinen Code — damit findest du die Buchung auf jedem Gerät wieder.</div>' : ''}
      ${justPaid && b.deposit_status!=='paid' ? '<div class="lock">✓ Zahlung eingegangen — wird gerade bestätigt. Das kann einen Moment dauern, lade die Seite bei Bedarf neu.</div>' : ''}
      <div class="card"><div class="row" style="justify-content:space-between"><span class="badge ${st[1]}">${st[0]}</span><span class="meta">Code <b style="color:var(--gold-l);letter-spacing:2px">${b.code}</b></span></div>
        <div class="name" style="margin-top:8px">${esc(s.name)}</div><div class="meta">${esc(b.service_name)} · ${fmtD(d)} · ${b.time} Uhr${b.staff_name ? ' · bei ' + esc(b.staff_name) : ''}</div>
        <div class="meta">${s.type==='mobile' ? '🚗 Barber kommt zu dir' : esc(s.address||'') + (s.address ? ` · <a href="${mapsLink(s)}" target="_blank">Karte</a>` : '')}${s.phone ? ' · <a href="tel:'+esc(s.phone)+'">Anrufen</a>' : ''}</div>
        <div class="hr"></div><div class="prow"><span>Anzahlung${b.deposit_status==='paid'?' (bezahlt ✓)':C.TEST_MODE?' (vor Ort)':''}</span><b>${eur(b.deposit_amount)}</b></div><div class="prow"><span>Gesamt</span><b>${eur(b.price)}</b></div>
        ${b.shop.payment_link && b.deposit_status==='pending' ? `<a class="btn small" style="display:inline-block;margin-top:8px;text-decoration:none" href="${esc(b.shop.payment_link)}" target="_blank">💳 Anzahlung jetzt zahlen</a>` : ''}
      </div>
      ${b.status==='booked' && s.type!=='mobile' ? `<div class="card"><div style="font-weight:700;margin-bottom:6px">📍 Vor Ort einchecken</div><div class="note" style="margin-top:0">Scanne den QR-Code an der Rezeption mit deiner Handy-Kamera — oder tippe den Shop-Code ein. Möglich ab 15 Minuten vor deinem Termin.</div>
        <div class="row" style="margin-top:10px"><input id="scode" placeholder="Shop-Code" style="text-transform:uppercase" ${canCheckin?'':'disabled'}><button class="btn small ${canCheckin?'':'sec2'}" ${canCheckin?'':'disabled'} onclick="AF.checkin('${b.code}')">Einchecken</button></div>
        ${!canCheckin ? `<div class="note">🔒 Check-in möglich ab ${pad(start.getHours())}:${pad(Math.max(0,start.getMinutes()-15))} Uhr am ${fmtD(d)}.</div>` : ''}<div id="cerr"></div></div>` : ''}
      ${b.status==='booked' && s.type==='mobile' ? `<div class="lock">🚗 Dein Barber kommt zu dir. Sobald er vor Ort ist, bestätigt er die Ankunft selbst in seiner App — du musst nichts einchecken. Halte dein Telefon bereit, falls er dich für die genaue Adresse anruft.</div>` : ''}
      ${b.status==='checked_in' ? '<div class="lock">✓ Eingecheckt — viel Spaß beim Termin. Deine Anzahlung wird nach dem Termin an den Barber freigegeben.</div>' : ''}
      ${b.status==='booked' && now < start ? `<button class="btn danger" onclick="AF.cancel('${b.code}')">Termin stornieren</button>` : ''}
      ${canDispute ? `<div class="sec">Problem?</div><div class="card click" onclick="AF.dispute('${b.code}','barber_absent')"><div style="font-weight:600">Der Barber war nicht da</div><div class="meta">Volle Erstattung der Anzahlung</div></div><div class="card click" onclick="AF.dispute('${b.code}','barber_cancelled')"><div style="font-weight:600">Der Barber hat abgesagt</div><div class="meta">Volle Erstattung der Anzahlung</div></div>` : ''}
      ${!['cancelled_customer','cancelled_barber'].includes(b.status) ? `<div class="sec">💬 Nachricht an ${esc(s.name)}</div>
        <div class="card"><div class="chat-box" id="chatBox"><div class="chat-empty"><span class="spinner"></span> Lade …</div></div>
        <div class="chat-input-row"><input id="chatIn" placeholder="Nachricht schreiben …" maxlength="1000"><button class="btn small" onclick="AF.sendChatCustomer('${b.code}')">Senden</button></div></div>` : ''}
      <div style="height:20px"></div></div>` + bottomNav('my');
    if (!myCodes().find(x => x.code === b.code)) saveCode({ code: b.code, shop: s.name, date: b.date, time: b.time });
    const pre = new URLSearchParams(location.search).get('c'); if (pre && $('#scode')) $('#scode').value = pre.toUpperCase();
    if (!['cancelled_customer','cancelled_barber'].includes(b.status)) loadChatCustomer(b.code);
    clearInterval(chatTimer);
    if (!['cancelled_customer','cancelled_barber'].includes(b.status)){
      chatTimer = setInterval(() => { if (document.activeElement?.id !== 'chatIn') loadChatCustomer(b.code); }, 12000);
    }
  } catch(e){ app.innerHTML = topbar('Deine Buchung', 'my') + `<div class="view"><div class="err">${esc(errMsg(e))}</div></div>` + bottomNav('my'); }
}
function renderChat(box, msgs, meRole){
  if (!msgs.length){ box.innerHTML = '<div class="chat-empty">Noch keine Nachrichten — schreib die erste.</div>'; return; }
  box.innerHTML = msgs.map(m => {
    const mine = m.sender === meRole;
    const t = new Date(m.created_at);
    return `<div class="bubble ${mine?'me':'them'}">${esc(m.body)}<span class="tm2">${mine ? 'Du' : (m.sender==='barber'?'Barber':'Kunde')} · ${pad(t.getHours())}:${pad(t.getMinutes())}</span></div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}
async function loadChatCustomer(code){
  const box = $('#chatBox'); if (!box) return;
  try { const { data, error } = await sb.rpc('get_messages_by_code', { p_code: code }); if (error) throw error; renderChat(box, data || [], 'customer'); }
  catch(e){ box.innerHTML = `<div class="chat-empty">${esc(errMsg(e))}</div>`; }
}
async function sendChatCustomer(code){
  const input = $('#chatIn'); const body = input.value.trim(); if (!body) return;
  input.disabled = true;
  try { const { error } = await sb.rpc('send_message_by_code', { p_code: code, p_body: body }); if (error) throw error; input.value = ''; await loadChatCustomer(code); }
  catch(e){ toast(errMsg(e), true); }
  input.disabled = false; input.focus();
}
async function checkin(code){
  const sc = $('#scode').value.trim().toUpperCase(); if (!sc){ toast('Bitte Shop-Code eingeben', true); return; }
  try { const { error } = await sb.rpc('checkin_booking', { p_code: code, p_shop_code: sc }); if (error) throw error; toast('✓ Eingecheckt!'); history.replaceState(null,'',location.pathname + location.hash); viewBooking(code); }
  catch(e){ $('#cerr').innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; }
}
async function cancel(code){
  if (!confirm('Termin wirklich stornieren?')) return;
  try { const { error } = await sb.rpc('cancel_booking', { p_code: code }); if (error) throw error; toast('Termin storniert'); viewBooking(code); } catch(e){ toast(errMsg(e), true); }
}
async function dispute(code, reason){
  const note = prompt('Kurz beschreiben (optional):') || '';
  try { const { error } = await sb.rpc('open_dispute', { p_code: code, p_reason: reason, p_note: note }); if (error) throw error; toast('Gemeldet — wir prüfen und erstatten bei Bestätigung'); } catch(e){ toast(errMsg(e), true); }
}

// =====================================================================
// BARBER (Login · Onboarding · Dashboard)
// =====================================================================
async function loadSession(){
  const { data } = await sb.auth.getSession(); session = data.session || null;
  isAdmin = false; myShop = null;
  if (session){
    try { const r = await sb.rpc('is_admin'); isAdmin = !!r.data; } catch {}
    const { data: s } = await sb.from('shops').select('*').eq('owner_id', session.user.id).maybeSingle();
    myShop = s || null;
  }
}
async function viewBarber(){
  if (!session){
    const errBox = authError ? `<div class="err">${esc(authError)}</div>` : '';
    app.innerHTML = topbar('Für Barber') + `<div class="view"><div class="hero"><div class="h1" style="font-size:24px">Werde AFROCUTS-Partner</div><p>Du bestimmst Kalender, Preise und Anzahlung. Kunden buchen verbindlich — weniger No-Shows.</p></div>
      ${errBox}
      <div class="card"><div style="font-weight:700;margin-bottom:4px">Neu hier? Konto erstellen</div>
      <div class="note" style="margin:0 0 8px">1. Registrieren → 2. Bestätigungs-Mail anklicken → 3. Hier anmelden und dein Profil anlegen.</div>
      <label class="l">E-Mail</label><input id="remail" type="email" placeholder="deine@email.de" autocomplete="email">
      <label class="l">Passwort wählen (mind. 6 Zeichen)</label><input id="rpw" type="password" placeholder="Passwort" autocomplete="new-password">
      <button class="btn" style="margin-top:12px" id="regBtn" onclick="AF.signUp()">Konto erstellen</button><div id="rerr"></div></div>
      <div class="card"><div style="font-weight:700;margin-bottom:8px">Schon registriert? Anmelden</div>
      <label class="l">E-Mail</label><input id="email" type="email" placeholder="deine@email.de" autocomplete="email">
      <label class="l">Passwort</label><input id="pw" type="password" placeholder="Dein Passwort" autocomplete="current-password">
      <button class="btn" style="margin-top:12px" id="pwBtn" onclick="AF.pwLogin()">Anmelden</button><div id="oerr"></div></div>
      <div class="note">Status: <b>nicht angemeldet</b> · ${APP_VERSION}</div></div>` + bottomNav('barber');
    return;
  }
  authError = null;
  if (!myShop) return viewOnboarding();
  return viewDash('today');
}
async function signUp(){
  const email = $('#remail').value.trim(), pw = $('#rpw').value;
  const box = $('#rerr'); box.innerHTML = '';
  if (!email.includes('@')){ box.innerHTML = '<div class="err">Bitte gültige E-Mail eingeben.</div>'; return; }
  if (pw.length < 6){ box.innerHTML = '<div class="err">Passwort braucht mindestens 6 Zeichen.</div>'; return; }
  const btn = $('#regBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Erstelle Konto …';
  try {
    const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
    if (data && data.user && data.user.identities && data.user.identities.length === 0){
      box.innerHTML = '<div class="err">Diese E-Mail ist bereits registriert — bitte unten anmelden (oder Passwort vergessen? Melde dich beim AFROCUTS-Team).</div>';
    } else if (data && data.session){
      // E-Mail-Bestätigung ist im Projekt deaktiviert -> direkt eingeloggt
      await loadSession(); toast('✓ Konto erstellt & angemeldet'); render(); return;
    } else {
      box.innerHTML = '<div class="lock">✓ Fast geschafft! Wir haben dir eine <b>Bestätigungs-Mail</b> geschickt (auch Spam prüfen). Klicke den Link darin — danach kannst du dich hier mit E-Mail + Passwort anmelden.</div>';
    }
  } catch(e){
    const m = errMsg(e);
    box.innerHTML = `<div class="err">${esc(m)}${String(m).toLowerCase().includes('rate limit') ? '<br><br>Zu viele Mails in kurzer Zeit — bitte in ca. 1 Stunde erneut versuchen.' : ''}</div>`;
  }
  btn.disabled = false; btn.textContent = 'Konto erstellen';
}
async function pwLogin(){
  const email = $('#email').value.trim(), pw = $('#pw').value;
  const box = $('#oerr'); box.innerHTML = '';
  if (!email.includes('@') || pw.length < 6){ box.innerHTML = '<div class="err">Bitte E-Mail und Passwort (mind. 6 Zeichen) eingeben.</div>'; return; }
  const btn = $('#pwBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Anmelden …';
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) throw error;
    await loadSession();
    toast('✓ Angemeldet');
    render();
  } catch(e){
    box.innerHTML = `<div class="err">${esc(errMsg(e))}${String(errMsg(e)).includes('Invalid login credentials') ? '<br><br>Hinweis: Der Zugang muss zuerst in Supabase angelegt sein (Authentication → Users → Add user → E-Mail + Passwort + „Auto Confirm User“ anhaken).' : ''}</div>`;
    btn.disabled = false; btn.textContent = 'Anmelden';
  }
}
async function sendLink(){
  const email = $('#email').value.trim(); if (!email.includes('@')) { toast('Bitte gültige E-Mail', true); return; }
  const btn = $('#otpBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sende …';
  const redirect = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  if (error){ $('#oerr').innerHTML = `<div class="err">${esc(error.message)}</div>`; btn.disabled = false; btn.textContent = 'Login-Link senden'; return; }
  $('#oerr').innerHTML = '<div class="lock">✓ Link gesendet — bitte Postfach (und Spam) prüfen. Diese Seite kannst du offen lassen.</div>';
}
async function logout(){ await sb.auth.signOut(); session = null; myShop = null; isAdmin = false; nav('home'); }

// ---------- Onboarding / Einstellungen (ein Formular) ----------
const DEF_HOURS = { '1':{open:true,from:'09:00',to:'19:00'}, '2':{open:true,from:'09:00',to:'19:00'}, '3':{open:true,from:'09:00',to:'19:00'}, '4':{open:true,from:'09:00',to:'20:00'}, '5':{open:true,from:'09:00',to:'20:00'}, '6':{open:true,from:'10:00',to:'16:00'}, '0':{open:false,from:'10:00',to:'14:00'} };
let F = null; // Formular-State
function viewOnboarding(edit){
  const s = myShop || {};
  F = { type: s.type||'shop', name: s.name||'', city: s.city||C.CITY_DEFAULT||'', address: s.address||'', area: s.area||'', phone: s.phone||'', instagram: s.instagram||'', tiktok: s.tiktok||'', whatsapp: s.whatsapp||'',
        specialties: s.specialties||['Fades'], services: s.services?.length ? JSON.parse(JSON.stringify(s.services)) : [{name:'Skin Fade + Linien',duration:45,price:19},{name:'Fade + Bart-Design',duration:60,price:27}],
        staff: s.staff ? JSON.parse(JSON.stringify(s.staff)) : [], hours: s.hours && Object.keys(s.hours).length ? JSON.parse(JSON.stringify(s.hours)) : JSON.parse(JSON.stringify(DEF_HOURS)),
        slot_step: s.slot_step||30, deposit_pct: s.deposit_pct||30, payment_link: s.payment_link||'', portfolio_image: s.portfolio_image||'' };
  renderForm(edit);
}
function renderForm(edit){
  const f = F;
  const hoursRows = [1,2,3,4,5,6,0].map(dw => { const h = f.hours[String(dw)]; return `<div class="dayrow"><div class="n">${DOW[dw]}</div><label class="sw"><input type="checkbox" ${h.open?'checked':''} onchange="AF.f('hours.${dw}.open',this.checked)"><span></span></label><div class="times ${h.open?'on':''}" id="tm${dw}"><input type="time" value="${h.from}" onchange="AF.f('hours.${dw}.from',this.value)"><span style="color:var(--muted)">–</span><input type="time" value="${h.to}" onchange="AF.f('hours.${dw}.to',this.value)"></div></div>`; }).join('');
  app.innerHTML = topbar(edit ? 'Shop bearbeiten' : 'Partner werden', edit ? 'barber' : null, edit ? '' : `<span class="pill" onclick="AF.logout()" style="cursor:pointer">Abmelden</span>`) + `<div class="view">
    ${!edit ? '<div class="note" style="margin-bottom:10px">Ein Formular, ca. 5 Minuten. Danach prüfen wir dein Profil und schalten dich frei.</div>' : ''}
    <label class="l">Wie arbeitest du?</label><div class="grid2"><div class="opt ${f.type==='shop'?'on':''}" onclick="AF.f('type','shop');AF.rf()">🏠 Laden mit Adresse</div><div class="opt ${f.type==='mobile'?'on':''}" onclick="AF.f('type','mobile');AF.rf()">🚗 Freelancer, kein Laden</div></div>
    <label class="l">Name (Shop oder Künstlername)</label><input value="${esc(f.name)}" oninput="AF.f('name',this.value)" placeholder="z. B. Kwame's Fade Studio">
    <label class="l">Stadt</label><input value="${esc(f.city)}" oninput="AF.f('city',this.value)">
    ${f.type==='shop' ? `<label class="l">Adresse</label><input value="${esc(f.address)}" oninput="AF.f('address',this.value)" placeholder="Straße Nr., PLZ">` : `<label class="l">Stadtgebiet, das du bedienst</label><input value="${esc(f.area)}" oninput="AF.f('area',this.value)" placeholder="z. B. Kreuzberg, Neukölln"><div class="chips" style="margin-top:8px">${AREAS.map(a=>`<span class="chip" onclick="AF.addArea('${a}')">${a}</span>`).join('')}</div><div class="note">Kunden geben beim Buchen ihre eigene Adresse an. Du bringst dein Equipment mit.</div>`}
    <label class="l">Telefon</label><input value="${esc(f.phone)}" oninput="AF.f('phone',this.value)" placeholder="+49 …">
    <div class="grid3" style="margin-top:12px"><div><label class="l">Instagram</label><input value="${esc(f.instagram)}" oninput="AF.f('instagram',this.value)" placeholder="@name"></div><div><label class="l">TikTok</label><input value="${esc(f.tiktok)}" oninput="AF.f('tiktok',this.value)" placeholder="@name"></div><div><label class="l">WhatsApp</label><input value="${esc(f.whatsapp)}" oninput="AF.f('whatsapp',this.value)" placeholder="+49…"></div></div>
    <label class="l">Spezialisierung</label><div class="chips">${SPECIALTIES.map(x=>`<span class="chip ${f.specialties.includes(x)?'on':''}" onclick="AF.togSpec('${x}')">${x}</span>`).join('')}</div>
    <label class="l">Dein bestes Foto (Link, optional)</label><input value="${esc(f.portfolio_image)}" oninput="AF.f('portfolio_image',this.value)" placeholder="Link zu deinem besten Vorher-Nachher-Foto, z. B. von Instagram">
    ${f.portfolio_image ? `<div class="pf-preview"><img src="${esc(f.portfolio_image)}" onerror="this.parentElement.style.display='none'"></div>` : ''}
    <div class="note" style="margin-top:6px">Erscheint groß auf der Startseite — dein bester Look überzeugt mehr als jeder Text.</div>

    <div class="sec">Services (Name · Minuten · €)</div><div id="svcRows">${f.services.map((v,i)=>`<div class="rowline"><input value="${esc(v.name)}" oninput="AF.sv(${i},'name',this.value)" placeholder="Service"><input type="number" value="${v.duration}" style="flex:0 0 62px" oninput="AF.sv(${i},'duration',+this.value)"><input type="number" value="${v.price}" style="flex:0 0 62px" oninput="AF.sv(${i},'price',+this.value)"><span class="x" onclick="AF.rmSv(${i})">✕</span></div>`).join('')}</div><button class="btn sec2 small" onclick="AF.addSv()">+ Service</button>

    <div class="sec">Team</div><div class="note" style="margin:0 0 8px">Arbeiten mehrere Friseure bei dir? Trag sie ein — Kunden können dann gezielt buchen und ihr habt parallele Termine. Solo? Einfach leer lassen.</div>
    <div id="staffRows">${f.staff.map((v,i)=>`<div class="rowline"><input value="${esc(v.name)}" oninput="AF.st(${i},this.value)" placeholder="Name"><span class="x" onclick="AF.rmSt(${i})">✕</span></div>`).join('')}</div><button class="btn sec2 small" onclick="AF.addSt()">+ Friseur</button>

    <div class="sec">Öffnungszeiten</div><div class="card" style="padding:4px 14px">${hoursRows}</div>
    <label class="l">Termintakt</label><select onchange="AF.f('slot_step',+this.value)">${[15,30,45,60].map(v=>`<option value="${v}" ${f.slot_step===v?'selected':''}>Alle ${v} Minuten</option>`).join('')}</select>

    <div class="sec">Anzahlung</div><div class="grid3">${[20,30,50].map(v=>`<div class="opt ${f.deposit_pct===v?'on':''}" onclick="AF.f('deposit_pct',${v});AF.rf()">${v} %</div>`).join('')}</div>
    <div class="note">Kunden zahlen diesen Anteil bei der Buchung, der Rest bei dir. Weniger No-Shows.</div>
    <label class="l">Zahlungslink für die Anzahlung (optional, Testphase)</label><input value="${esc(f.payment_link)}" oninput="AF.f('payment_link',this.value)" placeholder="https://buy.stripe.com/… oder PayPal.me-Link">
    <div class="note">Ohne Link wird die Anzahlung in der Testphase vor Ort kassiert. Mit Link öffnet sich nach der Buchung deine Zahlungsseite.</div>
    <div id="ferr"></div><div style="height:90px"></div></div>
    <div class="sticky"><div class="in"><button class="btn" id="saveBtn" onclick="AF.saveShop(${edit?'true':'false'})">${edit ? 'Speichern' : 'Antrag einreichen'}</button></div></div>`;
}
function fset(path, val){ const p = path.split('.'); let o = F; while (p.length > 1){ const k = p.shift(); o[k] = o[k] || {}; o = o[k]; } o[p[0]] = val; if (path.startsWith('hours.') && path.endsWith('.open')){ const dw = path.split('.')[1]; const el = $('#tm'+dw); if (el) el.classList.toggle('on', val); } }
function rf(){ renderForm(!!myShop); }
function togSpec(x){ const i = F.specialties.indexOf(x); if (i>=0) F.specialties.splice(i,1); else F.specialties.push(x); rf(); }
function addArea(a){ const cur = F.area.split(',').map(x=>x.trim()).filter(Boolean); if (!cur.includes(a)) cur.push(a); F.area = cur.join(', '); rf(); }
function sv(i,k,v){ F.services[i][k] = v; } function addSv(){ F.services.push({name:'',duration:30,price:20}); rf(); } function rmSv(i){ F.services.splice(i,1); rf(); }
function st(i,v){ F.staff[i].name = v; } function addSt(){ F.staff.push({name:''}); rf(); } function rmSt(i){ F.staff.splice(i,1); rf(); }
async function saveShop(edit){
  const f = F, e = $('#ferr'); e.innerHTML = '';
  if (f.name.trim().length < 2) return e.innerHTML = '<div class="err">Bitte einen Namen angeben.</div>';
  if (f.type==='shop' && f.address.trim().length < 4) return e.innerHTML = '<div class="err">Bitte eine Adresse angeben.</div>';
  const services = f.services.filter(x => x.name.trim() && x.duration > 0 && x.price >= 0);
  if (!services.length) return e.innerHTML = '<div class="err">Mindestens ein Service mit Dauer und Preis.</div>';
  const staff = f.staff.filter(x => x.name.trim());
  const row = { owner_id: session.user.id, owner_email: session.user.email, type: f.type, name: f.name.trim(), city: f.city.trim(), address: f.type==='shop'?f.address.trim():'', area: f.type==='mobile'?f.area.trim():'', phone: f.phone.trim(), instagram: f.instagram.trim(), tiktok: f.tiktok.trim(), whatsapp: f.whatsapp.trim(), specialties: f.specialties, services, staff, hours: f.hours, slot_step: f.slot_step, deposit_pct: f.deposit_pct, payment_link: f.payment_link.trim(), portfolio_image: f.portfolio_image.trim() };
  const btn = $('#saveBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Speichere …';
  try {
    if (edit){ const { error } = await sb.from('shops').update(row).eq('id', myShop.id); if (error) throw error; }
    else { const { error } = await sb.from('shops').insert(row); if (error) throw error; }
    await loadSession(); toast(edit ? '✓ Gespeichert' : '✓ Antrag eingereicht'); nav('barber');
  } catch(err){ e.innerHTML = `<div class="err">${esc(errMsg(err))}</div>`; btn.disabled = false; btn.textContent = edit ? 'Speichern' : 'Antrag einreichen'; }
}

// ---------- Dashboard ----------
let dashDate = dkey(today());
async function viewDash(tab){
  const s = myShop;
  const tabs = ['today','avail','stats','code','more'].map(k => `<div class="it ${tab===k?'on':''}" onclick="AF.dash('${k}')"><div>${{today:'📊',avail:'🗓️',stats:'📈',code:'🔳',more:'⚙️'}[k]}</div>${{today:'Termine',avail:'Verfügbarkeit',stats:'Auswertung',code:'Shop-Code',more:'Mehr'}[k]}</div>`).join('');
  const navHtml = `<div class="nav"><div class="in">${tabs}</div></div>`;
  const statusBar = s.status !== 'approved' ? `<div class="warnbox">${s.status==='pending' ? '⏳ Dein Profil wird geprüft. Sobald es freigegeben ist, können Kunden buchen — du kannst schon alles einrichten.' : s.status==='rejected' ? '✕ Dein Antrag wurde abgelehnt. Bitte melde dich beim AFROCUTS-Team.' : '⏸ Dein Shop ist pausiert.'}</div>` : '';
  if (tab === 'today') return dashToday(statusBar, navHtml);
  if (tab === 'avail') return dashAvail(statusBar, navHtml);
  if (tab === 'stats') return dashStats(statusBar, navHtml);
  if (tab === 'code') return dashCode(navHtml);
  if (tab === 'more') return dashMore(navHtml);
}
async function dashToday(statusBar, navHtml){
  const s = myShop, d = fromKey(dashDate);
  app.innerHTML = topbar('', null, `<span class="pill">${esc(s.name)}</span>`) + `<div class="view">${statusBar}
    <div class="daynav"><div class="arrow" onclick="AF.dday(-1)">‹</div><div class="lbl"><b>${DOW[d.getDay()]}</b><span>${d.getDate()}. ${MON[d.getMonth()]}${dashDate===dkey(today())?' · heute':''}</span></div><div class="arrow" onclick="AF.dday(1)">›</div></div>
    <div id="bl"><span class="spinner"></span> Lade …</div>${isAdmin ? '<div class="sec">Admin</div><button class="btn sec2" onclick="location.hash=\'#/admin\'">🛡️ App-Manager öffnen</button>' : ''}<div style="height:20px"></div></div>` + navHtml;
  try {
    const { data, error } = await sb.from('bookings').select('*').eq('shop_id', s.id).eq('date', dashDate).order('time');
    if (error) throw error;
    const list = data || [];
    const stats = `<div class="stat"><div class="s"><div class="v">${list.filter(b=>!b.status.startsWith('cancelled')).length}</div><div class="k">Termine</div></div><div class="s"><div class="v">${list.filter(b=>b.status==='booked').length}</div><div class="k">Noch offen</div></div><div class="s"><div class="v">${eur(list.filter(b=>['checked_in','completed'].includes(b.status)).reduce((a,b)=>a+Number(b.price),0))}</div><div class="k">Umsatz</div></div></div>`;
    const cards = list.length ? list.map(b => {
      const st = STATUS[b.status] || [b.status,''];
      const arriveBtn = (myShop.type === 'mobile' && b.status === 'booked') ? `<button class="btn small ok" onclick="AF.arrived('${b.id}')">📍 Ich bin vor Ort angekommen</button>` : '';
      const acts = b.status==='booked' ? `${arriveBtn}<button class="btn small ${myShop.type==='mobile'?'sec2':'ok'}" onclick="AF.setStatus('${b.id}','checked_in')">✓ Kunde ist da</button><button class="btn small sec2" onclick="AF.setStatus('${b.id}','no_show_customer')">Nicht erschienen</button><button class="btn small danger" onclick="AF.setStatus('${b.id}','cancelled_barber')">Ich muss absagen</button>` : b.status==='checked_in' ? `<button class="btn small ok" onclick="AF.setStatus('${b.id}','completed')">Termin abgeschlossen</button>` : '';
      const dep = b.deposit_status==='paid' ? '<span class="badge">Anzahlung ✓</span>' : (b.status==='booked'||b.status==='checked_in') ? `<button class="btn small sec2" onclick="AF.depPaid('${b.id}')">Anzahlung ${eur(b.deposit_amount)} erhalten</button>` : '';
      const chatBtn = !['cancelled_customer','cancelled_barber'].includes(b.status) ? `<button class="btn small sec2" onclick="location.hash='#/bchat/${b.id}'">💬 Chat</button>` : '';
      return `<div class="bk"><div class="top"><div><span class="tm">${b.time}</span> <span class="badge ${st[1]}">${st[0]}</span><div style="font-weight:700;margin-top:4px">${esc(b.customer_name)}</div><div class="meta">${esc(b.service_name)} · ${b.duration} min · ${eur(b.price)}${b.staff_name?' · '+esc(b.staff_name):''}</div><div class="meta">📞 <a href="tel:${esc(b.customer_contact)}">${esc(b.customer_contact)}</a>${b.customer_address?' · 🏠 '+esc(b.customer_address):''}</div></div></div><div class="acts">${acts}${dep}${chatBtn}</div></div>`;
    }).join('') : '<div class="card"><div class="meta">Keine Buchungen an diesem Tag.</div></div>';
    const hint = myShop.type === 'mobile'
      ? '<div class="note">Als Freelancer bestätigst du selbst mit „Ich bin vor Ort angekommen“, sobald du beim Kunden bist — fairer als ein QR-Scan durch den Kunden.</div>'
      : '<div class="note">Kunden checken normalerweise selbst per Shop-Code ein — „Kunde ist da“ ist der Fallback, falls es nicht klappt.</div>';
    $('#bl').innerHTML = stats + '<div class="sec">Buchungen</div>' + cards + hint;
  } catch(e){ $('#bl').innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; }
}
function dday(n){ const d = fromKey(dashDate); d.setDate(d.getDate()+n); dashDate = dkey(d); viewDash('today'); }
async function setStatus(id, status){
  if (status==='cancelled_barber' && !confirm('Wirklich absagen? Der Kunde wird informiert und bekommt die Anzahlung zurück.')) return;
  const patch = { status }; if (status==='checked_in') patch.checked_in_at = new Date().toISOString();
  const { error } = await sb.from('bookings').update(patch).eq('id', id); if (error) return toast(errMsg(error), true); toast('✓ Aktualisiert'); viewDash('today');
}
async function depPaid(id){ const { error } = await sb.from('bookings').update({ deposit_status:'paid' }).eq('id', id); if (error) return toast(errMsg(error), true); toast('✓ Anzahlung vermerkt'); viewDash('today'); }
async function arrived(id){
  if (!confirm('Bestätigen, dass du beim Kunden vor Ort angekommen bist? Der Termin gilt dann als begonnen.')) return;
  try { const { error } = await sb.rpc('barber_arrived', { p_booking: id }); if (error) throw error; toast('✓ Ankunft bestätigt'); viewDash('today'); }
  catch(e){ toast(errMsg(e), true); }
}

// ---------- Auswertung (eigene Termine & Umsatz, analog Betreiber-Cockpit) ----------
let statsRange = 'month', statsFilter = '';
function statsInRange(dateStr){
  const d = fromKey(dateStr), t = today();
  if (statsRange === 'today') return dateStr === dkey(t);
  if (statsRange === 'week'){ const wk = new Date(t); wk.setDate(t.getDate()-6); return d >= wk && d <= t; }
  if (statsRange === 'month'){ const mk = new Date(t); mk.setDate(t.getDate()-29); return d >= mk && d <= t; }
  return true;
}
function statsSetRange(k){ statsRange = k; viewDash('stats'); }
function statsSearch(v){ statsFilter = v; viewDash('stats'); }
async function dashStats(statusBar, navHtml){
  const s = myShop;
  app.innerHTML = topbar('Auswertung') + `<div class="view">${statusBar}<div id="statsBody"><span class="spinner"></span> Lade …</div><div style="height:20px"></div></div>` + navHtml;
  try {
    const { data, error } = await sb.from('bookings').select('*').eq('shop_id', s.id).order('date', { ascending: false }).order('time', { ascending: false });
    if (error) throw error;
    const all = data || [];
    const inr = all.filter(b => statsInRange(b.date));
    const revenue = inr.filter(b => ['checked_in','completed'].includes(b.status)).reduce((a,b) => a + Number(b.price), 0);
    const deposits = inr.filter(b => b.deposit_status === 'paid').reduce((a,b) => a + Number(b.deposit_amount), 0);
    const active = inr.filter(b => !b.status.startsWith('cancelled')).length;
    const noShows = inr.filter(b => b.status === 'no_show_customer').length;
    const rangeSwitch = `<div class="chips" style="margin-bottom:10px">${[['today','Heute'],['week','7 Tage'],['month','30 Tage'],['all','Gesamt']].map(([k,l]) => `<span class="chip ${statsRange===k?'on':''}" onclick="AF.statsRange('${k}')">${l}</span>`).join('')}</div>`;
    const stat = `<div class="stat"><div class="s"><div class="v">${active}</div><div class="k">Termine</div></div><div class="s"><div class="v">${eur(revenue)}</div><div class="k">Umsatz</div></div><div class="s"><div class="v">${eur(deposits)}</div><div class="k">Anzahlungen erh.</div></div></div>
      <div class="stat" style="margin-top:10px"><div class="s"><div class="v">${noShows}</div><div class="k">Kunden-No-Shows</div></div><div class="s"><div class="v">${inr.length ? Math.round(active/inr.length*100) : 0}%</div><div class="k">Quote wahrgenommen</div></div></div>
      ${missedRevenueBox(missedRevenueEstimate(s, all, statsRange))}`;
    let list = inr;
    const f = statsFilter.toLowerCase();
    if (f) list = list.filter(b => (b.customer_name||'').toLowerCase().includes(f) || (b.service_name||'').toLowerCase().includes(f) || (b.date||'').includes(f));
    const rows = list.length ? list.slice(0,150).map(b => {
      const st = STATUS[b.status] || [b.status,''];
      return `<div class="bk"><div class="top"><div><span class="tm">${b.date} · ${b.time}</span><div style="font-weight:700;margin-top:3px">${esc(b.customer_name)}</div><div class="meta">${esc(b.service_name)} · ${eur(b.price)} · Anzahlung ${eur(b.deposit_amount)} (${b.deposit_status==='paid'?'bezahlt':b.deposit_status==='refunded'?'erstattet':'offen'})</div></div><span class="badge ${st[1]}">${st[0]}</span></div></div>`;
    }).join('') : '<div class="note">Keine Vorgänge im gewählten Zeitraum/Filter.</div>';
    $('#statsBody').innerHTML = rangeSwitch + stat +
      `<div class="sec">Vorgänge (${list.length})</div><input placeholder="🔎 Suche: Kunde, Service, Datum …" value="${esc(statsFilter)}" oninput="AF.statsSearch(this.value)" style="margin-bottom:10px">` + rows +
      '<div class="note">Umsatz zählt Termine, die eingecheckt oder abgeschlossen sind. Provision an AFROCUTS ist hier nicht abgezogen.</div>';
  } catch(e){ $('#statsBody').innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; }
}

// ---------- Verfügbarkeit (nächste 5 Tage × Friseur × Stunde) ----------
let avIdx = 0;
async function dashAvail(statusBar, navHtml){
  const s = myShop; const staff = s.staff?.length ? s.staff : [{name:'Ich'}];
  const dates = [0,1,2,3,4].map(i => { const d = today(); d.setDate(d.getDate()+i); return d; });
  const cover = dates.map(d => { const h = hoursFor(s, d); if (!h) return false; const dk = dkey(d); const from = t2m(h.from)/60, to = t2m(h.to)/60; for (let si=0; si<staff.length; si++){ const bl = new Set(((s.unavail||{})[String(si)]||{})[dk]||[]); for (let hh=Math.floor(from); hh<Math.ceil(to); hh++) if (!bl.has(hh)) return true; } return false; });
  const d = dates[avIdx], h = hoursFor(s, d), dk = dkey(d);
  // Belegte Stunden aus echten Buchungen dieses Tages laden: {staffIndex: {hour: kundenName}}
  let busy = {};
  try {
    const { data } = await sb.from('bookings').select('staff_index,time,duration,customer_name,status').eq('shop_id', s.id).eq('date', dk).in('status', ['booked','checked_in','completed']);
    (data||[]).forEach(b => { const si = b.staff_index||0; const st = t2m(b.time), en = st + b.duration; busy[si] = busy[si]||{}; for (let hh = Math.floor(st/60); hh < Math.ceil(en/60); hh++){ busy[si][hh] = b.customer_name; } });
  } catch(e){}
  let grid = '';
  if (!h) grid = '<div class="warnbox">🔔 Der Shop ist an diesem Tag geschlossen (Öffnungszeiten) — Kunden können nichts buchen.</div>';
  else {
    const hrs = []; for (let hh = Math.floor(t2m(h.from)/60); hh < Math.ceil(t2m(h.to)/60); hh++) hrs.push(hh);
    const isOff = si => hrs.every(hh => (((s.unavail||{})[String(si)]||{})[dk]||[]).includes(hh));
    grid = (!cover[avIdx] ? '<div class="warnbox">🔔 Für diesen Tag ist niemand aus deinem Team eingetragen — Kunden können nichts buchen. Tippe Stunden an, um sie freizugeben.</div>' : '') +
      `<div class="avail"><div class="h"><div></div>${staff.map((x,si)=>`<div onclick="AF.togDay(${si},'${dk}',${hrs.join('_')?'['+hrs.join(',')+']':'[]'})">${esc(x.name)}${isOff(si)?'<span class="off">FREI</span>':''}</div>`).join('')}</div>` +
      hrs.map(hh => { const anyBusy = staff.some((x,si)=>busy[si] && busy[si][hh]); return `<div class="r ${anyBusy?'busyrow':''}"><div class="t">${pad(hh)}:00</div>${staff.map((x,si)=>{ const off = (((s.unavail||{})[String(si)]||{})[dk]||[]).includes(hh); const who = busy[si] && busy[si][hh]; return `<div class="c">${who ? `<div><div class="dot2 busy" title="${esc(who)}"></div><div class="availbk">${esc(who.split(' ')[0])}</div></div>` : `<div class="dot2 ${off?'off':''}" onclick="AF.togHour(${si},'${dk}',${hh})"></div>`}</div>`; }).join('')}</div>`; }).join('') + '</div>' +
      '<div class="legend"><span><i style="background:var(--gold)"></i>Frei</span><span><i class="busy"></i>Gebucht</span><span><i style="background:var(--surface-2);border:1px solid var(--line)"></i>Gesperrt</span></div>';
  }
  app.innerHTML = topbar('Verfügbarkeit') + `<div class="view">${statusBar}<div class="note" style="margin:0 0 10px">Rot = bereits gebuchter Termin (mit Kundenname). Tippe eine freie Stunde an, um sie zu sperren — oder den Namen oben, um den ganzen Tag freizustellen (Urlaub/Ausfall).</div>
    <div class="tabs">${dates.map((x,i)=>`<div class="tab ${i===avIdx?'on':''} ${!hoursFor(s,x)?'closed':''}" onclick="AF.avTab(${i})">${DOW2[x.getDay()]}<span class="d">${x.getDate()}.${x.getMonth()+1}.</span>${!cover[i]?'<span class="dot"></span>':''}</div>`).join('')}</div>${grid}
    <div class="note">Gebuchte Stunden (rot) kannst du nicht sperren — falls nötig, sag den Termin im Tab „Termine“ ab.</div><div style="height:20px"></div></div>` + navHtml;
}
function avTab(i){ avIdx = i; viewDash('avail'); }
async function saveUnavail(){ const { error } = await sb.from('shops').update({ unavail: myShop.unavail }).eq('id', myShop.id); if (error) toast(errMsg(error), true); }
function togHour(si, dk, hh){ const u = myShop.unavail = myShop.unavail || {}; u[si] = u[si] || {}; const arr = u[si][dk] = u[si][dk] || []; const i = arr.indexOf(hh); if (i>=0) arr.splice(i,1); else arr.push(hh); saveUnavail(); viewDash('avail'); }
function togDay(si, dk, hrs){ const u = myShop.unavail = myShop.unavail || {}; u[si] = u[si] || {}; const cur = u[si][dk] || []; const allOff = hrs.every(h => cur.includes(h)); u[si][dk] = allOff ? [] : [...hrs]; saveUnavail(); viewDash('avail'); }

// ---------- Shop-Code / QR ----------
function dashCode(navHtml){
  const s = myShop; const url = location.origin + location.pathname + '?c=' + s.shop_code + '#/my';
  const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=1&data=' + encodeURIComponent(url);
  app.innerHTML = topbar('Dein Shop-Code') + `<div class="view printsheet"><div class="center noprint note">${s.type==='mobile' ? '📱 Als Freelancer zeigst du diesen Code beim Kunden auf dem Handy — der Kunde scannt ihn bei deiner Ankunft.' : '🖨️ Ausdrucken und gut sichtbar an Rezeption oder Eingang platzieren. Kunden scannen ihn beim Betreten mit der Handy-Kamera.'}</div>
    <div class="center" style="display:none" id="pt"><h1 style="font-size:28px;margin:0 0 6px">AFROCUTS</h1><p>Zum Einchecken diesen Code mit der Handy-Kamera scannen</p></div>
    <img class="qr" src="${qr}" alt="QR"><div class="code">${s.shop_code}</div><div class="center meta">${esc(s.name)}</div>
    <div class="note center noprint" style="margin-top:14px">Alternativ tippt der Kunde den Code <b>${s.shop_code}</b> in seiner Buchung ein. Check-in ist ab 15 Min. vor Termin möglich.</div>
    <div class="noprint" style="margin-top:16px"><button class="btn sec2" onclick="document.getElementById('pt').style.display='block';window.print()">🖨️ Drucken / als PDF sichern</button></div><div style="height:20px"></div></div>` + navHtml;
}
function dashMore(navHtml){
  const s = myShop;
  const stripeCard = s.stripe_charges_enabled
    ? `<div class="card"><div class="name">💳 Zahlungen (Stripe)</div><div class="meta">✓ Aktiv — Anzahlungen werden automatisch aufgeteilt, dein Anteil geht direkt an dein Stripe-Konto</div></div>`
    : `<div class="card click" onclick="AF.connectStripe()"><div class="name">💳 Zahlungen einrichten</div><div class="meta">${s.stripe_account_id ? 'Onboarding bei Stripe noch nicht abgeschlossen — hier weitermachen' : 'Verbinde dein Stripe-Konto, damit Anzahlungen automatisch bei dir ankommen'}</div><div id="stripeErr"></div></div>`;
  app.innerHTML = topbar('Mehr') + `<div class="view">
    <div class="card click" onclick="AF.editShop()"><div class="name">Shop bearbeiten</div><div class="meta">Services, Team, Öffnungszeiten, Anzahlung, Zahlungslink</div></div>
    ${stripeCard}
    <div class="card"><div class="name">Dein Kundenlink</div><div class="meta" style="word-break:break-all">${location.origin + location.pathname}#/shop/${s.id}</div><button class="btn small sec2" style="margin-top:8px" onclick="navigator.clipboard&&navigator.clipboard.writeText('${location.origin + location.pathname}#/shop/${s.id}').then(()=>AF.toast('Link kopiert'))">Link kopieren</button><div class="note">Für deine Instagram-/TikTok-Bio. Kunden landen direkt bei dir.</div></div>
    <div class="card click" onclick="window.open('${location.origin + location.pathname}#/display/${s.id}','_blank')"><div class="name">📺 TV-/Wartebereich-Anzeige</div><div class="meta">Zeigt Laufkundschaft, wer heute frei/belegt ist — ohne Kundendaten. Ideal für einen Bildschirm im Laden.</div></div>
    <div class="card"><div class="name">Status</div><div class="meta">${s.status==='approved'?'✓ Freigegeben — Kunden können buchen':s.status==='pending'?'⏳ In Prüfung':s.status}</div><div class="meta">Anzahlung: ${s.deposit_pct} % · Termintakt: ${s.slot_step} min · ${s.staff?.length||0} Team-Mitglieder</div></div>
    ${isAdmin ? '<button class="btn sec2" onclick="location.hash=\'#/admin\'">🛡️ App-Manager</button>' : ''}
    <button class="btn sec2" style="margin-top:8px" onclick="AF.logout()">Abmelden</button>
    <div class="note center" style="margin-top:14px">Angemeldet als ${esc(session.user.email)}</div><div style="height:20px"></div></div>` + navHtml;
}
async function viewBarberChat(bookingId){
  if (!session) return nav('barber');
  app.innerHTML = topbar('Chat', 'barber') + '<div class="view"><span class="spinner"></span> Lade …</div>';
  try {
    const { data: b, error: bErr } = await sb.from('bookings').select('*').eq('id', bookingId).single();
    if (bErr) throw bErr;
    app.innerHTML = topbar('Chat mit ' + b.customer_name, 'barber') + `<div class="view">
      <div class="card"><div class="meta">${esc(b.service_name)} · ${b.date} · ${b.time} Uhr</div></div>
      <div class="card"><div class="chat-box" id="chatBox"><div class="chat-empty"><span class="spinner"></span> Lade …</div></div>
      <div class="chat-input-row"><input id="chatIn" placeholder="Nachricht schreiben …" maxlength="1000"><button class="btn small" onclick="AF.sendChatBarber('${bookingId}')">Senden</button></div></div>
      <div style="height:20px"></div></div>`;
    await loadChatBarber(bookingId);
    clearInterval(chatTimer);
    chatTimer = setInterval(() => { if (document.activeElement?.id !== 'chatIn') loadChatBarber(bookingId); }, 12000);
  } catch(e){ app.innerHTML = topbar('Chat', 'barber') + `<div class="view"><div class="err">${esc(errMsg(e))}</div></div>`; }
}
async function loadChatBarber(bookingId){
  const box = $('#chatBox'); if (!box) return;
  try { const { data, error } = await sb.from('messages').select('*').eq('booking_id', bookingId).order('created_at'); if (error) throw error; renderChat(box, data || [], 'barber'); }
  catch(e){ box.innerHTML = `<div class="chat-empty">${esc(errMsg(e))}</div>`; }
}
async function sendChatBarber(bookingId){
  const input = $('#chatIn'); const body = input.value.trim(); if (!body) return;
  input.disabled = true;
  try { const { error } = await sb.from('messages').insert({ booking_id: bookingId, sender: 'barber', body }); if (error) throw error; input.value = ''; await loadChatBarber(bookingId); }
  catch(e){ toast(errMsg(e), true); }
  input.disabled = false; input.focus();
}

function editShop(){ viewOnboarding(true); }
async function connectStripe(){
  const box = document.getElementById('stripeErr');
  try {
    const { url } = await callEdge('connect-onboarding', { return_base: location.origin + location.pathname }, true);
    window.location.href = url;
  } catch(e){ if (box) box.innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; else toast(errMsg(e), true); }
}

// =====================================================================
// SHOP-DISPLAY (öffentliche TV-/Wartebereich-Anzeige, kein Login nötig)
// =====================================================================
let displayTimer = null, chatTimer = null;
async function viewDisplay(shopId){
  clearInterval(displayTimer);
  document.body.classList.add('disp-body');
  app.innerHTML = '<div class="view center" style="padding-top:80px"><span class="spinner"></span> Lade …</div>';
  try {
    const s = await getShop(shopId);
    const staff = s.staff?.length ? s.staff : [{ name: s.type === 'mobile' ? s.name : 'Heute' }];
    const d = today(), dk = dkey(d);
    const h = hoursFor(s, d);
    const { data: taken, error } = await sb.rpc('get_taken_slots', { p_shop: s.id, p_date: dk });
    if (error) throw error;
    const nowM = nowMin();

    let bodyHtml = '';
    if (!h){
      bodyHtml = `<div class="disp-full"><div class="t1">🔒 Heute geschlossen</div><div class="t2">${esc(s.name)} hat heute Ruhetag</div></div>`;
    } else {
      const fromH = Math.floor(t2m(h.from)/60), toH = Math.ceil(t2m(h.to)/60);
      const hrs = []; for (let hh = fromH; hh < toH; hh++) hrs.push(hh);
      const busyByStaff = staff.map((x,si) => {
        const mine = (taken||[]).filter(t => t.staff_index === si);
        return hrs.map(hh => mine.some(t => { const bs = t2m(t.time), be = bs + t.duration; return hh*60 < be && (hh+1)*60 > bs; }));
      });
      const remainingHrs = hrs.filter(hh => (hh+1)*60 > nowM);
      const allBusy = remainingHrs.length > 0 && remainingHrs.every(hh => staff.every((x,si) => busyByStaff[si][hrs.indexOf(hh)]));

      const cols = staff.length + 1;
      bodyHtml = `<div class="disp-grid" style="grid-template-columns:70px repeat(${staff.length},1fr)">
        <div></div>${staff.map(x=>`<div class="disp-col-head">${esc(x.name)}</div>`).join('')}
        ${hrs.map(hh => `<div class="disp-row" style="grid-template-columns:70px repeat(${staff.length},1fr);grid-column:1/-1;display:grid">
          <div class="disp-hour">${pad(hh)}:00</div>
          ${staff.map((x,si) => { const busy = busyByStaff[si][hrs.indexOf(hh)]; const past = (hh+1)*60 <= nowM; return `<div class="disp-cell ${past ? 'busy' : (busy?'busy':'free')}">${past ? '—' : (busy ? 'Belegt' : 'Frei')}</div>`; }).join('')}
        </div>`).join('')}
      </div>
      <div class="disp-legend"><span><i style="background:#22322b;border:1px solid #375247"></i>Frei</span><span><i style="background:#3a1f1c;border:1px solid var(--red)"></i>Belegt</span></div>`;

      if (allBusy){
        const bookUrl = location.origin + location.pathname + '#/shop/' + s.id;
        const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=1&data=' + encodeURIComponent(bookUrl);
        bodyHtml = `<div class="disp-full"><div class="t1">📅 Heute ausgebucht</div><div class="t2">Scanne den Code und sichere dir einen Termin an einem der nächsten Tage</div><img class="disp-qr" src="${qr}" alt="QR"></div>` + bodyHtml;
      }
    }

    app.innerHTML = `<div class="disp-head"><span class="nm">${esc(s.name)}</span><span class="dt">${DOW[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}</span></div>
      <div class="disp-clock">Automatisch aktualisiert · AFROCUTS · ${APP_VERSION}</div>
      ${bodyHtml}`;
  } catch(e){
    app.innerHTML = `<div class="view"><div class="err">${esc(errMsg(e))}</div></div>`;
  }
  displayTimer = setInterval(() => viewDisplay(shopId), 90000);
}

// =====================================================================
// ADMIN (App-Manager)
// =====================================================================
let adminTab = 'overview', adminRange = 'today', adminData = null, adminFilter = '';
async function viewAdmin(tab){
  if (!session || !isAdmin){ app.innerHTML = topbar('App-Manager','barber') + '<div class="view"><div class="err">Kein Zugriff. Deine E-Mail muss in der Tabelle <code>admins</code> stehen (siehe schema.sql).</div></div>'; return; }
  if (tab) adminTab = tab;
  app.innerHTML = topbar('Betreiber-Cockpit','barber') + '<div class="view"><span class="spinner"></span> Lade Daten …</div>';
  try {
    if (!adminData){
      const [{ data: shops }, { data: bookings }, { data: disp }] = await Promise.all([
        sb.from('shops').select('*').order('created_at', { ascending:false }),
        sb.from('bookings').select('*, shops(name,type,city)').order('date', { ascending:false }).order('time', { ascending:false }).limit(1000),
        sb.from('disputes').select('*, bookings(*, shops(name))').order('created_at', { ascending:false })
      ]);
      adminData = { shops: shops||[], bookings: bookings||[], disp: disp||[] };
    }
    const tabs = ['overview','barbers','bookings','payments','approvals'].map(k => `<div class="tab ${adminTab===k?'on':''}" onclick="AF.adminTab('${k}')">${{overview:'📊 Übersicht',barbers:'💈 Barber',bookings:'📅 Termine',payments:'💶 Zahlungen',approvals:'🛡️ Freigaben'}[k]}</div>`).join('');
    let body = '';
    if (adminTab === 'overview') body = adminOverview();
    else if (adminTab === 'barbers') body = adminBarbers();
    else if (adminTab === 'bookings') body = adminBookings();
    else if (adminTab === 'payments') body = adminPayments();
    else if (adminTab === 'approvals') body = adminApprovals();
    app.innerHTML = topbar('Betreiber-Cockpit','barber') + `<div class="view"><div class="tabs">${tabs}</div>${body}<div style="height:20px"></div></div>`;
  } catch(e){ app.innerHTML = topbar('Betreiber-Cockpit','barber') + `<div class="view"><div class="err">${esc(errMsg(e))}</div></div>`; }
}
// Zeitraum-Helfer
function inRange(dateStr){
  const d = fromKey(dateStr), t = today();
  if (adminRange === 'today') return dateStr === dkey(t);
  if (adminRange === 'week'){ const wk = new Date(t); wk.setDate(t.getDate()-6); return d >= wk && d <= t; }
  if (adminRange === 'month'){ const mk = new Date(t); mk.setDate(t.getDate()-29); return d >= mk && d <= t; }
  return true;
}
function rangeSwitch(){
  return `<div class="chips" style="margin-bottom:10px">${[['today','Heute'],['week','7 Tage'],['month','30 Tage'],['all','Gesamt']].map(([k,l])=>`<span class="chip ${adminRange===k?'on':''}" onclick="AF.adminRange('${k}')">${l}</span>`).join('')}</div>`;
}
const REVENUE_STATUS = ['checked_in','completed'];
function adminOverview(){
  const { shops, bookings, disp } = adminData;
  const inr = bookings.filter(b => inRange(b.date));
  const active = inr.filter(b => !b.status.startsWith('cancelled') && b.status !== 'no_show_barber');
  const revenue = inr.filter(b => REVENUE_STATUS.includes(b.status)).reduce((a,b)=>a+Number(b.price),0);
  const deposits = inr.filter(b => b.deposit_status==='paid').reduce((a,b)=>a+Number(b.deposit_amount),0);
  const commission = revenue * 0.10; // 10 % Annahme Testphase
  const checkins = inr.filter(b => ['checked_in','completed'].includes(b.status)).length;
  const noshowB = inr.filter(b => b.status==='no_show_barber').length;
  const noshowC = inr.filter(b => b.status==='no_show_customer').length;
  const approvedShops = shops.filter(s => s.status==='approved');
  let missedTotal = 0, missedKnown = 0;
  approvedShops.forEach(s => {
    const est = missedRevenueEstimate(s, bookings.filter(b => b.shop_id === s.id), adminRange);
    if (est.missedRevenue !== null){ missedTotal += est.missedRevenue; missedKnown++; }
  });
  return rangeSwitch() +
    `<div class="stat"><div class="s"><div class="v">${active.length}</div><div class="k">Termine</div></div><div class="s"><div class="v">${eur(revenue)}</div><div class="k">Umsatz</div></div><div class="s"><div class="v">${eur(commission)}</div><div class="k">Provision (10 %)</div></div></div>
    <div class="stat" style="margin-top:10px"><div class="s"><div class="v">${checkins}</div><div class="k">Check-ins</div></div><div class="s"><div class="v">${eur(deposits)}</div><div class="k">Anzahlungen bez.</div></div><div class="s"><div class="v">${disp.filter(d=>d.status==='open').length}</div><div class="k">Offene Fälle</div></div></div>
    <div class="lossbox">📉 <b>Plattformweit verpasster Umsatz (Schätzung):</b> <span style="font-size:17px;font-weight:800">${eur(missedTotal)}</span> über ${missedKnown} von ${approvedShops.length} aktiven Shops mit ausreichend eigenen Daten — Detail je Barber im Tab „Barber“.</div>
    <div class="sec">Plattform</div>
    <div class="rowline"><span>Registrierte Barber</span><b style="margin-left:auto">${shops.length}</b></div>
    <div class="rowline"><span>Davon freigegeben</span><b style="margin-left:auto">${shops.filter(s=>s.status==='approved').length}</b></div>
    <div class="rowline"><span>Anträge in Prüfung</span><b style="margin-left:auto">${shops.filter(s=>s.status==='pending').length}</b></div>
    <div class="rowline"><span>No-Shows (Barber / Kunde)</span><b style="margin-left:auto">${noshowB} / ${noshowC}</b></div>
    <div class="note">Provision ist in der Testphase mit 10 % des Umsatzes angenommen. Umsatz zählt Termine, die eingecheckt oder abgeschlossen sind.</div>`;
}
function adminBarbers(){
  const { shops, bookings } = adminData;
  return rangeSwitch() + '<div class="sec">Alle Barber &amp; Freelancer</div>' + (shops.length ? shops.map(s => {
    const bk = bookings.filter(b => b.shop_id === s.id && inRange(b.date));
    const rev = bk.filter(b => REVENUE_STATUS.includes(b.status)).reduce((a,b)=>a+Number(b.price),0);
    const active = bk.filter(b => !b.status.startsWith('cancelled')).length;
    const ns = bk.filter(b => b.status==='no_show_barber' || b.status==='no_show_customer').length;
    const badge = s.status==='approved'?'':s.status==='pending'?'warn':'red';
    const missed = s.status==='approved' ? missedRevenueEstimate(s, bookings.filter(b => b.shop_id === s.id), adminRange) : { missedRevenue: null };
    return `<div class="bk"><div class="top"><div><div style="font-weight:700">${s.type==='mobile'?'🚗':'💈'} ${esc(s.name)}</div><div class="meta">${esc(s.city||'')} · ${(s.staff||[]).length||'Solo'} · Anzahlung ${s.deposit_pct}%</div></div><span class="badge ${badge}">${{pending:'In Prüfung',approved:'✓ Aktiv',rejected:'Abgelehnt',paused:'Pausiert'}[s.status]}</span></div>
      <div class="stat" style="margin-top:8px"><div class="s"><div class="v">${active}</div><div class="k">Termine</div></div><div class="s"><div class="v">${eur(rev)}</div><div class="k">Umsatz</div></div><div class="s"><div class="v">${eur(rev*0.10)}</div><div class="k">Provision</div></div></div>
      ${missed.missedRevenue !== null ? `<div class="lossbox" style="margin-top:8px">📉 Verpasster Umsatz: <b>${eur(missed.missedRevenue)}</b></div>` : ''}
      <div class="acts">${s.status!=='approved'?`<button class="btn small ok" onclick="AF.shopStatus('${s.id}','approved')">Freigeben</button>`:`<button class="btn small sec2" onclick="AF.shopStatus('${s.id}','paused')">Pausieren</button>`}<a class="btn small sec2" style="text-decoration:none" href="#/shop/${s.id}">Profil</a>${ns?`<span class="badge red">${ns} No-Show</span>`:''}</div></div>`;
  }).join('') : '<div class="note">Noch keine Barber registriert.</div>');
}
const ST_LABEL = { booked:'Reserviert', checked_in:'Eingecheckt', completed:'Abgeschlossen', cancelled_customer:'Kunde storniert', cancelled_barber:'Barber abgesagt', no_show_barber:'Barber No-Show', no_show_customer:'Kunde No-Show' };
function adminBookings(){
  const { bookings } = adminData;
  const f = adminFilter.toLowerCase();
  let list = bookings.filter(b => inRange(b.date));
  if (f) list = list.filter(b => (b.customer_name||'').toLowerCase().includes(f) || (b.shops?.name||'').toLowerCase().includes(f) || (b.service_name||'').toLowerCase().includes(f) || (b.status||'').toLowerCase().includes(f) || (b.date||'').includes(f));
  return rangeSwitch() +
    `<input placeholder="🔎 Suche: Kunde, Barber, Service, Status, Datum …" value="${esc(adminFilter)}" oninput="AF.adminSearch(this.value)" style="margin-bottom:10px">
    <div class="sec">Termine (${list.length})</div>` +
    (list.length ? list.slice(0,200).map(b => {
      const badge = b.status==='completed'||b.status==='checked_in'?'':b.status==='booked'?'blue':'red';
      return `<div class="bk"><div class="top"><div><span class="tm">${b.date} · ${b.time}</span><div style="font-weight:700;margin-top:3px">${esc(b.customer_name)} · <span style="font-weight:400;color:var(--muted)">${esc(b.shops?.name||'')}</span></div><div class="meta">${esc(b.service_name)} · ${eur(b.price)} · Anzahlung ${eur(b.deposit_amount)} (${b.deposit_status==='paid'?'bezahlt':b.deposit_status==='refunded'?'erstattet':'offen'})${b.customer_contact?' · 📞 '+esc(b.customer_contact):''}</div></div><span class="badge ${badge}">${ST_LABEL[b.status]||b.status}</span></div></div>`;
    }).join('') + (list.length>200?'<div class="note">Nur die neuesten 200 angezeigt — Suche eingrenzen für mehr.</div>':'') : '<div class="note">Keine Termine im Zeitraum/Filter.</div>');
}
function adminPayments(){
  const { bookings } = adminData;
  // Jeder relevante Zahlungsvorgang: Anzahlung (bezahlt/offen), Erstattung
  let rows = [];
  bookings.filter(b => inRange(b.date)).forEach(b => {
    if (b.deposit_status === 'refunded') rows.push({ t:'Erstattung', amount:-b.deposit_amount, b, comm:0 });
    else if (b.deposit_status === 'paid') rows.push({ t:'Anzahlung', amount:b.deposit_amount, b, comm: Number(b.price)*0.10 });
    else rows.push({ t:'Anzahlung offen', amount:b.deposit_amount, b, comm:0, pending:true });
  });
  const f = adminFilter.toLowerCase();
  if (f) rows = rows.filter(r => (r.b.customer_name||'').toLowerCase().includes(f) || (r.b.shops?.name||'').toLowerCase().includes(f) || r.t.toLowerCase().includes(f));
  const totalPaid = rows.filter(r=>r.t==='Anzahlung').reduce((a,r)=>a+r.amount,0);
  const totalRef = rows.filter(r=>r.t==='Erstattung').reduce((a,r)=>a+r.amount,0);
  const totalComm = rows.reduce((a,r)=>a+r.comm,0);
  return rangeSwitch() +
    `<div class="stat"><div class="s"><div class="v">${eur(totalPaid)}</div><div class="k">Anzahlungen</div></div><div class="s"><div class="v">${eur(totalComm)}</div><div class="k">Provision</div></div><div class="s"><div class="v">${eur(totalRef)}</div><div class="k">Erstattet</div></div></div>
    <input placeholder="🔎 Suche: Kunde, Barber, Typ …" value="${esc(adminFilter)}" oninput="AF.adminSearch(this.value)" style="margin:10px 0">
    <div class="sec">Zahlungsvorgänge (${rows.length})</div>` +
    (rows.length ? rows.slice(0,200).map(r => {
      const badge = r.t==='Erstattung'?'red':r.pending?'warn':'';
      return `<div class="bk"><div class="top"><div><div style="font-weight:700">${r.t==='Erstattung'?'↩︎':r.pending?'⏳':'✓'} ${eur(Math.abs(r.amount))} <span style="font-weight:400;color:var(--muted)">· ${r.t}</span></div><div class="meta">${esc(r.b.shops?.name||'')} · Kunde ${esc(r.b.customer_name)} · ${r.b.date} ${r.b.time}${r.comm?' · Provision '+eur(r.comm):''}</div></div><span class="badge ${badge}">${r.t==='Erstattung'?'Erstattet':r.pending?'Offen':'Bezahlt'}</span></div></div>`;
    }).join('') + (rows.length>200?'<div class="note">Nur die neuesten 200 angezeigt.</div>':'') : '<div class="note">Keine Zahlungsvorgänge im Zeitraum/Filter.</div>');
}
function adminApprovals(){
  const { shops, disp } = adminData;
  const shopCard = x => `<div class="bk"><div class="top"><div><div style="font-weight:700">${esc(x.name)}</div><div class="meta">${x.type==='mobile'?'🚗 Freelancer · '+esc(x.area):'🏠 '+esc(x.address)} · ${esc(x.city)}<br>${(x.staff||[]).length||'Solo'} Team · ${(x.services||[]).length} Services · Anzahlung ${x.deposit_pct} %${x.phone?' · '+esc(x.phone):''}</div></div><span class="badge ${x.status==='approved'?'':x.status==='pending'?'warn':'red'}">${{pending:'In Prüfung',approved:'✓ Freigegeben',rejected:'Abgelehnt',paused:'Pausiert'}[x.status]}</span></div>
    <div class="acts">${x.status!=='approved'?`<button class="btn small ok" onclick="AF.shopStatus('${x.id}','approved')">✓ Freigeben</button>`:''}${x.status==='approved'?`<button class="btn small sec2" onclick="AF.shopStatus('${x.id}','paused')">Pausieren</button>`:''}${x.status!=='rejected'?`<button class="btn small danger" onclick="AF.shopStatus('${x.id}','rejected')">Ablehnen</button>`:''}<a class="btn small sec2" style="text-decoration:none" href="#/shop/${x.id}">Ansehen</a></div></div>`;
  const dispCard = d => { const b = d.bookings||{}; return `<div class="bk"><div class="top"><div><div style="font-weight:700">${esc(b.shops?.name||'?')} · ${b.date||''} ${b.time||''}</div><div class="meta">Kunde: ${esc(b.customer_name||'')} · ${esc({barber_absent:'Barber nicht da',barber_cancelled:'Barber hat abgesagt',other:'Sonstiges'}[d.reason]||d.reason)}${d.note?' · „'+esc(d.note)+'“':''}<br>Anzahlung ${eur(b.deposit_amount)}</div></div><span class="badge ${d.status==='open'?'warn':d.status==='refunded'?'':'red'}">${{open:'Offen',refunded:'✓ Erstattet',rejected:'Abgelehnt'}[d.status]}</span></div>
    ${d.status==='open'?`<div class="acts"><button class="btn small ok" onclick="AF.resolve('${d.id}','${b.id}','refunded')">Kunde erstatten</button><button class="btn small sec2" onclick="AF.resolve('${d.id}','${b.id}','rejected')">Barber bestätigen</button></div>`:''}</div>`; };
  return `<div class="sec">Anträge in Prüfung (${shops.filter(x=>x.status==='pending').length})</div>${shops.filter(x=>x.status==='pending').map(shopCard).join('')||'<div class="note">Keine offenen Anträge.</div>'}
    <div class="sec">Offene Streitfälle (${disp.filter(x=>x.status==='open').length})</div>${disp.filter(x=>x.status==='open').map(dispCard).join('')||'<div class="note">Keine offenen Fälle.</div>'}
    <div class="sec">Erledigte Fälle</div>${disp.filter(x=>x.status!=='open').map(dispCard).join('')||'<div class="note">—</div>'}`;
}
function adminSetTab(k){ adminTab = k; viewAdmin(); }
function adminSetRange(k){ adminRange = k; viewAdmin(); }
function adminSearch(v){ adminFilter = v; const y = window.scrollY; if (adminTab==='bookings'){ const el = document.querySelector('.view'); } viewAdmin(); window.scrollTo(0,y); }
async function shopStatus(id, status){ const { error } = await sb.from('shops').update({ status }).eq('id', id); if (error) return toast(errMsg(error), true); toast('✓ ' + status); shopsCache = null; adminData = null; viewAdmin(); }
async function resolve(did, bid, status){
  const { error } = await sb.from('disputes').update({ status, resolved_at: new Date().toISOString() }).eq('id', did); if (error) return toast(errMsg(error), true);
  if (status==='refunded' && bid){ await sb.from('bookings').update({ status:'no_show_barber', deposit_status:'refunded' }).eq('id', bid); }
  adminData = null; toast(status==='refunded' ? '✓ Erstattung vermerkt — Kunde informieren' : '✓ Barber bestätigt'); viewAdmin();
}

// =====================================================================
// RENDER / BOOT
// =====================================================================
async function render(){
  const r = route(); const [path, q] = r.split('?'); const parts = path.split('/');
  if (parts[0] !== 'display'){ clearInterval(displayTimer); document.body.classList.remove('disp-body'); }
  if (parts[0] !== 'b' && parts[0] !== 'bchat'){ clearInterval(chatTimer); }
  try {
    if (parts[0]==='home' || parts[0]==='') return viewHome();
    if (parts[0]==='shop') return viewShop(parts[1]);
    if (parts[0]==='stylist') return viewStylist();
    if (parts[0]==='time') return viewTime();
    if (parts[0]==='pay') return viewPay();
    if (parts[0]==='my') return viewMy();
    if (parts[0]==='b') return viewBooking(parts[1], (q||'').includes('new=1'), (q||'').includes('paid=1'));
    if (parts[0]==='barber') return viewBarber();
    if (parts[0]==='bchat') return viewBarberChat(parts[1]);
    if (parts[0]==='display'){ return viewDisplay(parts[1]); }
    if (parts[0]==='admin'){ adminData = null; return viewAdmin(); }
    return viewHome();
  } catch(e){ app.innerHTML = topbar() + `<div class="view"><div class="err">${esc(errMsg(e))}</div></div>`; }
}
window.AF = { pickService, afterService, pickStaff, day, pickTime, book, checkin, cancel, dispute, sendLink, pwLogin, signUp, logout, f: fset, rf, togSpec, addArea, sv, addSv, rmSv, st, addSt, rmSt, saveShop, dash: viewDash, dday, setStatus, depPaid, arrived, avTab, togHour, togDay, editShop, connectStripe, shopStatus, resolve, toast, setCity, useLocation, sendChatCustomer, sendChatBarber, statsRange: statsSetRange, statsSearch, adminTab: adminSetTab, adminRange: adminSetRange, adminSearch };

async function handleAuthRedirect(){
  // Supabase hängt den Login-Token als #access_token=... an. Wir fischen ihn heraus,
  // egal ob als "#access_token=..." oder als zweites "#" nach einer Route.
  const h = location.hash || '';
  const at = h.indexOf('access_token=');
  if (at === -1) return false;
  const p = new URLSearchParams(h.substring(at));
  const access_token = p.get('access_token');
  const refresh_token = p.get('refresh_token');
  if (!access_token || !refresh_token){ authError = 'Login-Link unvollständig (Token fehlt). Bitte neuen Link anfordern.'; return true; }
  try {
    const { data, error } = await sb.auth.setSession({ access_token, refresh_token });
    if (error){ authError = 'Login fehlgeschlagen: ' + error.message; }
    else if (!data || !data.session){ authError = 'Login-Token wurde nicht akzeptiert. Ist die App-Adresse in Supabase unter Authentication → URL Configuration eingetragen?'; }
  } catch(e){ authError = 'Login-Fehler: ' + errMsg(e); }
  // Adresse säubern (Token aus der Leiste entfernen)
  history.replaceState(null, '', location.pathname + '#/barber');
  return true;
}

(async function boot(){
  if (!initSb()) return;
  const didAuth = await handleAuthRedirect();
  // QR-Check-in-Link (?c=CODE): direkt zu "Meine Termine" bzw. letzter Buchung
  const params = new URLSearchParams(location.search);
  if (params.get('c') && !location.hash){ const last = myCodes()[0]; location.hash = last ? '#/b/' + last.code : '#/my'; }
  await loadSession();
  sb.auth.onAuthStateChange(async (ev) => {
    if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'TOKEN_REFRESHED'){
      await loadSession();
      // Nach frischem Login IMMER in den Barber-Bereich springen und neu zeichnen
      if (ev === 'SIGNED_IN' && session){ if (route() !== 'barber' && !route().startsWith('admin')) { location.hash = '#/barber'; } render(); }
      else if (route().startsWith('barber') || route().startsWith('admin')) render();
    }
  });
  // Direkt nach Login-Redirect sicher ins Barber-Formular
  if (didAuth && session){ location.hash = '#/barber'; }
  if (!location.hash) location.hash = '#/home';
  render();
  // Service Worker + alte Caches entfernen, damit während der Testphase IMMER die neueste Version lädt
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(()=>{});
    if (window.caches && caches.keys) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(()=>{});
  }
})();
})();
