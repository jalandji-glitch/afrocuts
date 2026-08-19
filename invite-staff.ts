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

    // Supabase-Einladung verschicken (legt den Nutzer an, falls er noch nicht existiert)
    const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: (return_base || "") + "#/barber",
    });
    if (inviteErr) throw inviteErr;

    // Mitarbeiter-Zeile anlegen/aktualisieren
    const { error: upsertErr } = await supabase.from("staff_members").upsert({
      shop_id, staff_index, name, email, user_id: invited.user.id, status: "invited",
    }, { onConflict: "shop_id,staff_index" });
    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
