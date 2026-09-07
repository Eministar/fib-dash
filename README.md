<div align="center">

  <!-- Schöner Header-Banner (Capsule Render) — Navy + Gold, FIB-Vibe -->
  <img
    width="100%"
    src="https://capsule-render.vercel.app/api?type=waving&height=200&color=0:061426,100:0a1e38&text=FIB%20HR%20Dashboard&fontSize=34&fontColor=d4af37&fontAlignY=36&desc=Personalverwaltung%20%E2%80%94%20Los%20Santos%20Police%20Department&descSize=12&descAlignY=58&section=header"
    alt="FIB HR Dashboard — Banner"
  />

  <br /><br />

  <sub>🚓 🚔 ✨ <strong> Federal Investigation Bureau</strong> · HR & Personal · FiveM-Ready ✨ 🚔 🚓</sub>

  <br /><br />

  <p>
    <a href="https://fib-demo.star-dev.xyz/">
      <img src="https://img.shields.io/badge/🌐_LIVE--DEMO-059669?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=064e3b" alt="Live Demo" />
    </a>
    <a href="https://nextjs.org/">
      <img src="https://img.shields.io/badge/⚡_Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
    </a>
    <a href="https://www.typescriptlang.org/">
      <img src="https://img.shields.io/badge/🛡️_TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
    </a>
    <a href="https://www.prisma.io/">
      <img src="https://img.shields.io/badge/◆_Prisma%207-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma" />
    </a>
  </p>

  <b>Modernes Web-Dashboard</b> für Ränge, Roster, Beförderungen, Ausbildungen &amp; Protokoll —<br />
  gebaut mit Liebe zum Detail und einem dunkel-goldenen <i>Premium-UI</i>.

  <p>
    <a href="https://fib-demo.star-dev.xyz/"><b>➡️ Demo in neuem Tab öffnen</b></a>
  </p>

  <p><sub>🔒 Nur Demo-Instanz — keine echten Dienstdaten</sub></p>

  <br />

  <a href="https://github.com/Eministar/fib-hr">
    <img src="https://img.shields.io/badge/⭐_Star_auf_GitHub-0d1b2a?style=for-the-badge&logo=github&logoColor=gold" alt="GitHub Repository" />
  </a>

</div>

---

## 🎯 · Live · Demo

### 🌐 Einsteigen

