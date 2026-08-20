// =====================================================================
// AFROCUTS · Konfiguration
// Diese zwei Werte findest du in Supabase unter: Project Settings -> API
// =====================================================================
window.AFRO_CONFIG = {
  SUPABASE_URL: "https://DEIN-PROJEKT.supabase.co",
  SUPABASE_ANON_KEY: "DEIN-ANON-PUBLIC-KEY",

  APP_NAME: "AFROCUTS",
  CITY_DEFAULT: "Berlin",
  // Rotierende Hintergrundfotos der Startseite (Magazine-Cover-Look). Leer = kein Hintergrundbild.
  // Beliebig viele Bilder möglich, wechseln automatisch alle paar Sekunden.
  // Wichtig: nur lizenzsichere Bilder verwenden!
  HERO_IMAGES: ["hero.jpg", "hero1.jpg", "hero2.jpg", "hero3.jpg"],
  // Testphase: true = Anzahlung wird nur angezeigt/erfasst, nicht abgebucht (außer Barber hat Payment-Link hinterlegt)
  TEST_MODE: true
};
