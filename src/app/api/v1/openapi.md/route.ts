import { NextRequest } from 'next/server'
import { ENDPOINTS } from '@/lib/openapi-spec'
import { PERMISSION_LABELS } from '@/lib/permissions'

/**
 * Generiert eine vollständige Markdown-Dokumentation der Public API.
 * Lässt sich lokal in jede Codebase kopieren oder in Notion / Confluence
 * importieren.
 */
function buildMarkdown(): string {
  const lines: string[] = []
  const byCategory = new Map<string, typeof ENDPOINTS>()
  for (const ep of ENDPOINTS) {
    if (!byCategory.has(ep.category)) byCategory.set(ep.category, [])
    byCategory.get(ep.category)!.push(ep)
  }

  lines.push('# FIB HR Dashboard — Public API')
  lines.push('')
  lines.push('> Vollständige HTTP-API für das FIB HR Dashboard. Jede Dashboard-Funktion ist auch programmatisch verfügbar.')
  lines.push('')
  lines.push('**OpenAPI Spec (JSON):** [`/api/v1/openapi.json`](/api/v1/openapi.json)')
  lines.push('**OpenAPI Spec (YAML):** [`/api/v1/openapi.yaml`](/api/v1/openapi.yaml)')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Inhaltsverzeichnis')
  lines.push('')
  for (const [category, endpoints] of byCategory.entries()) {
    lines.push(`- [${category}](#${category.toLowerCase().replace(/\s+/g, '-')})`)
    for (const ep of endpoints) {
      const anchor = `${ep.method.toLowerCase()}-${ep.path.replace(/[{}\/]/g, '').replace(/\s+/g, '-')}`
      lines.push(`  - [\`${ep.method} ${ep.path}\`](#${anchor}) — ${ep.summary}`)
    }
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  lines.push('## Authentifizierung')
  lines.push('')
  lines.push('Alle API-Endpoints (außer `/api/health` und `/api/public/*`) erfordern Authentifizierung via **Bearer-Token**.')
  lines.push('')
  lines.push('```bash')
  lines.push('curl https://deine-domain/api/agents \\')
  lines.push('  -H "Authorization: Bearer fib_DEIN_TOKEN"')
  lines.push('```')
  lines.push('')
  lines.push('### Token erstellen')
  lines.push('')
  lines.push('1. Im Dashboard: **Admin → API-Tokens → „Neuer Token"**')
  lines.push('2. **Name** vergeben (z. B. „Discord-Bot", „CI-Pipeline")')
  lines.push('3. Optional **Scopes** einschränken (leer = alle deine Rechte)')
  lines.push('4. Optional **Ablaufdatum** setzen (oder unbegrenzt)')
  lines.push('5. **Klartext-Token kopieren** — wird nur EINMALIG angezeigt!')
  lines.push('')
  lines.push('### Token-Format')
  lines.push('')
  lines.push('```')
  lines.push('fib_<32 base62-zeichen>')
  lines.push('# Beispiel')
  lines.push('fib_p4A8xKzQ2mN7vR3jH9wT5yL1cV8bF0dG2nS6hX')
  lines.push('```')
  lines.push('')
  lines.push('### Sicherheit')
  lines.push('')
  lines.push('- SHA-256-Hash wird gespeichert, Klartext wird **nie** persistiert')
  lines.push('- Pro Token ein **eigenes Scope-Set** möglich (Least-Privilege)')
  lines.push('- **Revoke** im Dashboard oder per `DELETE /api/api-tokens/{id}` — sofortige Sperre')
  lines.push('- Detaillierte **Usage-Logs** (Methode, Pfad, Status, IP, Timing) für Audit & Monitoring')
  lines.push('- Token-Scopes sind **immer eine Teilmenge** der Inhaber-Rechte — keine Rechte-Eskalation möglich')
  lines.push('')
  lines.push('## Antwort-Format')
  lines.push('')
  lines.push('Alle Antworten verwenden JSON mit konsistenter Struktur:')
  lines.push('')
  lines.push('**Erfolg:**')
  lines.push('```json')
  lines.push('{ "success": true, "data": { ... } }')
  lines.push('```')
  lines.push('')
  lines.push('**Fehler:**')
  lines.push('```json')
  lines.push('{ "success": false, "error": "Agent nicht gefunden" }')
  lines.push('```')
  lines.push('')
  lines.push('## HTTP-Status-Codes')
  lines.push('')
  lines.push('| Code | Bedeutung |')
  lines.push('| :-- | :-- |')
  lines.push('| `200 OK`           | Erfolg (GET / PATCH / DELETE) |')
  lines.push('| `201 Created`      | Erstellt (POST) |')
  lines.push('| `400 Bad Request`  | Validation-Fehler / fehlende Felder |')
  lines.push('| `401 Unauthorized` | Kein / ungültiger Token |')
  lines.push('| `403 Forbidden`    | Token gültig, aber Scopes reichen nicht |')
  lines.push('| `404 Not Found`    | Resource existiert nicht |')
  lines.push('| `409 Conflict`     | Eindeutigkeits-Konflikt (z. B. doppelte Dienstnummer) |')
  lines.push('| `500 Server Error` | Unerwarteter Fehler |')
  lines.push('')
  lines.push('## Permissions / Scopes')
  lines.push('')
  lines.push('| Permission | Beschreibung |')
  lines.push('| :-- | :-- |')
  for (const p of Object.keys(PERMISSION_LABELS)) {
    lines.push(`| \`${p}\` | ${PERMISSION_LABELS[p as keyof typeof PERMISSION_LABELS]} |`)
  }
  lines.push('')

  // Endpoints per category
  for (const [category, endpoints] of byCategory.entries()) {
    lines.push('---')
    lines.push('')
    lines.push(`## ${category}`)
    lines.push('')
    for (const ep of endpoints) {
      const anchor = `${ep.method.toLowerCase()}-${ep.path.replace(/[{}\/]/g, '').replace(/\s+/g, '-')}`
      lines.push(`<a id="${anchor}"></a>`)
      lines.push(`### \`${ep.method} ${ep.path}\``)
      lines.push('')
      lines.push(`**${ep.summary}**`)
      lines.push('')
      if (ep.scope) {
        lines.push(`> 🔒 Erfordert: \`${ep.scope}\``)
        lines.push('')
      }
      if (ep.description) lines.push(ep.description + '')
      if (ep.notes && ep.notes.length > 0) {
        lines.push('**Hinweise:**')
        for (const n of ep.notes) lines.push(`- ${n}`)
        lines.push('')
      }
      if (ep.params && ep.params.length > 0) {
        lines.push('**Parameter**')
        lines.push('')
        lines.push('| Name | In | Typ | Required | Beschreibung |')
        lines.push('| :-- | :-- | :-- | :--: | :-- |')
        for (const p of ep.params) {
          lines.push(`| \`${p.name}\` | ${p.in} | \`${p.schema.type}\` | ${p.required ? '✓' : ''} | ${p.description}${p.schema.enum ? ` · _enum: ${p.schema.enum.join(', ')}_` : ''} |`)
        }
        lines.push('')
      }
      if (ep.body) {
        lines.push('**Request-Body**')
        lines.push('')
        if (ep.body.description) lines.push(ep.body.description)
        lines.push('')
        lines.push('```json')
        const example: Record<string, unknown> = {}
        for (const f of ep.body.fields) {
          if (f.example !== undefined) example[f.name] = f.example
          else if (f.enumValues?.[0]) example[f.name] = f.enumValues[0]
          else if (f.type === 'string') example[f.name] = `<${f.type}>`
          else if (f.type === 'integer') example[f.name] = 0
          else if (f.type === 'boolean') example[f.name] = false
          else example[f.name] = null
        }
        lines.push(JSON.stringify(example, null, 2))
        lines.push('```')
        lines.push('')
      }
      lines.push('**cURL-Beispiel**')
      lines.push('')
      lines.push('```bash')
      const authHeader = '-H "Authorization: Bearer $FIB_TOKEN"'
      if (ep.body) {
        lines.push(`curl -X ${ep.method} "https://deine-domain${ep.path}" \\`)
        lines.push(`  ${authHeader} \\`)
        lines.push(`  -H "Content-Type: application/json" \\`)
        lines.push(`  -d '${JSON.stringify(ep.body.fields.reduce<Record<string, unknown>>((acc, f) => {
          if (f.example !== undefined) acc[f.name] = f.example
          else if (f.enumValues?.[0]) acc[f.name] = f.enumValues[0]
          else if (f.type === 'string') acc[f.name] = '...'
          else if (f.type === 'integer') acc[f.name] = 0
          else if (f.type === 'boolean') acc[f.name] = false
          else acc[f.name] = null
          return acc
        }, {}))}'`)
      } else {
        lines.push(`curl -X ${ep.method} "https://deine-domain${ep.path}" \\`)
        lines.push(`  ${authHeader}`)
      }
      lines.push('```')
      lines.push('')
    }
  }

  lines.push('---')
  lines.push('')
  lines.push('## Fehlerbehebung')
  lines.push('')
  lines.push('| Problem | Lösung |')
  lines.push('| :-- | :-- |')
  lines.push('| `401 Unauthorized` | Token vergessen, abgelaufen oder widerrufen → neuen Token erstellen |')
  lines.push('| `403 Forbidden` | Token-Scopes decken die Aktion nicht ab → Scopes anpassen oder Admin-Token nutzen |')
  lines.push('| `409 Conflict` | Eindeutigkeits-Konflikt (z. B. Dienstnummer bereits vergeben) → anderen Wert wählen |')
  lines.push('| CORS-Fehler im Browser | `Authorization: Bearer …` muss gesetzt sein, Cookies allein reichen für Cross-Origin nicht |')
  lines.push('')
  lines.push('## CORS')
  lines.push('')
  lines.push('Die Public API reflektiert **jeden Origin**. Da Authentifizierung über Bearer-Tokens läuft, ist der Origin kein Sicherheitskontext — wer ein gültiges Token hat, darf von überall zugreifen.')
  lines.push('')
  lines.push('## Versionierung')
  lines.push('')
  lines.push('Aktuelle Version: **1.0.0**. Breaking Changes werden über eine neue Major-Version (`/api/v2/`) angekündigt.')
  lines.push('')
  lines.push('## Lizenz & Support')
  lines.push('')
  lines.push('FIB HR Dashboard')
  lines.push('')

  return lines.join('\n')
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const base = `${url.protocol}//${url.host}`
  const md = buildMarkdown().replace(/https:\/\/deine-domain/g, base)
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'inline; filename="FIB-HR-API.md"',
    },
  })
}
