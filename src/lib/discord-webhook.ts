type WebhookSeverity = 'info' | 'success' | 'warning' | 'error'

type WebhookField = {
  name: string
  value: string
  inline?: boolean
}

type WebhookEvent = {
  title: string
  description?: string
  severity?: WebhookSeverity
  source?: string
  fields?: WebhookField[]
  error?: unknown
}

import {
  componentMessage,
  markdownHeader,
  markdownMeta,
  markdownQuote,
  markdownRows,
  separator,
  textDisplay,
} from './discord-components'

const SEVERITY_META: Record<WebhookSeverity, { icon: string; label: string }> = {
  info: { icon: 'ℹ️', label: 'Information' },
  success: { icon: '✅', label: 'Erfolg' },
  warning: { icon: '⚠️', label: 'Warnung' },
  error: { icon: '❌', label: 'Fehler' },
}

const MAX_TEXT_DISPLAY = 4000

function webhookUrl() {
  const raw = process.env.DISCORD_WEBHOOK_URL?.trim() || process.env.FIB_DISCORD_WEBHOOK_URL?.trim() || ''
  if (!raw) return ''
  const url = new URL(raw)
  url.searchParams.set('with_components', 'true')
  return url.toString()
}

function truncate(value: string, max = MAX_TEXT_DISPLAY) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function stringifyError(error: unknown) {
  if (!error) return ''
  if (error instanceof Error) {
    return [error.name, error.message, error.stack].filter(Boolean).join('\n')
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

export async function sendDiscordWebhookEvent(event: WebhookEvent) {
  const url = webhookUrl()
  if (!url) return

  const severity = event.severity ?? 'info'
  const severityMeta = SEVERITY_META[severity]
  const now = new Date()
  const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })

  const errorText = stringifyError(event.error)
  const body = [
    markdownHeader(severityMeta.icon, event.title),
    event.description ? markdownQuote(event.description) : '',
    event.fields?.length
      ? markdownRows(event.fields.map((field) => ({ label: field.name, value: field.value })))
      : '',
    errorText ? `### Fehlerdetails\n\`\`\`\n${truncate(errorText, 3500)}\n\`\`\`` : '',
    markdownMeta([
      severityMeta.label,
      `Quelle: \`${event.source ?? 'server'}\``,
      `Umgebung: \`${process.env.NODE_ENV || 'unknown'}\``,
      `${timeStr} Uhr`,
    ]),
  ].filter(Boolean)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'FIB Monitor',
        ...componentMessage(
          body.flatMap((content, index) => index === 0 ? [textDisplay(content)] : [separator(), textDisplay(content)]),
        ),
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[DiscordWebhook] HTTP ${res.status}: ${text}`)
    }
  } catch (e) {
    console.error('[DiscordWebhook] Senden fehlgeschlagen:', e)
  }
}

export function queueDiscordWebhookEvent(event: WebhookEvent) {
  void sendDiscordWebhookEvent(event)
}
