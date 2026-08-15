# AFROCUTS — Testversion (PWA)

Echte, gemeinsam nutzbare Testversion: Kunden buchen ohne Login, Barber verwalten per Magic-Link-Login,
du als App-Manager gibst Shops frei. Daten liegen in Supabase (kostenlos), die App läuft auf jedem
statischen Hosting (Netlify/Vercel/GitHub Pages, kostenlos). Keine App-Stores nötig.

## Dateien
| Datei | Zweck |
|---|---|
| `index.html` | App-Hülle + Design |
| `app.js` | gesamte Logik (Kunde, Barber, Admin) |
| `config.js` | **hier deine Supabase-Daten eintragen** |
| `schema.sql` | einmal in Supabase ausführen (Tabellen, Sicherheit, Funktionen) |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | macht daraus eine installierbare PWA |

## Einrichtung in ~20 Minuten
1. **Supabase-Projekt anlegen** — supabase.com → New project (Region EU, z. B. Frankfurt).
2. **Schema einspielen** — SQL Editor → New query → Inhalt von `schema.sql` einfügen.
   Vorher in Zeile ~12 `deine@email.de` durch **deine** E-Mail ersetzen (das macht dich zum App-Manager). → Run.
3. **E-Mail-Login aktivieren** — Authentication → Providers → Email: „Enable“ (Magic Link an).
   Unter Authentication → URL Configuration später deine App-URL bei „Site URL“ + „Redirect URLs“ eintragen.
4. **Keys kopieren** — Project Settings → API: „Project URL“ und „anon public“ Key → in `config.js` eintragen.
5. **Hochladen** — z. B. app.netlify.com → „Add new site“ → „Deploy manually“ → den ganzen Ordner reinziehen.
   Du bekommst eine URL wie `https://afrocuts-test.netlify.app`. Diese URL in Schritt 3 eintragen.
6. **Erster Test** — URL öffnen → unten „Für Barber“ → deine E-Mail → Link aus der Mail klicken → Formular ausfüllen →
   „Antrag einreichen“ → im Dashboard „Mehr“ → „App-Manager“ → deinen eigenen Shop **freigeben** → als Kunde buchen.

## Rollen
- **Kunde**: kein Login. Buchung wird auf dem Gerät gemerkt (Code A1B2C3), Check-in per QR (Handy-Kamera) oder Shop-Code.
- **Barber / Freelancer**: Login per E-Mail-Link. Formular → Prüfung → Dashboard (Termine, Verfügbarkeit, Shop-Code, Bearbeiten).
- **App-Manager**: jede E-Mail in der Tabelle `admins`. Freigeben/Pausieren/Ablehnen, Streitfälle.

## Testphase & Geld
`TEST_MODE: true` in `config.js`: Anzahlung wird angezeigt und beim Barber vor Ort kassiert (Barber tippt „Anzahlung erhalten“).
Will ein Barber echte Anzahlungen testen: einen Stripe-Payment-Link oder PayPal.me-Link in seinem Profil hinterlegen —
öffnet sich nach der Buchung. (Stripe Connect mit automatischem Split kommt in der nächsten Stufe.)

## Grenzen dieser Version (bewusst)
- Keine Push-Benachrichtigungen (Barber lädt Dashboard neu; Kunden-Kontakt steht in jeder Buchung).
- Karte = Link zu Google Maps (keine Google-Maps-API-Kosten).
- Streitfall-Erstattung wird vermerkt, Geld überweist du manuell.
- Rechtstexte (Impressum, Datenschutz, AGB) müsst ihr selbst ergänzen, bevor Fremde die App nutzen.

## Wenn etwas nicht geht
- „Noch nicht konfiguriert“ → `config.js` prüfen.
- Login-Mail kommt nicht → Supabase Auth → Providers → Email aktiviert? Spam-Ordner? Site URL gesetzt?
- „Kein Zugriff“ im App-Manager → deine E-Mail in Tabelle `admins` (Groß/Kleinschreibung egal).
- Kunde sieht keine Shops → Shop im App-Manager freigeben (Status „approved“).
