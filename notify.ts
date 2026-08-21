// =====================================================================
// AFROCUTS · Edge Function: notify
// Zentrale E-Mail-Benachrichtigung. Wird automatisch von Supabase
// Database Webhooks aufgerufen, wenn sich Zeilen in shops/bookings/
// disputes ändern. Deckt genau diese fünf Fälle ab:
//
//   App-Manager  ← neuer Registrierungsantrag (shops, neu/erneut "pending")
//   App-Manager  ← neuer Streitfall (disputes, neu)
//   Barber       ← neue Terminbuchung (bookings, neu "booked")
//   Barber       ← Kunde storniert (bookings, Status → "cancelled_customer")
//   Kunde        ← Barber sagt ab (bookings, Status → "cancelled_barber",
//                  nur wenn die Kontaktangabe wie eine E-Mail aussieht)
//
// Beim Deploy im Supabase-Dashboard: "Enforce JWT Verification" AUSSCHALTEN
// (der Aufruf kommt von Supabase selbst, nicht von einem angemeldeten Nutzer).
//
// Benötigte Secrets (Edge Functions -> Secrets):
//   RESEND_API_KEY = re_...
//   NOTIFY_FROM    = z. B. "AFROCUTS <updates@mail.alandji.com>"
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY sind automatisch vorhanden.
//
// Einrichtung der Auslöser: Supabase-Dashboard -> Database -> Webhooks ->
// "Create a new hook" -> Tabelle wählen (shops / bookings / disputes) ->
// passende Events ankreuzen -> als Ziel "Supabase Edge Functions" -> "notify".
// Am einfachsten: für jede der drei Tabellen einen eigenen Hook anlegen.
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const looksLikeEmail = (s) => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

async function sendMail(to, subject, text){
  const from = Deno.env.get("NOTIFY_FROM") || "AFROCUTS <onboarding@resend.dev>";
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key || !to) return;
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to];
  if (!recipients.length) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject, text }),
    });
  } catch (e) { console.error("Mailversand fehlgeschlagen:", e); }
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, table, record, old_record } = payload;
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    // ---------- App-Manager: neuer Registrierungsantrag ----------
    if (table === "shops"){
      const wasNewPending = (type === "INSERT" && record.status === "pending")
        || (type === "UPDATE" && record.status === "pending" && old_record?.status && old_record.status !== "pending");
      if (wasNewPending){
        const { data: admins } = await supabase.from("admins").select("email");
        const emails = (admins || []).map(a => a.email);
        await sendMail(emails,
          `Neuer Antrag: ${record.name}`,
          `Ein neuer Barber wartet auf Freigabe.\n\nName: ${record.name}\nTyp: ${record.type === "mobile" ? "Freelancer" : "Laden"}\nStadt: ${record.city || ""}\n\nJetzt prüfen: App-Manager → Freigaben.`
        );
      }
    }

    // ---------- App-Manager: neuer Streitfall ----------
    if (table === "disputes" && type === "INSERT"){
      const { data: admins } = await supabase.from("admins").select("email");
      const emails = (admins || []).map(a => a.email);
      const { data: booking } = await supabase.from("bookings").select("*, shops(name)").eq("id", record.booking_id).maybeSingle();
      await sendMail(emails,
        `Neuer Streitfall`,
        `Ein Kunde hat ein Problem gemeldet.\n\nShop: ${booking?.shops?.name || "?"}\nKunde: ${booking?.customer_name || "?"}\nGrund: ${record.reason}\nNotiz: ${record.note || "-"}\n\nJetzt entscheiden: App-Manager → Freigaben.`
      );
    }

    // ---------- Barber: neue Buchung / Stornierung durch Kunden ----------
    // ---------- Kunde: Absage durch Barber ----------
    if (table === "bookings"){
      const shopId = record.shop_id;
      let shop = null;
      if (shopId){ const { data } = await supabase.from("shops").select("name,owner_email").eq("id", shopId).maybeSingle(); shop = data; }

      if (type === "INSERT" && record.status === "booked" && shop?.owner_email){
        await sendMail(shop.owner_email,
          `Neue Buchung: ${record.customer_name}`,
          `Neuer Termin in deinem AFROCUTS-Kalender.\n\nKunde: ${record.customer_name}\nService: ${record.service_name}\nTermin: ${record.date} · ${record.time} Uhr\nKontakt: ${record.customer_contact}${record.customer_address ? "\nAdresse: " + record.customer_address : ""}\n\nDetails in deinem Dashboard.`
        );
      }

      const statusChanged = type === "UPDATE" && old_record && old_record.status !== record.status;

      if (statusChanged && record.status === "cancelled_customer" && shop?.owner_email){
        await sendMail(shop.owner_email,
          `Storniert: ${record.customer_name}`,
          `Ein Kunde hat seinen Termin storniert.\n\nKunde: ${record.customer_name}\nService: ${record.service_name}\nWar geplant: ${record.date} · ${record.time} Uhr\n\nDer Slot ist wieder frei.`
        );
      }

      if (statusChanged && record.status === "cancelled_barber" && looksLikeEmail(record.customer_contact)){
        await sendMail(record.customer_contact,
          `Dein Termin bei ${shop?.name || "AFROCUTS"} wurde abgesagt`,
          `Hallo ${record.customer_name},\n\nleider musste dein Termin am ${record.date} um ${record.time} Uhr (${record.service_name}) abgesagt werden.\nDeine Anzahlung wird vollständig zurückerstattet.\n\nDu kannst direkt in der App einen neuen Termin buchen.`
        );
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("notify-Fehler:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 200, headers: { "Content-Type": "application/json" } });
    // Status bewusst 200: ein Mail-Fehler soll die Buchung/den Antrag nicht rückgängig machen.
  }
});
