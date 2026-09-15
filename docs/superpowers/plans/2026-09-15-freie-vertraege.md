# Freie Verträge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein von HR und Agents unabhängiges Modul, in dem Verträge frei aufgesetzt und von beliebig vielen Parteien per Link unterschrieben werden.

**Architecture:** Drei neue Prisma-Modelle (`Agreement`, `AgreementParty`, `AgreementTemplate`). Reine Logik in `src/lib/agreements.ts`, Datenbanklogik in `src/lib/agreement-service.ts`, HTTP-Fehlerabbildung in `src/lib/agreement-http.ts`. Interne API unter `/api/agreements*`, öffentliche unter `/api/agreement-links/[token]`. Oberfläche: Dashboard-Seite `/vertraege`, öffentliche Seite `/unterschrift/[token]`, Dokument-Renderer auf Basis der vorhandenen `contract-*`-CSS-Klassen.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 7 (MariaDB, `prisma db push`), zod 4, `tsx --test` mit `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-15-freie-vertraege-design.md`

## Global Constraints

- Keine Verbindung zu `Agent`, `Contract`, `ContractTemplate`, `ContractSignature`, Discord-Versand oder `hr:*`/`contracts:*`-Rechten.
- Rechte: `agreements:view` („Freie Verträge ansehen“), `agreements:manage` („Freie Verträge und Vorlagen verwalten“, impliziert `agreements:view`).
- Status: `DRAFT | OPEN | SIGNED | DECLINED | CANCELLED`. Briefkopf: `FIB | NEUTRAL`.
- Tokens: `randomBytes(32).toString('base64url')`, Klartext in `AgreementParty.token`, nach Lookup exakter Vergleich `party.token === token`.
- Öffentliche Antworten enthalten nie Tokens, IP oder User-Agent anderer Parteien und laufen durch `publicShareHeaders` aus `src/lib/record-shares.ts`.
- `ContractDocument` und alle bestehenden Vertragsdateien bleiben unverändert.
- Oberflächentexte auf Deutsch. Code-Kommentare auf Deutsch, sparsam, im Stil des Repos.
- Datenbanktests importieren zuerst `./db-env` (Testdatenbank aus `.env.test`).
- Schemaänderungen nur additiv; `npx prisma db push` gegen die Testdatenbank. Die Hauptdatenbank pusht der Nutzer selbst (`npm run db:push`, legt vorher ein Backup an).

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `prisma/schema.prisma` (ändern) | Modelle `Agreement`, `AgreementParty`, `AgreementTemplate`; Rückrelationen auf `User` |
| `src/lib/permissions.ts` (ändern) | Rechte `agreements:view`, `agreements:manage` |
| `src/lib/agreements.ts` (neu) | Status/Briefkopf-Konstanten, `deriveAgreementStatus`, zod-Schemas. Keine Node-Imports |
| `src/lib/agreement-service.ts` (neu) | Alle Prisma-Zugriffe: CRUD, Freigeben, Zurückziehen, Duplizieren, Tokens, Unterschreiben, Vorlagen |
| `src/lib/agreement-http.ts` (neu) | `agreementErrorResponse` für Routen |
| `src/app/api/agreements/**` (neu) | Interne Vertrags-API |
| `src/app/api/agreement-templates/**` (neu) | Interne Vorlagen-API |
| `src/app/api/agreement-links/[token]/route.ts` (neu) | Öffentliche Link-API |
| `src/components/agreements/agreement-document.tsx` (neu) | Dokument-Renderer |
| `src/components/agreements/agreement-editor.tsx` (neu) | Editor für Vertrag und Vorlage |
| `src/components/agreements/agreements-workspace.tsx` (neu) | Listen, Detailansicht, Aktionen, Vorlagen-Tab |
| `src/app/(dashboard)/vertraege/page.tsx` (neu) | Seite, Rechteprüfung |
| `src/app/unterschrift/[token]/page.tsx` (neu) | Öffentliche Unterschriftsseite |
| `src/components/layout/sidebar.tsx` (ändern) | Menüpunkt „Verträge“ |
| `tests/agreements.test.ts` (neu) | Tests ohne Datenbank |
| `tests/agreements-db.test.ts` (neu) | Tests mit Testdatenbank |

---

### Task 1: Schema und Rechte

**Files:**
- Modify: `prisma/schema.prisma` (Modell `User` ab Zeile 220; neue Modelle ans Dateiende)
- Modify: `src/lib/permissions.ts:35-36`, `:110-111`, `:188`

**Interfaces:**
- Produces: Prisma-Delegates `prisma.agreement`, `prisma.agreementParty`, `prisma.agreementTemplate`; Typ `Prisma.AgreementSelect`; Permission-Strings `'agreements:view'`, `'agreements:manage'`.

- [ ] **Step 1: Modelle ans Ende von `prisma/schema.prisma` anhängen**

```prisma
/// Frei aufgesetzter Vertrag, unabhängig von HR und Agents.
model Agreement {
  id          String             @id @default(cuid())
  title       String             @db.VarChar(200)
  /// DRAFT | OPEN | SIGNED | DECLINED | CANCELLED
  status      String             @default("DRAFT") @db.VarChar(20)
  /// FIB | NEUTRAL
  letterhead  String             @default("FIB") @db.VarChar(20)
  /// Präambel (Markdown).
  content     String             @db.Text
  /// [{ id, title, body, sortOrder }] – gleiche Form wie ContractClause.
  clauses     Json
  closing     String?            @db.Text
  /// Nur Herkunftsanzeige, keine Bindung an die Vorlage.
  templateId  String?
  template    AgreementTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  releasedAt  DateTime?
  cancelledAt DateTime?
  createdById String?
  createdBy   User?              @relation("AgreementCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  parties AgreementParty[]

  @@index([status, updatedAt])
  @@index([templateId])
  @@index([createdById])
}

/// Vertragspartei mit eigenem Unterschrifts-Link.
model AgreementParty {
  id          String    @id @default(cuid())
  agreementId String
  agreement   Agreement @relation(fields: [agreementId], references: [id], onDelete: Cascade)
  name        String    @db.VarChar(200)
  role        String?   @db.VarChar(200)
  sortOrder   Int       @default(0)
  /// base64url aus 32 Byte, bewusst im Klartext (Link jederzeit kopierbar).
  token       String    @unique @db.VarChar(64)

  signedAt        DateTime?
  signedName      String?   @db.VarChar(200)
  signedIp        String?   @db.VarChar(64)
  signedUserAgent String?   @db.VarChar(200)
  declinedAt      DateTime?
  declineReason   String?   @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([agreementId, sortOrder])
}

/// Vorlage für freie Verträge – getrennt von ContractTemplate.
model AgreementTemplate {
  id          String   @id @default(cuid())
  name        String   @db.VarChar(120)
  letterhead  String   @default("FIB") @db.VarChar(20)
  content     String   @db.Text
  clauses     Json
  closing     String?  @db.Text
  createdById String?
  createdBy   User?    @relation("AgreementTemplateCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  agreements Agreement[]

  @@index([createdById])
}
```

- [ ] **Step 2: Rückrelationen im Modell `User` ergänzen** (direkt unter `contractSignaturesSigned`)

```prisma
  agreementsCreated          Agreement[]               @relation("AgreementCreator")
  agreementTemplatesCreated  AgreementTemplate[]       @relation("AgreementTemplateCreator")
```

- [ ] **Step 3: Rechte in `src/lib/permissions.ts` eintragen**

In `PERMISSIONS` direkt nach `'contracts:manage',`:
```ts
  'agreements:view',
  'agreements:manage',
```
In `PERMISSION_LABELS` direkt nach `'contracts:manage': ...`:
```ts
  'agreements:view': 'Freie Verträge ansehen',
  'agreements:manage': 'Freie Verträge und Vorlagen verwalten',
```
In `IMPLIED_PERMISSIONS` direkt nach `'contracts:manage': [...]`:
```ts
  'agreements:manage': ['agreements:view'],
```

- [ ] **Step 4: Client generieren und Testdatenbank pushen**

```powershell
npx prisma generate
$env:DATABASE_URL = ((Get-Content .env.test) -match '^DATABASE_URL' -replace '^DATABASE_URL\s*=\s*"?([^"]+)"?$','$1'); npx prisma db push
```
Expected: „Your database is now in sync with your Prisma schema“.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: keine Ausgabe.

- [ ] **Step 6: Commit**

```powershell
git add prisma/schema.prisma src/lib/permissions.ts
git commit -m "feat(agreements): add schema and permissions for free agreements"
```

---

### Task 2: Reine Logik (`src/lib/agreements.ts`)

**Files:**
- Create: `src/lib/agreements.ts`
- Test: `tests/agreements.test.ts`

**Interfaces:**
- Consumes: `sanitizeContractClauses`, `type ContractClause` aus `src/lib/contracts.ts`.
- Produces:
  - `AGREEMENT_STATUSES`, `type AgreementStatus`, `isAgreementStatus(value: unknown): value is AgreementStatus`
  - `AGREEMENT_STATUS_META: Record<AgreementStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' }>`
  - `AGREEMENT_LETTERHEADS`, `type AgreementLetterhead`
  - `deriveAgreementStatus(current: AgreementStatus, parties: { signedAt: Date | string | null; declinedAt: Date | string | null }[]): AgreementStatus`
  - `agreementInputSchema`, `type AgreementInput` (`{ title; letterhead; content; clauses: unknown[]; closing?: string | null; templateId?: string | null; parties: { id?: string; name: string; role?: string | null }[] }`)
  - `templateInputSchema`, `type TemplateInput` (`{ name; letterhead; content; clauses: unknown[]; closing?: string | null }`)
  - `linkActionSchema`, `type LinkAction` (`{ action: 'sign'; name: string; confirmed: true } | { action: 'decline'; reason?: string }`)
  - `normalizeClauses(value: unknown): ContractClause[]`

- [ ] **Step 1: Failing test schreiben** (`tests/agreements.test.ts`)

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agreementInputSchema, deriveAgreementStatus, linkActionSchema } from '../src/lib/agreements'

