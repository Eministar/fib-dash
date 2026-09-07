# Hosting auf Plesk (Node.js)

Die Windows-Deploy-Skripte (`deploy.bat` / `deploy.ps1`) sind nur für deinen lokalen Rechner. Auf dem Plesk-Server (Linux) läuft alles über **npm** und die **Plesk Node.js**-Integration.

## Warum `npm start` nur `next start` ist

Ein typischer Plesk-Prozess startet die App bei jedem Deploy und bei Problemen **neu**. Das alte `start`-Skript hat dabei bei **jedem** Start ein `db push --accept-data-loss` und **Seed** ausgeführt — das ist für eine echte Datenbank unbrauchbar und kann Daten gefährden.

- **Produktion / Plesk:** `npm start` → nur `next start` (bindet standardmäßig an `0.0.0.0`, Port über `PORT` oder `-p`).
- **Optional (nur wenn du genau das willst, z. B. Demo):**  
  `npm run start:with-migrate-and-seed`

Schema-Updates laufen im Windows-Update-Skript `scripts/live-update.bat` vor dem Build. Beim reinen App-Start darf kein `npm`/`npx` laufen, weil iisnode sonst vor dem Next-Server crashen kann und IIS nur `500 - Internal Server Error` zeigt.

Schema/Seed für die **erste** Einrichtung einmal per Konsole ausführen, nicht im Startbefehl:

```bash
npm run db:push
npm run db:seed
```

## Warum Plesk nach einer „komischen“ `server.js` verlangt

Die **Node.js-Anwendungs**-Maske ist für klassische Apps gebaut (eine `.js`-Datei, oft **Application Startup File:** `server.js`). **Next.js** hat keinen solchen Einstieg aus dem Repo – Produktion ist **`npm run build`** und dann **`next start`** über die eingebaute CLI.

Üblich sind zwei Varianten:

- **Startup-Datei** wie im Repo: **`start.js`** (gleicher Start wie `next start`; **Port** weiter über **`PORT`**, wie Plesk ihn setzt). In der Plesk-Maske **Application Startup File** auf **`start.js`** setzen — nicht einen leeren `server.js` verwenden.
- Oder dort, wo unterstützt: Start über **`npm`** / **`start`** ohne eigene `.js`-Datei.

