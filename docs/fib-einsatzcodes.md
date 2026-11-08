# FIB-Einsatzcodes (MDT → Dashboard)

FIB-Agenten erzeugen im MDT (`nerov_mdt`) aus einer Akte einen Zahlencode und importieren ihn im Dashboard als Einsatzakte.

## Einrichtung

1. Zufälligen Schlüssel erzeugen (mind. 16 Zeichen), z. B. `openssl rand -hex 32`.
2. FiveM: Schlüssel als eine Zeile in `nerov_mdt/server/fibcode_secret.txt` (nur Server, wird nie an Clients gesendet).
3. Dashboard `.env`: `FIB_CODE_SECRET="<derselbe schlüssel>"`
4. Datenbank aktualisieren (neue Spalte `Investigation.sourceKey`): `npm run db:push`

Ohne Schlüssel ist der Import deaktiviert (Fehler 503); unsignierte Codes werden nie akzeptiert.

## Ablauf

- **MDT:** Akte öffnen → *Einsatzcode* (nur ESX-Job `fib`, serverseitig geprüft) → optional Einsatzbericht eintippen → *Code erzeugen* → *Kopieren*.
- **Dashboard:** *Einsatzakten → Einsatzcode importieren* → Code einfügen → Vorschau prüfen/bearbeiten → *Akte anlegen*.

## Format

`JSON → UTF-8 → Raw-Deflate (falls kleiner) → [0x01][Version][Flags][Body][HMAC-SHA256/16 Byte] → BigInt → Dezimalzahl`

- Das führende `0x01` stellt die exakte Byte-Länge sicher.
- Der HMAC deckt Version, Flags und Body ab: erkennt beschädigte Codes **und** belegt, dass der Code vom FIB-Server stammt.
- Der Code ist **nicht verschlüsselt**; wer ihn besitzt, kann den Inhalt lesen. Die Signatur belegt nur die Herkunft, nicht die inhaltliche Richtigkeit.
- Limits: Bericht 20 000 Zeichen, max. 50 Personen/Beamte/Fahrzeuge, 100 Asservate, 120 000 Ziffern.
- Code liegt in `nerov_mdt/server/fibcode.js` und `src/lib/investigations/fib-code.ts` – beide Seiten müssen formatgleich bleiben (`tests/fib-code.test.ts` prüft die Kompatibilität).

## Zuordnung

| Code | Akte |
| :-- | :-- |
| Titel, Status | Titel, Status |
| Datum/Uhrzeit, PLZ, Bericht | Chronologie-Eintrag „Einsatz“ (ohne Datum: Bericht in der Zusammenfassung) |
| Kriminelle / Zivilisten | Personen (Verdächtiger / Sonstiges – Rolle wählt der Agent); Delikte in der Personennotiz |
| Fahrzeuge | Fahrzeugregister (Halter als Notiz) |
| Asservate | Asservate mit Menge |
| Beamte, Behörde, Zugehörigkeit | Zusammenfassung |

Doppelte Importe verhindert der eindeutige `sourceKey` (`<serverId>:<MDT-Akte>`); Personen/Fahrzeuge werden per Name bzw. Kennzeichen wiederverwendet.
