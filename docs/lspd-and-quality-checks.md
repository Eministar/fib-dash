# LSPD-Anbindung und Qualitätskontrollen

## Anbindung an das LSPD-Panel (lspd-hr)

fib-dash liest LSPD-Beamte über eine schreibgeschützte Schnittstelle des lspd-hr-Panels.

1. **lspd-hr:** In der `.env` `FIB_API_SECRET` setzen (mindestens 24 Zeichen, z. B. `openssl rand -base64 36`) und neu starten. Endpunkte: `GET /api/external/officers` und `GET /api/external/officers/{id}`, Header `x-api-secret`. Ohne Secret antworten sie mit 503.
2. **fib-dash:** In der `.env` `LSPD_HR_API_URL` (Adresse des Panels, ohne abschließenden `/`) und `LSPD_HR_API_SECRET` (derselbe Wert) setzen und neu starten.

Das Secret verlässt den fib-dash-Server nie; der Browser spricht nur mit `/api/lspd/officers`. Antworten werden 60 Sekunden zwischengespeichert. Ist das Panel nicht erreichbar, zeigen die Auswahlfelder eine Meldung. Bereits gespeicherte Kontrollen bleiben lesbar, weil Name, Dienstnummer und Rang als Momentaufnahme mitgespeichert werden.

Übertragen werden Stammdaten (Name, Dienstnummer, Rang, Status, Units, Einstellung, Discord-ID) und die Laufbahn (Beförderungen, Sanktionen, Trainings, Kündigungen). Interne Notizen, Flags und Bearbeiter bleiben im Panel.

## Korruptionskontrollen

Im Schritt „Beamter“ gibt es **LSPD-Beamter aus dem Panel**. Beim Speichern wird die Beamtenakte des Officers verwendet oder mit Behörde „LSPD“ angelegt und dauerhaft mit ihm verknüpft (`PublicOfficial.lspdOfficerId`). Verknüpfte Beamtenakten zeigen die LSPD-Akte live an. Manuelle Beamte anderer Behörden funktionieren wie bisher. Bereits vorher manuell angelegte LSPD-Akten werden nicht automatisch verknüpft; Doppelte lassen sich wie gewohnt zusammenführen.

## Qualitätskontrollen

Menüpunkt **Qualitätskontrollen** (Recht `quality-checks:view`; Durchführen und Freigeben: `quality-checks:manage`).

- **Beamtenakten:** alle LSPD-Beamten aus dem Panel mit Anzahl und Bewertungen ihrer Kontrollen. Die Akte zeigt LSPD-Stammdaten und Laufbahn, alle Qualitätskontrollen und verknüpfte Korruptionskontrollen.
- **Kontrolle beginnen:** Beamten wählen, optional Ort. Während der Mitfahrt mit **Positiv / Negativ / Notiz** protokollieren. Der Zeitstempel ist „jetzt“; Nachträge können einen anderen Zeitpunkt tragen. Strg+Enter speichert.
- **Protokoll:** Einträge lassen sich weder bearbeiten noch löschen. **Korrigieren** legt einen neuen Eintrag an; der alte bleibt durchgestrichen sichtbar und zählt nicht mehr zur Bilanz. Jede Aktion steht im Audit-Log.
- **Abschließen:** Gesamtbewertung (Vorschlag aus der Bilanz) und Fazit. Danach ist das Protokoll geschlossen.
- **Freigabelinks:** für eine Kontrolle, eine Beamtenakte oder alle Beamtenakten. Wer den Link hat, liest ohne Login unter `/share/quality/<token>`. Enthalten sind nur abgeschlossene Kontrollen; die Namen der Prüfer erscheinen nicht. Die LSPD-Laufbahn ist nur sichtbar, wenn beim Erstellen angehakt. Gespeichert wird nur der SHA-256-Hash des Tokens; der Link wird einmal angezeigt. Unter **Freigabelinks** lassen sich Links deaktivieren oder ersetzen.

## Bereitstellung

1. Datenbank sichern.
2. `npm run db:push` **oder** die Patches in dieser Reihenfolge einmalig anwenden: `prisma/patches/2026-10-01-notifications-custody.sql`, dann `prisma/patches/2026-10-01-lspd-quality-checks.sql`.
3. `.env` in beiden Dashboards ergänzen (siehe oben), beide bauen und neu starten.
4. Den passenden Benutzergruppen `quality-checks:view` bzw. `quality-checks:manage` geben.

## Tests

- fib-dash: `npx tsx --test tests/quality-checks.test.ts`
- lspd-hr: `npx tsx --test tests/external-api.test.ts`

Ein Live-Test beider Dashboards gegen echte Datenbanken steht noch aus.