Siehe auch: [Tenbyte – Next.js 15 & 16 auf Plesk](https://tenbyte.de/blog/run-next-js-15-and-16-on-plesk-with-nodejs); für **Static Assets**: **Document Root** oft auf **`…/PfadProjekt/.next/static`** (relativ zum Anwendungsstamm).

Bei weißer/leerer Seite oder kaputten CSS-Dateien: Document Root `.next/static` prüfen. In **Apache & nginx** evtl. **Proxy-Modus** für die Domain wie in der [Plesk-Doku zu Next.js](https://support.plesk.com/hc/en-us/articles/16950957557783).

## Checkliste Plesk

1. **Node.js 22** im Plesk-Abonnement aktivieren (passend zu `"engines": { "node": "22.x" }` in `package.json`).
2. **Anwendungsstamm** = Verzeichnis mit `package.json` (z. B. Git-Checkout oder Upload dieses Ordners — **ohne** Windows-`node_modules` von zu Hause).
3. **Installation auf dem Server** (Linux), damit Prisma/Native-Module für **Linux** gebaut werden:
   - `npm ci` oder `npm install`
   - nicht `node_modules` von Windows hochladen.
4. **Umgebungsvariablen** in Plesk (Domain → Node.js / Umgebungsvariablen), mindestens:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - ggf. weitere aus `.env.example`
5. **Build** auf dem Server (nach Pull/Upload):
   - `npm run build`
6. **Start:** Entweder **Application Startup File** = **`start.js`** (wie in diesem Repo) **oder**, falls die Oberfläche es hergibt, **`npm`** mit Script **`start`**. **`PORT`** setzt Plesk meist automatisch — `start.js` liest ihn (nicht einen festen Port hardcodieren).

`src/generated/prisma` wird nicht versioniert. `npm install`/`npm run build` erzeugt den Prisma-Client normalerweise automatisch. Falls Plesk den Prozess ohne vorherigen Build startet, erzeugt `start.js` den fehlenden Prisma-Client einmalig direkt über das lokal installierte Prisma CLI nach.

## Datenbank

MySQL/MariaDB muss für die App erreichbar sein (bei vielen Hosting-Paketen **localhost** und Port **3306** mit Nutzer wie in der Plesk-DB-Verwaltung angelegt).

## Uploads ohne Rebuild-404

Uploads dürfen in Produktion nicht im Build-Output liegen. Die App schreibt Dateien in `UPLOAD_DIR` und liefert sie über `/uploads/<dateiname>` dynamisch aus. Dadurch muss nach einem Upload **kein** `npm run build` laufen.

Empfohlen in Plesk:

- Einen persistenten Ordner außerhalb des Deploy-/Build-Outputs anlegen, z. B. `private/uploads`.
- In den Node.js-Umgebungsvariablen setzen:

```bash
UPLOAD_DIR="/var/www/vhosts/deine-domain.tld/private/uploads"
```

Wenn `UPLOAD_DIR` leer ist, nutzt die App `./uploads` im Anwendungsstamm. Das funktioniert lokal, ist für Deployments aber nur dann sicher, wenn dieser Ordner beim Git-Pull/Upload nicht gelöscht wird.

Alte Dateien aus `public/uploads` bei Bedarf einmalig in den neuen `UPLOAD_DIR` verschieben. Die URLs bleiben gleich (`/uploads/<dateiname>`).

## Kurz: Deploy-Zyklus

```bash
git pull origin main    # oder dein Branch
npm ci
npm run db:push
npm run build
# App in Plesk neu starten (Button / „restart“)
```

Bei Schema-Änderungen: `npm run db:push`, dann bauen/neu starten.
Die Datenmigration für bestehende Units liegt unter `prisma/migrations/20260827_group_existing_units/migration.sql`.
`npx prisma migrate deploy` ist für dieses Projekt nicht der vorgesehene Rollout-Weg, weil die Produktion mit
`db push` betrieben wird. Ein alter fehlgeschlagener Migrationseintrag kann
deshalb bei `migrate deploy` mit `P3009` erscheinen, ohne den normalen Deploy zu
blockieren.

## 404 auf `/_next/static/...` oder leere Seite mit Fehlern in der Konsole

1. **Projektverzeichnis:** `start.js` übergibt Next den Ordner von `start.js` als App-Root (nicht `process.cwd()`). Ohne das liefert Plesk oft ein falsches **Working Directory** → Build wird nicht gefunden.
2. **Build auf dem Server:** `npm run build` muss **auf Linux** im Anwendungsstamm gelaufen sein; nach Deploy fehlt sonst `.next` oder ist veraltet.
3. **Document Root / Nginx:** Wenn **Document Root** auf `…/.next/static` steht, muss dein Webserver die URL `/_next/static/…` wirklich auf diesen Ordner abbilden. Viele Setups lassen **alles** an den Node-Prozess gehen — dann **Application Root** = Ordner mit `package.json` / `start.js`, **kein** getrenntes Ausliefern alter Pfade testen. Weiße Seite: [Plesk-Hinweis zu Next.js / Proxy](https://support.plesk.com/hc/en-us/articles/16950957557783).
4. **Im Browser (F12 → Netzwerk):** die **genaue URL** des 404 notieren (z. B. `/favicon.ico` ist oft harmlos; fehlende `/_next/static/chunks/...` ist kritisch).

## Windows IIS / iisnode

**iisnode** setzt `process.env.PORT` auf eine **Windows-Named Pipe** (`\\.\pipe\...`), keine TCP-Zahl. `start.js` erkennt das und nutzt einen **programmatischen Next‑Server**, der **`http.createServer(...).listen(pipe)`** nutzt — so wie iisnode es erwartet. Ohne diese Pipe lauscht die App nirgends, wo IIS anbindet → 500.

- Im Repo: **`web.config`** für IIS/iisnode (URL Rewrite alle Anfragen → `start.js`, Handler registriert). Im **Website-/`httpdocs`-Ordner** neben `start.js` ablegen; **URL-Rewrite-Modul** und **iisnode** müssen installiert sein.
- Vorher auf dem Server: **`npm install`**, **`npm run build`**. `devErrorsEnabled` in `web.config` kann man bei Fehlersuche auf `true` stellen (`false` zeigt weniger Details in Production).