const open = { signedAt: null, declinedAt: null }
const signed = { signedAt: new Date(), declinedAt: null }
const declined = { signedAt: null, declinedAt: new Date() }

test('Ein offener Vertrag ist erst unterschrieben, wenn alle Parteien unterschrieben haben', () => {
  assert.equal(deriveAgreementStatus('OPEN', [signed, open, signed]), 'OPEN')
  assert.equal(deriveAgreementStatus('OPEN', [signed, signed, signed]), 'SIGNED')
})

test('Eine Ablehnung setzt den Vertrag auf DECLINED, andere Status bleiben unberührt', () => {
  assert.equal(deriveAgreementStatus('OPEN', [signed, declined]), 'DECLINED')
  assert.equal(deriveAgreementStatus('DRAFT', [signed]), 'DRAFT')
  assert.equal(deriveAgreementStatus('CANCELLED', [signed]), 'CANCELLED')
  assert.equal(deriveAgreementStatus('OPEN', []), 'OPEN')
})

test('Eingaben: Titel und mindestens eine Partei sind Pflicht', () => {
  const base = { title: 'Kooperation', content: '', clauses: [], parties: [{ name: 'LSPD' }] }
  assert.equal(agreementInputSchema.safeParse(base).success, true)
  assert.equal(agreementInputSchema.parse(base).letterhead, 'FIB')
  assert.equal(agreementInputSchema.safeParse({ ...base, title: '  ' }).success, false)
  assert.equal(agreementInputSchema.safeParse({ ...base, parties: [] }).success, false)
  assert.equal(agreementInputSchema.safeParse({ ...base, letterhead: 'LSPD' }).success, false)
})

test('Unterschrift braucht vollständigen Namen und Lesebestätigung, Ablehnen nicht', () => {
  assert.equal(linkActionSchema.safeParse({ action: 'sign', name: 'Jo', confirmed: true }).success, false)
  assert.equal(linkActionSchema.safeParse({ action: 'sign', name: 'Jane Doe', confirmed: false }).success, false)
  assert.equal(linkActionSchema.safeParse({ action: 'sign', name: 'Jane Doe', confirmed: true }).success, true)
  assert.equal(linkActionSchema.safeParse({ action: 'decline' }).success, true)
})
```

- [ ] **Step 2: Test laufen lassen**

Run: `npx tsx --test tests/agreements.test.ts`
Expected: FAIL, Modul `../src/lib/agreements` nicht gefunden.

- [ ] **Step 3: `src/lib/agreements.ts` schreiben**

```ts
// Bewusst ohne Node-Imports: Client-Komponenten nutzen Status-Labels und Schemas.
import { z } from 'zod'
import { sanitizeContractClauses, type ContractClause } from './contracts'

export const AGREEMENT_STATUSES = ['DRAFT', 'OPEN', 'SIGNED', 'DECLINED', 'CANCELLED'] as const
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number]

export const AGREEMENT_STATUS_META: Record<AgreementStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' }> = {
  DRAFT: { label: 'Entwurf', variant: 'default' },
  OPEN: { label: 'Offen', variant: 'warning' },
  SIGNED: { label: 'Unterschrieben', variant: 'success' },
  DECLINED: { label: 'Abgelehnt', variant: 'danger' },
  CANCELLED: { label: 'Zurückgezogen', variant: 'default' },
}

export const AGREEMENT_LETTERHEADS = ['FIB', 'NEUTRAL'] as const
export type AgreementLetterhead = (typeof AGREEMENT_LETTERHEADS)[number]

export function isAgreementStatus(value: unknown): value is AgreementStatus {
  return typeof value === 'string' && (AGREEMENT_STATUSES as readonly string[]).includes(value)
}

type PartyState = { signedAt: Date | string | null; declinedAt: Date | string | null }

/** Nur ein offener Vertrag ändert seinen Status durch Unterschriften. */
export function deriveAgreementStatus(current: AgreementStatus, parties: PartyState[]): AgreementStatus {
  if (current !== 'OPEN') return current
  if (parties.some((party) => party.declinedAt)) return 'DECLINED'
  if (parties.length > 0 && parties.every((party) => party.signedAt)) return 'SIGNED'
  return 'OPEN'
}

export function normalizeClauses(value: unknown): ContractClause[] {
  return sanitizeContractClauses(value)
}

const partySchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1, 'Jede Partei braucht einen Namen').max(200),
  role: z.string().trim().max(200).nullish(),
})

export const agreementInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich').max(200),
    letterhead: z.enum(AGREEMENT_LETTERHEADS).default('FIB'),
    content: z.string().max(20000).default(''),
    clauses: z.array(z.unknown()).max(60).default([]),
    closing: z.string().max(20000).nullish(),
    templateId: z.string().max(64).nullish(),
    parties: z.array(partySchema).min(1, 'Mindestens eine Partei angeben').max(20),
  })
  .strict()
export type AgreementInput = z.infer<typeof agreementInputSchema>

export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name ist erforderlich').max(120),
    letterhead: z.enum(AGREEMENT_LETTERHEADS).default('FIB'),
    content: z.string().max(20000).default(''),
    clauses: z.array(z.unknown()).max(60).default([]),
    closing: z.string().max(20000).nullish(),
  })
  .strict()
export type TemplateInput = z.infer<typeof templateInputSchema>

export const linkActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('sign'),
    name: z.string().trim().min(3, 'Bitte den vollständigen Namen eintragen').max(200),
    confirmed: z.literal(true, { error: 'Bitte bestätigen, dass du den Vertrag gelesen hast' }),
  }),
  z.object({
    action: z.literal('decline'),
    reason: z.string().trim().max(1000).optional(),
  }),
])
export type LinkAction = z.infer<typeof linkActionSchema>
```

- [ ] **Step 4: Test laufen lassen**

Run: `npx tsx --test tests/agreements.test.ts`
Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/agreements.ts tests/agreements.test.ts
git commit -m "feat(agreements): add status derivation and input schemas"
```

---

### Task 3: Service (`src/lib/agreement-service.ts`)

**Files:**
- Create: `src/lib/agreement-service.ts`
- Modify: `tests/agreements.test.ts` (Token-Test anhängen)
- Test: `tests/agreements-db.test.ts`

**Interfaces:**
- Consumes: alles aus Task 2; `normalizeLinkToken` aus `src/lib/link-tokens.ts`; `prisma` aus `src/lib/prisma.ts`; `readContractClauses` aus `src/lib/contracts.ts`.
- Produces:
  - `class AgreementError extends Error { status: number }`
  - `createPartyToken(): string`
  - `agreementSelect`, `agreementListSelect`
  - `createAgreement(input: AgreementInput, userId: string | null)`
  - `updateAgreement(id: string, input: AgreementInput)`
  - `deleteAgreement(id: string): Promise<void>`
  - `releaseAgreement(id: string)`, `cancelAgreement(id: string)`, `duplicateAgreement(id: string, userId: string | null)` – alle liefern `agreementSelect`-Payload
  - `regeneratePartyToken(agreementId: string, partyId: string): Promise<string>`
  - `type LinkParty`, `loadPartyByToken(raw: string, lookup?: (token: string) => Promise<LinkParty | null>): Promise<LinkParty | null>`
  - `serializeLink(party: LinkParty)` → `{ party: { name; role; signedAt; signedName; declinedAt }; canSign: boolean; agreement: AgreementDocumentPayload }`
  - `signParty(token: string, input: { name: string; ip: string | null; userAgent: string | null }): Promise<AgreementStatus | null>`
  - `declineParty(token: string, reason: string | null): Promise<AgreementStatus | null>`
  - `createTemplate(input: TemplateInput, userId: string | null)`, `updateTemplate(id: string, input: TemplateInput)`, `deleteTemplate(id: string): Promise<void>`, `listTemplates()`

- [ ] **Step 1: Failing Token-Test an `tests/agreements.test.ts` anhängen**

```ts
import { loadPartyByToken, type LinkParty } from '../src/lib/agreement-service'

test('Ein Token mit abweichender Groß-/Kleinschreibung führt nie zu einer Partei', async () => {
  const stored = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE'
  const lookup = async () => ({ token: stored }) as unknown as LinkParty
  assert.equal(await loadPartyByToken(stored.toLowerCase(), lookup), null)
  assert.notEqual(await loadPartyByToken(stored, lookup), null)
  assert.notEqual(await loadPartyByToken(`https://x.example/unterschrift/${stored}.`, lookup), null)
  assert.equal(await loadPartyByToken('', lookup), null)
})
```
(Import an den Dateianfang zu den anderen Imports stellen.)

- [ ] **Step 2: Failing DB-Tests schreiben** (`tests/agreements-db.test.ts`)

```ts
// Muss vor jedem Prisma-Import stehen: setzt DATABASE_URL auf die Testdatenbank.
import './db-env'

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'

import { prisma } from '../src/lib/prisma'
import {
  AgreementError,
  cancelAgreement,
  createAgreement,
  createTemplate,
  declineParty,
  deleteAgreement,
  duplicateAgreement,
  loadPartyByToken,
  regeneratePartyToken,
  releaseAgreement,
  signParty,
  updateAgreement,
  updateTemplate,
} from '../src/lib/agreement-service'
import type { AgreementInput } from '../src/lib/agreements'

const created: string[] = []
const templates: string[] = []
after(async () => {
  await prisma.agreement.deleteMany({ where: { id: { in: created } } })
  await prisma.agreementTemplate.deleteMany({ where: { id: { in: templates } } })
  await prisma.$disconnect()
})

function input(parties = ['FIB', 'LSPD']): AgreementInput {
  return {
    title: `Test ${randomUUID().slice(0, 8)}`,
    letterhead: 'FIB',
    content: 'Präambel',
    clauses: [{ id: 'c1', title: 'Zweck', body: 'Zusammenarbeit', sortOrder: 0 }],
    closing: null,
    templateId: null,
    parties: parties.map((name) => ({ name })),
  }
}

async function make(parties?: string[]) {
  const agreement = await createAgreement(input(parties), null)
  created.push(agreement.id)
  return agreement
}

