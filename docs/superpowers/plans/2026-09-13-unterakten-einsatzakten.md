# Unterakten zu Einsatzakten — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unterakten (`Dossier.kind = 'FILE'`) verschwinden als eigener Begriff; ihre Inhalte werden zu Einsatzakten (`Investigation`), Fahrzeugakten werden bearbeitbar.

**Architecture:** Die Umwandlungslogik liegt als reine Funktionen in `src/lib/dossier-migration.ts` und ist ohne Datenbank testbar. Ein Skript unter `scripts/` führt sie gegen die echte Datenbank aus — Dry-Run als Standard, Schreiben nur mit `--apply`. Erst nach erfolgreicher Migration fällt `FILE` aus Zod-Enums und Oberfläche.

**Tech Stack:** Next.js 15 App Router, Prisma 7 mit MariaDB-Adapter, Zod, `tsx --test` (node:test), React 19.

**Spec:** `docs/superpowers/specs/2026-09-13-unterakten-einsatzakten-design.md`

## Global Constraints

- Datenbestand (Dry-Run vom 2026-09-13): 18 Dossiers, davon **5 mit `kind='FILE'`**, **keine davon mit Kind-Akten**. 11 `Investigation` (6 Verschlusssachen). 2 `RecordShareItem` mit `kind='DOSSIER'`.
- Alle Nutzertexte auf Deutsch, Du-Form, wie im übrigen Ermittlungsbereich.
- Aktenzeichenformat `ERM-0001` über `formatSequenceNumber(INVESTIGATION_CASE_PREFIX, n)` aus `src/lib/sequence-numbers.ts`.
- Personenrolle bei der Migration ist `OTHER`, niemals der Prisma-Default `SUSPECT`.
- Schreibläufe laufen in einer Transaktion mit `Prisma.TransactionIsolationLevel.Serializable`.
- Kein Schema-Änderung, kein SQL-Patch: `Dossier.kind` ist ein freies `VARCHAR(20)`.
- Skripte laden die Umgebung wie `scripts/link-users-to-agents.ts`: `dotenv.config('.env.local')`, dann `.env` mit `override: false`, danach eigener `PrismaClient` mit `PrismaMariaDb`.

---

### Task 1: Reine Migrationslogik

**Files:**
- Create: `src/lib/dossier-migration.ts`
- Test: `tests/dossier-migration.test.ts`

**Interfaces:**
- Produces:
  - `type MigratableDossier = { id: string; kind: string; parentId: string | null }`
  - `resolveAnchor(id: string, byId: Map<string, MigratableDossier>): string | null`
  - `planDossierMigration(dossiers: MigratableDossier[]): { conversions: { id: string; anchorId: string | null }[]; reparents: { id: string; anchorId: string | null }[] }`
  - `migratedSummary(description: string | null, address: string | null): string | null`
  - `planShareItemRewrites(items, mapping, existingKeys): { updates: {...}[]; deletes: string[] }`

- [ ] **Step 1: Tests schreiben** — Ankerbestimmung (FILE unter COLLECTION, FILE-Kette, FILE auf Wurzelebene, Nicht-FILE-Kind unter FILE), `migratedSummary` (nur Beschreibung / nur Adresse / beides / nichts), Freigabe-Umschreibung inkl. Unique-Kollision.
- [ ] **Step 2: `npx tsx --test tests/dossier-migration.test.ts` → muss fehlschlagen (Modul fehlt).**
- [ ] **Step 3: `src/lib/dossier-migration.ts` implementieren.** Zyklenschutz beim Hochlaufen über ein `visited`-Set, Obergrenze 30 Ebenen wie `validateDossierParent`.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit.**

### Task 2: Migrationsskript

**Files:**
- Create: `scripts/migrate-unterakten-to-einsatzakten.ts`
- Modify: `package.json` (`db:migrate-unterakten`)

**Interfaces:**
- Consumes: alles aus Task 1, `INVESTIGATION_CASE_PREFIX` und `formatSequenceNumber`.

- [ ] **Step 1: Skript schreiben.** Reihenfolge: Anker bestimmen → Kinder umhängen → `Investigation` anlegen (Aktenzeichen fortlaufend aus **einem** gelesenen Höchstwert hochzählen, nicht pro Datensatz neu lesen) → Relationen setzen → Freigabe-Einträge umschreiben → FILE-Dossiers löschen.
- [ ] **Step 2: `npm run db:migrate-unterakten` (Dry-Run) — Report prüfen: 5 Umwandlungen, 0 Umhängungen erwartet.**
- [ ] **Step 3: Commit (noch ohne `--apply`).**
- [ ] **Step 4: `npm run db:backup`, dann `npm run db:migrate-unterakten -- --apply`.**
- [ ] **Step 5: Kontrolllauf — erneuter Dry-Run muss „nichts zu tun" melden.**

### Task 3: `FILE` aus Code und Oberfläche

**Files:**
- Modify: `src/lib/dossiers.ts`, `src/lib/dossiers-server.ts`, `src/app/api/investigations/dossiers/route.ts`, `src/app/api/investigations/dossiers/[id]/route.ts`, `src/components/investigations/dossiers-workspace.tsx`, `src/lib/record-share-validation.ts`, `src/components/investigations/share-manager.tsx`

- [ ] **Step 1: Enums und Labels anpassen** (Liste siehe Spec, Teil 2).
- [ ] **Step 2: `npx tsc --noEmit` und `npm run lint` — müssen sauber sein.**
- [ ] **Step 3: Commit.**

### Task 4: Fahrzeugakten bearbeiten

**Files:**
- Create: `src/components/investigations/vehicle-form.tsx`
- Modify: `src/components/investigations/vehicle-register.tsx`

- [ ] **Step 1: Formularfelder aus dem Anlege-Modal nach `vehicle-form.tsx` ziehen** (Kennzeichen, Modell, Farbe, Halter, Foto, Notizen, Gestohlen, Fahndung) und im Anlege-Modal von dort verwenden — unverändertes Verhalten.
- [ ] **Step 2: Bearbeiten-Modus im Detail-Modal**, `PATCH /api/vehicles/[id]`, sichtbar mit `investigations:manage`.
- [ ] **Step 3: Löschen hinter Bestätigung**, sichtbar mit `investigations:delete`.
- [ ] **Step 4: `npx tsc --noEmit`, `npm run lint`.**
- [ ] **Step 5: Commit.**

### Task 5: Leere Einsatzakten-Liste in der Linkfreigabe

**Files:**
- Modify: `src/lib/record-shares.ts` oder `src/components/investigations/share-manager.tsx` — abhängig vom Befund.
- Test: `tests/record-shares.test.ts`

- [ ] **Step 1: Reproduktion.** Datenbankseitig bereits ausgeschlossen (11 Einsatzakten, `findMany` liefert alle). Verbleibende Kandidaten: Zustandswechsel des Bereichs-Dropdowns im Modal, oder ein veralteter Stand auf dem Server. Ohne Reproduktion wird nichts geändert.
- [ ] **Step 2: Fix plus Regressionstest — erst nach Schritt 1.**

## Reihenfolge

Task 1 → 2 (inkl. `--apply`) → 3. Task 4 ist unabhängig. Task 5 hängt an der Reproduktion.
