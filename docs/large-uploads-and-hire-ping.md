# Große Uploads und Einstellungs-Ping

## Uploads in Stücken

Alle vier Dateiwege des Dashboards — Bodycam-Clips, Asservate der
Korruptionsprüfung, Ermittlungsfotos und Akademie-Ressourcen — laufen über einen
gemeinsamen, wiederaufnehmbaren Transport unter `/api/uploads`:

1. `POST /api/uploads` legt eine Sitzung an oder findet eine angefangene wieder.
2. `PUT /api/uploads/:id/chunks/:index` nimmt je ein Stück von 8 MiB entgegen,
   mit dessen SHA-256 im Header `x-chunk-sha256`.
3. `POST /api/uploads/:id/complete` setzt zusammen und prüft Größe, Dateisignatur
   und Gesamtprüfsumme.
4. Die fachliche Route bekommt anschließend nur noch JSON mit `uploadId`.

**Kein einzelner Request wird größer als ein Chunk.** Damit steht kein
Größenlimit eines vorgeschalteten Proxys mehr im Weg — weder nginx noch ein CDN.

### Was das für den Betrieb heißt

- Ein abgebrochener Upload lässt sich **24 Stunden** lang fortsetzen. Der Server
  erkennt dieselbe Datei am Fingerabdruck aus Name, Größe und Änderungsdatum;
  der Browser muss sich nichts merken.
- Höchstens **drei** offene Sitzungen je Nutzer. Die vierte wird mit HTTP 429
  abgewiesen.
- Angefangene Uploads belegen bis zum Ablauf Plattenplatz unter
  `uploads/incoming/<sessionId>/`. Ein eigener Worker
  (`ensureUploadCleanupWorker`, alle 10 Minuten) räumt abgelaufene Sitzungen,
  nicht eingelöste fertige Uploads und verwaiste Ordner weg. Er hängt bewusst
  **nicht** am Komprimierungs-Worker: `CLIP_COMPRESSION_ENABLED=false` darf die
  Bereinigung nicht stilllegen.
- Der Dateiinhalt wird an den ersten Bytes geprüft, nicht am `Content-Type` des
  Clients. WebM und MKV teilen sich die EBML-Signatur und sind dabei nicht
  unterscheidbar; geprüft wird gegen die erlaubte Signaturgruppe.

### Einstellungen

| Variable | Vorgabe | Wirkung |
|---|---|---|
| `UPLOAD_CHUNK_BYTES` | `8388608` (8 MiB) | Größe eines Stücks. Vom Server bestimmt, nicht vom Client. |
| `NEXT_PUBLIC_UPLOAD_CONCURRENCY` | `3` | Gleichzeitige Verbindungen im Browser. |
| `CLIP_MAX_BYTES` | `524288000` (500 MiB) | Obergrenze für Clips. |

### nginx

Die Werte aus `scripts/fix-nginx-uploads.sh` sind nach diesem Umbau **nicht mehr
nötig**, weil kein Request mehr groß wird. Sie schaden aber nicht und schützen den
Fall, dass jemand `UPLOAD_CHUNK_BYTES` deutlich hochsetzt:

```nginx
client_max_body_size 512M;
client_body_timeout 1800s;
proxy_request_buffering off;
proxy_read_timeout 1800s;
proxy_send_timeout 1800s;
```

Historisch legte `scripts/server-setup.sh` die Site mit `client_max_body_size 25M`
an — deutlich unter dem App-Limit. Uploads darüber froren im Browser ohne
Fehlermeldung ein, weil nginx das Lesen abbrach, bevor die App antworten konnte.
Das war die Ursache des ursprünglichen Problems.

### Tests

```bash
npx tsx --test tests/upload-sessions.test.ts        # Regeln, Chunk-Ablage, Anzeigeformate
npx tsx --test tests/chunked-uploads.test.ts        # Proxy-Matcher und CORS
npx tsx --test tests/upload-sessions-db.test.ts     # Sitzungen, Ticket, Aufräumen
npx tsx --test tests/chunked-uploads-e2e.test.ts    # 200 MiB parallel über echtes HTTP
```

Die Datenbanktests brauchen eine **eigene** Datenbank: `.env.test` mit einer
`DATABASE_URL`, die nicht auf `fib_dash` zeigt. `tests/db-env.ts` bricht sonst ab,
damit nie versehentlich Testzeilen in echten Daten landen.

## Kurz-Ping bei Neueinstellung

Unter **Einstellungen → Discord** das Feld **Neueinstellung: Channel für Kurz-Ping** auswählen. Alternativ `DISCORD_HIRE_PING_CHANNEL_ID` verwenden; Umgebungsvariablen haben Vorrang. Ohne Channel bleibt die Funktion aus. `HIRE_PING_ENABLED=false` deaktiviert sie ebenfalls.

Bei der Neuanlage eines Agents über das Dashboard oder den bestehenden Discord-Einstellungsbefehl wird genau dieser Agent einmal erwähnt – über die im Dashboard hinterlegte Discord-ID. Ohne hinterlegte Discord-ID unterbleibt der Ping stillschweigend. Rollen werden nicht mehr erwähnt. Etwa eine Sekunde nach erfolgreichem Versand wird genau diese Nachricht gelöscht. Auslöser ist die Agent-Neuanlage, nicht das spätere Unterschreiben des Arbeitsvertrags. Bestehende Agents lösen beim Serverstart keinen nachträglichen Ping aus.

Eine eindeutige Datenbank-Markierung pro Agent verhindert wiederholte Auslösung. Discord erhält für kurzzeitige Transport-Wiederholungen eine feste Nonce. Bestätigte Nachrichten werden vor dem Löschversuch zur Bereinigung vorgemerkt; fehlgeschlagene Löschungen werden minütlich und nach Neustart erneut versucht. Nach einem unbestätigten Versand wird kein zusätzlicher Einstellungs-Ping gestartet; Fehler erscheinen im Serverlog unter `[HirePing]`. Bei einem Prozessabbruch unmittelbar nach Versand kann die Bestätigung fehlen – eine absolute Zustell-/Löschgarantie über die externe API gibt es nicht.

Der Bot muss den gewählten Channel sehen und darin Nachrichten senden können. Nachrichten werden mit einer expliziten Benutzerliste gesendet, die ausschließlich die Discord-ID des eingestellten Agents enthält – ohne Rollen und ohne `@everyone`. Grundlage: [Discord-Nachrichten-API](https://docs.discord.com/developers/resources/message).

`npx tsx --test tests/hire-ping.test.ts` prüft Reihenfolge, Vermeidung doppelter Pings und das Beibehalten des Löschauftrags bei Discord-Fehlern. Es wurden keine echten Pings zum Testen versendet.