const sign = (token: string, name = 'Jane Doe') => signParty(token, { name, ip: '127.0.0.1', userAgent: 'test' })

async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (cause) => cause instanceof AgreementError && cause.status === status)
}

test('Ein Vertrag aus einer Vorlage bleibt unverändert, wenn die Vorlage später geändert wird', async () => {
  const template = await createTemplate({ name: 'Vorlage', letterhead: 'NEUTRAL', content: 'Alt', clauses: [], closing: null }, null)
  templates.push(template.id)
  const agreement = await createAgreement({ ...input(), content: template.content, letterhead: 'NEUTRAL', templateId: template.id }, null)
  created.push(agreement.id)
  await updateTemplate(template.id, { name: 'Vorlage', letterhead: 'FIB', content: 'Neu', clauses: [], closing: null })
  const reloaded = await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } })
  assert.equal(reloaded.content, 'Alt')
  assert.equal(reloaded.letterhead, 'NEUTRAL')
})

test('Bearbeiten behält Tokens bestehender Parteien und ist nach dem Freigeben gesperrt', async () => {
  const agreement = await make()
  const [fib] = agreement.parties
  const updated = await updateAgreement(agreement.id, { ...input(), parties: [{ id: fib.id, name: 'FIB Direktion' }, { name: 'LSMD' }] })
  assert.deepEqual(updated.parties.map((p) => p.name), ['FIB Direktion', 'LSMD'])
  assert.equal(updated.parties[0].token, fib.token)
  await releaseAgreement(agreement.id)
  await rejects(updateAgreement(agreement.id, input()), 409)
  await rejects(deleteAgreement(agreement.id), 409)
})

test('Der Link eines Entwurfs erlaubt keine Unterschrift', async () => {
  const agreement = await make()
  await rejects(sign(agreement.parties[0].token), 409)
})

test('Drei Parteien: SIGNED erst nach der dritten Unterschrift, doppelte Unterschrift wird abgewiesen', async () => {
  const agreement = await make(['A', 'B', 'C'])
  await releaseAgreement(agreement.id)
  const [a, b, c] = agreement.parties
  assert.equal(await sign(a.token), 'OPEN')
  await rejects(sign(a.token), 409)
  assert.equal(await sign(b.token), 'OPEN')
  assert.equal(await sign(c.token), 'SIGNED')
  const party = await loadPartyByToken(a.token)
  assert.equal(party?.signedName, 'Jane Doe')
})

test('Ablehnung setzt DECLINED, danach kann niemand mehr unterschreiben', async () => {
  const agreement = await make()
  await releaseAgreement(agreement.id)
  assert.equal(await declineParty(agreement.parties[0].token, 'Nicht einverstanden'), 'DECLINED')
  await rejects(sign(agreement.parties[1].token), 409)
})

test('Neu erzeugter Link macht den alten ungültig; nach Unterschrift ist das gesperrt', async () => {
  const agreement = await make()
  await releaseAgreement(agreement.id)
  const [fib, lspd] = agreement.parties
  const fresh = await regeneratePartyToken(agreement.id, fib.id)
  assert.notEqual(fresh, fib.token)
  assert.equal(await loadPartyByToken(fib.token), null)
  assert.equal(await sign(fresh), 'OPEN')
  await rejects(regeneratePartyToken(agreement.id, fib.id), 409)
  await cancelAgreement(agreement.id)
  await rejects(sign(lspd.token), 409)
})

test('Freigeben verlangt einen Entwurf; Duplizieren erzeugt einen neuen Entwurf mit neuen Tokens', async () => {
  const agreement = await make()
  await releaseAgreement(agreement.id)
  await rejects(releaseAgreement(agreement.id), 409)
  const copy = await duplicateAgreement(agreement.id, null)
  created.push(copy.id)
  assert.equal(copy.status, 'DRAFT')
  assert.equal(copy.parties.length, 2)
  assert.notEqual(copy.parties[0].token, agreement.parties[0].token)
})
```

- [ ] **Step 3: Tests laufen lassen**

Run: `npx tsx --test tests/agreements.test.ts tests/agreements-db.test.ts`
Expected: FAIL, Modul `../src/lib/agreement-service` nicht gefunden.

- [ ] **Step 4: `src/lib/agreement-service.ts` schreiben**

```ts
import { randomBytes } from 'node:crypto'
import type { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
import { normalizeLinkToken } from './link-tokens'
import { readContractClauses } from './contracts'
import {
  deriveAgreementStatus,
  normalizeClauses,
  type AgreementInput,
  type AgreementLetterhead,
  type AgreementStatus,
  type TemplateInput,
} from './agreements'

export class AgreementError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export const createPartyToken = () => randomBytes(32).toString('base64url')

const json = (value: unknown) => value as Prisma.InputJsonValue

export const agreementSelect = {
  id: true,
  title: true,
  status: true,
  letterhead: true,
  content: true,
  clauses: true,
  closing: true,
  templateId: true,
  releasedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { displayName: true } },
  parties: {
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, role: true, sortOrder: true, token: true, signedAt: true, signedName: true, declinedAt: true, declineReason: true },
  },
} satisfies Prisma.AgreementSelect

export const agreementListSelect = {
  id: true,
  title: true,
  status: true,
  letterhead: true,
  updatedAt: true,
  parties: { orderBy: { sortOrder: 'asc' }, select: { name: true, signedAt: true, declinedAt: true } },
} satisfies Prisma.AgreementSelect

async function assertTemplate(templateId: string | null | undefined) {
  if (!templateId) return null
  const template = await prisma.agreementTemplate.findUnique({ where: { id: templateId }, select: { id: true } })
  if (!template) throw new AgreementError('Vorlage nicht gefunden', 404)
  return template.id
}

/** Unterscheidet „gibt es nicht“ (404) von „Zustand passt nicht“ (409). */
async function conflictOrMissing(id: string, message: string): Promise<never> {
  const exists = await prisma.agreement.findUnique({ where: { id }, select: { id: true } })
  throw exists ? new AgreementError(message, 409) : new AgreementError('Vertrag nicht gefunden', 404)
}

export async function createAgreement(input: AgreementInput, userId: string | null) {
  const templateId = await assertTemplate(input.templateId)
  return prisma.agreement.create({
    data: {
      title: input.title,
      letterhead: input.letterhead,
      content: input.content,
      clauses: json(normalizeClauses(input.clauses)),
      closing: input.closing?.trim() || null,
      templateId,
      createdById: userId,
      parties: {
        create: input.parties.map((party, index) => ({ name: party.name, role: party.role || null, sortOrder: index, token: createPartyToken() })),
      },
    },
    select: agreementSelect,
  })
}

export async function updateAgreement(id: string, input: AgreementInput) {
  const templateId = await assertTemplate(input.templateId)
  return prisma.$transaction(async (tx) => {
    const current = await tx.agreement.findUnique({ where: { id }, select: { status: true, parties: { select: { id: true } } } })
    if (!current) throw new AgreementError('Vertrag nicht gefunden', 404)
    if (current.status !== 'DRAFT') throw new AgreementError('Nur Entwürfe können bearbeitet werden', 409)

    // Bestehende Parteien behalten ihren Link, damit bereits kopierte Links gültig bleiben.
    const existing = new Set(current.parties.map((party) => party.id))
    const kept = new Set(input.parties.map((party) => party.id).filter((partyId): partyId is string => !!partyId && existing.has(partyId)))
    await tx.agreementParty.deleteMany({ where: { agreementId: id, id: { notIn: [...kept] } } })
    for (const [index, party] of input.parties.entries()) {
      const data = { name: party.name, role: party.role || null, sortOrder: index }
      if (party.id && kept.has(party.id)) await tx.agreementParty.update({ where: { id: party.id }, data })
      else await tx.agreementParty.create({ data: { ...data, agreementId: id, token: createPartyToken() } })
    }

    return tx.agreement.update({
      where: { id },
      data: {
        title: input.title,
        letterhead: input.letterhead,
        content: input.content,
        clauses: json(normalizeClauses(input.clauses)),
        closing: input.closing?.trim() || null,
        templateId,
      },
      select: agreementSelect,
    })
  })
}

export async function deleteAgreement(id: string) {
  const result = await prisma.agreement.deleteMany({ where: { id, status: 'DRAFT' } })
  if (result.count === 0) await conflictOrMissing(id, 'Nur Entwürfe können gelöscht werden')
}

export async function releaseAgreement(id: string) {
  const current = await prisma.agreement.findUnique({ where: { id }, select: { title: true, _count: { select: { parties: true } } } })
  if (!current) throw new AgreementError('Vertrag nicht gefunden', 404)
  if (!current.title.trim()) throw new AgreementError('Titel ist erforderlich')
  if (current._count.parties === 0) throw new AgreementError('Mindestens eine Partei angeben')
  const result = await prisma.agreement.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'OPEN', releasedAt: new Date() } })
  if (result.count === 0) await conflictOrMissing(id, 'Nur Entwürfe können freigegeben werden')
  return prisma.agreement.findUniqueOrThrow({ where: { id }, select: agreementSelect })
}

export async function cancelAgreement(id: string) {
  const result = await prisma.agreement.updateMany({
    where: { id, status: { in: ['DRAFT', 'OPEN'] } },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  })
  if (result.count === 0) await conflictOrMissing(id, 'Dieser Vertrag kann nicht mehr zurückgezogen werden')
  return prisma.agreement.findUniqueOrThrow({ where: { id }, select: agreementSelect })
}

export async function duplicateAgreement(id: string, userId: string | null) {
  const source = await prisma.agreement.findUnique({ where: { id }, select: agreementSelect })
  if (!source) throw new AgreementError('Vertrag nicht gefunden', 404)
  return prisma.agreement.create({
    data: {
      title: `${source.title} (Kopie)`.slice(0, 200),
      letterhead: source.letterhead,
      content: source.content,
      clauses: json(source.clauses),
      closing: source.closing,
      templateId: source.templateId,
      createdById: userId,
      parties: {
        create: source.parties.map((party, index) => ({ name: party.name, role: party.role, sortOrder: index, token: createPartyToken() })),
      },
    },
    select: agreementSelect,
  })
}

