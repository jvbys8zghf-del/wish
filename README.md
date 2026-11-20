# Wish

Wunschlisten-App (PWA) für einen Haushalt. Läuft auf GitHub Pages, Daten in Supabase.

- Keine Werbung, kein Tracking, keine fremden Server außer der eigenen Supabase-Datenbank.
- Anmeldung ohne E-Mail: anonyme Sitzung auf dem iPhone, Beitritt nur mit 12-stelligem Haushaltscode.
- Ideen für den Partner werden auf dem iPhone mit dem persönlichen Geheimwort verschlüsselt (AES-GCM, PBKDF2 mit 600.000 Runden).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js` | App-Hülle, Installation, Offline-Cache |
| `css/app.css` | Gestaltung (hell und dunkel) |
| `js/config.js` | Projekt-URL und öffentlicher Publishable Key |
| `js/api.js` | schlanker Supabase-Client (Auth + REST) |
| `js/crypto.js` | Verschlüsselung und Schlüsselablage |
| `js/app.js` | Bildschirme und Abläufe |
| `supabase/` | Datenbank-Schema und Sicherheitstests |

In dieses Repository gehören niemals: Service-Role-Key, Secret Keys, Haushalts- oder Wiederherstellungscodes.

## Neue Version veröffentlichen

1. Dateien ändern.
2. In `sw.js` die Konstante `VERSION` erhöhen und in `js/config.js` `appVersion` anpassen.
3. Committen und pushen. GitHub Pages veröffentlicht automatisch.
