// =====================================================================
// AFROCUTS · Edge Function: invite-staff
// Lädt eine Person als Mitarbeiter:in eines Shops ein. Nutzt Supabases
// eingebautes Einladungssystem (kein Resend nötig) — die Person bekommt
// eine E-Mail mit einem Link, über den sie ihr eigenes Passwort setzt.
//
// Aufruf vom Client: POST mit Header Authorization: Bearer <Inhaber-JWT>
// Body: { "shop_id": "...", "staff_index": 0, "name": "...", "email": "...", "return_base": "https://.../index.html" }
//
// Beim Deploy im Supabase-Dashboard: "Enforce JWT Verification" AUSSCHALTEN
// (wir prüfen den Inhaber selbst über den mitgeschickten Bearer-Token).
//
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY sind automatisch vorhanden.
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) throw new Error("Nicht angemeldet");

    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) throw new Error("Ungültige Anmeldung");
    const ownerId = userData.user.id;

    const { shop_id, staff_index, name, email, return_base } = await req.json();
    if (!shop_id || staff_index === undefined || !name || !email) throw new Error("Angaben unvollständig");

    // Prüfen: gehört der Shop wirklich diesem Inhaber?
    const { data: shop, error: shopErr } = await supabase.from("shops").select("id,owner_id,name").eq("id", shop_id).single();
    if (shopErr || !shop) throw new Error("Shop nicht gefunden");
    if (shop.owner_id !== ownerId) throw new Error("Keine Berechtigung für diesen Shop");

    // Prüfen, ob der Nutzer bereits existiert
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existing = existingUsers.users.find(u => u.email === email);

    if (existing) {
      // Nutzer existiert bereits — staff_members-Zeile aktualisieren
      const { error: upsertErr } = await supabase.from("staff_members").upsert({
        shop_id, staff_index, name, email, user_id: existing.id, status: "invited",
      }, { onConflict: "shop_id,staff_index" });
      if (upsertErr) throw upsertErr;

      // Benachrichtigungs-Mail über Resend senden (da inviteUserByEmail bei bestehenden Nutzern nicht greift)
      const resendKey = Deno.env.get("RESEND_API_KEY");
      const notifyFrom = Deno.env.get("NOTIFY_FROM") || "AFROCUTS <updates@mail.alandji.com>";
      if (resendKey) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: notifyFrom,
              to: [email],
              subject: `AFROCUTS — Du wurdest ins Team von ${shop.name} eingeladen`,
              text: `Hallo ${name},\n\ndu wurdest als Teammitglied bei „${shop.name}" auf AFROCUTS eingeladen.\n\nBitte logge dich ein unter:\n${(return_base || "https://jalandji-glitch.github.io/afrocuts/")}#/barber\n\nFalls du dein Passwort noch nicht gesetzt hast, nutze „Passwort vergessen?" auf der Login-Seite.\n\nDein AFROCUTS-Team`,
            }),
          });
        } catch (mailErr) { console.error("Benachrichtigungs-Mail fehlgeschlagen:", mailErr); }
      }
    } else {
      // Neuer Nutzer — Einladung über Supabase senden
      const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: (return_base || "") + "#/barber",
      });
      if (inviteErr) throw inviteErr;
      const { error: upsertErr } = await supabase.from("staff_members").upsert({
        shop_id, staff_index, name, email, user_id: invited.user.id, status: "invited",
      }, { onConflict: "shop_id,staff_index" });
      if (upsertErr) throw upsertErr;
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
