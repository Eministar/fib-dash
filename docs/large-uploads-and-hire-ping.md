# Große Uploads und Einstellungs-Ping

## Upload-Korrektur

Die installierte Next-Version klont Request-Bodies bei aktivem Proxy und puffert standardmäßig nur 10 MB. Die binären Upload-Routen `/api/investigations/clips` und `/api/corruption-checks/:id/evidence` umgehen jetzt diesen Proxy und streamen direkt auf Platte. Die Routen behalten ihre Authentifizierung und liefern CORS inklusive Preflight selbst aus.

Bodycam-Clips erlauben standardmäßig 500 MiB (über `CLIP_MAX_BYTES` konfigurierbar). Beweisanlagen erlauben jetzt ebenfalls 500 MiB statt bisher 100 MiB. Der Browser sendet die erwartete Größe als `X-Upload-Size`; der Server vergleicht diese mit den tatsächlich gespeicherten Bytes. Abgebrochene oder gekürzte Uploads werden verworfen, bevor ein Datenbankeintrag angelegt wird.

Die mitgelieferte `web.config` setzt das IIS-Request-Limit auf 524288000 Bytes. Für den iisnode-Server erlaubt `start.js` bis zu 30 Minuten zum Empfangen eines Requests. Diese Änderungen greifen erst nach Deployment und Neustart.

Ein zusätzlicher vorgeschalteter Proxy muss die Größe ebenfalls zulassen. `scripts/server-setup.sh` hat die Site lange mit `client_max_body_size 25M` angelegt — deutlich unter dem App-Limit von 500 MiB. Ein Upload darüber friert im Browser bei einem beliebigen Prozentwert ein, ohne Fehlermeldung: nginx bricht das Lesen ab, bevor die App überhaupt antworten kann. Das Template setzt jetzt 512M sowie passende Timeouts und `proxy_request_buffering off`.

Das Setup-Skript läuft nur bei der Erstinstallation, die Update-Skripte fassen nginx nicht an. Auf einem bereits laufenden Server deshalb einmalig:

```bash
sudo bash scripts/fix-nginx-uploads.sh
```

Das Skript schreibt die Limits nach `/etc/nginx/conf.d/fib-dash-uploads.conf` (http-Kontext, gilt damit auch für den 443-Block von certbot), meldet konkurrierende `client_max_body_size`-Zeilen aus `sites-enabled`, prüft die Konfiguration und lädt nginx neu:

```nginx
client_max_body_size 512M;
client_body_timeout 1800s;
proxy_request_buffering off;
proxy_read_timeout 1800s;
proxy_send_timeout 1800s;
```

Ein CDN mit einem festen kleineren Request-Limit benötigt ebenfalls eine angepasste Konfiguration oder einen separaten Upload-Zugang. HTTP 413 wird im Upload-Dialog ausdrücklich als vorgeschaltetes Größenlimit angezeigt.

`npx tsx --test tests/large-uploads.test.ts` überträgt jeweils 200 MiB über einen echten lokalen HTTP-Server an beide Produktions-Dateischreiber und verifiziert Größe und SHA-256. Außerdem werden der Proxy-Matcher, Upload-CORS und das Verwerfen unvollständiger Daten geprüft. Der Test ersetzt keinen Upload durch den tatsächlichen Hosting-Proxy.

## Kurz-Ping bei Neueinstellung

Unter **Einstellungen → Discord** das Feld **Neueinstellung: Channel für Kurz-Ping** auswählen. Alternativ `DISCORD_HIRE_PING_CHANNEL_ID` verwenden; Umgebungsvariablen haben Vorrang. Ohne Channel bleibt die Funktion aus. `HIRE_PING_ENABLED=false` deaktiviert sie ebenfalls.

Bei der Neuanlage eines Agents über das Dashboard oder den bestehenden Discord-Einstellungsbefehl wird genau dieser Agent einmal erwähnt – über die im Dashboard hinterlegte Discord-ID. Ohne hinterlegte Discord-ID unterbleibt der Ping stillschweigend. Rollen werden nicht mehr erwähnt. Etwa eine Sekunde nach erfolgreichem Versand wird genau diese Nachricht gelöscht. Auslöser ist die Agent-Neuanlage, nicht das spätere Unterschreiben des Arbeitsvertrags. Bestehende Agents lösen beim Serverstart keinen nachträglichen Ping aus.

Eine eindeutige Datenbank-Markierung pro Agent verhindert wiederholte Auslösung. Discord erhält für kurzzeitige Transport-Wiederholungen eine feste Nonce. Bestätigte Nachrichten werden vor dem Löschversuch zur Bereinigung vorgemerkt; fehlgeschlagene Löschungen werden minütlich und nach Neustart erneut versucht. Nach einem unbestätigten Versand wird kein zusätzlicher Einstellungs-Ping gestartet; Fehler erscheinen im Serverlog unter `[HirePing]`. Bei einem Prozessabbruch unmittelbar nach Versand kann die Bestätigung fehlen – eine absolute Zustell-/Löschgarantie über die externe API gibt es nicht.

Der Bot muss den gewählten Channel sehen und darin Nachrichten senden können. Nachrichten werden mit einer expliziten Benutzerliste gesendet, die ausschließlich die Discord-ID des eingestellten Agents enthält – ohne Rollen und ohne `@everyone`. Grundlage: [Discord-Nachrichten-API](https://docs.discord.com/developers/resources/message).

`npx tsx --test tests/hire-ping.test.ts` prüft Reihenfolge, Vermeidung doppelter Pings und das Beibehalten des Löschauftrags bei Discord-Fehlern. Es wurden keine echten Pings zum Testen versendet.