export async function regeneratePartyToken(agreementId: string, partyId: string) {
  const token = createPartyToken()
  const result = await prisma.agreementParty.updateMany({
    where: { id: partyId, agreementId, signedAt: null, declinedAt: null, agreement: { is: { status: { in: ['DRAFT', 'OPEN'] } } } },
    data: { token },
  })
  if (result.count === 0) {
    const exists = await prisma.agreementParty.findFirst({ where: { id: partyId, agreementId }, select: { id: true } })
    throw exists ? new AgreementError('Für diese Partei kann kein neuer Link mehr erzeugt werden', 409) : new AgreementError('Partei nicht gefunden', 404)
  }
  return token
}

const linkPartySelect = {
  id: true,
  token: true,
  name: true,
  role: true,
  signedAt: true,
  signedName: true,
  declinedAt: true,
  agreement: {
    select: {
      id: true,
      title: true,
      status: true,
      letterhead: true,
      content: true,
      clauses: true,
      closing: true,
      releasedAt: true,
      // Andere Parteien nur mit dem, was auf dem Dokument steht – nie Token, IP oder User-Agent.
      parties: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, role: true, signedAt: true, signedName: true, declinedAt: true },
      },
    },
  },
} satisfies Prisma.AgreementPartySelect

const defaultPartyLookup = async (token: string) =>
  prisma.agreementParty.findUnique({ where: { token }, select: linkPartySelect })

export type LinkParty = NonNullable<Awaited<ReturnType<typeof defaultPartyLookup>>>

export async function loadPartyByToken(raw: string, lookup: (token: string) => Promise<LinkParty | null> = defaultPartyLookup) {
  const token = normalizeLinkToken(raw)
  if (!token) return null
  const party = await lookup(token)
  // Die Kollation vergleicht ohne Groß-/Kleinschreibung – daher exakt nachprüfen.
  return party && party.token === token ? party : null
}

export function serializeLink(party: LinkParty) {
  const { agreement } = party
  return {
    party: { name: party.name, role: party.role, signedAt: party.signedAt, signedName: party.signedName, declinedAt: party.declinedAt },
    canSign: agreement.status === 'OPEN' && !party.signedAt && !party.declinedAt,
    agreement: {
      title: agreement.title,
      status: agreement.status as AgreementStatus,
      letterhead: agreement.letterhead as AgreementLetterhead,
      content: agreement.content,
      clauses: readContractClauses(agreement.clauses),
      closing: agreement.closing,
      releasedAt: agreement.releasedAt,
      parties: agreement.parties,
    },
  }
}

/**
 * Läuft bewusst nach dem Schreiben und außerhalb einer Transaktion: Unterschreiben
 * zwei Parteien gleichzeitig, sieht der zuletzt laufende Abgleich beide Zeilen.
 */
async function syncAgreementStatus(agreementId: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    select: { status: true, parties: { select: { signedAt: true, declinedAt: true } } },
  })
  if (!agreement) return null
  const next = deriveAgreementStatus(agreement.status as AgreementStatus, agreement.parties)
  if (next !== agreement.status) await prisma.agreement.updateMany({ where: { id: agreementId, status: 'OPEN' }, data: { status: next } })
  return next
}

async function writeParty(token: string, data: Prisma.AgreementPartyUpdateManyMutationInput) {
  const party = await loadPartyByToken(token)
  if (!party) throw new AgreementError('Link ungültig', 404)
  const result = await prisma.agreementParty.updateMany({
    where: { id: party.id, signedAt: null, declinedAt: null, agreement: { is: { status: 'OPEN' } } },
    data,
  })
  if (result.count === 0) throw new AgreementError('Über diesen Link kann nicht mehr unterschrieben werden', 409)
  return syncAgreementStatus(party.agreement.id)
}

export function signParty(token: string, input: { name: string; ip: string | null; userAgent: string | null }) {
  return writeParty(token, { signedAt: new Date(), signedName: input.name, signedIp: input.ip, signedUserAgent: input.userAgent })
}

export function declineParty(token: string, reason: string | null) {
  return writeParty(token, { declinedAt: new Date(), declineReason: reason })
}

export const templateSelect = {
  id: true,
  name: true,
  letterhead: true,
  content: true,
  clauses: true,
  closing: true,
  updatedAt: true,
} satisfies Prisma.AgreementTemplateSelect

export function listTemplates() {
  return prisma.agreementTemplate.findMany({ orderBy: { name: 'asc' }, select: templateSelect })
}

export function createTemplate(input: TemplateInput, userId: string | null) {
  return prisma.agreementTemplate.create({
    data: { name: input.name, letterhead: input.letterhead, content: input.content, clauses: json(normalizeClauses(input.clauses)), closing: input.closing?.trim() || null, createdById: userId },
    select: templateSelect,
  })
}

export async function updateTemplate(id: string, input: TemplateInput) {
  const exists = await prisma.agreementTemplate.findUnique({ where: { id }, select: { id: true } })
  if (!exists) throw new AgreementError('Vorlage nicht gefunden', 404)
  return prisma.agreementTemplate.update({
    where: { id },
    data: { name: input.name, letterhead: input.letterhead, content: input.content, clauses: json(normalizeClauses(input.clauses)), closing: input.closing?.trim() || null },
    select: templateSelect,
  })
}

export async function deleteTemplate(id: string) {
  const result = await prisma.agreementTemplate.deleteMany({ where: { id } })
  if (result.count === 0) throw new AgreementError('Vorlage nicht gefunden', 404)
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npx tsx --test tests/agreements.test.ts tests/agreements-db.test.ts`
Expected: alle pass (5 + 7), 0 fail.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/agreement-service.ts tests/agreements.test.ts tests/agreements-db.test.ts
git commit -m "feat(agreements): add agreement service with signing, tokens and templates"
```

---

### Task 4: Interne API

**Files:**
- Create: `src/lib/agreement-http.ts`
- Create: `src/app/api/agreements/route.ts`
- Create: `src/app/api/agreements/[id]/route.ts`
- Create: `src/app/api/agreements/[id]/release/route.ts`
- Create: `src/app/api/agreements/[id]/cancel/route.ts`
- Create: `src/app/api/agreements/[id]/duplicate/route.ts`
- Create: `src/app/api/agreements/[id]/parties/[partyId]/token/route.ts`
- Create: `src/app/api/agreement-templates/route.ts`
- Create: `src/app/api/agreement-templates/[id]/route.ts`

**Interfaces:**
- Consumes: Service aus Task 3; `requirePermission` aus `src/lib/auth.ts`; `success`, `error`, `unauthorized`, `forbidden`, `notFound` aus `src/lib/api-response.ts`; `createAuditLog({ action, userId, newValue?, oldValue?, details? })` aus `src/lib/audit.ts`.
- Produces: JSON-Antworten `{ success: true, data }`. `GET /api/agreements` → Liste mit `agreementListSelect`; `GET /api/agreements/[id]` → `agreementSelect`; Token-Route → `{ token }`; Vorlagen → `templateSelect`.

- [ ] **Step 1: `src/lib/agreement-http.ts`**

```ts
import { z } from 'zod'
import { error, forbidden, unauthorized } from './api-response'
import { AgreementError } from './agreement-service'

export function agreementErrorResponse(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof AgreementError) return error(cause.message, cause.status)
  if (cause instanceof z.ZodError) return error(cause.issues.map((issue) => issue.message).join(' '))
  if (cause instanceof SyntaxError) return error('Ungültige Eingabe')
  console.error('[Agreement]', cause)
  return error('Vertrag konnte nicht verarbeitet werden', 500)
}
```

- [ ] **Step 2: `src/app/api/agreements/route.ts`**

```ts
import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { agreementInputSchema, isAgreementStatus } from '@/lib/agreements'
import { agreementListSelect, createAgreement } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await requirePermission('agreements:view')
    const search = req.nextUrl.searchParams.get('search')?.trim().slice(0, 100) ?? ''
    const status = req.nextUrl.searchParams.get('status')
    const where: Prisma.AgreementWhereInput = {
      ...(isAgreementStatus(status) ? { status } : {}),
      ...(search ? { OR: [{ title: { contains: search } }, { parties: { some: { name: { contains: search } } } }] } : {}),
    }
    return success(await prisma.agreement.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200, select: agreementListSelect }))
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('agreements:manage')
    const agreement = await createAgreement(agreementInputSchema.parse(await req.json()), user.id)
    await createAuditLog({ action: 'AGREEMENT_CREATED', userId: user.id, newValue: agreement.title, details: agreement.parties.map((p) => p.name).join(', ') })
    return success(agreement, 201)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}
```

- [ ] **Step 3: `src/app/api/agreements/[id]/route.ts`**

```ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { notFound, success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { agreementInputSchema } from '@/lib/agreements'
import { agreementSelect, deleteAgreement, updateAgreement } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requirePermission('agreements:view')
    const agreement = await prisma.agreement.findUnique({ where: { id: (await params).id }, select: agreementSelect })
    return agreement ? success(agreement) : notFound('Vertrag')
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('agreements:manage')
    const agreement = await updateAgreement((await params).id, agreementInputSchema.parse(await req.json()))
    await createAuditLog({ action: 'AGREEMENT_UPDATED', userId: user.id, newValue: agreement.title })
    return success(agreement)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('agreements:manage')
    const { id } = await params
    const existing = await prisma.agreement.findUnique({ where: { id }, select: { title: true } })
    await deleteAgreement(id)
    await createAuditLog({ action: 'AGREEMENT_DELETED', userId: user.id, oldValue: existing?.title })
    return success(null)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}
```

- [ ] **Step 4: Aktions-Routen**

`src/app/api/agreements/[id]/release/route.ts`:
```ts
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { releaseAgreement } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('agreements:manage')
    const agreement = await releaseAgreement((await params).id)
    await createAuditLog({ action: 'AGREEMENT_RELEASED', userId: user.id, newValue: agreement.title })
    return success(agreement)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}
```

`src/app/api/agreements/[id]/cancel/route.ts`:
```ts
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { cancelAgreement } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('agreements:manage')
    const agreement = await cancelAgreement((await params).id)
    await createAuditLog({ action: 'AGREEMENT_CANCELLED', userId: user.id, newValue: agreement.title })
    return success(agreement)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}
```

`src/app/api/agreements/[id]/duplicate/route.ts`:
```ts
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { duplicateAgreement } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('agreements:manage')
    const agreement = await duplicateAgreement((await params).id, user.id)
    await createAuditLog({ action: 'AGREEMENT_CREATED', userId: user.id, newValue: agreement.title, details: 'Duplikat' })
    return success(agreement, 201)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}
```

`src/app/api/agreements/[id]/parties/[partyId]/token/route.ts`:
```ts
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { regeneratePartyToken } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; partyId: string }> }) {
  try {
    const user = await requirePermission('agreements:manage')
    const { id, partyId } = await params
    const token = await regeneratePartyToken(id, partyId)
    const party = await prisma.agreementParty.findUnique({ where: { id: partyId }, select: { name: true, agreement: { select: { title: true } } } })
    await createAuditLog({ action: 'AGREEMENT_TOKEN_REGENERATED', userId: user.id, newValue: party?.agreement.title, details: party?.name })
    return success({ token })
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}
```

- [ ] **Step 5: Vorlagen-Routen**

`src/app/api/agreement-templates/route.ts`:
```ts
import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { templateInputSchema } from '@/lib/agreements'
import { createTemplate, listTemplates } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requirePermission('agreements:view')
    return success(await listTemplates())
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('agreements:manage')
    return success(await createTemplate(templateInputSchema.parse(await req.json()), user.id), 201)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}
```

`src/app/api/agreement-templates/[id]/route.ts`:
```ts
import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { templateInputSchema } from '@/lib/agreements'
import { deleteTemplate, updateTemplate } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requirePermission('agreements:manage')
    return success(await updateTemplate((await params).id, templateInputSchema.parse(await req.json())))
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requirePermission('agreements:manage')
    await deleteTemplate((await params).id)
    return success(null)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}
```

- [ ] **Step 6: Typecheck und Lint**

Run: `npx tsc --noEmit -p .` und `npx eslint src/lib/agreement-http.ts src/app/api/agreements src/app/api/agreement-templates`
Expected: keine Fehler.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/agreement-http.ts src/app/api/agreements src/app/api/agreement-templates
git commit -m "feat(agreements): add internal agreement and template API"
```

---

### Task 5: Öffentliche Link-API

**Files:**
- Create: `src/app/api/agreement-links/[token]/route.ts`

**Interfaces:**
- Consumes: `loadPartyByToken`, `serializeLink`, `signParty`, `declineParty` (Task 3); `linkActionSchema` (Task 2); `publicShareHeaders` aus `src/lib/record-shares.ts`.
- Produces: `GET` → `{ success: true, data: ReturnType<typeof serializeLink> }`; `POST` → gleiche Form im Stand nach der Aktion. Fehler: 404 `Link ungültig`, 409, 400.

- [ ] **Step 1: Route schreiben**

```ts
import { NextRequest } from 'next/server'
import { success, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { publicShareHeaders } from '@/lib/record-shares'
import { linkActionSchema } from '@/lib/agreements'
import { declineParty, loadPartyByToken, serializeLink, signParty } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string }> }

function clientIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (forwarded || req.headers.get('x-real-ip') || '').slice(0, 64) || null
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const party = await loadPartyByToken((await params).token)
    return publicShareHeaders(party ? success(serializeLink(party)) : notFound('Link'))
  } catch (cause) {
    return publicShareHeaders(agreementErrorResponse(cause))
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const party = await loadPartyByToken((await params).token)
    if (!party) return publicShareHeaders(notFound('Link'))
    const action = linkActionSchema.parse(await req.json())

    if (action.action === 'sign') {
      await signParty(party.token, { name: action.name, ip: clientIp(req), userAgent: req.headers.get('user-agent')?.slice(0, 200) ?? null })
      await createAuditLog({ action: 'AGREEMENT_SIGNED', userId: null, newValue: action.name, details: `${party.name}: ${party.agreement.title}` })
    } else {
      await declineParty(party.token, action.reason || null)
      await createAuditLog({ action: 'AGREEMENT_DECLINED', userId: null, newValue: party.name, details: `${party.agreement.title}${action.reason ? `: ${action.reason}` : ''}` })
    }

    const updated = await loadPartyByToken(party.token)
    return publicShareHeaders(updated ? success(serializeLink(updated)) : notFound('Link'))
  } catch (cause) {
    return publicShareHeaders(agreementErrorResponse(cause))
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: keine Ausgabe.

- [ ] **Step 3: Commit**

```powershell
git add src/app/api/agreement-links
git commit -m "feat(agreements): add public signing link API"
```

---

### Task 6: Dokument-Renderer

**Files:**
- Create: `src/components/agreements/agreement-document.tsx`

**Interfaces:**
- Consumes: `renderMarkdown` aus `src/lib/markdown.ts`; `formatContractDate`, `CONTRACT_PLACE`, `type ContractClause` aus `src/lib/contracts.ts`; Typen aus Task 2.
- Produces:
  - `interface AgreementDocumentParty { id: string; name: string; role: string | null; signedAt: string | null; signedName: string | null; declinedAt: string | null }`
  - `interface AgreementDocumentData { title: string; status: AgreementStatus; letterhead: AgreementLetterhead; content: string; clauses: ContractClause[]; closing: string | null; releasedAt: string | null; parties: AgreementDocumentParty[] }`
  - `function AgreementDocument({ document, children }: { document: AgreementDocumentData; children?: React.ReactNode })`

- [ ] **Step 1: Komponente schreiben**

```tsx
'use client'

import { useMemo } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { CONTRACT_PLACE, formatContractDate, type ContractClause } from '@/lib/contracts'
import type { AgreementLetterhead, AgreementStatus } from '@/lib/agreements'

export interface AgreementDocumentParty {
  id: string
  name: string
  role: string | null
  signedAt: string | null
  signedName: string | null
  declinedAt: string | null
}

export interface AgreementDocumentData {
  title: string
  status: AgreementStatus
  letterhead: AgreementLetterhead
  content: string
  clauses: ContractClause[]
  closing: string | null
  releasedAt: string | null
  parties: AgreementDocumentParty[]
}

function Prose({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  if (!markdown.trim()) return null
  return <div className="contract-prose" dangerouslySetInnerHTML={{ __html: html }} />
}

/** Nutzt die Papier-Optik der Arbeitsverträge, ohne deren Agent-Bezug. */
export function AgreementDocument({ document, children }: { document: AgreementDocumentData; children?: React.ReactNode }) {
  const fib = document.letterhead === 'FIB'
  const signed = document.status === 'SIGNED'
  const voided = document.status === 'CANCELLED' || document.status === 'DECLINED'
  const lastSignature = document.parties.map((party) => party.signedAt).filter(Boolean).sort().pop() ?? null
  const dateLabel = formatContractDate(signed ? lastSignature : document.releasedAt ?? new Date())

  return (
    <article
      lang="de"
      className="contract-paper"
      style={fib ? { ['--contract-watermark' as string]: 'url(/shield.webp)' } : { ['--contract-watermark' as string]: 'none' }}
    >
      <div className="contract-body">
        {fib && (
          <header className="contract-letterhead">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/shield.webp" alt="" aria-hidden="true" />
            <div>
              <p className="contract-letterhead-title">Federal Investigation Bureau</p>
              <p className="contract-letterhead-sub">Vertragsdokument · {CONTRACT_PLACE}</p>
            </div>
          </header>
        )}

        <h1 className="contract-doc-title">{document.title}</h1>
        <p className="contract-doc-subtitle">Ausgestellt in {CONTRACT_PLACE}</p>

        <dl className="contract-meta">
          {document.parties.map((party, index) => (
            <div key={party.id}>
              <dt>Partei {index + 1}</dt>
              <dd>
                {party.name}
                {party.role ? ` · ${party.role}` : ''}
              </dd>
            </div>
          ))}
        </dl>

        <section className="contract-section">
          <Prose markdown={document.content} />
        </section>

        {document.clauses.map((clause, index) => (
          <section key={clause.id} className="contract-clause">
            <h2 className="contract-clause-heading">
              § {index + 1} {clause.title}
            </h2>
            <Prose markdown={clause.body} />
          </section>
        ))}

        {document.closing && (
          <section className="contract-section">
            <Prose markdown={document.closing} />
          </section>
        )}

        {children}

        <hr className="contract-divider" />
        <p className="contract-place-date">
          {CONTRACT_PLACE}, den {dateLabel}
        </p>

        <div className="contract-signature-grid">
          {document.parties.map((party) => (
            <div key={party.id}>
              <div className="contract-signature-name">{party.signedName ?? ''}</div>
              <div className="contract-signature-line">
                {party.name}
                {party.role ? ` · ${party.role}` : ''}
                {party.signedAt ? ` · ${formatContractDate(party.signedAt)}` : ''}
                {party.declinedAt ? ' · abgelehnt' : ''}
              </div>
            </div>
          ))}
        </div>
      </div>

      {fib && signed && (
        <div className="contract-stamp" aria-hidden="true">
          <span className="contract-stamp-top">FIB · Vertrag</span>
          <span className="contract-stamp-main">Geschlossen</span>
          <span className="contract-stamp-date">{formatContractDate(lastSignature)}</span>
          <span className="contract-stamp-top">{CONTRACT_PLACE}</span>
        </div>
      )}

      {voided && (
        <div className="contract-void-mark" aria-hidden="true">
          {document.status === 'DECLINED' ? 'Abgelehnt' : 'Ungültig'}
        </div>
      )}
    </article>
  )
}
```

- [ ] **Step 2: Prüfen, dass das Wasserzeichen über die Variable gesteuert wird**

Run: `npx tsx -e "const c=require('fs').readFileSync('src/app/globals.css','utf8');console.log(/--contract-watermark/.test(c))"`
Expected: `true`. Falls `false`: im neutralen Fall statt der Variable die Klasse `contract-paper` beibehalten und zusätzlich `style={{ backgroundImage: 'none' }}` auf `article` setzen; im Browser (Task 8, Step 5) prüfen, dass kein Wappen erscheint.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: keine Ausgabe.

- [ ] **Step 4: Commit**

```powershell
git add src/components/agreements/agreement-document.tsx
git commit -m "feat(agreements): add agreement document renderer"
```

---

### Task 7: Öffentliche Unterschriftsseite

**Files:**
- Create: `src/app/unterschrift/[token]/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/agreement-links/[token]` (Task 5); `AgreementDocument` (Task 6); `Button` aus `src/components/ui/button`; `PdCloudLoader` aus `src/components/ui/loading`.
- Produces: öffentliche Seite. Keine Exporte außer `default`.

- [ ] **Step 1: Seite schreiben**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, Printer, ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PdCloudLoader } from '@/components/ui/loading'
import { AgreementDocument, type AgreementDocumentData } from '@/components/agreements/agreement-document'

