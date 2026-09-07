/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config')
const fs = require('node:fs')

const rawWebhookUrl =
  String(process.env.DISCORD_WEBHOOK_URL || '').trim() ||
  String(process.env.FIB_DISCORD_WEBHOOK_URL || '').trim()
const webhookUrl = rawWebhookUrl
  ? (() => {
      const url = new URL(rawWebhookUrl)
      url.searchParams.set('with_components', 'true')
      return url.toString()
    })()
  : ''

const severityMeta = {
  info: { icon: 'ℹ️', label: 'Information' },
  success: { icon: '✅', label: 'Erfolg' },
  warning: { icon: '⚠️', label: 'Warnung' },
  error: { icon: '❌', label: 'Fehler' },
}

function truncate(value, max) {
  const text = String(value || '')
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function readLogTail(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return ''

  const body = fs.readFileSync(filePath, 'utf8')
  const normalized = body.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''

  return truncate(normalized.slice(-850), 850)
}

async function main() {
  if (!webhookUrl || typeof fetch !== 'function') return

  const [, , severity = 'info', title = 'FIB HR Event', description = '', logPath = ''] = process.argv
  const logTail = readLogTail(logPath)
  const meta = severityMeta[severity] || severityMeta.info
  const rows = [
    `- **Quelle:** \`live-update.bat\``,
    `- **Host:** \`${process.env.COMPUTERNAME || 'unknown'}\``,
    logPath ? `- **Logdatei:** \`${truncate(logPath, 900)}\`` : '',
  ].filter(Boolean).join('\n')
  const content = [
    `# \`${meta.icon}\` ${truncate(title, 250)}`,
    description ? description.split('\n').map((line) => `> ${line}`).join('\n') : '',
    rows,
    logTail ? `### Log-Auszug\n\`\`\`\n${logTail}\n\`\`\`` : '',
    `-# ${meta.label} · FIB HR Dashboard`,
  ].filter(Boolean).join('\n\n')

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'FIB HR Monitor',
      flags: 32768,
      allowed_mentions: { parse: [] },
      components: [
        {
          type: 17,
          components: [{ type: 10, content: truncate(content, 3900) }],
        },
      ],
    }),
    signal: AbortSignal.timeout(5000),
  })
}

main().catch((e) => {
  console.error('[DiscordWebhook] Senden fehlgeschlagen:', e)
})