| | |
| :-- | :-- |
| **Link** | [**fib-demo.star-dev.xyz**](https://fib-demo.star-dev.xyz/) |
| **Was?** | Interaktiv — Dashboard, Roster, Admin, UI ausprobieren |

### 🔑 Demo-Login

| | |
| :--: | :-- |


*Dieselben Werte legt `prisma/seed.ts` an — lokal identisch, wenn du seetest.*

> ⚠️ **Hinweis · Demo**  
> Daten können **jederzeit zurückgesetzt** werden. Bitte **keine echten** Passwörter oder realen personenbezogenen Daten eintragen — es ist **nur eine Spiel-/Vorschau-Umgebung**.

---

## ✨ · Features · im Überblick

| | Feature | Kurz & knackig |
| :-: | --- | --- |
| 📊 | **Dashboard** | Kennzahlen, Dienstbereitschaft, Ausbildung, Ränge, Aktivität |
| 👮 | **Officer-Roster** | Suche, Filter, Units, Bearbeiten |
| 🗃️ | **Gekündigte Officers** | eigener Bereich außerhalb der normalen Officer-Liste |
| ⬆️ | **Beförderungen** | Listen, Historie, Workflows |
| ⬇️ | **Degradierungen** | Listen & Übersicht |
| 🏁 | **Kündigungen** | inkl. Wiedereingliederung |
| 📝 | **Notizen** | global & pro Officer |
| ✅ | **Aufgaben** | Academy, HR und SRU |
| ⚙️ | **Admin** | Ränge, Ausbildungen, Units, Benutzergruppen, Benutzer, Einstellungen |
| 📜 | **Protokoll** | Audit-Log |
| 🎨 | **UI** | Dark-Mode, Glaspanele, **Gold-Akzente** · responsive |
| 🔐 | **Auth** | JWT und frei konfigurierbare Benutzergruppen |
| 🌐 | **Öffentliche Ansicht** | `/public/officers` zeigt Officers ohne Anmeldung im Lesemodus |
| 🔌 | **Public API** | Jede Funktion per HTTP · OpenAPI 3.1 · Bearer-Tokens · Try-it-out unter `/docs` |

---

## 🔌 · Public API · alles per HTTP

> **Jede Dashboard-Funktion** ist auch über die HTTP-API verfügbar. So kannst du Discord-Bots, FiveM-Skripte, CI-Pipelines, Mobile Apps etc. anbinden, ohne das Dashboard zu bemühen.

### Endpoints (Auszug)

| Methode | Pfad | Beschreibung |
| :-- | :-- | --- |
| `GET` / `POST` | `/api/officers` | Officers listen / anlegen (auto-Dienstnummer) |
| `PATCH` | `/api/officers/{id}` | Officer bearbeiten |
| `POST` | `/api/officers/{id}/move` | Officer in Unit verschieben |
| `POST` | `/api/sanctions` | Sanktion ausstellen |
| `GET` / `POST` | `/api/rank-change-lists` | Beförderungs-/Degradierungs-Listen |
| `POST` | `/api/rank-change-lists/{id}/execute` | Liste ausführen |
| `POST` | `/api/terminations` | Officer kündigen |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/calendar-events` | Kalender |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/notes` | Notizen |
| `GET` / `POST` | `/api/task-lists`, `/api/tasks` | Aufgaben (Academy / HR / SRU / Detective) |
| `GET` / `POST` | `/api/sru/folders`, `/api/sru/documents` | S.R.U.-Dokumente |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/patrol-boards`, `/api/patrol-boards/{id}` | Vollständiges Streifenboard-CRUD |
| `GET` | `/api/audit-logs` | Vollständiges Aktivitätsprotokoll |
| `GET` / `POST` | `/api/api-tokens`, `DELETE /api/api-tokens/{id}` | Token-Management |
| `GET` | `/api/health` | Health-Check (kein Auth nötig) |
| `GET` | `/api/public/officers` | Public Officer-Liste (kein Auth nötig) |

Vollständige Liste inkl. Parametern, Body-Schemas und Try-it-out: **`/docs`** im Dashboard.

### Authentifizierung

```bash
curl https://deine-domain/api/officers \
  -H "Authorization: Bearer fib_DEIN_TOKEN"
```

**Token erstellen**

1. Dashboard → **Admin → API-Tokens → „Neuer Token"**
2. Scope wählen (leer = alle deinen Rechte) — der Token erbt **niemals** mehr Rechte als du selbst hast
3. Optional Ablaufdatum (`30 Tage / 90 Tage / 1 Jahr / Nie`)
4. Klartext-Token wird **einmalig** angezeigt — sicher speichern (z. B. in einem Secrets-Manager)

### Features

- **Bearer-Token** mit Prefix `fib_` — SHA-256-Hash wird gespeichert, Klartext nie.
- **Scopes**: pro Token frei wählbar (z. B. nur `officers:view` für ein Read-Only-Skript).
- **Ablaufdatum** optional (oder unbegrenzt).
- **Usage-Tracking**: `lastUsedAt`, `usageCount`, detaillierte `ApiTokenUsage`-Logs (Methode, Pfad, Status, Dauer, IP).
- **Revoke**: ein Klick im Dashboard — der Token ist sofort ungültig.
- **OpenAPI 3.1 Spec**: unter `/api/v1/openapi.json` — direkt in Postman / Insomnia / Swagger UI importierbar.
- **CORS**: Proxy reflektiert Origins (per Default permissiv, via `FIB_API_CORS_ALLOWED_ORIGINS` einschränkbar).
- **Audit-Log**: jede Token-Erstellung / Revoke landet im zentralen Protokoll.

### Beispiele

```bash
# Neuen Officer anlegen
curl -X POST https://deine-domain/api/officers \
  -H "Authorization: Bearer fib_…" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Max","lastName":"Muster","rankId":"ckxyz…"}'

# Sanktion ausstellen
curl -X POST https://deine-domain/api/sanctions \
  -H "Authorization: Bearer fib_…" \
  -H "Content-Type: application/json" \
  -d '{"officerId":"ckabc…","reason":"Dienstvergehen","penalGrade":"III","measureType":"SG_ROUNDS","deadlineDays":14}'

# Beförderungs-Liste ausführen
curl -X POST https://deine-domain/api/rank-change-lists/{id}/execute \
  -H "Authorization: Bearer fib_…"
```

---

## 🛠️ · Tech-Stack

```
┌─────────────────────────────────────────────────────┐
│  Next.js  ·  TypeScript  ·  Tailwind 4              │
│  Prisma 7  ·  MySQL/MariaDB  ·  Radix  ·  Motion    │
└─────────────────────────────────────────────────────┘
```

| | |
| :--: | :-- |
| **⚡ Framework** | [Next.js](https://nextjs.org/) (App Router) |
| **📦 Sprache** | TypeScript |
| **🎨 Styling** | Tailwind CSS 4 |
| **🗄️ Datenbank** | **MySQL / MariaDB** |
| **🧩 ORM** | Prisma 7 |
| **🔒 Auth** | JWT · httpOnly-Cookie · **API-Token (Bearer)** |
| **🧱 UI-Toolkit** | Radix UI, Framer Motion, Lucide |

---

## 🚀 · Lokal starten

### Checkliste

- ✔️ **Node.js 22** (laut `engines` in `package.json`)
- ✔️ **MySQL** oder **MariaDB** erreichbar

### 🧰 Setup-Befehle

```bash
# 📥 Repository klonen
git clone https://github.com/Eministar/fib-hr.git
cd fib-hr

# 📦 Dependencies
npm install

# 🔧 .env anlegen (siehe .env.example)
cp .env.example .env
# → DATABASE_URL + JWT_SECRET setzen

# 🗃️ Prisma + Datenbank
npm run db:generate
npm run db:push
npm run db:seed

# ▶️ Dev-Server
npm run dev
```

Dann: **http://localhost:3000** — Login nach Seed: `admin` / `admin123`

### 📋 Scripts

| Befehl | ✨ Wofür? |
| --- | --- |
| `npm run dev` | DB sync + Prisma + Next (Dev) |
| `npm run build` | Produktions-Build |
| `npm run db:push` | Schema an die DB |
| `npm run db:seed` | Admin, Ränge, Ausbildungen, Units, Benutzergruppen |
| `npm run db:studio` | Prisma Studio |

---

## 🛡️ · Sicherheit (Production)

- 🔐 **`JWT_SECRET`** — stark, zufällig, **nur** in `.env`, **niemals** im Repo
- 🚫 **Default-Login** `admin` / `admin123` in Produktion **deaktivieren** oder ersetzen
- ☁️ Secrets nur per **Hostinger / PaaS / Secret-Manager**

---

## 🚢 · Deployment-Optionen

Mehrere vorkonfigurierte Deployment-Pfade stehen zur Verfügung:

| Ziel | Datei | Anweisung |
| :-- | :-- | :-- |
| **Plesk / IIS** | `PLESK.md`, `web.config`, `start.js` | Siehe `PLESK.md` — Klassischer Windows-Server mit NodeJS-Plugin |
| **Docker (standalone)** | `Dockerfile`, `.dockerignore` | `docker build -t fib-hr . && docker run -p 3000:3000 fib-hr` |
| **Docker Compose** | `docker-compose.yml` | `docker compose up -d` (inkl. MariaDB) |
| **Nixpacks** (Railway, Render, Coolify, Fly.io) | `nixpacks.toml` | Auto-detected, kein zusätzlicher Config nötig |
| **Heroku / Dokku / Scalingo** | `Procfile` | Standard-Node-Buildpack |
| **PM2 / systemd** | `start.js` + `npm run start` | Siehe `PLESK.md` für PM2-Konfiguration |

### System-Update aus dem Dashboard

Administratoren mit `users:manage` können One-Click-Updates aus dem Dashboard heraus ausführen:
**Admin → System-Update → „Update starten"**.

Der Workflow:
1. `git pull --ff-only`
2. `npm install --omit=dev`
3. `npx prisma generate` + `npx prisma db push`
4. `npm run build`
5. Automatischer Neustart (PM2 / Docker / manuell)

Während des Updates wird die Seite kurz nicht erreichbar (~30–120 Sekunden). Der Browser lädt automatisch neu, sobald `/api/health` wieder `200` zurückgibt. Live-Logs werden in Echtzeit per Server-Sent-Events gestreamt.

> ⚠️ **Hinweis:** Funktioniert nur, wenn das Projekt via Git ausgecheckt ist und der Node-Prozess Schreibrechte im Projektverzeichnis hat. Auf stark restriktiven Shared-Hostern ggf. nicht verfügbar — in dem Fall manuell deployen.

---

## 💜 · Credits

| | |
| :--: | :--: |
| **Coded with** | **&lt;3** |
| **by** | **[Eministar](https://eministar.dev)** · [GitHub](https://github.com/Eministar) |

> *Für FIB- & FiveM-Roleplay-Setups, die Wert auf klare Struktur legen.*

➡️ **Repo:** [github.com/Eministar/fib-hr](https://github.com/Eministar/fib-hr)  
➡️ **Demo:** [fib-demo.star-dev.xyz](https://fib-demo.star-dev.xyz/)

<div align="center">
  <br />
  <img
    width="100%"
    src="https://capsule-render.vercel.app/api?type=waving&height=120&color=0:0a1e38,100:061426&section=footer&text=Thanks%20for%20visiting!&fontSize=20&fontColor=d4af37&fontAlignY=78&desc=Stay%20safe%20%E2%80%94%20FIB%20RP&descSize=10&descAlignY=52&reversal=true"
    alt="Footer Banner"
  />
  <p><sub>⭐ Wenn’s hilft — gerne ein Stern auf GitHub ⭐</sub></p>
</div>