interface LinkPayload {
  party: { name: string; role: string | null; signedAt: string | null; signedName: string | null; declinedAt: string | null }
  canSign: boolean
  agreement: AgreementDocumentData
}

type State = { kind: 'loading' } | { kind: 'ready'; data: LinkPayload } | { kind: 'error'; message: string }

export default function AgreementSigningPage() {
  const params = useParams<{ token: string | string[] }>()
  const token = Array.isArray(params.token) ? params.token[0] : params.token ?? ''
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [name, setName] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [showDecline, setShowDecline] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agreement-links/${encodeURIComponent(token)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) setState({ kind: 'error', message: 'Dieser Link ist ungültig.' })
      else setState({ kind: 'ready', data: json.data })
    } catch {
      setState({ kind: 'error', message: 'Verbindung zum Server fehlgeschlagen.' })
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (body: Record<string, unknown>) => {
    setBusy(true)
    setFormError(null)
    try {
      const res = await fetch(`/api/agreement-links/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok || !json.success) setFormError(json.error || 'Aktion fehlgeschlagen.')
      else setState({ kind: 'ready', data: json.data })
    } catch {
      setFormError('Verbindung zum Server fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  if (state.kind === 'loading') return <div className="flex min-h-screen items-center justify-center"><PdCloudLoader /></div>
  if (state.kind === 'error') {
    return (
      <main className="mx-auto max-w-xl px-5 py-20 text-center">
        <ShieldX className="mx-auto text-[#808080]" size={28} />
        <h1 className="mt-3 text-xl font-semibold text-white">Link ungültig</h1>
        <p className="mt-2 text-sm text-[#a6a6a6]">{state.message}</p>
      </main>
    )
  }

  const { party, canSign, agreement } = state.data
  const notice =
    agreement.status === 'DRAFT' ? 'Dieser Vertrag ist noch nicht freigegeben.'
    : agreement.status === 'CANCELLED' ? 'Dieser Vertrag wurde zurückgezogen.'
    : party.signedAt ? `Du hast am ${new Date(party.signedAt).toLocaleString('de-DE')} unterschrieben.`
    : party.declinedAt ? 'Du hast diesen Vertrag abgelehnt.'
    : agreement.status === 'DECLINED' ? 'Eine andere Partei hat diesen Vertrag abgelehnt.'
    : agreement.status === 'SIGNED' ? 'Alle Parteien haben unterschrieben.'
    : null

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-[#a6a6a6]">
          Du unterschreibst für: <span className="font-semibold text-white">{party.name}</span>
          {party.role ? ` · ${party.role}` : ''}
        </p>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer size={14} /> Drucken / PDF
        </Button>
      </div>

      {notice && (
        <p className="flex items-center gap-2 rounded-[10px] border border-[#343434] bg-[#181818] px-4 py-3 text-sm text-[#d4d4d4] print:hidden">
          <CheckCircle2 size={16} className="text-[#a6a6a6]" /> {notice}
        </p>
      )}

      <AgreementDocument document={agreement} />

      {canSign && (
        <section className="space-y-4 rounded-[14px] border border-[#343434] bg-[#141414] p-5 print:hidden">
          <label className="block text-sm text-[#d4d4d4]">
            Vollständiger Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              placeholder="Vor- und Nachname"
              className="mt-1.5 h-10 w-full rounded-[8px] border border-[#343434] bg-[#181818] px-3 text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-[#d4d4d4]">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            Ich habe den Vertrag vollständig gelesen und stimme zu.
          </label>
          <p className="text-xs text-[#c08a5a]">Dieser Link ist persönlich. Wer ihn besitzt, kann für deine Partei unterschreiben.</p>
          {formError && <p role="alert" className="text-sm text-red-300">{formError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} disabled={name.trim().length < 3 || !confirmed} onClick={() => submit({ action: 'sign', name, confirmed })}>
              Unterschreiben
            </Button>
            <Button variant="ghost" onClick={() => setShowDecline((open) => !open)}>Ablehnen</Button>
          </div>
          {showDecline && (
            <div className="space-y-2">
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Grund (optional)"
                className="w-full rounded-[8px] border border-[#343434] bg-[#181818] px-3 py-2 text-white"
              />
              <Button variant="danger" loading={busy} onClick={() => submit({ action: 'decline', reason })}>Vertrag ablehnen</Button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: keine Ausgabe. Falls `Button` die Variante `danger` oder `ghost` nicht kennt: in `src/components/ui/button.tsx` die vorhandenen Varianten nachsehen und die nächstpassende einsetzen.

- [ ] **Step 3: Commit**

```powershell
git add src/app/unterschrift
git commit -m "feat(agreements): add public signing page"
```

---

### Task 8: Dashboard-Seite, Editor und Menüpunkt

**Files:**
- Create: `src/components/agreements/agreement-editor.tsx`
- Create: `src/components/agreements/agreements-workspace.tsx`
- Create: `src/app/(dashboard)/vertraege/page.tsx`
- Modify: `src/components/layout/sidebar.tsx:7-13` (Import), `:54` (Eintrag)

**Interfaces:**
- Consumes: interne API (Task 4); `AgreementDocument` (Task 6); `AGREEMENT_STATUS_META`, `AGREEMENT_LETTERHEADS`, Typen (Task 2); `readContractClauses` aus `src/lib/contracts.ts`; UI: `Button`, `Input`, `Textarea`, `Select`, `Modal`, `Badge`, `PageHeader`, `PageLoader`, `UnauthorizedContent`, `useToast`, `useFetch`, `useApi`, `useAuth`, `hasPermission`.
- Produces:
  - `interface AgreementDraft { title: string; letterhead: AgreementLetterhead; content: string; closing: string; templateId: string; clauses: { key: string; title: string; body: string }[]; parties: { key: string; id?: string; name: string; role: string }[] }`
  - `emptyDraft(): AgreementDraft`
  - `AgreementEditor({ mode, initial, templates, saving, onSave, onCancel })` mit `mode: 'agreement' | 'template'`, `onSave(draft: AgreementDraft, templateName: string | null): void`
  - `AgreementsWorkspace({ canManage }: { canManage: boolean })`

- [ ] **Step 1: `src/components/agreements/agreement-editor.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { readContractClauses } from '@/lib/contracts'
import type { AgreementLetterhead } from '@/lib/agreements'

export interface AgreementTemplateRow {
  id: string
  name: string
  letterhead: AgreementLetterhead
  content: string
  clauses: unknown
  closing: string | null
}

export interface AgreementDraft {
  title: string
  letterhead: AgreementLetterhead
  content: string
  closing: string
  templateId: string
  clauses: { key: string; title: string; body: string }[]
  parties: { key: string; id?: string; name: string; role: string }[]
}

const key = () => Math.random().toString(36).slice(2, 10)

export function emptyDraft(): AgreementDraft {
  return {
    title: '',
    letterhead: 'FIB',
    content: '',
    closing: '',
    templateId: '',
    clauses: [{ key: key(), title: '', body: '' }],
    parties: [{ key: key(), name: '', role: '' }, { key: key(), name: '', role: '' }],
  }
}

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function AgreementEditor({
  mode,
  initial,
  templates,
  saving,
  onSave,
  onCancel,
}: {
  mode: 'agreement' | 'template'
  initial: AgreementDraft
  templates: AgreementTemplateRow[]
  saving: boolean
  onSave: (draft: AgreementDraft, templateName: string | null) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const set = (patch: Partial<AgreementDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const applyTemplate = (templateId: string) => {
    const template = templates.find((entry) => entry.id === templateId)
    if (!template) return set({ templateId: '' })
    const clauses = readContractClauses(template.clauses)
    set({
      templateId,
      letterhead: template.letterhead,
      content: template.content,
      closing: template.closing ?? '',
      clauses: clauses.length ? clauses.map((clause) => ({ key: key(), title: clause.title, body: clause.body })) : [{ key: key(), title: '', body: '' }],
    })
  }

  return (
    <div className="space-y-4">
      {mode === 'agreement' && templates.length > 0 && (
        <Select
          label="Von Vorlage übernehmen"
          options={[{ value: '', label: 'Leeres Dokument' }, ...templates.map((template) => ({ value: template.id, label: template.name }))]}
          value={draft.templateId}
          onValueChange={applyTemplate}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={mode === 'agreement' ? 'Titel' : 'Name der Vorlage'} value={draft.title} maxLength={mode === 'agreement' ? 200 : 120} onChange={(event) => set({ title: event.target.value })} />
        <Select
          label="Briefkopf"
          options={[{ value: 'FIB', label: 'FIB (Wappen & Stempel)' }, { value: 'NEUTRAL', label: 'Neutral' }]}
          value={draft.letterhead}
          onValueChange={(value) => set({ letterhead: value as AgreementLetterhead })}
        />
      </div>

      {mode === 'agreement' && (
        <div className="space-y-2">
          <p className="text-[12.5px] font-semibold text-[#d4d4d4]">Parteien</p>
          {draft.parties.map((party, index) => (
            <div key={party.key} className="flex items-end gap-2">
              <Input label={`Partei ${index + 1}`} value={party.name} maxLength={200} placeholder="z. B. Los Santos Police Department"
                onChange={(event) => set({ parties: draft.parties.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)) })} />
              <Input label="Vertreten durch / Funktion" value={party.role} maxLength={200} placeholder="optional"
                onChange={(event) => set({ parties: draft.parties.map((entry, i) => (i === index ? { ...entry, role: event.target.value } : entry)) })} />
              {draft.parties.length > 1 && (
                <button type="button" aria-label={`Partei ${index + 1} entfernen`} className="mb-2 text-[#909090] hover:text-red-300"
                  onClick={() => set({ parties: draft.parties.filter((_, i) => i !== index) })}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set({ parties: [...draft.parties, { key: key(), name: '', role: '' }] })}>
            <Plus size={13} /> Partei hinzufügen
          </Button>
        </div>
      )}

      <Textarea label="Präambel" rows={4} value={draft.content} placeholder="Einleitender Text (Markdown erlaubt)" onChange={(event) => set({ content: event.target.value })} />

      <div className="space-y-2">
        <p className="text-[12.5px] font-semibold text-[#d4d4d4]">Regelungen</p>
        {draft.clauses.map((clause, index) => (
          <div key={clause.key} className="space-y-2 rounded-[10px] border border-[#343434]/60 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-[#808080]">§ {index + 1}</span>
              <Input value={clause.title} maxLength={200} placeholder="Überschrift"
                onChange={(event) => set({ clauses: draft.clauses.map((entry, i) => (i === index ? { ...entry, title: event.target.value } : entry)) })} />
              <button type="button" aria-label="Nach oben" className="text-[#909090] hover:text-white" onClick={() => set({ clauses: move(draft.clauses, index, index - 1) })}><ArrowUp size={14} /></button>
              <button type="button" aria-label="Nach unten" className="text-[#909090] hover:text-white" onClick={() => set({ clauses: move(draft.clauses, index, index + 1) })}><ArrowDown size={14} /></button>
              {draft.clauses.length > 1 && (
                <button type="button" aria-label={`Regelung ${index + 1} entfernen`} className="text-[#909090] hover:text-red-300" onClick={() => set({ clauses: draft.clauses.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
              )}
            </div>
            <Textarea rows={3} value={clause.body} placeholder="Inhalt der Regelung"
              onChange={(event) => set({ clauses: draft.clauses.map((entry, i) => (i === index ? { ...entry, body: event.target.value } : entry)) })} />
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => set({ clauses: [...draft.clauses, { key: key(), title: '', body: '' }] })}>
          <Plus size={13} /> Regelung hinzufügen
        </Button>
      </div>

      <Textarea label="Abschluss" rows={3} value={draft.closing} placeholder="Text unterhalb der Regelungen" onChange={(event) => set({ closing: event.target.value })} />

      {mode === 'agreement' && (
        <div className="space-y-2 rounded-[10px] border border-[#343434]/60 p-3">
          <Checkbox checked={saveAsTemplate} onCheckedChange={setSaveAsTemplate} label="Aufbau zusätzlich als Vorlage sichern" />
          {saveAsTemplate && <Input label="Name der Vorlage" value={templateName} maxLength={120} placeholder="Ohne Angabe: Vertragstitel" onChange={(event) => setTemplateName(event.target.value)} />}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Abbrechen</Button>
        <Button loading={saving} onClick={() => onSave(draft, saveAsTemplate ? templateName.trim() || draft.title.trim() : null)}>Speichern</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `src/components/agreements/agreements-workspace.tsx`**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, FileSignature, Plus, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageLoader } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { readContractClauses } from '@/lib/contracts'
import { AGREEMENT_STATUSES, AGREEMENT_STATUS_META, type AgreementLetterhead, type AgreementStatus } from '@/lib/agreements'
import { cn, formatDateTime } from '@/lib/utils'
import { AgreementDocument } from './agreement-document'
import { AgreementEditor, emptyDraft, type AgreementDraft, type AgreementTemplateRow } from './agreement-editor'

interface ListRow {
  id: string
  title: string
  status: AgreementStatus
  updatedAt: string
  parties: { name: string; signedAt: string | null; declinedAt: string | null }[]
}

interface PartyRow {
  id: string
  name: string
  role: string | null
  sortOrder: number
  token: string
  signedAt: string | null
  signedName: string | null
  declinedAt: string | null
  declineReason: string | null
}

interface DetailRow {
  id: string
  title: string
  status: AgreementStatus
  letterhead: AgreementLetterhead
  content: string
  clauses: unknown
  closing: string | null
  templateId: string | null
  releasedAt: string | null
  parties: PartyRow[]
}

const draftFrom = (row: DetailRow): AgreementDraft => ({
  title: row.title,
  letterhead: row.letterhead,
  content: row.content,
  closing: row.closing ?? '',
  templateId: row.templateId ?? '',
  clauses: readContractClauses(row.clauses).map((clause) => ({ key: clause.id, title: clause.title, body: clause.body })),
  parties: row.parties.map((party) => ({ key: party.id, id: party.id, name: party.name, role: party.role ?? '' })),
})

const templateDraft = (row: AgreementTemplateRow): AgreementDraft => ({
  ...emptyDraft(),
  title: row.name,
  letterhead: row.letterhead,
  content: row.content,
  closing: row.closing ?? '',
  clauses: readContractClauses(row.clauses).map((clause) => ({ key: clause.id, title: clause.title, body: clause.body })),
  parties: [],
})

const clausePayload = (draft: AgreementDraft) =>
  draft.clauses
    .filter((clause) => clause.title.trim() || clause.body.trim())
    .map((clause, index) => ({ id: clause.key, title: clause.title.trim(), body: clause.body.trim(), sortOrder: index }))

function LinkRow({ agreementId, party, canManage, canRegenerate, onChanged }: { agreementId: string; party: PartyRow; canManage: boolean; canRegenerate: boolean; onChanged: () => Promise<unknown> }) {
  const { execute, loading } = useApi()
  const { addToast } = useToast()
  const [copied, setCopied] = useState(false)
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/unterschrift/${party.token}`
  const state = party.declinedAt ? `Abgelehnt${party.declineReason ? ` · ${party.declineReason}` : ''}` : party.signedAt ? `Unterschrieben von ${party.signedName} · ${formatDateTime(party.signedAt)}` : 'Offen'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ohne Zwischenablage-Recht bleibt der Link im Feld zum Markieren.
    }
  }

  const regenerate = async () => {
    try {
      await execute(`/api/agreements/${agreementId}/parties/${party.id}/token`, { method: 'POST' })
      addToast({ type: 'success', title: 'Neuer Link erzeugt', message: 'Der alte Link funktioniert nicht mehr.' })
      await onChanged()
    } catch (cause) {
      addToast({ type: 'error', title: 'Link nicht erneuert', message: cause instanceof Error ? cause.message : undefined })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#343434]/60 bg-[#181818]/55 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-white">{party.name}{party.role ? <span className="font-normal text-[#909090]"> · {party.role}</span> : null}</p>
        <p className="mt-0.5 truncate text-[11px] text-[#808080]">{state}</p>
      </div>
      <input readOnly value={url} onFocus={(event) => event.target.select()} className="h-8 min-w-0 flex-1 rounded-[8px] border border-[#343434] bg-[#141414] px-2 text-[11.5px] text-[#a6a6a6]" />
      <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Kopiert' : 'Link'}</Button>
      {canManage && canRegenerate && !party.signedAt && !party.declinedAt && (
        <Button size="sm" variant="ghost" loading={loading} onClick={regenerate} aria-label="Link neu erzeugen"><RefreshCw size={13} /></Button>
      )}
    </div>
  )
}

export function AgreementsWorkspace({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<'agreements' | 'templates'>('agreements')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ kind: 'agreement' | 'template'; id: string | null; draft: AgreementDraft } | null>(null)
  const { execute, loading: saving } = useApi()
  const { addToast } = useToast()

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (status) params.set('status', status)
    return `/api/agreements${params.size ? `?${params}` : ''}`
  }, [search, status])

  const { data: rows, loading, refetch } = useFetch<ListRow[]>(query)
  const { data: templates, refetch: refetchTemplates } = useFetch<AgreementTemplateRow[]>('/api/agreement-templates')
  const { data: detail, refetch: refetchDetail } = useFetch<DetailRow>(selectedId ? `/api/agreements/${selectedId}` : null)

  const fail = (title: string, cause: unknown) => addToast({ type: 'error', title, message: cause instanceof Error ? cause.message : undefined })
  const refreshAll = async () => { await Promise.all([refetch(), selectedId ? refetchDetail() : null]) }

  const save = async (draft: AgreementDraft, templateName: string | null) => {
    if (!editor) return
    try {
      if (editor.kind === 'template') {
        const body = { name: draft.title.trim(), letterhead: draft.letterhead, content: draft.content, clauses: clausePayload(draft), closing: draft.closing || null }
        await execute(editor.id ? `/api/agreement-templates/${editor.id}` : '/api/agreement-templates', { method: editor.id ? 'PATCH' : 'POST', body: JSON.stringify(body) })
        addToast({ type: 'success', title: 'Vorlage gespeichert' })
        await refetchTemplates()
      } else {
        const body = {
          title: draft.title.trim(),
          letterhead: draft.letterhead,
          content: draft.content,
          clauses: clausePayload(draft),
          closing: draft.closing || null,
          templateId: draft.templateId || null,
          parties: draft.parties.filter((party) => party.name.trim()).map((party) => ({ ...(party.id ? { id: party.id } : {}), name: party.name.trim(), role: party.role.trim() || null })),
        }
        await execute(editor.id ? `/api/agreements/${editor.id}` : '/api/agreements', { method: editor.id ? 'PATCH' : 'POST', body: JSON.stringify(body) })
        if (templateName) {
          // Scheitert das Sichern der Vorlage, bleibt der Vertrag trotzdem gespeichert.
          try {
            await execute('/api/agreement-templates', { method: 'POST', body: JSON.stringify({ name: templateName.slice(0, 120), letterhead: body.letterhead, content: body.content, clauses: body.clauses, closing: body.closing }) })
            await refetchTemplates()
          } catch (cause) {
            fail('Vorlage nicht gesichert', cause)
          }
        }
        addToast({ type: 'success', title: 'Vertrag gespeichert' })
        await refreshAll()
      }
      setEditor(null)
    } catch (cause) {
      fail('Speichern fehlgeschlagen', cause)
    }
  }

  const action = async (path: string, method: 'POST' | 'DELETE', title: string, closeDetail = false) => {
    if (!selectedId) return
    try {
      await execute(`/api/agreements/${selectedId}${path}`, { method })
      addToast({ type: 'success', title })
      if (closeDetail) setSelectedId(null)
      await refreshAll()
    } catch (cause) {
      fail('Aktion fehlgeschlagen', cause)
    }
  }

  const deleteTemplate = async (id: string) => {
    try {
      await execute(`/api/agreement-templates/${id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Vorlage gelöscht' })
      await refetchTemplates()
    } catch (cause) {
      fail('Löschen fehlgeschlagen', cause)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['agreements', 'templates'] as const).map((entry) => (
          <button key={entry} type="button" onClick={() => setTab(entry)}
            className={cn('inline-flex h-9 items-center rounded-[9px] border px-3 text-[12.5px] font-semibold', tab === entry ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/14 text-[#d4d4d4]' : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:text-white')}>
            {entry === 'agreements' ? 'Verträge' : 'Vorlagen'}
          </button>
        ))}
        {canManage && (
          <Button size="sm" className="ml-auto" onClick={() => setEditor(tab === 'agreements' ? { kind: 'agreement', id: null, draft: emptyDraft() } : { kind: 'template', id: null, draft: { ...emptyDraft(), parties: [] } })}>
            <Plus size={14} /> {tab === 'agreements' ? 'Neuer Vertrag' : 'Neue Vorlage'}
          </Button>
        )}
      </div>

      {tab === 'agreements' ? (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
            <Input placeholder="Titel oder Partei suchen" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Select options={[{ value: '', label: 'Alle Status' }, ...AGREEMENT_STATUSES.map((value) => ({ value, label: AGREEMENT_STATUS_META[value].label }))]} value={status} onValueChange={setStatus} />
          </div>
          {loading && !rows ? <PageLoader /> : !rows?.length ? (
            <div className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 px-4 py-10 text-center">
              <FileSignature size={20} className="mx-auto text-[#6a6a6a]" />
              <p className="mt-2 text-[13px] text-[#d4d4d4]">Keine Verträge gefunden</p>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {rows.map((row) => {
                const signedCount = row.parties.filter((party) => party.signedAt).length
                return (
                  <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className="rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-3.5 text-left hover:border-[#404040]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[14px] font-semibold text-white">{row.title}</p>
                      <Badge variant={AGREEMENT_STATUS_META[row.status].variant}>{AGREEMENT_STATUS_META[row.status].label}</Badge>
                    </div>
                    <p className="mt-1 truncate text-[12px] text-[#a6a6a6]">{row.parties.map((party) => party.name).join(' · ')}</p>
                    <p className="mt-1 text-[11.5px] text-[#6a6a6a]">{signedCount} von {row.parties.length} unterschrieben · {formatDateTime(row.updatedAt)}</p>
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(templates ?? []).map((template) => (
            <div key={template.id} className="rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-3.5">
              <p className="text-[14px] font-semibold text-white">{template.name}</p>
              <p className="mt-1 text-[12px] text-[#808080]">{readContractClauses(template.clauses).length} Regelungen · Briefkopf {template.letterhead === 'FIB' ? 'FIB' : 'neutral'}</p>
              {canManage && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditor({ kind: 'template', id: template.id, draft: templateDraft(template) })}>Bearbeiten</Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteTemplate(template.id)}>Löschen</Button>
                </div>
              )}
            </div>
          ))}
          {!templates?.length && <p className="text-[13px] text-[#808080]">Noch keine Vorlagen.</p>}
        </div>
      )}

      <Modal open={!!selectedId && !editor} onClose={() => setSelectedId(null)} title={detail?.title ?? 'Vertrag'} description={detail ? AGREEMENT_STATUS_META[detail.status].label : undefined} size="xl">
        {!detail ? <PageLoader /> : (
          <div className="space-y-4">
            {canManage && (
              <div className="flex flex-wrap gap-2">
                {detail.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => setEditor({ kind: 'agreement', id: detail.id, draft: draftFrom(detail) })}>Bearbeiten</Button>}
                {detail.status === 'DRAFT' && <Button size="sm" loading={saving} onClick={() => action('/release', 'POST', 'Vertrag freigegeben')}>Freigeben</Button>}
                {(detail.status === 'DRAFT' || detail.status === 'OPEN') && <Button size="sm" variant="ghost" loading={saving} onClick={() => action('/cancel', 'POST', 'Vertrag zurückgezogen')}>Zurückziehen</Button>}
                <Button size="sm" variant="ghost" loading={saving} onClick={() => action('/duplicate', 'POST', 'Kopie als Entwurf angelegt', true)}>Duplizieren</Button>
                {detail.status === 'DRAFT' && <Button size="sm" variant="danger" loading={saving} onClick={() => action('', 'DELETE', 'Entwurf gelöscht', true)}>Löschen</Button>}
              </div>
            )}
            {detail.status === 'DRAFT' ? (
              <p className="text-[12px] text-[#a6a6a6]">Die Links funktionieren erst nach dem Freigeben.</p>
            ) : (
              <p className="text-[11px] text-[#c08a5a]">Wer einen Link besitzt, kann für diese Partei unterschreiben. Nur an die vorgesehene Stelle weitergeben.</p>
            )}
            <div className="space-y-2">
              {detail.parties.map((party) => (
                <LinkRow key={party.id} agreementId={detail.id} party={party} canManage={canManage} canRegenerate={detail.status === 'DRAFT' || detail.status === 'OPEN'} onChanged={refetchDetail} />
              ))}
            </div>
            <AgreementDocument document={{ ...detail, clauses: readContractClauses(detail.clauses) }} />
          </div>
        )}
      </Modal>

      <Modal open={!!editor} onClose={() => setEditor(null)} title={editor?.kind === 'template' ? (editor.id ? 'Vorlage bearbeiten' : 'Neue Vorlage') : editor?.id ? 'Vertrag bearbeiten' : 'Neuer Vertrag'} size="xl">
        {editor && (
          <AgreementEditor key={editor.id ?? 'new'} mode={editor.kind} initial={editor.draft} templates={templates ?? []} saving={saving} onSave={save} onCancel={() => setEditor(null)} />
        )}
      </Modal>
    </div>
  )
}
```

- [ ] **Step 3: `src/app/(dashboard)/vertraege/page.tsx`**

```tsx
'use client'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { AgreementsWorkspace } from '@/components/agreements/agreements-workspace'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'

export default function AgreementsPage() {
  const { user } = useAuth()
  if (!hasPermission(user, 'agreements:view')) return <UnauthorizedContent />

  return (
    <div className="mx-auto max-w-6xl pb-2">
      <PageHeader title="Verträge" description="Frei aufgesetzte Verträge mit beliebigen Parteien, unterschrieben per Link." />
      <AgreementsWorkspace canManage={hasPermission(user, 'agreements:manage')} />
    </div>
  )
}
```

- [ ] **Step 4: Menüpunkt in `src/components/layout/sidebar.tsx`**

Import-Zeile 11 ändern zu:
```ts
  FileText, FileSignature, Gavel, Scale, FolderSearch, Map,
```
Nach Zeile 54 (`Notizen`) einfügen:
```ts
  { name: 'Verträge', href: '/vertraege', icon: FileSignature, permission: 'agreements:view' },
```

- [ ] **Step 5: Typecheck, Lint, manuelle Prüfung**

Run: `npx tsc --noEmit -p .` und `npx eslint src/components/agreements "src/app/(dashboard)/vertraege" src/app/unterschrift src/components/layout/sidebar.tsx`
Expected: keine Fehler. Bei abweichenden Props (`Badge`-Varianten, `useFetch` mit `null`, `Button`-Varianten) die Komponente in `src/components/ui/` bzw. `src/hooks/` lesen und anpassen.

Dann `npm run dev` und im Browser mit einem Benutzer, der `agreements:manage` hat:
1. `/vertraege` → „Neuer Vertrag“ mit drei Parteien, Briefkopf „Neutral“, zwei Regelungen, „Als Vorlage sichern“ → gespeichert, Vorlage im Tab sichtbar.
2. Vertrag öffnen → Vorschau ohne Wappen; „Freigeben“.
3. Link von Partei 1 in privatem Fenster öffnen → unterschreiben → Hinweis „Du hast … unterschrieben“, Formular weg.
4. Link von Partei 2 neu erzeugen → alter Link zeigt „Link ungültig“.
5. Übrige Parteien unterschreiben → Status „Unterschrieben“ in der Liste.
6. Briefkopf „FIB“ an einem Duplikat prüfen: Wappen, nach allen Unterschriften Stempel.

- [ ] **Step 6: Commit**

```powershell
git add src/components/agreements "src/app/(dashboard)/vertraege" src/components/layout/sidebar.tsx
git commit -m "feat(agreements): add agreements workspace, editor and sidebar entry"
```

---

### Task 9: Abschlussprüfung

**Files:** keine neuen.

- [ ] **Step 1: Alle Tests**

Run: `npx tsx --test tests/agreements.test.ts tests/agreements-db.test.ts tests/record-shares.test.ts`
Expected: alle pass.

- [ ] **Step 2: Typecheck und Lint gesamt**

Run: `npx tsc --noEmit -p .` und `npx eslint src/lib/agreements.ts src/lib/agreement-service.ts src/lib/agreement-http.ts src/app/api/agreements src/app/api/agreement-templates src/app/api/agreement-links src/components/agreements "src/app/(dashboard)/vertraege" src/app/unterschrift`
Expected: keine Fehler.

- [ ] **Step 3: Hinweis an den Nutzer**

Die Hauptdatenbank braucht die neuen Tabellen: `npm run db:push` (legt vorher ein Backup an). Die Rechte `agreements:view`/`agreements:manage` müssen Benutzergruppen unter „Benutzergruppen“ zugewiesen werden.
